import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  STORY_VERSION,
  STORY_CHARACTERS,
  STORY_CHAPTERS,
  playerPortraitPath,
  storyChapterById
} from './story-scripts.js';

// 沈清霜主線劇情播放器。
// - 第一次進入先選擇性別。
// - 劇情依修為節點逐章解鎖並保存在 users/{uid}.storyProgressV1。
// - 同一個修為變化只自動彈一章，避免高境界舊玩家一次被所有章節淹沒。
// - 其他教學／戰鬥／洞天全螢幕介面存在時不搶畫面。

(function () {
  'use strict';

  const FIELD = 'storyProgressV1';
  const LAYER_ID = 'xiuxian-story-layer';
  const ARCHIVE_ID = 'xiuxian-story-archive';
  const STYLE_ID = 'xiuxian-story-style';

  let active = false;
  let currentChapter = null;
  let lineIndex = 0;
  let replayMode = false;
  let snoozeUntil = 0;
  let autoPermits = 1;
  let lastScore = -1;
  let busyPersist = false;
  let storyImagesReady = false;
  let storyImagesPromise = null;

  const STORY_IMAGE_ASSETS = Object.freeze([
    ...Object.values(STORY_CHARACTERS).map((character) => character?.image).filter(Boolean),
    ...['male', 'female'].flatMap((g) =>
      ['neutral', 'confused', 'happy', 'determined'].map((expression) => playerPortraitPath(g, expression))
    )
  ].filter((value, index, list) => list.indexOf(value) === index));

  function data() { return window.getCurrentUserData?.() || null; }
  function user() {
    try { return getAuth(getApp()).currentUser; } catch (_) { return null; }
  }
  function score() { return Math.max(0, Number(data()?.stats?.totalScore) || 0); }
  function progress() { return data()?.[FIELD] || {}; }
  function gender() { return progress()?.gender === 'female' ? 'female' : (progress()?.gender === 'male' ? 'male' : ''); }
  function seenMap() { return progress()?.seen && typeof progress().seen === 'object' ? progress().seen : {}; }
  function playerName() {
    const d = data() || {};
    return window.getPlayerDisplayName?.(d, user()?.displayName || '無名修士')
      || d.displayName || user()?.displayName || '無名修士';
  }
  function juniorTitle() { return gender() === 'female' ? '師妹' : '師弟'; }
  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }
  function interpolate(value) {
    return String(value ?? '')
      .replaceAll('{{playerName}}', playerName())
      .replaceAll('{{junior}}', juniorTitle());
  }

  function preloadImageAsset(src) {
    return new Promise((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve({ src, ok: true });
      image.onerror = () => resolve({ src, ok: false });
      image.src = src;
      if (image.complete && image.naturalWidth > 0) resolve({ src, ok: true });
    });
  }

  function addStoryPreloadHints() {
    STORY_IMAGE_ASSETS.forEach((src) => {
      if (document.head.querySelector(`link[rel="preload"][as="image"][href="${src}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = src;
      link.fetchPriority = 'high';
      document.head.appendChild(link);
    });
  }

  function preloadStoryImages() {
    if (storyImagesPromise) return storyImagesPromise;
    addStoryPreloadHints();
    storyImagesPromise = Promise.all(STORY_IMAGE_ASSETS.map(preloadImageAsset)).then((results) => {
      const failed = results.filter((item) => !item.ok).map((item) => item.src);
      storyImagesReady = true;
      window.__xiuxianStoryImagesReady = true;
      window.__xiuxianStoryImagePreloadFailures = failed;
      if (failed.length) console.warn('[Story] some portraits could not be preloaded:', failed);
      window.dispatchEvent(new CustomEvent('xiuxian:story-images-ready', {
        detail: { total: STORY_IMAGE_ASSETS.length, failed: failed.slice() }
      }));
      return results;
    });
    return storyImagesPromise;
  }

  async function persist(patch = {}) {
    const d = data(), u = user();
    if (!d || !u || busyPersist) {
      if (d) {
        const old = d[FIELD] || {};
        d[FIELD] = {
          version: STORY_VERSION,
          ...old,
          ...patch,
          seen: { ...(old.seen || {}), ...(patch.seen || {}) }
        };
      }
      return;
    }

    const old = d[FIELD] || {};
    const next = {
      version: STORY_VERSION,
      ...old,
      ...patch,
      seen: { ...(old.seen || {}), ...(patch.seen || {}) },
      updatedAtMs: Date.now()
    };
    d[FIELD] = next;
    busyPersist = true;
    try {
      await updateDoc(doc(getFirestore(getApp()), 'users', u.uid), { [FIELD]: next });
    } catch (error) {
      console.warn('[Story] progress save deferred:', error);
    } finally {
      busyPersist = false;
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${LAYER_ID}{position:fixed;inset:0;z-index:13000;overflow:hidden;background:rgba(2,5,3,.42);color:#eee6d4;font-family:var(--xq-serif,'Noto Sans TC',sans-serif);backdrop-filter:blur(1.5px) saturate(.82)}
      #${LAYER_ID}:before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.22),rgba(0,0,0,.04) 30%,rgba(0,0,0,.04) 70%,rgba(0,0,0,.22)),linear-gradient(180deg,rgba(0,0,0,.08),rgba(0,0,0,.18));pointer-events:none}
      #${LAYER_ID} .story-chapter-mark{position:absolute;left:clamp(14px,3vw,42px);top:clamp(14px,3vw,32px);z-index:4;max-width:min(72vw,620px);text-shadow:0 4px 20px #000}
      #${LAYER_ID} .story-chapter-mark small{display:block;color:#9c8555;font-size:9px;font-weight:900;letter-spacing:.2em}
      #${LAYER_ID} .story-chapter-mark b{display:block;margin-top:5px;color:#e9ddc3;font-size:clamp(16px,2.5vw,25px)}
      #${LAYER_ID}.story-playing{cursor:pointer}
      #${LAYER_ID} .story-portrait{position:absolute;z-index:1;bottom:0;height:min(89dvh,900px);width:min(48vw,620px);object-fit:contain;object-position:center bottom;filter:drop-shadow(0 18px 35px rgba(0,0,0,.56));user-select:none;pointer-events:none;transition:opacity .16s ease,transform .18s ease}
      #${LAYER_ID} .story-portrait.left{left:clamp(-60px,-3vw,-12px);transform:translateX(0)}
      #${LAYER_ID} .story-portrait.right{right:clamp(-60px,-3vw,-12px);transform:translateX(0)}
      #${LAYER_ID} .story-portrait.story-bounce{animation:story-character-hop .22s cubic-bezier(.2,.8,.3,1)}
      @keyframes story-character-hop{0%{transform:translateY(0)}42%{transform:translateY(-14px) scale(1.01)}100%{transform:translateY(0)}}
      #${LAYER_ID} .story-narrator-seal{position:absolute;left:50%;top:30%;transform:translate(-50%,-50%);width:86px;height:86px;display:grid;place-items:center;border:1px solid rgba(216,177,93,.25);border-radius:50%;color:#b69854;font:900 34px serif;opacity:.58;box-shadow:0 0 40px rgba(216,177,93,.08)}
      #${LAYER_ID} .story-dialogue{position:absolute;z-index:5;left:50%;bottom:clamp(14px,3vh,34px);transform:translateX(-50%);width:min(calc(100vw - 28px),940px);min-height:170px;padding:20px 22px 17px;border:1px solid rgba(216,177,93,.3);border-radius:22px;background:linear-gradient(145deg,rgba(17,18,15,.91),rgba(5,6,5,.94));box-shadow:0 22px 75px rgba(0,0,0,.64),inset 0 1px rgba(255,255,255,.025);backdrop-filter:blur(10px)}
      #${LAYER_ID} .story-speaker{display:flex;align-items:center;gap:8px;color:#e0bd68;font-size:11px;font-weight:900;letter-spacing:.08em}
      #${LAYER_ID} .story-speaker:before{content:"";width:18px;height:1px;background:#b99143}
      #${LAYER_ID} .story-text{min-height:66px;margin:10px 0 12px;color:#ddd3bf;font-size:clamp(13px,1.55vw,16px);line-height:1.85;font-weight:650;white-space:pre-line}
      #${LAYER_ID} .story-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}
      #${LAYER_ID} .story-actions-left{display:flex;align-items:center;gap:7px;color:#716b5e;font-size:8px}
      #${LAYER_ID} .story-actions button{min-height:38px;padding:0 15px;border-radius:12px;font-size:9px;font-weight:900}
      #${LAYER_ID} .story-later{border:1px solid rgba(255,255,255,.08);background:#0a0b0a;color:#827d72}
      #${LAYER_ID} .story-next{border:1px solid rgba(216,177,93,.55);background:linear-gradient(135deg,#8f6724,#51360e);color:#fff0c6}
      #${LAYER_ID} .story-line-progress{height:3px;margin-top:11px;border-radius:999px;background:rgba(255,255,255,.055);overflow:hidden}
      #${LAYER_ID} .story-line-progress i{display:block;height:100%;background:linear-gradient(90deg,#806026,#d7b65e);transition:width .2s ease}
      #${LAYER_ID} .story-gender{position:absolute;z-index:8;inset:0;display:grid;place-items:center;padding:20px;background:radial-gradient(circle at 50% 30%,rgba(101,78,38,.12),transparent 38%),rgba(3,4,3,.88);backdrop-filter:blur(3px)}
      #${LAYER_ID} .story-gender-card{width:min(100%,940px);padding:24px;border:1px solid rgba(216,177,93,.32);border-radius:25px;background:linear-gradient(145deg,rgba(24,24,19,.94),rgba(7,8,7,.96));text-align:center;box-shadow:0 32px 90px rgba(0,0,0,.7)}
      #${LAYER_ID} .story-gender-card small{color:#9b824d;font-size:8px;font-weight:900;letter-spacing:.2em}.story-gender-card h2{margin:7px 0;color:#f0e3c4;font-size:24px}.story-gender-card p{color:#9d9482;font-size:11px;line-height:1.7}
      #${LAYER_ID} .story-name-field{display:block;max-width:430px;margin:14px auto 0;text-align:left;color:#b9aa8b;font-size:10px;font-weight:800}#${LAYER_ID} .story-name-field input{display:block;width:100%;height:43px;margin-top:6px;padding:0 13px;border:1px solid rgba(216,177,93,.3);border-radius:11px;background:#090a08;color:#f0e3c4;font-size:13px;font-weight:700;font-family:inherit;outline:none}#${LAYER_ID} .story-name-field input:focus{border-color:#cba452;box-shadow:0 0 0 3px rgba(203,164,82,.1)}#${LAYER_ID} .story-name-error{min-height:18px;margin:5px 0 0;color:#d98276!important}
      #${LAYER_ID} .story-gender-options{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}
      #${LAYER_ID} .story-gender-option{position:relative;min-height:390px;overflow:hidden;padding:0;border-radius:20px;border:1px solid rgba(216,177,93,.25);background:radial-gradient(circle at 50% 22%,rgba(216,177,93,.09),transparent 43%),rgba(216,177,93,.035);color:#ead8ad;cursor:pointer}
      #${LAYER_ID} .story-gender-option:hover{border-color:#cba452;background:radial-gradient(circle at 50% 22%,rgba(216,177,93,.15),transparent 45%),rgba(216,177,93,.07);transform:translateY(-2px)}
      #${LAYER_ID} .story-gender-option img{display:block;width:100%;height:325px;object-fit:contain;object-position:center bottom;filter:drop-shadow(0 12px 24px rgba(0,0,0,.42));pointer-events:none}
      #${LAYER_ID} .story-gender-option strong{display:block;padding:12px 10px 3px;color:#f0dbab;font-size:13px;letter-spacing:.06em}
      #${LAYER_ID} .story-gender-option span{display:block;padding:0 10px 13px;color:#887d68;font-size:9px}
      #${ARCHIVE_ID}{position:fixed;inset:0;z-index:12950;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.82);backdrop-filter:blur(10px)}
      #${ARCHIVE_ID} .story-archive-card{width:min(100%,760px);max-height:86dvh;overflow:auto;padding:22px;border:1px solid rgba(216,177,93,.3);border-radius:24px;background:linear-gradient(145deg,#171713,#070807);color:#ddcfaf;box-shadow:0 30px 90px rgba(0,0,0,.65)}
      #${ARCHIVE_ID} .story-archive-head{display:flex;align-items:start;justify-content:space-between;gap:12px}.story-archive-head h3{margin:0;color:#f0dfb9;font-size:21px}.story-archive-head p{margin:4px 0 0;color:#857b68;font-size:9px}.story-archive-close{width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.08);background:#0b0b0a;color:#a79b82}
      #${ARCHIVE_ID} .story-archive-list{display:grid;gap:8px;margin-top:16px}.story-archive-item{width:100%;display:grid;grid-template-columns:62px minmax(0,1fr) auto;align-items:center;gap:10px;padding:11px;border-radius:14px;border:1px solid rgba(216,177,93,.12);background:rgba(255,255,255,.018);text-align:left}.story-archive-item:not(:disabled):hover{border-color:rgba(216,177,93,.36);background:rgba(216,177,93,.045)}.story-archive-item:disabled{opacity:.42}.story-archive-item em{color:#9d8450;font-size:8px;font-style:normal;font-weight:900}.story-archive-item b{display:block;color:#e3d7bc;font-size:10px}.story-archive-item small{display:block;margin-top:3px;color:#777062;font-size:8px}.story-archive-item span{color:#8f846e;font-size:8px}
      .story-archive-launcher{margin:7px 0 0;min-height:30px;padding:0 10px;border-radius:10px;border:1px solid rgba(216,177,93,.2);background:rgba(216,177,93,.045);color:#c8ac69;font-size:8px;font-weight:900}
      @media(max-width:680px){#${LAYER_ID} .story-portrait{height:70dvh;width:78vw;opacity:.62}#${LAYER_ID} .story-portrait.left{left:-22vw}#${LAYER_ID} .story-portrait.right{right:-22vw}#${LAYER_ID} .story-dialogue{bottom:9px;min-height:190px;padding:17px}#${LAYER_ID} .story-text{font-size:13px}#${LAYER_ID} .story-gender{padding:10px}#${LAYER_ID} .story-gender-card{padding:15px}#${LAYER_ID} .story-gender-options{grid-template-columns:1fr 1fr;gap:8px}#${LAYER_ID} .story-gender-option{min-height:300px}#${LAYER_ID} .story-gender-option img{height:245px}#${ARCHIVE_ID} .story-archive-item{grid-template-columns:48px minmax(0,1fr)}#${ARCHIVE_ID} .story-archive-item>span{grid-column:2}}
      @media(prefers-reduced-motion:reduce){#${LAYER_ID} *{transition:none!important;animation:none!important}}
    `;
    document.head.appendChild(style);
  }

  function blocking() {
    return !!document.querySelector([
      '#newbie-tutorial-layer',
      '#qi-five-dongtian-tutorial-layer',
      '#golden-core-tutorial-layer',
      '#progression-v2-modal',
      '.training-v3-modal-backdrop',
      '#realm-breakthrough-feedback',
      '#dongtian-overlay',
      '#five-immortal-challenge',
      '#report-modal:not(.hidden)',
      '#battle-result-overlay',
      '#battle-tutorial-layer'
    ].join(','));
  }

  function layer() {
    ensureStyle();
    let el = document.getElementById(LAYER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = LAYER_ID;
      document.body.appendChild(el);
    }
    return el;
  }

  function portraitFor(line) {
    const character = STORY_CHARACTERS[line?.speaker] || STORY_CHARACTERS.narrator;
    if (character.dynamicPlayer) return playerPortraitPath(gender(), line?.expression || 'neutral');
    return character.image || '';
  }

  function speakerName(line) {
    const character = STORY_CHARACTERS[line?.speaker] || STORY_CHARACTERS.narrator;
    return interpolate(character.name);
  }

  function renderLine(options = {}) {
    if (!active || !currentChapter) return;
    const line = currentChapter.lines[lineIndex];
    if (!line) { finishChapter(); return; }

    const el = layer();
    const character = STORY_CHARACTERS[line.speaker] || STORY_CHARACTERS.narrator;
    const image = portraitFor(line);
    const last = lineIndex >= currentChapter.lines.length - 1;
    const percent = Math.round(((lineIndex + 1) / currentChapter.lines.length) * 100);
    const bouncePortrait = options.bounce === true && !!image;
    el.classList.add('story-playing');

    el.innerHTML = `
      <div class="story-chapter-mark"><small>${escapeHtml(currentChapter.realm)} · MAIN STORY</small><b>${escapeHtml(currentChapter.title)}</b></div>
      ${image
        ? `<img class="story-portrait ${character.side === 'left' ? 'left' : 'right'}${bouncePortrait ? ' story-bounce' : ''}" src="${escapeHtml(image)}" alt="${escapeHtml(speakerName(line))}" decoding="async">`
        : '<div class="story-narrator-seal" aria-hidden="true">道</div>'}
      <section class="story-dialogue" role="dialog" aria-live="polite">
        <div class="story-speaker">${escapeHtml(speakerName(line))}</div>
        <div class="story-text">${escapeHtml(interpolate(line.text))}</div>
        <div class="story-actions">
          <div class="story-actions-left"><span>${lineIndex + 1} / ${currentChapter.lines.length}</span><span>點擊任意處 / Enter / Space</span></div>
          <div style="display:flex;gap:7px"><button type="button" class="story-later">稍後再看</button><button type="button" class="story-next">${last ? '結束本章' : '下一句'}</button></div>
        </div>
        <div class="story-line-progress"><i style="width:${percent}%"></i></div>
      </section>`;

    el.querySelector('.story-later')?.addEventListener('click', deferChapter);
    el.querySelector('.story-next')?.addEventListener('click', nextLine);
    el.onclick = (event) => {
      if (!active || !currentChapter) return;
      if (event.target.closest?.('button,a,input,textarea,select,[data-story-no-advance]')) return;
      nextLine();
    };
  }

  function nextLine() {
    if (!active || !currentChapter) return;
    if (lineIndex >= currentChapter.lines.length - 1) {
      finishChapter();
      return;
    }
    lineIndex += 1;
    renderLine({ bounce: true });
  }

  async function finishChapter() {
    if (!currentChapter) return;
    const finished = currentChapter;
    const wasReplay = replayMode;
    if (!replayMode) {
      await persist({ seen: { [finished.id]: { completedAtMs: Date.now(), score: score() } } });
    }
    active = false;
    document.getElementById(LAYER_ID)?.classList.remove('story-playing');
    currentChapter = null;
    lineIndex = 0;
    replayMode = false;
    document.getElementById(LAYER_ID)?.remove();
    snoozeUntil = Date.now() + 1200;
    if (!wasReplay) window.dispatchEvent(new CustomEvent('xiuxian:story-chapter-completed', { detail: { id: finished.id } }));
  }

  function deferChapter() {
    active = false;
    document.getElementById(LAYER_ID)?.classList.remove('story-playing');
    currentChapter = null;
    lineIndex = 0;
    replayMode = false;
    snoozeUntil = Date.now() + 5 * 60 * 1000;
    document.getElementById(LAYER_ID)?.remove();
  }

  function prepareStoryScene(chapter) {
    const scene = chapter?.scene || {};
    const requestedPage = String(scene.page || 'page-home');
    const targetPage = document.getElementById(requestedPage) ? requestedPage : 'page-home';

    try {
      window.switchToPage?.(targetPage);
    } catch (error) {
      console.warn('[Story] scene page switch failed:', error);
    }

    if (targetPage === 'page-training' && scene.trainingTab) {
      const activateTab = () => {
        const tab = document.querySelector(`#page-training [data-training-tab="${scene.trainingTab}"]`);
        if (tab && !tab.classList.contains('active')) tab.click();
      };
      activateTab();
      setTimeout(activateTab, 80);
      setTimeout(activateTab, 220);
    }

    const main = document.querySelector('main');
    if (main) {
      try { main.scrollTo({ top: 0, left: 0, behavior: 'auto' }); }
      catch (_) { main.scrollTop = 0; }
    }
    window.dispatchEvent(new CustomEvent('xiuxian:story-scene-prepared', {
      detail: { chapterId: chapter?.id || '', page: targetPage, trainingTab: scene.trainingTab || '' }
    }));
  }

  function startChapter(chapter, options = {}) {
    if (!chapter || active) return false;
    if (!storyImagesReady) {
      preloadStoryImages().then(() => startChapter(chapter, options));
      return true;
    }
    document.getElementById(ARCHIVE_ID)?.remove();
    prepareStoryScene(chapter);
    currentChapter = chapter;
    lineIndex = 0;
    replayMode = options.replay === true;
    active = true;
    renderLine();
    return true;
  }

  function battleTutorialComplete() {
    return !!data()?.battleTutorialV1?.completed;
  }

  function nextEligibleChapter() {
    const seen = seenMap();
    const currentScore = score();
    const ordered = STORY_CHAPTERS.slice().sort((a, b) => a.order - b.order);
    for (const chapter of ordered) {
      if (currentScore < chapter.minScore || seen[chapter.id]) continue;
      if (chapter.order >= 4 && !battleTutorialComplete()) return null;
      return chapter;
    }
    return null;
  }

  function openGenderChoice(options = {}) {
    const preview = options.preview === true;
    if (preview && !canPreviewAllStory()) return false;
    if (active || document.getElementById(LAYER_ID)) return false;
    active = true;
    const el = layer();
    el.innerHTML = `<div class="story-gender"><section class="story-gender-card"><small>主線劇情</small><h2>請選擇性別</h2><label class="story-name-field">你的名字<input id="story-player-name" type="text" maxlength="24" autocomplete="nickname" value="${escapeHtml(playerName())}"></label><p class="story-name-error" aria-live="polite"></p><div class="story-gender-options"><button type="button" class="story-gender-option" data-story-gender="male"><img src="${playerPortraitPath('male','neutral')}" alt="男修"><strong>男修 · 師弟</strong></button><button type="button" class="story-gender-option" data-story-gender="female"><img src="${playerPortraitPath('female','neutral')}" alt="女修"><strong>女修 · 師妹</strong></button></div></section></div>`;
    if (preview) {
      const note = document.createElement('p');
      note.textContent = '管理員預覽：不會儲存名字、性別或推進劇情。';
      note.setAttribute('aria-live', 'polite');
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'story-archive-launcher';
      back.textContent = '返回劇情清單';
      back.addEventListener('click', () => {
        active = false;
        el.remove();
        openArchive();
      });
      el.querySelector('.story-gender-card').append(note, back);
    }
    el.querySelectorAll('[data-story-gender]').forEach((button) => {
      button.addEventListener('click', async () => {
        const selected = button.dataset.storyGender === 'female' ? 'female' : 'male';
        const nameInput = el.querySelector('#story-player-name');
        const error = el.querySelector('.story-name-error');
        if (preview) {
          if (!canPreviewAllStory()) { active = false; el.remove(); return; }
          el.querySelectorAll('[data-story-gender]').forEach((item) => {
            const chosen = item === button;
            item.setAttribute('aria-pressed', String(chosen));
            item.style.outline = chosen ? '2px solid #d8b15d' : '';
          });
          el.querySelector('[aria-live="polite"]').textContent =
            `預覽選取：${selected === 'female' ? '女修 · 師妹' : '男修 · 師弟'}（未儲存）`;
          return;
        }
        const requestedName = String(nameInput?.value || '').trim();
        if (!requestedName) { error.textContent = '請先輸入你的名字。'; nameInput?.focus(); return; }
        el.querySelectorAll('[data-story-gender]').forEach((item) => { item.disabled = true; });
        try {
          if (typeof window.updatePlayerDisplayName !== 'function') throw new Error('姓名功能尚未載入，請重新整理後再試。');
          const savedName = await window.updatePlayerDisplayName(requestedName);
          if (nameInput) nameInput.value = savedName;
          await persist({ gender: selected });
        } catch (saveError) {
          error.textContent = saveError?.message || '名字儲存失敗，請再試一次。';
          el.querySelectorAll('[data-story-gender]').forEach((item) => { item.disabled = false; });
          return;
        }
        active = false;
        el.remove();
        const chapter = nextEligibleChapter();
        if (chapter && autoPermits > 0) {
          autoPermits -= 1;
          startChapter(chapter);
        }
      });
    });
  }

  function maybeAutoStart() {
    if (!storyImagesReady) {
      preloadStoryImages().then(() => setTimeout(maybeAutoStart, 0));
      return;
    }
    if (active || document.getElementById(ARCHIVE_ID) || Date.now() < snoozeUntil || blocking() || autoPermits <= 0) return;
    if (!data()?.stats || !user()) return;
    if (!gender()) {
      openGenderChoice();
      return;
    }
    const chapter = nextEligibleChapter();
    if (!chapter) return;
    autoPermits -= 1;
    startChapter(chapter);
  }

  function handleScoreUpdate() {
    const now = score();
    if (lastScore < 0) lastScore = now;
    if (now !== lastScore) {
      lastScore = now;
      autoPermits = 1;
      snoozeUntil = Math.min(snoozeUntil, Date.now() + 900);
    }
    setTimeout(maybeAutoStart, 1000);
  }

  function canPreviewAllStory() { return data()?.isAdmin === true; }

  function openArchive() {
    if (active || window.getBattleTutorialState?.().active) return;
    ensureStyle();
    document.getElementById(ARCHIVE_ID)?.remove();
    const el = document.createElement('div');
    el.id = ARCHIVE_ID;
    const seen = seenMap();
    const currentScore = score();
    const rows = STORY_CHAPTERS.map((chapter) => {
      const unlocked = canPreviewAllStory() || currentScore >= chapter.minScore;
      const read = !!seen[chapter.id];
      return `<button type="button" class="story-archive-item" data-story-chapter="${escapeHtml(chapter.id)}" ${unlocked ? '' : 'disabled'}><em>${escapeHtml(chapter.realm)}</em><span><b>${escapeHtml(chapter.title)}</b><small>${escapeHtml(chapter.subtitle)}</small></span><span>${!unlocked ? `需 ${chapter.minScore} 修為` : (read ? '已讀 · 重播' : '已解鎖')}</span></button>`;
    }).join('');
    el.innerHTML = `<section class="story-archive-card"><div class="story-archive-head"><div><h3>主線劇情回顧</h3><p>已解鎖章節可隨時重播；重播不會改動修為與獎勵。</p></div><button type="button" class="story-archive-close">×</button></div><div class="story-archive-list">${canPreviewAllStory() ? '<button type="button" class="story-archive-item" data-admin-gender-preview><em>管理員</em><span><b>性別選擇</b><small>自由預覽 · 不修改角色性別</small></span></button>' : ''}${rows}${canPreviewAllStory() ? ['intro','shen-story','gu-intro','gu-result'].map((scene, i) => `<button type="button" class="story-archive-item" data-admin-battle-scene="${scene}"><em>管理員</em><span><b>${['沈清霜切磋','一劍之後 · 師姐震驚','顧長風入場','教學戰後對話'][i]}</b><small>自由預覽 · 不寫入進度</small></span></button>`).join('') : ''}</div></section>`;
    el.querySelector('[data-admin-gender-preview]')?.addEventListener('click', () => {
      if (!canPreviewAllStory()) return;
      el.remove();
      openGenderChoice({ preview:true });
    });
    el.querySelectorAll('[data-admin-battle-scene]').forEach((button) => button.addEventListener('click', async () => {
      if (!canPreviewAllStory()) return;
      const opened = await window.startBattleTutorial?.({ replay:true, adminPreview:true, scene:button.dataset.adminBattleScene });
      if (opened) el.remove();
    }));
    el.querySelector('.story-archive-close')?.addEventListener('click', () => el.remove());
    el.addEventListener('click', (event) => { if (event.target === el) el.remove(); });
    el.querySelectorAll('[data-story-chapter]').forEach((button) => {
      button.addEventListener('click', () => {
        const chapter = storyChapterById(button.dataset.storyChapter);
        if (chapter && (canPreviewAllStory() || score() >= chapter.minScore)) {
          el.remove();
          startChapter(chapter, { replay: true });
        }
      });
    });
    document.body.appendChild(el);
  }

  function mountArchiveLauncher() {
    if (document.getElementById('story-archive-launcher')) return;
    const panel = document.getElementById('xiuxian-panel');
    if (!panel) return;
    const button = document.createElement('button');
    button.id = 'story-archive-launcher';
    button.type = 'button';
    button.className = 'story-archive-launcher';
    button.innerHTML = '<i class="fa-solid fa-book-open"></i> 主線劇情';
    button.addEventListener('click', openArchive);
    panel.appendChild(button);
  }

  function onKeydown(event) {
    if (!active || !currentChapter) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target?.matches?.('input,textarea,select,button')) return;
    event.preventDefault();
    nextLine();
  }

  window.preloadXiuxianStoryImages = preloadStoryImages;
  window.getXiuxianStoryImageAssets = () => STORY_IMAGE_ASSETS.slice();
  window.openXiuxianStoryArchive = openArchive;
  window.openXiuxianStoryChapter = (id) => {
    const chapter = storyChapterById(id);
    if (!chapter || (!canPreviewAllStory() && score() < chapter.minScore)) return false;
    return startChapter(chapter, { replay: true });
  };
  window.getXiuxianStoryChapters = () => STORY_CHAPTERS.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    subtitle: chapter.subtitle,
    realm: chapter.realm,
    minScore: chapter.minScore,
    scene: chapter.scene || { page: 'page-home' },
    seen: !!seenMap()[chapter.id]
  }));

  function boot() {
    ensureStyle();
    window.__xiuxianStoryImagesReady = false;
    preloadStoryImages().then(() => setTimeout(maybeAutoStart, 0));
    lastScore = score();
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('xiuxian:stats-updated', handleScoreUpdate);
    window.addEventListener('xiuxian:user-ready', () => {
      mountArchiveLauncher();
      autoPermits = Math.max(1, autoPermits);
      setTimeout(maybeAutoStart, 120);
    });
    window.addEventListener('player-name-updated', () => { if (active && currentChapter) renderLine(); });
    window.addEventListener('xiuxian:battle-tutorial-completed', () => {
      autoPermits = 1;
      snoozeUntil = Math.min(snoozeUntil, Date.now() + 650);
      setTimeout(maybeAutoStart, 900);
    });

    mountArchiveLauncher();
    maybeAutoStart();

    setInterval(() => {
      mountArchiveLauncher();
      if (!active) maybeAutoStart();
    }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

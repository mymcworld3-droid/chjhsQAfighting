import './first-visit-rules.js';

// Welcome and account invitations load with the auth core, before optional modules.
(function () {
  'use strict';
  const KEY = 'qingyun:first-visit:v1';
  const QA = new URLSearchParams(location.search).get('qa') === '1';
  const Rules = window.QingyunFirstVisitRules;
  const $ = id => document.getElementById(id);
  let state;
  try { state = Rules.normalize(JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch (_) { state = Rules.normalize(); }
  let user = null, ready = false, busy = false, scene = 0, readySerial = 0, trialAnswerPending = false;
  const portraits = ['male', 'female'].map(g => `assets/story/characters/player-${g}-neutral.png`);
  const scenes = [
    ['opening-1.png', '知識，就是你的靈根', '歡迎來到青雲宗。每一次思考與作答，都會化為修行的力量。'],
    ['opening-2.png', '與同門切磋問道', '磨練知識，也磨練自己的鬥法本領。'],
    ['opening-4.png', '煉器，打造你的法寶', '收集材料、打造法寶，走出屬於自己的修行路。'],
    ['opening-5.png', '探索洞天與秘境', '將學習內容化為洞天，與同門並肩探索未知。'],
    ['opening-9.png', '你的仙途，從這裡開始', '新手劇情已放在仙道任務中。準備好時，再去認識你的師姐與青雲宗。']
  ];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  function store(patch = {}) {
    state = Rules.normalize({ ...state, ...patch });
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* private browsing still works this session */ }
    document.body.classList.toggle('first-visit-active', !state.completed && state.stage !== 'welcome');
    document.body.dataset.firstVisitStage = state.stage;
  }
  function removeLayer() { $('first-visit-layer')?.remove(); }
  function panel(title, body, actions, { image = '', welcome = false } = {}) {
    removeLayer();
    const layer = document.createElement('section');
    layer.id = 'first-visit-layer';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'first-visit-title');
    layer.className = welcome ? 'first-visit-welcome' : image ? 'first-visit-background' : '';
    layer.innerHTML = `${image ? `<img class="fv-scene" src="assets/story/opening/${escape(image)}" alt="青雲問道世界背景">` : ''}
      ${welcome ? `<div class="fv-portraits" aria-label="兩位主角立繪">${portraits.map((src,i) => `<img src="${src}" alt="${i ? '女修主角' : '男修主角'}">`).join('')}</div>` : ''}
      <div class="fv-card"><small>青雲問道 · ${welcome ? '初入仙途' : state.stage === 'background' ? `世界介紹 ${scene + 1} / ${scenes.length}` : '你的修行旅程'}</small><h2 id="first-visit-title">${title}</h2><div class="fv-copy">${body}</div><p class="fv-error" role="alert"></p><div class="fv-actions">${actions}</div></div>`;
    document.body.append(layer);
    requestAnimationFrame(() => layer.classList.add('is-visible'));
    layer.querySelector('button,input')?.focus({ preventScroll: true });
    layer.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...layer.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (!first) return;
      if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    });
    return layer;
  }
  function error(message) { const node = $('first-visit-layer')?.querySelector('.fv-error'); if (node) node.textContent = message; }
  async function action(task) {
    if (busy) return;
    busy = true;
    $('first-visit-layer')?.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try { await task(); }
    catch (e) { error(e?.message || '連線未完成，請再試一次。'); }
    finally {
      busy = false;
      $('first-visit-layer')?.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  }
  function welcome() {
    const layer = panel('歡迎來到青雲問道！', '<p>讓我們開始答題吧！</p><p>先選想練習的範圍，答對第一題就能引氣入體。</p>',
      '<button type="button" id="fv-start">免註冊，開始答題</button><button type="button" id="fv-login" class="fv-secondary">已有帳號？直接登入</button>', { welcome: true });
    layer.querySelector('#fv-start').onclick = () => action(async () => {
      store({ stage: 'scope', joining: false });
      try { await window.startFirstVisitGuest(); if ($('first-visit-layer') === layer) removeLayer(); }
      catch (e) { store({ stage: 'welcome' }); throw new Error('暫時無法開始免註冊答題，請再試一次。'); }
    });
    layer.querySelector('#fv-login').onclick = () => action(async () => {
      if (user?.isAnonymous) store({ joining: true });
      try { await window.googleLogin(); }
      catch (e) { store({ joining: false }); throw new Error('登入尚未完成，請再試一次。'); }
    });
  }
  function openScope() {
    removeLayer();
    window.switchToPage?.('page-settings');
    const mode = $('set-source-mode');
    if (mode) { mode.value = 'focused'; window.toggleSourceMode?.(); }
    window.openCurriculumStudio?.();
    const studio = $('scope-studio');
    if (!studio || studio.hidden) {
      const layer = panel('選擇你的修習範圍', '<p>範圍選擇器尚在準備，請稍後再試。</p>', '<button type="button" id="fv-retry">重新開啟範圍</button>');
      layer.querySelector('#fv-retry').onclick = openScope;
      return;
    }
    studio.classList.add('fv-scope');
    $('ss-title').textContent = '第一步 · 選擇答題範圍';
    $('ss-picker')?.querySelector('.ss-panel-head small')?.replaceChildren(document.createTextNode('選年級 → 選科目 → 勾一章；儲存後就能開始。'));
    $('dongfu-scope-save').textContent = '選好了，開始答題';
    $('ss-close')?.setAttribute('aria-label', '返回歡迎畫面');
    const closeText = $('ss-close')?.querySelector('span'); if (closeText) closeText.textContent = '返回歡迎畫面';
    const back = $('cs-prev'); if (back) back.textContent = '← 返回歡迎畫面';
    $('bottom-nav')?.classList.add('hidden');
  }
  function features() {
    const layer = panel('思考，才是問道的開始', '<div class="fv-features"><div><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><strong>白板</strong><p>隨手寫下算式、畫圖，整理你的思路。</p></div><div><i class="fa-solid fa-comments" aria-hidden="true"></i><strong>問道助手</strong><p>卡住時可以提問，一起釐清觀念。</p></div></div><p>這些工具都在答題頁，隨時可用。</p>', '<button type="button" id="fv-question">開始第一題</button><button type="button" class="fv-secondary" id="fv-change-scope">調整範圍</button>');
    layer.querySelector('#fv-question').onclick = () => {
      store({ stage: 'question' }); removeLayer(); void window.startQuizFlow?.();
    };
    layer.querySelector('#fv-change-scope').onclick = () => { store({ stage: 'scope' }); openScope(); };
  }
  function invite() {
    const layer = panel('太好了！你已經成為一名合格的修士了！', '<p class="fv-realm">煉氣一層 · 引氣入體</p><p>加入我們的旅程吧！</p><p>綁定 Google 帳號保存這次修行，或登入你的既有帳號。</p>', '<button type="button" id="fv-bind">綁定 Google 帳號／登入</button>');
    layer.querySelector('#fv-bind').onclick = () => action(async () => {
      store({ joining: true });
      try { await window.googleLogin(); }
      catch (e) { store({ joining: false }); throw new Error('尚未完成登入；你的免註冊修行仍保留，請再試一次。'); }
    });
  }
  function backgrounds() {
    const [image, title, text] = scenes[scene];
    const finalLabel = Rules.needsGender(window.getCurrentUserData?.()) ? '選擇性別' : '進入宗門';
    const layer = panel(title, `<p>${text}</p><div class="fv-dots" aria-label="世界介紹進度">${scenes.map((_,i) => `<i class="${i===scene?'current':''}"></i>`).join('')}</div>`, `${scene ? '<button type="button" class="fv-secondary" id="fv-prev">上一張</button>' : ''}<button type="button" id="fv-next">${scene === scenes.length-1 ? finalLabel : '下一張'}</button>`, { image });
    layer.querySelector('#fv-prev')?.addEventListener('click', () => { scene--; backgrounds(); });
    layer.querySelector('#fv-next').onclick = () => {
      if (scene < scenes.length-1) { scene++; backgrounds(); }
      else if (Rules.needsGender(window.getCurrentUserData?.())) { store({ stage: 'gender' }); gender(); }
      else void action(() => finish());
    };
    // Warm the next picture without blocking the current panel.
    if (scene < scenes.length-1) { const img = new Image(); img.src = `assets/story/opening/${scenes[scene+1][0]}`; }
  }
  function gender() {
    const data = window.getCurrentUserData?.();
    const layer = panel('選擇性別', `<label class="fv-name">道號<input id="fv-name" maxlength="24" autocomplete="nickname" value="${escape(data?.displayName || '')}" placeholder="輸入你的道號"></label><div class="fv-genders">${['male','female'].map((g,i) => `<button type="button" class="fv-gender" data-gender="${g}"><img src="${portraits[i]}" alt="${i?'女修':'男修'}"><strong>${i?'女修 · 師妹':'男修 · 師弟'}</strong></button>`).join('')}</div><p>進入宗門後，可從仙道任務開啟「第一章 · 問道靈根」。</p>`, '');
    layer.querySelectorAll('[data-gender]').forEach(button => {
      button.onclick = () => action(() => finish(button.dataset.gender, $('fv-name').value.trim()));
    });
  }
  async function finish(selected = '', name = '') {
    if (!user || user.isAnonymous) throw new Error('請先完成帳號綁定或登入。');
    if (selected && !name) throw new Error('請先輸入你的道號。');
    await window.completeFirstVisitSetup?.(selected, name);
    store({ stage: 'done', completed: true, joining: false });
    cleanup();
    window.switchToPage?.('page-home');
    $('bottom-nav')?.classList.remove('hidden');
    window.dispatchEvent(new CustomEvent('xiuxian:arrival-completed'));
  }
  function cleanup() {
    removeLayer();
    $('scope-studio')?.classList.remove('fv-scope');
    if ($('ss-title')) $('ss-title').textContent = '課程研修所';
    $('ss-picker')?.querySelector('.ss-panel-head small')?.replaceChildren(document.createTextNode('先選出題模式，再從課程目錄挑選章節或細項。'));
    $('ss-close')?.setAttribute('aria-label', '返回洞府');
    const label = $('ss-close')?.querySelector('span'); if (label) label.textContent = '返回洞府';
    $('fv-quiz-hint')?.remove();
  }
  window.isFirstVisitActive = () => !QA && !state.completed && state.stage !== 'welcome';
  window.isFirstVisitTrial = () => !QA && !!user?.isAnonymous && !state.completed;
  window.isFirstVisitQuestion = () => window.isFirstVisitTrial() && state.stage === 'question' && !trialAnswerPending;
  window.beginFirstVisitAnswer = isCorrect => {
    if (!isCorrect || !window.isFirstVisitQuestion()) return false;
    trialAnswerPending = true;
    $('btn-next-step')?.setAttribute('disabled', '');
    return true;
  };
  window.getFirstVisitState = () => ({ ...state });
  window.handleFirstVisitSignedOut = () => {
    user = null; ready = false; readySerial++;
    cleanup();
    document.body.classList.remove('first-visit-active');
    if (state.completed || new URLSearchParams(location.search).get('qa') === '1') return false;
    store({ stage: 'welcome', joining: false }); welcome(); return true;
  };
  window.handleFirstVisitReady = async (person, data, firstLogin = false) => {
    user = person; ready = true; trialAnswerPending = false;
    if (new URLSearchParams(location.search).get('qa') === '1' && person.isAnonymous) { cleanup(); return false; }
    const serial = ++readySerial;
    const next = Rules.readyStage(state, person, data, firstLogin);
    store({ stage: next, completed: next === 'done', joining: next === 'background' || next === 'gender' });
    if (person.isAnonymous && !state.completed) store({ guestUid: person.uid });
    cleanup();
    if (next === 'done') return false;
    $('bottom-nav')?.classList.add('hidden');
    if (next === 'scope') openScope();
    else if (next === 'features') features();
    else if (next === 'question') { if (serial === readySerial) void window.startQuizFlow?.(); }
    else if (next === 'invite') invite();
    else if (next === 'background') { scene = 0; backgrounds(); }
    else if (next === 'gender') gender();
    return true;
  };
  window.handleFirstVisitAnswer = async ({ isCorrect, saved, retry }) => {
    if (!window.isFirstVisitTrial() || state.stage !== 'question' || !isCorrect) return false;
    if (!saved) {
      const layer = panel('首題答對了，正在保存修行', '<p>尚未收到儲存確認。請重試，成功後就能完成突破。</p>', '<button type="button" id="fv-save-retry">重新保存首題成果</button>');
      layer.querySelector('#fv-save-retry').onclick = () => action(async () => {
        await retry();
        await window.handleFirstVisitAnswer({ isCorrect: true, saved: true });
      });
      return true;
    }
    removeLayer();
    trialAnswerPending = false;
    store({ stage: 'invite' });
    await window.showFirstQiBreakthrough?.();
    if (ready && user?.isAnonymous && state.stage === 'invite') invite();
    return true;
  };
  window.canFirstVisitNavigate = page => !window.isFirstVisitActive() ||
    (state.stage === 'scope' ? page === 'page-settings' : state.stage === 'question' ? page === 'page-quiz' : false);
  window.firstVisitScopeSaved = () => {
    if (state.stage !== 'scope' || !window.isFirstVisitTrial()) return;
    store({ stage: 'features' }); features();
  };
  window.handleFirstVisitQuestionFailure = () => {
    if (!window.isFirstVisitQuestion()) return false;
    const layer = panel('題目暫時未能載入', '<p>你的出題範圍已保存，可以重新取得題目，或先調整範圍。</p>', '<button type="button" id="fv-retry-question">重新取得題目</button><button type="button" class="fv-secondary" id="fv-retry-scope">調整範圍</button>');
    layer.querySelector('#fv-retry-question').onclick = () => { removeLayer(); void window.startQuizFlow?.(); };
    layer.querySelector('#fv-retry-scope').onclick = () => { store({ stage: 'scope' }); openScope(); };
    return true;
  };
  window.firstVisitScopeClosed = () => {
    if (state.stage !== 'scope' || !window.isFirstVisitTrial()) return;
    welcome();
    const button = $('fv-start');
    button.onclick = () => { removeLayer(); openScope(); };
  };
  window.openFirstVisitAccountBinding = () => {
    if (!user?.isAnonymous) return false;
    store({ stage: 'invite', completed: false }); invite(); return true;
  };
  window.addEventListener('xiuxian:page-changed', () => {
    if (window.isFirstVisitTrial()) $('bottom-nav')?.classList.add('hidden');
  });
  // At the trial page, returning home means adjusting the learning range.
  document.addEventListener('click', event => {
    if (!window.isFirstVisitTrial()) return;
    if (event.target.closest?.('#btn-quiz-home')) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (trialAnswerPending || state.stage === 'invite') return;
      store({ stage: 'scope' }); openScope();
    }
  }, true);
})();

import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 煉氣五層洞天實作教學：看入口 → 理解建立 → 建私人範例 → 完整遊玩 → 親自刪除。
(function () {
  'use strict';

  const SCORE_REQUIRED = 5;
  const FIELD = 'qiFiveDongtianTutorialV1';
  const VERSION = 1;
  const LAYER_ID = 'qi-five-dongtian-tutorial-layer';

  let active = false;
  let phase = 'intro';
  let sampleId = '';
  let sampleCompleted = false;
  let busy = false;
  let snoozeUntil = 0;
  let resizeHandler = null;

  function userData() { return window.getCurrentUserData?.() || null; }
  function marker() { return userData()?.[FIELD] || null; }
  function score() { return Math.max(0, Number(userData()?.stats?.totalScore) || 0); }
  function visible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  }
  function target(selector) {
    const nodes = Array.from(document.querySelectorAll(selector || ''));
    return nodes.find(visible) || nodes[0] || null;
  }
  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }

  function ensureStyle() {
    if (document.getElementById('qi-five-dongtian-tutorial-style')) return;
    const style = document.createElement('style');
    style.id = 'qi-five-dongtian-tutorial-style';
    style.textContent = `
      #${LAYER_ID}{position:fixed;inset:0;z-index:9800;pointer-events:none}
      #${LAYER_ID} .qfd-spot{position:fixed;z-index:1;border:2px solid rgba(196,142,247,.96);border-radius:18px;box-shadow:0 0 0 9999px rgba(0,0,0,.72),0 0 0 6px rgba(180,112,239,.10),0 0 42px rgba(175,104,236,.36);pointer-events:none;transition:all .25s ease}
      #${LAYER_ID} .qfd-card{position:fixed;z-index:2;left:50%;bottom:18px;transform:translateX(-50%);width:min(calc(100vw - 28px),610px);padding:19px;border:1px solid rgba(199,150,247,.36);border-radius:24px;background:linear-gradient(145deg,rgba(24,16,29,.99),rgba(7,6,8,.995));box-shadow:0 28px 90px rgba(0,0,0,.7);pointer-events:auto}
      #${LAYER_ID} .qfd-kicker{color:#b98ade;font-size:8px;font-weight:900;letter-spacing:.18em}
      #${LAYER_ID} h3{margin:5px 0 8px;color:#f2e5f8;font-size:20px}
      #${LAYER_ID} p{margin:0;color:#b9a9c0;font-size:11px;line-height:1.75}
      #${LAYER_ID} p strong{color:#dfbbff}
      #${LAYER_ID} .qfd-note{margin-top:8px;color:#807287;font-size:9px}
      #${LAYER_ID} .qfd-actions{display:grid;grid-template-columns:auto 1fr;gap:8px;margin-top:13px}
      #${LAYER_ID} button{min-height:40px;border-radius:12px;padding:0 13px;font-size:9px;font-weight:900}
      #${LAYER_ID} .qfd-later{border:1px solid rgba(255,255,255,.09);background:#0d0b0e;color:#918698}
      #${LAYER_ID} .qfd-next{border:1px solid rgba(198,144,248,.42);background:linear-gradient(135deg,#76439d,#442259);color:#f4e5ff}
      #${LAYER_ID} .qfd-next:disabled{opacity:.42;cursor:wait}
      #${LAYER_ID} .qfd-progress{height:4px;margin-top:12px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden}
      #${LAYER_ID} .qfd-progress i{display:block;height:100%;background:linear-gradient(90deg,#75439b,#d2a0f3);transition:width .25s ease}
      @media(max-width:560px){#${LAYER_ID} .qfd-card{bottom:10px;padding:16px}#${LAYER_ID} h3{font-size:17px}}
    `;
    document.head.appendChild(style);
  }

  function phaseInfo() {
    if (phase === 'intro') return {
      kicker: '煉氣五層 · 洞天開啟教學',
      title: '現在開始學會「洞天」',
      body: '洞天是把自己的<strong>圖片或文字教材</strong>煉成固定題序的知識秘境。你可以自己建立、重玩與管理；公開洞天也可能被程度較高、科目相符的其他修士遇見。這次會帶你<strong>真的建立一座不公開範例、完整玩完，再親自刪除</strong>。',
      note: '這座教學洞天只屬於你，不會出現在其他玩家的遭遇池。',
      button: '開始找洞天入口',
      target: ''
    };
    if (phase === 'settings') return {
      kicker: '第 1 步 · 找到入口',
      title: '先找到底部「洞府」',
      body: '洞天功能放在<strong>洞府</strong>裡。請自己點擊底部導覽的「洞府」；教學不會直接把你傳送過去。',
      note: '請點畫面上紫色框標示的「洞府」。',
      button: '請點洞府',
      target: '[data-target="page-settings"]',
      locked: true
    };
    if (phase === 'card') return {
      kicker: '第 2 步 · 打開洞天',
      title: '在洞府裡找到「洞天」',
      body: '洞府除了個人設定，也放著洞天管理。請點擊「洞天」標題列把它展開。',
      note: '以後建立、重玩、題目管理與刪除洞天，都從這裡進入。',
      button: '請打開洞天',
      target: '#dongtian-card .dongfu-collapse-head',
      locked: true
    };
    if (phase === 'create') return {
      kicker: '第 3 步 · 如何建立',
      title: '圖片、文字都可以煉成題庫',
      body: '建立洞天時可貼上<strong>課文、筆記、公式、重點文字</strong>，也可上傳多張圖片。AI 不是直接亂出題，而是先辨認素材需要多少題與知識結構，再開始生成。',
      note: '一般洞天至少 10 題；原始教材本身不會被保存成公開內容。',
      button: '了解題量設定',
      target: '#dongtian-card .dt-create'
    };
    if (phase === 'amount') return {
      kicker: '第 4 步 · 題量與結構',
      title: '少、中、多，以及固定單選題',
      body: '<strong>少＝10 題</strong>；<strong>中＝15～20 題</strong>；<strong>多＝25～30 題</strong>。所有題目都是四選一單選，只有一個正解。正式生成時固定<strong>每 5 題一批</strong>，而且後一批會讀取前面所有已生成題目，降低重複。',
      note: '生成完成後還會保留全題 AI 複核。',
      button: '看看「我的洞天」',
      target: '#dongtian-card .dt-amount-options'
    };
    if (phase === 'library') return {
      kicker: '第 5 步 · 管理自己的洞天',
      title: '建立後會出現在「我的洞天」',
      body: '自己的洞天可以重新進入、管理題目或刪除。一般公開洞天可能被其他修士遇見；但接下來系統替你建立的<strong>「引道小洞天」是私人教學洞天</strong>，其他玩家完全遇不到。',
      note: '接下來會建立 10 題教學洞天，不需要呼叫 AI，也不會公開。',
      button: busy ? '正在建立私人範例…' : '建立私人範例洞天',
      target: '#dongtian-card .dt-library',
      busy
    };
    if (phase === 'play') return {
      kicker: '第 6 步 · 親自遊玩',
      title: '進入「引道小洞天」',
      body: '現在請按這座私人範例的<strong>「進入」</strong>。你會完整走過 10 題固定題序，答完後能看到解析、首次靈石與修為獎勵。',
      note: '洞天首次完整通關：每題 100 靈石；修為依答對題數計算，每答對 5 題 +1，至少答對 1 題保底 +1。',
      button: '請按「進入」',
      target: sampleId ? `[data-dt-play="${CSS.escape(sampleId)}"]` : '',
      locked: true
    };
    if (phase === 'delete') return {
      kicker: '第 7 步 · 管理與刪除',
      title: '最後，親自刪除教學洞天',
      body: '你已經實際玩過洞天。現在回到「我的洞天」，請按「引道小洞天」右側的<strong>刪除</strong>，並在確認視窗中同意刪除。這也示範了日後如何清理不再需要的洞天。',
      note: '只有洞天主人能刪除自己的洞天；刪除後其他人也無法再進入。',
      button: '請按「刪除」',
      target: sampleId ? `[data-dt-delete="${CSS.escape(sampleId)}"]` : '',
      locked: true
    };
    return {
      kicker: '完成 · 洞天已掌握',
      title: '你已完成洞天實作教學',
      body: '你已經走過完整流程：<strong>找到洞天 → 了解建立規則 → 建立私人範例 → 完整遊玩 → 刪除洞天</strong>。以後可以把自己的教材煉成洞天，透過答題同時獲得靈石與修為。',
      note: '公開洞天的主人名稱、題數與首次獎勵會在進入前顯示。',
      button: '完成教學',
      target: ''
    };
  }

  function progressPercent() {
    const order = ['intro','settings','card','create','amount','library','play','delete','done'];
    const index = Math.max(0, order.indexOf(phase));
    return Math.round((index / (order.length - 1)) * 100);
  }

  function ensureLayer() {
    ensureStyle();
    let layer = document.getElementById(LAYER_ID);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = LAYER_ID;
      layer.innerHTML = '<div class="qfd-spot"></div><section class="qfd-card"></section>';
      document.body.appendChild(layer);
    }
    return layer;
  }

  function updateSpotlight() {
    if (!active) return;
    const info = phaseInfo();
    const spot = document.querySelector('#' + LAYER_ID + ' .qfd-spot');
    if (!spot) return;
    const el = info.target ? target(info.target) : null;
    if (!el || !visible(el)) {
      spot.style.display = 'none';
      return;
    }
    const rect = el.getBoundingClientRect();
    const pad = 8;
    spot.style.display = 'block';
    spot.style.left = Math.max(6, rect.left - pad) + 'px';
    spot.style.top = Math.max(6, rect.top - pad) + 'px';
    spot.style.width = Math.min(innerWidth - 12, rect.width + pad * 2) + 'px';
    spot.style.height = Math.min(innerHeight - 12, rect.height + pad * 2) + 'px';
  }

  function render() {
    if (!active) return;
    const layer = ensureLayer();
    const info = phaseInfo();
    const card = layer.querySelector('.qfd-card');
    card.innerHTML = `<div class="qfd-kicker">${info.kicker}</div><h3>${info.title}</h3><p>${info.body}</p><div class="qfd-note">${info.note || ''}</div><div class="qfd-progress"><i style="width:${progressPercent()}%"></i></div><div class="qfd-actions"><button class="qfd-later" type="button">稍後再教</button><button class="qfd-next" type="button" ${info.locked || info.busy ? 'disabled' : ''}>${info.button}</button></div>`;
    card.querySelector('.qfd-later').onclick = snooze;
    card.querySelector('.qfd-next').onclick = next;
    if (info.target) {
      setTimeout(() => {
        target(info.target)?.scrollIntoView?.({ behavior:'smooth', block:'center' });
        setTimeout(updateSpotlight, 160);
      }, 80);
    } else {
      updateSpotlight();
    }
  }

  function snooze() {
    active = false;
    snoozeUntil = Date.now() + 5 * 60 * 1000;
    document.getElementById(LAYER_ID)?.remove();
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }

  async function persistProgress(patch) {
    const data = userData();
    const user = getAuth(getApp()).currentUser;
    if (!data || !user) return;
    const next = { version: VERSION, ...(data[FIELD] || {}), ...patch, updatedAt: Date.now() };
    data[FIELD] = next;
    try {
      await updateDoc(doc(getFirestore(getApp()), 'users', user.uid), { [FIELD]: next });
    } catch (error) {
      console.warn('[Qi-five Dongtian tutorial] progress persistence failed:', error);
    }
  }

  async function prepareSample() {
    if (busy) return;
    busy = true;
    render();
    try {
      if (typeof window.ensureDongtianTutorialSample !== 'function') throw new Error('洞天功能尚未載入完成');
      const sample = await window.ensureDongtianTutorialSample();
      sampleId = sample?.id || '';
      if (!sampleId) throw new Error('私人範例洞天建立失敗');
      await persistProgress({ sampleId, started: true });
      phase = 'play';
    } catch (error) {
      console.error('[Qi-five Dongtian tutorial] sample create failed:', error);
      phase = 'library';
    } finally {
      busy = false;
      render();
    }
  }

  async function next() {
    if (busy) return;
    if (phase === 'intro') phase = 'settings';
    else if (phase === 'create') phase = 'amount';
    else if (phase === 'amount') phase = 'library';
    else if (phase === 'library') { await prepareSample(); return; }
    else if (phase === 'done') { await finish(); return; }
    render();
  }

  async function finish() {
    await persistProgress({ completed:true, completedAt:Date.now(), sampleDeleted:true, played:true });
    active = false;
    document.getElementById(LAYER_ID)?.remove();
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }

  function handleClick(event) {
    if (!active) return;
    if (phase === 'settings' && event.target.closest?.('[data-target="page-settings"]')) {
      phase = 'card';
      setTimeout(render, 120);
      return;
    }
    if (phase === 'card' && event.target.closest?.('#dongtian-card .dongfu-collapse-head')) {
      phase = 'create';
      setTimeout(render, 150);
      return;
    }
    if (phase === 'play' && sampleId && event.target.closest?.(`[data-dt-play="${CSS.escape(sampleId)}"]`)) {
      document.getElementById(LAYER_ID)?.remove();
    }
  }

  function onCompleted(event) {
    if (!active || !sampleId || event.detail?.id !== sampleId || event.detail?.tutorialOnly !== true) return;
    sampleCompleted = true;
    persistProgress({ sampleId, played:true, playedAt:Date.now() });
  }

  function onSessionClosed(event) {
    if (!active || !sampleId || event.detail?.id !== sampleId) return;
    if (!sampleCompleted && marker()?.played !== true) {
      phase = 'play';
      setTimeout(render, 180);
      return;
    }
    sampleCompleted = true;
    phase = 'delete';
    setTimeout(() => {
      window.refreshOwnedDongtians?.();
      render();
    }, 220);
  }

  async function onDeleted(event) {
    if (!active || !sampleId || event.detail?.id !== sampleId || event.detail?.tutorialOnly !== true) return;
    await persistProgress({ sampleId, played:true, sampleDeleted:true, deletedAt:Date.now(), completed:true, completedAt:Date.now() });
    phase = 'done';
    setTimeout(render, 120);
  }

  function blocking() {
    return !!document.querySelector('#newbie-tutorial-layer,#golden-core-tutorial-layer,#progression-v2-modal,.training-v3-modal-backdrop,#realm-breakthrough-feedback,#dongtian-overlay,#five-immortal-challenge');
  }

  function start() {
    if (active || score() < SCORE_REQUIRED || marker()?.completed) return;
    active = true;
    sampleId = String(marker()?.sampleId || '');
    sampleCompleted = marker()?.played === true;
    phase = 'intro';
    resizeHandler ||= () => updateSpotlight();
    window.addEventListener('resize', resizeHandler);
    render();
  }

  function maybeAutoStart() {
    if (active || Date.now() < snoozeUntil || score() < SCORE_REQUIRED || marker()?.completed || blocking()) return;
    // 等凡人新手教學先有機會啟動，避免兩個引導同時疊在畫面上。
    setTimeout(() => {
      if (!active && Date.now() >= snoozeUntil && score() >= SCORE_REQUIRED && !marker()?.completed && !blocking()) start();
    }, 650);
  }

  window.startQiFiveDongtianTutorial = start;

  function boot() {
    ensureStyle();
    document.addEventListener('click', handleClick, true);
    window.addEventListener('dongtian:completed', onCompleted);
    window.addEventListener('dongtian:session-closed', onSessionClosed);
    window.addEventListener('dongtian:deleted', onDeleted);
    window.addEventListener('xiuxian:stats-updated', maybeAutoStart);
    window.addEventListener('xiuxian:user-ready', maybeAutoStart);
    setInterval(() => {
      maybeAutoStart();
      if (active) updateSpotlight();
    }, 900);
    setTimeout(maybeAutoStart, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();

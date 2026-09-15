import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 新手教學：以實際 UI 導覽玩法、出題範圍、境界與功能解鎖。
(function () {
  'use strict';

  const FIELD = 'newbieTutorialV1';
  const VERSION = 1;
  let active = false;
  let index = 0;
  let autoStarted = false;
  let resizeHandler = null;

  const steps = [
    {
      page: 'page-home',
      target: '#xiuxian-panel',
      kicker: '第一步 · 仙途',
      title: '以答題累積修為',
      body: '《青雲問道》的核心循環很簡單：選擇適合自己的題目範圍 → 問道答題 → 累積修為 → 突破境界 → 解鎖更多玩法。答對會增加修為；境界進度會顯示在仙府。',
      note: '先不用急著研究所有功能，從問道開始就好。'
    },
    {
      page: 'page-home',
      target: '#btn-home-start',
      kicker: '第二步 · 問道',
      title: '問道試煉是主要修煉方式',
      body: '點「問道試煉」開始單人答題。每一輪都會記錄答對、答錯與連續答對狀態，並依答題結果累積修為。',
      note: '不知道從哪開始時，直接按這顆按鈕即可。'
    },
    {
      page: 'page-settings',
      target: '#set-source-mode',
      kicker: '第三步 · 範圍選擇',
      title: '先決定「題目從哪裡來」',
      body: '在洞府的「出題模式」可以控制範圍：<strong>綜合題目</strong>適合日常練習；<strong>指定題庫</strong>可以鎖定特定題庫檔案；<strong>專注練習</strong>則可加入指定單元，只練你挑選的範圍。',
      note: '考前複習建議使用「指定題庫」或「專注練習」。'
    },
    {
      page: 'page-settings',
      target: '#set-difficulty',
      kicker: '第四步 · 難度',
      title: '再選擇題目難度',
      body: '難度可以交給 AI AUTO 自動調整，也可以固定為簡單、中等或困難。若剛開始玩，建議先使用 AUTO 或中等；熟悉後再提高難度。',
      note: '範圍決定「考什麼」，難度決定「考多深」。'
    },
    {
      page: 'page-home',
      target: 'button[onclick*="startBattleMatchmaking"]',
      kicker: '第五步 · 多人',
      title: '築基後開放鬥法與仙盟',
      body: '多人功能不是一開始就開放。達到 <strong>築基初期（60 修為）</strong> 後，才可使用配對鬥法、接受邀請與仙盟等多人功能。未達門檻時按鈕會顯示鎖定。',
      note: '先用單人問道熟悉題目與修煉節奏。'
    },
    {
      page: 'page-home',
      target: '#xiuxian-panel',
      kicker: '第六步 · 金丹',
      title: '300 修為踏入金丹期',
      body: '達到 <strong>300 修為</strong> 後會解鎖「修煉」分頁與金丹系統。金丹可以洗髓改變種類與品質；不同金丹會改變答題修煉效果，高品質金丹也會有更華麗的丹紋與金光。',
      note: '金丹只有一顆，洗髓會直接重塑目前金丹。'
    },
    {
      page: 'page-home',
      target: '[data-target="page-store"]',
      kicker: '第七步 · 資源',
      title: '坊市、洞府與背包',
      body: '坊市用來取得可購買的道具；洞府可以調整題目設定並查看法寶庫。特殊補償丹藥也會出現在法寶庫中，可直接點擊使用。',
      note: '靈石會用於金丹洗髓與後續修煉系統。'
    },
    {
      page: 'page-home',
      target: '#xiuxian-panel',
      kicker: '完成 · 開始修行',
      title: '先選範圍，再開始問道',
      body: '你不需要一次記住所有系統。最實用的順序是：<strong>洞府選範圍 → 問道試煉 → 60 修為解鎖多人 → 300 修為解鎖金丹</strong>。之後任何時候都能從洞府重新開啟這份教學。',
      note: '祝你道途順遂。'
    }
  ];

  function ensureStyle() {
    if (document.getElementById('newbie-tutorial-style')) return;
    const style = document.createElement('style');
    style.id = 'newbie-tutorial-style';
    style.textContent = `
      #newbie-tutorial-layer { position:fixed; inset:0; z-index:7200; pointer-events:none; }
      .newbie-tutorial-dim { position:absolute; inset:0; background:rgba(0,0,0,.74); backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(2px); pointer-events:auto; }
      .newbie-tutorial-spotlight { position:fixed; z-index:1; border:2px solid rgba(236,197,103,.95); border-radius:18px; box-shadow:0 0 0 9999px rgba(0,0,0,.76),0 0 0 6px rgba(216,177,93,.10),0 0 36px rgba(216,177,93,.32); transition:all .28s ease; pointer-events:none; }
      .newbie-tutorial-card { position:fixed; z-index:3; left:50%; bottom:22px; transform:translateX(-50%); width:min(calc(100vw - 28px),520px); padding:20px; border-radius:26px; border:1px solid rgba(216,177,93,.42); background:linear-gradient(145deg,rgba(25,21,13,.99),rgba(7,7,7,.995)); box-shadow:0 30px 90px rgba(0,0,0,.7),0 0 38px rgba(216,177,93,.08); pointer-events:auto; }
      .newbie-tutorial-kicker { color:#9f8246; font-size:8px; font-weight:900; letter-spacing:.18em; text-transform:uppercase; }
      .newbie-tutorial-card h3 { margin:5px 0 8px; color:#f5ead5; font-size:21px; line-height:1.2; font-weight:900; }
      .newbie-tutorial-card p { margin:0; color:#b8aa90; font-size:12px; line-height:1.75; }
      .newbie-tutorial-card p strong { color:#e4bf61; }
      .newbie-tutorial-note { margin-top:9px !important; color:#817662 !important; font-size:10px !important; }
      .newbie-tutorial-progress { display:flex; align-items:center; gap:5px; margin:14px 0 12px; }
      .newbie-tutorial-progress i { width:6px; height:6px; border-radius:999px; background:rgba(216,177,93,.18); transition:.2s ease; }
      .newbie-tutorial-progress i.active { width:21px; background:#d8b15d; box-shadow:0 0 10px rgba(216,177,93,.28); }
      .newbie-tutorial-actions { display:grid; grid-template-columns:auto 1fr auto; gap:8px; }
      .newbie-tutorial-actions button { min-height:40px; border-radius:13px; padding:0 13px; font-size:10px; font-weight:900; }
      .newbie-tutorial-skip,.newbie-tutorial-prev { color:#9b907b; border:1px solid rgba(216,177,93,.14); background:#0c0c0c; }
      .newbie-tutorial-next { color:#fff0c7; border:1px solid #d8b15d; background:linear-gradient(135deg,#a87827,#5e3b0f); }
      .newbie-tutorial-replay { display:inline-flex; align-items:center; gap:6px; margin:8px 0 14px; min-height:34px; padding:0 11px; border-radius:12px; color:#d9bd76; border:1px solid rgba(216,177,93,.24); background:rgba(216,177,93,.055); font-size:9px; font-weight:900; }
      @media(max-width:520px){ .newbie-tutorial-card{bottom:12px;padding:17px}.newbie-tutorial-card h3{font-size:18px}.newbie-tutorial-card p{font-size:11px}.newbie-tutorial-actions{grid-template-columns:1fr 1fr}.newbie-tutorial-skip{grid-column:1/-1;grid-row:2}.newbie-tutorial-prev,.newbie-tutorial-next{width:100%;} }
      @media(prefers-reduced-motion:reduce){ .newbie-tutorial-spotlight{transition:none;} }
    `;
    document.head.appendChild(style);
  }

  function userData() {
    return window.getCurrentUserData?.() || null;
  }

  function marker() {
    return userData()?.[FIELD] || null;
  }

  function isElementVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  }

  function navigate(page) {
    if (!page || typeof window.switchToPage !== 'function') return;
    window.switchToPage(page);
  }

  function findTarget(selector) {
    if (!selector) return null;
    const candidates = Array.from(document.querySelectorAll(selector));
    return candidates.find(isElementVisible) || candidates[0] || null;
  }

  function updateSpotlight() {
    const layer = document.getElementById('newbie-tutorial-layer');
    const spotlight = layer?.querySelector('.newbie-tutorial-spotlight');
    const dim = layer?.querySelector('.newbie-tutorial-dim');
    if (!layer || !spotlight || !dim || !active) return;

    const step = steps[index];
    const target = findTarget(step.target);
    if (!target || !isElementVisible(target)) {
      spotlight.style.display = 'none';
      dim.style.display = 'block';
      return;
    }

    const rect = target.getBoundingClientRect();
    const pad = 8;
    spotlight.style.display = 'block';
    dim.style.display = 'none';
    spotlight.style.left = `${Math.max(6, rect.left - pad)}px`;
    spotlight.style.top = `${Math.max(6, rect.top - pad)}px`;
    spotlight.style.width = `${Math.min(innerWidth - 12, rect.width + pad * 2)}px`;
    spotlight.style.height = `${Math.min(innerHeight - 12, rect.height + pad * 2)}px`;
    spotlight.style.borderRadius = `${Math.max(14, Math.min(26, parseFloat(getComputedStyle(target).borderRadius) || 16))}px`;
  }

  function progressMarkup() {
    return steps.map((_, i) => `<i class="${i === index ? 'active' : ''}"></i>`).join('');
  }

  function render() {
    if (!active) return;
    const step = steps[index];
    navigate(step.page);

    let layer = document.getElementById('newbie-tutorial-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'newbie-tutorial-layer';
      layer.innerHTML = '<div class="newbie-tutorial-dim"></div><div class="newbie-tutorial-spotlight"></div><section class="newbie-tutorial-card"></section>';
      document.body.appendChild(layer);
    }

    const card = layer.querySelector('.newbie-tutorial-card');
    card.innerHTML = `
      <div class="newbie-tutorial-kicker">${step.kicker}</div>
      <h3>${step.title}</h3>
      <p>${step.body}</p>
      <p class="newbie-tutorial-note">${step.note}</p>
      <div class="newbie-tutorial-progress">${progressMarkup()}</div>
      <div class="newbie-tutorial-actions">
        <button type="button" class="newbie-tutorial-skip">跳過教學</button>
        <button type="button" class="newbie-tutorial-prev" ${index === 0 ? 'disabled' : ''}>上一步</button>
        <button type="button" class="newbie-tutorial-next">${index === steps.length - 1 ? '完成' : '下一步'}</button>
      </div>
    `;

    card.querySelector('.newbie-tutorial-skip')?.addEventListener('click', () => finish(true));
    card.querySelector('.newbie-tutorial-prev')?.addEventListener('click', () => {
      if (index > 0) { index -= 1; render(); }
    });
    card.querySelector('.newbie-tutorial-next')?.addEventListener('click', () => {
      if (index >= steps.length - 1) finish(false);
      else { index += 1; render(); }
    });

    setTimeout(() => {
      const target = findTarget(step.target);
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      setTimeout(updateSpotlight, 180);
    }, 120);
  }

  async function persistFinished(skipped) {
    const data = userData();
    const auth = getAuth(getApp());
    const user = auth.currentUser;
    if (!data || !user) return;
    const value = { version: VERSION, completed: true, skipped: !!skipped, completedAt: Date.now() };
    data[FIELD] = value;
    try {
      await updateDoc(doc(getFirestore(getApp()), 'users', user.uid), { [FIELD]: value });
    } catch (error) {
      console.warn('Tutorial completion could not be persisted:', error);
    }
  }

  function finish(skipped) {
    if (!active) return;
    active = false;
    document.getElementById('newbie-tutorial-layer')?.remove();
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
    navigate('page-home');
    persistFinished(skipped);
  }

  function start(fromBeginning = true) {
    ensureStyle();
    active = true;
    index = fromBeginning ? 0 : Math.min(index, steps.length - 1);
    resizeHandler ||= () => updateSpotlight();
    window.addEventListener('resize', resizeHandler);
    render();
  }

  function addReplayButton() {
    const page = document.getElementById('page-settings');
    if (!page || document.getElementById('newbie-tutorial-replay')) return;
    const button = document.createElement('button');
    button.id = 'newbie-tutorial-replay';
    button.type = 'button';
    button.className = 'newbie-tutorial-replay';
    button.innerHTML = '<i class="fa-solid fa-circle-question"></i><span>重新查看新手教程</span>';
    button.addEventListener('click', () => start(true));
    const firstChild = page.firstElementChild;
    if (firstChild) firstChild.insertAdjacentElement('afterend', button);
    else page.prepend(button);
  }

  function blockingOverlayExists() {
    return !!document.querySelector('#progression-v2-modal,.training-v3-modal-backdrop,#realm-breakthrough-feedback');
  }

  function maybeAutoStart() {
    if (autoStarted || active || blockingOverlayExists()) return;
    const data = userData();
    const auth = getAuth(getApp());
    if (!data?.stats || !auth.currentUser) return;
    if (Number(marker()?.version) >= VERSION && marker()?.completed) {
      autoStarted = true;
      return;
    }
    // 真正的新手自動顯示；舊玩家可在洞府手動重看，避免更新後強制打斷高境界玩家。
    if ((Number(data.stats.totalScore) || 0) > 10) {
      autoStarted = true;
      return;
    }
    autoStarted = true;
    setTimeout(() => {
      if (!blockingOverlayExists()) start(true);
      else autoStarted = false;
    }, 900);
  }

  window.startNewbieTutorial = () => start(true);

  function boot() {
    ensureStyle();
    addReplayButton();
    maybeAutoStart();
    setInterval(() => {
      addReplayButton();
      maybeAutoStart();
      if (active) updateSpotlight();
    }, 700);
    new MutationObserver(addReplayButton).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

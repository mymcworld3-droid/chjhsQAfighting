// 洞天入口保險層：不依賴 Firebase，確保洞府永遠看得到「洞天」入口。
(function () {
  'use strict';

  const ENTRY_ID = 'dongtian-launcher-card';
  const STYLE_ID = 'dongtian-launcher-style';
  let starting = false;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ENTRY_ID}{padding:0!important;overflow:hidden!important;border-color:rgba(183,123,255,.22)!important}
      #${ENTRY_ID} .dt-entry-head{width:100%;min-height:56px;display:grid;grid-template-columns:34px minmax(0,1fr) 28px;align-items:center;gap:10px;padding:10px 14px;border:0;background:linear-gradient(90deg,rgba(145,78,197,.11),rgba(255,255,255,.012));color:inherit;text-align:left;cursor:pointer}
      #${ENTRY_ID} .dt-entry-icon{width:32px;height:32px;display:grid;place-items:center;border-radius:11px;border:1px solid rgba(183,123,255,.28);background:rgba(145,78,197,.09);color:#d9b8ff;font-size:13px}
      #${ENTRY_ID} .dt-entry-copy{min-width:0;display:flex;align-items:center;gap:9px}
      #${ENTRY_ID} .dt-entry-title{color:#f0e1ff;font-size:12px;font-weight:900;letter-spacing:.06em}
      #${ENTRY_ID} .dt-entry-summary{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8c7c96;font-size:9px;font-weight:700}
      #${ENTRY_ID} .dt-entry-chevron{display:grid;place-items:center;color:#a68ab7;font-size:10px;transition:transform .2s ease}
      #${ENTRY_ID}[data-open="1"] .dt-entry-chevron{transform:rotate(180deg)}
      #${ENTRY_ID} .dt-entry-body{padding:14px 18px 18px;border-top:1px solid rgba(183,123,255,.09);background:radial-gradient(circle at 100% 0,rgba(162,96,236,.08),transparent 38%)}
      #${ENTRY_ID} .dt-entry-body[hidden]{display:none!important}
      #${ENTRY_ID} .dt-entry-kicker{color:#bc91d8;font-size:8px;font-weight:900;letter-spacing:.16em}
      #${ENTRY_ID} h4{margin:5px 0 6px;color:#f1e4f8;font-size:15px;font-weight:900}
      #${ENTRY_ID} p{margin:0;color:#8c7f91;font-size:9px;line-height:1.7}
      #${ENTRY_ID} .dt-entry-status{margin-top:10px;padding:9px 10px;border:1px solid rgba(183,123,255,.13);border-radius:11px;background:rgba(0,0,0,.18);color:#aa98b2;font-size:8px;line-height:1.6}
      #${ENTRY_ID} .dt-entry-start{width:100%;min-height:40px;margin-top:10px;border-radius:12px;border:1px solid rgba(196,145,244,.42);background:linear-gradient(135deg,#6d3f93,#3b2050);color:#f7eaff;font-size:9px;font-weight:900;letter-spacing:.08em}
      #${ENTRY_ID} .dt-entry-start:disabled{opacity:.55;cursor:wait}
      @media(max-width:560px){#${ENTRY_ID} .dt-entry-head{grid-template-columns:31px minmax(0,1fr) 24px;padding:9px 11px;min-height:52px}#${ENTRY_ID} .dt-entry-body{padding:12px}}
    `;
    document.head.appendChild(style);
  }

  function actualDongtianReady() {
    return !!document.getElementById('dongtian-card') || typeof window.openDongtianPanel === 'function';
  }

  function insertionPoint(page) {
    return page.querySelector('.dongfu-analysis-card') ||
      page.querySelector('#knowledgeChart')?.closest('.glass-panel') ||
      [...page.querySelectorAll('button')].find((button) => button.getAttribute('onclick')?.includes("page-history")) ||
      null;
  }

  async function startDongtian() {
    if (starting) return;
    if (typeof window.openDongtianPanel === 'function') {
      window.openDongtianPanel();
      return;
    }

    starting = true;
    const button = document.querySelector(`#${ENTRY_ID} .dt-entry-start`);
    const status = document.querySelector(`#${ENTRY_ID} .dt-entry-status`);
    if (button) {
      button.disabled = true;
      button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 啟動洞天中…';
    }
    if (status) status.textContent = '正在重新載入洞天模組與建立介面…';

    try {
      await import('./dongtian.js?v=20260916-2');
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (typeof window.openDongtianPanel !== 'function') throw new Error('洞天模組已載入，但入口尚未完成初始化');
      window.openDongtianPanel();
    } catch (error) {
      console.error('[Dongtian launcher]', error);
      if (status) status.textContent = `洞天啟動失敗：${error?.message || '未知錯誤'}。可再次按下按鈕重試。`;
      if (button) {
        button.disabled = false;
        button.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 重新啟動洞天';
      }
    } finally {
      starting = false;
    }
  }

  function mount() {
    ensureStyle();
    const page = document.getElementById('page-settings');
    if (!page) return false;

    if (document.getElementById('dongtian-card')) {
      document.getElementById(ENTRY_ID)?.remove();
      return true;
    }
    if (document.getElementById(ENTRY_ID)) return true;

    const before = insertionPoint(page);
    const card = document.createElement('section');
    card.id = ENTRY_ID;
    card.className = 'glass-panel rounded-2xl mb-3 relative overflow-hidden';
    card.dataset.open = '1';
    card.innerHTML = `
      <button type="button" class="dt-entry-head" aria-expanded="true">
        <span class="dt-entry-icon"><i class="fa-solid fa-mountain-sun"></i></span>
        <span class="dt-entry-copy"><span class="dt-entry-title">洞天</span><span class="dt-entry-summary">多圖＋文字煉成固定題序的知識秘境</span></span>
        <span class="dt-entry-chevron"><i class="fa-solid fa-chevron-down"></i></span>
      </button>
      <div class="dt-entry-body">
        <div class="dt-entry-kicker">KNOWLEDGE SECRET REALM</div>
        <h4>開闢與遊歷洞天</h4>
        <p>上傳多張圖片或貼上文字，AI 會一次產生洞天名稱、程度、難度、科目與有順序的完整題組。建立後會永久保存，也可能被符合程度與科目的其他修士遇見。</p>
        <div class="dt-entry-status">${actualDongtianReady() ? '洞天系統已就緒，按下方按鈕開啟完整功能。' : '洞天完整模組正在載入；若沒有自動出現完整介面，可由此直接啟動。'}</div>
        <button type="button" class="dt-entry-start"><i class="fa-solid fa-door-open"></i> 開啟洞天</button>
      </div>`;

    if (before) before.before(card);
    else page.appendChild(card);

    const head = card.querySelector('.dt-entry-head');
    const body = card.querySelector('.dt-entry-body');
    head.addEventListener('click', () => {
      const open = card.dataset.open !== '1';
      card.dataset.open = open ? '1' : '0';
      head.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
    });
    card.querySelector('.dt-entry-start').addEventListener('click', startDongtian);
    return true;
  }

  function cleanupWhenReady() {
    const actual = document.getElementById('dongtian-card');
    if (actual) document.getElementById(ENTRY_ID)?.remove();
  }

  function boot() {
    mount();
    window.addEventListener('dongfu:settings-collapsible-ready', mount);
    window.addEventListener('dongtian:ready', cleanupWhenReady);
    window.addEventListener('xiuxian:user-ready', mount);
    new MutationObserver(() => {
      cleanupWhenReady();
      if (!document.getElementById('dongtian-card') && !document.getElementById(ENTRY_ID)) mount();
    }).observe(document.body, { childList: true, subtree: true });
  }

  window.openDongtianFallback = startDongtian;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

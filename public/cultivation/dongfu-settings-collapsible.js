// 洞府設定頁：將個人資料、範圍設定與能力分析整理成可收合的一行式卡片。
(function () {
  'use strict';

  const STORAGE_KEY = 'dongfuSettingsCollapseV1';
  const sections = new Map();

  const css = `
    .dongfu-collapse-card{padding:0!important;overflow:hidden!important}
    .dongfu-collapse-head{position:relative;z-index:2;width:100%;min-height:56px;display:grid;grid-template-columns:34px minmax(0,1fr) 28px;align-items:center;gap:10px;padding:10px 14px;border:0;background:linear-gradient(90deg,rgba(216,177,93,.055),rgba(255,255,255,.012));color:inherit;text-align:left;cursor:pointer;transition:.18s ease}
    .dongfu-collapse-head:hover{background:linear-gradient(90deg,rgba(216,177,93,.095),rgba(255,255,255,.018))}
    .dongfu-collapse-icon{width:32px;height:32px;display:grid;place-items:center;border-radius:11px;border:1px solid rgba(216,177,93,.18);background:rgba(216,177,93,.055);color:#d8b15d;font-size:13px}
    .dongfu-collapse-copy{min-width:0;display:flex;align-items:center;gap:9px}
    .dongfu-collapse-title{flex:0 0 auto;color:#f0e2c2;font-size:12px;font-weight:900;letter-spacing:.06em}
    .dongfu-collapse-summary{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#827761;font-size:9px;font-weight:700}
    .dongfu-collapse-chevron{display:grid;place-items:center;color:#8f8063;font-size:10px;transition:transform .2s ease,color .2s ease}
    .dongfu-collapse-head[aria-expanded="true"] .dongfu-collapse-chevron{transform:rotate(180deg);color:#d8b15d}
    .dongfu-collapse-body{position:relative;z-index:1;padding:4px 18px 18px}
    .dongfu-collapse-body[hidden]{display:none!important}
    .dongfu-scope-card .dongfu-collapse-body{padding-top:2px}
    .dongfu-scope-content{padding-top:0!important;margin-top:0!important;border-top:0!important}
    .dongfu-analysis-card .dongfu-collapse-body{padding-top:2px}
    .dongfu-collapse-card.is-collapsed{margin-bottom:8px!important}
    .dongfu-collapse-card:not(.is-collapsed){margin-bottom:16px!important}
    @media(max-width:560px){.dongfu-collapse-head{grid-template-columns:31px minmax(0,1fr) 24px;gap:8px;padding:9px 11px;min-height:52px}.dongfu-collapse-icon{width:29px;height:29px;border-radius:10px}.dongfu-collapse-copy{gap:7px}.dongfu-collapse-title{font-size:11px}.dongfu-collapse-summary{font-size:8px}.dongfu-collapse-body{padding:3px 12px 15px}}
  `;

  function ensureStyle() {
    if (document.getElementById('dongfu-collapsible-style')) return;
    const style = document.createElement('style');
    style.id = 'dongfu-collapsible-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function readSaved() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }

  function saveState() {
    try {
      const value = {};
      sections.forEach((entry, key) => { value[key] = entry.body.hidden; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (_) {}
  }

  function setCollapsed(key, collapsed, persist = true) {
    const entry = sections.get(key);
    if (!entry) return false;
    entry.body.hidden = !!collapsed;
    entry.card.classList.toggle('is-collapsed', !!collapsed);
    entry.button.setAttribute('aria-expanded', String(!collapsed));
    if (persist) saveState();
    return true;
  }

  function makeHeader(card, key, icon, title, summary) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dongfu-collapse-head';
    button.dataset.dongfuSection = key;
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = `<span class="dongfu-collapse-icon"><i class="fa-solid ${icon}"></i></span><span class="dongfu-collapse-copy"><span class="dongfu-collapse-title">${title}</span><span class="dongfu-collapse-summary">${summary}</span></span><span class="dongfu-collapse-chevron"><i class="fa-solid fa-chevron-down"></i></span>`;
    card.prepend(button);
    return button;
  }

  function registerCard(key, card, body, config) {
    card.classList.add('dongfu-collapse-card', config.className || '');
    card.classList.remove('p-6', 'p-5');
    body.classList.add('dongfu-collapse-body');
    const button = makeHeader(card, key, config.icon, config.title, config.summary);
    sections.set(key, { card, body, button });
    button.addEventListener('click', () => setCollapsed(key, !body.hidden, true));
  }

  function mount() {
    ensureStyle();
    const page = document.getElementById('page-settings');
    if (!page || page.dataset.dongfuCollapsible === '1') return false;

    const profilePanel = [...page.children].find((node) => node.classList?.contains('glass-panel') && node.querySelector?.('#set-display-name'));
    const analysisPanel = [...page.children].find((node) => node.classList?.contains('glass-panel') && node.querySelector?.('#knowledgeChart'));
    const sourceMode = document.getElementById('set-source-mode');
    const profileStack = profilePanel?.querySelector('.space-y-4');
    if (!profilePanel || !analysisPanel || !sourceMode || !profileStack) return false;

    const scopeBlock = sourceMode.closest('.pt-2') || sourceMode.parentElement;
    if (!scopeBlock || !profileStack.contains(scopeBlock)) return false;
    scopeBlock.remove();
    scopeBlock.classList.add('dongfu-scope-content');
    scopeBlock.classList.remove('pt-2', 'border-t', 'border-white/5', 'mt-2');

    const profileBody = document.createElement('div');
    profileBody.id = 'dongfu-profile-body';
    profileStack.replaceWith(profileBody);
    profileBody.appendChild(profileStack);
    registerCard('profile', profilePanel, profileBody, {
      icon: 'fa-user-astronaut', title: '個人資料', summary: '名稱、程度、強弱科與難度', className: 'dongfu-profile-card'
    });

    const scopeCard = document.createElement('section');
    scopeCard.id = 'dongfu-scope-card';
    scopeCard.className = 'glass-panel rounded-2xl mb-6 relative overflow-hidden dongfu-scope-card';
    const scopeBody = document.createElement('div');
    scopeBody.id = 'dongfu-scope-body';
    scopeBody.appendChild(scopeBlock);
    scopeCard.appendChild(scopeBody);
    analysisPanel.before(scopeCard);
    registerCard('scope', scopeCard, scopeBody, {
      icon: 'fa-bullseye', title: '範圍設定', summary: '綜合題目、指定題庫與專注練習', className: 'dongfu-scope-card'
    });

    const oldAnalysisTitle = analysisPanel.querySelector('h3');
    oldAnalysisTitle?.remove();
    const analysisBody = document.createElement('div');
    analysisBody.id = 'dongfu-analysis-body';
    [...analysisPanel.children].forEach((child) => analysisBody.appendChild(child));
    analysisPanel.appendChild(analysisBody);
    registerCard('analysis', analysisPanel, analysisBody, {
      icon: 'fa-chart-radar', title: '能力分析圖譜', summary: '近期答題正確率與科目能力', className: 'dongfu-analysis-card'
    });

    const saved = readSaved();
    ['profile', 'scope', 'analysis'].forEach((key) => setCollapsed(key, saved[key] !== undefined ? !!saved[key] : true, false));
    page.dataset.dongfuCollapsible = '1';
    window.dispatchEvent(new CustomEvent('dongfu:settings-collapsible-ready'));
    return true;
  }

  window.openDongfuSettingsSection = function (key, options = {}) {
    if (!sections.size) mount();
    const opened = setCollapsed(key, false, options.persist === true);
    const entry = sections.get(key);
    if (opened && options.scroll !== false) entry?.button?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    return opened;
  };

  window.closeDongfuSettingsSection = function (key) {
    if (!sections.size) mount();
    return setCollapsed(key, true, true);
  };

  function boot() {
    mount();
    const observer = new MutationObserver(() => { if (!document.getElementById('page-settings')?.dataset?.dongfuCollapsible) mount(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

from pathlib import Path

module = r'''// 洞府設定頁：將個人資料、範圍設定與能力分析整理成可收合的一行式卡片。
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
'''

Path('public/cultivation/dongfu-settings-collapsible.js').write_text(module)

main_path = Path('public/main.js')
main = main_path.read_text()
needle = "  './cultivation/cultivation-rank-sync.js',\n  './cultivation/newbie-tutorial-v2.js',"
replacement = "  './cultivation/cultivation-rank-sync.js',\n  './cultivation/dongfu-settings-collapsible.js',\n  './cultivation/newbie-tutorial-v2.js',"
if "./cultivation/dongfu-settings-collapsible.js" not in main:
    if needle not in main:
        raise SystemExit('main module insertion point not found')
    main = main.replace(needle, replacement, 1)
    main_path.write_text(main)

tutorial_path = Path('public/cultivation/newbie-tutorial-v2.js')
tutorial = tutorial_path.read_text()
tutorial = tutorial.replace(
    "page: 'page-settings', target: '#set-source-mode', kicker: '第九步 · 範圍選擇', title: '決定題目從哪裡來',\n      body: '在洞府的「出題模式」可以控制範圍：<strong>綜合題目</strong>適合日常練習；<strong>指定題庫</strong>可以鎖定特定題庫；<strong>專注練習</strong>只練你挑選的內容。',",
    "page: 'page-settings', target: '#set-source-mode', settingsSection: 'scope', kicker: '第九步 · 範圍選擇', title: '展開「範圍設定」決定題目從哪裡來',\n      body: '洞府現在把出題來源獨立放在可收合的<strong>範圍設定</strong>。展開後可選：<strong>綜合題目</strong>、<strong>指定題庫</strong>或<strong>專注練習</strong>。',"
)
tutorial = tutorial.replace(
    "page: 'page-settings', target: '#set-difficulty', kicker: '第十步 · 難度', title: '再選擇題目難度',\n      body: '難度可以交給 AI AUTO 自動調整，也可以固定為簡單、中等或困難。範圍決定「考什麼」，難度決定「考多深」。',",
    "page: 'page-settings', target: '#set-difficulty', settingsSection: 'profile', kicker: '第十步 · 難度', title: '展開「個人資料」調整難度',\n      body: '洞府的<strong>個人資料</strong>收合區保留程度、強弱科與難度設定。難度可以交給 AI AUTO 自動調整，也可以固定為簡單、中等或困難。',"
)
render_needle = "    const step=steps[index];\n    navigate(step.page);\n    if (step.demo) installExampleQuiz(); else cleanupExampleQuiz();"
render_replacement = "    const step=steps[index];\n    navigate(step.page);\n    if (step.settingsSection && typeof window.openDongfuSettingsSection === 'function') {\n      window.openDongfuSettingsSection(step.settingsSection, { scroll: false, persist: false });\n    }\n    if (step.demo) installExampleQuiz(); else cleanupExampleQuiz();"
if "step.settingsSection && typeof window.openDongfuSettingsSection" not in tutorial:
    if render_needle not in tutorial:
        raise SystemExit('tutorial render insertion point not found')
    tutorial = tutorial.replace(render_needle, render_replacement, 1)
tutorial_path.write_text(tutorial)

test = r'''const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const moduleSource = readFileSync(join(root, 'public/cultivation/dongfu-settings-collapsible.js'), 'utf8');
const mainSource = readFileSync(join(root, 'public/main.js'), 'utf8');
const tutorialSource = readFileSync(join(root, 'public/cultivation/newbie-tutorial-v2.js'), 'utf8');

test('Dongfu settings are split into three collapsible one-line sections without changing field ids', () => {
  assert.match(moduleSource, /title: '個人資料'/);
  assert.match(moduleSource, /title: '範圍設定'/);
  assert.match(moduleSource, /title: '能力分析圖譜'/);
  assert.match(moduleSource, /getElementById\('set-source-mode'\)/);
  assert.match(moduleSource, /querySelector\?\.\('#set-display-name'\)/);
  assert.match(moduleSource, /querySelector\?\.\('#knowledgeChart'\)/);
  assert.match(moduleSource, /dongfu-collapse-summary/);
  assert.match(moduleSource, /dongfu-collapse-body\[hidden\]\{display:none!important\}/);
});

test('Dongfu collapsible controller exposes section opening for tutorials and future navigation', () => {
  assert.match(moduleSource, /window\.openDongfuSettingsSection/);
  assert.match(moduleSource, /setCollapsed\(key, false/);
  assert.match(moduleSource, /STORAGE_KEY = 'dongfuSettingsCollapseV1'/);
});

test('newbie tutorial opens the affected Dongfu section before spotlighting settings', () => {
  assert.match(tutorialSource, /target: '#set-source-mode', settingsSection: 'scope'/);
  assert.match(tutorialSource, /target: '#set-difficulty', settingsSection: 'profile'/);
  assert.match(tutorialSource, /window\.openDongfuSettingsSection\(step\.settingsSection/);
  const dongfuIndex = mainSource.indexOf("'./cultivation/dongfu-settings-collapsible.js'");
  const tutorialIndex = mainSource.indexOf("'./cultivation/newbie-tutorial-v2.js'");
  assert.ok(dongfuIndex >= 0 && tutorialIndex > dongfuIndex, 'Dongfu collapse module must load before newbie tutorial');
});
'''
Path('tests/dongfu-settings-collapsible.test.cjs').write_text(test)

const test = require('node:test');
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

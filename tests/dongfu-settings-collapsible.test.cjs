const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const moduleSource = readFileSync(join(root, 'public/cultivation/dongfu-settings-collapsible.js'), 'utf8');
const mainSource = readFileSync(join(root, 'public/main.js'), 'utf8');

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
  assert.doesNotMatch(moduleSource, /localStorage\.(?:getItem|setItem)/);
  assert.match(moduleSource, /localStorage\.removeItem\(key\)/);
  assert.match(moduleSource, /if \(wasActive && !active\) resetSections\(\)/);
});



test('scope settings has its own save control using existing profile persistence and visible button feedback', () => {
  const legacySource = readFileSync(join(root, 'public/main-legacy.js'), 'utf8');
  const indexSource = readFileSync(join(root, 'public/index.html'), 'utf8');
  const identitySource = readFileSync(join(root, 'public/cultivation/identity-system.js'), 'utf8');

  assert.match(moduleSource,/scopeBody\.appendChild\(scopeBlock\)/);
  assert.match(moduleSource,/scopeSave\.id = 'dongfu-scope-save'/);
  assert.match(moduleSource,/scopeSave\.textContent = '儲存出題範圍'/);
  assert.match(moduleSource,/scopeSave\.setAttribute\('onclick', 'saveProfile\(this\)'\)/);
  assert.ok(moduleSource.indexOf('scopeBody.appendChild(scopeSave)') >
    moduleSource.indexOf('scopeBody.appendChild(scopeBlock)'));
  assert.ok(moduleSource.indexOf('scopeBody.appendChild(scopeSave)') <
    moduleSource.indexOf('scopeCard.appendChild(scopeBody)'));
  assert.match(legacySource,/window\.saveProfile = async \(triggerButton = null\)/);
  assert.match(legacySource,/triggerButton\?\.matches\?\.\('button'\)/);
  assert.match(legacySource,/btn\.id === 'dongfu-scope-save' \? '儲存出題範圍'/);
  assert.match(legacySource,/"gameSettings": newSettings/);
  assert.match(identitySource,/await baseSaveProfile\.apply\(this, args\)/);
  assert.match(indexSource,/onclick="saveProfile\(\)"/,'original profile save stays available');

  const vm = require('node:vm');
  assert.doesNotThrow(()=>new vm.Script(moduleSource));
});

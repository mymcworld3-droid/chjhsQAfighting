const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const base = join(__dirname, '../public');
const read = name => readFileSync(join(base,name),'utf8');
const studio = read('cultivation/scope-fullscreen.js');
const css = read('styles/curriculum-studio.css');
const selector = read('cultivation/curriculum-scope.js');
const dongfu = read('cultivation/dongfu-settings-collapsible.js');
const legacy = read('main-legacy.js');
const guard = read('cultivation/identity-system.js');
const boot = read('main.js');

test('full-screen scope is loaded after the original curriculum and Dongfu controllers', () => {
  for (const file of ['cultivation/scope-fullscreen.js','cultivation/curriculum-scope.js',
    'cultivation/dongfu-settings-collapsible.js']) {
    assert.ok(existsSync(join(base,file)));
    execFileSync(process.execPath,['--check',join(base,file)]);
  }
  assert.ok(boot.indexOf("'./cultivation/curriculum-scope.js'") < boot.indexOf("'./cultivation/dongfu-settings-collapsible.js'"));
  assert.ok(boot.indexOf("'./cultivation/dongfu-settings-collapsible.js'") < boot.indexOf("'./cultivation/scope-fullscreen.js'"));
  assert.match(dongfu,/window.openCurriculumStudio\(\)/);
});

test('studio is a viewport-sized accessible dialog with desktop panels and mobile tabs', () => {
  assert.match(studio,/studio\.setAttribute\('role', 'dialog'\)/);
  assert.match(studio,/studio\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(studio,/studio\.dataset\.view = 'course'/);
  assert.match(studio,/id="ss-picker-body"/);
  assert.match(studio,/id="ss-cart-body"/);
  assert.match(studio,/setView\('cart'\)/);
  assert.match(css,/#scope-studio\{[^}]*position:fixed!important;inset:0!important/);
  assert.match(css,/height:100dvh;max-height:100dvh/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.match(css,/#scope-studio\[data-view=course\] \.ss-cart/);
  assert.match(css,/#scope-studio\[data-view=cart\] \.ss-picker/);
  assert.match(css,/safe-area-inset-bottom/);
});

test('course studio starts immediately at the course navigation with no oversized hero', () => {
  assert.doesNotMatch(studio, /選定所學，逐章突破|按年級、科目與學期安排複習/);
  assert.doesNotMatch(studio, /class="ss-hero"|id="ss-selected-count"|id="ss-subject-count"/);
  assert.doesNotMatch(css, /\.ss-hero|\.ss-stats?|\.ss-kicker/);
  assert.match(studio, /<nav class="ss-tabs"/);
  assert.match(studio, /id="ss-picker-body"/);
  assert.match(studio, /id="ss-cart-body"/);
});

test('selection summary stays below the scrollable study cart while save feedback remains accessible', () => {
  const cartStart = studio.indexOf('<aside class="ss-cart"');
  const cartEnd = studio.indexOf('</aside>', cartStart);
  const summary = studio.indexOf('<div class="ss-foot-summary"', cartStart);
  const cartBodyEnd = studio.indexOf('</div>', studio.indexOf('id="ss-cart-body"', cartStart));
  const footer = studio.indexOf('<footer class="ss-foot">');
  assert.ok(cartStart > 0 && cartStart < cartBodyEnd && cartBodyEnd < summary && summary < cartEnd && cartEnd < footer);
  assert.ok(studio.indexOf('id="ss-footer-main"') > summary);
  assert.ok(studio.indexOf('id="ss-footer-sub"') > summary);
  assert.ok(studio.indexOf('id="ss-feedback"') > footer, 'save errors remain visible on the course tab');
  assert.ok(studio.indexOf('id="ss-foot-actions"') > footer);
  assert.match(css, /\.ss-cart-body\{flex:1;min-height:0;overflow:auto/);
  assert.match(css, /\.ss-foot-summary\{flex:0 0 auto;/);
  assert.match(css, /#ss-feedback:empty\{display:none\}/);
  assert.match(studio, /if \(foot\) foot\.textContent = changed\(\)/);
});

test('selected-scope pane has no empty-state card but preserves the live list and summary', () => {
  assert.doesNotMatch(studio, /ss-cart-placeholder|ss-cart-empty|還沒有選定範圍|從左側選一個章節開始吧/);
  assert.doesNotMatch(css, /ss-cart-empty/);
  assert.match(studio, /id="ss-cart-body"/);
  assert.match(studio, /\$\('ss-cart-body'\)\.append\(cartSource\)/);
  assert.match(studio, /id="ss-selection-count"/);
  assert.match(studio, /function updateSummary\(\)/);
  assert.match(studio, /const selected = units\(\)/);
});

test('Dongfu scope tile opens the dialog immediately, never exposing its old dropdown', () => {
  assert.match(dongfu, /if \(key === 'scope'\) \{/);
  assert.match(dongfu, /button\.addEventListener\('click', \(\) => window\.openCurriculumStudio\?\.\(\)\)/);
  assert.match(dongfu, /button\.setAttribute\('aria-haspopup', 'dialog'\)/);
  assert.match(dongfu, /setCollapsed\('scope', true, false\)/);
  assert.match(dongfu, /\.dongfu-scope-card \.dongfu-collapse-body\{display:none!important\}/);
  assert.doesNotMatch(studio, /ss-launch-preview|ss-launch-button|const preview =/);
  assert.doesNotMatch(css, /ss-launch-preview/);
});

test('full-screen studio reparents original selectors and persistent selected list without duplicating IDs', () => {
  assert.match(studio,/\$\('ss-picker-body'\)\.append\(block\)/);
  assert.match(studio,/\$\('ss-cart-body'\)\.append\(cartSource\)/);
  assert.match(studio,/scopeBody\.prepend\(block\)/);
  assert.match(studio,/window\.renderSelectedUnitsList = wrapped/);
  assert.match(studio,/const result = await window\.saveProfile\?\.\(saveButton\)/);
  assert.match(studio,/if \(result !== true\)/);
  assert.match(studio,/window\.confirm\('/);
  assert.match(studio,/window\.soloSelectedUnits = clone\(JSON\.parse\(baseline\.units\)\)/);
  assert.match(legacy,/return true;\s*\};\s*async function switchToAI/);
  assert.match(guard,/const persisted = await baseSaveProfile\.apply\(this, args\)/);
  assert.match(guard,/if \(persisted !== true\)/);
});

test('chapter/topic picks survive filtered rerenders and remain limited to the same saved contract', () => {
  assert.match(selector,/const draft=new Set\(\)/);
  assert.match(selector,/c\.checked=draft\.has\('c:'\+i\)/);
  assert.match(selector,/box\.checked=draft\.has\('t:'\+i\+':'\+j\)/);
  assert.match(selector,/const groups=\[\.\.\.draft\]/);
  assert.match(selector,/draft\.clear\(\);display\(\)/);
  assert.match(selector,/focusedUnits|sub_topics/);
  assert.match(selector,/elementary_school_unit_name/);
  assert.match(selector,/high_school_unit_name/);
});

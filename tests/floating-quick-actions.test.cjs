const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const index = readFileSync(join(__dirname, '../public/index.html'), 'utf8');
const tutorial = readFileSync(join(__dirname, '../public/cultivation/newbie-tutorial-v2.js'), 'utf8');

test('original solo and duel launchers float above, not inside, the bottom nav grid', () => {
  const home = index.slice(index.indexOf('<div id="page-home"'), index.indexOf('<div id="page-training"'));
  const nav = index.slice(index.indexOf('<nav id="bottom-nav"'), index.indexOf('<div id="toast-container"'));
  assert.doesNotMatch(home, /id="btn-home-start"|startBattleMatchmaking\(\)/);
  assert.match(nav, /<div class="xiuxian-quick-actions" aria-label="修行快捷入口">/);
  assert.ok(nav.indexOf('xiuxian-quick-actions" aria-label') < nav.indexOf('class="glass-capsule'));
  assert.ok(nav.indexOf('id="btn-home-start"') < nav.indexOf('id="nav-grid"'));
  assert.ok(nav.indexOf('id="btn-home-pvp"') < nav.indexOf('id="nav-grid"'));
  assert.equal((index.match(/id="btn-home-start"/g) || []).length, 1);
  assert.equal((index.match(/id="btn-home-pvp"/g) || []).length, 1);
  assert.match(nav, /id="btn-home-start"[^>]*onclick="startQuizFlow\(\)"/);
  assert.match(nav, /id="btn-home-pvp"[^>]*onclick="startBattleMatchmaking\(\)"/);
  assert.match(tutorial, /target: '#btn-home-start'/);
});

test('floating launchers reserve content room without covering battle, question, or mobile nav', () => {
  assert.match(index, /#bottom-nav>\.xiuxian-quick-actions\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(index, /width:100vw;max-width:none;box-sizing:border-box/);
  assert.match(index, /margin:0 0 10px 50%;transform:translateX\(-50%\)/);
  assert.match(index, /padding-inline:max\(8px,env\(safe-area-inset-left\)\) max\(8px,env\(safe-area-inset-right\)\)/);
  assert.doesNotMatch(index, /width:min\(560px,100%\);margin:0 auto 10px/);
  assert.match(index, /#bottom-nav>\.xiuxian-quick-actions>button\{[\s\S]*?min-height:62px/);
  assert.match(index, /@media\(max-width:420px\)\{[\s\S]*?#bottom-nav>\.xiuxian-quick-actions>button\{gap:6px;min-height:54px/);
  assert.match(index, /#bottom-nav>\.xiuxian-quick-actions\{\s*display:none/);
  assert.match(index, /body:has\(#page-home\.active-page\) #bottom-nav>\.xiuxian-quick-actions\{display:grid\}/);
  assert.match(index, /body\.xianxia-theme main\{padding-bottom:116px\}/);
  assert.match(index, /body\.xianxia-theme:has\(#page-home\.active-page\) main\{padding-bottom:208px\}/);
});

test('wide screens place home-only launchers at both sides of the centered navigation', () => {
  assert.match(index, /@media\(min-width:1100px\)\{/);
  assert.match(index, /position:absolute;bottom:0;left:50%/);
  assert.match(index, /width:100vw;height:72px;margin:0/);
  assert.match(index, /column-gap:calc\(560px \+ 24px\)/);
  assert.match(index, /pointer-events:none/);
  assert.match(index, /#bottom-nav>\.xiuxian-quick-actions>button\{width:100%;min-height:72px;pointer-events:auto\}/);
  assert.match(index, /@media\(min-width:1100px\)\{\s*body\.xianxia-theme:has\(#page-home\.active-page\) main\{padding-bottom:116px\}/);
});

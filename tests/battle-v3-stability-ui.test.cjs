const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const fix = read('public/cultivation/battle-v3-stability-ui.js');
const battle = read('public/cultivation/battle-mode-v2.js');
const server = read('server.js');
const main = read('public/main.js');

test('battle quiz compatibility bridges the shared correct/wrong API schema to opts/ans', () => {
  assert.match(server, /"correct": "正確選項"/);
  assert.match(server, /"wrong": \["錯誤1", "錯誤2", "錯誤3"\]/);
  assert.match(battle, /Array\.isArray\(source\.opts\)/);
  assert.match(battle, /source\.ans \?\? source\.answer \?\? source\.correctIndex/);
  assert.match(fix, /const correct = raw\.correct/);
  assert.match(fix, /const wrong = Array\.isArray\(raw\.wrong\)/);
  assert.match(fix, /return \{ \.\.\.raw, opts, options: opts, ans, correctIndex: ans \}/);
  assert.match(fix, /shuffle\(choices\)/);
});

test('battle stability layer preserves the original payload while enriching generate-quiz responses', () => {
  assert.match(fix, /url\.includes\('\/api\/generate-quiz'\)/);
  assert.match(fix, /response\.clone\(\)\.json\(\)/);
  assert.match(fix, /return \{ \.\.\.payload, text: JSON\.stringify\(enrichQuestion\(parsed\)\) \}/);
  assert.match(fix, /const enriched = enrichPayload\(payload\)/);
  assert.doesNotMatch(fix, /\/api\/generate-battle-quiz/);
});

test('battle opens as a true fullscreen viewport with separate arena and quiz scenes', () => {
  assert.match(fix, /#page-battle\.battle-v2-page\{/);
  assert.match(fix, /position:fixed!important;inset:0!important/);
  assert.match(fix, /width:100vw!important;height:100dvh!important/);
  assert.match(fix, /z-index:15000!important/);
  assert.match(fix, /grid-template-areas:'score' 'rule' 'cue' 'log'/);
  assert.match(fix, /#page-battle \.bv2-quiz:not\(\.hidden\)/);
  assert.match(fix, /@media\(max-width:900px\)/);
  assert.match(fix, /grid-template-rows:auto auto minmax\(160px,1fr\) auto/);
});

test('all five battle phases have a higher-specificity hidden rule than arena and result displays', () => {
  assert.match(fix, /#page-battle\.battle-v2-page #bv2-lobby\.hidden/);
  assert.match(fix, /#page-battle\.battle-v2-page #bv2-intro\.hidden/);
  assert.match(fix, /#page-battle\.battle-v2-page #bv2-arena\.hidden/);
  assert.match(fix, /#page-battle\.battle-v2-page #bv2-quiz\.hidden/);
  assert.match(fix, /#page-battle\.battle-v2-page #bv2-result\.hidden\{display:none!important/);
  assert.match(fix, /#page-battle \.bv2-arena:not\(\.hidden\)\{/);
  assert.match(fix, /#page-battle \.bv2-result:not\(\.hidden\)\{/);
  assert.doesNotMatch(fix, /#page-battle \.bv2-arena\{[^}]*display:grid!important/);
  assert.doesNotMatch(fix, /#page-battle \.bv2-result\{display:flex/);
});

test('fullscreen body lock follows page-battle visibility and is released when hidden', () => {
  assert.match(fix, /battle-v3-fullscreen-active/);
  assert.match(fix, /!page\.classList\.contains\('hidden'\)/);
  assert.match(fix, /document\.documentElement\.classList\.toggle\(ACTIVE_CLASS, active\)/);
  assert.match(fix, /document\.body\?\.classList\.toggle\(ACTIVE_CLASS, active\)/);
  assert.match(fix, /attributeFilter: \['class'\]/);
});

test('battle stability layer loads before battle-mode-v2', () => {
  const fixIndex = main.indexOf("'./cultivation/battle-v3-stability-ui.js'");
  const battleIndex = main.indexOf("'./cultivation/battle-mode-v2.js'");
  assert.ok(fixIndex >= 0);
  assert.ok(battleIndex > fixIndex);
});

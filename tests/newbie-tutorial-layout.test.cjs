const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

const fix = read('public/cultivation/newbie-tutorial-layout-fix.js');
const main = read('public/main.js');

test('newbie tutorial explanation card is dynamically positioned away from the spotlight', () => {
  assert.match(fix, /function positionTutorialCard\(\)/);
  assert.match(fix, /spot\.getBoundingClientRect\(\)/);
  assert.match(fix, /overlapArea/);
  assert.match(fix, /target\.bottom \+ GAP/);
  assert.match(fix, /target\.top - height - GAP/);
  assert.match(fix, /target\.right \+ GAP/);
  assert.match(fix, /target\.left - width - GAP/);
  assert.match(fix, /card\.style\.left/);
  assert.match(fix, /card\.style\.top/);
});

test('newbie tutorial layout guard removes fixed-bottom behavior and caps mobile card height', () => {
  assert.match(fix, /bottom:auto!important/);
  assert.match(fix, /transform:none!important/);
  assert.match(fix, /max-height:min\(46dvh,430px\)/);
  assert.match(fix, /@media\(max-width:640px\)/);
  assert.match(fix, /max-height:min\(38dvh,360px\)/);
});

test('newbie tutorial layout guard loads immediately after the base tutorial', () => {
  const tutorial = main.indexOf("'./cultivation/newbie-tutorial-v2.js'");
  const layout = main.indexOf("'./cultivation/newbie-tutorial-layout-fix.js'");
  const goldenCore = main.indexOf("'./cultivation/golden-core-tutorial.js'");
  assert.ok(tutorial >= 0);
  assert.ok(layout > tutorial);
  assert.ok(goldenCore > layout);
});

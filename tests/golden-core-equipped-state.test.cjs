const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const read = (name) => readFileSync(join(__dirname, '../public/cultivation', name), 'utf8');
const training = read('cultivation-training-v4.js');
const status = read('cultivation-status-panel.js');
const battle = read('golden-core-battle-effects.js');

test('washing keeps the actually equipped Golden Core separate from the candidate core', () => {
  assert.match(training, /equippedCore:\s*\{ \.\.\.core \}/);
  assert.match(training, /state\.core = fresh;[\s\S]*state\.equipped = false;/);
  assert.doesNotMatch(training, /state\.core = fresh;[\s\S]{0,160}state\.equippedCore\s*=\s*(?:null|fresh)/);
  assert.match(training, /state\.equippedCore = \{ \.\.\.state\.core \};[\s\S]*state\.equipped = true;/);
});

test('status, cultivation effects and battle effects use the equipped core, not a washed candidate', () => {
  assert.match(training, /window\.getEquippedGoldenCoreState\s*=\s*function/);
  assert.match(training, /const equippedCore = state\.equippedCore;/);
  assert.match(status, /window\.getEquippedGoldenCoreState\?\.\(\)/);
  assert.match(battle, /window\.getEquippedGoldenCoreState\?\.\(\)/);
});

test('pre-fix washed states are repaired once instead of leaving the status page empty forever', () => {
  assert.match(training, /raw\.equipped === false/);
  assert.match(training, /!Object\.prototype\.hasOwnProperty\.call\(raw, 'equippedCore'\)/);
  assert.match(training, /repairedLegacyWashState = true/);
});

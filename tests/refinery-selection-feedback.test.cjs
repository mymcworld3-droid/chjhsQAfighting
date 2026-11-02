'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/cultivation/cultivation-refinery-v2.js', 'utf8');
function feedback({ selected = ['artifact:sword', 'material:iron'], fragments = 50, key = {}, plan = {}, matching = [] } = {}) {
  const context = {
    selected,
    fragmentBalance: () => fragments,
    refinementKeyStatus: () => ({ enough: true, ...key }),
    window: { formatCultivationRefineryDuration: () => '1 分鐘' }
  };
  vm.createContext(context);
  const start = source.indexOf('  function selectionFeedback(');
  const end = source.indexOf('\n  function markup()', start);
  vm.runInContext(source.slice(start, end) + '\nthis.feedback = selectionFeedback;', context);
  return context.feedback({ valid: true, fragments: 20, refinementStage: 2, targetRealm: '金丹', ...plan }, matching);
}

test('empty and invalid selections explain the next action instead of advertising a new recipe', () => {
  assert.match(feedback({ selected: [] }).message, /先選本命法器/);
  const invalid = feedback({ plan: { valid: false, reason: '請加入一件材料' } });
  assert.equal(invalid.tone, 'error');
  assert.equal(invalid.message, '請加入一件材料');
  assert.match(feedback({ matching: [{ id: 'a' }, { id: 'b' }] }).message, /調整材料組合/);
});

test('missing upgrade stones and fragments both remain visible before spending', () => {
  const stone = feedback({ key: { enough: false, have: 1, need: 3, name: '三階升級石' } });
  assert.equal(stone.tone, 'error');
  assert.match(stone.message, /三階升級石 ×2/);
  const cost = feedback({ fragments: 7 });
  assert.equal(cost.tone, 'error');
  assert.match(cost.message, /還差 13/);
  assert.match(cost.message, /分解物品/);
});

test('ready feedback shows the actual stage, realm and waiting time for known and new combinations', () => {
  for (const matching of [[], [{ id: 'known' }]]) {
    const result = feedback({ matching, fragments: 20, plan: { refinementStage: 3 } });
    assert.equal(result.tone, 'ready');
    assert.match(result.prefix, /3 階精煉/);
    assert.match(result.message, /金丹.*1 分鐘/);
  }
});

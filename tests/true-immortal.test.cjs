const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/true-immortal.js'), 'utf8');
function setup() {
  const window = { getRealmUserUid: () => 'alice', dispatchEvent() {} };
  vm.runInNewContext(source, { window, Event });
  return window;
}
const realms = [{ name: '凡人' }, { name: '渡劫' }, { name: '半仙' }, { name: '真仙' }];
test('True Immortal requires both the 2588 threshold and an active named seat', () => {
  const w = setup();
  for (const listed of [false, true]) {
    w.setTrueImmortalBoard(listed ? [{ id: 'ru-xian', uid: 'alice' }] : []);
    for (const score of [0, 627, 1868, 629, 867, 2588, 9999]) {
      assert.equal(w.isTrueImmortal(score), listed && score >= 2588);
    }
  }
});
test('losing a seat, switching user and unavailable board revoke True Immortal', () => {
  const w = setup();
  w.setTrueImmortalBoard([{ id: 'ru-xian', uid: 'alice' }]);
  assert.equal(w.limitImmortalRank(3, 2588, realms), 3);
  assert.equal(w.limitImmortalRank(3, 2588, realms, 'bob'), 2);
  w.setTrueImmortalBoard([{ id: 'ru-xian', uid: 'bob' }]);
  assert.equal(w.limitImmortalRank(3, 9999, realms), 2);
  assert.equal(w.limitImmortalRank(0, 0, realms), 0);
  w.setTrueImmortalBoard([{ id: 'ru-xian', uid: 'alice' }], false);
  assert.equal(w.isTrueImmortal(9999), false);
});
test('unknown board records cannot grant True Immortal', () => {
  const w = setup();
  w.setTrueImmortalBoard([{ id: 'unknown', uid: 'alice' }]);
  assert.equal(w.isTrueImmortal(9999), false);
});

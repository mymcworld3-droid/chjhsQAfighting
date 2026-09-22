const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../public/cultivation/cultivation-status-panel.js'), 'utf8');

function statusStats(effects = []) {
  const sandbox = {
    window: {},
    document: { readyState: 'loading', addEventListener() {} },
    Intl
  };
  vm.runInNewContext(source, sandbox);
  const result = sandbox.window.getCultivationStatusStats(
    { hp: 1000, maxHp: 1000, attack: 200 },
    { effects }
  );
  return result.map(({ key, label, value, note }) => ({ key, label, value, note }));
}

test('status hides critical damage when no critical chance is equipped', () => {
  const stats = statusStats();
  assert.equal(stats.some(stat => stat.key === 'equip_crit_damage_percent'), false);
});

test('positive critical chance shows the full 150% base critical damage', () => {
  const stats = statusStats([{ type: 'equip_crit_chance', value: 0.15 }]);
  assert.equal(stats.find(stat => stat.key === 'equip_crit_chance').value, '15%');
  assert.deepEqual(stats.find(stat => stat.key === 'equip_crit_damage_percent'), {
    key: 'equip_crit_damage_percent', label: '暴擊傷害',
    value: '150%', note: '基礎暴擊傷害 150%'
  });
});

test('critical damage combines the base multiplier and all equipped bonuses', () => {
  const stats = statusStats([
    { type: 'equip_crit_chance', value: 0.10 },
    { type: 'equip_crit_chance', value: 0.10 },
    { type: 'equip_crit_damage_percent', value: 0.10 },
    { type: 'equip_crit_damage_percent', value: 0.20 }
  ]);
  assert.equal(stats.find(stat => stat.key === 'equip_crit_chance').value, '20%');
  assert.equal(stats.find(stat => stat.key === 'equip_crit_damage_percent').value, '180%');
  assert.equal(stats.find(stat => stat.key === 'equip_crit_damage_percent').note, '基礎 150% + 額外 30%');
  assert.equal(stats.filter(stat => stat.key === 'equip_crit_damage_percent').length, 1);
});

test('critical damage alone does not imply that an attack can critically hit', () => {
  const stats = statusStats([
    { type: 'equip_crit_chance', value: 0 },
    { type: 'equip_crit_damage_percent', value: 0.20 }
  ]);
  assert.equal(stats.some(stat => stat.key === 'equip_crit_damage_percent'), false);
});

test('critical chance display respects the same 75% cap as battle', () => {
  const stats = statusStats([
    { type: 'equip_crit_chance', value: 0.90 },
    { type: 'equip_crit_damage_percent', value: 0.20 }
  ]);
  assert.equal(stats.find(stat => stat.key === 'equip_crit_chance').value, '75%');
  assert.equal(stats.find(stat => stat.key === 'equip_crit_damage_percent').value, '170%');
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const DIFFICULTY = require('../public/cultivation/raid-difficulty.js');
const source = fs.readFileSync(require.resolve('../public/cultivation/raid-mode.js'), 'utf8');
function runtime({ score = 100, tickets = 3 } = {}) {
  const element = () => ({ dataset: {}, attributes: {}, textContent: '', disabled: false, classes: new Set(),
    classList: { toggle(key, active) { if (active) this.values.add(key); else this.values.delete(key); }, values: new Set() },
    setAttribute(key, value) { this.attributes[key] = value; } });
  const buttons = Object.keys(DIFFICULTY.TIERS).map(id => Object.assign(element(), { dataset: { raidDifficulty: id } }));
  const targets = new Map(['.raid-boss-art > span', '.raid-unlock-status', '.raid-reward-preview b', '.raid-reward-preview span'].map(selector => [selector, element()]));
  const properties = new Map();
  const picker = { style: { setProperty: (key, value) => properties.set(key, value) }, querySelectorAll: () => buttons };
  const actions = [element(), element()];
  const card = Object.assign(element(), { querySelector: selector => selector === '.raid-difficulty-picker' ? picker : targets.get(selector), querySelectorAll: () => actions });
  const input = { value: 'ABC234' };
  const hub = { querySelector: selector => selector === '[data-raid-theme]' ? card : input };
  let fitCalls = 0;
  const state = { selectedRaidId: 'shen-qingshuang', selectedDifficulty: 'normal', ticketState: { count: tickets }, roomId: null };
  const context = { DIFFICULTY, state, document: { getElementById: () => hub }, raidTrialById: () => ({ status: 'open' }), score: () => score, scheduleRaidHubFit: () => fitCalls++ };
  vm.runInNewContext(source.slice(source.indexOf('  function selectHubDifficulty('), source.indexOf('  function renderHub()')), context);
  return { select: context.selectHubDifficulty, state, card, picker, targets, buttons, actions, properties, input, fitCalls: () => fitCalls };
}
test('difficulty previews move the existing selection and update rewards and theme without rebuilding the hub', () => {
  const app = runtime();
  for (const [index, id] of ['normal', 'hard', 'extreme', 'normal'].entries()) {
    app.select(id);
    const tier = DIFFICULTY.get(id);
    assert.equal(app.state.selectedDifficulty, id);
    assert.equal(app.card.dataset.raidTheme, id);
    assert.equal(app.properties.get('--raid-selected-index'), Object.keys(DIFFICULTY.TIERS).indexOf(id));
    assert.equal(app.targets.get('.raid-reward-preview b').textContent, '通關必得 元嬰碎精 ×' + tier.fragments);
    assert.equal(app.targets.get('.raid-reward-preview span').textContent, tier.materialRealms.join('～') + '木鐵素材');
    assert.equal(app.buttons.filter(button => button.attributes['aria-pressed'] === 'true').length, 1);
    assert.equal(app.input.value, 'ABC234');
    assert.equal(app.fitCalls(), index + 1);
  }
});
test('locked tiers remain previewable but cannot start a room; returning to an unlocked tier restores entry', () => {
  const app = runtime({ score: 6 });
  app.select('extreme'); assert.equal(app.card.dataset.raidTheme, 'extreme');
  assert.ok(app.actions.every(button => button.disabled));
  assert.ok(app.card.classList.values.has('locked'));
  app.select('normal'); assert.ok(app.actions.every(button => !button.disabled));
  const empty = runtime({ tickets: 0 }); empty.select('normal'); assert.ok(empty.actions.every(button => button.disabled));
});
test('invalid choices and active rooms cannot change the selected difficulty', () => {
  const app = runtime(); app.select('invalid'); assert.equal(app.fitCalls(), 0);
  app.state.roomId = 'room12345'; app.select('extreme');
  assert.equal(app.state.selectedDifficulty, 'normal'); assert.equal(app.fitCalls(), 0);
});

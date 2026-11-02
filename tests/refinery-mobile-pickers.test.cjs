'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/cultivation/cultivation-refinery-v2.js', 'utf8');

function loadPickers() {
  const focus = [];
  const makeSummary = name => ({ tabIndex: 0, focus: options => focus.push({ name, ...options }) });
  const summaries = { artifacts: makeSummary('artifacts'), materials: makeSummary('materials') };
  const craft = makeSummary('craft');
  const nodes = Object.keys(summaries).map(kind => ({
    dataset: { refineryPicker: kind }, open: false,
    querySelector: () => summaries[kind]
  }));
  const content = { querySelector: selector => selector.includes('craft') ? craft
    : selector.includes('artifacts') ? summaries.artifacts : summaries.materials };
  const context = {
    selected: [], pickerOpen: '', pickerCompact: null, compact: true,
    parseToken: token => ({ type: token.split(':')[0] }),
    ingredientMeta: token => ({ name: token === 'artifact:sword' ? '逐風飛劍' : '九霄雷印' }),
    document: { querySelectorAll: () => nodes, getElementById: () => content }
  };
  context.window = { matchMedia: () => ({ matches: context.compact }) };
  vm.createContext(context);
  const start = source.indexOf('  function compactRefinery() {');
  const end = source.indexOf('\n  function markup()', start);
  vm.runInContext(source.slice(start, end), context);
  return { context, nodes, focus };
}

test('mobile pickers open one category at a time and return focus after choosing', () => {
  const { context, nodes, focus } = loadPickers();
  context.syncPickers(true);
  assert.deepEqual(nodes.map(node => node.open), [false, false]);
  context.showPicker('artifacts');
  assert.deepEqual(nodes.map(node => node.open), [true, false]);
  context.showPicker('materials');
  assert.deepEqual(nodes.map(node => node.open), [false, true]);
  context.showPicker('');
  assert.deepEqual(nodes.map(node => node.open), [false, false]);
  assert.deepEqual(focus.map(row => row.name), ['artifacts', 'materials', 'craft']);
  assert.ok(focus.every(row => row.preventScroll), 'focus must not move the narrow game canvas');
});

test('rotating to a wide layout expands both categories and restores the mobile choice on return', () => {
  const { context, nodes } = loadPickers();
  context.showPicker('materials');
  context.compact = false;
  context.syncPickers();
  assert.deepEqual(nodes.map(node => node.open), [true, true]);
  assert.ok(nodes.every(node => node.querySelector().tabIndex === -1));
  context.compact = true;
  context.syncPickers();
  assert.deepEqual(nodes.map(node => node.open), [false, true]);
  assert.ok(nodes.every(node => node.querySelector().tabIndex === 0));
});

test('collapsed summaries show selected names and material quantities after removal', () => {
  const { context } = loadPickers();
  assert.equal(context.pickerSummary('artifact'), '點選法器');
  assert.equal(context.pickerSummary('material'), '點選材料');
  context.selected = ['artifact:sword', 'material:iron', null, 'material:iron'];
  assert.equal(context.pickerSummary('artifact'), '逐風飛劍');
  assert.equal(context.pickerSummary('material'), '已選 2 件');
  context.selected[1] = null;
  assert.equal(context.pickerSummary('material'), '已選 1 件');
});

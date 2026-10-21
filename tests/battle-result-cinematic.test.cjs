'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'public', rel), 'utf8');
const formal = read('cultivation/battle-mode-v2.js');
const stylesheet = read('styles/battle-mode-v2.css');
const main = read('main.js');
const index = read('index.html');

test('formal duel finale is a separate outcome-aware scene with both fighters', () => {
  const markup = formal.slice(formal.indexOf('<section id="bv2-result"'), formal.indexOf('</section>', formal.indexOf('<section id="bv2-result"')) + 10);
  for (const token of [
    'bv2-result-scene', 'bv2-result-landscape', 'bv2-result-beam', 'bv2-result-seal',
    "portraitMarkup('bv2-result-my-fighter')", "portraitMarkup('bv2-result-enemy-fighter')",
    'bv2-result-particles', 'bv2-result-emblem', 'bv2-result-stats', 'bv2-result-actions'
  ]) assert.ok(markup.includes(token), token);
  const result = formal.slice(formal.indexOf('  function renderResult(room) {'), formal.indexOf('  async function submitAnswer(', formal.indexOf('  function renderResult(room) {')));
  assert.match(result, /dataset\.outcome = isDraw \? 'draw' : won \? 'win' : 'loss'/);
  assert.match(result, /setPlayerPortrait\('bv2-result-my-fighter', mine, true\)/);
  assert.match(result, /setPlayerPortrait\('bv2-result-enemy-fighter', enemy\)/);
  assert.match(result, /recordBattleResult\(room\)/);
  assert.match(result, /'bv2-reward-status'/);
});

test('battle-result animation only restarts when battle identity changes', () => {
  const result = formal.slice(formal.indexOf('  function renderResult(room) {'), formal.indexOf('  async function submitAnswer(', formal.indexOf('  function renderResult(room) {')));
  assert.match(result, /resultScene\.dataset\.finaleKey !== finaleKey/);
  assert.match(result, /resultScene\.classList\.remove\('bv2-result-reveal'\)/);
  assert.match(result, /resultScene\.classList\.add\('bv2-result-reveal'\)/);
  assert.match(stylesheet, /\.bv2-result:not\(\.bv2-result-reveal\)/);
  assert.match(stylesheet, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(stylesheet, /@keyframes bv2FinalEmblem/);
  assert.match(stylesheet, /@keyframes bv2FinalSpark/);
  assert.match(stylesheet, /\.bv2-result\[data-outcome="loss"\]/);
  assert.match(stylesheet, /\.bv2-result\[data-outcome="draw"\]/);
});


test('result stylesheet and all runtime modules receive the new cache version', () => {
  assert.match(formal, /battle-mode-v2\.css\?v=20261006-combatflow1&duel=20261006-pregen1/);
  assert.match(main, /XIUXIAN_FEATURE_BUILD = '20261021-realm-hp100'/);
  assert.match(index, /main\.js\?v=20261013-arrival1/);
  assert.equal(stylesheet.split('{').length,stylesheet.split('}').length,'result stylesheet braces');

});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const full = read('public/cultivation/battle-v3-stability-ui.js');
const tutorial = read('public/cultivation/battle-tutorial.js');
const formal = read('public/cultivation/battle-mode-v2.js');
const main = read('public/main.js');
const index = read('public/index.html');
const viewport = full.slice(full.indexOf('/* Viewport-fit battle:'));
const training = tutorial.slice(tutorial.indexOf('/* The training arena shares the fixed viewport'));

test('formal stage uses rows corresponding to the actual combat elements', () => {
  assert.ok(viewport.length > 7000);
  assert.ok(viewport.includes("grid-template-areas:'enemy' 'round' 'stage' 'mine' 'rule' 'cue'!important"));
  for (const fragment of [
    '#page-battle #bv2-enemy-status{grid-area:enemy}',
    '#page-battle .bv2-stage-round{grid-area:round',
    'grid-area:stage;',
    '#page-battle #bv2-my-status{grid-area:mine}',
    'grid-area:rule;',
    'grid-area:cue;'
  ]) assert.ok(viewport.includes(fragment), fragment);
  for (const id of ['bv2-enemy-status', 'bv2-round', 'bv2-my-status', 'bv2-duel-cue']) {
    assert.ok(formal.includes('id="' + id + '"'), id);
  }
  for (const id of ['bv2-my-fighter', 'bv2-enemy-fighter']) {
    assert.ok(formal.includes("portraitMarkup('" + id + "')"), id);
  }
});

test('safe-area fullscreen keeps short stages visible and long content reachable', () => {
  for (const fragment of [
    'height:100dvh!important;min-height:0!important',
    'overflow:hidden!important;overscroll-behavior:none!important',
    'max(7px,env(safe-area-inset-bottom))',
    'grid-template-rows:auto auto minmax(110px,1fr) auto auto auto!important',
    'grid-template-rows:auto auto minmax(96px,1fr) auto auto auto!important',
    'overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain',
    'max-height:none!important;flex:0 0 auto;overflow:visible!important'
  ]) assert.ok(viewport.includes(fragment), fragment);
});

test('HP, names, core details and quiz actions retain their own space', () => {
  for (const fragment of [
    '#page-battle .bv2-status-panel .bv2-fighter-head',
    'font-variant-numeric:tabular-nums',
    'white-space:normal;overflow-wrap:anywhere',
    '#page-battle .bv2-arena .bv2-duel-cue',
    '#page-battle #bv2-review-continue',
    'grid-template-columns:minmax(0,1fr)!important'
  ]) assert.ok(viewport.includes(fragment), fragment);
  assert.ok(full.lastIndexOf("grid-template-areas:'enemy' 'round' 'stage' 'mine' 'rule' 'cue'!important")
    > full.indexOf("grid-template-areas:'score' 'rule' 'cue' 'log'!important"));
});

test('tutorial supports inner scroll fallback without clipping text', () => {
  for (const fragment of [
    'height:100%!important;min-height:0!important;flex:1',
    'overflow-x:hidden!important;overflow-y:auto!important',
    'min-height:0!important;max-width:1000px',
    'overflow-wrap:anywhere',
    'min-height:clamp(44px,6dvh,58px)'
  ]) assert.ok(training.includes(fragment), fragment);
});

test('CSS blocks are balanced and browser loads the new build', () => {
  const tick = String.fromCharCode(96);
  const ending = full.indexOf('    ' + tick + ';\n    document.head.appendChild(style);');
  const css = full.slice(full.indexOf('/* Viewport-fit battle:'), ending);
  const layer = String.fromCharCode(36, 123) + 'LAYER_ID}';
  const trainingEnd = tutorial.indexOf('      @media(prefers-reduced-motion:reduce){#' + layer + ' *{', tutorial.indexOf('/* The training arena shares the fixed viewport'));
  const tutorialCss = tutorial.slice(tutorial.indexOf('/* The training arena shares the fixed viewport'), trainingEnd);
  for (const text of [css, tutorialCss]) assert.equal(text.split('{').length, text.split('}').length);
  assert.ok(main.includes("XIUXIAN_FEATURE_BUILD = '20260922-core-status1'"));
  assert.ok(index.includes('main.js?v=20260922-core-status1'));
});

test('stage portraits keep the near-left and far-right duel depth in formal and tutorial battles', () => {
  const base = read('public/styles/battle-mode-v2.css');
  const formalMe = '#page-battle .bv2-stage-fighter.me{left:1%;bottom:-6%;width:49%;height:91%}';
  const formalEnemy = '#page-battle .bv2-stage-fighter.enemy{right:4%;bottom:21%;width:42%;height:73%}';
  assert.ok(base.includes('.bv2-stage-fighter.me{left:1%;bottom:-6%;width:49%;height:91%}'));
  assert.ok(base.includes('.bv2-stage-fighter.enemy{right:4%;bottom:21%;width:42%;height:73%}'));
  for (const token of [formalMe, formalEnemy]) assert.ok(full.includes(token), token);
  for (const token of [
    '#page-battle .bv2-stage-fighter.me{left:-4%;bottom:-6%;width:54%;height:84%}',
    '#page-battle .bv2-stage-fighter.enemy{right:-1%;bottom:23%;width:46%;height:67%}',
    '#${LAYER_ID} .bt-fighter.me{left:1%;bottom:-6%;width:49%;height:91%!important}',
    '#${LAYER_ID} .bt-fighter.enemy{right:4%;bottom:21%;width:42%;height:73%!important}',
    '#${LAYER_ID} .bt-fighter.me{left:-4%;bottom:-6%;width:54%!important;height:84%!important}',
    '#${LAYER_ID} .bt-fighter.enemy{right:-1%;bottom:23%;width:46%!important;height:67%!important}'
  ]) assert.ok((token.includes('bt-fighter') ? tutorial : full).includes(token), token);
  assert.ok(full.includes('left:72%;top:34%'), 'own attack impact targets the upper-right opponent');
  assert.ok(full.includes('left:28%;top:65%'), 'opponent attack impact targets the lower-left player');
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const full = read('public/cultivation/battle-v3-stability-ui.js');
const formal = read('public/cultivation/battle-mode-v2.js');
const main = read('public/main.js');
const index = read('public/index.html');
const viewport = full.slice(full.indexOf('/* Viewport-fit battle:'));

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
    'height:var(--battle-vv-height,100dvh)!important;min-height:0!important',
    'overflow:hidden!important;overscroll-behavior:none!important',
    'max(10px,env(safe-area-inset-bottom))',
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


test('CSS blocks are balanced and browser loads the new build', () => {
  const tick = String.fromCharCode(96);
  const ending = full.indexOf('    ' + tick + ';\n    document.head.appendChild(style);');
  const css = full.slice(full.indexOf('/* Viewport-fit battle:'), ending);
  assert.equal(css.split('{').length, css.split('}').length);
  assert.ok(main.includes("XIUXIAN_FEATURE_BUILD = '20261021-realm-hp100'"));
  assert.ok(main.includes("BATTLE_FEATURE_BUILD = '20261006-battle-join-fix1'"));
  assert.ok(index.includes('main.js?v=20261013-arrival1'));
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
  ]) assert.ok(full.includes(token), token);
  assert.ok(full.includes('left:72%;top:34%'), 'own attack impact targets the upper-right opponent');
  assert.ok(full.includes('left:28%;top:65%'), 'opponent attack impact targets the lower-left player');
});


test('battle runtime follows document dimensions and ignores visual viewport shrink and offsets', () => {
  const props=new Map(),root={clientWidth:1280,clientHeight:720};
  const page={style:{setProperty:(key,value)=>props.set(key,value)}};
  const context={window:{innerWidth:1440,innerHeight:900,visualViewport:{width:700,height:280,offsetTop:20,offsetLeft:30}},
    document:{documentElement:root,getElementById:()=>page}};
  const start=full.indexOf('  function syncBattlePageViewport()');
  const end=full.indexOf('  function scheduleBattlePageViewportSync()',start);
  vm.runInNewContext(full.slice(start,end)+'\nthis.sync=syncBattlePageViewport;',context);
  context.sync();
  assert.equal(props.get('width'),'1280px');assert.equal(props.get('height'),'720px');
  assert.equal(props.get('top'),'0px');assert.equal(props.get('left'),'0px');
  const before=[...props];Object.assign(context.window.visualViewport,{height:100,width:300,offsetTop:150});context.sync();
  assert.deepEqual([...props],before);
  root.clientWidth=360;root.clientHeight=640;context.sync();
  assert.equal(props.get('width'),'360px');assert.equal(props.get('height'),'640px');
  assert.match(full,/app:layout-viewport/);assert.doesNotMatch(full,/window\.visualViewport/);
  assert.doesNotMatch(viewport,/height:100dvh!important;min-height:100dvh!important/);
});

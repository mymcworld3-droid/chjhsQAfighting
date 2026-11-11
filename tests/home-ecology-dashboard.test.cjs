'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('public/index.html'),css=read('public/styles/home-ecology-dashboard.css');
const js=read('public/cultivation/home-ecology-dashboard.js');
const scenes=require('../public/cultivation/home-ecology-scenes.js');

test('sketch-style home displays avatar/progression above a true CG octagon on portrait',()=>{
  assert.match(html,/id="xiuxian-panel"/);
  assert.match(html,/id="home-ecology"/);
  assert.ok(html.indexOf('id="xiuxian-panel"')<html.indexOf('id="home-ecology"'));
  assert.match(html,/id="home-ecology-picture"/);
  assert.match(css,/clip-path:polygon\(23% 0,77% 0,100% 23%/);
  assert.match(css,/@media\(max-width:820px\)/);
  assert.match(css,/grid-template-areas:"realm" "ecology" "practice" "quest" "records"/);
  assert.match(css,/grid-template-columns:minmax\(260px,\.78fr\) minmax\(0,1\.38fr\)/);
});

test('left and right shortcuts point to existing live game actions, not decorative links',()=>{
  for(const action of ['path','rank','share','quest','meditation','raid','story']){
    assert.match(html,new RegExp('data-home-action="'+action+'"'));
    assert.match(js,new RegExp("case '"+action+"'"));
  }
  for(const id of ['quest-open','xiuxian-meditate','sect-raid-entry','xiuxian-path','story-archive-launcher','btn-home-start','btn-home-pvp']){
    assert.equal(html.split('id="'+id+'"').length-1,1,id+' is not duplicated');
  }
  assert.match(js,/startQuizFlow\?\.\(/);
  assert.match(js,/switchToPage\?\.\('page-social'\)/);
  assert.match(js,/openTrainingSceneMap\?\.\(/);
});

test('all habitat CG images really exist in the project assets and scene navigation cycles',()=>{
  assert.equal(scenes.SCENES.length,4);
  assert.equal(new Set(scenes.SCENES.map(s=>s.id)).size,4);
  for(const s of scenes.SCENES){
    for(const k of ['landscape','portrait']){
      assert.equal(fs.existsSync(path.join(root,'public',s[k])),true,s.id+':'+k);
    }
    assert.ok(s.name&&s.alt&&s.detail&&s.action);
  }
  assert.equal(scenes.next('sect').id,'courtyard');
  assert.equal(scenes.next('sect',-1).id,'mountain');
  assert.equal(scenes.next('mountain').id,'sect');
  assert.equal(scenes.forBattleMap('bamboo'),'bamboo');
  assert.equal(scenes.forBattleMap('ruins'),'mountain');
});

test('home CG remains only a view and cannot overwrite player combat or learning state',()=>{
  assert.doesNotMatch(js,/authenticatedMainFetch|\.set\(|\.update\(|stats\.gold\s*=|totalScore\s*=/);
  assert.match(js,/localStorage\.setItem\(key\(\),place\)/);
  assert.match(js,/xiuxian:user-data-ready/);
  assert.match(js,/MutationObserver/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  const list=read('public/main.js'),bank=read('ai-question-bank.cjs'),meditation=read('daily-meditation-api.cjs');
  assert.match(list,/\.\/cultivation\/home-ecology-dashboard\.js/);
  assert.ok(bank.length>100&&meditation.length>100);
});

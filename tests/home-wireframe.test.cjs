'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
const html=read('public/index.html');
const css=read('public/styles/home-wireframe.css');
const js=read('public/cultivation/home-wireframe.js');
const battle=read('public/cultivation/tactical-combat.js');
const Ecology=require('../public/cultivation/home-trial-ecology.js');
const Rules=require('../public/cultivation/tactical-rules.js');

test('homepage retains original player realm card, six shortcuts and main PvE action',()=>{
  assert.match(html,/id="xiuxian-panel"/);
  assert.match(html,/class="home-wireframe-rail is-left"/);
  assert.match(html,/class="home-wireframe-rail is-right"/);
  for(const action of ['path','rank','share','quest','meditation','raid']){
    assert.equal(html.split('data-home-action="'+action+'"').length-1,1,action);
    assert.match(js,new RegExp("case '"+action+"'"));
  }
  for(const id of ['quest-open','xiuxian-meditate','sect-raid-entry','xiuxian-path','btn-home-start','quest-spotlight']){
    assert.equal(html.split('id="'+id+'"').length-1,1,id);
  }
  assert.match(html,/id="btn-home-start"[^>]+onclick="startQuizFlow\(\)"/);
  assert.match(js,/window\.switchToPage\?\.\('page-social'\)/);
  assert.doesNotMatch(html,/id="btn-home-pvp"|>鬥法論道<|我的訂正進度|home-correction-panel|home-correction-meter|home-correction-open/);
  assert.doesNotMatch(css,/btn-home-pvp|home-correction-card/);
  assert.doesNotMatch(js,/home-correction-progress|home-correction-panel/);
});

test('three rectangular shortcuts are grouped into a single fixed floating rail per side',()=>{
  assert.match(css,/\.home-wireframe-rail\{[\s\S]*?position:fixed!important/);
  assert.match(css,/top:50%;transform:translateY\(-50%\)/);
  assert.match(css,/\.home-wireframe-rail\.is-left/);
  assert.match(css,/\.home-wireframe-rail\.is-right/);
  assert.match(css,/\.home-wireframe-shortcut\+\.home-wireframe-shortcut\{/);
  assert.match(css,/border-top:1px solid/);
  assert.match(css,/z-index:45/);
  assert.match(css,/max-height:calc\(100dvh - 160px\)/);
  assert.doesNotMatch(css,/clip-path:polygon/);
  assert.match(css,/@media\(max-width:850px\)/);
  assert.match(css,/visibility:hidden!important;pointer-events:none!important/);
});

test('cultivation card uses the exact current main scenic background treatment',()=>{
  assert.match(css,/background:#22251e!important/);
  assert.match(css,/linear-gradient\(90deg,rgba\(22,25,20,\.91\),rgba\(28,32,24,\.55\)\)/);
  assert.match(css,/var\(--xq-scene-art\) 62% center\/cover!important/);
  assert.match(css,/filter:saturate\(\.5\) sepia\(\.15\)!important;opacity:1!important/);
  assert.doesNotMatch(css,/xiuxian-panel::before\{background:none/);
});

test('large circle displays current question-trial terrain image instead of a realm emblem',()=>{
  assert.match(html,/id="home-trial-ecology-image"/);
  assert.match(html,/id="home-trial-ecology-name"/);
  assert.match(html,/id="home-trial-ecology-stage"/);
  assert.doesNotMatch(html,/home-disc-symbol|走入宗門|生態觀景/);
  assert.match(css,/\.home-realm-disc img\{/);
  assert.match(css,/object-fit:cover/);
  assert.match(js,/Ecology\.fromBattle\(data\.state\)/);
  assert.match(js,/Ecology\.fromProgress\(info,Tactical\)/);
  assert.match(battle,/xiuxian:tactical-trial-updated/);
  assert.match(battle,/detail:\{uid,trial:next\.trial,terrain:next\.terrain,map:next\.map\}/);
});

test('each of the five real game biomes resolves to existing CG art',()=>{
  const biomeToId={0:'bamboo',13:'desert',14:'snow',2:'water',16:'ruins'};
  for(const [terrain,id] of Object.entries(biomeToId)){
    const view=Ecology.fromBattle({mode:'pve',trial:{stage:7,title:'真實關卡地形'},terrain:Number(terrain),map:'courtyard'});
    assert.equal(view.id,id);
    assert.equal(view.stage,7);
    assert.equal(view.name,'真實關卡地形');
    assert.equal(fs.existsSync(path.join(base,'public',view.image)),true,view.image);
  }
  assert.equal(Ecology.fromBattle({mode:'pvp',trial:{stage:4},terrain:2}),null);
  assert.equal(Ecology.fromBattle({mode:'pve'}),null);
});

test('saved stage is deterministically reconstructed using the same trial generator',()=>{
  const seed='home-ecology-stage-test';
  for(const stage of [1,2,3,12]){
    const ground=Rules.stageLayout(seed,stage,2);
    const picture=Ecology.fromProgress({seed,stage},Rules);
    assert.equal(picture.stage,stage);
    assert.equal(picture.name,ground.title);
    assert.equal(picture.id,Ecology.resolveFromTerrain(ground.terrain).id);
  }
  assert.equal(Ecology.fromProgress({},Rules),null);
  assert.equal(Ecology.fromProgress({seed:'',stage:1},Rules),null);
  assert.equal(Ecology.fromProgress({seed,stage:0},Rules),null);
});

test('daily task, JSON/AI bank, and original battle systems stay mounted',()=>{
  assert.match(html,/class="home-daily-progress"/);
  assert.match(html,/id="quest-spotlight-slot"/);
  assert.match(read('public/cultivation/quest-system.js'),/recommendedDailyQuest\(\)/);
  assert.match(read('public/main.js'),/\.\/cultivation\/home-wireframe\.js/);
  assert.ok(read('ai-question-bank.cjs').length>100);
  assert.ok(read('daily-meditation-api.cjs').length>100);
  assert.match(battle,/window\.startBattleMatchmaking=\(\)=>open\('pvp'\)/);
  assert.doesNotMatch(js,/runTransaction|\.update\(/);
});

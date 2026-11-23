const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('stamina branch only boots the current weapon/manual training interface',()=>{
 const main=read('public/main.js');
 const registry=main.match(/const XIUXIAN_FEATURE_MODULES = \[([\s\S]*?)\];/)[1];
 for (const old of ['cultivation-training-v4','golden-core-battle-effects','artifact-system',
   'artifact-battle-effects','soulbound-draw','cultivation-status-panel','training-scene-map',
   'unified-inventory-grid','cultivation-refinery-v2','foundation-training-page']) {
   assert.doesNotMatch(registry,new RegExp("'\\./cultivation/"+old+"\\.js'"),old);
 }
 assert.match(registry,/manual-training-page\.js/);
 assert.match(registry,/tactical-combat\.js/);
 assert.match(main,/QA_LEGACY_CULTIVATION_DISABLED = true/);
 const index=read('public/index.html');
 const shell=index.slice(index.indexOf('id="page-training"'),index.indexOf('id="page-quiz"'));
 assert.doesNotMatch(shell,/本命金丹|data-training-tab="core"|data-training-tab="nascent-soul"/);
});

test('retired combat affixes cannot be supplied by the new duel/raid snapshots',()=>{
 const duel=read('public/cultivation/battle-mode-v2.js');
 const raid=read('public/cultivation/raid-mode.js');
 const combat=read('public/cultivation/cultivation-combat-stats.js');
 assert.match(duel,/const goldenCore = null;/);
 assert.match(duel,/const nascentSoul = null;/);
 assert.match(raid,/const core = null;/);
 assert.match(raid,/const soul = null;/);
 assert.doesNotMatch(combat,/getNascentSoulBattleSnapshot/);
});

test('old combat change popups are not generated',()=>{
 const growth=read('public/cultivation/player-growth-feedback.js');
 assert.doesNotMatch(growth,/popup\.innerHTML|document\.createElement\('aside'\)/);
 assert.match(growth,/showGrowthComparison = \(\) =>/);
});

test('server combat projection ignores old owned and equipped systems',()=>{
 const {trustedRaidPlayerSnapshot}=require('../raid-authority.cjs');
 const bare={stats:{attack:240,maxHp:900,totalScore:188}};
 const legacy={...bare,
   cultivationTraining:{equippedCore:{type:'ocean',grade:1}},
   nascentSoulGrowth:{version:1,branches:{attack:10,vitality:10}},
   artifactSystem:{equipped:{本命法寶:'void-sword'},inventory:{'void-sword':1}},
   innateAbility:{type:'ocean',level:10}
 };
 const clean=trustedRaidPlayerSnapshot(bare,'u');
 const equipped=trustedRaidPlayerSnapshot(legacy,'u');
 assert.equal(equipped.atk,clean.atk);
 assert.equal(equipped.maxHp,clean.maxHp);
 assert.equal(equipped.combatPower,clean.combatPower);
 assert.equal(equipped.goldenCore,null);
 assert.equal(equipped.nascentSoul,null);
 assert.equal(equipped.innateAbility,null);
 assert.deepEqual(equipped.artifactBattle.effects,[]);
});

test('修行 page and navigation cannot be hidden by the retired core-access gate',()=>{
  const index=read('public/index.html');
  const oldStyle=index.match(/<style id="golden-core-access-guard-style">([\s\S]*?)<\/style>/)?.[1]||'';
  assert.doesNotMatch(oldStyle,/training-access-ready/);
  assert.doesNotMatch(oldStyle,/#page-training|#nav-training/);
  assert.match(index,/data-home-action="training" aria-label="修行"/);
  const manual=read('public/cultivation/manual-training-page.js');
  assert.match(manual,/nav\.setAttribute\('aria-label','修行'\)/);
  assert.match(manual,/>修行<\/span>/);
  assert.match(manual,/page\.classList\.add\('manual-training-active'\)/);
});

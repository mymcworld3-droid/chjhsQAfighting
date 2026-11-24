const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('retired cultivation is not started, and the native training page remains available',()=>{
 const main=read('public/main.js'),registry=main.match(/const XIUXIAN_FEATURE_MODULES = \[([\s\S]*?)\];/)[1];
 for(const name of ["golden-core-activation-feedback","golden-core-access-guard","foundation-training-page","cultivation-training-v4","training-scroll-fix","reverse-core-multiples","golden-core-battle-effects","cultivation-core-visual","cultivation-core-equip-warning","artifact-catalog-sync","artifact-system","soulbound-draw","artifact-battle-effects","inventory-dismantle","unified-inventory-grid","refinery-ai-jobs","cultivation-refinery-v2","training-fluid-layout","material-realm-ui","material-drop-system","cultivation-status-panel","training-scene-map"]) assert(!registry.includes('/'+name+'.js'),name);
 for(const name of ['manual-training-page','tactical-combat','weapon-dungeons-page','training-access']) assert(registry.includes('/'+name+'.js'),name);
 assert.match(main,/QA_LEGACY_CULTIVATION_DISABLED = true/);
 const html=read('public/index.html'),guard=html.match(/<style id="golden-core-access-guard-style">([\s\S]*?)<\/style>/)[1];
 assert.doesNotMatch(guard,/#page-training|#nav-training|training-access-ready/);
 assert.match(html,/<div id="page-training"[^>]*><\/div>/);
 assert.match(html,/<nav id="bottom-nav"/);
});
test('public profile and growth feedback do not expose the retired power score',()=>{
 assert.doesNotMatch(read('public/cultivation/player-profile.js'),/戰力|xpp-power|artifactSystem/);
 const growth=read('public/cultivation/player-growth-feedback.js');
 assert.match(growth,/showGrowthComparison = \(\) =>/);
 assert.doesNotMatch(growth,/popup\.innerHTML/);
});
test('legacy equipment cannot add raid fighter bonuses',()=>{
 const {trustedRaidPlayerSnapshot}=require('../raid-authority.cjs');
 const bare={stats:{attack:240,maxHp:900,totalScore:188}};
 const old={...bare,cultivationTraining:{equippedCore:{type:'ocean',grade:1}},nascentSoulGrowth:{version:1,branches:{attack:10,vitality:10}},artifactSystem:{equipped:{本命法寶:'void-sword'},inventory:{'void-sword':1}},innateAbility:{type:'ocean',level:10}};
 const a=trustedRaidPlayerSnapshot(bare,'u'),b=trustedRaidPlayerSnapshot(old,'u');
 assert.equal(a.atk,b.atk);assert.equal(a.maxHp,b.maxHp);assert.equal(b.goldenCore,null);assert.equal(b.nascentSoul,null);assert.equal(b.innateAbility,null);assert.deepEqual(b.artifactBattle.effects,[]);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Growth = require('../public/cultivation/nascent-growth.js');
const Combo = require('../public/cultivation/combat-combo.js');
const Talents = require('../public/cultivation/soul-talents.js');
const { trustedRaidPlayerSnapshot, resolvePlayerAction } = require('../raid-authority.cjs');
const read = path => fs.readFileSync(require('node:path').join(__dirname,'..',path),'utf8');
const clean = source => source.replace(/^import \{\} from .*;\n/gm,'').replace(/^export /gm,'');
function player(type='sword',levels={}) { return {uid:'h',stats:{totalScore:68,attack:200,maxHp:1000},cultivationTraining:{coreEnabled:true,equippedCore:{type,grade:1,createdAt:100}},nascentSoulGrowth:{version:1,branches:levels},materialSystem:{inventory:{[Growth.ITEM_ID]:1000}}}; }
function combat() {const context={window:{},QACombatCombo:Combo,QASoulTalents:Talents};vm.createContext(context);vm.runInContext(clean(read('public/cultivation/artifact-battle-effects.js')),context);vm.runInContext(clean(read('public/cultivation/battle-engine-v2.js'))+'\nthis.settle=settleBattleRound;',context);return context;}
function seedWithHits(chance,count) {for(let i=0;i<100000;i++){const room='chain-room-'+i;if(Combo.chain({damage:200,chance,seed:room+':1:h:artifact',remainingHp:2000}).length===count)return room;}throw Error('No combo seed');}
function fighters(extra={}){return {host:{uid:'h',totalScore:68,hp:3000,maxHp:3000,atk:200,answer:{correct:true,atMs:100},...extra},guest:{uid:'g',totalScore:68,hp:3000,maxHp:3000,atk:200,answer:{correct:false,atMs:200}}};}
test('four ordinary branches and five critical/combo branches replace prerequisite nodes',()=>{
 for(const type of ['ocean','taichu','pojing','xingchen','wugou','thunder','reverse'])assert.deepEqual(Growth.branches({type}).map(x=>x.id),['cultivation','attack','vitality','core']);
 for(const type of ['ningxin','sword']){assert.deepEqual(Growth.branches({type}).map(x=>x.id),['cultivation','attack','vitality','coreChance','coreDamage']);assert.equal(Growth.upgrade(player(type),'core').ok,false);assert.equal(Growth.upgrade(player(type),'coreDamage').ok,true);}
});
test('max bonuses are total +10 cultivation +70 attack +500 HP and all ranks cap at ten',()=>{
 const p=player('ocean',{cultivation:99,attack:99,vitality:99,core:99}),b=Growth.bonuses(p,p.cultivationTraining.equippedCore);
 assert.equal(b.attackFlat,70);assert.equal(b.maxHpFlat,500);for(const source of ['solo','daily','cave','raid'])assert.equal(Growth.cultivation(p,source),10);assert.equal(Growth.upgrade(p,'attack').ok,false);
});
test('upgrade subtracts each rising cost once; full branch costs 55 fragments and reset refunds exactly',()=>{
 const p=player();for(let n=1;n<=10;n++){const next=Growth.upgrade(p,'attack');assert.equal(next.cost,n);Growth.apply(p,next);}assert.equal(p.materialSystem.inventory[Growth.ITEM_ID],945);const refund=Growth.reset(p);assert.equal(refund.returned,55);Growth.apply(p,refund);assert.equal(Growth.reset(p).returned,0);assert.equal(p.materialSystem.inventory[Growth.ITEM_ID],1000);
});
test('legacy earned spirit including investments migrates once without preserving old bonuses',()=>{
 const p=player();delete p.nascentSoulGrowth;p.stats.nascentSoulSpirit=123;p.nascentSoulTree={version:4,paths:{sword:{nodes:{leftMain:10,rightMain:10}}}};
 const next=Growth.prepare(p);assert.equal(next.converted,123);assert.equal(next.fragments,1123);assert.equal(Growth.bonuses(p,p.cultivationTraining.equippedCore).attackFlat,0);Growth.apply(p,next);assert.equal(p.stats.nascentSoulSpirit,0);assert.equal(Growth.prepare(p).converted,0);assert.equal(Growth.prepare(p).fragments,1123);
});
test('pre-nascent realm, disabled core and insufficient fragments cannot activate or upgrade branches',()=>{
 const p=player('ocean',{attack:10});p.stats.totalScore=67;assert.equal(Growth.upgrade(p,'attack').ok,false);assert.equal(Growth.bonuses(p,p.cultivationTraining.equippedCore),null);p.stats.totalScore=68;p.cultivationTraining.coreEnabled=false;assert.equal(Growth.cultivation(p,'solo'),0);p.materialSystem.inventory[Growth.ITEM_ID]=0;assert.equal(Growth.upgrade(p,'core').ok,false);
});
test('critical and combo chance and damage grow independently and do not inherit old guaranteed pursuits',()=>{
 const p=player('sword',{coreChance:10,coreDamage:10}),b=Growth.bonuses(p,p.cultivationTraining.equippedCore);assert.ok(Math.abs(b.comboChance-.15)<1e-9);assert.equal(b.comboDamageBonus,.3);assert.equal(Talents.attack({atk:270,hp:1500,maxHp:1500,nascentSoul:b},{hp:5000,maxHp:5000}).followup,0);
 const q=player('ningxin',{coreChance:10,coreDamage:10}),c=Growth.bonuses(q,q.cultivationTraining.equippedCore);assert.ok(Math.abs(c.critChance-.15)<1e-9);assert.equal(c.critDamageBonus,.5);assert.equal(c.comboChance,0);
});
test('combo defaults to 30%, supports further combos, and excludes pursuit and counter events',()=>{
 assert.equal(Combo.stats({}).multiplier,.30);assert.deepEqual(Combo.chain({damage:200,chance:.5,remainingHp:1000,roll:i=>i<3?0:1}),[60,60,60]);
 for(const kind of ['counter','pursuit'])assert.deepEqual(Combo.chain({kind,damage:200,chance:.5,remainingHp:1000,roll:()=>0}),[]);
 assert.deepEqual(Combo.chain({damage:0,chance:.5,remainingHp:1000,roll:()=>0}),[]);
 assert.equal(Combo.chain({damage:200,chance:.5,remainingHp:100,roll:()=>0}).length,2);
});
test('equipment and soul combo stats stack while equipment chance retains its 10% cap',()=>{
 const result=Combo.stats({nascentSoul:{comboChance:.15,comboDamageBonus:.30}},[{type:'equip_combo_chance',value:.9},{type:'equip_combo_damage_percent',value:.1}]);assert.equal(result.chance,.25);assert.ok(Math.abs(result.multiplier-.70)<1e-9);
});
test('actual PvP persists every 30% combo as a separate replay-safe step',()=>{
 const r=combat(),roomId=seedWithHits(.1,2);const run=()=>r.settle({roomId,round:1,...fighters({artifactBattle:{effects:[{type:'equip_combo_chance',value:.1}]}}),resolveEquipmentHit:r.window.resolveArtifactBattleHit,resolveTalentDefense:r.window.resolveArtifactBattleDefense});const first=run(),second=run();const combos=first.steps.filter(x=>x.combo);assert.deepEqual(Array.from(combos,x=>x.damage),[60,60]);assert.equal(first.guestHp,2680);assert.equal(JSON.stringify(first),JSON.stringify(second));assert.ok(combos.every(x=>x.critical===false));
});
test('zero-damage Dao shield blocks combo and normal extra segments apply defense separately',()=>{
 const r=combat(),roomId=seedWithHits(.1,2),f=fighters({artifactBattle:{effects:[{type:'equip_combo_chance',value:.1}]}});f.guest.coreShield=true;f.guest.goldenCore={type:'ningxin',grade:6};const blocked=r.settle({roomId,round:1,...f,resolveEquipmentHit:r.window.resolveArtifactBattleHit,resolveGuardedFollowup:r.window.resolveArtifactGuardedFollowup,resolveTalentDefense:r.window.resolveArtifactBattleDefense});assert.equal(blocked.guestHp,3000);assert.equal(blocked.steps.filter(x=>x.combo).length,0);
 const g=fighters({artifactBattle:{effects:[{type:'equip_combo_chance',value:.1}]}});g.guest.artifactBattle={effects:[{type:'equip_damage_reduction_percent',value:.5}]};const reduced=r.settle({roomId,round:1,...g,resolveEquipmentHit:r.window.resolveArtifactBattleHit,resolveTalentDefense:r.window.resolveArtifactBattleDefense});assert.deepEqual(Array.from(reduced.steps.filter(x=>x.combo),x=>x.damage),[15,15]);assert.equal(reduced.guestHp,2870);
});
test('raid uses new trusted bonuses and records critical/combo metadata without client claims',()=>{
 const p=player('sword',{attack:10,vitality:10,coreChance:10,coreDamage:10}),snapshot=trustedRaidPlayerSnapshot(p,'h');assert.equal(snapshot.atk,270);assert.equal(snapshot.maxHp,1500);assert.ok(Math.abs(snapshot.nascentSoul.comboChance-.15)<1e-9);
 snapshot.goldenCore=null;let result;for(let actionId=1;actionId<5000;actionId++){result=resolvePlayerAction(snapshot,{roomId:'raid-chain',actionId,correct:true,bossHp:10000,bossMaxHp:10000});if(result.comboHits.length>=2)break;}assert.ok(result.comboHits.length>=2);assert.ok(result.comboHits.every(n=>n===162));assert.equal(result.damage,270+162*result.comboHits.length);
});

function branchRuntime({fail=false,retry=false,changeCore=false,reset=false}={}) {
 const remote=player('ocean',{attack:2}),local=structuredClone(remote),writes=[],messages=[];let uid='h';
 const training=read('public/cultivation/cultivation-training-v4.js');const start=training.indexOf('  async function saveSoulBranch('),end=training.indexOf('  async function migrateSoulResources',start);
 const context={Growth,state:remote.cultivationTraining,soulBusy:false,busy:false,NASCENT_SOUL_THRESHOLD:68,getApp:()=>({}),getAuth:()=>({currentUser:{uid}}),getFirestore:()=>({}),doc:()=>({}),sameGoldenCore:(a,b)=>a?.type===b?.type&&a?.grade===b?.grade&&a?.createdAt===b?.createdAt,renderTrainingPage(){},toast:m=>messages.push(m),CustomEvent:class{},window:{getCurrentUserData:()=>local,dispatchEvent(){},openConfirm:async()=>true},
 runTransaction:async(_,worker)=>{let pending=[];const tx={get:async()=>({exists:()=>true,data:()=>structuredClone(remote)}),update:(_,patch)=>pending.push(patch)};if(retry){await worker(tx);pending=[];Growth.apply(remote,Growth.upgrade(remote,'attack'));}if(changeCore)remote.cultivationTraining.equippedCore={type:'sword',grade:1};const result=await worker(tx);if(fail)throw Error('offline');for(const patch of pending){writes.push(patch);for(const [key,value] of Object.entries(patch)){const path=key.split('.');let target=remote;for(const part of path.slice(0,-1))target=target[part]||={};target[path.at(-1)]=value;}}return result;}};
 vm.createContext(context);vm.runInContext(training.slice(start,end)+'\nthis.save=saveSoulBranch;',context);return {remote,local,writes,messages,context};
}
test('branch transactions retry against latest fragment balance, increment once and reject changed core',async()=>{
 const r=branchRuntime({retry:true});await Promise.all([r.context.save('attack'),r.context.save('attack')]);assert.equal(r.writes.length,1);assert.equal(r.remote.nascentSoulGrowth.branches.attack,4);assert.equal(r.remote.materialSystem.inventory[Growth.ITEM_ID],993);assert.equal(r.local.materialSystem.inventory[Growth.ITEM_ID],993);
 const changed=branchRuntime({changeCore:true});await changed.context.save('attack');assert.equal(changed.writes.length,0);assert.equal(changed.local.nascentSoulGrowth.branches.attack,2);assert.match(changed.messages[0],/金丹已變更/);
});
test('failed branch persistence leaves local fragments unchanged and reset refunds purchases atomically',async()=>{
 const failed=branchRuntime({fail:true});await failed.context.save('attack');assert.equal(failed.local.materialSystem.inventory[Growth.ITEM_ID],1000);assert.equal(failed.local.nascentSoulGrowth.branches.attack,2);assert.equal(failed.writes.length,0);
 const reset=branchRuntime();await reset.context.save(null,true);assert.equal(reset.remote.nascentSoulGrowth.branches.attack,0);assert.equal(reset.local.materialSystem.inventory[Growth.ITEM_ID],1003);assert.equal(reset.writes.length,1);
});
function meditationRuntime(score,correct,fail=false) {
 const remote=player('ocean',{cultivation:10});remote.stats.totalScore=score;remote.stats.gold=0;const local=structuredClone(remote),writes=[];
 const source=read('public/cultivation/daily-meditation.js'),start=source.indexOf('  async function finish()'),end=source.indexOf('  window.openDailyMeditation',start);
 const rules=vm.runInNewContext(clean(read('public/cultivation/daily-meditation-rules.js'))+'\n({meditationReward,nextMeditationStreak})');
 const context={...rules,QANascentGrowth:Growth,busy:false,session:{uid:'h',date:'2026-10-10',questionAnswered:true,answered:3,correct,answers:[{},{},{}]},QUESTION_TOTAL:3,uid:()=> 'h',today:()=> '2026-10-10',userData:()=>local,userRef:()=>({id:'h'}),db:{},collection:()=>({}),doc:()=>({}),increment:n=>({delta:n}),serverTimestamp:()=>0,soulCultivationBonusForPlayer:Growth.cultivation,setContent(){},notify(){},invalidateMistakes(){},renderIntro(){},syncPanel(){},node:()=>({}),window:{XianxiaQuestRules:require('../public/cultivation/quest-rules.js'),getXiuxianRealmIndex:()=>3,dispatchEvent(){}},CustomEvent:class{},runTransaction:async(_,worker)=>{const patches=[];await worker({get:async()=>({exists:()=>true,data:()=>structuredClone(remote)}),update:(_,patch)=>patches.push(patch),set(){}});if(fail)throw Error('offline');for(const patch of patches){writes.push(patch);for(const [key,value] of Object.entries(patch)){const parts=key.split('.');let target=remote;for(const part of parts.slice(0,-1))target=target[part]||={};target[parts.at(-1)]=value?.delta!==undefined?(target[parts.at(-1)]||0)+value.delta:value;}}}};
 vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nthis.finishNow=finish;',context);return {context,remote,local,writes};
}
test('real daily settlement awards +3 fragments only for perfect answers at nascent realm and cannot replay',async()=>{
 for(const [score,correct,earned] of [[68,3,3],[68,2,0],[67,3,0]]){const r=meditationRuntime(score,correct);await r.context.finishNow();assert.equal(r.remote.materialSystem.inventory[Growth.ITEM_ID],1000+earned);assert.equal(r.local.materialSystem.inventory[Growth.ITEM_ID],1000+earned);assert.equal(r.remote.dailyMeditation.lastResult.fragments,earned);assert.equal(r.remote.stats.nascentSoulSpirit,0);assert.equal(r.writes.length,1);await r.context.finishNow();assert.equal(r.writes.length,1);}
 const failed=meditationRuntime(68,3,true);await failed.context.finishNow();assert.equal(failed.local.materialSystem.inventory[Growth.ITEM_ID],1000);assert.equal(failed.writes.length,0);
});

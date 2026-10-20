'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
globalThis.QACombatCombo=require('../public/cultivation/combat-combo.js');
const authority=require('../raid-authority.cjs');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/battle-engine-v2.js'),'utf8');
const engine=new Function(source.replace(/^import \{\} from .*;\n/gm,'').replace(/^export /gm,'')+'\nreturn {settleBattleRound,resolveDeterministicCounterCore};')();
const player=(uid,correct,grade=1)=>({uid,atk:200,hp:2000,maxHp:2000,totalScore:68,
  answer:{correct,atMs:uid==='h'?1000:1200},goldenCore:uid==='g'?{type:'thunder',grade}:null});

function activeRoom(prefix,round=1) {
 for(let i=0;i<1000;i++){
  const room=prefix+'-'+i;
  if(engine.resolveDeterministicCounterCore(player('g',true),200,room+':'+round+':g:counter').reflectDamage)return room;
 }
 throw Error('No active thunder seed');
}
test('correct answers roll a grade-independent 60% chance once per round with a 75% additive bonus',()=>{
 let triggered=0,missed=0;
 for(let grade=1;grade<=9;grade++)for(let seed=0;seed<100;seed++){
  const key='answer-'+seed+':1:g:';
  const result=engine.resolveDeterministicCounterCore(player('g',true,grade),200,key+'counter');
  const again=engine.resolveDeterministicCounterCore(player('g',true,grade),200,key+'counter');
  const star=engine.resolveDeterministicCounterCore(player('g',true,grade),200,key+'star-counter');
  assert.equal(result.reflectDamage,again.reflectDamage);assert.equal(result.reflectDamage,star.reflectDamage);
  assert.equal(result.reflectDamage,engine.resolveDeterministicCounterCore(player('g',true,1),200,key+'counter').reflectDamage);
  if(result.reflectDamage){assert.equal(result.reflectDamage,150);assert.equal(result.activation.type,'thunder');triggered++;}
  else missed++;
 }
 assert.ok(triggered>0&&missed>0);
 for(const correct of [false,null,undefined])assert.equal(engine.resolveDeterministicCounterCore(player('g',correct),200,'any').reflectDamage,0);
 assert.equal(engine.resolveDeterministicCounterCore(player('g',true),0,'any').reflectDamage,0);
});
test('the answer bonus is available before the slower correct player attacks, and expires when the next answer is wrong',()=>{
 const host=player('h',true),guest=player('g',true);
 const first=engine.settleBattleRound({roomId:activeRoom('answer-window'),round:1,host,guest});
 assert.equal(first.hostHp,1650);assert.equal(first.guestHp,1800);
 assert.equal(first.steps.filter(s=>s.type==='counter').length,1,'counter damage never causes another counter');
 const second=engine.settleBattleRound({roomId:activeRoom('answer-window'),round:2,
  host:{...host,hp:first.hostHp},guest:{...guest,hp:first.guestHp,answer:{correct:false,atMs:1200}}});
 assert.equal(second.hostHp,1650);assert.equal(second.guestHp,1600);
 assert.equal(second.steps.filter(s=>s.type==='counter').length,0);
 const noIncoming=engine.settleBattleRound({roomId:'no-incoming',round:1,host:player('h',false),guest});
 assert.equal(noIncoming.steps.filter(s=>s.type==='counter').length,0,'answering correctly does not itself fire a lightning attack');
});
test('lethal and shielded hits cannot grant the thunder bonus',()=>{
 for(const extra of [{hp:100},{coreShield:true}]){
  const result=engine.settleBattleRound({roomId:'survive',round:1,host:player('h',true),guest:{...player('g',true),...extra}});
  assert.ok(!result.steps.some(s=>s.type==='counter'&&s.coreEffect?.type==='thunder'));
 }
});
test('the browser fallback uses the same seeded chance and supports both answer formats without rerolling',()=>{
 const math=Object.create(Math);math.random=()=>{throw Error('Seeded thunder should not roll again');};
 const context={window:{},Math:math};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/cultivation/golden-core-battle-effects.js'),'utf8'),context);
 const seed=activeRoom('fallback')+':1:g:counter';
 const resolve=(answer,key=seed)=>context.window.resolveGoldenCoreBattleCounter({defender:{goldenCore:{type:'thunder',grade:9},...answer},receivedDamage:125,seed:key});
 assert.equal(resolve({answer:{correct:true}}).reflectDamage,94);
 assert.equal(resolve({answerCorrect:true}).reflectDamage,94);
 assert.equal(resolve({answer:{correct:false},answerCorrect:true}).reflectDamage,0);
 assert.equal(resolve({}).reflectDamage,0);
 for(let i=0;i<100;i++){
  const key='fallback-'+i+':1:g:counter';
  const expected=engine.resolveDeterministicCounterCore(player('g',true,9),125,key).reflectDamage;
  assert.equal(resolve({answer:{correct:true}},key).reflectDamage,expected);
 }
});
function raidMember(){return {...player('g',true),uid:'raid-player',hp:2000,maxHp:2000,
 artifactBattle:{effects:[{type:'equip_reflect_percent',value:.16}]},coreShield:false,nascentSoul:null};}
const raidRolls=Array.from({length:100},(_,i)=>({id:i+1,ready:authority.resolvePlayerAction(raidMember(),{roomId:'raid',actionId:i+1,correct:true}).member.thunderCounterReady}));
const activeIds=raidRolls.filter(x=>x.ready).map(x=>x.id);
const inactiveIds=raidRolls.filter(x=>!x.ready).map(x=>x.id);
const arm=(member,correct=true,actionId=activeIds[0])=>authority.resolvePlayerAction(member,{roomId:'raid',actionId,correct,bossHp:10000,bossMaxHp:10000}).member;
const hit=(member,extra={})=>authority.resolveBossDefense(member,{roomId:'raid',bossAction:{id:1,damage:200,...extra},bossHp:10000});
test('raid correct answers arm one boss action, add to weapon reflection and do not stack',()=>{
 assert.ok(activeIds.length>0&&inactiveIds.length>0);
 const armed=arm(arm(raidMember()),true,activeIds[1]);
 const first=hit(armed);assert.equal(first.reflectedDamage,182,'200 × (75% core + 16% weapon)');
 assert.equal(first.member.thunderCounterReady,false);
 assert.equal(hit(first.member).reflectedDamage,32,'the next boss attack keeps only the weapon reflection');
 assert.equal(hit(arm(armed,false)).reflectedDamage,32,'a wrong answer clears the pending core bonus');
 assert.equal(hit(arm(armed,true,inactiveIds[0])).reflectedDamage,32,'a correct answer with a failed roll also clears the previous bonus');
 assert.equal(arm(raidMember()).thunderCounterReady,arm(raidMember()).thunderCounterReady,'replaying the same answer cannot reroll');
});
test('raid guarding consumes the answer window; true and lethal damage never generate core reflection',()=>{
 const armed=arm(raidMember());
 const shielded=hit({...armed,coreShield:true});assert.equal(shielded.reflectedDamage,0);
 assert.equal(hit(shielded.member).reflectedDamage,32);
 assert.equal(hit(armed,{trueDamage:200}).reflectedDamage,0);
 assert.equal(hit({...armed,hp:50,artifactBattle:{effects:[]}}).reflectedDamage,0);
});

test('eligible PvP thunder reflects only the normal portion of a mixed normal and true hit',()=>{
 const result=engine.settleBattleRound({roomId:activeRoom('normal-only'),round:1,host:player('h',true),guest:player('g',true),
  resolveEquipmentHit:({attacker})=>attacker.uid==='h'?{damage:100,normalHpDamage:40,trueDamage:60}:{damage:0,normalHpDamage:0,trueDamage:0}});
 const counters=result.steps.filter(s=>s.type==='counter');
 assert.equal(counters.length,1);assert.equal(counters[0].damage,30);
 assert.equal(result.hostHp,1970);assert.equal(result.guestHp,1900);
});

test('the 60% answer roll includes 59 and excludes 60, sharing the decision with starfall',()=>{
 const eligible=player('g',true);
 for(const suffix of ['counter','star-counter']){
  assert.equal(engine.resolveDeterministicCounterCore(eligible,200,'threshold-190:1:g:'+suffix).reflectDamage,150);
  assert.equal(engine.resolveDeterministicCounterCore(eligible,200,'threshold-256:1:g:'+suffix).reflectDamage,0);
 }
});

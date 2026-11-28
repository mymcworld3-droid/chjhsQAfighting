#!/usr/bin/env node
'use strict';
// Stage 19: full-loadout combat using production rules, not a second engine.
const fs=require('node:fs'),assert=require('node:assert/strict');
const S=require('./lib/tactical-balance.cjs'),M=require('../public/cultivation/manual-rules.js');
const D=require('../public/cultivation/weapon-dungeon-rules.js'),R=S.R;
const Rewards=require('../weapon-dungeon-rewards.cjs');
const specialPairs=[
 ['body-mirror','body-rock'],['body-mirror','body-tiger'],['body-mirror','body-dragon'],
 ['body-mirror','body-bell'],['body-mirror','body-gravity'],['sword-weave','sword-time'],
 ['sword-prism','sword-flight'],['sword-time','body-gravity']
];
const setupIds=new Set(['weave-mark','mirror-summon','time-slash','gravity-core','flight-summon','dragon-roar']);
const cases=[
 ...[5,6,8,10,20].map(stage=>({mode:'trial',stage})),
 ...D.DIFFICULTIES.map(d=>({mode:'dungeon',difficulty:d.index,stage:d.stage,realm:d.name}))
];
const seeds=[{seed:'stage19-a',accuracy:1},{seed:'stage19-b',accuracy:.7}];
// A cancelled attack is represented by a stagger intent, not a null intent.
function interruptedWarning(before,after){
 return Boolean(before.intent?.cells?.length&&after.hp>0&&after.intent?.kind==='stagger'&&R.dist(before,after)>0);
}
function runBattle(books,scenario,{seed,accuracy},level,stars,{flightPolicy=false}={}){
 const weaponIds=books.map(b=>b.id),skills=books.flatMap(b=>b.skills.map(s=>s.id));
 const record={books:Object.fromEntries(books.map(b=>[b.id,{exp:M.totalExpForLevel(10),refinement:stars}])),
  weaponIds,skillLevels:Object.fromEntries(skills.map(id=>[id,level]))};
 const equipped=M.normalize(record).equipped;
 assert.deepEqual([...equipped].sort(),[...skills].sort());
 const raw={uid:'seat0',atk:200,maxHp:1000,manualSkills:equipped,manualSkillLevels:record.skillLevels,
  manualRefinements:Object.fromEntries(weaponIds.map(id=>[id,stars])),manualWeaponMode:true,manualWeaponIds:weaponIds};
 const trial=scenario.mode==='trial'?{seed,stage:scenario.stage,layoutVersion:4}:{seed,weaponDungeon:{id:scenario.dungeonId||D.ID,difficulty:scenario.difficulty}};
 let s=R.create({id:'stage19',mode:'pve',players:[raw],trial,now:S.NOW});
 const initial={map:s.map,structure:s.trial.structure,layoutHash:s.trial.layoutHash,objective:s.objective.type,
  initialEnemyHp:s.actors.filter(a=>a.bot).reduce((n,a)=>n+a.hp,0)};
 let movementSpent=0,setupSpent=0,enemyHpDamage=0,forcedMoves=0,interrupts=0,answers=0,correct=0,actions=0,hitActions=0,multiTargetActions=0;
 let swordMoves=0,swordMovementSpent=0,swordMoveHitActions=0;
 let observedHpLoss=0,observedHpRecovery=0,warningExits=0,warningEndTurns=0,warningEndTurnsWithReachableSafeCell=0,warningEndTurnsWithoutReachableSafeCell=0;
 const warningKeys=(state)=>new Set(state.actors.filter(t=>t.bot&&R.alive(t)).flatMap(t=>t.intent?.cells||[]).map(R.key));
 const audit=e=>{
  const a=e.before.actors[0],b=e.after.actors[0];
  assert.ok(b.hp>=0&&b.hp<=b.maxHp&&b.stamina>=0&&b.stamina<=R.LIMITS.stamina);
  if(e.type==='answer'){answers++;if(e.correct)correct++;return;}
  actions++;
  observedHpLoss+=Math.max(0,a.hp-b.hp);observedHpRecovery+=Math.max(0,b.hp-a.hp);
  if(scenario.dungeonId){
   const danger=warningKeys(e.before),wasWarned=danger.has(R.key(a));
   if(e.command.type==='move'&&wasWarned&&!warningKeys(e.after).has(R.key(b)))warningExits++;
   if(e.command.type==='end'&&wasWarned){
    warningEndTurns++;
    if(R.moveCells(e.before,a).some(p=>!danger.has(R.key(p))))warningEndTurnsWithReachableSafeCell++;
    else warningEndTurnsWithoutReachableSafeCell++;
   }
  }
  if(e.command.type==='move'||e.command.type==='sword-move')movementSpent+=a.stamina-b.stamina;
  if(e.command.type==='sword-move'){swordMoves++;swordMovementSpent+=a.stamina-b.stamina;}
  if(e.command.type==='manual'&&setupIds.has(e.command.skillId))setupSpent+=R.techniqueCost(a,R.manualSkillFor(a,e.command.skillId));
  let targets=0;
  for(const enemy of e.before.actors.filter(t=>t.bot)){
   const after=e.after.actors.find(t=>t.uid===enemy.uid);if(!after)continue;
   const damage=Math.max(0,enemy.hp-after.hp);enemyHpDamage+=damage;
   if(damage)targets++;
   if(e.command.type==='manual'&&e.after.turn===e.before.turn){
    if(R.dist(enemy,after)>0)forcedMoves++;
    if(interruptedWarning(enemy,after))interrupts++;
   }
  }
  if(targets){hitActions++;if(e.command.type==='sword-move')swordMoveHitActions++;}if(targets>1)multiTargetActions++;
 };
 while(s.status==='active')s=S.playTurn(s,'seat0',{accuracy,seed,audit,flightPolicy});
 const a=s.actors[0],m=s.pveMetrics;
 assert.ok(s.turn<=R.LIMITS.turns+1);assert.equal(answers,a.answered);assert.equal(correct,a.correct);
 assert.equal(m.answers,answers);assert.ok(m.staminaSpent>=0);assert.equal(m.outcome,s.winner==='player'?'win':'loss');
 return {weaponIds,level,stars,attack:raw.atk,maxHp:raw.maxHp,...scenario,seed,accuracy,...initial,
  outcome:m.outcome,reason:s.finishReason,turns:m.turns,answers,correct,wrong:answers-correct,
  answersToClear:m.outcome==='win'?answers:null,staminaSpent:m.staminaSpent,movementSpent,setupSpent,
  enemyHpDamage,damagePerStamina:m.staminaSpent?enemyHpDamage/m.staminaSpent:null,forcedMoves,interrupts,
  actions,hitActions,multiTargetActions,manualCasts:m.manualCasts,remainingHp:a.hp,
  observedHpLoss,observedHpRecovery,warningExits,warningEndTurns,warningEndTurnsWithReachableSafeCell,warningEndTurnsWithoutReachableSafeCell,
  flightPolicy,swordMoves,swordMovementSpent,swordMoveHitActions,
  lordDefeated:scenario.mode==='dungeon'?!s.actors.some(t=>t.weaponDungeonLord&&R.alive(t)):null};
}
// V4 stage 8 baseline: same production engine and same decision policy as stage 19.
const v4Cases=D.CATALOG.flatMap(d=>D.DIFFICULTIES.map(t=>({mode:'dungeon',dungeonId:d.id,difficulty:t.index,stage:t.stage,realm:t.name})));
const v4Seeds=['v4-balance-a','v4-balance-b','v4-balance-c'].flatMap(seed=>[1,.7].map(accuracy=>({seed,accuracy})));
function v4DropPools(){
 return v4Cases.map(scenario=>{
  const {dungeonId,realm}=scenario,lowerRealm=D.lowerRealm(realm);
  const pools=Rewards.previewPools([realm,lowerRealm],dungeonId);
  const current=pools[realm],lower=pools[lowerRealm];
  let drops=0,empty=0;
  for(let value=0;value<100;value++){
   const room={weaponDungeon:{id:dungeonId,realm}},record={books:{}};
   let calls=0;
   const drop=Rewards.roll(room,'balance',record,max=>{calls++;return max===100?value:0;});
   const expected=value<30?current:value<50?lower:[];
   assert.equal(Boolean(drop),expected.length>0);
   assert.equal(calls,expected.length?2:1,'empty pools must not reroll');
   if(drop){drops++;assert.ok(expected.some(b=>b.id===drop.id));}
   else empty++;
  }
  return {...scenario,lowerRealm,current,lower,dropPercent:drops,noDropPercent:empty};
 });
}
function runV4Shard(configs){
 const rows=[];
 for(const books of configs)for(const scenario of v4Cases)for(const seed of v4Seeds){
  const row=runBattle(books,scenario,seed,1,0);
  assert.equal(row.outcome==='win',row.lordDefeated,'lord defeat must be the victory objective');
  rows.push(row);console.log('V4_BALANCE '+JSON.stringify(row));
 }
 assert.equal(rows.length,configs.length*v4Cases.length*v4Seeds.length);
 const growthRows=[],flightRows=[];
 for(const books of configs)for(const scenario of v4Cases)for(const seed of v4Seeds.filter(s=>s.seed==='v4-balance-a')){
  const row=runBattle(books,scenario,seed,5,5);
  assert.equal(row.outcome==='win',row.lordDefeated);
  growthRows.push(row);console.log('V4_GROWTH '+JSON.stringify(row));
  if(books.some(b=>b.id==='sword-flight')){
   const flight=runBattle(books,scenario,seed,1,0,{flightPolicy:true});
   assert.equal(flight.outcome==='win',flight.lordDefeated);
   flightRows.push(flight);console.log('V4_FLIGHT '+JSON.stringify(flight));
  }
 }
 assert.equal(growthRows.length,configs.length*v4Cases.length*2);
 assert.equal(flightRows.length,configs.filter(books=>books.some(b=>b.id==='sword-flight')).length*v4Cases.length*2);
 return {schema:2,policy:'production rules; baseline unchanged, corrected stagger metric; paired level 5/refinement 5 sensitivity and separate legal flying-sword policy on seed a',rows,growthRows,flightRows,dropPools:v4DropPools()};
}
function runShard(shard,shards){
 assert.equal(M.RELEASE_NEW_WEAPONS,true,'run with the actual candidate catalog');
 assert.equal(M.BOOKS.length,12);
 assert.ok(Number.isInteger(shard)&&Number.isInteger(shards)&&shards>0&&shard>=0&&shard<shards);
 const all=[...M.BOOKS.map(b=>[b]),...specialPairs.map(ids=>ids.map(id=>M.BY_BOOK[id]))];
 const configs=all.filter((_,i)=>i%shards===shard);
 const rows=[];
 for(const books of configs)for(const scenario of cases)for(const [level,stars] of [[1,0],[5,5]])for(const seed of seeds){
  const row=runBattle(books,scenario,seed,level,stars);rows.push(row);
  console.log(JSON.stringify(row));
 }
 assert.equal(rows.length,configs.length*cases.length*4);
 return {schema:1,shard,shards,policy:'tactical-balance heuristic; observed not minimum question count',rows,v4:runV4Shard(configs)};
}
if(require.main===module){
 const [shard='0',shards='12',out='/tmp/stage19-balance.json']=process.argv.slice(2);
 const report=runShard(Number(shard),Number(shards));
 fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log('Stage 19 combat cases completed: '+report.rows.length);
}
module.exports={runBattle,runShard,cases,specialPairs,seeds,runV4Shard,v4Cases,v4Seeds,v4DropPools,interruptedWarning};

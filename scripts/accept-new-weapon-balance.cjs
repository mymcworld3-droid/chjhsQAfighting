#!/usr/bin/env node
'use strict';
// Stage 19: full-loadout combat using production rules, not a second engine.
const fs=require('node:fs'),assert=require('node:assert/strict');
const S=require('./lib/tactical-balance.cjs'),M=require('../public/cultivation/manual-rules.js');
const D=require('../public/cultivation/weapon-dungeon-rules.js'),R=S.R;
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
function runBattle(books,scenario,{seed,accuracy},level,stars){
 const weaponIds=books.map(b=>b.id),skills=books.flatMap(b=>b.skills.map(s=>s.id));
 const record={books:Object.fromEntries(books.map(b=>[b.id,{exp:M.totalExpForLevel(10),refinement:stars}])),
  weaponIds,skillLevels:Object.fromEntries(skills.map(id=>[id,level]))};
 const equipped=M.normalize(record).equipped;
 assert.deepEqual([...equipped].sort(),[...skills].sort());
 const raw={uid:'seat0',atk:200,maxHp:1000,manualSkills:equipped,manualSkillLevels:record.skillLevels,
  manualRefinements:Object.fromEntries(weaponIds.map(id=>[id,stars])),manualWeaponMode:true,manualWeaponIds:weaponIds};
 const trial=scenario.mode==='trial'?{seed,stage:scenario.stage,layoutVersion:4}:{seed,weaponDungeon:{id:D.ID,difficulty:scenario.difficulty}};
 let s=R.create({id:'stage19',mode:'pve',players:[raw],trial,now:S.NOW});
 const initial={map:s.map,structure:s.trial.structure,layoutHash:s.trial.layoutHash,objective:s.objective.type,
  initialEnemyHp:s.actors.filter(a=>a.bot).reduce((n,a)=>n+a.hp,0)};
 let movementSpent=0,setupSpent=0,enemyHpDamage=0,forcedMoves=0,interrupts=0,answers=0,correct=0,actions=0,hitActions=0,multiTargetActions=0;
 const audit=e=>{
  const a=e.before.actors[0],b=e.after.actors[0];
  assert.ok(b.hp>=0&&b.hp<=b.maxHp&&b.stamina>=0&&b.stamina<=R.LIMITS.stamina);
  if(e.type==='answer'){answers++;if(e.correct)correct++;return;}
  actions++;
  if(e.command.type==='move'||e.command.type==='sword-move')movementSpent+=a.stamina-b.stamina;
  if(e.command.type==='manual'&&setupIds.has(e.command.skillId))setupSpent+=R.techniqueCost(a,R.manualSkillFor(a,e.command.skillId));
  let targets=0;
  for(const enemy of e.before.actors.filter(t=>t.bot)){
   const after=e.after.actors.find(t=>t.uid===enemy.uid);if(!after)continue;
   const damage=Math.max(0,enemy.hp-after.hp);enemyHpDamage+=damage;
   if(damage)targets++;
   if(e.command.type==='manual'&&e.after.turn===e.before.turn){
    if(R.dist(enemy,after)>0)forcedMoves++;
    if(enemy.intent&&!after.intent&&after.hp>0)interrupts++;
   }
  }
  if(targets)hitActions++;if(targets>1)multiTargetActions++;
 };
 while(s.status==='active')s=S.playTurn(s,'seat0',{accuracy,seed,audit});
 const a=s.actors[0],m=s.pveMetrics;
 assert.ok(s.turn<=R.LIMITS.turns+1);assert.equal(answers,a.answered);assert.equal(correct,a.correct);
 assert.equal(m.answers,answers);assert.ok(m.staminaSpent>=0);assert.equal(m.outcome,s.winner==='player'?'win':'loss');
 return {weaponIds,level,stars,attack:raw.atk,maxHp:raw.maxHp,...scenario,seed,accuracy,...initial,
  outcome:m.outcome,reason:s.finishReason,turns:m.turns,answers,correct,wrong:answers-correct,
  answersToClear:m.outcome==='win'?answers:null,staminaSpent:m.staminaSpent,movementSpent,setupSpent,
  enemyHpDamage,damagePerStamina:m.staminaSpent?enemyHpDamage/m.staminaSpent:null,forcedMoves,interrupts,
  actions,hitActions,multiTargetActions,manualCasts:m.manualCasts,remainingHp:a.hp,
  lordDefeated:scenario.mode==='dungeon'?!s.actors.some(t=>t.weaponDungeonLord&&R.alive(t)):null};
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
 return {schema:1,shard,shards,policy:'tactical-balance heuristic; observed not minimum question count',rows};
}
if(require.main===module){
 const [shard='0',shards='12',out='/tmp/stage19-balance.json']=process.argv.slice(2);
 const report=runShard(Number(shard),Number(shards));
 fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log('Stage 19 combat cases completed: '+report.rows.length);
}
module.exports={runBattle,runShard,cases,specialPairs,seeds};

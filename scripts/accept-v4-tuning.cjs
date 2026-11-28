#!/usr/bin/env node
'use strict';
// V4 tuning A: exact source patch in a disposable CI checkout ONLY.
// Production stays at baseline until the paired experiment is reviewed.
const fs=require('node:fs'),assert=require('node:assert/strict');
const file='public/cultivation/weapon-dungeon-rules.js';
function candidateSource(source){
 const replace=(before,after,count=1)=>{
  assert.equal(source.split(before).length-1,count,'unexpected source anchor: '+before);
  source=source.split(before).join(after);
 };
 replace('const echo={...WILD_SHOCK.echo,power:.45+index*.03};','const echo={...WILD_SHOCK.echo,power:.45+index*.03+[0,0,0,.02,.04,.06][index]};');
 replace("dungeonSkills:wildSkills('lord',index),hpFactor:7+index*1.2,attackFactor:1+index*.12","dungeonSkills:wildSkills('lord',index),hpFactor:(7+index*1.2)*[1,1,1.05,1.1,1.15,1.2][index],attackFactor:1+index*.12");
 // Both original stone guards and extra high-tier guards; wild guards untouched.
 replace("dungeonSkills:peakSkills(row%2?'spirit':'heavy'),hpFactor:2.5+index*.35,attackFactor:.65+index*.09","dungeonSkills:peakSkills(row%2?'spirit':'heavy'),hpFactor:2.5+index*.35,attackFactor:(.65+index*.09)*[1,1,1,.95,.88,.8][index]");
 replace("hpFactor:2.5+index*.35,attackFactor:.65+index*.09,moveSteps:1,level:definition.stage});\n    const occupied=new Set(enemies.flatMap","hpFactor:2.5+index*.35,attackFactor:(.65+index*.09)*[1,1,1,.95,.88,.8][index],moveSteps:1,level:definition.stage});\n    const occupied=new Set(enemies.flatMap");
 return source;
}
function key(r){return [r.weaponIds.join('+'),r.dungeonId,r.difficulty,r.seed,r.accuracy].join('|');}
function run(shard,out){
 const M=require('../public/cultivation/manual-rules.js'),D=require('../public/cultivation/weapon-dungeon-rules.js'),A=require('./accept-new-weapon-balance.cjs');
 assert.equal(M.BOOKS.length,12);assert.ok(D.CATALOG.find(x=>x.id===D.WILD_ID).hidden);
 assert.ok(Math.abs(D.wildSkills('lord',5).find(x=>x.id==='wild-echo').power-.66)<1e-12);
 const all=[...M.BOOKS.map(b=>[b]),...A.specialPairs.map(ids=>ids.map(id=>M.BY_BOOK[id]))];
 const configs=all.filter((_,i)=>i%12===shard);
 const report=A.runV4Shard(configs);
 const old=JSON.parse(fs.readFileSync('docs/balance/weapon-dungeons-v4/baseline-f2bda52/shard-'+shard+'.json','utf8'));
 const previous=new Map(old.rows.map(row=>{const r=Object.fromEntries(old.columns.map((k,i)=>[k,row[i]]));return [key(r),r];}));
 assert.equal(report.rows.length,previous.size);
 const fields=['turns','answers','staminaSpent','observedHpLoss','forcedMoves','warningExits','warningEndTurnsWithoutReachableSafeCell'];
 const comparisons=report.rows.map(r=>{
  const b=previous.get(key(r));assert.ok(b,'missing baseline case');assert.equal(r.layoutHash,b.layoutHash);
  const unchanged=r.dungeonId===D.ID?r.difficulty<=2:r.difficulty<=1;
  if(unchanged){assert.equal(r.outcome,b.outcome);for(const f of fields)assert.equal(r[f],b[f],'untuned case changed: '+f);}
  return {key:key(r),before:b.outcome,after:r.outcome,delta:Object.fromEntries(fields.map(f=>[f,r[f]-b[f]]))};
 });
 fs.writeFileSync(out,JSON.stringify({candidate:'A',shard,sourceBaseline:'f2bda522f60a217960f6be8f5eda2a6393964aa3',report,comparisons},null,2)+'\n');
 console.log('V4_TUNING_COMPLETED '+JSON.stringify({shard,baseline:report.rows.length,growth:report.growthRows.length,flight:report.flightRows.length}));
}
if(require.main===module){
 if(process.argv[2]==='--prepare'){
  assert.equal(process.env.CI,'true','only patch a disposable CI checkout');
  fs.writeFileSync(file,candidateSource(fs.readFileSync(file,'utf8')));
 }else if(process.argv[2]==='--run'){
  const shard=Number(process.argv[3]);assert.ok(Number.isInteger(shard)&&shard>=0&&shard<12);
  run(shard,process.argv[4]);
 }else throw Error('Use --prepare or --run <shard> <out>');
}
module.exports={candidateSource};

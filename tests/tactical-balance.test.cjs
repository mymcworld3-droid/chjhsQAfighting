'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../scripts/lib/tactical-balance.cjs');
const Runner=require('../scripts/simulate-tactical-winrates.cjs');
const fs=require('node:fs'),path=require('node:path');
const strip=s=>({...s,events:[],receipts:[],rewarded:[]});

test('balance simulations are deterministic, bounded and execute only real legal actions and answers',()=>{
  let actions=0,answers=0;
  const audit=e=>{
    const expected=e.type==='answer'?S.R.answer(strip(e.before),e.uid,e.correct,S.NOW):S.R.apply(strip(e.before),e.uid,e.command,S.NOW);
    assert.deepEqual(e.after,expected);if(e.type==='answer')answers++;else actions++;
    for(const a of e.after.actors){assert.ok(a.hp>=0&&a.hp<=a.maxHp);assert.ok(a.stamina>=0&&a.stamina<=10);assert.ok(S.R.inside(e.after,a));}
  };
  for(const v of S.variants){
    const other=S.variants.find(v=>v.id==='thunder.counter'),config={accuracy:.7,seed:'reproducible'};
    const first=S.duel(v,other,{...config,audit}),second=S.duel(v,other,config);assert.deepEqual(first,second);assert.ok(first.turns<=61);
    const pve=S.trial(v,{stage:20,accuracy:.7,seed:'reproducible',audit});assert.ok(pve.turns<=61);assert.ok(['player','monster','draw'].includes(pve.winner));
  }
  assert.ok(actions>200&&answers>100);
});

test('every equipped tactical branch is available to the policy without inventing resources or multipliers',()=>{
  for(const v of S.variants){
    const s=S.R.create({id:'options',mode:'pvp',players:[S.fighter(v,'a'),S.fighter(S.variants[0],'b')],now:S.NOW});
    s.blocks=[];Object.assign(s.actors[0],{x:1,y:3,stamina:10,hp:400});Object.assign(s.actors[1],{x:2,y:3});
    const choices=S.options(s,s.actors[0]);assert.ok(choices.some(o=>o.command.type==='skill'),v.id);
    for(const option of choices)assert.doesNotThrow(()=>S.R.apply(s,'a',option.command,S.NOW),v.id);
    s.actors[0].stamina=0;assert.ok(S.options(s,s.actors[0]).every(o=>o.command.type==='guard'));
  }
});

test('matchup batches pair identical answer seeds across all maps and both seats; aggregates conserve outcomes',()=>{
  const a='ocean.surge',b='thunder.lightning',row=Runner.duelJob({kind:'pvp',a,b,accuracy:.7,seeds:2,baseline:false});
  assert.equal(row.games,12);assert.equal(row.winsA+row.winsB+row.draws,row.games);
  assert.ok(row.byMap.every(m=>m.games===4));assert.ok(row.clusters.every(c=>c.games===6));
  const emptyPairs=[];for(let i=0;i<S.variants.length;i++)for(let j=i+1;j<S.variants.length;j++){
    if(!i)continue;const va=S.variants[i],vb=S.variants[j];emptyPairs.push({a:va.id,b:vb.id,seeds:2,games:12,winsA:5,winsB:5,draws:2,castsA:12,castsB:12,seat0Wins:6,turnLimit:2,totalTurns:144,
      clusters:[0,1].map(seed=>({seed,games:6,winsA:seed?2:3,winsB:seed?3:2,draws:1}))});
  }
  const summary=Runner.summarize(emptyPairs,.7);assert.equal(summary.rows.length,18);assert.equal(summary.byCore.length,9);
  assert.ok(summary.rows.every(r=>r.games===204&&r.wins+r.losses+r.draws===204));
  assert.ok(Math.abs(summary.rows.reduce((n,r)=>n+r.scorePercent,0)/18-50)<1e-9);
  for(const r of summary.rows)assert.ok(r.ci95[0]<=r.winPercent&&r.ci95[1]>=r.winPercent);
  assert.throws(()=>Runner.parse(['--seeds','0']),/Invalid/);assert.throws(()=>Runner.parse(['--unknown','2']),/Unknown/);
});

test('published balance counts cover every matchup, paired seed and trial without losing or duplicating outcomes',()=>{
  const d=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/balance/tactical-v1/results.json'),'utf8'));
  let total=0;
  for(const table of d.pvp){
    assert.equal(table.pairs.length,153);assert.equal(new Set(table.pairs.map(p=>[p.a,p.b].sort().join('/'))).size,153);
    for(const pair of table.pairs){
      assert.equal(pair.seeds,table.accuracy===d.config.mainAccuracy?d.config.seeds:d.config.sensitivitySeeds);
      assert.equal(pair.games,pair.seeds*6);assert.equal(pair.winsA+pair.winsB+pair.draws,pair.games);total+=pair.games;
      for(const key of ['games','winsA','winsB','draws'])assert.equal(pair.clusters.reduce((n,c)=>n+c[key],0),pair[key]);
      assert.ok(pair.byMap.every(m=>m.games===pair.seeds*2));
    }
    const repeated=Runner.summarize(table.pairs,table.accuracy);assert.deepEqual(repeated,table.summary);
  }
  assert.equal(d.baseline.length,18);for(const row of d.baseline){assert.equal(row.winsA+row.winsB+row.draws,row.games);total+=row.games;}
  assert.equal(d.pve.length,19*d.config.stages.length);
  for(const row of d.pve){assert.equal(row.wins+row.losses,row.games);assert.equal(row.games,d.config.pveSeeds);total+=row.games;}
  const expected=153*6*(d.config.seeds+2*d.config.sensitivitySeeds)+18*6*d.config.seeds+19*d.config.stages.length*d.config.pveSeeds;
  assert.equal(total,expected);
});

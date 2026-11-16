'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js');
const api=require('../tactical-combat-api.cjs').__test;
const {database}=require('./helpers/tactical-db.cjs');
const now=2000000000000;
function scene(stage){
  const s=R.create({id:'v4',players:[{uid:'u',atk:200,maxHp:2000}],trial:{seed:'testing',stage,layoutVersion:4},now});
  s.blocks=[];Object.assign(s.actors[0],{x:1,y:1,stamina:10,answered:1,correct:1});
  return s;
}
test('v4 schedule and seeded layouts are stable and retain v3 compatibility',()=>{
  const modes=['elimination','elimination','elimination','elimination','elimination','defense','elimination','sealing','elimination','boss','defense','sealing','elimination','defense','boss','elimination','sealing','elimination','defense','boss'];
  for(let stage=1;stage<=35;stage++){
    const l=R.stageLayout('schedule',stage,4);assert.deepEqual(l,R.stageLayout('schedule',stage,4));
    if(stage<=20)assert.equal(l.mode,modes[stage-1]);
    if(stage>20&&stage%5===0){assert.equal(l.mode,'boss');assert.deepEqual(Array.from({length:4},(_,i)=>R.stageLayout('schedule',stage-4+i,4).mode).sort(),['defense','elimination','elimination','sealing']);}
  }
  assert.equal(R.stageLayout('schedule',6,3).mode,'transport');
  assert.deepEqual([10,15,20].map(n=>R.stageLayout('schedule',n,4).enemies[0].bossKind),['rock','vine','flame']);
});
test('v4 generated objectives are connected and boss has room to move',()=>{
  for(let seed=0;seed<100;seed++)for(const stage of [6,8,10,11,12,14,15,17,19,20,24,25]){
    const l=R.stageLayout('seed-'+seed,stage,4),walls=new Set(l.blocks.map(R.key)),seen=new Set([R.key(l.spawn)]),q=[l.spawn];
    for(let i=0;i<q.length;i++)for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]){const p={x:q[i].x+dx,y:q[i].y+dy},k=R.key(p);if(p.x>=0&&p.x<l.width&&p.y>=0&&p.y<l.height&&!walls.has(k)&&!seen.has(k)){seen.add(k);q.push(p);}}
    assert.equal(seen.size,l.width*l.height-l.blocks.length,`${seed}/${stage}`);
    for(const p of [...(l.objective.points||[]),...(l.objective.shrine?[l.objective.shrine]:[])])assert.ok(seen.has(R.key(p)));
    if(l.mode==='defense'){
      const c=l.objective.shrine,sides=new Set(l.enemies.map(e=>{const x=e.x-c.x,y=e.y-c.y;return Math.abs(x)>=Math.abs(y)?x<0?'west':'east':y<0?'north':'south';}));
      assert.ok(sides.size>=2,`one-direction attack ${seed}/${stage}`);
    }
    if(l.mode==='boss'){const b=l.enemies[0];assert.ok([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>R.footprint({...b,x:b.x+dx,y:b.y+dy}).every(p=>seen.has(R.key(p)))));}
  }
});
test('v4 sealing requires attacks, removes its maze gate, and does not award kill experience',()=>{
  let s=scene(8);s.actors=s.actors.slice(0,2);Object.assign(s.actors[1],{x:6,y:6});
  s.objective={type:'sealing',points:[{x:3,y:1,kind:'maze',hp:2,maxHp:2,activated:false,gate:{x:4,y:4}}],completed:false};s.blocks=[{x:4,y:4}];
  s=R.apply(s,'u',{type:'move',x:2,y:1},now);assert.equal(s.objective.points[0].hp,2);
  s=R.apply(s,'u',{type:'attack',x:3,y:1},now);assert.equal(s.objective.points[0].hp,1);
  s=R.apply(s,'u',{type:'attack',x:3,y:1},now);assert.equal(s.status,'finished');assert.equal(s.winner,'player');assert.equal(s.blocks.length,0);assert.equal(s.manualExp,undefined);
});
test('defense survives exactly four enemy phases and reinforcements are capped',()=>{
  let s=scene(6);s.actors=s.actors.slice(0,2);Object.assign(s.actors[0],{x:0,y:0,maxHp:100000,hp:100000});Object.assign(s.objective,{hp:100000,maxHp:100000});
  Object.assign(s.actors[1],{x:1,y:5,atk:1});R.prepareIntents(s);
  for(let i=0;i<4;i++){s=R.apply(s,'u',{type:'end'},now);assert.ok(s.actors.filter(a=>a.bot&&R.alive(a)).length<=5);if(i<3)assert.equal(s.status,'active');}
  assert.equal(s.objective.completedRounds,4);assert.equal(s.winner,'player');
});
test('waiting without defending does not routinely clear the first defense stage',()=>{
  let wins=0;
  for(let i=0;i<40;i++){
    let s=R.create({id:'idle',players:[{uid:'u',atk:200,maxHp:1000}],trial:{seed:'balance'+i,stage:6,layoutVersion:4},now});
    s.actors[0].answered=1;
    for(let turn=0;turn<4&&s.status==='active';turn++)s=R.apply(s,'u',{type:'end'},now);
    if(s.winner==='player')wins++;
  }
  assert.ok(wins<20,`idle won ${wins}/40`);
});
test('destroying the shrine loses before round completion',()=>{
  let s=scene(6);s.actors=s.actors.slice(0,2);s.objective.shrine={x:4,y:3};s.objective.hp=1;
  Object.assign(s.actors[0],{x:1,y:1});Object.assign(s.actors[1],{x:4,y:2,atk:20});R.prepareIntents(s);
  assert.equal(s.actors[1].intent.kind,'defense-attack');s=R.apply(s,'u',{type:'end'},now);
  assert.equal(s.winner,'monster');assert.equal(s.finishReason,'shrine');
});
test('simultaneous player and shrine destruction resolves as player defeat',()=>{
  let s=scene(6);s.actors=s.actors.slice(0,2);s.objective.shrine={x:4,y:3};s.objective.hp=1;
  Object.assign(s.actors[0],{x:4,y:3,hp:1});Object.assign(s.actors[1],{x:4,y:2,atk:20});R.prepareIntents(s);
  s=R.apply(s,'u',{type:'end'},now);assert.equal(s.actors[0].hp,0);assert.equal(s.objective.hp,0);
  assert.equal(s.winner,'monster');assert.equal(s.finishReason,'hp');assert.equal(s.pveMetrics.reason,'hp');
});
test('throw interrupts a warned attack on the shrine',()=>{
  let s=scene(6);s.actors=s.actors.slice(0,2);s.objective.shrine={x:4,y:3};
  Object.assign(s.actors[0],{x:4,y:1,manualSkills:['tiger-throw'],trainingAccessScore:68});
  Object.assign(s.actors[1],{x:4,y:2,hp:2000,maxHp:2000});R.prepareIntents(s);
  assert.equal(s.actors[1].intent.kind,'defense-attack');const hp=s.objective.hp;
  s=R.apply(s,'u',{type:'manual',skillId:'tiger-throw',x:4,y:2},now);
  assert.equal(s.actors[1].intent.kind,'stagger');s=R.apply(s,'u',{type:'end'},now);assert.equal(s.objective.hp,hp);
  assert.equal(s.pveMetrics.manualCasts['tiger-throw'],1);assert.equal(s.pveMetrics.staminaSpent,4);
});
test('v4 seal buffs and hazards stop when their source is destroyed',()=>{
  let s=scene(8);s.actors=s.actors.slice(0,2);Object.assign(s.actors[0],{x:1,y:1});Object.assign(s.actors[1],{x:3,y:1,hp:2000,maxHp:2000});
  s.objective={type:'sealing',points:[{x:4,y:1,kind:'shield',hp:1,activated:false},{x:6,y:5,kind:'hazard',hp:1,activated:false}],completed:false};
  s=R.apply(s,'u',{type:'attack',x:2,y:1},now);assert.equal(s.actors[1].hp,1870);
  s.turn=2;R.prepareIntents(s);assert.deepEqual(s.objective.hazards,[{x:1,y:1}]);
  s.objective.points[1].activated=true;R.prepareIntents(s);assert.deepEqual(s.objective.hazards,[]);
});
test('destroying a warning source cancels its already telegraphed hazard',()=>{
  let s=scene(8);s.actors=s.actors.slice(0,2);Object.assign(s.actors[1],{x:6,y:6});s.turn=2;
  s.objective={type:'sealing',points:[{x:2,y:1,kind:'hazard',hp:1,activated:false},{x:6,y:5,kind:'rage',hp:2,activated:false}],completed:false};
  R.prepareIntents(s);assert.equal(s.objective.hazards.length,1);const hp=s.actors[0].hp;
  s=R.apply(s,'u',{type:'attack',x:2,y:1},now);assert.deepEqual(s.objective.hazards,[]);
  s=R.apply(s,'u',{type:'end'},now);assert.equal(s.actors[0].hp,hp);
});
test('defense completion and rewards are settled only once on a retried request',async()=>{
  const db=database(),start=await api.start(db,'u1',{mode:'pve'},now),s=db.records.get(api.ROOMS+'/'+start.id);
  s.blocks=[];s.objective={type:'defense',shrine:{x:4,y:3},hp:5000,maxHp:5000,rounds:4,completedRounds:3,spawnIndex:0,completed:false};
  Object.assign(s.actors[0],{x:1,y:1,answered:1,correct:1});Object.assign(s.actors[1],{x:6,y:6});R.prepareIntents(s);
  const req={roomId:start.id,revision:start.revision,requestId:'defense-win-once',type:'end'};
  const win=await api.command(db,'u1',req,now),again=await api.command(db,'u1',req,now);
  assert.equal(win.winner,'player');assert.equal(win.nextStage,2);assert.equal(again.nextStage,2);
  assert.equal(db.records.get(api.PLAYERS+'/u1').trial.stage,2);assert.equal(db.records.get('users/u1').stats.gold,150);
});

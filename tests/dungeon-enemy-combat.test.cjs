'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {generateDungeonLayout,walkable}=require('../dungeon-map-generator.cjs');
const AI=require('../dungeon-enemy-ai.cjs');
const Combat=require('../dungeon-enemy-combat.cjs');
const {moveOnMap}=require('../dungeon-movement.cjs');
const start=1800000000000;
const map=generateDungeonLayout('stage10-combat-determinism');
const clone=x=>structuredClone(x);
const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const dirs=[[0,1],[1,0],[0,-1],[-1,0]];
const nextTo=p=>dirs.map(([dx,dy])=>({x:p.x+dx,y:p.y+dy}))
  .find(q=>walkable(map,q));
const core=(enemy,player)=>{
  const e={...AI.initialEnemies(map)[0],...enemy,attack:null,lastAttack:null,
    lastAttackTick:0,lastActionTick:0};
  return {mode:'dungeon',status:'assembled',
    battleStartedAtMs:start,battleAppliedTick:0,
    enemyAiVersion:AI.ENEMY_AI_VERSION,enemies:[e],
    members:{a:{uid:'a',joinedAtMs:1,position:clone(player),battleHealth:100,
      battleMaxHealth:100,explorationStamina:100,downed:false,moveSeq:0}}};
};
const apply=(room,tick)=>({...room,...AI.advanceWorld(room,map,start+tick*1000)});
test('wolf attack telegraphs exact adjacent tile at T2, resolves only at T4',()=>{
  const player=map.spawnPads[0],enemy={kind:'wolf',cadence:2,position:nextTo(player)};
  let room=core(enemy,player);
  room=apply(room,2);
  const warning=room.enemies[0].attack;
  assert.equal(warning.startedAtTick,2);
  assert.equal(warning.resolvesAtTick,4);
  assert.equal(warning.damage,8);
  assert.deepStrictEqual(warning.cells,[player]);
  assert.equal(room.members.a.battleHealth,100);
  const repeated=AI.advanceWorld(room,map,start+2*1000);
  assert.equal(repeated,null);
  room=apply(room,3);
  assert.equal(room.members.a.battleHealth,100);
  room=apply(room,4);
  assert.equal(room.members.a.battleHealth,92);
  assert.equal(room.members.a.lastDamage.tick,4);
  assert.deepStrictEqual(room.enemies[0].lastAttack.hits,['a']);
  assert.equal(room.enemies[0].attack,null);
  assert.equal(AI.advanceWorld(room,map,start+4000),null);
});
test('moving out of a warned tile during windup avoids all damage',()=>{
  const p=map.mainRoute[3],e={kind:'wolf',cadence:2,position:nextTo(p)};
  let room=core(e,p);
  room=apply(room,2);
  const free=dirs.find(([dx,dy])=>walkable(map,{x:p.x+dx,y:p.y+dy})&&
    !(e.position.x===p.x+dx&&e.position.y===p.y+dy));
  assert.ok(free);
  const moved=moveOnMap(room,'a',map,{dx:free[0],dy:free[1],step:1});
  room={...room,members:moved.members};
  room=apply(room,4);
  assert.equal(room.members.a.battleHealth,100);
  assert.deepStrictEqual(room.enemies[0].lastAttack.hits,[]);
  assert.equal(room.members.a.explorationStamina,9);
});
test('wisp attack is a two-tile unobstructed ray, golem warns on fan tiles',()=>{
  const first=map.mainRoute[5],neighbor=map.mainRoute[6];
  const ray={kind:'wisp',position:first},fire=Combat.warningCells(map,ray,neighbor);
  assert.ok(fire.some(x=>x.x===neighbor.x&&x.y===neighbor.y));
  assert.ok(fire.length>=1&&fire.length<=2);
  for(const p of fire)assert.equal(walkable(map,p),true);
  const golem={kind:'golem',position:first};
  const fan=Combat.warningCells(map,golem,neighbor);
  assert.ok(fan.some(p=>p.x===neighbor.x&&p.y===neighbor.y));
  assert.ok(fan.length>=1&&fan.length<=4);
  assert.ok(fan.every(p=>walkable(map,p)));
  assert.deepStrictEqual(Combat.warningCells(map,{kind:'wolf',position:first},
    {x:map.width,y:0}),[]);
});
test('warning cells hit every living player in area exactly once and mark downed',()=>{
  const p=map.spawnPads[0],e={kind:'wolf',position:nextTo(p),id:'beast-1'};
  const attack=Combat.planAttack(map,e,{a:{position:p}},2);
  assert.ok(attack);
  const players={a:{position:p,battleHealth:8,explorationStamina:99},
    b:{position:p,battleHealth:100,explorationStamina:21},
    c:{position:nextTo(p),battleHealth:100}};
  const resolved=Combat.resolveAttack({...e,attack},players,4);
  assert.deepStrictEqual(resolved.hits,['a','b']);
  assert.equal(resolved.members.a.battleHealth,0);
  assert.equal(resolved.members.a.downed,true);
  assert.equal(resolved.members.b.battleHealth,92);
  assert.equal(resolved.members.c.battleHealth,100);
  assert.equal(resolved.members.a.explorationStamina,99);
  assert.deepStrictEqual(players.a,{position:p,battleHealth:8,explorationStamina:99});
});
test('downed players cannot step or attract another target',()=>{
  const p=map.spawnPads[0],e={position:nextTo(p)};
  let room=core(e,p);
  room.members.a={...room.members.a,battleHealth:0,downed:true};
  const [dx,dy]=dirs.find(([dx,dy])=>walkable(map,{x:p.x+dx,y:p.y+dy}));
  assert.throws(()=>moveOnMap(room,'a',map,{dx,dy,step:1}),
    err=>err.status===409&&/倒地/.test(err.message));
  assert.equal(Combat.planAttack(map,{...e,kind:'wolf'},room.members,2),null);
});
test('offline tick catch-up never applies unseen hits or retroactive defeat',()=>{
  const p=map.spawnPads[0],e={kind:'wolf',cadence:2,position:nextTo(p)};
  let room=core(e,p);
  room=apply(room,2);
  assert.ok(room.enemies[0].attack);
  const restored=apply(room,50);
  assert.equal(restored.members.a.battleHealth,100);
  assert.equal(restored.battleAppliedTick,50);
  assert.equal(restored.enemies[0].attack?.startedAtTick??0,50);
  assert.equal(restored.enemies[0].lastAttack?.hits?.length??0,0);
});
test('hit logic is deterministic and server moves only one tile at a time',()=>{
  const p=map.spawnPads[0],e={kind:'wolf',cadence:2,position:nextTo(p)};
  let r1=core(e,p),r2=clone(r1);
  for(const tick of [2,3,4,5,6,7,8,9]){
    r1=apply(r1,tick);r2=apply(r2,tick);
    assert.deepStrictEqual(r1,r2);
  }
  assert.ok(r1.members.a.battleHealth<100);
  assert.equal(r1.members.a.explorationStamina,100);
  assert.ok(r1.enemies.every(enemy=>walkable(map,enemy.position)));
});

test('a lagged transaction cannot both create and resolve an unseen warning',()=>{
  const p=map.spawnPads[0],e={kind:'wolf',cadence:2,position:nextTo(p)};
  let room=core(e,p);
  room=apply(room,3); // attack started at T2 but only committed now
  assert.equal(room.members.a.battleHealth,100);
  assert.ok(room.enemies[0].attack);
  const armed=room.enemies[0].attack;
  assert.equal(armed.resolvesAtTick,5);
  room=apply(room,4);
  assert.equal(room.members.a.battleHealth,100);
  room=apply(room,5);
  assert.equal(room.members.a.battleHealth,92);
  // Bigger catch-up: plan at T2 then T4 would have resolved invisibly,
  // so the deadline is pushed at least two ticks past publication.
  let delayed=core(e,p);
  delayed=apply(delayed,4);
  assert.equal(delayed.members.a.battleHealth,100);
  assert.ok(delayed.enemies[0].attack);
  assert.ok(delayed.enemies[0].attack.resolvesAtTick>=6);
  delayed=apply(delayed,5);
  assert.equal(delayed.members.a.battleHealth,100);
  delayed=apply(delayed,6);
  assert.equal(delayed.members.a.battleHealth,92);
});

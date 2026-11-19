'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {generateDungeonLayout,walkable}=require('../dungeon-map-generator.cjs');
const {initialClock}=require('../dungeon-battle-clock.cjs');
const AI=require('../dungeon-enemy-ai.cjs');
const FROM=1800000000000,SEED='abcdef0123456789abcdef01';
const map=generateDungeonLayout(SEED);
const deepClone=x=>structuredClone(x);
const coord=p=>p.x+','+p.y;
const d=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const makeRoom=(m=map)=>{
  const start={...m.spawnPads[0]};
  return {mode:'dungeon',status:'assembled',assembledAtMs:FROM,
    ...initialClock(FROM),enemyAiVersion:AI.ENEMY_AI_VERSION,
    enemies:AI.initialEnemies(m),members:{
      a:{uid:'a',position:start,explorationStamina:100,moveSeq:0},
      b:{uid:'b',position:{...m.spawnPads[1]},explorationStamina:100,moveSeq:0}
    }};
};
test('1200 terrain seeds spawn 4-6 unique, walkable and safe autonomous beasts',()=>{
  const types=new Set(),counts=new Set();
  for(let i=0;i<1200;i++){
    const layout=generateDungeonLayout('stage9-seed-'+i);
    const first=AI.initialEnemies(layout),repeat=AI.initialEnemies(layout);
    assert.deepStrictEqual(first,repeat);
    assert.ok(first.length>=4&&first.length<=6,'seed '+i);
    const occupied=new Set();
    for(const beast of first){
      assert.equal(walkable(layout,beast.position),true);
      assert.ok(!occupied.has(coord(beast.position)));
      occupied.add(coord(beast.position));
      assert.ok(layout.spawnPads.every(p=>!coord(p)||coord(p)!==coord(beast.position)));
      assert.ok(beast.cadence===2||beast.cadence===3);
      assert.ok(beast.aggroRange>=6&&beast.aggroRange<=10);
      assert.match(beast.id,/^beast-\d+$/);
      assert.ok(AI.routeFor(layout,beast.zone).length>2);
      types.add(beast.kind);
    }
    counts.add(first.length);
  }
  assert.deepStrictEqual([...types].sort(),['golem','wisp','wolf']);
  assert.ok(counts.size>=3);
});
test('BFS only traverses walls via 4-neighbor tiles and respects search limit',()=>{
  const from=map.spawn,to=map.guardianSite;
  const unreachable=AI.shortestStep(map,from,to,8);
  assert.equal(unreachable,null);
  const found=AI.shortestStep(map,from,to);
  assert.ok(found?.length>50);
  assert.ok(d(from,found.step)===1);
  assert.equal(walkable(map,found.step),true);
  assert.equal(AI.shortestStep(map,from,from).length,0);
  assert.equal(AI.shortestStep(map,{x:-1,y:0},from),null);
  assert.equal(AI.shortestStep(map,from,{x:0,y:0}),null);
  // Every direct neighbor of a patrol point must have a length-1 BFS.
  const p=map.mainRoute[20],q=map.mainRoute[21];
  assert.deepStrictEqual(AI.shortestStep(map,p,q,1),{step:q,length:1});
});
test('enemy cadence is driven by server tick, not any player event',()=>{
  const members={},enemy=AI.initialEnemies(map).find(e=>e.kind==='wolf');
  assert.ok(enemy);
  const originals=deepClone(enemy),noCollision=new Set();
  assert.deepStrictEqual(AI.nextEnemy(map,enemy,members,1,noCollision),enemy);
  const first=AI.nextEnemy(map,enemy,members,enemy.cadence,noCollision);
  assert.ok(d(first.position,enemy.position)<=1);
  assert.equal(first.lastActionTick,enemy.cadence);
  assert.equal(walkable(map,first.position),true);
  assert.deepStrictEqual(enemy,originals);
});
test('enemy sees nearby players, seeks by BFS and stops short of player cells',()=>{
  const enemy=AI.initialEnemies(map)[0],path=AI.routeFor(map,enemy.zone);
  const n=Math.max(0,enemy.patrolIndex-3);
  const target={...path[n]};
  assert.ok(d(enemy.position,target)<=enemy.aggroRange);
  const members={a:{position:target}};
  const updated=AI.nextEnemy(map,enemy,members,enemy.cadence,new Set());
  assert.ok(['pursuit','alert'].includes(updated.intent));
  assert.equal(updated.targetUid,'a');
  assert.ok(d(updated.position,enemy.position)<=1);
  assert.equal(walkable(map,updated.position),true);
  assert.notDeepStrictEqual(updated.position,target);
  const nearby=AI.nextEnemy(map,{...enemy,position:{...path[n+1]}},
    members,enemy.cadence,new Set());
  assert.equal(nearby.intent,'alert');
  assert.notDeepStrictEqual(nearby.position,target);
});
test('AI respects other creature occupancy and never skips blocked patrol points',()=>{
  const enemy=AI.initialEnemies(map)[0],path=AI.routeFor(map,enemy.zone);
  const i=enemy.patrolIndex+(enemy.patrolDirection||-1);
  assert.ok(i>=0&&i<path.length);
  const blocked=AI.nextEnemy(map,enemy,{},enemy.cadence,new Set([coord(path[i])]));
  assert.deepStrictEqual(blocked.position,enemy.position);
  assert.equal(blocked.patrolIndex,enemy.patrolIndex);
  const free=AI.nextEnemy(map,blocked,{},enemy.cadence*2,new Set());
  assert.ok(d(free.position,blocked.position)<=1);
  assert.equal(walkable(map,free.position),true);
});
test('bounded catch-up never loops over hours and never alters player resources',()=>{
  const room=makeRoom(),original=deepClone(room);
  const patch=AI.advanceWorld(room,map,FROM+1200*1000);
  assert.equal(patch.battleAppliedTick,1200);
  assert.equal(patch.battleAppliedAtMs,FROM+1200*1000);
  assert.equal(patch.enemies.length,room.enemies.length);
  const withPatch={...room,...patch};
  assert.equal(AI.advanceWorld(withPatch,map,FROM+1200*1000),null);
  assert.deepStrictEqual(room,original);
  assert.deepStrictEqual(withPatch.members,room.members);
  assert.equal(AI.MAX_CATCHUP_TICKS,24);
  assert.equal(AI.advanceWorld({...room,status:'waiting'},map,FROM+5000),null);
});
test('sequential replay produces legal 1-step AI transitions without teleports',()=>{
  let room=makeRoom();
  const before=deepClone(room);
  let hadMotion=false;
  for(let tick=1;tick<=32;tick++){
    const patch=AI.advanceWorld(room,map,FROM+tick*1000);
    assert.ok(patch);
    assert.equal(patch.battleAppliedTick,tick);
    assert.equal(patch.enemies.length,room.enemies.length);
    const occupied=new Set();
    for(let i=0;i<room.enemies.length;i++){
      const a=room.enemies[i],b=patch.enemies[i];
      const delta=d(a.position,b.position);
      assert.ok(delta<=1,'NPC teleported at T'+tick);
      hadMotion||=delta===1;
      assert.ok(walkable(map,b.position));
      assert.ok(!occupied.has(coord(b.position)),'NPC stack at T'+tick);
      occupied.add(coord(b.position));
      assert.ok(Object.values(room.members).every(m=>coord(m.position)!==coord(b.position)));
    }
    room={...room,...patch};
  }
  assert.ok(hadMotion);
  assert.deepStrictEqual(room.members,before.members);
});
test('previous assembled rooms without beasts initialize on next authoritative tick',()=>{
  const room=makeRoom();
  delete room.enemies;delete room.enemyAiVersion;
  const patch=AI.advanceWorld(room,map,FROM);
  assert.ok(Array.isArray(patch.enemies));
  assert.equal(patch.enemyAiVersion,AI.ENEMY_AI_VERSION);
  assert.equal(patch.battleAppliedTick,undefined);
  const synced={...room,...patch};
  assert.equal(AI.advanceWorld(synced,map,FROM),null);
  assert.equal(AI.advanceWorld(synced,map,FROM+1500).battleAppliedTick,1);
  assert.throws(()=>AI.advanceWorld({...room,enemyAiVersion:555},map,FROM+2000),
    error=>error.status===409);
});

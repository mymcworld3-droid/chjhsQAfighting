'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {generateDungeonLayout,walkable}=require('../dungeon-map-generator.cjs');
const {initialEnemies}=require('../dungeon-enemy-ai.cjs');
const {strikeEnemy,STAMINA_COST,DAMAGE,maxHealth}=require('../dungeon-player-combat.cjs');

const map=generateDungeonLayout('0a1b2c3d4e5f60718293a4b5');
const enemy=initialEnemies(map).find(e=>e.kind==='wolf');
const spot=[[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>
  ({x:enemy.position.x+dx,y:enemy.position.y+dy})).find(p=>walkable(map,p));
assert.ok(spot);
const member=(uid,position=spot)=>({uid,position,explorationStamina:12,
  battleHealth:100,downed:false,strikeSeq:0,lastStrike:null});
function room(){
  return {status:'assembled',battleAppliedTick:0,enemies:[structuredClone(enemy)],
    members:{a:member('a'),b:member('b')}};
}
test('cooperative strike costs stamina and damages only targeted enemy',()=>{
  const original=room();
  const out=strikeEnemy(original,'a',map,{enemyId:enemy.id,seq:1});
  assert.equal(out.duplicate,false);
  assert.equal(out.members.a.explorationStamina,12-STAMINA_COST);
  assert.equal(out.members.b.explorationStamina,12);
  assert.equal(out.enemies[0].battleHealth,maxHealth(enemy.kind)-DAMAGE);
  assert.equal(original.enemies[0].battleHealth,maxHealth(enemy.kind));
  assert.equal(original.members.a.strikeSeq,0,'pure update');
});
test('same committed request is idempotent; different target or skipped sequence fails',()=>{
  const first=strikeEnemy(room(),'a',map,{enemyId:enemy.id,seq:1});
  const state={status:'assembled',battleAppliedTick:0,...first};
  const retry=strikeEnemy(state,'a',map,{enemyId:enemy.id,seq:1});
  assert.equal(retry.duplicate,true);
  assert.equal(retry.members.a.explorationStamina,10);
  assert.throws(()=>strikeEnemy(state,'a',map,{enemyId:enemy.id,seq:3}),/不同步/);
  assert.throws(()=>strikeEnemy(state,'a',map,{enemyId:'beast-9999',seq:1}),/不同步/);
});
test('two different players defeat exactly one shared beast, with no double damage',()=>{
  const first=strikeEnemy(room(),'a',map,{enemyId:enemy.id,seq:1});
  const second=strikeEnemy({status:'assembled',battleAppliedTick:0,...first},
    'b',map,{enemyId:enemy.id,seq:1});
  assert.equal(second.enemies.length,0);
  assert.equal(second.members.a.explorationStamina,10);
  assert.equal(second.members.b.explorationStamina,10);
  assert.equal(second.members.b.lastStrike.defeated,true);
  assert.throws(()=>strikeEnemy({status:'assembled',...second},
    'a',map,{enemyId:enemy.id,seq:2}),/已被擊敗/);
});
test('rejects forging, range, zero energy and downed players without mutation',()=>{
  const s=room(),before=structuredClone(s);
  assert.throws(()=>strikeEnemy(s,'a',map,{enemyId:enemy.id,seq:0}),/序號/);
  assert.throws(()=>strikeEnemy(s,'c',map,{enemyId:enemy.id,seq:1}),/隊員/);
  s.members.a.position=map.spawn;
  if(Math.abs(map.spawn.x-enemy.position.x)+Math.abs(map.spawn.y-enemy.position.y)>1)
    assert.throws(()=>strikeEnemy(s,'a',map,{enemyId:enemy.id,seq:1}),/相鄰/);
  s.members.a.position=spot;s.members.a.explorationStamina=0;
  assert.throws(()=>strikeEnemy(s,'a',map,{enemyId:enemy.id,seq:1}),/不足/);
  s.members.a.explorationStamina=10;s.members.a.downed=true;
  assert.throws(()=>strikeEnemy(s,'a',map,{enemyId:enemy.id,seq:1}),/倒地/);
  assert.equal(before.enemies[0].battleHealth,s.enemies[0].battleHealth);
});

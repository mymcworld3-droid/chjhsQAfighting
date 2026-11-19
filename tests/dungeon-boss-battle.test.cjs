'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Boss=require('../dungeon-boss-battle.cjs');
const {generateDungeonLayout,walkable}=require('../dungeon-map-generator.cjs');
const {initialClock}=require('../dungeon-battle-clock.cjs');
const FROM=1800000000000;
const seed='stage15-deterministic-boss-room';
function fixture(){
  const map=generateDungeonLayout(seed);
  const members={a:{uid:'a',joinedAtMs:1,position:{...map.portalSite},
    explorationStamina:82,battleHealth:76,focusCharges:4,moveSeq:21},
    b:{uid:'b',joinedAtMs:2,position:{...map.spawn},
      explorationStamina:55,battleHealth:90,focusCharges:0,moveSeq:0}};
  return {map,room:{id:'dungroom01234567890',mode:'dungeon',
    status:'assembled',mapSeed:seed,assembledAtMs:FROM,
    ...initialClock(FROM),battleAppliedTick:0,dungeonArena:'exploration',
    dungeonProgress:{keyAcquired:true,portalStatus:'open'},members,enemies:[]}};
}
const xy=p=>p.x+','+p.y;
test('600 arena seeds create stable fully walkable boss footprint and disjoint four spawns',()=>{
  for(let i=0;i<600;i++){
    const map=Boss.mapFor('boss-seed-'+i);
    assert.deepStrictEqual(map,Boss.mapFor('boss-seed-'+i));
    assert.equal(map.arena,'boss');
    assert.equal(map.mode,'dungeon');
    assert.equal(map.width,23);
    assert.equal(map.height,17);
    assert.ok(map.tiles.every(x=>[0,1,2].includes(x)));
    assert.ok(map.spawnPads.every(p=>walkable(map,p)));
    assert.equal(new Set(map.spawnPads.map(xy)).size,4);
    const boss=Boss.initialBoss();
    assert.equal(new Set(Boss.cells(boss).map(xy)).size,4);
    assert.ok(Boss.cells(boss).every(p=>walkable(map,p)));
    assert.ok(Boss.cells(boss).every(p=>map.spawnPads.every(s=>xy(p)!==xy(s))));
    assert.equal(Boss.reach({x:11,y:8},boss),1);
    assert.equal(Boss.occupies(boss,{x:12,y:7}),true);
    assert.equal(Boss.occupies(boss,{x:13,y:7}),false);
    assert.equal(map.tiles[0],0);
  }
});
test('only a living member standing near activated portal can teleport all teammates once',()=>{
  const {map,room}=fixture();
  assert.throws(()=>Boss.enter({...room,dungeonProgress:{
    keyAcquired:false,portalStatus:'open'}},'a',map,FROM),/密鑰/);
  assert.throws(()=>Boss.enter(room,'intruder',map,FROM),/不是此副本/);
  assert.throws(()=>Boss.enter({...room,members:{...room.members,
    a:{...room.members.a,downed:true}}},'a',map,FROM),/倒地/);
  assert.throws(()=>Boss.enter(room,'b',map,FROM),/傳送陣|相鄰/);
  const outcome=Boss.enter(room,'a',map,FROM,'dungroom01234567890');
  assert.equal(outcome.duplicate,false);
  assert.equal(outcome.room.dungeonArena,'boss');
  assert.equal(outcome.room.bossEncounter.status,'fighting');
  assert.equal(outcome.room.enemies.length,1);
  assert.equal(outcome.room.enemies[0].battleHealth,900);
  assert.deepStrictEqual(outcome.room.members.a.position,Boss.mapFor(seed).spawnPads[0]);
  assert.deepStrictEqual(outcome.room.members.b.position,Boss.mapFor(seed).spawnPads[1]);
  assert.equal(outcome.room.members.a.battleHealth,76);
  assert.equal(outcome.room.members.a.explorationStamina,82);
  assert.equal(outcome.room.members.a.focusCharges,4);
  assert.equal(outcome.room.members.a.moveSeq,21);
  assert.equal(outcome.room.members.a.flyingSword,null);
  assert.equal(Boss.enter(outcome.room,'b',map,FROM+999).duplicate,true);
  assert.equal(room.dungeonArena,'exploration');
});
test('three boss HP phases produce nonempty, walkable quake, charge and flame warnings',()=>{
  const map=Boss.mapFor(seed),boss=Boss.initialBoss();
  assert.equal(Boss.phase(900),1);
  assert.equal(Boss.phase(630),2);
  assert.equal(Boss.phase(315),3);
  const p={x:11,y:10};
  for(const kind of ['quake','charge','flame']){
    const warning=Boss.attackCells(map,boss,kind,p);
    assert.ok(warning.length>0,kind);
    assert.ok(warning.every(q=>walkable(map,q)),kind);
    assert.ok(warning.every(q=>!Boss.occupies(boss,q)),kind);
    assert.ok(warning.some(q=>xy(q)===xy(p)),kind);
    assert.equal(new Set(warning.map(xy)).size,warning.length);
  }
  const targets={a:{uid:'a',position:p,battleHealth:100}};
  const quake=Boss.plan(map,boss,targets,2);
  assert.equal(quake.kind,'quake');
  assert.equal(quake.resolvesAtTick,4);
  const charge=Boss.plan(map,{...boss,battleHealth:600,attackCount:1},targets,7);
  assert.equal(charge.kind,'charge');
  const flame=Boss.plan(map,{...boss,battleHealth:200,attackCount:2},targets,11);
  assert.equal(flame.kind,'flame');
  assert.equal(flame.damage,16);
});
test('server tick exposes attack warning before any hit; a dodge removes damage',()=>{
  const {map,room}=fixture();
  const result=Boss.enter(room,'a',map,FROM,'dungroom01234567890');
  let current=result.room;
  current.members.a.position={x:11,y:10};
  current.members.b.position={x:7,y:13};
  let next=Boss.advance(current,Boss.mapFor(seed),FROM+2000);
  assert.equal(next.battleAppliedTick,2);
  assert.equal(next.enemies[0].attack.kind,'quake');
  assert.equal(next.members.a.battleHealth,76);
  current={...current,...next};
  next=Boss.advance(current,Boss.mapFor(seed),FROM+3000);
  assert.equal(next.members.a.battleHealth,76);
  current={...current,...next};
  const warned=current.enemies[0].attack.cells;
  assert.ok(warned.some(p=>xy(p)===xy(current.members.a.position)));
  const dodge={...current,members:{...current.members,
    a:{...current.members.a,position:{x:7,y:13}}}};
  const resolved=Boss.advance(dodge,Boss.mapFor(seed),FROM+4000);
  assert.equal(resolved.members.a.battleHealth,76);
  assert.equal(resolved.enemies[0].attack,null);
  const caught=Boss.advance(current,Boss.mapFor(seed),FROM+4000);
  assert.equal(caught.members.a.battleHealth,65);
  assert.equal(caught.enemies[0].lastAttack.hits[0],'a');
  assert.equal(Boss.advance({...current,...caught},Boss.mapFor(seed),FROM+4000),null);
});
test('large idle gap cannot hit anyone with unseen boss attacks; warning restarts safely',()=>{
  const {map,room}=fixture();
  const started=Boss.enter(room,'a',map,FROM,'dungroom01234567890').room;
  started.members.a.position={x:11,y:10};
  const gap=Boss.advance(started,Boss.mapFor(seed),FROM+500000);
  assert.equal(gap.members.a.battleHealth,76);
  assert.equal(gap.battleAppliedTick,500);
  assert.ok(gap.enemies[0].attack);
  assert.ok(gap.enemies[0].attack.resolvesAtTick>=502);
  const later=Boss.advance({...started,...gap},Boss.mapFor(seed),FROM+501000);
  assert.equal(later.members.a.battleHealth,76);
});
test('boss defeat is idempotent and does not hand out unimplemented rewards',()=>{
  const {map,room}=fixture();
  const started=Boss.enter(room,'a',map,FROM,'dungroom01234567890').room;
  assert.equal(Boss.onDefeat(started,started.enemies,'a').status,'fighting');
  const completed=Boss.onDefeat(started,[],'a');
  assert.equal(completed.status,'defeated');
  assert.equal(completed.defeatedByUid,'a');
  assert.equal(completed.defeatedAtTick,0);
  assert.strictEqual(Boss.onDefeat({...started,bossEncounter:completed},[],'b'),completed);
  assert.equal('loot' in completed,false);
  assert.equal('experience' in completed,false);
  const view=Boss.publicEncounter(completed);
  assert.equal(view.status,'defeated');
  assert.equal('secret' in view,false);
});

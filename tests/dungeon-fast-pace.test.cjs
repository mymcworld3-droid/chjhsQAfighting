'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Map=require('../dungeon-map-generator.cjs');
const Stamina=require('../dungeon-stamina-rules.cjs');
const AI=require('../dungeon-enemy-ai.cjs');
const Boss=require('../dungeon-boss-battle.cjs');
const {initialClock}=require('../dungeon-battle-clock.cjs');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');

const dirs=[[0,1],[1,0],[-1,0],[0,-1]];
function connected(layout){
  const seen=new Set([layout.spawn.y*layout.width+layout.spawn.x]);
  const queue=[layout.spawn];
  for(let i=0;i<queue.length;i++){
    const p=queue[i];
    for(const [dx,dy] of dirs){
      const q={x:p.x+dx,y:p.y+dy},key=q.y*layout.width+q.x;
      if(!Map.walkable(layout,q)||seen.has(key))continue;
      seen.add(key);queue.push(q);
    }
  }
  return seen;
}
test('900 seed-generated v2 maps are short, fully reachable, irregular and deterministic',()=>{
  const shapes=new Set();
  for(let i=0;i<900;i++){
    const seed='five-minute-pace-'+i;
    const layout=Map.generateDungeonLayout(seed,Map.FAST_LAYOUT_VERSION);
    if(i<20)assert.deepStrictEqual(layout,Map.generateDungeonLayout(seed,2));
    assert.equal(layout.layoutVersion,2);
    assert.match(layout.layoutId,/^dungeon-v2-/);
    assert.ok(layout.width>=35&&layout.width<=39,seed);
    assert.ok(layout.height>=31&&layout.height<=35,seed);
    assert.ok(layout.mainRoute.length>=53&&layout.mainRoute.length<=65,seed);
    assert.ok(layout.mainTurns>=4,seed);
    assert.equal(layout.branchCount,2,seed);
    assert.ok(layout.branches.every(b=>b.route.length>=9&&b.route.length<=13),seed);
    assert.equal(connected(layout).size,layout.walkableCount,seed);
    assert.ok(layout.spawnPads.every(p=>Map.walkable(layout,p)),seed);
    assert.ok(Map.walkable(layout,layout.guardianSite),seed);
    assert.ok(Map.walkable(layout,layout.portalSite),seed);
    assert.deepStrictEqual(layout.deepest,layout.guardianSite);
    assert.deepStrictEqual(layout.mainRoute.at(-5),layout.portalSite);
    shapes.add(layout.layoutId);
  }
  assert.ok(shapes.size>=890,'seeds still make varied compact worlds');
});
test('original v1 map generation remains byte-for-byte equivalent to default for existing rooms',()=>{
  for(const seed of ['legacy-seed','quality-seed-34','legacy:old-room-456']){
    const legacy=Map.generateDungeonLayout(seed,1);
    assert.deepStrictEqual(legacy,Map.generateDungeonLayout(seed));
    assert.equal(legacy.layoutVersion,Map.LAYOUT_VERSION);
    assert.ok(legacy.mainRoute.length>=89);
  }
  assert.throws(()=>Map.generateDungeonLayout('valid',99),RangeError);
});
test('v2 passive recharge is capped, independent per party member, and immutable',()=>{
  const members={a:{uid:'a',explorationStamina:0},b:{uid:'b',explorationStamina:9},
    admin:{uid:'admin',dungeonAdmin:true,explorationStamina:0}};
  const original=structuredClone(members);
  assert.equal(Stamina.REGEN_PER_SECOND,1);
  assert.deepStrictEqual(Stamina.replenishMembers({mapVersion:2},members,1),
    {a:{...members.a,explorationStamina:1},
     b:{...members.b,explorationStamina:10},admin:members.admin});
  assert.deepStrictEqual(members,original,'projection never mutates caller input');
  assert.equal(Stamina.replenishMembers({mapVersion:1},members,99),members);
  assert.equal(Stamina.replenishMembers({mapVersion:2},members,0),members);
  const full=Stamina.replenishMembers({mapVersion:2},members,150);
  assert.equal(full.a.explorationStamina,10);
  assert.equal(full.b.explorationStamina,10);
  assert.equal(Stamina.staminaFor(full.admin),10);
});
test('exploration world and boss both regenerate from real elapsed ticks after idle reconnect',()=>{
  const start=1800000000000,seed='five-minute-regen-actor';
  const map=Map.generateDungeonLayout(seed,2);
  const members={a:{uid:'a',position:{...map.spawnPads[0]},
    explorationStamina:2,battleHealth:100,battleMaxHealth:100}};
  const room={mode:'dungeon',status:'assembled',mapVersion:2,
    ...initialClock(start),enemyAiVersion:AI.ENEMY_AI_VERSION,
    dungeonArena:'exploration',members,enemies:[]};
  const exploration=AI.advanceWorld(room,map,start+5000);
  assert.equal(exploration.members.a.explorationStamina,7);
  assert.equal(exploration.battleAppliedTick,5);
  assert.equal(AI.advanceWorld({...room,...exploration},map,start+5000),null);
  const arena=Boss.mapFor(seed);
  const bossRoom={...room,dungeonArena:'boss',enemies:[Boss.initialBoss()],
    bossEncounter:{version:Boss.VERSION,status:'fighting'},
    members:{a:{...members.a,position:arena.spawnPads[0]}}};
  const next=Boss.advance(bossRoom,arena,start+3000);
  assert.equal(next.members.a.explorationStamina,5);
  assert.equal(next.battleAppliedTick,3);
  assert.equal(Boss.advance({...bossRoom,...next},arena,start+3000),null);
});
test('client shows auto recharge and keeps quizzes optional for new v2 rooms',()=>{
  const read=p=>readFileSync(join(__dirname,'..',p),'utf8');
  const view=read('public/cultivation/dungeon-map-view.js');
  const panel=read('public/cultivation/dungeon-quiz-panel.js');
  const api=read('public/cultivation/dungeon-room.js');
  assert.match(view,/\[1,2\]\.includes\(map\.layoutVersion\)/);
  assert.match(view,/this\.quiz\?\.setAutoRegeneration\(room\.mapVersion===2\)/);
  assert.match(view,/room\.mapVersion!==2\)void this\.quiz\?\.warm\(\)/);
  assert.match(panel,/副本能量每秒自動恢復 1 點/);
  assert.match(panel,/答題不再額外補充能量/);
  assert.match(api,/\[1,2\]\.includes\(map\.layoutVersion\)/);
});

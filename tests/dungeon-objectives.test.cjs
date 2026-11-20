'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {generateDungeonLayout,walkable}=require('../dungeon-map-generator.cjs');
const AI=require('../dungeon-enemy-ai.cjs');
const Objectives=require('../dungeon-objectives.cjs');
const Combat=require('../dungeon-enemy-combat.cjs');
const PlayerCombat=require('../dungeon-player-combat.cjs');
const same=(a,b)=>a.x===b.x&&a.y===b.y;
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
function world(seed='stage14-guardian-seed'){
  const map=generateDungeonLayout(seed),regular=AI.initialEnemies(map);
  const {enemies,progress}=Objectives.spawn(map,regular);
  return {map,regular,enemies,progress};
}
test('stage 14 guardian spawns uniquely near deepest site for 800 irregular seeded maps',()=>{
  for(let n=0;n<800;n++){
    const {map,regular,enemies,progress}=world('stage14-seed-'+n);
    assert.deepStrictEqual(enemies,Objectives.spawn(map,regular).enemies);
    assert.equal(enemies.length,regular.length+1);
    const guardian=enemies.at(-1);
    assert.equal(guardian.id,Objectives.GUARDIAN_ID);
    assert.equal(guardian.kind,'guardian');
    assert.equal(guardian.battleHealth,Objectives.GUARDIAN_HP);
    assert.equal(PlayerCombat.maxHealth('guardian'),1200);
    assert.ok(walkable(map,guardian.position),'seed='+n);
    assert.ok(map.mainRoute.slice(-17).some(p=>same(p,guardian.position)));
    assert.ok(!regular.some(e=>same(e.position,guardian.position)));
    assert.ok(map.spawnPads.every(p=>!same(p,guardian.position)));
    assert.ok(distance(guardian.position,map.guardianSite)<=16);
    assert.deepStrictEqual(progress,Objectives.spawn(map,regular).progress);
    assert.equal(progress.keyAcquired,false);
    assert.equal(progress.portalStatus,'sealed');
  }
});
test('guardian retains a real autonomous attack rule with warning and independent HP',()=>{
  const {map,enemies}=world();
  const guardian=enemies.at(-1);
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  const adjacent=dirs.map(([dx,dy])=>({
    x:guardian.position.x+dx,y:guardian.position.y+dy
  })).find(p=>walkable(map,p));
  assert.ok(adjacent);
  const players={a:{uid:'a',position:adjacent,battleHealth:100,downed:false}};
  const telegraph=Combat.planAttack(map,guardian,players,3);
  assert.ok(telegraph?.cells.some(p=>same(p,adjacent)));
  assert.equal(telegraph.label,'鎮鑰裂地震波');
  assert.equal(telegraph.damage,14);
  assert.equal(Combat.resolveAttack({...guardian,attack:telegraph},players,5)
    .members.a.battleHealth,86);
});
test('only server-computed guardian removal grants the persistent party key once',()=>{
  const {enemies,progress}=world();
  const members={a:{position:{x:1,y:1}},b:{position:{x:2,y:2}}};
  const room={status:'assembled',enemies,dungeonProgress:progress,members,
    battleAppliedTick:15};
  const unchanged=Objectives.combatProgress(room,enemies,'a');
  assert.strictEqual(unchanged,progress);
  const withoutWolf=enemies.filter(e=>e.id!=='beast-1');
  assert.strictEqual(Objectives.combatProgress(room,withoutWolf,'a'),progress);
  const withoutGuardian=enemies.filter(e=>e.id!==Objectives.GUARDIAN_ID);
  const obtained=Objectives.combatProgress(room,withoutGuardian,'a');
  assert.equal(obtained.guardianStatus,'defeated');
  assert.equal(obtained.keyAcquired,true);
  assert.equal(obtained.portalStatus,'ready');
  assert.equal(obtained.defeatedByUid,'a');
  assert.equal(obtained.defeatedAtTick,15);
  assert.strictEqual(Objectives.combatProgress({
    ...room,dungeonProgress:obtained,enemies:withoutGuardian},withoutGuardian,'b'),
    obtained,'subsequent attacks cannot award a second party key');
  const view=Objectives.publicProgress(obtained);
  assert.equal(view.keyAcquired,true);
  assert.ok(!Object.hasOwn(view,'guardianPosition'));
  assert.equal(Objectives.publicProgress(null),null);
});
test('portal requires shared key and healthy teammate within one cardinal tile',()=>{
  const {map,enemies,progress}=world();
  const pos={...map.portalSite};
  const members={a:{uid:'a',position:pos,battleHealth:100,downed:false},
    b:{uid:'b',position:{...map.spawn},battleHealth:100,downed:false}};
  const before={status:'assembled',members,enemies,dungeonProgress:progress,
    battleAppliedTick:19};
  assert.throws(()=>Objectives.activate(before,'a',map),/先擊敗/);
  const won=Objectives.combatProgress(before,enemies.slice(0,-1),'a');
  const unlocked={...before,dungeonProgress:won};
  assert.throws(()=>Objectives.activate(unlocked,'b',map),/靠近|相鄰/);
  assert.throws(()=>Objectives.activate(unlocked,'outside',map),/不是此副本/);
  assert.throws(()=>Objectives.activate({...unlocked,members:{
    ...members,a:{...members.a,downed:true}}},'a',map),/倒地/);
  const opened=Objectives.activate(unlocked,'a',map);
  assert.equal(opened.duplicate,false);
  assert.equal(opened.progress.portalStatus,'open');
  assert.equal(opened.progress.openedByUid,'a');
  assert.equal(opened.progress.openedAtTick,19);
  assert.equal(Objectives.activate({...unlocked,dungeonProgress:opened.progress},
    'b',map).duplicate,true);
  assert.equal(before.dungeonProgress.portalStatus,'sealed',
    'pure objective state never mutates initial snapshot');
});

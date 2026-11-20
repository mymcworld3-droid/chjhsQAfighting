'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,
  '../public/cultivation/dungeon-enemy-animation.js'),'utf8')
  .replace(/^export /gm,'');
const Vfx=new Function(source+
  '\nreturn {dungeonEnemyReactionEvents,dungeonWindupPose,dungeonHitPose,drawDungeonBeastWindup,drawDungeonEnemyImpacts};')();
const {loadDungeonPainter}=require('./dungeon-painter-loader.cjs');
const cameraSource=fs.readFileSync(path.join(__dirname,
  '../public/cultivation/dungeon-map-camera.js'),'utf8')
  .replace(/^export /gm,'');
const Camera=new Function(cameraSource+
  '\nreturn {initialCamera,geometry,visibleTiles,lockToPlayer};')();
const Painter=loadDungeonPainter(Camera);
const {generateDungeonLayout}=require('../dungeon-map-generator.cjs');
const clone=structuredClone;
function room(){
  return {id:'dungroom12345678',status:'assembled',
    dungeonArena:'exploration',battleClock:{appliedTick:10},
    enemies:[{id:'beast-1',kind:'wolf',name:'巡山妖狼',
      position:{x:3,y:3},battleHealth:60,battleMaxHealth:60,
      intent:'alert',lastAttack:null,attack:null}],
    members:{a:{uid:'a',position:{x:4,y:3},battleHealth:92,
      battleMaxHealth:100,lastDamage:null}}};
}
function committed(){
  const before=room(),after=clone(before);
  after.battleClock.appliedTick=11;
  after.enemies[0].lastAttack={tick:11,kind:'bite',
    cells:[{x:4,y:3}],hits:['a']};
  after.enemies[0].intent='recover';
  after.members.a.battleHealth=84;
  after.members.a.lastDamage={sourceId:'beast-1',tick:11,amount:8};
  return {before,after};
}
function canvas(){
  const calls=[],text=[];
  const ctx=new Proxy({},{
    get(_target,name){
      if(name==='createRadialGradient'||name==='createLinearGradient')
        return ()=>({addColorStop(){}});
      if(name==='measureText')return s=>({width:String(s).length*9});
      if(name==='fillText'||name==='strokeText')return (...args)=>{
        text.push(String(args[0]));calls.push(name);
      };
      return (..._args)=>{calls.push(name);};
    },
    set(){return true;}
  });
  return {ctx,calls,text};
}
test('only newly committed server attacks and real damage become multiplayer VFX',()=>{
  const {before,after}=committed(),snapshot=clone(after);
  const events=Vfx.dungeonEnemyReactionEvents(before,after);
  assert.deepEqual(events.map(e=>e.kind),['strike','hurt']);
  assert.equal(events[0].hits[0],'a');
  assert.equal(events[1].amount,8);
  assert.equal(Vfx.dungeonEnemyReactionEvents(after,clone(after)).length,0,
    'duplicate snapshots must never replay a hit');
  assert.deepEqual(after,snapshot,'presentation must not mutate C-room');
  const missed=clone(after);missed.enemies[0].lastAttack.hits=[];
  missed.members.a.lastDamage=null;
  assert.deepEqual(Vfx.dungeonEnemyReactionEvents(before,missed)
    .map(e=>e.kind),['strike'],'a dodge produces a strike, never fake damage');
});
test('old, boss, changing arena or first-join snapshots cannot replay attacks',()=>{
  const {before,after}=committed();
  const first=clone(before);first.status='waiting';
  assert.equal(Vfx.dungeonEnemyReactionEvents(first,after).length,0);
  const arena=clone(after);arena.dungeonArena='boss';
  assert.equal(Vfx.dungeonEnemyReactionEvents(before,arena).length,0);
  const stale=clone(after);stale.battleClock.appliedTick=15;
  assert.equal(Vfx.dungeonEnemyReactionEvents(before,stale).length,0);
  const boss=clone(after);boss.enemies[0].kind='boss';
  assert.equal(Vfx.dungeonEnemyReactionEvents(before,boss).length,0,
    'Boss attacks keep their own existing cinematic and damage VFX');
  assert.equal(Vfx.dungeonEnemyReactionEvents(null,after).length,0);
});
test('windup uses only published warning and never represents a hit',()=>{
  const {before}=committed(),enemy=before.enemies[0],snapshot=clone(enemy);
  const none=Vfx.dungeonWindupPose(enemy,10.5,200);
  assert.equal(none,null);
  enemy.attack={kind:'bite',cells:[{x:4,y:3}],
    startedAtTick:10,resolvesAtTick:12};
  const charge=Vfx.dungeonWindupPose(enemy,11,250);
  assert.ok(charge.energy>.5&&charge.energy<1);
  assert.ok(charge.dx<0,'the beast coils opposite its announced attack');
  const quiet=Vfx.dungeonWindupPose(enemy,11,250,true);
  assert.equal(quiet.dx,0);assert.equal(quiet.dy,0);
  enemy.attack.from={x:4,y:3};
  assert.equal(Vfx.dungeonWindupPose(enemy,11,250),null,
    'a displaced source must not project a phantom attack');
  assert.equal(snapshot.attack,null);
});
test('hurt recoil is actor-local, brief and disabled for reduced motion',()=>{
  const {before,after}=committed();
  const hit=Vfx.dungeonEnemyReactionEvents(before,after)
    .find(e=>e.kind==='hurt');
  const scene={...hit,progress:.25};
  const pose=Vfx.dungeonHitPose('a',[scene]);
  assert.ok(pose.dx>0&&pose.intensity>0);
  assert.equal(Vfx.dungeonHitPose('b',[scene]),null);
  assert.equal(Vfx.dungeonHitPose('a',[scene],true).dx,0);
  assert.equal(Vfx.dungeonHitPose('a',[{...scene,progress:1}]).intensity,0);
});
test('canvas shows a warning, server strike and damage number without touching actors',()=>{
  const {before,after}=committed();
  const enemy=clone(before.enemies[0]);
  enemy.attack={kind:'bite',cells:[{x:4,y:3}],
    startedAtTick:10,resolvesAtTick:12};
  const old=clone(enemy),scene=Vfx.dungeonEnemyReactionEvents(before,after)
    .map(e=>({...e,progress:.4}));
  const c=canvas(),view={ox:0,oy:0,cell:36};
  Vfx.drawDungeonBeastWindup(c.ctx,enemy,view,11,200);
  Vfx.drawDungeonEnemyImpacts(c.ctx,scene,view,
    Object.values(after.members));
  assert.ok(c.calls.filter(x=>x==='arc').length>=3);
  assert.ok(c.calls.filter(x=>x==='stroke').length>=3);
  assert.ok(c.text.includes('-8'));
  assert.deepEqual(enemy,old);
  const noHit=canvas();
  Vfx.drawDungeonEnemyImpacts(noHit.ctx,[scene[0]],view,
    Object.values(after.members));
  assert.ok(!noHit.text.includes('-8'));
});
test('the actual world painter applies enemy pose and allied recoil separately from hitboxes',()=>{
  const map=generateDungeonLayout('enemy-animation-painter-v1');
  const {before,after}=committed();
  const beast=before.enemies[0],point=map.spawnPads[0];
  beast.position={...point};
  beast.attack={kind:'bite',cells:[{x:point.x+1,y:point.y}],
    startedAtTick:10,resolvesAtTick:12};
  const member={...after.members.a,position:{...point}};
  const original=clone({beast,member,map});
  const c=canvas();
  Painter.drawWorld(c.ctx,map,Camera.initialCamera(),820,630,{
    enemies:[beast],members:[member],selfUid:'a',
    currentTick:11,displayTick:11,windupTick:11.35,
    enemyImpactScenes:[{kind:'hurt',uid:'a',sourceId:beast.id,
      origin:{x:point.x-1,y:point.y},position:{...point},
      amount:8,progress:.3}],
    reducedMotion:false
  });
  assert.ok(c.calls.includes('stroke'));
  assert.ok(c.text.includes('-8'));
  assert.deepEqual({beast,member,map},original);
});
test('dungeon client wires enemy attack transitions and unintrusive painter passes',()=>{
  const view=fs.readFileSync(path.join(__dirname,
    '../public/cultivation/dungeon-map-view.js'),'utf8');
  const painter=fs.readFileSync(path.join(__dirname,
    '../public/cultivation/dungeon-map-painter.js'),'utf8');
  assert.match(view,/dungeonEnemyReactionEvents\(previous,room\)/);
  assert.match(view,/enemyImpactScenes,/);
  assert.match(painter,/dungeonWindupPose\(enemy,windupTick/);
  assert.match(painter,/dungeonHitPose\(member.uid,enemyImpactScenes/);
  assert.match(painter,/drawDungeonEnemyImpacts\(ctx,enemyImpactScenes/);
  assert.ok(painter.indexOf('drawDungeonBeastWindup(ctx,enemy')<
    painter.indexOf('members.slice(0,4).forEach'));
  assert.ok(painter.indexOf('drawDungeonEnemyImpacts(ctx,enemyImpactScenes')>
    painter.indexOf('members.slice(0,4).forEach'));
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'..',n),'utf8');
const load=(name,names)=>new Function(
  read('public/cultivation/'+name).replace(/^export /gm,'')+
  '\nreturn {'+names.join(',')+'};')();
const Boss=load('dungeon-boss-visuals.js',[
  'dungeonBossVisualPlan','drawBossTelegraph','drawBossAura',
  'dungeonBossTransition','drawBossTransition'
]);
const Env=load('dungeon-environment-effects.js',[
  'dungeonEnvironmentPlan','drawDungeonEnvironment','drawDungeonCastWindup'
]);
const BossRules=require('../dungeon-boss-battle.cjs');
const map=BossRules.mapFor('next-stage-effects');
const clone=v=>structuredClone(v);
function canvas(){
  const calls=[];
  const ctx=new Proxy({},{
    get(_,name){
      if(name==='createRadialGradient'||name==='createLinearGradient')
        return (...args)=>{calls.push([name,...args]);return {addColorStop(){}};};
      return (...args)=>{calls.push([name,...args]);};
    },
    set(){return true;}
  });
  return {ctx,calls};
}
const view={ox:0,oy:0,cell:32,width:map.width,height:map.height,
  left:0,top:0,right:map.width*32,bottom:map.height*32};
function target(){
  return map.spawnPads[0];
}
test('boss VFX plan displays trusted phases, shields and telegraph timing',()=>{
  const boss=BossRules.initialBoss(),raw=clone(boss);
  boss.attack={kind:'quake',from:clone(boss.position),
    cells:BossRules.attackCells(map,boss,'quake',target()),
    startedAtTick:10,resolvesAtTick:12};
  assert.ok(boss.attack.cells.length);
  const p=Boss.dungeonBossVisualPlan(boss,11);
  assert.equal(p.warning.kind,'quake');assert.ok(p.warning.progress>.4);
  assert.equal(p.boss.hp,BossRules.HP);
  assert.equal(p.boss.footprint.width,2);
  assert.equal(p.shield,BossRules.SHIELD_MAX);
  assert.equal(p.phase,1);
  assert.deepEqual(raw,BossRules.initialBoss());
  assert.equal(Boss.dungeonBossVisualPlan({...boss,battleHealth:0}),null);
  const phase3=Boss.dungeonBossVisualPlan({...boss,battleHealth:250,phase:3},13);
  assert.equal(phase3.phase,3);assert.equal(phase3.boss.phase,2);
  assert.equal(phase3.warning.progress,.97,
    'a published warning must remain marked until server clears it');
  boss.attack.from.x++;
  assert.equal(Boss.dungeonBossVisualPlan(boss,11).warning,null,
    'displaced bosses cannot issue ghosts of old attacks');
});
test('quake, charge and flame render inside only the published server warning mask',()=>{
  const boss=BossRules.initialBoss(),original=clone(boss);
  for(const kind of ['quake','charge','flame']){
    const cells=BossRules.attackCells(map,boss,kind,target());
    assert.ok(cells.length,kind);
    const plan=Boss.dungeonBossVisualPlan({...boss,attack:{
      kind,from:{...boss.position},cells:[...cells,{x:-100,y:0},
        {x:map.width+1,y:0},{x:1,y:1}],
      startedAtTick:10,resolvesAtTick:12}},11);
    const maskCells=plan.warning.cells.filter(p=>
      p.x>=0&&p.y>=0&&p.x<map.width&&p.y<map.height&&
      map.tiles[p.y*map.width+p.x]>0);
    const {ctx,calls}=canvas();
    Boss.drawBossTelegraph(ctx,plan,map,view,1130,false);
    const rectangles=calls.filter(([op])=>op==='rect');
    assert.deepEqual(rectangles.map(([op,x,y])=>[x,y]),
      maskCells.map(p=>[p.x*32+.7,p.y*32+.7]));
    assert.equal(calls.filter(x=>x[0]==='clip').length,1);
    assert.ok(calls.some(([op])=>op==='stroke'),kind+' has motion lines');
    const fallback=canvas();
    Boss.drawBossTelegraph(fallback.ctx,plan,map,view,1130,true);
    assert.equal(fallback.calls.filter(x=>x[0]==='rect').length,
      maskCells.length);
  }
  assert.deepEqual(boss,original,'drawing leaves the authoritative boss unchanged');
});
test('boss trial presence and shield are visually reused, never simulated',()=>{
  const boss=BossRules.initialBoss(),plan=Boss.dungeonBossVisualPlan(boss,0);
  const {ctx,calls}=canvas();
  let called=0;
  const impact={drawBossPresence(_ctx,_boss,_view,_now,_reduced){
    called++;assert.equal(_boss.hp,boss.battleHealth);
    assert.equal(_boss.bossKind,'flame');}};
  Boss.drawBossAura(ctx,plan,view,1000,false,impact);
  assert.equal(called,1);
  assert.ok(calls.some(c=>c[0]==='ellipse'),'shield aura is visible');
  assert.equal(Boss.dungeonBossTransition(
    {enemies:[boss]},{enemies:[{...boss,phase:2}]}).kind,'phase');
  assert.equal(Boss.dungeonBossTransition(
    {enemies:[boss]},{enemies:[],bossEncounter:{status:'defeated'}}).kind,'defeat');
  assert.equal(Boss.dungeonBossTransition(
    {enemies:[boss]},{enemies:[clone(boss)]}),null);
  const wave=canvas();
  Boss.drawBossTransition(wave.ctx,
    {kind:'phase',position:{...boss.position}},view,.4,false);
  assert.ok(wave.calls.some(c=>c[0]==='arc'));
});
test('world ambience positions are deterministic and always on genuine floor',()=>{
  const plan=Env.dungeonEnvironmentPlan(map);
  assert.deepEqual(plan,Env.dungeonEnvironmentPlan(map));
  assert.ok(plan.positions.length>0&&plan.positions.length<=90);
  for(const p of plan.positions){
    assert.equal(map.tiles[p.y*map.width+p.x]>0,true);
  }
  const snapshot=clone(map);
  const {ctx,calls}=canvas();
  Env.drawDungeonEnvironment(ctx,plan,map,view,2500,false,{});
  assert.ok(calls.some(c=>c[0]==='stroke'));
  assert.deepEqual(map,snapshot,'no collision, terrain or route mutations');
  for(const biome of ['bamboo','frost','marsh','ruins']){
    const p=Env.dungeonEnvironmentPlan({...map,biome});
    const c=canvas();
    Env.drawDungeonEnvironment(c.ctx,p,{...map,biome},view,2750,false,{});
    assert.ok(c.calls.some(x=>x[0]==='stroke'),biome);
  }
});
test('portal and boss floor lighting never create damage or a new attack',()=>{
  const portal={...map,arena:'exploration',
    portalSite:{x:map.spawnPads[0].x,y:map.spawnPads[0].y}};
  const p=Env.dungeonEnvironmentPlan(portal);
  const off=canvas(),on=canvas();
  Env.drawDungeonEnvironment(off.ctx,p,portal,view,1000,false,
    {portalStatus:'sealed'});
  Env.drawDungeonEnvironment(on.ctx,p,portal,view,1000,false,
    {portalStatus:'open'});
  assert.ok(on.calls.filter(c=>c[0]==='ellipse').length>
    off.calls.filter(c=>c[0]==='ellipse').length);
  const c=canvas(),cue={kind:'skill',skillId:'dragon-strike',
    style:'fist-attack',origin:{x:3,y:3},
    target:{x:4,y:3},startedAt:1000};
  Env.drawDungeonCastWindup(c.ctx,cue,1100,false);
  assert.ok(c.calls.some(v=>v[0]==='lineTo'));
  assert.equal(c.calls.filter(v=>v[0]==='fillRect').length,0,
    'local prediction is a cast glow, not fake health or damage');
  assert.deepEqual(cue.target,{x:4,y:3});
});
test('the live dungeon screen wires phase and biome effects below all actors',()=>{
  const view=read('public/cultivation/dungeon-map-view.js');
  const painter=read('public/cultivation/dungeon-map-painter.js');
  assert.match(view,/import '\.\/tactical-impact-presentation\.js'/);
  assert.match(view,/this\.environmentPlan=dungeonEnvironmentPlan\(map\)/);
  assert.match(view,/const phase=dungeonBossTransition\(previous,room\)/);
  assert.match(view,/bossTransition:phasePulse,displayTick/);
  assert.match(painter,/drawDungeonEnvironment\(ctx,environmentPlan/);
  assert.match(painter,/drawBossAura\(ctx,bossPlan/);
  assert.match(painter,/drawBossTelegraph\(ctx,bossPlan,map,viewport/);
  assert.match(painter,/drawDungeonCastWindup\(ctx,pendingAction/);
  assert.ok(painter.indexOf('drawBossTelegraph(ctx,bossPlan')<
    painter.indexOf('function marker(point'),
    'boss range sparks must remain under characters');
});

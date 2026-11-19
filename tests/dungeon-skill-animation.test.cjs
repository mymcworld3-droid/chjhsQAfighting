'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const source=read('public/cultivation/dungeon-skill-animation.js')
  .replace(/^export /gm,'');
const fx=new Function(source+
  '\nreturn {dungeonVisualMove,dungeonAnimationEvents,paintDungeonScene,drawDungeonHitNumbers};')();
const shared=require('../public/cultivation/tactical-skill-effects.js');
const catalog=require('../public/cultivation/manual-rules.js');
const image={width:21,height:15,ox:-20,oy:-12,cell:36};
const members=()=>({
  hero:{uid:'hero',position:{x:8,y:6},battleHealth:100,explorationStamina:10,
    dungeonSkills:Object.values(catalog.BY_SKILL).map(s=>({
      id:s.id,kind:s.kind,school:s.school,cost:s.cost}))},
  teammate:{uid:'teammate',position:{x:7,y:6},battleHealth:80,explorationStamina:7}
});
const enemies=()=>[{id:'beast-1',kind:'wolf',position:{x:9,y:6},
  battleHealth:60,battleMaxHealth:60}];
const room=()=>({id:'dungroom0123456',dungeonArena:'exploration',
  status:'assembled',revision:10,members:members(),enemies:enemies()});
function sample(moveId,{target={x:9,y:6},cells=[{x:9,y:6}],hits=true}={}){
  const previous=room(),next=room();
  next.revision=11;
  next.members.hero.lastSkill={seq:1,skillId:moveId,
    origin:{x:8,y:6},target,effectCells:cells,visualVersion:1,
    hits:hits?[{enemyId:'beast-1',damage:18}]:[],totalDamage:hits?18:0,
    ...(moveId==='dragon-roar'?{focusActivated:true,focusCharges:6}:{})};
  return {previous,next};
}
function mockCanvas(){
  const commands=[];
  const target={canvas:{width:840,height:640},
    measureText:()=>({width:30}),
    createLinearGradient:()=>({addColorStop(){}}),
    createRadialGradient:()=>({addColorStop(){}})};
  const ctx=new Proxy(target,{
    get(obj,key){if(key in obj)return obj[key];
      if(key===Symbol.toStringTag)return 'CanvasRenderingContext2D';
      return (...args)=>{commands.push([key,...args]);};
    },
    set(obj,key,value){obj[key]=value;return true}
  });
  return {ctx,commands};
}
test('all eighteen manual IDs use the exact trial animation catalog, including shared aliases',()=>{
  const names=Object.keys(catalog.BY_SKILL);
  assert.equal(names.length,18);
  for(const id of names){
    assert.equal(shared.moveFor(id),fx.dungeonVisualMove(id));
    const {previous,next}=sample(id);
    const events=fx.dungeonAnimationEvents(previous,next);
    assert.equal(events.length,1,id+' should trigger exactly once');
    assert.equal(events[0].scene.skill,id);
    assert.deepEqual(events[0].scene.origin,{x:8,y:6});
    assert.equal(events[0].scene.kind,'cast');
    const {ctx,commands}=mockCanvas();
    assert.equal(fx.paintDungeonScene(ctx,events[0].scene,.46,image,false,shared),true);
    assert.equal(fx.paintDungeonScene(ctx,events[0].scene,.67,image,true,shared),true);
    assert.ok(commands.length>0,'no animation drawn for '+id);
  }
});
test('one server commit gives one visual; repeated SSE refresh and arena transition never replay',()=>{
  const {previous,next}=sample('dragon-roar',{target:{x:8,y:6},hits:false});
  assert.equal(fx.dungeonAnimationEvents(previous,next).length,1);
  assert.equal(fx.dungeonAnimationEvents(next,structuredClone(next)).length,0);
  const changed={...next,dungeonArena:'boss'};
  assert.equal(fx.dungeonAnimationEvents(next,changed).length,0);
  assert.equal(fx.dungeonAnimationEvents(null,next).length,0);
});
test('sky-cloud retains both real diagonal cuts even if one arm is blocked',()=>{
  const cells=[{x:7,y:5},{x:9,y:7},{x:7,y:7},{x:9,y:5},{x:8,y:6}];
  const {previous,next}=sample('sky-cloud',{target:{x:8,y:6},cells});
  const scene=fx.dungeonAnimationEvents(previous,next)[0].scene;
  assert.equal(scene.cuts.length,2);
  assert.deepEqual(scene.cuts[0],[{x:7,y:5},{x:8,y:6},{x:9,y:7}]);
  assert.deepEqual(scene.cuts[1],[{x:7,y:7},{x:8,y:6},{x:9,y:5}]);
});
test('fist-focus creates six-cast aura; animated gold does not alter the room',()=>{
  const {previous,next}=sample('dragon-roar',{target:{x:8,y:6},
    cells:[{x:8,y:6}],hits:false});
  const snapshot=JSON.stringify(next);
  const scene=fx.dungeonAnimationEvents(previous,next)[0].scene;
  assert.equal(scene.focusActivated,true);
  assert.equal(next.members.hero.lastSkill.focusCharges,6);
  const {ctx}=mockCanvas();
  fx.paintDungeonScene(ctx,scene,.6,image,true,shared);
  assert.equal(JSON.stringify(next),snapshot);
});
test('dash and thrown targets reuse original trial move trails',()=>{
  const {previous,next}=sample('tiger-throw');
  next.enemies[0].position={x:6,y:6};
  const scene=fx.dungeonAnimationEvents(previous,next)[0].scene;
  assert.equal(scene.moves.find(m=>m.uid==='beast-1').timing,'manual-throw');
  const {ctx,commands}=mockCanvas();
  fx.paintDungeonScene(ctx,scene,.61,image,true,shared);
  assert.ok(commands.some(([method])=>method==='quadraticCurveTo'));
  const second=sample('wind-step');
  second.next.members.hero.position={x:9,y:6};
  second.next.members.hero.lastSkill.position={x:9,y:6};
  const dash=fx.dungeonAnimationEvents(second.previous,second.next)[0].scene;
  assert.equal(dash.moves[0].timing,'dash');
  fx.paintDungeonScene(ctx,dash,.61,image,true,shared);
});
test('server authoritative throw path survives an enemy defeat and never changes game state',()=>{
  const {previous,next}=sample('tiger-throw');
  next.members.hero.lastSkill.visualMoves=[{enemyId:'beast-1',
    from:{x:9,y:6},to:{x:6,y:6}}];
  next.enemies=[];
  const before=JSON.stringify(next);
  const [event]=fx.dungeonAnimationEvents(previous,next);
  assert.ok(event);
  assert.deepEqual(event.scene.moves.find(m=>m.uid==='beast-1').path,
    [{x:9,y:6},{x:6,y:6}]);
  assert.equal(JSON.stringify(next),before);
});
test('basic attack uses readable slash and damage number animation',()=>{
  const previous=room(),next=room();
  next.members.hero.lastStrike={seq:1,enemyId:'beast-1',damage:30,
    target:{x:9,y:6},origin:{x:8,y:6}};
  const scenes=fx.dungeonAnimationEvents(previous,next);
  assert.equal(scenes.length,1);
  assert.equal(scenes[0].scene.kind,'basic');
  const {ctx,commands}=mockCanvas();
  fx.paintDungeonScene(ctx,scenes[0].scene,.6,image,true,shared);
  fx.drawDungeonHitNumbers(ctx,scenes[0].scene,.65,image);
  assert.ok(commands.some(([command])=>command==='strokeText'));
});
test('only the trial skill engine is imported; old square-flash VFX are removed',()=>{
  const view=read('public/cultivation/dungeon-map-view.js');
  const painter=read('public/cultivation/dungeon-map-painter.js');
  assert.match(view,/import '\.\/tactical-skill-effects\.js'/);
  assert.match(view,/dungeonAnimationEvents\(previous,room\)/);
  assert.match(view,/paintDungeonScene\(context,scene,p,view,above,renderer\)/);
  assert.match(view,/if\(\(scenes\.length\|\|queuedScenes\|\|phasePulse\)\&\&!reduceMotion\)\s*this\.drawSoon\(\)/);
  assert.match(painter,/animationUnderlay\(ctx,\{ox:g\.ox/);
  assert.match(painter,/animationOverlay\(ctx,\{ox:g\.ox/);
  assert.doesNotMatch(painter,/Stage 13: server-confirmed strike paths briefly gild/);
  assert.match(read('dungeon-skill-combat.cjs'),/origin:\{\.\.\.origin\}/);
  assert.match(read('dungeon-player-combat.cjs'),/origin:\{\.\.\.member\.position\}/);
});

test('four-step shove replays four distinct impacts in time order, never one combined push',()=>{
  const {previous,next}=sample('dragon-guard');
  const seq=next.members.hero.lastSkill;
  seq.chainSteps=Array.from({length:4},(_,i)=>({
    step:i+1,origin:{x:8+i,y:6},target:{x:9+i,y:6},
    position:{x:9+i,y:6},cells:[{x:9+i,y:6}],
    hits:[{enemyId:'beast-1',damage:12}],
    visualMoves:[{enemyId:'beast-1',
      from:{x:9+i,y:6},to:{x:10+i,y:6}}]
  }));
  next.members.hero.position={x:12,y:6};
  next.enemies[0].position={x:13,y:6};
  const before=JSON.stringify(next);
  const events=fx.dungeonAnimationEvents(previous,next);
  assert.equal(events.length,4);
  assert.deepStrictEqual(events.map(e=>e.scene.step),[1,2,3,4]);
  assert.deepStrictEqual(events.map(e=>e.scene.delayMs),[0,360,720,1080]);
  assert.deepStrictEqual(events.map(e=>e.scene.origin.x),[8,9,10,11]);
  assert.deepStrictEqual(events.map(e=>e.scene.target.x),[9,10,11,12]);
  assert.ok(events.every(e=>e.scene.duration===360));
  assert.ok(events.every(e=>e.scene.moves.some(m=>m.timing==='chain-advance')));
  assert.deepStrictEqual(events.map(e=>e.scene.moves.find(m=>
    m.uid==='beast-1').path[1].x),[10,11,12,13]);
  const ctx=mockCanvas().ctx;
  for(const event of events)fx.paintDungeonScene(ctx,event.scene,.66,image,true,shared);
  assert.deepStrictEqual(next,JSON.parse(before),'VFX cannot mutate shared combat state');
  assert.equal(fx.dungeonAnimationEvents(next,structuredClone(next)).length,0);
});

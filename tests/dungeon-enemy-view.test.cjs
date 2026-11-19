'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {generateDungeonLayout}=require('../dungeon-map-generator.cjs');
const AI=require('../dungeon-enemy-ai.cjs');
const map=generateDungeonLayout('stage9-client-presentation');
const cameraSource=fs.readFileSync(path.join(__dirname,
  '../public/cultivation/dungeon-map-camera.js'),'utf8').replace(/^export /gm,'');
const Camera=new Function(cameraSource+
  '\nreturn {initialCamera,geometry,visibleTiles,zoomAt,pan,focusOn,lockToPlayer,mapPoint};')();
const painterSource=fs.readFileSync(path.join(__dirname,
  '../public/cultivation/dungeon-map-painter.js'),'utf8')
  .replace(/^import .*$/gm,'').replace(/^export /gm,'');
const Painter=new Function('Camera',painterSource+
  '\nreturn {drawWorld,drawMinimap,BEAST_COLORS};')(Camera);
const viewerSource=fs.readFileSync(path.join(__dirname,
  '../public/cultivation/dungeon-map-view.js'),'utf8')
  .replace(/^import .*$/gm,'').replace(/^export /gm,'');
const View=new Function('Camera','getMainUser',viewerSource+
  '\nreturn DungeonMapView;')(Camera,()=>({uid:'a'}));
function createViewer(){
  const v=new View();
  v.room={id:'dungroom01234567890',status:'assembled',revision:5,
    members:{a:{uid:'a',joinedAtMs:1,position:map.spawnPads[0]}},
    enemies:AI.initialEnemies(map)};
  v.map=map;v.roomId=v.room.id;v.uid='a';v.opened=true;
  v.width=840;v.height=640;
  v.$=selector=>selector==='[data-dm="focus"]'?{setAttribute(){}}:null;
  v.drawSoon=()=>{};
  v.canvas={getBoundingClientRect:()=>({left:10,top:20}),
    setPointerCapture(){},hasPointerCapture:()=>false};
  return v;
}
function fake(){
  const count=new Map(),texts=[];
  const hit=k=>count.set(k,(count.get(k)||0)+1);
  const ctx={
    fillRect:()=>hit('rect'),strokeRect:()=>hit('strokeRect'),
    beginPath:()=>hit('begin'),arc:()=>hit('arc'),
    fill:()=>hit('fill'),stroke:()=>hit('stroke'),
    moveTo:()=>hit('move'),lineTo:()=>hit('line'),
    fillText:text=>{texts.push(String(text));hit('text');},
    strokeText:text=>{texts.push(String(text));hit('strokeText');},
    measureText:value=>({width:String(value).length*10}),
    save(){},restore(){},
    createRadialGradient:()=>({addColorStop(){}})
  };
  return {ctx,count,texts};
}
test('server NPCs render distinctly on the world and minimap without mutating blueprint',()=>{
  const enemies=AI.initialEnemies(map),before=structuredClone(enemies);
  const base=fake(),active=fake(),minimap=fake();
  const cam=Camera.initialCamera();
  const empty=Painter.drawWorld(base.ctx,map,cam,840,640,{enemies:[]});
  const full=Painter.drawWorld(active.ctx,map,cam,840,640,{enemies});
  assert.equal(full.cell,empty.cell);
  assert.ok((active.count.get('arc')||0)>(base.count.get('arc')||0));
  assert.ok((active.count.get('text')||0)>(base.count.get('text')||0));
  assert.deepStrictEqual(enemies,before);
  const g=Camera.geometry(cam,map,840,640);
  Painter.drawMinimap(minimap.ctx,map,g,150,120,{enemies});
  assert.ok((minimap.count.get('arc')||0)>=enemies.length+3);
  assert.deepStrictEqual(Object.keys(Painter.BEAST_COLORS).sort(),
    ['golem','guardian','wisp','wolf']);
});
test('single tap on an NPC shows its information without issuing a move',()=>{
  const view=createViewer(),beast=view.room.enemies[0];
  const point=Camera.mapPoint(view.camera,beast.position,map,view.width,view.height);
  assert.equal(view.inspectAt(point),true);
  assert.equal(view.selectedBeastId,beast.id);
  assert.equal(view.inspectOpen,true);
  assert.equal(view.followBeast,false);
  assert.equal(view.inspectAt({x:-100,y:-100}),false);
});
test('touch tap selects NPC and pan/multi-touch do not accidentally inspect',()=>{
  const view=createViewer(),enemy=view.room.enemies[0];
  const p=Camera.mapPoint(view.camera,enemy.position,map,view.width,view.height);
  const event=(type,id,x,y)=>({
    type,pointerId:id,pointerType:'touch',button:0,clientX:x+10,clientY:y+20,
    preventDefault(){}
  });
  view.pointerDown(event('pointerdown',10,p.x,p.y));
  view.pointerUp(event('pointerup',10,p.x,p.y));
  assert.equal(view.selectedBeastId,enemy.id);
  const other=createViewer();
  other.pointerDown(event('pointerdown',1,p.x,p.y));
  other.pointerDown(event('pointerdown',2,p.x+60,p.y));
  other.pointerMove(event('pointermove',2,p.x+90,p.y));
  other.pointerUp(event('pointerup',1,p.x,p.y));
  other.pointerUp(event('pointerup',2,p.x+90,p.y));
  assert.equal(other.selectedBeastId,null,'pinch must not count as a tap');
  assert.equal(other.pointers.size,0);
  assert.equal(other.gestureMulti,false);
});
test('mobile long-press selects a beast without system text highlighting',async()=>{
  const view=createViewer(),enemy=view.room.enemies[0];
  const p=Camera.mapPoint(view.camera,enemy.position,map,view.width,view.height);
  const ev=(type)=>({type,pointerId:99,pointerType:'touch',button:0,
    clientX:p.x+10,clientY:p.y+20,preventDefault(){}});
  view.pointerDown(ev('pointerdown'));
  await new Promise(resolve=>setTimeout(resolve,520));
  assert.equal(view.selectedBeastId,enemy.id);
  assert.equal(view.longPressTriggered,true);
  view.pointerUp(ev('pointerup'));
  const css=fs.readFileSync(path.join(__dirname,
    '../public/styles/dungeon-map-view.css'),'utf8');
  assert.match(css,/-webkit-user-select:none!important/);
  assert.match(css,/-webkit-touch-callout:none!important/);
});
test('NPC inspection keeps the local hero centered and never changes authoritative AI state',()=>{
  const view=createViewer(),before=structuredClone(view.room.enemies);
  view.selectBeast(view.room.enemies[0].id,{focus:true});
  assert.equal(view.followBeast,false);
  const hero=Camera.mapPoint(view.camera,view.selfPad(),map,view.width,view.height);
  assert.equal(hero.x,view.width/2);
  assert.equal(hero.y,view.height/2);
  assert.deepStrictEqual(view.room.enemies,before);
  assert.doesNotMatch(viewerSource,/request\('enemy-move'/);
  assert.doesNotMatch(viewerSource,/localStorage|sessionStorage/);
});

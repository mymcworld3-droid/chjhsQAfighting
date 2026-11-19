'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {generateDungeonLayout}=require('../dungeon-map-generator.cjs');
const cameraSource=fs.readFileSync(path.join(__dirname,'../public/cultivation/dungeon-map-camera.js'),'utf8')
  .replace(/^export /gm,'');
const Camera=new Function(cameraSource+'\nreturn {initialCamera,geometry,visibleTiles,zoomAt,pan,focusOn};')();
const painterSource=fs.readFileSync(path.join(__dirname,'../public/cultivation/dungeon-map-painter.js'),'utf8')
  .replace(/^import .*$/gm,'').replace(/^export /gm,'');
const painter=new Function('Camera',painterSource+'\nreturn {BIOMES,hashCell,drawWorld,drawMinimap};')(Camera);
function fakeCanvas(){
  const operations=new Map();
  const count=name=>operations.set(name,(operations.get(name)||0)+1);
  const context={save:()=>count('save'),restore:()=>count('restore'),
    fillRect:()=>count('fillRect'),strokeRect:()=>count('strokeRect'),
    beginPath:()=>count('beginPath'),arc:()=>count('arc'),
    fill:()=>count('fill'),stroke:()=>count('stroke'),
    moveTo:()=>count('moveTo'),lineTo:()=>count('lineTo'),
    fillText:()=>count('fillText'),strokeText:()=>count('strokeText'),
    measureText:value=>({width:String(value).length*11}),
    createRadialGradient:()=>({addColorStop:()=>count('gradientStop')})};
  return {context,operations};
}
test('all four terrain palettes render the same geometry without mutating room blueprint',()=>{
  const biomes=new Map();
  for(let i=0;i<120;i++){
    const m=generateDungeonLayout('painter-biome-'+i);
    biomes.set(m.biome,m);
    if(biomes.size===4)break;
  }
  assert.equal(biomes.size,4);
  for(const [biome,map]of biomes){
    assert.ok(painter.BIOMES[biome]);
    const original=JSON.stringify(map),{context,operations}=fakeCanvas();
    const camera=Camera.initialCamera();
    const info=painter.drawWorld(context,map,camera,900,600,{
      members:[{uid:'a'},{uid:'b'}],selfUid:'a',showRoutes:true
    });
    assert.ok(info.cell>0);
    assert.ok((operations.get('fillRect')||0)>200);
    assert.ok((operations.get('lineTo')||0)>25);
    assert.ok((operations.get('fillText')||0)>=3);
    assert.ok((operations.get('arc')||0)>=3);
    assert.equal(JSON.stringify(map),original,'painting must never edit map');
  }
});
test('mini map follows actual viewport bounds after zoom and pan',()=>{
  const map=generateDungeonLayout('stage6-overview');
  let camera=Camera.zoomAt(Camera.initialCamera(),4,190,160,map,380,320);
  camera=Camera.pan(camera,48,-36,map,380,320);
  const g=Camera.geometry(camera,map,380,320);
  const {context,operations}=fakeCanvas();
  painter.drawMinimap(context,map,g,140,114);
  assert.ok((operations.get('fillRect')||0)>=200);
  assert.ok((operations.get('strokeRect')||0)>=1);
  assert.ok((operations.get('arc')||0)>=3);
});
test('map viewer is wired to authorized room blueprint and contains no movement or reward mutations',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/dungeon-map-view.js'),'utf8');
  const lobby=fs.readFileSync(path.join(__dirname,'../public/cultivation/dungeon-lobby.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'../public/styles/dungeon-map-view.css'),'utf8');
  assert.match(source,/getDungeonMap\(roomId\)/);
  assert.match(source,/drawWorld\(/);
  assert.doesNotMatch(source,/drawMinimap\(/);
  assert.match(source,/Camera\.lockToPlayer\(this\.selfPad\(\),m,w,h\)/);
  assert.match(source,/pointerDown\(event\)/);
  assert.match(source,/pointerMove\(event\)/);
  assert.match(source,/pointerUp\(event\)/);
  assert.match(source,/ResizeObserver/);
  assert.match(source,/requestAnimationFrame/);
  assert.match(source,/this\.room\?\.members\?\.\[this\.uid\]/);
  assert.match(source,/mapValid\(map\)/);
  assert.match(lobby,/data-dg="preview-map"/);
  assert.match(lobby,/showDungeonMap\(/);
  assert.match(lobby,/updateDungeonMapRoom\(next\)/);
  assert.match(lobby,/hideDungeonMap\(\)/);
  assert.match(lobby,/next\.status==='assembled'/);
  assert.match(css,/touch-action:none!important/);
  assert.match(css,/-webkit-user-select:none!important/);
  assert.doesNotMatch(source,/(?:tactical\/action|tactical\/move|raid\/reward|dungeon\/reward)/);
  assert.doesNotMatch(source,/localStorage|sessionStorage/);
});

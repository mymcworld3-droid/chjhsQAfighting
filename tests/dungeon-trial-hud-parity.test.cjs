'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const cameraSource=read('public/cultivation/dungeon-map-camera.js').replace(/^export /gm,'');
const Camera=new Function(cameraSource+
  '\nreturn {geometry,visibleTiles,lockToPlayer,mapPoint};')();
const painterSource=read('public/cultivation/dungeon-map-painter.js')
  .replace(/^import .*$/gm,'').replace(/^export /gm,'');
const {loadDungeonPainter}=require('./dungeon-painter-loader.cjs');
const {drawWorld}=loadDungeonPainter(Camera);
const map={mode:'dungeon',layoutVersion:1,biome:'ruins',
  width:21,height:15,tiles:Array(21*15).fill(1),arena:'exploration',
  spawn:{x:10,y:7},spawnPads:[{x:10,y:7}],
  guardianSite:{x:18,y:13},portalSite:{x:19,y:13},
  mainRoute:[],branches:[]};
function canvas(){
  const text=[];
  const ctx={};
  for(const action of ['save','restore','fillRect','strokeRect','beginPath',
      'moveTo','lineTo','arc','fill','stroke','fillText','setLineDash',
      'drawImage'])ctx[action]=()=>{};
  ctx.strokeText=(str,x,y)=>text.push({str:String(str),x,y});
  ctx.measureText=str=>({width:String(str).length*9});
  ctx.createRadialGradient=()=>({addColorStop(){}});
  return {ctx,text};
}
test('hero and enemy HP/maxHP are drawn in the same position and colors as trial',()=>{
  const w=390,h=810,p={x:10,y:7},c=canvas();
  const camera=Camera.lockToPlayer(p,map,w,h);
  drawWorld(c.ctx,map,camera,w,h,{
    members:[{uid:'hero',position:p,battleHealth:73,battleMaxHealth:100}],
    selfUid:'hero',enemies:[{id:'beast-1',kind:'wolf',
      position:{x:12,y:7},battleHealth:21,battleMaxHealth:60}],
    visualTimeMs:0
  });
  const hero=c.text.find(x=>x.str==='73/100');
  assert.ok(hero,'the player needs a numeric health label under the avatar');
  assert.equal(hero.x,w/2,'the local avatar must be exactly screen centered');
  assert.ok(c.text.some(x=>x.str==='21/60'),
    'the beast must display the same numeric health bar');
  assert.match(painterSource,/const bar=cell\*\.76,barY=sy\+cell\*\.34/);
  assert.match(painterSource,/ctx\.fillStyle='#c8d895'/);
  assert.match(painterSource,/ctx\.fillStyle='#df8a73'/);
});
test('coincident teammates do not displace the player from the center',()=>{
  const w=844,h=390,p={x:2,y:2},c=canvas();
  const camera=Camera.lockToPlayer(p,map,w,h);
  drawWorld(c.ctx,map,camera,w,h,{
    members:[{uid:'teammate',position:p,battleHealth:65,battleMaxHealth:100},
      {uid:'hero',position:p,battleHealth:97,battleMaxHealth:100}],
    selfUid:'hero'
  });
  const hero=c.text.find(t=>t.str==='97/100');
  assert.ok(hero);
  assert.equal(hero.x,w/2);
});
test('boss HP uses the same trial HUD and on-sprite numeric meter',()=>{
  const boss={id:'boss-1',kind:'boss',position:{x:10,y:7},
    battleHealth:500,battleMaxHealth:900};
  const c=canvas();
  drawWorld(c.ctx,{...map,arena:'boss'},
    Camera.lockToPlayer({x:10,y:7},map,844,390),844,390,
    {enemies:[boss],members:[]});
  assert.ok(c.text.some(t=>t.str==='500/900'));
  const reference=read('public/styles/tactical-boss-presentation.css');
  const mirrored=reference.replaceAll('#tactical-combat.tc-quarter-layout',
    '#dungeon-map-view.tc-quarter-layout').replaceAll('#tactical-combat',
    '#dungeon-map-view');
  assert.ok(read('public/styles/dungeon-trial-boss.css').includes(mirrored));
});
test('only trial HUD lives in the page; no old minimap, controls, Dpad or duplicate HP',()=>{
  const view=read('public/cultivation/dungeon-map-view.js');
  const html=view.match(/root\.innerHTML=`([\s\S]*?)`;/)?.[1];
  assert.ok(html);
  for(const legacy of ['dm-controls','dm-overview','dm-biome','dm-legend',
      'dm-foot','dm-movement','dm-manual','dm-dpad']){
    assert.ok(!html.includes('class="'+legacy),'old display remains: '+legacy);
  }
  assert.match(html,/tc-boss-hud/);
  assert.match(html,/tc-boss-fill/);
  assert.match(html,/dm-hidden-contract/);
  assert.match(view,/stage\.insertAdjacentHTML\('beforeend',dungeonTrialWheelHTML\(\)\)/);
  assert.doesNotMatch(view,/dungeon-quarter-controls\.css/);
  assert.doesNotMatch(view,/drawMinimap\(/);
  assert.doesNotMatch(view,/Camera\.pan\(|Camera\.zoomAt\(/);
  assert.equal(fs.existsSync(path.join(__dirname,'../public/styles/dungeon-quarter-controls.css')),false);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const normalize=src=>src.replace(/^import .*$/gm,'').replace(/^export /gm,'');
const {dungeonEnergySegments}=new Function(normalize(
  read('public/cultivation/dungeon-quarter-controls.js'))+
  '\nreturn {dungeonEnergySegments};')();
const wheels=new Function('dungeonEnergySegments',normalize(
  read('public/cultivation/dungeon-trial-wheel.js'))+
  '\nreturn {dungeonTrialWheelHTML,dungeonWheelWedge,dungeonWheelAngle,dungeonWheelIndex};'
)(dungeonEnergySegments);
const mapTools=new Function(normalize(read('public/cultivation/dungeon-map-actions.js'))+
  '\nreturn {dungeonRoute,dungeonReachableTiles,dungeonAttackTiles};')();
const M=require('../dungeon-movement.cjs');
const gen=require('../dungeon-map-generator.cjs');
function plainMap(){
  const width=12,height=10,tiles=Array(width*height).fill(1);
  for(let y=1;y<9;y++)if(y!==5)tiles[y*width+6]=0;
  return {mode:'dungeon',layoutVersion:1,width,height,tiles,biome:'ruins',
    spawn:{x:1,y:1},spawnPads:[{x:1,y:1}],
    guardianSite:{x:9,y:7},portalSite:{x:10,y:8}};
}
test('trial and dungeon share the same two concentric ring geometries',()=>{
  const trial=read('public/cultivation/tactical-combat.js');
  assert.match(trial,/upper:-112\.5,lower:-157\.5,center:-135/);
  const html=wheels.dungeonTrialWheelHTML();
  assert.equal((html.match(/class="tc-quarter tc-quarter-/g)||[]).length,2);
  assert.match(html,/tc-quarter-energy/);
  assert.match(html,/tc-quarter-action/);
  assert.match(html,/tc-wheel-slider-rotor/);
  assert.match(html,/tc-wheel-slider-detail/);
  assert.match(html,/tc-wheel-slider-action/);
  assert.match(html,/data-dm="wheel-attack"/);
  assert.match(html,/data-dm="wheel-move"/);
  assert.doesNotMatch(html,/data-end|結束回合/);
  assert.equal((html.match(/data-dm-energy-segment/g)||[]).length,10);
  assert.equal(wheels.dungeonWheelAngle(0,1),-135);
  assert.equal(wheels.dungeonWheelIndex(-90,3),0);
  assert.equal(wheels.dungeonWheelIndex(-180,3),2);
  assert.match(wheels.dungeonWheelWedge(-90,-135,74,49),/^polygon\(/);
});
test('trial stylesheet stays an exact scoped mirror and gold focus overrides remain',()=>{
  const tactical=read('public/styles/tactical-quarter-controls.css');
  const mirrored=tactical.replaceAll('#tactical-combat.tc-quarter-layout',
    '#dungeon-map-view.tc-quarter-layout').replaceAll('#tactical-combat',
    '#dungeon-map-view');
  const css=read('public/styles/dungeon-trial-wheel.css');
  assert.ok(css.includes(mirrored),'quarter controls have drifted from the trial');
  assert.match(css,/\.tc-wheel-options>\.tc-sector\[data-wheel-choice\]\.is-focus-empowered\[aria-pressed\]/);
  assert.match(css,/dmFocusGoldSkill/);
});
test('BFS matches actual map walls, creatures and any-length tap-to-route',()=>{
  const map=plainMap();
  const before=JSON.stringify(map);
  const route=mapTools.dungeonRoute(map,{x:2,y:2},{x:9,y:2});
  assert.ok(route.length>7,'wall should require a detour');
  let point={x:2,y:2};
  for(const v of route){
    assert.equal(Math.abs(v.dx)+Math.abs(v.dy),1);
    point={x:point.x+v.dx,y:point.y+v.dy};
    assert.ok(map.tiles[point.y*map.width+point.x]>0);
  }
  assert.deepEqual(point,{x:9,y:2});
  assert.equal(mapTools.dungeonRoute(map,{x:2,y:2},{x:6,y:2}),null);
  assert.equal(mapTools.dungeonRoute(map,{x:2,y:2},{x:9,y:2},
    [{position:{x:9,y:2},kind:'wolf'}]),null);
  assert.equal(JSON.stringify(map),before);
});
test('server commits multi-step paths atomically, charging one stamina each',()=>{
  const map=plainMap();
  const vectors=mapTools.dungeonRoute(map,{x:2,y:2},{x:4,y:5});
  const own={uid:'a',joinedAtMs:100,position:{x:2,y:2},
    explorationStamina:10,moveSeq:0,battleHealth:100};
  const room={mode:'dungeon',status:'assembled',members:{a:own},enemies:[]};
  const result=M.moveRouteOnMap(room,'a',map,{vectors,step:1});
  assert.deepEqual(result.member.position,{x:4,y:5});
  assert.equal(result.member.explorationStamina,10-vectors.length);
  assert.equal(result.member.moveSeq,vectors.length);
  assert.deepEqual(own.position,{x:2,y:2},'original snapshot stays immutable');
  const retry=M.moveRouteOnMap({...room,members:result.members},
    'a',map,{vectors,step:1});
  assert.equal(retry.duplicate,true);
  assert.equal(retry.member.explorationStamina,result.member.explorationStamina);
});
test('route validation rejects fabricated jumps, blocked tiles and insufficient stamina',()=>{
  const map=plainMap();
  const room={status:'assembled',members:{
    a:{uid:'a',joinedAtMs:0,position:{x:2,y:2},
      explorationStamina:1,moveSeq:0,battleHealth:100}
  },enemies:[]};
  assert.throws(()=>M.moveRouteOnMap(room,'a',map,{vectors:[{dx:2,dy:0}],step:1}));
  assert.throws(()=>M.moveRouteOnMap(room,'a',map,{
    vectors:[{dx:1,dy:0},{dx:1,dy:0}],step:1
  }),/體力不足/);
  assert.throws(()=>M.moveRouteOnMap(room,'a',map,{
    vectors:[{dx:0,dy:1}],step:2
  }),/不同步/);
  const occupied={...room,enemies:[{kind:'wolf',position:{x:3,y:2}}]};
  assert.throws(()=>M.moveRouteOnMap(occupied,'a',map,{
    vectors:[{dx:1,dy:0}],step:1
  }),/靈獸擋住/);
});
test('map taps dispatch the selected attack, skill or walk immediately',()=>{
  const viewSource=normalize(read('public/cultivation/dungeon-map-view.js'));
  const DungeonMapView=new Function(viewSource+'\nreturn DungeonMapView;')();
  const obj=Object.create(DungeonMapView.prototype);
  const map=plainMap(),events=[];
  Object.assign(obj,{
    map,uid:'a',room:{status:'assembled',members:{
      a:{uid:'a',position:{x:2,y:2},battleHealth:100,
        dungeonSkills:[{id:'focus',kind:'fist-focus'},{id:'chain',kind:'fist-chain'}]}
    }},roomId:'test-room',wheelMode:'move',routePending:false,
    selectedSkillId:'chain',selectedBeastId:null,
    aimTile:null,followBeast:false,
    isCurrent:()=>true,selfPad:()=>({x:2,y:2}),
    creatures:()=>[{id:'wolf',kind:'wolf',position:{x:4,y:2}}],
    updateBeastHUD:()=>{},updateStrikeHUD:()=>{},
    updateSkillHUD:()=>{},drawSoon:()=>{},
    moveTo:p=>{events.push(['move',p]);},
    cast:id=>{events.push(['cast',id]);},
    strike:()=>events.push(['strike']),
    actionFeedback:s=>events.push(['hint',s])
  });
  obj.mapTap({x:3,y:2});
  assert.equal(events[0][0],'move');
  obj.wheelMode='attack';obj.selectedSkillId='chain';
  obj.mapTap({x:4,y:2});
  assert.deepEqual(events[1],['cast','chain']);
  obj.selectedSkillId='basic';obj.mapTap({x:4,y:2});
  assert.deepEqual(events[2],['strike']);
  obj.selectedSkillId='focus';obj.mapTap({x:3,y:2});
  assert.equal(events[3][0],'hint');
  obj.mapTap({x:2,y:2});
  assert.deepEqual(events[4],['cast','focus']);
});
test('range previews stay below sprites and paint both safe movement and attack cells',()=>{
  const map=plainMap();
  const from={x:2,y:2};
  const moves=mapTools.dungeonReachableTiles(map,from,[],4);
  assert.ok(moves.length>6);
  assert.ok(!moves.some(p=>p.x===6&&p.y===2),'wall cannot be walked onto');
  const body=mapTools.dungeonAttackTiles(map,from,{kind:'fist-chain',range:1});
  assert.equal(body.length,4);
  const focus=mapTools.dungeonAttackTiles(map,from,{kind:'fist-focus'});
  assert.deepEqual(focus,[from]);
  const painter=read('public/cultivation/dungeon-map-painter.js');
  assert.match(painter,/rangeTiles=\[\],rangeKind='move'/);
  assert.match(painter,/Render before all danger/);
});

test('radial selection prioritizes an outer manual over an accidentally hit inner move wedge',()=>{
  const wheel=read('public/cultivation/dungeon-trial-wheel.js');
  assert.match(wheel,/radius<\.745\|\|radius>1\.01/);
  assert.match(wheel,/event\.stopPropagation\(\)/);
  assert.match(wheel,/select\?\.\(chosen\.dataset\.wheelChoice\)/);
  assert.match(wheel,/wheel\.dataset\.mode!=='attack'/);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const R=require('../dungeon-stamina-rules.cjs');
const M=require('../dungeon-movement.cjs');
const Credits=require('../dungeon-quiz-credit.cjs');
const Rescue=require('../dungeon-team-rescue.cjs');
const Boss=require('../dungeon-boss-battle.cjs');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const pure=src=>src.replace(/^export /gm,'');
const cam=new Function(pure(read('public/cultivation/dungeon-map-camera.js'))+
  '\nreturn {initialCamera,lockToPlayer,geometry,mapPoint,zoomAt,pan,focusOn,resizePreservingCenter};')();
const quarter=new Function(pure(read('public/cultivation/dungeon-quarter-controls.js'))+
  '\nreturn {energyRingFill,dungeonEnergySegments};')();
const viewport=[{width:390,height:810},{width:844,height:390},
  {width:1280,height:720},{width:320,height:568}];
const map={width:71,height:47,tiles:Array(71*47).fill(1),
  spawn:{x:1,y:1},spawnPads:[{x:1,y:1}]};
const close=(a,b)=>assert.ok(Math.abs(a-b)<.0001,a+' ≠ '+b);
test('same canonical rules: stamina 10; correct +4; wrong +1; walking -1',()=>{
  assert.equal(R.MAX_STAMINA,10);
  assert.equal(R.START_STAMINA,10);
  assert.equal(R.STEP_COST,1);
  assert.equal(R.RIGHT,4);
  assert.equal(R.WRONG,1);
  assert.equal(M.START_STAMINA,10);
  assert.equal(M.STEP_COST,1);
  assert.equal(Credits.MAX_STAMINA,10);
  for(const n of [-3,0,1,5,9,10,11,50,100])assert.ok(
    R.clampStamina(n)>=0&&R.clampStamina(n)<=10);
  assert.equal(R.clampStamina(100),10);
  assert.equal(Rescue.SELF_COST,10,'self-rescue must remain possible under cap');
  assert.equal(Rescue.ALLY_COST,8);
  assert.equal(Boss.SELF_GUARD_COST,6);
  assert.equal(Boss.ALLY_GUARD_COST,3);
});
test('every energy segment shows exactly one of ten stamina points',()=>{
  assert.equal((quarter.dungeonEnergySegments().match(/data-dm-energy-segment/g)||[]).length,10);
  assert.deepEqual([-4,0,1,5,9,10,11,100,NaN].map(quarter.energyRingFill),
    [0,0,1,5,9,10,10,10,0]);
  const panel=read('public/cultivation/dungeon-quiz-panel.js');
  assert.match(panel,/答錯恢復 1 體力（上限 10）/);
  assert.doesNotMatch(panel,/上限 100/);
});
test('player is exactly at center at any map edge in portrait and landscape',()=>{
  const points=[{x:0,y:0},{x:70,y:46},{x:1,y:22},
    {x:34,y:1},{x:34,y:23},{x:70,y:0}];
  for(const p of points)for(const {width,height} of viewport){
    const camera=cam.lockToPlayer(p,map,width,height);
    const screen=cam.mapPoint(camera,p,map,width,height);
    close(screen.x,width/2);close(screen.y,height/2);
    const info=cam.geometry(camera,map,width,height);
    assert.ok(info.cell>=22&&info.cell<=56);
  }
});
test('camera cannot be dragged, zoomed, clamped away from the player or nudged on resize',()=>{
  for(const p of [{x:0,y:0},{x:70,y:46},{x:30,y:15}]){
    const camera=cam.lockToPlayer(p,map,390,810);
    const changed=[
      cam.pan(camera,9000,-9000,map,390,810),
      cam.zoomAt(camera,6,100,200,map,390,810),
      cam.focusOn(camera,p,map,390,810),
      cam.resizePreservingCenter(camera,map,390,810,844,390)
    ];
    for(const next of changed){
      assert.deepEqual(next.target,p);
      assert.equal(next.locked,true);
    }
    const landscape=cam.mapPoint(changed.at(-1),p,map,844,390);
    close(landscape.x,422);close(landscape.y,195);
  }
});
test('real-time view has no camera gesture path and always locks the player on render',()=>{
  const source=read('public/cultivation/dungeon-map-view.js');
  assert.doesNotMatch(source,/Camera\.(?:pan|zoomAt|fitMap|resizePreservingCenter)\(/);
  assert.match(source,/this\.camera=Camera\.lockToPlayer\(this\.selfPad\(\),m,w,h\)/);
  assert.match(source,/pointerMove\(event\)[\s\S]*?Map gestures never change the world camera/);
  assert.match(source,/wheel\(event\)\{if\(this\.opened\)event\.preventDefault\(\);\}/);
  assert.match(source,/不可拖曳地圖/);
  assert.match(source,/if\(this\.map\)\{[\s\S]*?Camera\.lockToPlayer\(this\.selfPad/);
});
test('trial quarter wheels remain visually mirrored; old camera chrome hidden',()=>{
  const trial=read('public/styles/tactical-quarter-controls.css');
  const mirror=trial.replaceAll('#tactical-combat.tc-quarter-layout',
    '#dungeon-map-view.tc-quarter-layout')
    .replaceAll('#tactical-combat','#dungeon-map-view');
  const css=read('public/styles/dungeon-trial-wheel.css');
  assert.ok(css.includes(mirror));
  assert.match(css,/\.dm-overview,[\s\S]*?\.dm-controls,[\s\S]*?\.dm-foot/);
  assert.match(css,/\.dm-world\{[\s\S]*?cursor:crosshair!important/);
  assert.match(css,/\.tc-quarter-energy>\.dm-quiz-charge\[data-quiz\]/);
  const wheel=read('public/cultivation/dungeon-trial-wheel.js');
  assert.doesNotMatch(wheel,/data-end|結束回合/);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {generateDungeonLayout}=require('../dungeon-map-generator.cjs');
const src=fs.readFileSync(path.join(__dirname,'../public/cultivation/dungeon-map-camera.js'),'utf8')
  .replace(/^export /gm,'');
const Cam=new Function(src+'\nreturn {initialCamera,geometry,normalized,pan,zoomAt,focusOn,fitMap,mapPoint,screenTile,visibleTiles,resizePreservingCenter,LIMITS}'); // pure module
const C=Cam();
const near=(a,b,tolerance=.02)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
test('all aspect ratios fit a finite map with a solid viewport and stable tiles',()=>{
  const m=generateDungeonLayout('stage6-camera');
  for(const [w,h]of [[200,330],[375,667],[430,920],[1024,768],[1280,720],[1100,360],[3000,1800]]){
    const a=C.initialCamera(),g=C.geometry(a,m,w,h);
    assert.ok(g.cell>0&&g.cell<=Math.min(w/m.width,h/m.height));
    near(g.ox,(w-m.width*g.cell)/2);
    near(g.oy,(h-m.height*g.cell)/2);
    assert.deepStrictEqual(C.screenTile(a,...Object.values(C.mapPoint(a,m.spawn,m,w,h)),m,w,h),m.spawn);
    const bounds=C.visibleTiles(a,m,w,h);
    assert.ok(bounds.x0>=0&&bounds.x1<m.width);
    assert.ok(bounds.y0>=0&&bounds.y1<m.height);
  }
});
test('zoom remains anchored to the gesture point and clamps at maximum range',()=>{
  const map=generateDungeonLayout('stage6-zoom');
  for(const [w,h]of [[400,780],[1000,420],[1100,800]]){
    let cam=C.initialCamera();
    const a={x:w*.52,y:h*.48};
    const targetBefore=C.screenTile(cam,a.x,a.y,map,w,h);
    cam=C.zoomAt(cam,4.2,a.x,a.y,map,w,h);
    const targetAfter=C.screenTile(cam,a.x,a.y,map,w,h);
    assert.deepStrictEqual(targetAfter,targetBefore);
    near(cam.zoom,4.2);
    cam=C.zoomAt(cam,1000,a.x,a.y,map,w,h);
    near(cam.zoom,C.LIMITS.MAX_ZOOM);
    cam=C.zoomAt(cam,-500,a.x,a.y,map,w,h);
    near(cam.zoom,C.LIMITS.MIN_ZOOM);
  }
});
test('drag never allows the dungeon to leave the entire viewport',()=>{
  const map=generateDungeonLayout('stage6-drag');
  for(const [w,h]of [[360,650],[900,400],[1600,1200]]){
    for(const [dx,dy]of [[1e8,1e8],[-1e8,-1e8],[3e7,-2e7]]){
      const zoomed=C.zoomAt(C.initialCamera(),4,w/2,h/2,map,w,h);
      const camera=C.pan(zoomed,dx,dy,map,w,h);
      const g=C.geometry(camera,map,w,h);
      assert.ok(g.ox<=w&&g.oy<=h);
      assert.ok(g.ox+g.totalX>=0&&g.oy+g.totalY>=0);
      assert.ok(Number.isFinite(g.ox)&&Number.isFinite(g.oy));
    }
  }
});
test('focus follows a chosen team spawn; resizing maintains the world center',()=>{
  const map=generateDungeonLayout('stage6-follow');
  for(const [w,h]of [[800,600],[410,800],[1000,420]]){
    const enlarged=C.zoomAt(C.initialCamera(),5,w/2,h/2,map,w,h);
    const nearSpawn=C.focusOn(enlarged,map.spawnPads[3],map,w,h);
    const pad=C.mapPoint(nearSpawn,map.spawnPads[3],map,w,h);
    // A near-edge spawn may not be perfectly centered: camera bounds take
    // precedence to avoid exposing a huge empty region outside the map.
    assert.ok(pad.x>=0&&pad.x<=w&&pad.y>=0&&pad.y<=h);
    const center={x:Math.floor(map.width/2),y:Math.floor(map.height/2)};
    const focus=C.focusOn(enlarged,center,map,w,h);
    const tile=C.screenTile(focus,w/2,h/2,map,w,h);
    assert.deepStrictEqual(tile,center);
    const old=C.geometry(focus,map,w,h);
    const centerWorld={x:(w/2-old.ox)/old.cell,y:(h/2-old.oy)/old.cell};
    const resized=C.resizePreservingCenter(focus,map,w,h,h,w);
    const now=C.geometry(resized,map,h,w);
    near((h/2-now.ox)/now.cell,centerWorld.x,.65);
    near((w/2-now.oy)/now.cell,centerWorld.y,.65);
  }
});
test('camera functions never change the authoritative dungeon map data',()=>{
  const map=generateDungeonLayout('stage6-unmodified'),original=JSON.stringify(map);
  let camera=C.initialCamera();
  for(let i=0;i<100;i++){
    camera=C.pan(camera,i,-i,map,490,380);
    camera=C.zoomAt(camera,2+(i%4),130,155,map,490,380);
    camera=C.focusOn(camera,map.guardianSite,map,490,380);
    C.visibleTiles(camera,map,490,380);
  }
  assert.equal(JSON.stringify(map),original);
});

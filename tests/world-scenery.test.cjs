'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const W=require('../public/world/world-core.js'),S=require('../public/world/world-scenery.js'),G=require('../public/world/world-ground.js'),A=require('../public/world/world-art.js');
const plain=(seed='scenery')=>{
  const world=W.createWorld(seed);
  return {...world,terrain:()=> 'grass',objectAt:()=>undefined,objectsIn:()=>[]};
};
test('bamboo and stone props are sparse, seeded, and identical across browser/server and visit order',()=>{
  const context={};vm.runInNewContext(fs.readFileSync(require.resolve('../public/world/world-scenery.js'),'utf8'),context);
  const a=S.create(plain()),b=S.create(plain()),browser=context.QAGridWorldScenery.create(plain()),other=S.create(plain('another'));
  for(const [terrain,prop,min,max]of [['bamboo','bamboo',.1,.34],['stone',null,.04,.18]]){
    const cells=[];for(let y=20;y<84;y++)for(let x=20;x<84;x++)cells.push([x,y]);
    const generated=cells.map(([x,y])=>a.ambient(x,y,terrain)),fraction=generated.filter(items=>items.some(p=>prop?p.prop===prop:['rock','rubble'].includes(p.prop))).length/cells.length;
    assert.ok(fraction>min&&fraction<max,terrain+' density '+fraction);
    for(const [x,y]of cells.toReversed())assert.equal(JSON.stringify(b.ambient(x,y,terrain)),JSON.stringify(a.ambient(x,y,terrain)));
    assert.equal(JSON.stringify(cells.map(([x,y])=>browser.ambient(x,y,terrain))),JSON.stringify(generated));
    assert.notEqual(JSON.stringify(cells.map(([x,y])=>other.ambient(x,y,terrain))),JSON.stringify(generated));
    if(terrain==='stone')for(const [x,y]of cells)if(a.ambient(x,y,terrain).length)for(const [dx,dy]of S.STEPS)assert.equal(a.ambient(x+dx,y+dy,terrain).length,0,'stone piles keep an adjacent clear tile');
  }
});
test('site scenery has matching structures, avoids objects and roads, and respects both anchor and tile fog',()=>{
  const camp={id:'camp-test',kind:'structure',subtype:'camp',x:100,y:100},ruins={...camp,id:'ruins-test',subtype:'ruins',x:115};
  const original=plain(),world={...original,objectsIn:()=>[camp,ruins],objectAt:(x,y)=>[camp,ruins].find(o=>o.x===x&&o.y===y)},scenery=S.create(world);
  assert.ok(scenery.site(camp).filter(p=>p.prop==='fence').length>=8);assert.ok(scenery.site(camp).some(p=>p.prop==='gate'));
  assert.ok(scenery.site(ruins).some(p=>p.prop==='rubble'));assert.ok(scenery.site(ruins).some(p=>p.prop==='broken-wall'));
  const bounds={x:96,y:96,w:24,h:10},items=scenery.inBounds(bounds),occupied=items.map(p=>W.key(Math.floor(p.x),Math.floor(p.y)));
  assert.equal(new Set(occupied).size,occupied.length,'sites do not place competing decorations on a tile');
  for(const p of items)assert.equal(world.objectAt(Math.floor(p.x),Math.floor(p.y)),undefined);
  assert.deepEqual(scenery.inBounds(bounds,{},()=>false),[]);
  assert.ok(!scenery.inBounds(bounds,{},(x,y)=>x!==camp.x||y!==camp.y).some(p=>p.owner===camp.id),'a hidden building does not leak through its surroundings');
  const clipped=scenery.inBounds({x:96,y:96,w:8,h:10});assert.deepEqual(clipped,items.filter(p=>p.x<104));
  const paved=S.create({...world,terrain:(x,y)=>x===100?'road':'grass'});assert.ok(paved.site(camp).every(p=>Math.floor(p.x)!==100));
});
test('road masks connect every junction at seams and close absent arms; bridge orientation follows its banks',()=>{
  for(let mask=0;mask<16;mask++){
    const centres=[[.5,0],[1,.5],[.5,1],[0,.5]];
    centres.forEach(([u,v],i)=>assert.equal(G.roadAlpha(mask,u,v),mask&(1<<i)?1:0));
    assert.equal(G.roadAlpha(mask,.5,.5),1);
  }
  for(let n=0;n<=20;n++){
    const t=n/20;assert.equal(G.transitionAlpha(1,1,t),G.transitionAlpha(3,0,t));assert.equal(G.transitionAlpha(0,t,0),G.transitionAlpha(2,t,1));
    assert.equal(G.roadAlpha(2,1,t),G.roadAlpha(8,0,t));
  }
  let vertical=false;const world={...plain(),terrain:(x,y)=>x===30&&y===30?'bridge':vertical?(x===30?'road':'water'):(y===30?'road':'water')};
  const scene=S.create(world);assert.equal(scene.topology(30,30,'bridge').bridgeDirection,'east');vertical=true;assert.equal(scene.topology(30,30,'bridge').bridgeDirection,'south');
  const before=scene.topology(30,30,'bridge');vertical=false;assert.notEqual(before.key,scene.topology(30,30,'bridge').key);
  assert.ok(scene.topology(30,30,'grass',{},()=>false).neighbours.every(t=>t==='grass'),'unknown neighbour types stay hidden');
});
test('directional art has distinct generated sheets and every source cell stays inside the atlas',()=>{
  assert.equal(new Set(A.directions.map(d=>A.directional('fence',d).image)).size,4);
  for(const d of A.directions)for(const prop of A.sceneryProps){const sprite=A.directional(prop,d);assert.ok(sprite.sx+sprite.sw<=512&&sprite.sy+sprite.sh<=256);}
});
test('visual scenery does not change world terrain, persisted patch state, or legal movement',()=>{
  const world=W.createWorld('visual-only'),scene=S.create(world),bounds={x:490,y:490,w:24,h:24};
  const before=JSON.stringify(world.chunk(15,15)),patches=JSON.stringify(world.patchVersions()),route=world.plan(world.SPAWN,{x:530,y:500});
  scene.inBounds(bounds);for(let y=490;y<514;y++)for(let x=490;x<514;x++)scene.topology(x,y,world.terrain(x,y));
  assert.equal(JSON.stringify(world.chunk(15,15)),before);assert.equal(JSON.stringify(world.patchVersions()),patches);assert.deepEqual(world.plan(world.SPAWN,{x:530,y:500}).path,route.path);
});

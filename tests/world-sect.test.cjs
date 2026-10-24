'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../public/world/world-core.js'),S=require('../public/world/world-scenery.js'),A=require('../public/world/world-art.js');
const at=(dx,dy)=>({x:W.SPAWN.x+dx,y:W.SPAWN.y+dy});

test('expanded sect keeps every existing entrance and provides real streams, bridges and four exits',()=>{
  assert.equal(W.CITY_RADIUS*2+1,55);
  const oldDoors={meditation:[-4,-5],forge:[4,-4],contract:[5,3],vault:[-4,3],rank:[-5,-1],quest:[2,-2],duel:[7,-1],raid:[8,-5]};
  for(const [id,[dx,dy]]of Object.entries(oldDoors)){
    const door=W.object(id);assert.deepEqual({x:door.x,y:door.y},at(dx,dy));
    const route=W.approach(W.SPAWN,door);assert.ok(route.path.length,id);assert.ok(W.distance(route.path.at(-1),door)<=1);
  }
  for(const side of [-1,1])for(const dy of [-7,0,6]){
    const x=side*(13+Math.round(Math.sin((dy+4)/7)*1.4)),p=at(x,dy);
    assert.equal(W.terrain(p.x,p.y),'bridge');assert.ok(W.walkable(p.x,p.y));
    const route=W.plan(at(side*9,dy),at(side*18,dy));assert.equal(route.partial,false);
    assert.ok(route.path.some(q=>W.terrain(q.x,q.y)==='bridge'));assert.ok(route.path.every(q=>W.walkable(q.x,q.y)));
    const water=at(x,dy+1);assert.equal(W.terrain(water.x,water.y),'water');assert.equal(W.walkable(water.x,water.y),false);
  }
  for(const [dx,dy]of W.DIRS){const p=at(dx*23,dy*23);assert.ok(W.plan(W.SPAWN,p).path.length);}
  const wall=at(W.CITY_RADIUS,4);assert.equal(W.walkable(wall.x,wall.y),false,'solid perimeter cannot be crossed through a painted wall');
});

test('multi-cell palace, rockeries and pavilions block their bases while roofs remain visual overhangs',()=>{
  for(const item of W.SECT_LANDMARKS){
    assert.ok(item.w>120&&item.h>120);const f=item.footprint;
    for(let y=f.y;y<f.y+f.h;y++)for(let x=f.x;x<f.x+f.w;x++)assert.equal(W.walkable(W.SPAWN.x+x,W.SPAWN.y+y),false,item.id);
    const approaches=[at(f.x-1,f.y+f.h-1),at(f.x+f.w,f.y+f.h-1),at(f.x+Math.floor(f.w/2),f.y+f.h)];
    assert.ok(approaches.some(p=>W.plan(W.SPAWN,p).path.length),item.id+' garden approach');
  }
  const restored=W.safePosition(at(0,-16));assert.ok(W.walkable(restored.x,restored.y));assert.notDeepEqual(restored,at(0,-16));
});

test('large ornaments remain stable when only their overhang is inside the viewport and obey fog',()=>{
  const scene=S.create(W),all=scene.inBounds({x:470,y:470,w:61,h:61});
  for(const prop of ['sect-palace','sect-rockery','sect-pavilion','sect-medallion','sect-bridge-ew','sect-lotus'])assert.ok(all.some(p=>p.prop===prop),prop);
  const palace=all.find(p=>p.prop==='sect-palace'),sprite=A.scenery(palace);
  const bounds={x:palace.x-4,y:palace.y-5,w:1,h:1};
  assert.ok(scene.inBounds(bounds).some(p=>p.prop==='sect-palace'),'roof enters the viewport with its anchor offscreen');
  assert.ok(!scene.inBounds(bounds,{},()=>false).length);
  assert.ok(!scene.inBounds(bounds,{},(x,y)=>x!==500||y!==483).some(p=>p.prop==='sect-palace'),'hidden footprint does not leak a roof');
  assert.ok(sprite.w>W.CITY_RADIUS*10&&sprite.sw>=1024);
  const baseline=JSON.stringify(all);assert.equal(JSON.stringify(scene.inBounds({x:470,y:470,w:61,h:61})),baseline);
  for(const p of all.filter(p=>p.prop.startsWith('sect-'))){const s=A.scenery(p);if(s.image==='sect-garden-atlas')assert.ok(s.sx+s.sw<=1536&&s.sy+s.sh<=1536);}
});

test('sect architecture is the same for every seed without altering the surrounding world or patch saves',()=>{
  const a=W.createWorld('garden-a'),b=W.createWorld('garden-b');
  const patches=JSON.stringify(a.patchVersions());
  for(let dy=-W.CITY_RADIUS;dy<=W.CITY_RADIUS;dy++)for(let dx=-W.CITY_RADIUS;dx<=W.CITY_RADIUS;dx++){
    const p=at(dx,dy);assert.equal(a.baseTerrain(p.x,p.y),b.baseTerrain(p.x,p.y));assert.equal(a.walkable(p.x,p.y),b.walkable(p.x,p.y));
  }
  assert.deepEqual(S.create(a).sect(),S.create(b).sect());assert.equal(JSON.stringify(a.patchVersions()),patches);
  assert.equal(a.GENERATOR_VERSION,'qingyun-seeded-v2','saved world identity stays compatible');
  const before=a.terrain(800,800);S.create(a).inBounds({x:475,y:475,w:51,h:51});assert.equal(a.terrain(800,800),before);
});

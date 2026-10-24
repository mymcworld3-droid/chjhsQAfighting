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
  for(const [terrain,prop,min,max]of [['bamboo','bamboo-',.1,.34],['stone','stone-',.04,.18]]){
    const cells=[];for(let y=20;y<84;y++)for(let x=20;x<84;x++)cells.push([x,y]);
    const generated=cells.map(([x,y])=>a.ambient(x,y,terrain)),fraction=generated.filter(items=>items.some(p=>p.prop.startsWith(prop))).length/cells.length;
    assert.equal(new Set(generated.flat().filter(p=>p.prop.startsWith(prop)).map(p=>p.prop)).size,3,'all three visual variants appear');
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
  const corners=S.connect(scenery.site(camp)).filter(p=>p.prop==='fence'&&Math.floor(p.y)===98&&[98,102].includes(Math.floor(p.x)));
  assert.deepEqual(corners.map(p=>p.mask),[6,12],'corners derive two arms from their adjacent cells');
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
  for(const material of ['fence','wall'])assert.equal(new Set(A.directions.map(d=>{const s=A.directional(material,d);return s.image+':'+s.sx+':'+s.sy;})).size,4);
  for(const d of A.directions)for(const prop of A.sceneryProps){const sprite=A.directional(prop,d);assert.ok(sprite.sx+sprite.sw<=512&&sprite.sy+sprite.sh<=256);}
  assert.equal(new Set(A.directions.map(direction=>A.monster({species:'靈狼',direction}).image)).size,4);
  assert.equal(new Set(A.directions.map(d=>A.directional('boat',d).sx)).size,4);
  for(const id of A.buildings){const sprites=A.directions.map(direction=>A.object({id,kind:'building',direction}));assert.ok(sprites.every(s=>s.image===id&&s.sx===0&&s.sy===0&&s.sw===256&&s.sh===256),'buildings keep the original single view');}
});
test('all sixteen fence/wall states are derived from cardinal neighbours, including automatic removal',()=>{
  const centre={x:31.5,y:31.6};
  for(const prop of ['fence','wall'])for(let mask=0;mask<16;mask++){
    const nodes=[{...centre,prop}];for(let i=0;i<4;i++)if(mask&(1<<i))nodes.push({x:centre.x+S.STEPS[i][0],y:centre.y+S.STEPS[i][1],prop});
    const result=S.connect(nodes),p=result[0];assert.equal(p.mask,mask);
    assert.equal(p.post,prop==='fence'||![5,10].includes(mask));
    for(let i=0;i<4;i++)if(mask&(1<<i))assert.ok(result.find(n=>n.x===centre.x+S.STEPS[i][0]&&n.y===centre.y+S.STEPS[i][1]).mask&(1<<((i+2)%4)),'shared connection is reciprocal');
    const parts=A.barrierParts(p);assert.equal(parts.length,1+mask.toString(2).replace(/0/g,'').length);
    for(const part of parts){const s=part.sprite;assert.equal(s.image,prop+'-connectors-atlas');assert.ok(s.sx+s.sw<=384&&s.sy+s.sh<=256);}
    assert.equal(parts.at(-1).sprite.sx,p.post?0:256);assert.equal(parts.at(-1).sprite.sy,p.post?0:128);
    assert.equal(S.connect(nodes.slice(0,1))[0].mask,0,'removing neighbours retracts every arm');
    assert.equal(nodes[0].mask,undefined,'connection calculation does not mutate the seeded layout');
  }
});
test('barriers ignore diagonals and other materials and only attach to a gate along its fence axis',()=>{
  const p={prop:'fence',x:50.5,y:50.6};
  assert.equal(S.connect([p,{prop:'wall',x:51.5,y:50.6},{prop:'fence',x:51.5,y:51.6}])[0].mask,0);
  for(let i=0;i<4;i++)for(const direction of A.directions){
    const gate={prop:'gate',direction,x:p.x+S.STEPS[i][0],y:p.y+S.STEPS[i][1]},allowed=(['north','south'].includes(direction)?10:5)&(1<<i);
    assert.equal(!!S.connect([p,gate])[0].mask,!!allowed);
  }
});
test('connection masks survive viewport/chunk seams and update when neighbouring scenery is revealed',()=>{
  const camp={id:'seam-camp',kind:'structure',subtype:'camp',x:31,y:31},world={...plain(),objectsIn:()=>[camp]},scene=S.create(world),bounds={x:31,y:29,w:1,h:1};
  const find=items=>items.find(p=>p.prop==='fence'&&Math.floor(p.x)===31&&Math.floor(p.y)===29);
  const all=scene.inBounds({x:26,y:26,w:12,h:12}),clipped=scene.inBounds(bounds);
  assert.equal(find(clipped).mask,10);assert.deepEqual(find(clipped),find(all));
  assert.equal(find(scene.inBounds(bounds,{},(x,y)=>x!==32||y!==29)).mask,8,'hidden neighbour does not leak a connecting arm');
  assert.equal(find(scene.inBounds(bounds)).mask,10);
  const s=W.SPAWN,r=W.CITY_RADIUS,town=S.create({...plain(),terrain:()=> 'courtyard'}).inBounds({x:s.x-r,y:s.y-r,w:r*2+1,h:r*2+1});
  const corner=town.filter(p=>p.prop==='wall'&&Math.floor(p.x)===s.x-r&&Math.floor(p.y)===s.y-r);assert.equal(corner.length,1);assert.equal(corner[0].mask,6);
  const sectGates=town.filter(p=>p.prop==='sect-gate');
  assert.equal(sectGates.length,4,'one dedicated gate at each cardinal road entrance');
  assert.deepEqual(sectGates.map(g=>g.direction).sort(),['east','north','south','west']);
  for(const gate of sectGates){
    const horizontal=['north','south'].includes(gate.direction);
    for(const sign of [-1,1])assert.ok(town.some(p=>p.prop==='wall'&&Math.floor(p.x)===Math.floor(gate.x)+(horizontal?sign:0)&&Math.floor(p.y)===Math.floor(gate.y)+(horizontal?0:sign)&&p.mask===(horizontal?10:5)),'town wall joins both sides of each gate');
  }
});
test('single-facing buildings keep their south entrance and matching surroundings even beside a northern road',()=>{
  const world={...plain(),terrain:(x,y)=>y===97?'road':'grass'},scene=S.create(world),camp={id:'camp-front',kind:'structure',subtype:'camp',x:100,y:100};
  const items=scene.site(camp),gate=items.find(p=>p.prop==='gate');assert.ok(gate);assert.equal(gate.direction,'south');assert.equal(gate.y,102.6);assert.equal(gate.x,100.5);
  assert.ok(!items.some(p=>Math.floor(p.x)===100&&Math.floor(p.y)===101),'door approach stays clear');
  assert.ok(items.some(p=>p.prop==='fire'));assert.ok(items.some(p=>p.prop==='logs'));
});
test('visual scenery does not change world terrain, persisted patch state, or legal movement',()=>{
  const world=W.createWorld('visual-only'),scene=S.create(world),bounds={x:490,y:490,w:24,h:24};
  const before=JSON.stringify(world.chunk(15,15)),patches=JSON.stringify(world.patchVersions()),route=world.plan(world.SPAWN,{x:530,y:500});
  scene.inBounds(bounds);for(let y=490;y<514;y++)for(let x=490;x<514;x++)scene.topology(x,y,world.terrain(x,y));
  assert.equal(JSON.stringify(world.chunk(15,15)),before);assert.equal(JSON.stringify(world.patchVersions()),patches);assert.deepEqual(world.plan(world.SPAWN,{x:530,y:500}).path,route.path);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../public/world/world-core.js'),S=require('../public/world/world-scenery.js'),G=require('../public/world/world-ground.js'),A=require('../public/world/world-art.js');
const block=(x,y,w=2,h=2)=>Array.from({length:w*h},(_,i)=>({x:x+i%w,y:y+Math.floor(i/w)}));
function fixture(cells){
  const roads=new Set(cells.map(p=>W.key(p.x,p.y))),world={...W.createWorld(),terrain:(x,y,events={})=>events.tiles?.[W.key(x,y)]||(roads.has(W.key(x,y))?'road':'grass')},scene=S.create(world);
  return {world,scene,at:(x,y,events={},visible)=>scene.topology(x,y,world.terrain(x,y,events),events,visible)};
}
function install(world,cells,revision=1,overrides={}){
  const chunks={};
  for(const p of cells){
    const k=world.chunkKey(p.x,p.y);chunks[k]||={revision,tiles:{}};
    chunks[k].tiles[(p.y%32)*32+p.x%32]={terrain:overrides[W.key(p.x,p.y)]||'road'};
  }
  world.installPatches(chunks);
}

test('only all four roads in a 2 x 2 block fill their shared corner',()=>{
  const cells=block(10,10),corners=[4,8,2,1];
  for(let pattern=0;pattern<16;pattern++){
    const {at}=fixture(cells.filter((_,i)=>pattern&(1<<i)));
    for(const [i,p]of cells.entries()){
      const info=at(p.x,p.y);assert.equal(info.paving,pattern===15?corners[i]:0,'pattern '+pattern+' tile '+i);
      assert.equal(info.terrain,pattern&(1<<i)?'road':'grass','non-road terrain is never converted');
    }
  }
});

test('the entire small centre hole is opaque while the four outside corners retain the narrow road shape',()=>{
  const {at}=fixture(block(10,10));
  for(const p of block(10,10)){
    const info=at(p.x,p.y);
    for(let row=0;row<40;row++)for(let col=0;col<40;col++){
      const u=(col+.5)/40,v=(row+.5)/40,x=p.x+u,y=p.y+v;
      if(x>=10.5&&x<=11.5&&y>=10.5&&y<=11.5)assert.equal(G.roadAlpha(info.mask,u,v,info.paving),1);
    }
  }
  for(const[x,y,u,v]of [[10,10,.1,.1],[11,10,.9,.1],[11,11,.9,.9],[10,11,.1,.9]]){
    const info=at(x,y);assert.equal(G.roadAlpha(info.mask,u,v,info.paving),0,'outside corner retains its underlay');
  }
});

test('larger rings leave their centre and inner edge halves unfilled',()=>{
  for(const size of [3,7,9]){
    const roads=block(10,10,size,size).filter(p=>p.x===10||p.y===10||p.x===9+size||p.y===9+size),{at}=fixture(roads);
    for(const p of block(9,9,size+2,size+2))assert.equal(at(p.x,p.y).paving,0,'large perimeter never fills terrain or road halves');
    const centre=at(11,11);assert.equal(centre.terrain,'grass');
  }
});

test('adjacent solid blocks join continuously without extending beyond their actual tiles',()=>{
  const {at}=fixture(block(10,10,3,3));assert.equal(at(11,11).paving,15);
  assert.equal(at(11,10).paving,12);assert.equal(at(10,11).paving,6);assert.equal(at(10,10).paving,4);
  for(const p of [{x:9,y:11},{x:13,y:11},{x:11,y:9},{x:11,y:13}])assert.equal(at(p.x,p.y).paving,0);
});

test('small holes across chunk seams update immediately after patches and event overrides',()=>{
  const world=W.createWorld('patched-2x2'),scene=S.create(world),roads=block(31,31);
  const at=(x,y,events={})=>scene.topology(x,y,world.terrain(x,y,events),events);
  install(world,roads,1,{'32,32':'grass'});assert.equal(at(31,31).paving,0);
  install(world,roads,2);const filled=at(31,31);assert.equal(filled.paving,4);
  const events={tiles:{'32,32':'grass'}};assert.equal(at(31,31,events).paving,0);
  events.tiles['32,32']='road';assert.equal(at(31,31,events).paving,4,'in-place event changes need no global preparation');
  install(world,roads,3,{'32,32':'grass'});assert.equal(at(31,31).paving,0);assert.notEqual(at(31,31).key,filled.key);
});

test('water, bridges, missing diagonals, hidden neighbours and map edges do not complete a solid road block',()=>{
  const {at,scene}=fixture(block(10,10));
  for(const type of ['water','bridge','broken-bridge','courtyard','rock']){
    const events={tiles:{'11,11':type}};
    for(const p of block(10,10))assert.equal(at(p.x,p.y,events).paving,0,type+' is not a road');
  }
  assert.equal(scene.topology(10,10,'plaza').paving,0,'central medallion texture is preserved');
  assert.equal(at(10,10,{},(x,y)=>x!==11||y!==11).paving,0,'hidden diagonals do not infer a closed corner');
  const edges=fixture(block(0,0));assert.equal(edges.at(0,0).paving,4,'out-of-world fallback road neighbours cannot fill outside quadrants');
});

test('sect ground and gardens retain their identities while dense road junctions lose their small holes',()=>{
  const world=W.createWorld(),scene=S.create(world),before=JSON.stringify(world.patchVersions()),snapshots=[];
  for(let y=476;y<=524;y++)for(let x=476;x<=524;x++){
    const terrain=world.terrain(x,y),walkable=world.walkable(x,y),info=scene.topology(x,y,terrain);snapshots.push({x,y,terrain,walkable});
    assert.equal(info.terrain,terrain);if(terrain!=='road')assert.equal(info.paving,0);
  }
  const court=scene.topology(497,486,world.terrain(497,486));assert.equal(court.terrain,'courtyard');assert.equal(court.paving,0);
  assert.equal(scene.topology(500,497,world.terrain(500,497)).paving,15,'3-wide road centre has four solid 2 x 2 neighbours');
  const approachY=W.SPAWN.y-W.CITY_RADIUS-1;
  assert.equal(world.terrain(500,approachY),'road');
  assert.equal(scene.topology(500,approachY,'road').paving,0,'single-width approach outside the sect remains narrow');
  for(const {x,y,terrain,walkable}of snapshots){assert.equal(world.terrain(x,y),terrain);assert.equal(world.walkable(x,y),walkable);}
  assert.equal(JSON.stringify(world.patchVersions()),before);
});

test('corner detection samples only the eight immediate neighbours and is independent of visit order',()=>{
  let reads=0;const cells=new Set(block(31,31).map(p=>W.key(p.x,p.y))),world={...W.createWorld(),terrain:(x,y)=>{reads++;return cells.has(W.key(x,y))?'road':'grass';}},scene=S.create(world);
  assert.equal(scene.topology(31,31,'road').paving,4);assert.equal(reads,8,'no world scan or flood fill');
  const expected=block(31,31).map(p=>scene.topology(p.x,p.y,'road').key);
  for(const p of block(31,31).toReversed())scene.topology(p.x,p.y,'road');
  assert.deepEqual(block(31,31).map(p=>scene.topology(p.x,p.y,'road').key),expected);
});

test('small-corner masks are cached separately and fully surrounded road pixels remain opaque',()=>{
  const masks=[],copies=[],factory=()=>({width:0,height:0,getContext(){return {
    save(){},restore(){},translate(){},scale(){},drawImage(...args){copies.push(args);},
    createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(data){masks.push(data);}
  };}});
  const ground=G.create(A,factory),atlas={complete:true,naturalWidth:512},images={'ground-atlas':atlas};ground.setScale(1);
  const info={x:10,y:10,terrain:'road',mask:6,underlay:'courtyard',neighbours:Array(8).fill('courtyard'),key:'shared-topology'};
  const open=ground.compose(info,images),closed=ground.compose({...info,paving:4},images);
  assert.notStrictEqual(open,closed);assert.equal(masks[0].data[(36*40+36)*4+3],0);
  assert.equal(masks[1].data[(36*40+36)*4+3],255,'shared corner receives fully opaque road pixels');
  assert.equal(masks[1].data[(3*40+3)*4+3],0,'outside corner keeps its stone underlay');
  assert.strictEqual(ground.compose({...info,paving:4},images),closed);
  const count=masks.length;ground.compose({...info,paving:15},images);assert.equal(masks.length,count,'all four filled quarters cover the entire road tile');
  assert.equal(copies.filter(args=>args[0]===atlas).length,2,'unchanged native road and courtyard materials are used');
});

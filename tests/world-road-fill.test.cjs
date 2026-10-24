'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../public/world/world-core.js');

function roadsAround(x0,y0,size=5){
  const roads=new Set(),coord=(x,y)=>W.key(x,y);
  const add=(x,y)=>roads.add(coord(x,y));
  for(let x=x0;x<x0+size;x++){add(x,y0);add(x,y0+size-1);}
  for(let y=y0;y<y0+size;y++){add(x0,y);add(x0+size-1,y);}
  return {roads,add,remove:(x,y)=>roads.delete(coord(x,y)),
    terrainAt:(x,y)=>roads.has(coord(x,y))?'road':'grass'};
}

test('unfinished road loop and an isolated road never fill the world',()=>{
  const r=roadsAround(700,700);r.remove(702,700);
  assert.deepEqual(W.enclosedRoadCells({x:702,y:700},{terrainAt:r.terrainAt,maxCells:100}),[]);
  r.add(702,700);
  assert.equal(W.enclosedRoadCells({x:702,y:700},{terrainAt:r.terrainAt,maxCells:4}).length,0,
    'the bounded search must not automatically fill an oversized enclosed area');
});

test('closing a four-directional road perimeter fills the inside exactly',()=>{
  const r=roadsAround(700,700);r.remove(702,700);
  assert.equal(r.terrainAt(702,700),'grass');
  r.add(702,700);
  const cells=W.enclosedRoadCells({x:702,y:700},{terrainAt:r.terrainAt});
  assert.equal(cells.length,9);
  assert.deepEqual(new Set(cells.map(p=>W.key(p.x,p.y))),
    new Set(Array.from({length:9},(_,i)=>W.key(701+i%3,701+Math.floor(i/3)))));
  assert.ok(cells.every(p=>p.x>700&&p.x<704&&p.y>700&&p.y<704));
});

test('diagonal near-contacts do not count as an enclosed path',()=>{
  const r=roadsAround(700,700);r.remove(700,700);r.remove(700,701);
  r.add(700,700);
  assert.deepEqual(W.enclosedRoadCells({x:700,y:700},{terrainAt:r.terrainAt,maxCells:60}),[]);
});

test('ring spanning chunk boundaries generates fill cells on both sides',()=>{
  const r=roadsAround(30,30,6);r.remove(32,30);r.add(32,30);
  const cells=W.enclosedRoadCells({x:32,y:30},{terrainAt:r.terrainAt});
  assert.equal(cells.length,16);
  assert.ok(new Set(cells.map(p=>W.chunkKey(p.x,p.y))).size>=4);
  const world=W.createWorld('road-fill-seam'),changes={};
  for(const p of cells){const k=W.chunkKey(p.x,p.y),i=p.y%32*32+p.x%32;
    (changes[k]??={revision:1,tiles:{}}).tiles[i]={terrain:'road'};}
  world.installPatches(changes);
  assert.ok(cells.every(p=>world.terrain(p.x,p.y)==='road'));
});

test('road loops touching the map boundary fill only true interior cells',()=>{
  const r=roadsAround(0,0);r.remove(2,0);r.add(2,0);
  const cells=W.enclosedRoadCells({x:2,y:0},{terrainAt:r.terrainAt});
  assert.equal(cells.length,9);
  assert.ok(cells.every(p=>W.inside(p.x,p.y)));
});

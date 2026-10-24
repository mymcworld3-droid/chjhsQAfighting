'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),G=require('../public/world/world-ground.js'),A=require('../public/world/world-art.js');

test('ground caches rasterize at the device scale without resizing the isolated source material',()=>{
  const calls=[],factory=()=>({width:0,height:0,getContext(){return {save(){},restore(){},translate(){},scale(){},drawImage(...args){calls.push(args);}};}});
  const g=G.create(A,factory),atlas={complete:true,naturalWidth:512},images={'ground-atlas':atlas};
  const info={x:3,y:4,terrain:'grass',neighbours:Array(8).fill('grass'),mask:0,underlay:'grass',key:'grass:3:4'};
  g.setScale(1);const first=g.compose(info,images);assert.equal(first.width,40);assert.equal(first.height,40);
  assert.strictEqual(g.compose(info,images),first);g.setScale(1.001);assert.strictEqual(g.compose(info,images),first,'same physical size reuses the tile');
  g.setScale(2*1.5);assert.equal(g.cachedTiles,0);const zoomed=g.compose(info,images);assert.equal(zoomed.width,120);assert.notStrictEqual(zoomed,first);
  const sourceCopies=calls.filter(a=>a[0]===atlas);assert.equal(sourceCopies.length,1,'scale changes retain the native source crop');
  assert.deepEqual(sourceCopies[0].slice(3,5),[124,124]);assert.deepEqual(sourceCopies[0].slice(7),[124,124],'material is copied one to one');
  g.setScale(.65);assert.equal(g.compose(info,images).width,26);g.setScale(NaN);assert.equal(g.tileSize,26);
});

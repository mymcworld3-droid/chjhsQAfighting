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
  assert.deepEqual(sourceCopies[0].slice(3,5),[128,128]);assert.deepEqual(sourceCopies[0].slice(7),[128,128],'material is copied one to one');
  g.setScale(.65);assert.equal(g.compose(info,images).width,26);g.setScale(NaN);assert.equal(g.tileSize,26);
});

test('terrain textures keep a full native cell at all coordinates and never sample adjacent atlas materials',()=>{
  for(const [i,type] of A.terrain.entries()){
    for(const [x,y] of [[0,0],[1,3],[7,8],[99,101]]){
      const frame=G.textureFrame(A,type,x,y);
      assert.deepEqual([frame.sx,frame.sy,frame.sw,frame.sh],[i%4*128,Math.floor(i/4)*128,128,128]);
      assert.equal(typeof frame.flipX,'boolean');
      assert.equal(typeof frame.flipY,'boolean');
      assert.deepEqual(frame,G.textureFrame(A,type,x,y),'variants must be deterministic across redraws');
    }
  }
});

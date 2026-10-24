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

test('ground textures near (572,458) stay deterministic despite shared topology keys and cache eviction',()=>{
  const S=require('../public/world/world-scenery.js'),W=require('../public/world/world-core.js');
  const world={...W.createWorld(),terrain:()=> 'grass'},scene=S.create(world);
  const firstInfo=scene.topology(572,458,'grass'),differentInfo=scene.topology(580,458,'grass'),sameInfo=scene.topology(573,458,'grass');
  assert.equal(firstInfo.key,differentInfo.key,'neighbour topology is reusable across coordinates');
  assert.equal(firstInfo.key,sameInfo.key,'cache keys do not require arbitrary coordinate modulo values');
  assert.notDeepEqual(G.textureFrame(A,'grass',572,458),G.textureFrame(A,'grass',580,458));
  assert.deepEqual(G.textureFrame(A,'grass',572,458),G.textureFrame(A,'grass',573,458));
  const makeCanvas=()=>{
    const scales=[],ctx={
      save(){},restore(){},translate(){},scale(x,y){scales.push([x,y]);},drawImage(){},
      createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(){},
      beginPath(){},rect(){},clip(){}
    };
    return {width:0,height:0,scales,getContext(){return ctx;}};
  };
  const images={'ground-atlas':{complete:true,naturalWidth:512}},ground=G.create(A,makeCanvas);
  const first=ground.compose(firstInfo,images),different=ground.compose(differentInfo,images);
  assert.notStrictEqual(first,different,'different flips must not receive the same cached pixels');
  assert.strictEqual(ground.compose(sameInfo,images),first,'matching flips still reuse the raster');
  assert.equal(ground.cachedTiles,2);
  const reverse=G.create(A,makeCanvas);
  const reverseDifferent=reverse.compose(differentInfo,images),reverseFirst=reverse.compose(firstInfo,images);
  assert.deepEqual(reverseFirst.scales,first.scales,'tile pixels do not depend on visiting order');
  assert.deepEqual(reverseDifferent.scales,different.scales);
  for(let i=0;i<515;i++)ground.compose({...firstInfo,x:100+i,y:90,key:'eviction-'+i},images);
  const rebuilt=ground.compose(firstInfo,images);
  assert.notStrictEqual(rebuilt,first,'the bounded cache evicts older rasters');
  assert.deepEqual(rebuilt.scales,first.scales,'recomposing an evicted tile preserves its orientation');
});

test('ground cache includes underlay and neighbour blend flips, not only the main terrain',()=>{
  const makeCanvas=()=>{
    const ctx={save(){},restore(){},translate(){},scale(){},drawImage(){},
      createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(){},beginPath(){},rect(){},clip(){}};
    return {width:0,height:0,getContext(){return ctx;}};
  };
  const images={'ground-atlas':{complete:true,naturalWidth:512}};
  const flips=(t,x,y)=>{const frame=G.textureFrame(A,t,x,y);return [frame.flipX,frame.flipY];};
  const cases=[
    {base:'road',secondary:'grass',a:[572,458],b:[580,514],
      info:{terrain:'road',underlay:'grass',neighbours:Array(8).fill('grass'),mask:0,bridgeDirection:'east',key:'same-road-topology'}},
    {base:'grass',secondary:'beach',a:[572,458],b:[572,466],
      info:{terrain:'grass',underlay:'grass',neighbours:['beach',...Array(7).fill('grass')],mask:0,bridgeDirection:'east',key:'same-beach-edge-topology'}}
  ];
  for(const {base,secondary,a,b,info} of cases){
    assert.deepEqual(flips(base,...a),flips(base,...b),'main texture flips match');
    assert.notDeepEqual(flips(secondary,...a),flips(secondary,...b),'secondary texture flips differ');
    const ground=G.create(A,makeCanvas),first=ground.compose({...info,x:a[0],y:a[1]},images);
    const second=ground.compose({...info,x:b[0],y:b[1]},images);
    assert.notStrictEqual(first,second,'changing '+secondary+' flip invalidates composed '+base+' tile');
    assert.equal(ground.cachedTiles,2);
  }
});

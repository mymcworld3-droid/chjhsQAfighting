'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../public/world/world-core.js'),S=require('../public/world/world-scenery.js'),G=require('../public/world/world-ground.js'),A=require('../public/world/world-art.js');

function outline(points){
  const cells=new Map();
  for(let i=1;i<points.length;i++){
    let[x,y]=points[i-1];const[tx,ty]=points[i];
    assert.ok(x===tx||y===ty,'fixtures use real cardinal roads');
    cells.set(W.key(x,y),{x,y});
    while(x!==tx||y!==ty){x+=Math.sign(tx-x);y+=Math.sign(ty-y);cells.set(W.key(x,y),{x,y});}
  }
  return [...cells.values()];
}
const rectangle=(x,y,w,h)=>outline([[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]);
function install(world,cells,revision=1,overrides={}){
  const chunks={};
  for(const p of cells){
    const k=world.chunkKey(p.x,p.y);chunks[k]||={revision,tiles:{}};
    chunks[k].tiles[(p.y%32)*32+p.x%32]={terrain:overrides[W.key(p.x,p.y)]||'road'};
  }
  world.installPatches(chunks);
}

test('closed road faces fill their interiors and inner edge halves, leaving exterior paths narrow',()=>{
  const paving=S.roadEnclosures(rectangle(10,10,6,5));
  assert.equal(paving(13,12),15);assert.equal(paving(10,10),4);assert.equal(paving(13,10),12);assert.equal(paving(10,12),6);
  for(const p of [[9,12],[17,12],[13,9],[13,16]])assert.equal(paving(...p),0,'outside stays unfilled');
  assert.equal(G.roadAlpha(6,.9,.9,paving(10,10)),1,'inside corner is fully paved');
  assert.equal(G.roadAlpha(6,.1,.1,paving(10,10)),0,'outside corner keeps its underlay');
  assert.equal(G.roadAlpha(5,.1,.5,0),0,'an open straight road keeps its original width');
});

test('even the sub-tile hole between four adjacent roads is filled without checkerboard gaps',()=>{
  const paving=S.roadEnclosures(rectangle(0,0,1,1));
  const tiles=[[0,0,6,4],[1,0,12,8],[1,1,9,1],[0,1,3,2]];
  for(const[x,y,mask,fill]of tiles){
    assert.equal(paving(x,y),fill);
    for(let row=0;row<40;row++)for(let col=0;col<40;col++){
      const u=(col+.5)/40,v=(row+.5)/40,worldX=x+u,worldY=y+v;
      if(worldX>=.5&&worldX<=1.5&&worldY>=.5&&worldY<=1.5)assert.equal(G.roadAlpha(mask,u,v,fill),1);
    }
  }
});

test('a missing segment, an open U and diagonal contacts never close a region',()=>{
  for(const roads of [rectangle(10,10,6,6).filter(p=>p.x!==13||p.y!==10),outline([[10,10],[10,16],[16,16],[16,10]]),[{x:10,y:10},{x:11,y:11}]]){
    const paving=S.roadEnclosures(roads);
    for(let y=9;y<=17;y++)for(let x=9;x<=17;x++)assert.equal(paving(x,y),0);
  }
  assert.equal(S.roadEnclosures([])(0,0),0);
});

test('concave, nested and touching loops use their actual shape and are independent of visit order',()=>{
  const lShape=outline([[0,0],[6,0],[6,2],[2,2],[2,6],[0,6],[0,0]]),paving=S.roadEnclosures(lShape);
  for(const p of [[1,1],[5,1],[1,5]])assert.equal(paving(...p),15);
  assert.equal(paving(4,4),0);assert.equal(paving(2,2),11,'concave corner fills the three inner quadrants');
  const roads=[...rectangle(10,10,8,8),...rectangle(12,12,4,4),...rectangle(18,18,4,4)];
  const forward=S.roadEnclosures(roads),reverse=S.roadEnclosures(roads.toReversed());
  for(let y=9;y<=23;y++)for(let x=9;x<=23;x++)assert.equal(forward(x,y),reverse(x,y));
  assert.equal(forward(14,14),15);assert.equal(forward(20,20),15);assert.equal(forward(20,14),0);
});

test('world road index matches generated layouts and honours repairs, patches and event precedence',()=>{
  const world=W.createWorld('road-index'),initial=new Set(world.roadCells().map(p=>W.key(p.x,p.y)));
  for(let y=430;y<=565;y++)for(let x=435;x<=595;x++)assert.equal(initial.has(W.key(x,y)),['road','bridge'].includes(world.terrain(x,y)),W.key(x,y));
  const broken=world.starterPoint(26,27),sealed=world.starterPoint(39,6);
  assert.ok(!initial.has(W.key(broken.x,broken.y)));assert.ok(!initial.has(W.key(sealed.x,sealed.y)));
  const repaired=new Set(world.roadCells({bridge:20,array:60}).map(p=>W.key(p.x,p.y)));
  assert.ok(repaired.has(W.key(broken.x,broken.y)));assert.ok(repaired.has(W.key(sealed.x,sealed.y)));
  const tiles={[W.key(broken.x,broken.y)]:'broken-bridge'};
  assert.ok(!world.roadCells({bridge:20,array:60,tiles}).some(p=>W.same(p,broken)),'explicit battle terrain precedes shared repairs');
  install(world,[{x:999,y:999},{x:500,y:500}],1,{'500,500':'grass'});
  const patched=new Set(world.roadCells().map(p=>W.key(p.x,p.y)));
  assert.ok(patched.has('999,999'));assert.ok(!patched.has('500,500'));
});

test('a loop crossing chunk seams fills immediately and reopens after a patch removes its closing segment',()=>{
  const world=W.createWorld('patched-loop'),scene=S.create(world),roads=rectangle(30,30,6,6),gap={x:33,y:30};
  install(world,roads,1,{'33,30':'grass'});
  const at=(x,y,events={})=>scene.topology(x,y,world.terrain(x,y,events),events);
  assert.equal(at(33,33).paving,0);
  install(world,roads,2);const closed=at(33,33);
  assert.equal(closed.terrain,'road');assert.equal(closed.paving,15);assert.equal(at(30,30).paving,4);
  assert.equal(at(33,29).paving,0);
  const events={tiles:{[W.key(gap.x,gap.y)]:'grass'}};
  assert.equal(at(33,33,events).paving,0,'event overrides reopen a loop');
  events.tiles[W.key(gap.x,gap.y)]='road';scene.prepare(events);
  assert.equal(at(33,33,events).paving,15,'frame preparation also handles in-place event changes');
  install(world,roads,3,{'33,30':'grass'});
  assert.equal(at(33,33).paving,0);assert.notEqual(at(33,33).key,closed.key);
});

test('sect paving preserves water, bridges, outside stone ground, gameplay terrain and sparse saves',()=>{
  const world=W.createWorld(),scene=S.create(world),before=JSON.stringify(world.patchVersions());
  const snapshots=[];
  for(let dy=-24;dy<=24;dy++)for(let dx=-24;dx<=24;dx++){
    const x=500+dx,y=500+dy,t=world.terrain(x,y),walkable=world.walkable(x,y);snapshots.push({x,y,t,walkable});
    const info=scene.topology(x,y,t);
    if(['water','bridge'].includes(t)){assert.equal(info.terrain,t);assert.equal(info.paving,0);}
  }
  const inside=scene.topology(497,486,world.terrain(497,486)),outside=scene.topology(480,480,world.terrain(480,480));
  assert.equal(inside.terrain,'road');assert.equal(inside.paving,15);
  assert.equal(outside.terrain,'courtyard');assert.equal(outside.paving,0);
  assert.equal(scene.topology(500,470,'road').paving,0,'approach outside the enclosing avenue remains narrow');
  for(const {x,y,t,walkable}of snapshots){assert.equal(world.terrain(x,y),t);assert.equal(world.walkable(x,y),walkable);}
  assert.equal(JSON.stringify(world.patchVersions()),before);
  const other=S.create(W.createWorld('another-seed'));
  assert.equal(other.topology(497,486,'courtyard').key,inside.key,'fixed sect architecture fills identically for every seed');
});

test('paving has its own cached mask and an interior tile draws the full road texture',()=>{
  const masks=[],copies=[],factory=()=>({width:0,height:0,getContext(){return {
    save(){},restore(){},translate(){},scale(){},drawImage(...args){copies.push(args);},
    createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(data){masks.push(data);}
  };}});
  const ground=G.create(A,factory),atlas={complete:true,naturalWidth:512},images={'ground-atlas':atlas};ground.setScale(1);
  const info={x:10,y:10,terrain:'road',mask:6,underlay:'courtyard',neighbours:Array(8).fill('courtyard'),key:'shared-topology'};
  const open=ground.compose(info,images),closed=ground.compose({...info,paving:4},images);
  assert.notStrictEqual(open,closed);assert.equal(masks[0].data[(36*40+36)*4+3],0);
  assert.equal(masks[1].data[(36*40+36)*4+3],255,'closed corner receives fully opaque road pixels');
  assert.equal(masks[1].data[(3*40+3)*4+3],0,'outside corner keeps its stone underlay');
  assert.strictEqual(ground.compose({...info,paving:4},images),closed);
  const count=masks.length;ground.compose({...info,paving:15},images);assert.equal(masks.length,count,'full interiors never receive a narrow cross mask');
  assert.equal(copies.filter(args=>args[0]===atlas).length,2,'only the unchanged road and courtyard materials are read');
});

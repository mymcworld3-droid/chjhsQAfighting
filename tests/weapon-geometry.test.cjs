'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../public/cultivation/weapon-geometry.js');
const board=(width=9,height=9,blocks=[])=>({width,height,blocked:p=>blocks.some(q=>G.key(q)===G.key(p))});
const p=(x,y)=>({x,y});
test('eight directions stop before edges, walls and closed diagonal corners',()=>{
  const b=board(9,9,[p(5,4),p(4,5)]);
  assert.deepEqual(G.traceRay(b,p(4,4),p(1,1)).cells,[]);
  assert.equal(G.traceRay(b,p(4,4),p(1,1)).collision.kind,'closed-corner');
  assert.deepEqual(G.traceRay(board(),p(4,4),p(1,1)).cells,[p(5,5),p(6,6),p(7,7),p(8,8)]);
  assert.deepEqual(G.traceRay(b,p(5,4),p(1,0)).cells,[]);
  for(const d of G.DIRS)assert.deepEqual(G.rotate(d,8),d);
});
test('normal ray reverses head-on and follows axis normal for single blocked side',()=>{
  const b=board(9,9,[p(5,4),p(5,5)]);
  const hit=G.traceRay(b,p(4,4),p(1,1)).collision;
  assert.deepEqual(hit.normal,p(-1,0));
  assert.deepEqual(G.normalRay(b,hit).cells,[p(3,4),p(2,4),p(1,4)]);
  const straight=G.traceRay(b,p(3,4),p(1,0));
  assert.deepEqual(straight.cells,[p(4,4)]);
  assert.deepEqual(straight.collision.normal,p(-1,0));
});
test('square rings have 8r distinct tiles, clip board and exclude center',()=>{
  const b=board(15,15),c=p(7,7);
  for(let r=1;r<=4;r++)assert.equal(G.squareRing(b,c,r).length,8*r);
  assert.equal(G.squareArea(b,c,2).length,24);
  assert.equal(G.squareArea(b,c,2,{includeCenter:true}).length,25);
  assert.equal(G.squareRing(board(3,3,[p(1,0)]),p(0,0),1).length,2);
});
test('arbitrary lines are reversible and cannot cross walls or closed corners',()=>{
  const b=board();
  for(let x=0;x<9;x++)for(let y=0;y<9;y++){
    const a=p(4,4),z=p(x,y);
    assert.deepEqual(G.segment(b,a,z).cells,G.segment(b,z,a).cells.reverse());
  }
  assert.equal(G.segment(board(9,9,[p(2,1)]),p(1,1),p(3,1)).valid,false);
  assert.equal(G.segment(board(9,9,[p(2,1),p(1,2)]),p(1,1),p(2,2)).valid,false);
});
test('convex hull deduplicates, handles collinear marks and fills triangle interior',()=>{
  const b=board(),a=[p(1,1),p(5,1),p(1,5),p(1,1)];
  const poly=G.polygon(b,a);
  assert.equal(poly.valid,true);assert.equal(poly.vertices.length,3);
  assert.ok(poly.cells.some(q=>G.key(q)==='2,2'));
  assert.deepEqual(G.polygon(b,a.reverse()).cells,poly.cells);
  assert.equal(G.polygon(board(9,9,[p(3,1)]),a).valid,false);
  assert.deepEqual(G.polygon(b,[p(1,1),p(2,2),p(3,3)]).cells,[p(1,1),p(2,2),p(3,3)]);
});
test('point symmetry is an involution on odd, even and rectangular boards',()=>{
  for(const [w,h] of [[7,7],[8,6],[9,4]])for(let x=0;x<w;x++)for(let y=0;y<h;y++)
    assert.deepEqual(G.mirror(board(w,h),G.mirror(board(w,h),p(x,y))),p(x,y));
  assert.deepEqual(G.mirror(board(7,7),p(3,3)),p(3,3));
});
test('large footprint checks every tile and reservations block overlapping destinations',()=>{
  const boss={uid:'boss',kind:'boss',position:p(1,1)},b=board(6,6,[p(3,3)]);
  assert.equal(G.footprint(boss).length,4);
  assert.equal(G.canPlace(b,boss,p(2,2)),false);
  assert.equal(G.canPlace(b,boss,p(5,5)),false);
  assert.equal(G.canPlace(b,boss,p(1,1),[],new Set(['2,2'])),false);
  assert.equal(G.canPlace(b,boss,p(1,1)),true);
});
test('clockwise pull is deterministic, closer, collision free and never occupies core',()=>{
  const core=p(4,4),actors=[{uid:'a',x:2,y:3},{uid:'b',x:3,y:2},{uid:'c',x:4,y:3},{uid:'d',kind:'boss',position:p(5,5)}];
  const before=JSON.stringify(actors),b=board(),moves=G.pullClockwise(b,core,actors);
  assert.deepEqual(moves,G.pullClockwise(b,core,actors.slice().reverse()));
  const reserved=new Set();
  for(const m of moves){const a=actors.find(a=>a.uid===m.uid);
    for(const q of G.footprint(a,m.to)){assert.notEqual(G.key(q),'4,4');assert.ok(!reserved.has(G.key(q)));reserved.add(G.key(q));}
  }
  assert.equal(moves.find(m=>m.uid==='c').moved,false);
  assert.equal(JSON.stringify(actors),before);
});

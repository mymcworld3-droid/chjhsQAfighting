const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../public/world/world-core.js'),P=W.starterPoint,C=W.townPoint;
const canWalk=(x,y,o)=>{const p=P(x,y);return W.walkable(p.x,p.y,o);};
test('1000 by 1000 seeded world retains connected onboarding interactions',()=>{
  assert.equal(W.SIZE,1000);assert.equal(W.CHUNK_SIZE,32);assert.equal(W.GENERATOR_VERSION,'qingyun-seeded-v2');
  for(const o of W.OBJECTS){const r=W.approach(W.SPAWN,o,{events:{array:60}});assert.ok(r.path.length,o.id);assert.ok(W.distance(r.path.at(-1),o)<=1,o.id);
    for(let i=1;i<r.path.length;i++){assert.equal(W.distance(r.path[i-1],r.path[i]),1);assert.ok(W.walkable(r.path[i].x,r.path[i].y,{events:{array:60}}));}}
});
test('the shared array unlocks the optional treasure court for the whole server',()=>{
  assert.equal(canWalk(39,6),false);assert.equal(W.approach(W.SPAWN,W.object('chest-array')).path.length,0);
  assert.equal(canWalk(39,6,{events:{array:60}}),true);assert.ok(W.approach(W.SPAWN,W.object('chest-array'),{events:{array:60}}).path.length);
});
test('water, rock and buildings cannot be crossed; bridge contribution opens a real shortcut',()=>{
  for(const p of [P(0,10),P(26,15),W.object('forge')])assert.equal(W.walkable(p.x,p.y),false);
  assert.equal(canWalk(26,27),false);assert.equal(canWalk(26,27,{events:{bridge:20}}),true);
  const a=W.plan(P(25,27),P(29,27)).path,b=W.plan(P(25,27),P(29,27),{events:{bridge:20}}).path;
  assert.ok(a.length>b.length+10);
});
test('unknown destinations stop at a reachable known frontier without revealing hidden terrain',()=>{
  const explored=W.reveal('',W.SPAWN),r=W.plan(W.SPAWN,P(18,22),{explored});assert.equal(r.partial,true);
  assert.ok(r.path.length>1);assert.ok(r.path.every(p=>W.known(explored,p.x,p.y)));assert.ok(!W.same(r.path.at(-1),P(18,22)));
  assert.ok(W.DIRS.some(([dx,dy])=>!W.known(explored,r.path.at(-1).x+dx,r.path.at(-1).y+dy)));
});
test('retargeting preserves fractional movement on the current edge and remains four-directional',()=>{
  const initial={path:[C(9,36),C(9,35),C(9,34)],startedAtMs:1000,stepMs:W.STEP_MS},at=1100;
  const before=W.sample(initial,at),result=W.redirect(initial,C(13,36),at);
  const after=W.sample(result.route,at);assert.ok(Math.abs(before.x-after.x)<1e-8);assert.ok(Math.abs(before.y-after.y)<1e-8);
  for(let i=1;i<result.route.path.length;i++)assert.equal(W.distance(result.route.path[i-1],result.route.path[i]),1);
  const final=W.sample(result.route,1e9);assert.equal(final.moving,false);assert.deepEqual(final.tile,C(13,36));
});
test('restoration selects a nearby safe tile when terrain makes the old tile unusable',()=>{
  const p=W.safePosition(P(26,15));assert.ok(W.walkable(p.x,p.y));assert.ok(W.distance(p,P(26,15))<=2);
  assert.deepEqual(W.safePosition({x:-1,y:500}),W.SPAWN);
});

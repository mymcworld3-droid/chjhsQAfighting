'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Sword=require('../public/cultivation/flying-sword-path.js');
const point=(x,y)=>({x,y});
const whole=(w,h)=>p=>Number.isInteger(p.x)&&Number.isInteger(p.y)&&
  p.x>=0&&p.y>=0&&p.x<w&&p.y<h;
const steps=path=>path.length-1;
const crosses=(route,e)=>route.some(p=>Sword.occupies(e,p));
test('shortest flying-sword routes prefer a beast without making an unnecessary detour',()=>{
  const enemy={id:'e1',position:point(2,1),battleHealth:90};
  const route=Sword.route({from:point(1,1),to:point(3,3),
    walkable:whole(6,6),enemies:[enemy]});
  assert.equal(steps(route),4);
  assert.ok(crosses(route,enemy));
  for(let i=1;i<route.length;i++)assert.equal(Sword.distance(route[i-1],route[i]),1);
  const wall=p=>whole(6,6)(p)&&!(p.x===2&&p.y===1);
  const diverted=Sword.route({from:point(1,1),to:point(3,3),
    walkable:wall,enemies:[enemy]});
  assert.equal(steps(diverted),4);
  assert.ok(!crosses(diverted,enemy));
});
test('sword only crosses valid walkable cells and finds the shortest bypass around walls',()=>{
  const wall=p=>whole(6,6)(p)&&!(p.x===2&&p.y<=3);
  const route=Sword.route({from:point(1,2),to:point(4,2),walkable:wall});
  assert.ok(route&&steps(route)>3);
  assert.ok(route.every(wall));
  assert.equal(Sword.route({from:point(-1,2),to:point(4,2),walkable:wall}),null);
  assert.equal(Sword.route({from:point(2,2),to:point(4,2),walkable:wall}),null);
});
test('2×2 bosses count as a single creature even if several footprint squares are crossed',()=>{
  const boss={id:'boss',kind:'boss',footprint:2,position:point(2,1),battleHealth:500};
  assert.equal(Sword.occupies(boss,point(3,2)),true);
  assert.equal(Sword.occupies(boss,point(4,2)),false);
  const route=Sword.route({from:point(1,1),to:point(4,1),
    walkable:whole(6,6),enemies:[boss]});
  assert.equal(steps(route),3);
  assert.equal(route.filter(p=>Sword.occupies(boss,p)).length,2);
  assert.deepEqual(Sword.route({from:point(1,1),to:point(4,1),
    walkable:whole(6,6),enemies:[boss]}),route);
});
test('shortest route selection stays deterministic for same dungeon seed and beast positions',()=>{
  const from=point(1,1),to=point(4,4),walkable=whole(8,8);
  const e1={position:point(3,1),battleHealth:100},
    e2={position:point(1,3),battleHealth:100};
  const first=Sword.route({from,to,walkable,enemies:[e1,e2]});
  for(let i=0;i<15;i++)
    assert.deepEqual(Sword.route({from,to,walkable,enemies:[e1,e2]}),first);
  assert.equal(steps(first),6);
});

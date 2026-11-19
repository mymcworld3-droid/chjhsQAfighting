'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js');
const now=2000000000000;

function scene(points){
  const s=R.create({id:'seal-intel',players:[{uid:'u',atk:200,maxHp:2000}],
    trial:{seed:'seal-intel',stage:8,layoutVersion:4},now});
  s.blocks=[];s.actors=s.actors.slice(0,2);
  Object.assign(s.actors[0],{x:1,y:1,stamina:10,answered:1,correct:1});
  Object.assign(s.actors[1],{x:6,y:6});
  s.objective={type:'sealing',points,completed:false};
  return s;
}
const seal=(kind,x=3,y=1,extra={})=>({x,y,kind,hp:2,maxHp:2,activated:false,...extra});

test('four immutable v4 seal definitions match the mechanics',()=>{
  assert.equal(R.SEAL_MAX_DURABILITY,2);
  assert.equal(R.SEAL_HIT_DAMAGE,1);
  assert.deepEqual(Object.keys(R.SEAL_TYPES),['shield','hazard','rage','maze']);
  assert(Object.isFrozen(R.SEAL_TYPES));
  for(const [kind,d] of Object.entries(R.SEAL_TYPES)){
    assert.equal(R.sealDefinition(kind),d);
    assert(Object.isFrozen(d));
    assert(Object.isFrozen(d.range));
    assert(d.name.endsWith('陣眼'));
    for(const key of ['label','color','shortEffect','effect','onBreak','tactic'])
      assert.equal(typeof d[key],'string',kind+':'+key);
  }
  assert.equal(R.SEAL_TYPES.shield.range.radius,3);
  assert.equal(R.SEAL_TYPES.shield.damageMultiplier,.65);
  assert.equal(R.SEAL_TYPES.rage.range.radius,3);
  assert.equal(R.SEAL_TYPES.rage.damageMultiplier,1.25);
  assert.equal(R.SEAL_TYPES.hazard.range.kind,'warning');
  assert.equal(R.SEAL_TYPES.hazard.range.radius,null);
  assert.equal(R.SEAL_TYPES.hazard.triggerEveryTurns,2);
  assert.equal(R.SEAL_TYPES.hazard.maxHpDamageRatio,.12);
  assert.equal(R.SEAL_TYPES.maze.range.kind,'linked-block');
  assert.equal(R.SEAL_TYPES.maze.range.radius,null);
  assert.equal(R.sealDefinition('unknown'),null);
  assert.equal(R.sealDefinition('__proto__'),null);
});

test('serializable seal info is read-only and references actual objective state',()=>{
  const s=scene([seal('shield',0,0),seal('hazard',4,2),seal('rage',6,3,{hp:1}),
    seal('maze',7,5,{gate:{x:7,y:6}})]);
  const before=JSON.stringify(s);
  const list=R.sealInfos(s);
  assert.equal(list.length,4);
  assert.deepEqual(list.map(x=>x.name),['護靈陣眼','妖煞陣眼','御獸陣眼','迷蹤陣眼']);
  assert.deepEqual(list.map(x=>x.hp),[2,2,1,2]);
  assert.deepEqual(list.map(x=>x.shortEffect),['護：減傷','煞：危險格','獸：增攻','迷：開路']);
  assert(list.every(x=>x.attackable===true));
  assert.deepEqual(list[3].gate,{x:7,y:6});
  list[3].gate.x=99;list[0].range.radius=99;
  assert.equal(R.sealInfo(s,{x:0,y:0}).range.radius,3);
  assert.equal(s.objective.points[3].gate.x,7);
  assert.equal(JSON.stringify(s),before);
  assert.equal(R.sealInfo(s,{x:5,y:5}),null);
  assert.equal(R.sealInfo(s,{x:1.5,y:1}),null);
});

test('aura cells use true Manhattan radius, include obstacles, and clip at map edges',()=>{
  const s=scene([seal('shield',0,0),seal('rage',4,3)]);
  s.blocks=[{x:1,y:0},{x:3,y:3}];
  const corner=R.sealEffectCells(s,{x:0,y:0});
  assert.equal(corner.length,10);
  assert(corner.some(p=>p.x===1&&p.y===0));
  assert(corner.some(p=>p.x===0&&p.y===3));
  assert(!corner.some(p=>p.x===2&&p.y===2));
  const inner=R.sealEffectCells(s,{x:4,y:3});
  assert.equal(inner.length,25);
  assert(inner.every(p=>R.dist(p,{x:4,y:3})<=3&&R.inside(s,p)));
  s.objective.points[1].activated=true;
  assert.deepEqual(R.sealEffectCells(s,{x:4,y:3}),[]);
  assert.equal(R.sealInfo(s,{x:4,y:3}).hp,0);
  assert.equal(R.sealInfo(s,{x:4,y:3}).active,false);
});

test('hazard uses live warning tiles; maze points to linked obstacle, not aura',()=>{
  const s=scene([seal('hazard',3,1),seal('maze',5,5,{gate:{x:6,y:5}})]);
  assert.deepEqual(R.sealEffectCells(s,{x:3,y:1}),[]);
  assert.deepEqual(R.sealEffectCells(s,{x:5,y:5}),[]);
  s.turn=2;R.prepareIntents(s);
  assert.deepEqual(R.sealEffectCells(s,{x:3,y:1}),[{x:1,y:1}]);
  assert.deepEqual(R.sealInfo(s,{x:5,y:5}).gate,{x:6,y:5});
  s.objective.points[0].activated=true;R.prepareIntents(s);
  assert.deepEqual(R.sealEffectCells(s,{x:3,y:1}),[]);
  assert.deepEqual(s.objective.hazards,[]);
});

test('old v3 and non-sealing modes do not show the new v4 attackable metadata',()=>{
  const s=scene([seal('shield')]);
  s.trial.layoutVersion=3;
  assert.equal(R.sealInfo(s,{x:3,y:1}),null);
  assert.deepEqual(R.sealInfos(s),[]);
  assert.deepEqual(R.sealEffectCells(s,{x:3,y:1}),[]);
  s.trial.layoutVersion=4;s.objective.type='elimination';
  assert.deepEqual(R.sealInfos(s),[]);
});

test('seal still requires two effective attacks and does not grant beast kill XP',()=>{
  let s=scene([seal('shield')]);
  s=R.apply(s,'u',{type:'attack',x:3,y:1},now);
  assert.equal(s.objective.points[0].hp,1);
  assert.equal(R.sealInfo(s,{x:3,y:1}).attackable,true);
  s=R.apply(s,'u',{type:'attack',x:3,y:1},now);
  assert.equal(s.objective.points[0].hp,0);
  assert.equal(s.objective.points[0].activated,true);
  assert.equal(R.sealInfo(s,{x:3,y:1}).attackable,false);
  assert.equal(s.status,'finished');
  assert.equal(s.manualExp,undefined);
});

test('objective HUD shares the canonical short-effect labels',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-combat.js'),'utf8');
  assert.match(source,/R\\.sealDefinition\\(p\\.kind\\)\\?\\.shortEffect/);
  assert.doesNotMatch(source,/const sealLabels=/);
  assert.deepEqual(Object.values(R.SEAL_TYPES).map(x=>x.shortEffect),
    ['護：減傷','煞：危險格','獸：增攻','迷：開路']);
});

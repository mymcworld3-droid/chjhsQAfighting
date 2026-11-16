'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js');

function reachable(layout){
  const walls=new Set(layout.blocks.map(R.key));
  const seen=new Set([R.key(layout.spawn)]),queue=[layout.spawn];
  for(let i=0;i<queue.length;i++)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const p={x:queue[i].x+dx,y:queue[i].y+dy},k=R.key(p);
    if(p.x<0||p.y<0||p.x>=layout.width||p.y>=layout.height||walls.has(k)||seen.has(k))continue;
    seen.add(k);queue.push(p);
  }
  return seen;
}
test('v3 stage schedule is deterministic and every later group has the required modes',()=>{
  const expected=['elimination','elimination','elimination','elimination','elimination','transport','elimination','sealing','elimination','boss','transport','sealing','elimination','transport','boss','transport','sealing','elimination','transport','boss'];
  for(let stage=1;stage<=45;stage++){
    const a=R.stageLayout('campaign',stage,3),b=R.stageLayout('campaign',stage,3);
    assert.deepEqual(a,b);assert.match(a.layoutHash,/^[0-9a-f]{8}$/);
    if(stage<=20)assert.equal(a.mode,expected[stage-1]);
    if(stage>20&&(stage-20)%5===0){
      const group=Array.from({length:5},(_,i)=>R.stageLayout('campaign',stage-4+i,3).mode);
      assert.deepEqual(group.slice(0,4).sort(),['elimination','elimination','sealing','transport']);
      assert.equal(group[4],'boss');
    }
  }
  assert.equal(R.stageLayout('x',6,3).variant,'carry');
  assert.equal(R.stageLayout('x',11,3).variant,'pickup');
  assert.equal(R.stageLayout('x',15,3).enemies[0].species,16);
});
test('v3 generated targets and boss footprint are in bounds and connected',()=>{
  for(let seed=0;seed<250;seed++)for(const stage of [4,6,8,10,11,14,15,19,20,23]){
    const l=R.stageLayout('case-'+seed,stage,3),seen=reachable(l);
    assert.equal(seen.size,l.width*l.height-l.blocks.length);
    const required=[l.spawn,l.objective.item,l.objective.destination,...(l.objective.points||[])].filter(Boolean);
    assert.ok(required.every(p=>seen.has(R.key(p))));
    const occupied=new Set();
    for(const enemy of l.enemies){
      const footprint=enemy.footprint||{width:1,height:1};
      for(let dy=0;dy<footprint.height;dy++)for(let dx=0;dx<footprint.width;dx++){
        const p={x:enemy.x+dx,y:enemy.y+dy},k=R.key(p);
        assert.ok(seen.has(k));assert.ok(!occupied.has(k));assert.ok(required.every(q=>R.key(q)!==k));occupied.add(k);
      }
    }
    assert.ok(l.enemies.every(e=>R.monsterProfile(e.species).unlockStage<=stage));
  }
});
test('unfinished v3 cannot be opened as a live room; v2 remains available',()=>{
  const args={id:'test',players:[{uid:'u',atk:100,maxHp:1000}],trial:{seed:'test',stage:6,layoutVersion:3}};
  assert.throws(()=>R.create(args),/尚未開放/);
  assert.equal(R.create({...args,trial:{...args.trial,layoutVersion:2}}).status,'active');
});

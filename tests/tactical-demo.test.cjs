'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js'),D=require('../public/cultivation/tactical-demo-rules.js');
const NOW=2000000000000;

test('every monster has a deterministic local movement, hit and successful dodge demonstration',()=>{
  for(const profile of R.MONSTERS){
    const demo=D.build(profile.species);assert.deepEqual(demo,D.build(profile.species));
    assert.equal(demo.species,profile.species);assert.ok(demo.duration>=10000&&demo.duration<25000);
    let cursor=0;
    for(const b of demo.beats){
      assert.equal(b.start,cursor);cursor+=b.duration;assert.ok(b.duration>0);
      assert.equal(b.state.id,'enemy-demo-'+profile.species);assert.equal(b.state.actors[0].uid,demo.hero);assert.equal(b.state.actors[1].species,profile.species);
      for(const cell of b.scene?.cells||[])assert.ok(R.inside(b.state,cell));
      const v=demo.view,visible=p=>p.x>=v.x&&p.x<v.x+v.width&&p.y>=v.y&&p.y<v.y+v.height;
      for(const p of [...b.state.actors,...(b.warning||[]),...(b.scene?.cells||[]),...(b.scene?.moves||[]).flatMap(m=>m.path)])assert.ok(visible(p),profile.name+' camera retains the real footprint and movement');
    }
    assert.equal(cursor,demo.duration);
    for(const phase of ['movement','warning','hit','dodge-warning','escape','safe','miss','success'])assert.ok(demo.beats.some(b=>b.phase===phase),profile.name+' '+phase);
  }
  assert.ok(D.build(0).view.height<7,'compact attacks use larger cells in the introduction');
});

test('warning cells, damage, knockback, landing and dodges come from real authoritative combat rules',()=>{
  for(const profile of R.MONSTERS)for(const warning of D.build(profile.species).beats.filter(b=>b.phase==='warning')){
    const before=warning.state,hero=before.actors[0],monster=before.actors[1],saved=JSON.stringify(before);
    assert.equal(monster.intent.kind,'attack');assert.deepEqual(monster.intent.cells,R.monsterCells(before,monster,hero));
    assert.ok(monster.intent.cells.some(p=>R.key(p)===R.key(hero)));
    const hit=R.apply(before,hero.uid,{type:'end'},NOW);assert.ok(hit.actors[0].hp<hero.hp,profile.name);
    const route=D.escape(before),end=route.at(-1);assert.ok(!monster.intent.cells.some(p=>R.key(p)===R.key(end)));
    const moved=R.apply(before,hero.uid,{type:'move',...end},NOW),missed=R.apply(moved,hero.uid,{type:'end'},NOW);
    assert.equal(missed.actors[0].hp,hero.hp,profile.name+' must really miss');assert.deepEqual(moved.actors[1].intent.cells,monster.intent.cells);
    assert.equal(JSON.stringify(before),saved,'demo planning cannot mutate a warning snapshot');
    const demo=D.build(profile.species),successful=demo.beats.find(b=>b.phase==='success'&&b.state.turn===missed.turn);
    assert.deepEqual(successful.state.actors[0],missed.actors[0]);
  }
});

test('movement shows each profile and jumping types really cross a rock without invalid landings',()=>{
  for(const profile of R.MONSTERS){
    const demo=D.build(profile.species),movement=demo.beats.filter(b=>b.phase==='movement'),moves=movement.filter(b=>b.scene?.kind==='move');
    if(!profile.move.steps){assert.equal(moves.length,0);continue;}
    assert.equal(moves.length,1,profile.name);assert.equal(moves[0].scene.style,profile.move.kind);
    const before=movement[0].state,expected=R.monsterRoute(before,before.actors[1],before.actors[0]);assert.deepEqual(moves[0].scene.moves[0].path,expected);
    const end=expected.at(-1);assert.ok(!R.blocked(before,end)&&!R.at(before,end));
    if(['leap','hop','fly','teleport'].includes(profile.move.kind)){assert.ok(before.blocks.length);assert.ok(end.x>2,'jump across the intervening rock');}
  }
});

test('guardian demonstrates both attacks and rings/nova keep their full real footprints',()=>{
  const guardian=D.build(18).beats.filter(b=>b.phase==='warning');assert.equal(guardian.length,2);
  assert.deepEqual(guardian.map(b=>b.warning.length),[5,12]);
  for(const [species,count]of [[14,8],[17,16],[19,13]]){
    const warning=D.build(species).beats.find(b=>b.phase==='warning');assert.equal(warning.warning.length,count);
  }
  const ring=D.build(14).beats.find(b=>b.phase==='safe'),shell=D.build(17).beats.find(b=>b.phase==='safe');
  assert.ok(!ring.warning.some(p=>R.key(p)===R.key(ring.state.actors[0])));
  assert.ok(!shell.warning.some(p=>R.key(p)===R.key(shell.state.actors[0])));
});

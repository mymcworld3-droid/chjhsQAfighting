'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js');
const now=2000000000000;
function scene(){
  const s=R.create({id:'boss-test',players:[{uid:'u',name:'玩家',atk:200,maxHp:2000}],trial:{seed:'boss',stage:10,layoutVersion:3},now});
  s.blocks=[];s.actors=s.actors.slice(0,2);Object.assign(s.actors[0],{x:1,y:2,stamina:10,answered:1});Object.assign(s.actors[1],{x:2,y:2,hp:4000,maxHp:4000});
  R.prepareIntents(s);return s;
}
test('all four boss cells block movement and a line hit is applied once per strike',()=>{
  let s=scene(),boss=s.actors[1];
  for(const p of R.footprint(boss)){assert.equal(R.at(s,p).uid,boss.uid);assert.ok(!R.moveCells(s,s.actors[0]).some(c=>R.key(c)===R.key(p)));}
  assert.throws(()=>R.apply(s,'u',{type:'move',x:3,y:3},now),/無法到達/);
  s=R.apply(s,'u',{type:'attack',x:2,y:2},now);assert.equal(s.actors[1].hp,3800);
});
test('boss movement checks the complete footprint and warned attacks are avoidable',()=>{
  let s=scene();s.blocks=[{x:4,y:3}];Object.assign(s.actors[0],{x:8,y:2});
  const boss=s.actors[1],route=R.monsterRoute(s,boss,s.actors[0]);
  assert.ok(route.every(p=>R.canOccupy(s,boss,p)));
  s=scene();const intent=s.actors[1].intent;assert.equal(intent.kind,'boss-attack');
  const safe=R.moveCells(s,s.actors[0]).find(p=>!intent.cells.some(c=>R.key(c)===R.key(p)));
  assert.ok(safe);s=R.apply(s,'u',{type:'move',x:safe.x,y:safe.y},now);
  const hp=s.actors[0].hp;s=R.apply(s,'u',{type:'end'},now);assert.equal(s.actors[0].hp,hp);
  s.actors[1].hp=1900;R.prepareIntents(s);assert.equal(s.actors[1].phase,2);
});
test('multi-hit skills hit a boss once per sweep and ordinary knockback cannot displace it',()=>{
  let s=scene();Object.assign(s.actors[0],{x:1,y:3,manualSkills:['wind-step'],trainingAccessScore:68});
  Object.assign(s.actors[1],{x:4,y:2});
  s=R.apply(s,'u',{type:'manual',skillId:'wind-step',x:3,y:3},now);
  assert.equal(s.events.filter(e=>e.type==='damage'&&e.target===s.actors[1].uid).length,2);
  assert.equal(s.actors[1].hp,3440);
});
test('throw deals damage to a boss without moving its four-cell footprint',()=>{
  let s=scene();Object.assign(s.actors[0],{manualSkills:['tiger-throw'],trainingAccessScore:68});
  const position={x:s.actors[1].x,y:s.actors[1].y};
  s=R.apply(s,'u',{type:'manual',skillId:'tiger-throw',x:2,y:2},now);
  assert.deepEqual({x:s.actors[1].x,y:s.actors[1].y},position);
  assert.equal(s.actors[1].hp,3700);
});
test('v4 bosses warn with distinct shapes and the warning survives player movement',()=>{
  const cases=[
    {kind:'rock',turn:2,hero:{x:6,y:2},text:'直線衝擊'},
    {kind:'vine',turn:1,hero:{x:5,y:2},text:'纏根突襲'},
    {kind:'flame',turn:1,hero:{x:5,y:2},text:'烈焰吐息'}
  ];
  for(const c of cases){
    let s=scene();s.trial.layoutVersion=4;s.turn=c.turn;
    Object.assign(s.actors[0],c.hero);Object.assign(s.actors[1],{bossKind:c.kind});
    R.prepareIntents(s);const intent=s.actors[1].intent;
    assert.equal(intent.kind,'boss-attack');assert.match(intent.text,new RegExp(c.text));
    assert.ok(intent.cells.some(p=>R.key(p)===R.key(c.hero)));
    const safe=R.moveCells(s,s.actors[0]).find(p=>!intent.cells.some(q=>R.key(p)===R.key(q)));
    assert.ok(safe,c.kind);const hp=s.actors[0].hp;
    s=R.apply(s,'u',{type:'move',x:safe.x,y:safe.y},now);
    s=R.apply(s,'u',{type:'end'},now);assert.equal(s.actors[0].hp,hp,c.kind);
  }
});
test('v4 phase expansion is isolated from legacy boss warnings',()=>{
  for(const kind of ['rock','vine','flame']){
    const s=scene();s.trial.layoutVersion=4;s.turn=2;
    Object.assign(s.actors[0],{x:5,y:2});Object.assign(s.actors[1],{bossKind:kind});
    R.prepareIntents(s);const first=s.actors[1].intent.cells.length;
    s.actors[1].hp=1900;R.prepareIntents(s);
    assert.equal(s.actors[1].phase,2);assert.ok(s.actors[1].intent.cells.length>=first,kind);
  }
  const old=scene();old.actors[1].bossKind='flame';R.prepareIntents(old);
  assert.match(old.actors[1].intent.text,/靈獸爪擊/);
  assert.equal(R.actor({uid:'boss',bot:true,boss:true,bossKind:'vine'},{x:1,y:1}).bossKind,'vine');
});

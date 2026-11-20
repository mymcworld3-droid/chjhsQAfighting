'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js');
const receipt=require('../solo-question-receipt.cjs');
const now=2000000000000;
const basicHero={uid:'new-player',name:'初入問道',atk:180,maxHp:2500};
const normalize=layout=>({...layout,seed:'same-for-comparison'});

test('every fresh v4 first stage has identical terrain, props, spawn, enemy, and hash across account seeds',()=>{
  const layouts=['11111111111111111111111111111111','22222222222222222222222222222222',
    'abcdefabcdefabcdefabcdefabcdefab','a','another-user-seed']
    .map(seed=>R.stageLayout(seed,1,4));
  for(const layout of layouts){
    assert.equal(layout.mode,'elimination');
    assert.equal(layout.stage,1);
    assert.equal(layout.layoutVersion,4);
    assert.deepEqual(layout.spawn,{x:1,y:3});
    assert.equal(layout.enemies.length,1);
    assert.deepEqual({x:layout.enemies[0].x,y:layout.enemies[0].y},{x:4,y:3});
    assert.equal(layout.enemies[0].name,'靈狼');
    assert.ok(!layout.blocks.some(b=>b.y===3&&b.x>=1&&b.x<=4),'tutorial corridor stays clear');
    assert.match(layout.layoutHash,/^[0-9a-f]{8}$/);
    assert.deepEqual(normalize(layout),normalize(layouts[0]));
  }
  // Preserve the existing campaign seed so later stages remain procedural.
  assert.notEqual(layouts[0].seed,layouts[1].seed);
  assert.notEqual(R.stageLayout('same',2,4).variant,'tutorial');
});

test('answer A supplies enough stamina for exactly one right step and a two-cell attack',()=>{
  const s=R.create({id:'newcomer',mode:'pve',players:[basicHero],
    trial:{seed:'arbitrary-player-seed',stage:1,layoutVersion:4},now});
  const me=s.actors.find(a=>a.uid==='new-player');
  const wolf=s.actors.find(a=>a.bot);
  assert.deepEqual([me.x,me.y,wolf.x,wolf.y],[1,3,4,3]);
  const charged=R.answer(s,'new-player',true,now);
  const moved=R.apply(charged,'new-player',{type:'move',x:2,y:3},now);
  const actor=moved.actors.find(a=>a.uid==='new-player');
  assert.equal(actor.stamina,charged.actors[0].stamina-1,'one tile consumes one stamina');
  assert.deepEqual([actor.x,actor.y],[2,3]);
  assert.ok(R.aimCells(moved,actor,R.basicFor(actor)).some(p=>p.x===4&&p.y===3),
    'enemy is in the cardinal two-cell attack range after moving');
  const before=moved.actors.find(a=>a.bot).hp;
  const attacked=R.apply(moved,'new-player',{type:'attack',x:4,y:3},now);
  assert.ok(attacked.actors.find(a=>a.bot).hp<before,'rightward attack hits wolf');
  assert.equal(attacked.actors[0].stamina,actor.stamina-2);
});

test('a signed solo learning question may place its correct answer at A without changing trusted verification',()=>{
  const uid='first-learner',key=Buffer.from('tutorial-unit-test-secret');
  const parsed={q:'1+1=?',correct:'2',wrong:['3','4','5'],subject:'數學',exp:'1+1等於2'};
  const proof=receipt.issue(uid,parsed,{},key);
  const original=['3','4','2','5'];
  assert.equal(receipt.read(uid,{proof,question:parsed.q,options:original},key).answerIndex,2);
  const options=[original[2],original[1],original[0],original[3]];
  const verified=receipt.read(uid,{proof,question:parsed.q,options},key);
  assert.equal(verified.answerIndex,0);
  assert.equal(verified.explanation,parsed.exp);
  assert.equal(receipt.read('different-account',{proof,question:parsed.q,options},key),null);
  assert.equal(receipt.read(uid,{proof,question:parsed.q,options:['wrong',...options.slice(1)]},key),null);
});

test('first-stage target glows on the ground beneath hero, beast and their HP labels',()=>{
  const {readFileSync}=require('node:fs'),{join}=require('node:path');
  const src=readFileSync(join(__dirname,'../public/cultivation/tactical-renderer.js'),'utf8');
  const start=src.indexOf('const tutorialGuideStep='),end=src.indexOf('// Edge navigation badges',start);
  const actor=src.indexOf('// and BEFORE heroes and beasts',start);
  assert.ok(start>=0&&end>start&&actor>end,'guide target is drawn before actor and HP rendering');
  const block=src.slice(start,end);
  assert.match(block,/tutorialGuideStep===5\?R\.TUTORIAL_STAGE1\?\.move/);
  assert.match(block,/tutorialGuideStep===7\?R\.TUTORIAL_STAGE1\?\.enemy/);
  assert.match(block,/c\.strokeRect\(/);
  assert.match(block,/c\.restore\(\)/);
  assert.doesNotMatch(block,/addEventListener|pointer-events|onSelect/);
});

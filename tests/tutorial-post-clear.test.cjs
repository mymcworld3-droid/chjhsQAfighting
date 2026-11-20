'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const Manuals=require('../public/cultivation/manual-rules.js');
const {roll}=require('../manual-reward-rules.cjs');
const read=file=>readFileSync(join(__dirname,'..',file),'utf8');

test('first-stage victory guarantees an actual introductory manual for an unbound beginner',()=>{
  for(const school of [null,'sword','body']){
    const room={mode:'pve',trial:{stage:1}};
    const initial=Manuals.normalize({school,books:{},dropMisses:0});
    const result=roll(room,'learner',initial,()=>99);
    const id=Manuals.starterFor(school)||'sword-wind';
    assert.equal(result.changed,true);
    assert.equal(result.drop,id);
    assert.deepEqual(Object.keys(result.state.books),[id]);
    assert.equal(result.state.books[id].exp,0);
    assert.equal(room.manualDrops.learner.id,id);
    assert.equal(Manuals.unlocked(result.state,Manuals.BY_BOOK[id].skills[0].id),true);
    assert.equal(result.state.dropMisses,0);
  }
});
test('tutorial drop rule does not change probability for later stages or a player with existing manuals',()=>{
  const room2={mode:'pve',trial:{stage:2}};
  const normal=roll(room2,'learner',Manuals.normalize({}),()=>99);
  assert.equal(normal.drop,null);
  assert.equal(normal.state.dropMisses,1);
  const room1={mode:'pve',trial:{stage:1}};
  const owned=roll(room1,'learner',Manuals.normalize({books:{'sword-wind':{exp:0}}}),()=>99);
  assert.equal(owned.drop,null);
  assert.equal(owned.state.dropMisses,1);
  assert.deepEqual(Object.keys(owned.state.books),['sword-wind']);
});
test('post-clear guide is gated on a real victory and follows verified battle close, training, slot and equip',()=>{
  const battle=read('public/cultivation/tactical-combat.js');
  const guide=read('public/cultivation/first-answer-guide.js');
  const main=read('public/main-legacy.js');
  const manual=read('public/cultivation/manual-training-page.js');
  assert.match(battle,/next\.status==='finished'&&next\.winner==='player'/);
  assert.match(battle,/tutorialEvent\('stage-cleared',\{won:true\}\)/);
  assert.match(battle,/data-tutorial-collapse>收起戰場/);
  assert.match(battle,/if\(completedFirstStage\)tutorialEvent\('battle-closed'\)/);
  assert.match(guide,/const events = \[[^\]]*'stage-cleared', 'battle-closed', 'training-opened', 'slot-opened', 'skill-equipped'/);
  assert.match(guide,/if \(step===8 && detail\.won!==true\)return/);
  assert.match(guide,/if \(step===12 && detail\.verified!==true\)return/);
  assert.match(main,/if\(pageId==='page-training'&&currentUserData\?\.uid\)/);
  assert.match(manual,/tutorialManualEvent\('slot-opened'\)/);
  assert.match(manual,/tutorialManualEvent\('skill-equipped',\{verified:true/);
  assert.match(manual,/await request|request\('\/api\/tactical\/manuals'\)\.then/);
});
test('social header and all four tabs share one row on mobile with no horizontal second row',()=>{
  const legacy=read('public/main-legacy.js');
  const start=legacy.indexOf('function injectSocialUI()');
  const end=legacy.indexOf('main.appendChild(pageSocial)',start);
  assert.ok(start>=0&&end>start);
  const header=legacy.slice(start,end);
  for(const id of ['tab-btn-friends','tab-btn-chat','tab-btn-shares','tab-btn-classes']){
    assert.ok(header.includes('id="'+id+'"'));
  }
  assert.match(header,/class="ui-social-heading/);
  assert.match(header,/class="ui-social-tabs/);
  const css=read('public/styles/social-compact.css');
  assert.match(css,/#page-social \.ui-social-heading\{/);
  assert.match(css,/display:flex!important;flex-direction:row!important/);
  assert.match(css,/flex-wrap:nowrap!important/);
  assert.match(css,/repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:420px\)/);
  assert.match(read('public/index.html'),/styles\/social-compact\.css/);
});
test('tutorial progress after first attack survives reload and is account-bound',()=>{
  const guide=read('public/cultivation/first-answer-guide.js');
  assert.match(guide,/previous\?\.status==='pending'&&Number\.isInteger\(previous\.step\)/);
  assert.match(guide,/previous\.step>=8&&previous\.step<stages\.length/);
  assert.match(guide,/roomId=resume\?String\(previous\.roomId\|\|''\):''/);
  assert.match(guide,/if\(resume&&!battleVisible&&\(step===9\|\|\(step===8&&nextStage>=2\)\)\)step=10/);
  assert.match(guide,/uid && uid === account \? step : -1/);
  assert.match(guide,/if \(step===12 && detail\.verified!==true\)return/);
});

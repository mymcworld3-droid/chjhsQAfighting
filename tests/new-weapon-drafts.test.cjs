'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/cultivation/manual-rules.js');
const D=require('../public/cultivation/new-weapon-drafts.js');
const O=require('../public/cultivation/weapon-special-objects.js');
const board={width:9,height:7,blocked:p=>p.x===0&&p.y===0};
const p=(x,y)=>({x,y});
const put=(s,type,position,generatedAt=0,ownerUid='u')=>O.add(s,{type,ownerUid,position,generatedAt,board,level:3,refinement:2});
test('six new weapons have eighteen unique private skills and unchanged existing public catalog',()=>{
  assert.equal(D.BOOKS.length,6);assert.equal(Object.keys(D.BY_SKILL).length,18);assert.equal(M.BOOKS.length,6);
  for(const b of D.BOOKS){
    assert.equal(M.BY_BOOK[b.id],undefined);
    assert.deepEqual(b.skills.map(s=>s.levelRequired),[1,5,10]);
    assert.ok(Object.isFrozen(b.skills));
    for(const s of b.skills){assert.equal(M.BY_SKILL[s.id],undefined);assert.equal(D.mastered(s.id,M.totalExpForLevel(s.levelRequired)),true);}
    const malicious={school:b.school,books:{[b.id]:{exp:4000}},equipped:b.skills.map(s=>s.id),weaponIds:[b.id,null]};
    const normalized=M.normalize(malicious);assert.equal(normalized.books[b.id],undefined);assert.equal(normalized.equipped.length,0);
  }
});
test('all alternate damage coefficients use existing level and refinement scaling',()=>{
  const factor=1.4*1.25,close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10);
  for(const raw of Object.values(D.BY_SKILL)){
    const scaled=D.skillAtLevel(raw.id,5,5);close(scaled.power,raw.power*factor);
    for(const [id,power] of Object.entries(raw.powers||{}))close(scaled.powers[id],power*factor);
    if(raw.maxTargetPower!==undefined)close(scaled.maxTargetPower,raw.maxTargetPower*factor);
    assert.equal(scaled.cost,raw.cost);
  }
  assert.equal(D.BY_SKILL['prism-scatter'].maxRays,21);
  assert.equal(D.BY_SKILL['gravity-core'].maxTriggers,5);
});
test('mark FIFO, duplicate marks, blocked placement, per-owner separation and pure state',()=>{
  let s=O.empty();const original=JSON.stringify(s);
  for(let x=1;x<=4;x++)s=put(s,'mark',p(x,2));
  assert.deepEqual(O.owned(s,'u','mark').map(o=>o.position.x),[2,3,4]);
  assert.deepEqual(put(s,'mark',p(3,2)),s);
  assert.throws(()=>put(s,'mark',p(0,0)),/position/);
  const other=put(s,'mark',p(1,2),0,'v');
  assert.equal(O.owned(other,'v','mark').length,1);
  assert.equal(JSON.stringify(O.empty()),original);
  assert.equal(O.owned(s,'v').length,0);
});
test('echo FIFO allows distinct timestamps at the same location; mirror is unique and derived',()=>{
  let s=O.empty();s=put(s,'echo',p(1,1));s=put(s,'echo',p(2,2),1);s=put(s,'echo',p(2,2),2);
  assert.deepEqual(O.owned(s,'u','echo').map(o=>o.generatedAt),[1,2]);
  s=put(s,'mirror',null);s=put(s,'mirror',null,1);
  const mirrors=O.owned(s,'u','mirror');assert.equal(mirrors.length,1);
  assert.equal(Object.hasOwn(mirrors[0],'position'),false);
  assert.deepEqual(O.location(mirrors[0],board,p(1,2)),p(7,4));
  assert.deepEqual(O.location(mirrors[0],board,p(8,6)),p(0,0),'obstacle suppresses later attack, not object');
});
test('core replacement, five unique triggers, preserved fifth window, and cleanup',()=>{
  let s=put(O.empty(),'core',p(2,2),10);const first=O.owned(s,'u','core')[0].id;
  s=put(s,'core',p(3,3),11);assert.notEqual(O.owned(s,'u','core')[0].id,first);
  assert.throws(()=>O.add(s,{type:'core',ownerUid:'u',position:p(2,2),generatedAt:11,board,occupied:()=>true}),/empty/);
  assert.equal(O.triggerCore(s,'u',10).triggered,false);
  for(let i=11;i<16;i++){const result=O.triggerCore(s,'u',i);assert.equal(result.triggered,true);s=result.state;assert.equal(O.triggerCore(s,'u',i).triggered,false);}
  assert.equal(O.owned(s,'u','core')[0].remainingTriggers,0);
  assert.equal(O.triggerCore(s,'u',16).triggered,false);
  assert.equal(O.owned(O.endOwnerWindow(s,'u',14),'u','core').length,1);
  assert.equal(O.owned(O.endOwnerWindow(s,'u',15),'u','core').length,0);
});
test('JSON roundtrip, malformed sources, equipment cleanup and battle end',()=>{
  let s=put(O.empty(),'mark',p(1,2));s=put(s,'mirror',null);s=put(s,'echo',p(2,3),0,'v');
  const before=JSON.stringify(s);assert.deepEqual(O.normalize(JSON.parse(before)),s);
  const tampered=JSON.parse(before);tampered.objects[0].weaponId='sword-wind';
  assert.equal(O.owned(tampered,'u','mark').length,0);
  const next=O.reconcileEquipment(s,'u',['body-mirror']);
  assert.deepEqual(O.owned(next,'u').map(o=>o.type),['mirror']);
  assert.equal(O.owned(next,'v').length,1);
  assert.equal(O.finish(next).objects.length,0);assert.equal(JSON.stringify(s),before);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js'),M=require('../public/cultivation/manual-rules.js'),D=require('../public/cultivation/weapon-dungeon-rules.js'),O=require('../public/cultivation/weapon-special-objects.js');
const NOW=2000000000000,p=(x,y)=>({x,y}),pos=a=>p(a.x,a.y);
// Controlled legal combat fixture in the real solo-dungeon engine. Retain
// dungeon identity, objective, environment multiplier and enemy identities;
// isolate geometry to prove a skill's actual damage, not a win-rate claim.
function scene(id,books){
 const ids=books.flatMap(b=>M.BY_BOOK[b].skills.map(s=>s.id));
 const s=R.create({id:'v4-special',mode:'pve',players:[{uid:'u',atk:100,maxHp:10000,manualWeaponMode:true,manualWeaponIds:books,manualSkills:ids}],trial:{seed:'v4-balance-a',weaponDungeon:{id,difficulty:0}},now:NOW});
 const lord=s.actors.find(a=>a.weaponDungeonLord),guards=s.actors.filter(a=>a.bot&&!a.weaponDungeonLord).slice(0,2);
 assert.equal(guards.length,2);assert.ok(lord);
 s.blocks=[];s.actors=[s.actors[0],...guards,lord];
 Object.assign(s.actors[0],p(3,5),{stamina:10});
 Object.assign(lord,p(1,s.height-3),{hp:100000,maxHp:100000});
 for(const [i,g] of guards.entries())Object.assign(g,p(s.width-2,1+i),{hp:100000,maxHp:100000,shield:0,guard:0,counter:0,intent:null});
 return s;
}
const cast=(s,skillId,aim)=>R.apply({...s,events:[]},'u',{type:'manual',skillId,...aim},NOW);
const event=(s,id)=>s.events.find(e=>e.type==='cast'&&e.actor==='u'&&e.skill===id);
const find=(s,uid)=>s.actors.find(a=>a.uid===uid);
for(const id of [D.ID,D.WILD_ID]){
 test(id+' actual bell echo four sequential hits and mirror copies on one resource charge',{skip:!M.RELEASE_NEW_WEAPONS},()=>{
  let s=scene(id,['body-mirror','body-bell']);const a=s.actors[0],b=s.actors[1],c=s.actors[2],bId=b.uid,cId=c.uid;
  Object.assign(b,p(4,5));Object.assign(c,p(s.width-2-3,s.height-1-5));
  s=cast(s,'mirror-summon',pos(a));
  assert.equal(O.owned(s.weaponObjects,'u','mirror').length,1);
  const before=s,sk=R.manualSkillFor(before.actors[0],'bell-echo');
  s=cast(s,'bell-echo',pos(before.actors[0]));
  const e=event(s,'bell-echo');assert.ok(e);
  assert.deepEqual(e.animation.bellSteps.map(step=>step.layer),[1,2,3,4]);
  assert.equal(e.animation.bellSteps.filter(step=>step.hits.some(h=>h.uid===bId&&h.damage>0)).length,4);
  assert.equal(e.animation.mirrorSteps.length,4);
  assert.ok(e.animation.mirrorSteps.some(step=>step.hits.some(h=>h.uid===cId&&h.damage>0)));
  assert.ok(find(s,bId).hp<find(before,bId).hp);assert.ok(find(s,cId).hp<find(before,cId).hp);
  assert.equal(before.actors[0].stamina-s.actors[0].stamina,R.techniqueCost(before.actors[0],sk));
  assert.equal(s.pveMetrics.manualCasts['bell-echo'],1);
 });
 test(id+' actual summon, independent sword movement and recall hit the same guard',{skip:!M.BY_BOOK['sword-flight']},()=>{
  let s=scene(id,['sword-flight']);const uid=s.actors[1].uid;
  Object.assign(s.actors[1],p(5,5));
  s=cast(s,'flight-summon',p(4,5));
  assert.deepEqual(s.actors[0].flyingSword,p(4,5));
  const hp=find(s,uid).hp,energy=s.actors[0].stamina;
  const dest=p(6,5);
  assert.ok(R.swordMoveCells(s,s.actors[0]).some(q=>R.key(q)===R.key(dest)&&q.cost===1));
  s=R.apply({...s,events:[]},'u',{type:'sword-move',...dest},NOW);
  assert.equal(s.actors[0].stamina,energy-1);assert.ok(find(s,uid).hp<hp);
  const hp2=find(s,uid).hp;
  s=cast(s,'flight-summon',p(4,5));
  assert.deepEqual(s.actors[0].flyingSword,p(4,5));assert.ok(find(s,uid).hp<hp2);
  assert.equal(s.pveMetrics.manualCasts['flight-summon'],2);
 });
 test(id+' actual weave mark and time echo coexist, time union consumes only echoes',{skip:!M.RELEASE_NEW_WEAPONS},()=>{
  let s=scene(id,['sword-weave','sword-time']);const uid=s.actors[1].uid;
  Object.assign(s.actors[1],p(5,5));
  s=cast(s,'weave-mark',p(4,5));
  s=cast(s,'time-slash',p(5,5));
  assert.equal(O.owned(s.weaponObjects,'u','mark').length,1);
  assert.equal(O.owned(s.weaponObjects,'u','echo').length,1);
  // Advance with the real turn and answer commands. The enemy may pursue;
  // choose a legal aim with two actual rays that hit a living opponent.
  s=R.apply({...s,events:[]},'u',{type:'end'},NOW);
  while(s.actors[0].questions<2&&s.actors[0].stamina<6)s=R.answer(s,'u',true,NOW);
  const a=s.actors[0],sk=R.manualSkillFor(a,'time-union');
  const candidates=R.aimCells(s,a,sk);
  let chosen=null;
  for(const q of candidates){
   let next;try{next=cast(s,'time-union',q);}catch(_){continue;}
   const e=event(next,'time-union');
   if(e?.animation.timePlan?.rays?.length>=2&&next.actors.some(t=>t.bot&&t.hp<find(s,t.uid).hp)){chosen=next;break;}
  }
  assert.ok(chosen,'no legal damaging time union after actual mark and echo casts');
  assert.equal(O.owned(chosen.weaponObjects,'u','echo').length,0);
  assert.deepEqual(O.owned(chosen.weaponObjects,'u','mark'),O.owned(s.weaponObjects,'u','mark'));
  assert.equal(chosen.pveMetrics.manualCasts['weave-mark'],1);
  assert.equal(chosen.pveMetrics.manualCasts['time-union'],1);
 });
}

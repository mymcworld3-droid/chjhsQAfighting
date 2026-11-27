'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js');
const V=require('../public/cultivation/tactical-target-visuals.js');
const now=2000000000000;
function scene(id='wind-step'){
  const s=R.create({id:'skill-preview',players:[{uid:'u',name:'修士',atk:200,maxHp:2000}],now});
  s.blocks=[];const a=s.actors[0],b=s.actors[1];
  Object.assign(a,{x:1,y:3,stamina:10,actions:0,attacks:0,manualSkills:[id]});
  Object.assign(b,{x:4,y:3,hp:2000,maxHp:2000,shield:0,guard:0});
  return s;
}
const skill=(s,id)=>R.manualSkillFor(s.actors[0],id);
test('all legal dash aims expose the attack union before selection without changing state',()=>{
  const s=scene(),sk=skill(s,'wind-step'),snapshot=JSON.stringify(s);
  const plan=R.skillPreviewPlan(s,s.actors[0],sk);
  assert.ok(plan.aims.some(p=>R.key(p)==='3,3'));
  assert.ok(plan.cells.some(p=>R.key(p)==='4,2'));
  assert.equal(JSON.stringify(s),snapshot);
  const selected=plan.byAim['3,3'];
  const next=R.apply(s,'u',{type:'manual',skillId:sk.id,x:3,y:3},now);
  assert.deepEqual(selected.hits.map(h=>h.damage),next.events.filter(e=>e.type==='damage'&&e.actor==='u').map(e=>e.damage));
  assert.equal(selected.hits.length,2);
  assert.equal(selected.hits.reduce((n,h)=>n+h.damage,0),480);
  assert.equal(next.actors[0].stamina,6);
  assert.equal(JSON.stringify(s),snapshot);
  const visual=V.derive(s,'u','manual:wind-step',{x:3,y:3},R,null,plan);
  assert.equal(visual.estimatedDamage,480);
  assert.match(visual.hint,/240＋240/);
});
test('low stamina keeps the geometric preview but never grants permission',()=>{
  const s=scene();s.actors[0].stamina=0;
  const sk=skill(s,'wind-step'),before=JSON.stringify(s);
  const p=R.skillPreviewPlan(s,s.actors[0],sk).byAim['3,3'];
  assert.ok(p.cells.length);assert.equal(p.valid,false);assert.match(p.reason,/體力不足/);
  assert.throws(()=>R.apply(s,'u',{type:'manual',skillId:sk.id,x:3,y:3},now),/體力不足/);
  assert.equal(JSON.stringify(s),before);
});
test('four-step preview matches ordered real damage and final displacement',()=>{
  const s=scene('dragon-guard'),a=s.actors[0],b=s.actors[1];
  Object.assign(a,{x:1,y:3});Object.assign(b,{x:2,y:3});
  const sk=skill(s,'dragon-guard'),before=JSON.stringify(s);
  const p=R.skillPreviewPlan(s,a,sk).byAim['2,3'];
  const next=R.apply(s,'u',{type:'manual',skillId:sk.id,x:2,y:3},now);
  assert.deepEqual(p.hits.map(h=>h.damage),next.events.filter(e=>e.type==='damage'&&e.actor==='u').map(e=>e.damage));
  assert.deepEqual(p.finalPositions,next.actors.filter(t=>R.key(t)!==R.key(s.actors.find(v=>v.uid===t.uid))).map(t=>({uid:t.uid,x:t.x,y:t.y})));
  assert.equal(JSON.stringify(s),before);
});
test('first sword summon has legal aims without damage, and walls invalidate the dash plan',()=>{
  const s=scene('flight-summon');
  const p=R.skillPreviewPlan(s,s.actors[0],skill(s,'flight-summon'));
  assert.ok(p.aims.length);assert.equal(p.cells.length,0);
  assert.ok(Object.values(p.byAim).every(v=>v.hits.length===0));
  s.actors[0].manualSkills=['wind-step'];
  s.blocks=[{x:2,y:3}];
  const blocked=R.skillPreviewPlan(s,s.actors[0],skill(s,'wind-step'));
  assert.equal(blocked.byAim['3,3'],undefined);
});

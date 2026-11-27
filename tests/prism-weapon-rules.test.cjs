'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../public/cultivation/prism-weapon-rules.js');
const G=require('../public/cultivation/weapon-geometry.js');
const D=require('../public/cultivation/new-weapon-drafts.js');
const M=require('../public/cultivation/manual-rules.js');
const R=require('../public/cultivation/tactical-rules.js');
const C=require('../public/cultivation/dungeon-skill-resolution.js');
const p=(x,y)=>({x,y}),board=(width=9,height=9,blocks=[])=>({width,height,blocked:q=>blocks.some(b=>G.key(b)===G.key(q))});
const sk=(id,l=1,s=0)=>D.skillAtLevel(id,l,s);
test('slash reaches three cells and stops at walls and closed diagonal corners',()=>{
  const b=board(9,9,[p(5,4),p(4,5)]),s=sk('prism-slash');
  assert.equal(P.selected(b,p(4,4),s,p(5,5)),null);
  const plan=P.selected(b,p(4,4),s,p(3,3));
  assert.deepEqual(plan.cells,[p(3,3),p(2,2),p(1,1)]);
  assert.equal(P.selected(b,p(4,4),s,p(0,0)),null);
  assert.equal(P.selected(b,p(4,4),s,p(2,3)),null);
});
test('reflection uses the normal, allows repeated hits, never crosses walls',()=>{
  const s=sk('prism-reflect'),b=board(9,9,[p(7,4)]);
  const a=P.selected(b,p(2,4),s,p(3,4));
  assert.deepEqual(a.rays[1].cells,[p(5,4),p(4,4),p(3,4)]);
  const hits=P.hitIntents(a,s,[{uid:'boss',x:4,y:4,footprint:{width:2,height:2}}]);
  assert.deepEqual(hits.map(h=>h.power),[1.6,1]);
  assert.equal(a.cells.some(q=>G.key(q)==='7,4'),false);
});
test('all scatter trees have stable bounded branches and per-ray footprint deduplication',()=>{
  const s=sk('prism-scatter',5,5),b=board(),origin=p(4,4),plans=P.plans(b,origin,s);
  assert.equal(Object.keys(plans.byDirection).length,8);
  for(const plan of Object.values(plans.byDirection)){
    assert.ok(plan.rays.length<=21);
    assert.deepEqual(plan,P.selected(b,origin,s,plan.aims[0]));
    for(const ray of plan.rays){
      assert.ok(ray.depth<=2);assert.ok(ray.cells.every(q=>G.open(b,q)));
      if(ray.parent!==null)assert.deepEqual(ray.origin,plan.rays[ray.parent].collision.from);
    }
    const enemies=Array.from({length:4},(_,i)=>({uid:'e'+i,x:1+i*2,y:1,footprint:2}));
    const hits=P.hitIntents(plan,s,enemies);
    for(const e of enemies){
      const list=hits.filter(h=>h.uid===e.uid);
      assert.ok(list.reduce((n,h)=>n+h.power,0)<=s.maxTargetPower+1e-9);
      assert.equal(new Set(list.map(h=>h.rayId)).size,list.length);
    }
  }
});
test('scatter cap is applied independently, including partial last ray',()=>{
  const s=sk('prism-scatter'),plan=P.build(board(5,5),p(2,2),s,p(1,0));
  const enemies=[{uid:'a'},{uid:'b'}],hits=P.hitIntents(plan,s,enemies,()=>true);
  for(const enemy of enemies){
    const list=hits.filter(h=>h.uid===enemy.uid);
    assert.ok(Math.abs(list.reduce((n,h)=>n+h.power,0)-2.4)<1e-9);
    assert.ok(list.every(h=>h.power>0));
  }
  assert.equal(plan.rays.length<=21,true);
});
test('trial preview invokes private cast, is immutable and rejects draft in public lookup',()=>{
  const s=R.create({id:'prism-test',mode:'pve',players:[{uid:'u',name:'u',atk:100,maxHp:10000,manualSkills:[]}],now:2000000000000});
  s.width=9;s.height=9;s.blocks=[p(7,4)];
  Object.assign(s.actors[0],{x:2,y:4,atk:100,stamina:10,manualSkills:['prism-reflect']});
  Object.assign(s.actors[1],{x:4,y:4,hp:1000,maxHp:1000,shield:0,guard:0});
  const before=JSON.stringify(s),a=s.actors[0],skill=sk('prism-reflect');
  const plan=R.skillPreviewPlan(s,a,skill);
  assert.deepEqual(plan.byAim['3,4'].hits.map(h=>h.damage),[160,100]);
  assert.deepEqual(plan.byAim['3,4'].hits,plan.byAim['5,4'].hits);
  assert.equal(JSON.stringify(s),before);
  if(M.RELEASE_NEW_WEAPONS){assert.equal(R.manualSkillFor(a,skill.id).id,skill.id);assert.equal(M.BY_SKILL[skill.id].id,skill.id);}
  else{assert.equal(R.manualSkillFor(a,skill.id),null);assert.equal(M.BY_SKILL[skill.id],undefined);}
  assert.equal(R.manualSkillFor({...a,manualSkills:[]},skill.id),null);
});
test('private dungeon resolver uses same hit order and cap without mutating room',()=>{
  const map={width:9,height:9,tiles:Array(81).fill(1)};map.tiles[4*9+7]=0;
  const room={status:'assembled',battleAppliedTick:0,members:{u:{uid:'u',position:p(2,4),battleHealth:1000,explorationStamina:10}},enemies:[{id:'e',kind:'wolf',position:p(4,4),battleHealth:1000,battleMaxHealth:1000}]};
  const before=JSON.stringify(room),skill=sk('prism-reflect');
  const out=C.resolveCast(room,'u',map,skill,{target:p(3,4),seq:1,base:100});
  assert.deepEqual(out.result.hits.map(h=>h.damage),[160,100]);
  assert.equal(out.enemies[0].battleHealth,740);
  assert.equal(out.members.u.explorationStamina,6);
  assert.equal(JSON.stringify(room),before);
  assert.throws(()=>C.resolveCast(room,'u',map,skill,{target:p(3,5),seq:1,base:100,moveSword:true}),/飛劍/);
});

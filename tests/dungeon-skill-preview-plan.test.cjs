'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../dungeon-skill-combat.cjs');
const R=require('../public/cultivation/dungeon-skill-resolution.js');
const M=require('../public/cultivation/manual-rules.js');
const map={width:15,height:15,tiles:Array(225).fill(1)};
function setup(id,{boss=false,stamina=10,stars=0}={}){
  const sk=M.BY_SKILL[id],record={school:sk.school,books:{[sk.manualId]:{exp:2500,refinement:stars}},equipped:[id],
    loadouts:[{name:'測試',skillIds:[id]},{name:'空白',skillIds:[]},{name:'空白',skillIds:[]}],activeLoadout:0};
  const member={uid:'u',position:{x:5,y:5},battleHealth:1000,battleMaxHealth:1000,battleAttack:200,explorationStamina:stamina,accessScore:200};
  const enemy={id:'beast-1',kind:boss?'boss':'wolf',position:{x:8,y:5},battleHealth:2000,battleMaxHealth:2000,shield:boss?180:0};
  const room={status:'assembled',battleAppliedTick:0,members:{u:{...member,...S.initialCombatLoadout(member,record)}},enemies:[enemy]};
  return {room,record,skill:room.members.u.dungeonSkills.find(s=>s.id===id)};
}
test('all eighteen existing skills share the authoritative dungeon cast geometry and hit order',()=>{
  for(const book of M.BOOKS.filter(b=>!b.release))for(const sk of book.skills){
    const {room,record,skill}=setup(sk.id,{boss:true,stars:2});
    assert.ok(skill,sk.id);
    const before=JSON.stringify(room),plan=R.previewPlan(room,'u',map,skill);
    assert.equal(plan.exact,true);
    assert.ok(plan.aims.length,sk.id);
    for(const aim of plan.aims){
      const predicted=plan.byAim[aim.x+','+aim.y];
      if(!predicted.valid)continue;
      const actual=S.castSkill(room,'u',map,record,{skillId:sk.id,target:aim,seq:1});
      assert.deepEqual(predicted.hits,actual.result.hits,sk.id);
      assert.deepEqual(predicted.cells,[...new Map(actual.cells.map(p=>[p.x+','+p.y,p])).values()]);
      assert.equal(predicted.totalDamage,actual.result.totalDamage);
      assert.deepEqual(predicted.landings,actual.result.visualMoves.map(m=>m.to));
    }
    assert.equal(JSON.stringify(room),before);
  }
});
test('stamina deficiency and legacy metadata never grant permission or assert exact damage',()=>{
  const {room,record,skill}=setup('wind-slash',{stamina:0});
  const before=JSON.stringify(room),plan=R.previewPlan(room,'u',map,skill);
  assert.ok(plan.cells.length);assert.ok(Object.values(plan.byAim).every(s=>!s.valid));
  assert.throws(()=>S.castSkill(room,'u',map,record,{skillId:'wind-slash',target:{x:6,y:5},seq:1}),/體力不足/);
  assert.equal(JSON.stringify(room),before);
  const legacy={...skill};delete legacy.refinement;
  assert.equal(R.previewPlan(room,'u',map,legacy).exact,false);
});
test('dash cannot pass teammates and first sword summon has no damage area',()=>{
  const {room,skill}=setup('wind-step');
  room.members.v={uid:'v',position:{x:6,y:5}};
  assert.equal(R.previewPlan(room,'u',map,skill).byAim['7,5'],undefined);
  const summon=setup('flight-summon');
  const plan=R.previewPlan(summon.room,'u',map,summon.skill);
  assert.ok(plan.aims.length);assert.equal(plan.cells.length,0);
});

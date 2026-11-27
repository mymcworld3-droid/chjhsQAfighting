'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../dungeon-player-combat.cjs');
const R=require('../public/cultivation/dungeon-skill-resolution.js');
const map={width:9,height:9,tiles:Array(81).fill(1)};
function room(){return {status:'assembled',battleAppliedTick:3,members:{u:{uid:'u',position:{x:3,y:3},battleHealth:100,explorationStamina:10,battleAttack:200}},enemies:[
  {id:'beast-1',kind:'wolf',position:{x:4,y:3},battleHealth:500},
  {id:'boss-1',kind:'boss',position:{x:5,y:3},battleHealth:2800,shield:180,lastContributorUid:'v',lastContributorTick:2}
]};}
test('basic preview matches actual boss footprint ray and cooperative damage',()=>{
  const s=room(),before=JSON.stringify(s),plan=R.basicPreviewPlan(s,'u',map);
  assert.equal(plan.cells.length,8);assert.equal(Object.keys(plan.byEnemy).length,2);
  for(const [id,scheme] of Object.entries(plan.byEnemy)){
    const out=P.strikeEnemy(s,'u',map,{enemyId:id,seq:1});
    assert.deepEqual(scheme.cells,out.hit.cells);assert.deepEqual(scheme.hits,out.hit.hits);
    assert.equal(scheme.totalDamage,out.hit.hits.reduce((n,h)=>n+h.damage,0));
  }
  assert.equal(plan.aims.some(p=>p.x===5&&p.y===3),true);
  assert.equal(JSON.stringify(s),before);
});
test('basic preview separates geometry from permissions and walls',()=>{
  const s=room(),m={...map,tiles:map.tiles.slice()};m.tiles[3*9+4]=0;
  assert.equal(R.basicPreviewPlan(s,'u',m).byEnemy['boss-1'],undefined);
  s.members.u.explorationStamina=0;
  assert.equal(R.basicPreviewPlan(s,'u',map).byEnemy['beast-1'].valid,false);
  s.members.u.dungeonSkillIds=['wind-slash'];
  assert.equal(R.basicPreviewPlan(s,'u',map).cells.length,0);
});

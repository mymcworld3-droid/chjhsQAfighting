'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../dungeon-skill-combat.cjs');
const M=require('../public/cultivation/manual-rules.js');
const map={width:16,height:16,tiles:Array.from({length:256},(_,i)=>{
  const x=i%16,y=Math.floor(i/16);
  return x>0&&x<15&&y>0&&y<15?1:0;
})};
const beast=(x=7,y=5,id='beast-1',hp=400)=>({
  id,kind:'golem',position:{x,y},battleHealth:hp,
  battleMaxHealth:400,attack:null,intent:'patrol'
});
const preset=(idList)=>({name:'測試配置',skillIds:idList});
const sword=()=>({
  school:'sword',books:{
    'sword-wind':{exp:2500},'sword-sky':{exp:2500},'sword-flight':{exp:2500}
  },equipped:['wind-slash','wind-step','wind-thousand'],
  loadouts:[preset(['wind-slash','wind-step','wind-thousand']),
    preset(['sky-pierce','sky-cloud','sky-sever']),
    preset(['flight-slash','flight-summon','flight-break'])],
  skillLevels:{'wind-slash':3},activeLoadout:0
});
const body=()=>({
  school:'body',books:{
    'body-dragon':{exp:2500},'body-rock':{exp:2500},'body-tiger':{exp:2500}
  },equipped:['dragon-strike','dragon-guard','dragon-roar'],
  loadouts:[preset(['dragon-strike','dragon-guard','dragon-roar']),
    preset(['tiger-fist','tiger-step','tiger-throw']),
    preset(['rock-fist','rock-quake','rock-break'])],
  activeLoadout:0
});
function room(record,enemy=beast()){
  const account={uid:'a',accessScore:200,position:{x:5,y:5},
    battleHealth:100,downed:false,explorationStamina:100};
  return {status:'assembled',battleAppliedTick:0,enemies:[enemy],
    members:{a:{...account,...S.initialCombatLoadout(account,record)}}};
}
const cast=(r,record,skillId,target,seq=1)=>S.castSkill(r,'a',map,record,{skillId,target,seq});
const next=(old,out)=>({...old,members:out.members,enemies:out.enemies});
test('skill loadout snapshots only include owned, unlocked, realm-valid abilities',()=>{
  const record=sword(),low=S.initialCombatLoadout({accessScore:1},record);
  assert.ok(low.dungeonSkillIds.includes('wind-slash'));
  assert.ok(!low.dungeonSkillIds.includes('wind-step')||M.BY_SKILL['wind-step'].realmRequired<=1);
  const high=S.initialCombatLoadout({accessScore:200},record);
  assert.deepStrictEqual(high.dungeonSkillIds,['wind-slash','wind-step','wind-thousand']);
  assert.equal(high.dungeonSkills.length,3);
  assert.equal(S.loadout(record,200,1).dungeonSkillIds[1],'sky-cloud');
  assert.throws(()=>S.loadout(record,200,5),/編號/);
  const missing={...record,books:{'sword-wind':{exp:0}}};
  assert.deepStrictEqual(S.loadout(missing,200,0).dungeonSkillIds,['wind-slash']);
});
test('straight sword beam uses level-scaled power, stops at a wall and debits once',()=>{
  const record=sword(),r=room(record,beast(7,5,'beast-1',500));
  const first=cast(r,record,'wind-slash',{x:7,y:5});
  assert.equal(first.duplicate,false);
  assert.ok(first.result.totalDamage>0);
  assert.equal(first.members.a.explorationStamina,98);
  assert.equal(r.enemies[0].battleHealth,500,'pure function');
  assert.equal(first.members.a.skillSeq,1);
  assert.equal(cast(next(r,first),record,'wind-slash',{x:7,y:5}).duplicate,true);
  assert.throws(()=>cast(r,record,'wind-slash',{x:6,y:6}),/直線/);
  const blocked=structuredClone(map);
  blocked.tiles[5*16+6]=0;
  assert.throws(()=>S.castSkill(r,'a',blocked,record,{
    skillId:'wind-slash',target:{x:7,y:5},seq:1}),/岩壁/);
});
test('enemy cannot be hit twice by a retried packet and a forged skill fails',()=>{
  const record=sword(),r=room(record);
  assert.throws(()=>cast(r,record,'sky-sever',{x:7,y:5}),/尚未裝備/);
  assert.throws(()=>cast(r,record,'wind-slash',{x:7,y:5},2),/不同步/);
  assert.throws(()=>cast(r,record,'wind-slash',{x:900,y:5}),/牆壁/);
  r.members.a.downed=true;
  assert.throws(()=>cast(r,record,'wind-slash',{x:7,y:5}),/倒地/);
  r.members.a.downed=false;r.members.a.explorationStamina=0;
  assert.throws(()=>cast(r,record,'wind-slash',{x:7,y:5}),/不足/);
});
test('dash to open tile lands forward and multi-hit cleave hits enemy ahead',()=>{
  const record=sword(),r=room(record,beast(8,5));
  const out=cast(r,record,'wind-step',{x:7,y:5});
  assert.deepStrictEqual(out.members.a.position,{x:7,y:5});
  assert.ok(out.result.hits.length>0);
  assert.ok(out.result.totalDamage>0);
  assert.throws(()=>cast(r,record,'wind-step',{x:8,y:5}),/空地/);
});
test('sword array can damage multiple enemies, with multiple center intersections',()=>{
  const record=sword(),initial=room(record,beast(7,5,'beast-1',500));
  initial.enemies.push(beast(8,6,'beast-2',500));
  const switched=S.switchLoadout(initial,'a',record,1);
  const state={...initial,members:switched.members};
  const out=cast(state,record,'sky-cloud',{x:7,y:5});
  assert.ok(out.result.hits.filter(v=>v.enemyId==='beast-1').length>=2);
  assert.ok(out.result.hits.some(v=>v.enemyId==='beast-2'));
  assert.equal(out.members.a.explorationStamina,96);
});
test('flying sword summons to vacant tile then attacks along cardinal trail',()=>{
  const record=sword(),initial=room(record,beast(8,5));
  const preset=S.switchLoadout(initial,'a',record,2);
  let state={...initial,members:preset.members};
  const summoned=cast(state,record,'flight-summon',{x:6,y:5});
  assert.equal(summoned.result.totalDamage,0);
  assert.deepStrictEqual(summoned.members.a.flyingSword,{x:6,y:5});
  state=next(state,summoned);
  const through=cast(state,record,'flight-summon',{x:8,y:5},2);
  assert.ok(through.result.totalDamage>0);
  assert.ok(through.enemies[0].battleHealth<400);
});
test('body focus grants six reduced-cost casts and expires without turn limits',()=>{
  const record=body(),r=room(record,beast(7,5));
  const focused=cast(r,record,'dragon-roar',{x:5,y:5});
  assert.equal(focused.members.a.focusCharges,6);
  assert.equal(focused.result.totalDamage,0);
  let state=next(r,focused);
  for(let i=0;i<6;i++){
    const out=cast(state,record,'dragon-strike',{x:7,y:5},i+2);
    assert.equal(out.result.cost,1);
    assert.equal(out.members.a.focusCharges,5-i);
    state=next(state,out);
  }
  assert.equal(state.members.a.focusCharges,0);
  const normal=cast(state,record,'dragon-strike',{x:7,y:5},8);
  assert.equal(normal.result.cost,2);
});
test('throw moves a beast to vacant rear tile; an occupied landing is safe',()=>{
  const record=body(),r=room(record,beast(6,5));
  const equipped=S.switchLoadout(r,'a',record,1);
  const state={...r,members:equipped.members};
  const moved=cast(state,record,'tiger-throw',{x:6,y:5});
  assert.deepStrictEqual(moved.enemies[0].position,{x:4,y:5});
  assert.ok(moved.result.totalDamage>0);
  state.members.b={uid:'b',position:{x:4,y:5},
    battleHealth:100,downed:false};
  const blocked=cast(state,record,'tiger-throw',{x:6,y:5});
  assert.equal(blocked.result.totalDamage,0);
});
test('server-only preset switch preserves independent focus, flight sword and sequence',()=>{
  const record=sword(),r=room(record);
  const changed=S.switchLoadout(r,'a',record,1);
  assert.equal(changed.members.a.dungeonLoadoutIndex,1);
  assert.ok(changed.members.a.dungeonSkillIds.includes('sky-cloud'));
  assert.equal(changed.duplicate,false);
  assert.equal(S.switchLoadout({...r,members:changed.members},'a',record,1).duplicate,true);
});

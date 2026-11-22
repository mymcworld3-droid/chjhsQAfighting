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
    battleHealth:100,downed:false,explorationStamina:10};
  return {status:'assembled',battleAppliedTick:0,enemies:[enemy],
    members:{a:{...account,...S.initialCombatLoadout(account,record)}}};
}
const cast=(r,record,skillId,target,seq=1)=>S.castSkill(r,'a',map,record,{skillId,target,seq});
const next=(old,out)=>({...old,members:out.members,enemies:out.enemies});
// Simulates the resulting credited +4 energy after a separately-verified
// answer; the skill unit test does not issue quiz receipts.
const charged=(state,cost)=>state.members.a.explorationStamina>=cost?state:
  {...state,members:{...state.members,
    a:{...state.members.a,explorationStamina:
      Math.min(10,state.members.a.explorationStamina+4)}}};
test('skill loadout snapshots only include owned, mastery-unlocked abilities regardless of player realm',()=>{
  const record=sword(),low=S.initialCombatLoadout({accessScore:1},record);
  assert.ok(low.dungeonSkillIds.includes('wind-slash'));
  assert.deepStrictEqual(low.dungeonSkillIds,['wind-slash','wind-step','wind-thousand']);
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
  assert.equal(first.members.a.explorationStamina,8);
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
  assert.equal(out.members.a.explorationStamina,6);
});
test('flying sword summons within two cells and attacks along the shortest beast-aware route',()=>{
  const record=sword(),initial=room(record,beast(6,6));
  const preset=S.switchLoadout(initial,'a',record,2);
  let state={...initial,members:preset.members};
  const summoned=cast(state,record,'flight-summon',{x:5,y:6});
  assert.equal(summoned.result.totalDamage,0);
  assert.equal(summoned.result.cost,3);
  assert.deepStrictEqual(summoned.members.a.flyingSword,{x:5,y:6});
  state=next(state,summoned);
  const through=cast(state,record,'flight-summon',{x:7,y:5},2);
  assert.equal(through.result.cost,3);
  assert.ok(through.result.totalDamage>0);
  assert.ok(through.enemies[0].battleHealth<400);
  assert.equal(through.result.path.length-1,3);
  assert.ok(through.result.path.some(p=>p.x===6&&p.y===6));
});
test('body focus grants six reduced-cost casts and expires without turn limits',()=>{
  const record=body(),r=room(record,beast(7,5));
  const focused=cast(r,record,'dragon-roar',{x:5,y:5});
  assert.equal(focused.members.a.focusCharges,6);
  assert.equal(focused.result.totalDamage,0);
  let state=next(r,focused);
  for(let i=0;i<6;i++){
    state=charged(state,1);
    const out=cast(state,record,'dragon-strike',{x:7,y:5},i+2);
    assert.equal(out.result.cost,1);
    assert.equal(out.members.a.focusCharges,5-i);
    state=next(state,out);
  }
  assert.equal(state.members.a.focusCharges,0);
  state=charged(state,2);
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


test('push-to-edge advances the NPC, without crossing a wall or another actor',()=>{
  const record=sword(),first=room(record,beast(7,5,'beast-1',500));
  const pushed=cast(first,record,'wind-thousand',{x:7,y:5});
  assert.ok(pushed.enemies[0].position.x>7,'push-to-edge must actually move NPC');
  assert.equal(pushed.enemies[0].position.y,5);
  const withWall=structuredClone(map);
  withWall.tiles[5*16+9]=0;
  const bounded=S.castSkill(first,'a',withWall,record,{
    skillId:'wind-thousand',target:{x:7,y:5},seq:1});
  assert.deepStrictEqual(bounded.enemies[0].position,{x:8,y:5});
  const blocked=room(record,beast(7,5,'beast-1',500));
  blocked.members.b={uid:'b',position:{x:8,y:5},
    battleHealth:0,downed:true};
  const stopped=cast(blocked,record,'wind-thousand',{x:7,y:5});
  assert.deepStrictEqual(stopped.enemies[0].position,{x:7,y:5});
});
test('fist sweep pushes a live NPC and stops before a second enemy',()=>{
  const record=body(),initial=room(record,beast(6,5,'beast-1',500));
  const enabled=S.switchLoadout(initial,'a',record,2);
  const state={...initial,members:enabled.members};
  const pushed=cast(state,record,'rock-break',{x:6,y:5});
  assert.ok(pushed.enemies[0].position.x>6);
  const collision=room(record,beast(6,5,'beast-1',500));
  collision.enemies.push(beast(7,5,'beast-2',500));
  const active=S.switchLoadout(collision,'a',record,2);
  const stalled=cast({...collision,members:active.members},
    record,'rock-break',{x:6,y:5});
  assert.deepStrictEqual(stalled.enemies.find(x=>x.id==='beast-1').position,
    {x:6,y:5});
});

test('stage 13: focus empowers only body attacks, consumes precisely six empowered casts',()=>{
  const record=body(),initial=room(record,beast(7,5,'beast-1',99999));
  const focus=cast(initial,record,'dragon-roar',{x:5,y:5});
  assert.equal(focus.result.focusActivated,true);
  assert.equal(focus.result.focusEmpowered,false);
  assert.deepStrictEqual(focus.result.effectCells,[{x:5,y:5}]);
  assert.equal(focus.members.a.focusCharges,6);
  let state=next(initial,focus);
  for(let n=0;n<6;n++){
    state=charged(state,1);
    const used=cast(state,record,'dragon-strike',{x:7,y:5},n+2);
    assert.equal(used.result.focusEmpowered,true);
    assert.equal(used.result.cost,1);
    assert.equal(used.result.focusBefore,6-n);
    assert.equal(used.result.focusCharges,5-n);
    assert.ok(used.result.effectCells.every(p=>Number.isInteger(p.x)&&Number.isInteger(p.y)));
    state=next(state,used);
  }
  state=charged(state,2);
  const normal=cast(state,record,'dragon-strike',{x:7,y:5},8);
  assert.equal(normal.result.focusEmpowered,false);
  assert.equal(normal.result.cost,2);
  assert.equal(normal.result.focusCharges,0);
});
test('stage 13: switching manuals does not fabricate empowerment or consume body focus on a sword',()=>{
  const b=body(),r=room(b,beast(7,5,'beast-1',9999));
  const prepared=cast(r,b,'dragon-roar',{x:5,y:5});
  const swordRecord=sword();
  const changed={...next(r,prepared),members:{
    ...prepared.members,a:{...prepared.members.a,
      ...S.loadout(swordRecord,200,0)}
  }};
  assert.equal(S.isFocusEmpowered(changed.members.a,M.BY_SKILL['wind-slash']),false);
  assert.equal(S.focusCost(changed.members.a,M.BY_SKILL['wind-slash']),2);
  const shot=cast(changed,swordRecord,'wind-slash',{x:7,y:5},2);
  assert.equal(shot.result.focusEmpowered,false);
  assert.equal(shot.result.focusCharges,6);
  assert.equal(shot.result.focusBefore,6);
  assert.equal(shot.result.cost,2);
  assert.equal(shot.result.totalDamage>0,true);
  assert.equal(S.focusCost(shot.members.a,M.BY_SKILL['dragon-strike']),1);
});
test('stage 13: empowered skills cannot be forged by a browser-reported flag or costs',()=>{
  const record=body(),r=room(record,beast(7,5,'beast-1',9999));
  const attack=S.castSkill(r,'a',map,record,{skillId:'dragon-strike',
    target:{x:7,y:5},seq:1,focusCharges:6,focusEmpowered:true,cost:0});
  assert.equal(attack.result.focusEmpowered,false);
  assert.equal(attack.result.cost,2);
  assert.equal(attack.result.focusCharges,0);
  assert.equal(attack.members.a.explorationStamina,8);
});

test('stage 13: realtime dungeon skill labels never describe turn cooldowns',()=>{
  const bodyRecord=body(),bodySkills=S.loadout(bodyRecord,200,0).dungeonSkills;
  const focus=bodySkills.find(skill=>skill.id==='dragon-roar');
  assert.ok(focus.description.includes('六層'));
  assert.ok(focus.description.includes('沒有回合或冷卻'));
  assert.ok(!focus.description.includes('立即結束回合'));
  assert.equal(focus.singleHitDamage,0);
  const swordRecord=sword(),flying=S.loadout(swordRecord,200,2)
    .dungeonSkills.find(skill=>skill.id==='flight-summon');
  assert.ok(flying.description.includes('沒有回合或冷卻'));
  assert.ok(flying.singleHitDamage>0);
});
test('stage 13: server recomputes live attack after scripture mastery changes',()=>{
  const record=body(),battle=room(record,beast(7,5,'beast-1',9000));
  const original=cast(battle,record,'dragon-strike',{x:7,y:5});
  const stronger=structuredClone(record);
  stronger.books['body-rock']={exp:M.MAX_EXP};
  const changed=cast(battle,stronger,'dragon-strike',{x:7,y:5});
  assert.ok(changed.result.totalDamage>original.result.totalDamage);
  assert.ok(changed.members.a.dungeonAttack>original.members.a.dungeonAttack);
});

test('four-step shove follows four consecutive server-confirmed impacts, not a single push',()=>{
  const record=body(),initial=room(record,beast(6,5,'beast-1',10000));
  const out=cast(initial,record,'dragon-guard',{x:6,y:5});
  assert.equal(out.duplicate,false);
  assert.equal(out.result.cost,4);
  assert.equal(out.result.chainSteps.length,4);
  assert.equal(out.result.hits.length,4,'every stage punches the beast again');
  assert.equal(out.result.visualMoves.length,1,'final displacement is still a summary');
  assert.equal(out.result.chainSteps.every(s=>s.hits.length===1),true);
  assert.deepStrictEqual(out.result.chainSteps.map(s=>s.origin.x),[5,6,7,8]);
  assert.deepStrictEqual(out.result.chainSteps.map(s=>s.position.x),[6,7,8,9]);
  assert.deepStrictEqual(out.result.chainSteps.map(s=>s.visualMoves[0].to.x),
    [7,8,9,10]);
  assert.deepStrictEqual(out.members.a.position,{x:9,y:5});
  assert.deepStrictEqual(out.enemies[0].position,{x:10,y:5});
  assert.equal(initial.members.a.position.x,5,'casting must remain pure');
  const again=cast(next(initial,out),record,'dragon-guard',{x:10,y:5},2);
  assert.equal(again.result.chainSteps.length,4,'no per-skill cooldown or one-use limit');
  assert.deepStrictEqual(again.members.a.position,{x:13,y:5});
  assert.deepStrictEqual(again.enemies[0].position,{x:14,y:5});
});
test('a lethal first punch cannot leave a phantom corpse blocking the rest of the combo',()=>{
  const record=body(),initial=room(record,beast(6,5,'beast-1',1));
  const out=cast(initial,record,'dragon-guard',{x:6,y:5});
  assert.equal(out.result.hits.length,1,'the enemy died on the first punch');
  assert.equal(out.result.chainSteps.length,4);
  assert.deepStrictEqual(out.result.chainSteps.map(s=>s.position.x),[6,7,8,9]);
  assert.deepStrictEqual(out.members.a.position,{x:9,y:5});
  assert.equal(out.enemies.length,0);
  assert.deepStrictEqual(out.result.chainSteps[0].hits.map(h=>h.defeated),[true]);
  assert.equal(out.result.chainSteps.slice(1).every(s=>s.hits.length===0),true);
});
test('live blocker or wall stops the combo without sliding through occupied cells',()=>{
  const record=body(),initial=room(record,beast(6,5,'beast-1',10000));
  const wall=structuredClone(map);wall.tiles[5*16+8]=0;
  const blocked=S.castSkill(initial,'a',wall,record,{
    skillId:'dragon-guard',target:{x:6,y:5},seq:1});
  assert.equal(blocked.result.chainSteps.length,2);
  assert.equal(blocked.result.chainSteps[1].position.x,6);
  assert.deepStrictEqual(blocked.enemies[0].position,{x:7,y:5});
  assert.ok(blocked.result.chainSteps[1].hits.length>=2,
    'blocked push triggers collision damage');
  const withTeammate=structuredClone(initial);
  withTeammate.members.b={uid:'b',position:{x:8,y:5},
    battleHealth:100,downed:false};
  const teammate=cast(withTeammate,record,'dragon-guard',{x:6,y:5});
  assert.equal(teammate.result.chainSteps.length,2);
  assert.deepStrictEqual(teammate.members.a.position,{x:6,y:5});
  assert.deepStrictEqual(teammate.members.b.position,{x:8,y:5});
});

test('a real four-step shove advances four tiles across an empty corridor',()=>{
  const record=body(),initial=room(record,beast(10,10));
  // The only enemy is well away from the empty attack direction.
  const out=cast(initial,record,'dragon-guard',{x:6,y:5});
  assert.equal(out.result.chainSteps.length,4);
  assert.deepStrictEqual(out.result.chainSteps.map(p=>p.position),
    [{x:6,y:5},{x:7,y:5},{x:8,y:5},{x:9,y:5}]);
  assert.deepStrictEqual(out.members.a.position,{x:9,y:5});
  assert.equal(out.result.hits.length,0);
  assert.equal(out.members.a.explorationStamina,6);
  assert.equal(out.enemies[0].position.x,10);
});


test('independent flying-sword movement costs half the even shortest path and credits a single hit',()=>{
  const record=sword(),initial=room(record,beast(7,5,'beast-1',600));
  const enabled=S.switchLoadout(initial,'a',record,2);
  let state={...initial,members:enabled.members};
  const summoned=cast(state,record,'flight-summon',{x:6,y:5});
  assert.equal(summoned.members.a.explorationStamina,7);
  state=next(state,summoned);
  const moved=S.castSkill(state,'a',map,record,{
    skillId:'flight-summon',target:{x:8,y:5},seq:2,moveSword:true
  });
  assert.equal(moved.result.moveSword,true);
  assert.equal(moved.result.cost,1);
  assert.equal(moved.members.a.explorationStamina,6);
  assert.deepStrictEqual(moved.members.a.position,{x:5,y:5});
  assert.deepStrictEqual(moved.members.a.flyingSword,{x:8,y:5});
  assert.equal(moved.result.hits.filter(hit=>hit.enemyId==='beast-1').length,1);
  assert.ok(moved.result.totalDamage>0);
  const retry=S.castSkill(next(state,moved),'a',map,record,{
    skillId:'flight-summon',target:{x:8,y:5},seq:2,moveSword:true
  });
  assert.equal(retry.duplicate,true);
  assert.throws(()=>S.castSkill(state,'a',map,record,{
    skillId:'flight-summon',target:{x:6,y:6},seq:2,moveSword:true
  }),/偶數格/);
});
test('dungeon sword movement remains available after switching loadouts',()=>{
  const record=sword(),initial=room(record,beast(9,9));
  const switched=S.switchLoadout(initial,'a',record,2);
  let state={...initial,members:switched.members};
  const summoned=cast(state,record,'flight-summon',{x:6,y:5});
  state=next(state,summoned);
  const swapped=S.switchLoadout(state,'a',record,0);
  state={...state,members:swapped.members};
  assert.ok(!state.members.a.dungeonSkillIds.includes('flight-summon'));
  const moved=S.castSkill(state,'a',map,record,{
    skillId:'flight-summon',target:{x:8,y:5},seq:2,moveSword:true
  });
  assert.deepStrictEqual(moved.members.a.flyingSword,{x:8,y:5});
  assert.equal(moved.result.cost,1);
});

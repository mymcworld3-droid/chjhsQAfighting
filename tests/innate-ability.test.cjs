'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Innate=require('../public/cultivation/innate-ability.js');
const Growth=require('../public/cultivation/nascent-growth.js');
const Access=require('../public/cultivation/training-access-rules.js');
const Combo=require('../public/cultivation/combat-combo.js');
const Talents=require('../public/cultivation/soul-talents.js');
const Raid=require('../raid-authority.cjs');
const read=name=>fs.readFileSync(require('node:path').join(__dirname,'..',name),'utf8');
const clean=source=>source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
function account(type='ocean',branch=Innate.branches(type)[0].id,rank=10) {
  return {stats:{totalScore:188,attack:200,maxHp:3000},cultivationTraining:{coreEnabled:true,equippedCore:{type,grade:9,createdAt:10}},
    nascentSoulGrowth:{version:1,branches:{}},materialSystem:{inventory:{[Growth.ITEM_ID]:1000}},
    innateAbilityGrowth:{version:1,paths:{[type]:{branch,level:rank}}}};
}
function fighter(type,branch,extra={}) {
  return {...Raid.trustedRaidPlayerSnapshot(account(type,branch),'h'),hp:1200,...extra};
}
function advance(p,correct) {return {...p,innateAbilityState:Innate.advance(p,correct)};}
function engine() {
  const context={window:{},QAInnateAbility:Innate,QACombatCombo:Combo,QASoulTalents:Talents};
  vm.createContext(context);
  vm.runInContext(clean(read('public/cultivation/artifact-battle-effects.js')),context);
  vm.runInContext(clean(read('public/cultivation/battle-engine-v2.js'))+'\nthis.settle=settleBattleRound;',context);
  return context;
}
function duel(host,guest,extra={}) {
  const e=engine();
  return e.settle({roomId:'divine-test',round:1,host:{answer:{correct:true,atMs:10},...host},
    guest:{uid:'g',totalScore:68,hp:3000,maxHp:3000,atk:200,answer:{correct:false,atMs:20},...guest},
    resolveEquipmentHit:e.window.resolveArtifactBattleHit,resolveGuardedFollowup:e.window.resolveArtifactGuardedFollowup,
    resolveTalentDefense:e.window.resolveArtifactBattleDefense,...extra});
}
test('all nine cores have two exclusive ten-rank variations and awakening is free at Huashen',()=>{
  assert.equal(Object.keys(Innate.TYPES).length,9);
  for(const type of Object.keys(Innate.TYPES)) {
    assert.equal(Innate.branches(type).length,2);
    const p=account(type);delete p.innateAbilityGrowth;
    p.stats.totalScore=187;assert.equal(Innate.select(p,Innate.branches(type)[0].id).ok,false);
    p.stats.totalScore=188;
    const chosen=Innate.select(p,Innate.branches(type)[0].id);Innate.apply(p,chosen);
    assert.equal(Innate.snapshot(p).level,1);assert.equal(p.materialSystem.inventory[Growth.ITEM_ID],1000);
    assert.equal(Object.keys(chosen.growth.paths).length,1);
  }
});
test('ranks consume 4 through 20 fragments exactly, cap at ten, and switching retains rank',()=>{
  const p=account('ocean','tide',1);
  for(let n=2;n<=10;n++) {const next=Innate.upgrade(p);assert.equal(next.cost,2*n);Innate.apply(p,next);}
  assert.equal(p.materialSystem.inventory[Growth.ITEM_ID],892);
  assert.equal(Innate.upgrade(p).ok,false);
  Innate.apply(p,Innate.select(p,'surge'));
  assert.equal(Innate.snapshot(p).level,10);assert.equal(Innate.snapshot(p).branch,'surge');
  assert.equal(p.materialSystem.inventory[Growth.ITEM_ID],892);
  p.cultivationTraining.equippedCore.type='sword';assert.equal(Innate.snapshot(p),null);
  Innate.apply(p,Innate.select(p,'unity'));assert.equal(Innate.snapshot(p).level,1);
  p.cultivationTraining.equippedCore.type='ocean';assert.equal(Innate.snapshot(p).level,10);
  assert.equal(Innate.snapshot(p).branch,'surge');
});
test('insufficient resources, disabled cores and forged/mismatched powers do not grant effects',()=>{
  const p=account('ocean','tide',1);p.materialSystem.inventory[Growth.ITEM_ID]=3;
  assert.equal(Innate.upgrade(p).ok,false);assert.equal(p.innateAbilityGrowth.paths.ocean.level,1);
  p.cultivationTraining.coreEnabled=false;assert.equal(Innate.snapshot(p),null);
  const f=fighter('ocean','tide');
  assert.equal(Innate.active({...f,goldenCore:{type:'sword'}}),null);
  assert.equal(Innate.active({...f,totalScore:187,trainingAccessScore:187}),null);
  assert.equal(Innate.active({...f,innateAbility:{...f.innateAbility,branch:'bad'}}),null);
  assert.equal(Innate.normalize({version:1,paths:{ocean:{branch:'tide',level:999}}}).paths.ocean.level,10);
  assert.deepEqual(Innate.normalize({version:1,paths:{ocean:{branch:'bad',level:10}}}).paths,{});
  p.cultivationTraining.coreEnabled=true;p.trainingAccess={version:1,highestRealmScore:188};p.stats.totalScore=187;
  assert.equal(Innate.snapshot(p).level,1);
});
test('browser and Node share identical ranks, previews and snapshots',()=>{
  const context={QANascentGrowth:Growth,QATrainingAccessRules:Access};vm.createContext(context);
  vm.runInContext(read('public/cultivation/innate-ability.js'),context);
  for(const type of Object.keys(Innate.TYPES))for(const branch of Innate.branches(type))for(let n=1;n<=10;n++) {
    const p=account(type,branch.id,n);
    assert.equal(JSON.stringify(context.QAInnateAbility.snapshot(p)),JSON.stringify(Innate.snapshot(p)));
    assert.equal(context.QAInnateAbility.branches(type).find(x=>x.id===branch.id).describe(n),branch.describe(n));
  }
});
test('offensive variations respect HP boundaries, alternating answers, streaks and independent counters',()=>{
  const target={hp:600,maxHp:1000};
  assert.equal(Innate.attack(advance(fighter('ocean','tide'),true),target).normal,40);
  assert.equal(Innate.attack(advance(fighter('ocean','tide'),true),{hp:599,maxHp:1000}).normal,0);
  assert.equal(Innate.attack(advance(fighter('pojing','execute'),true),{hp:500,maxHp:1000}).normal,50);
  assert.equal(Innate.attack(advance(fighter('reverse','defy',{hp:1500}),true),target).normal,60);
  for(const [type,branch,every,damage] of [['ocean','surge',3,120],['pojing','momentum',3,150],['xingchen','meteor',3,180],['sword','pursuit',2,80]]) {
    let p=fighter(type,branch);
    for(let i=1;i<=every;i++){p=advance(p,true);assert.equal(Innate.attack(p,target).normal,i===every?damage:0);if(i<every)p=advance(p,false);}
  }
  let focus=fighter('ningxin','focus');focus=advance(advance(focus,true),true);
  assert.equal(Innate.attack(focus,target).normal,80);
  focus=advance(advance(focus,false),true);assert.equal(Innate.attack(focus,target).normal,0);
  assert.equal(Innate.attack(advance(fighter('wugou','clarity'),true),target).trueDamage,8);
  assert.equal(Innate.attack(advance(fighter('sword','unity'),true),target).normal,30);
});
test('healing variations clamp to missing HP and never heal a dead player',()=>{
  assert.equal(Innate.healingOnAnswer(advance(fighter('taichu','renew'),true)),30);
  assert.equal(Innate.healingOnAnswer(advance(fighter('reverse','balance'),true)),90);
  assert.equal(Innate.healingOnAnswer(advance(fighter('sword','unity'),true)),10);
  let calm=fighter('ningxin','calm');assert.equal(Innate.healingOnAnswer(advance(calm,true)),0);
  calm=advance(advance(calm,false),true);assert.equal(Innate.healingOnAnswer(calm),60);
  let moon=fighter('xingchen','moon');for(const correct of [true,true,false])moon=advance(moon,correct);
  assert.equal(Innate.healingOnAnswer(moon),60);
  let pure=fighter('wugou','purify');for(let i=0;i<3;i++)pure=advance(pure,true);
  assert.equal(Innate.healingOnAnswer(pure),90);
  let thunder=fighter('thunder','nourish');for(const correct of [true,false,true])thunder=advance(thunder,correct);
  assert.equal(Innate.healingOnAnswer(thunder),60);
  assert.equal(Innate.healingOnAnswer(advance(fighter('taichu','renew',{hp:2999}),true)),1);
  assert.equal(Innate.healingOnAnswer(advance(fighter('taichu','renew',{hp:0}),true)),0);
});
test('all eighteen powers are completely suppressed against golden core and below, including without a nascent snapshot',()=>{
  for(const type of Object.keys(Innate.TYPES))for(const branch of Innate.branches(type))for(const score of [0,27,28,67]) {
    let host=fighter(type,branch.id);host=advance(advance(host,false),true);
    host.innateAbilityState={...host.innateAbilityState,correctCount:2,streak:2};host.nascentSoul=null;
    const powered=duel(host,{totalScore:score,answer:{correct:true,atMs:20}});
    const baseline=duel({...host,innateAbility:null},{totalScore:score,answer:{correct:true,atMs:20}});
    assert.equal(powered.hostHp,baseline.hostHp,`${type}/${branch.id} heal/reflect/leech at ${score}`);
    assert.equal(powered.guestHp,baseline.guestHp,`${type}/${branch.id} damage at ${score}`);
    assert.equal(powered.hostInnateAbilityState,null);
    assert.ok(!powered.activations.some(x=>x.type==='innate-ability'));
  }
  for(const score of [68,187,188]) {
    const h=fighter('ocean','tide');h.nascentSoul=null;
    assert.equal(duel(h,{totalScore:score}).guestHp,duel({...h,innateAbility:null},{totalScore:score}).guestHp-40);
  }
});
test('PvP retries replay exactly, persist counters across rounds, and never advance input state',()=>{
  const h=fighter('xingchen','meteor');h.nascentSoul=null;
  const before=JSON.stringify(h),first=duel(h,{}),retry=duel(h,{});
  assert.equal(JSON.stringify(first),JSON.stringify(retry));assert.equal(JSON.stringify(h),before);
  const second=duel({...h,innateAbilityState:first.hostInnateAbilityState},{},{round:2});
  const third=duel({...h,innateAbilityState:second.hostInnateAbilityState},{},{round:3});
  assert.equal(third.guestHp,second.guestHp-180);
  assert.equal(third.hostInnateAbilityState.correctCount,3);
  assert.ok(third.steps.some(x=>x.skill?.includes('三星聚曜')));
});
test('WuGou innate light passes Dao shield while normal divine pursuit uses artifact defense',()=>{
  const p=account('wugou','clarity');p.cultivationTraining.equippedCore.grade=1;p.nascentSoulGrowth.branches.core=10;
  const host=Raid.trustedRaidPlayerSnapshot(p,'h');
  const shielded=duel(host,{coreShield:true,goldenCore:{type:'ningxin',grade:9}});
  assert.equal(shielded.guestHp,2920); // 72 nascent + 8 innate; no new >80 flat true-damage supply.
  const h=fighter('ocean','tide');h.nascentSoul=null;
  const defended=duel(h,{artifactBattle:{effects:[{type:'equip_damage_reduction_percent',value:.5}]}});
  const base=duel({...h,innateAbility:null},{artifactBattle:{effects:[{type:'equip_damage_reduction_percent',value:.5}]}});
  assert.equal(base.guestHp-defended.guestHp,20);
});
test('raid snapshots trust saved core and power; retries and boss actions do not duplicate charge or reflection windows',()=>{
  const h=fighter('thunder','rebound');h.goldenCore={type:'thunder',grade:9};h.nascentSoul=null;
  const old=JSON.stringify(h);
  const a=Raid.resolvePlayerAction(h,{roomId:'r',actionId:1,correct:true,bossHp:5000,bossMaxHp:5000});
  assert.equal(JSON.stringify(a),JSON.stringify(Raid.resolvePlayerAction(h,{roomId:'r',actionId:1,correct:true,bossHp:5000,bossMaxHp:5000})));
  assert.equal(JSON.stringify(h),old);
  a.member.thunderCounterReady=false;
  const defended=Raid.resolveBossDefense(a.member,{bossAction:{damage:100}});
  assert.equal(defended.reflectedDamage,20);
  const twice=Raid.resolveBossDefense(defended.member,{bossAction:{damage:100}});
  assert.equal(twice.reflectedDamage,0);
  assert.equal(defended.member.innateAbilityState.correct,true);
  const guard=Raid.resolveBossDefense({...a.member,coreShield:true},{bossAction:{damage:100}});
  assert.equal(guard.reflectedDamage,0);assert.equal(guard.member.innateAbilityState.reflectReady,false);
  const bad=account('ocean','tide');bad.cultivationTraining.equippedCore.type='sword';
  assert.equal(Raid.trustedRaidPlayerSnapshot(bad,'h').innateAbility,null);
});
test('raid and PvP produce the same independent divine strike and actual-damage leech',()=>{
  for(const [type,branch] of [['ocean','tide'],['sword','unity'],['wugou','clarity'],['taichu','devour']]) {
    const h=fighter(type,branch);h.nascentSoul=null;
    const a=Raid.resolvePlayerAction(h,{roomId:'divine-test',actionId:1,correct:true,bossHp:3000,bossMaxHp:3000});
    const baseRaid=Raid.resolvePlayerAction({...h,innateAbility:null},{roomId:'divine-test',actionId:1,correct:true,bossHp:3000,bossMaxHp:3000});
    const pvp=duel(h,{});
    const basePvp=duel({...h,innateAbility:null},{});
    assert.equal(basePvp.guestHp-pvp.guestHp,a.damage-baseRaid.damage,`${type} divine damage`);
    assert.equal(pvp.hostHp-basePvp.hostHp,a.member.hp-baseRaid.member.hp,`${type} divine HP`);
  }
});

function uiRuntime({fail=false,retry=false,changedCore=false}={}) {
  const remote=account('ocean','tide',1),local=structuredClone(remote),writes=[],messages=[];
  const source=read('public/cultivation/cultivation-training-v4.js');
  const start=source.indexOf('  async function saveInnateAbility('),end=source.indexOf('  function nascentSoulTabMarkup',start);
  const ctx={Innate,innateBusy:false,soulBusy:false,busy:false,state:structuredClone(remote.cultivationTraining),
    getApp:()=>({}),getAuth:()=>({currentUser:{uid:'h'}}),getFirestore:()=>({}),doc:()=>({}),
    sameGoldenCore:(a,b)=>a?.type===b?.type&&a?.grade===b?.grade&&a?.createdAt===b?.createdAt,
    renderTrainingPage(){},toast:m=>messages.push(m),CustomEvent:class{},
    window:{getCurrentUserData:()=>local,dispatchEvent(){}},
    async runTransaction(_,worker) {
      let pending=[];
      const tx={get:async()=>({exists:()=>true,data:()=>structuredClone(remote)}),update:(_,patch)=>pending.push(patch)};
      if(retry){await worker(tx);pending=[];Innate.apply(remote,Innate.upgrade(remote));}
      if(changedCore)remote.cultivationTraining.equippedCore.type='sword';
      const result=await worker(tx);if(fail)throw Error('offline');
      for(const patch of pending){writes.push(patch);for(const [key,value] of Object.entries(patch)) {
        const parts=key.split('.');let current=remote;for(const part of parts.slice(0,-1))current=current[part]||={};
        current[parts.at(-1)]=value;
      }}return result;
    }};
  vm.createContext(ctx);vm.runInContext(source.slice(start,end)+'\nthis.save=saveInnateAbility;',ctx);
  return {ctx,remote,local,writes,messages};
}
test('the actual training markup offers two choices, rank previews, disabled upgrades and the duel seal rule',()=>{
  const source=read('public/cultivation/cultivation-training-v4.js');
  const start=source.indexOf('  function innateAbilityMarkup('),end=source.indexOf('  async function saveInnateAbility',start);
  const ctx={Innate,innateBusy:false,soulBusy:false,busy:false};vm.createContext(ctx);
  vm.runInContext(source.slice(start,end),ctx);
  const p=account('sword','unity',4);
  let markup=ctx.innateAbilityMarkup(p);
  assert.equal((markup.match(/data-ia-select=/g)||[]).length,2);
  assert.equal((markup.match(/is-selected/g)||[]).length,1);
  assert.match(markup,/4 \/ 10 階/);assert.match(markup,/升至 5 階需 10 元嬰碎精/);
  assert.match(markup,/下一階/);assert.match(markup,/對戰金丹期及以下修士時，神通全部封印/);
  p.materialSystem.inventory[Growth.ITEM_ID]=0;
  assert.match(ctx.innateAbilityMarkup(p),/data-ia-upgrade disabled>碎精不足/);
  p.innateAbilityGrowth.paths.sword.level=10;
  markup=ctx.innateAbilityMarkup(p);assert.match(markup,/十階圓滿/);assert.doesNotMatch(markup,/下一階/);
  p.stats.totalScore=187;assert.equal(ctx.innateAbilityMarkup(p),'');
});
test('UI transactions serialize double taps, recompute costs after retry and do not spend on failure or changed core',async()=>{
  const r=uiRuntime({retry:true});await Promise.all([r.ctx.save(),r.ctx.save()]);
  assert.equal(r.writes.length,1);assert.equal(r.remote.innateAbilityGrowth.paths.ocean.level,3);
  assert.equal(r.local.materialSystem.inventory[Growth.ITEM_ID],990);
  for(const options of [{fail:true},{changedCore:true}]) {
    const bad=uiRuntime(options);await bad.ctx.save();
    assert.equal(bad.writes.length,0);assert.equal(bad.local.materialSystem.inventory[Growth.ITEM_ID],1000);
    assert.equal(bad.local.innateAbilityGrowth.paths.ocean.level,1);assert.match(bad.messages[0],/未完成/);
  }
  const select=uiRuntime();await select.ctx.save('surge');
  assert.equal(select.remote.innateAbilityGrowth.paths.ocean.branch,'surge');
  assert.equal(select.local.materialSystem.inventory[Growth.ITEM_ID],1000);
});

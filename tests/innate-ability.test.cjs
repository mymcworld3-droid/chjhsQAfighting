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
  return {...Raid.trustedRaidPlayerSnapshot(account(type,branch),'h'),maxHp:3000,hp:1200,...extra};
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
    resolveTalentDefense:e.window.resolveArtifactBattleDefense,resolveGuardAbsorption:e.window.resolveArtifactGuardAbsorption,...extra});
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
test('ranks consume 2 through 10 fragments exactly, cap at ten, and switching retains rank',()=>{
  const p=account('ocean','tide',1);
  for(let n=2;n<=10;n++) {const next=Innate.upgrade(p);assert.equal(next.cost,n);Innate.apply(p,next);}
  assert.equal(p.materialSystem.inventory[Growth.ITEM_ID],946);
  assert.equal(Innate.upgrade(p).ok,false);
  Innate.apply(p,Innate.select(p,'surge'));
  assert.equal(Innate.snapshot(p).level,10);assert.equal(Innate.snapshot(p).branch,'surge');
  assert.equal(p.materialSystem.inventory[Growth.ITEM_ID],946);
  p.cultivationTraining.equippedCore.type='sword';assert.equal(Innate.snapshot(p),null);
  Innate.apply(p,Innate.select(p,'unity'));assert.equal(Innate.snapshot(p).level,1);
  p.cultivationTraining.equippedCore.type='ocean';assert.equal(Innate.snapshot(p).level,10);
  assert.equal(Innate.snapshot(p).branch,'surge');
});
test('insufficient resources, disabled cores and forged/mismatched powers do not grant effects',()=>{
  const p=account('ocean','tide',1);p.materialSystem.inventory[Growth.ITEM_ID]=1;
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
  assert.equal(Innate.attack(advance(fighter('ocean','tide'),true),target).normal,60);
  assert.equal(Innate.attack(advance(fighter('ocean','tide'),true),{hp:599,maxHp:1000}).normal,20);
  assert.equal(Innate.attack(advance(fighter('pojing','execute'),true),{hp:500,maxHp:1000}).normal,0);
  assert.equal(Innate.executeThreshold(fighter('pojing','execute')),.7);
  assert.equal(Innate.attack(advance(fighter('reverse','defy',{hp:1500}),true),target).normal,160);
  for(const [type,branch,every,damage] of [['ocean','surge',3,170],['pojing','momentum',3,120],['sword','pursuit',2,80]]) {
    let p=fighter(type,branch);
    for(let i=1;i<=every;i++){p=advance(p,true);assert.equal(Innate.attack(p,target).normal,i===every?damage:0);if(i<every)p=advance(p,false);}
  }
  let focus=fighter('ningxin','focus');focus=advance(advance(focus,true),true);
  assert.equal(Innate.attack(focus,target).normal,80);
  focus=advance(advance(focus,false),true);assert.equal(Innate.attack(focus,target).normal,0);
  assert.equal(Innate.attack(advance(fighter('wugou','clarity'),true),target).trueDamage,0);
  assert.equal(Innate.attack(advance(fighter('sword','unity'),true),target).normal,30);
});
test('healing variations clamp to missing HP and never heal a dead player',()=>{
  assert.equal(Innate.healingOnAnswer(advance(fighter('taichu','renew'),true)),150);
  assert.equal(Innate.healingOnAnswer(advance(fighter('reverse','balance'),true)),180);
  assert.equal(Innate.healingOnAnswer(advance(fighter('sword','unity'),true)),90);
  let calm=fighter('ningxin','calm');assert.equal(Innate.healingOnAnswer(advance(calm,true)),0);
  calm=advance(advance(calm,false),true);assert.equal(Innate.healingOnAnswer(calm),180);
  let moon=fighter('xingchen','moon');for(const correct of [true,true,false])moon=advance(moon,correct);
  assert.equal(Innate.healingOnAnswer(moon),60);
  let pure=fighter('wugou','purify');for(let i=0;i<2;i++)pure=advance(pure,true);
  assert.equal(Innate.healingOnAnswer(pure),180);
  let thunder=fighter('thunder','nourish');for(const correct of [true,false,true])thunder=advance(thunder,correct);
  assert.equal(Innate.healingOnAnswer(thunder),60);
  assert.equal(Innate.healingOnAnswer(advance(fighter('taichu','renew',{hp:2999}),true)),1);
  assert.equal(Innate.healingOnAnswer(advance(fighter('taichu','renew',{hp:0}),true)),0);
});
test('Yin-Yang low-HP damage reduction is shared across both paths, ranked and limited to normal hits',()=>{
  for(const branch of ['defy','balance']) {
    const h=fighter('reverse',branch,{hp:1200});h.nascentSoul=null;
    assert.equal(Innate.damageReduction(h),.25);
    assert.equal(Innate.damageReduction({...h,hp:1500}),.25);
    assert.equal(Innate.damageReduction({...h,hp:1501}),0);
    assert.equal(Innate.damageReduction({...h,innateAbility:{...h.innateAbility,level:5}}),.125);
    assert.equal(Innate.damageReduction({...h,hp:0}),0);
    const safe=duel({...h,answer:{correct:false,atMs:10}},{answer:{correct:true,atMs:20}});
    const base=duel({...h,innateAbility:null,answer:{correct:false,atMs:10}},{answer:{correct:true,atMs:20}});
    assert.equal(safe.hostHp-base.hostHp,50,'normal PvP damage mitigated 25%');
    const boss=Raid.resolveBossDefense(h,{bossAction:{damage:200}});
    const baseline=Raid.resolveBossDefense({...h,innateAbility:null},{bossAction:{damage:200}});
    assert.equal(boss.member.hp-baseline.member.hp,50,'normal raid damage mitigated 25%');
    const trueBoss=Raid.resolveBossDefense(h,{bossAction:{damage:200,trueDamage:200}});
    assert.equal(trueBoss.member.hp,baseline.member.hp,'raid true damage bypasses new mitigation');
  }
  assert.equal(Innate.damageReduction(fighter('ocean','tide',{hp:1200})),0);
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
    assert.equal(duel(h,{totalScore:score}).guestHp,duel({...h,innateAbility:null},{totalScore:score}).guestHp-60);
  }
});
test('PvP retries replay exactly, persist counters across rounds, and never advance input state',()=>{
  const h=fighter('xingchen','meteor');h.nascentSoul=null;
  const before=JSON.stringify(h),first=duel(h,{}),retry=duel(h,{});
  assert.equal(JSON.stringify(first),JSON.stringify(retry));assert.equal(JSON.stringify(h),before);
  const second=duel({...h,innateAbilityState:first.hostInnateAbilityState},{},{round:2});
  const third=duel({...h,innateAbilityState:second.hostInnateAbilityState},{},{round:3});
  assert.equal(third.guestHp,second.guestHp-120);
  assert.equal(third.hostInnateAbilityState.correctCount,3);
  assert.ok(third.steps.some(x=>x.skill?.includes('三星聚曜')));
});
test('WuGou innate light passes Dao shield while normal divine pursuit uses artifact defense',()=>{
  const p=account('wugou','clarity');p.cultivationTraining.equippedCore.grade=1;p.nascentSoulGrowth.branches.core=10;
  const host=Raid.trustedRaidPlayerSnapshot(p,'h');
  const shielded=duel(host,{coreShield:true,goldenCore:{type:'ningxin',grade:9}});
  assert.equal(shielded.guestHp,2928); // Existing nascent true damage remains; no innate flat true damage.
  const h=fighter('ocean','tide');h.nascentSoul=null;
  const defended=duel(h,{artifactBattle:{effects:[{type:'equip_damage_reduction_percent',value:.5}]}});
  const base=duel({...h,innateAbility:null},{artifactBattle:{effects:[{type:'equip_damage_reduction_percent',value:.5}]}});
  assert.equal(base.guestHp-defended.guestHp,30);
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
test('raid and PvP produce the same independent divine strike and recovery',()=>{
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
  const ctx={Innate,soulView:{selected:null,choosing:false},innateBusy:false,soulBusy:false,busy:false,state:structuredClone(remote.cultivationTraining),
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
  const start=source.indexOf('  function innateBranchIcon('),end=source.indexOf('  async function saveInnateAbility',start);
  const ctx={Innate,soulView:{selected:'innate',choosing:true},innateBusy:false,soulBusy:false,busy:false};vm.createContext(ctx);
  vm.runInContext(source.slice(start,end),ctx);
  const p=account('sword','unity',4);
  let markup=ctx.innateAbilityMarkup(p);
  assert.equal((markup.match(/data-ia-select=/g)||[]).length,2);
  assert.equal((markup.match(/is-selected/g)||[]).length,1);
  assert.match(markup,/選擇元神分支/);assert.doesNotMatch(markup,/data-ia-upgrade/);
  ctx.soulView.choosing=false;
  markup=ctx.innateAbilityMarkup(p);
  assert.doesNotMatch(markup,/data-ia-select=/);assert.match(markup,/data-ia-reselect/);
  assert.match(markup,/4 \/ 10 階/);assert.match(markup,/升至 5 階需 5 元嬰碎精/);
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
  assert.equal(r.local.materialSystem.inventory[Growth.ITEM_ID],995);
  for(const options of [{fail:true},{changedCore:true}]) {
    const bad=uiRuntime(options);await bad.ctx.save();
    assert.equal(bad.writes.length,0);assert.equal(bad.local.materialSystem.inventory[Growth.ITEM_ID],1000);
    assert.equal(bad.local.innateAbilityGrowth.paths.ocean.level,1);assert.match(bad.messages[0],/未完成/);
  }
  const select=uiRuntime();await select.ctx.save('surge');
  assert.equal(select.remote.innateAbilityGrowth.paths.ocean.branch,'surge');
  assert.equal(select.local.materialSystem.inventory[Growth.ITEM_ID],1000);
});

test('updated healing percentages, conversion and execution threshold scale across all ten ranks',()=>{
  for(let rank=1;rank<=10;rank++) {
    const ready=(type,branch)=>advance({...fighter(type,branch),innateAbility:{version:1,type,branch,level:rank}},true);
    assert.equal(Innate.healingOnAnswer(ready('taichu','renew')),15*rank);
    const calm=ready('ningxin','calm');calm.innateAbilityState.previousWrong=true;
    assert.equal(Innate.healingOnAnswer(calm),18*rank);
    assert.equal(Innate.healingDamage(ready('taichu','devour'),200),6*rank);
    assert.equal(Innate.executeThreshold(ready('pojing','execute')),(50+2*rank)/100);
  }
});
function healingFighter(extra={}) {
  const p=account('taichu','devour');p.cultivationTraining.equippedCore.grade=1;p.nascentSoulGrowth.branches.core=10;
  return {...Raid.trustedRaidPlayerSnapshot(p,'h'),maxHp:3000,hp:1200,...extra};
}
test('Guiyuan converts actual soul and artifact healing into a separate nonrecursive true strike',()=>{
  for(const [hp,life,expectedHeal,expectedTrue] of [[1200,0,100,30],[2990,0,10,3],[3000,0,0,0],[1200,.1,120,36]]) {
    const h=healingFighter({hp,artifactBattle:{effects:life?[{type:'equip_lifesteal_percent',value:life}]:[]}});
    const pvp=duel(h,{}),raid=Raid.resolvePlayerAction(h,{roomId:'heal',actionId:1,correct:true,bossHp:3000,bossMaxHp:3000});
    assert.equal(pvp.hostHp,hp+expectedHeal);assert.equal(pvp.guestHp,3000-200-expectedTrue);
    assert.equal(raid.member.hp,hp+expectedHeal);assert.equal(raid.healed,expectedHeal);
    assert.equal(raid.healingDamage,expectedTrue);assert.equal(raid.damage,200+expectedTrue);
    assert.equal(pvp.steps.filter(x=>x.innateEffect==='vital-orb').reduce((n,x)=>n+x.damage,0),expectedTrue);
    assert.equal(raid.innateEffects.filter(x=>x.kind==='vital-orb').length,expectedTrue?1:0);
  }
});
test('Guiyuan support healing bypasses Dao shield, respects artifact shields and never consumes Dao shield itself',()=>{
  const h=healingFighter({hp:2990,coreCorrectStreak:1});
  const pvp=duel(h,{coreShield:true,goldenCore:{type:'ningxin',grade:9}});
  assert.equal(pvp.guestHp,2997);assert.equal(pvp.hostHp,3000);
  assert.equal(pvp.steps[0].innateEffect,'vital-orb');assert.equal(pvp.steps[0].damage,3);
  assert.ok(pvp.steps.some(x=>x.guarded&&x.damage===0));
  const barrier=duel(h,{coreShield:true,goldenCore:{type:'ningxin',grade:9},artifactShield:100});
  assert.equal(barrier.guestHp,3000);assert.equal(barrier.guestArtifactState.artifactShield,97);
});
test('healing after reflected damage converts once and raid clock applies it without counting it as reflection',()=>{
  const h=healingFighter({artifactBattle:{effects:[{type:'equip_reflect_percent',value:.5}]},
    answer:{correct:false,atMs:20}});
  const pvp=duel(h,{answer:{correct:true,atMs:10}});
  assert.equal(pvp.hostHp,1050);assert.equal(pvp.guestHp,2885);
  const defended=Raid.resolveBossDefense(h,{bossAction:{damage:200},bossHp:3000});
  assert.equal(defended.member.hp,1050);assert.equal(defended.reflectedDamage,100);
  assert.equal(defended.healingDamage,15);assert.equal(defended.innateEffects[0].kind,'vital-orb');
  const {advanceRaidClock}=require('../raid-clock.cjs'),at=100000;
  const room={status:'active',hostUid:'h',startedAtMs:at,createdAtMs:at,bossHp:3000,bossMaxHp:3000,
    bossBaseAttack:200,bossActionCount:0,members:{h:{...h,online:true,alive:true,host:true,heartbeatAtMs:at,damage:0}}};
  const settled=advanceRaidClock(room,'heal-clock',at+18000),res=settled.members.h.lastBossResolution;
  assert.equal(settled.bossHp,3000-res.reflectedDamage-res.healingDamage);
  assert.equal(settled.members.h.damage,res.reflectedDamage+res.healingDamage);
  assert.equal(settled.members.h.combatContribution.reflectedDamage,res.reflectedDamage);
  assert.equal(JSON.stringify(settled),JSON.stringify(advanceRaidClock(room,'heal-clock',at+18000)));
});
test('healing conversion excludes overkill and is completely suppressed against golden core opponents',()=>{
  const h=healingFighter();
  const last=duel(h,{hp:50,maxHp:3000});assert.equal(last.hostHp,1225);
  assert.ok(!last.steps.some(x=>x.innateEffect==='vital-orb'));
  for(const score of [0,28,67]) {
    const pvp=duel(h,{totalScore:score});const base=duel({...h,innateAbility:null},{totalScore:score});
    assert.equal(pvp.hostHp,base.hostHp);assert.equal(pvp.guestHp,base.guestHp);
    assert.ok(!pvp.steps.some(x=>x.innateEffect));
  }
});
test('PoWang raises existing nascent execution threshold to 70% without adding a new damage bonus',()=>{
  const p=account('pojing','execute');p.nascentSoulGrowth.branches.core=10;
  const host=Raid.trustedRaidPlayerSnapshot(p,'h');
  for(const [hp,diff] of [[4900,0],[5000,0],[5100,95],[6000,95],[7000,95],[7001,0]]) {
    const withPower=duel(host,{hp,maxHp:10000}),without=duel({...host,innateAbility:null},{hp,maxHp:10000});
    assert.equal(without.guestHp-withPower.guestHp,diff,`PvP at ${hp}/10000`);
    const raid=Raid.resolvePlayerAction(host,{roomId:'gate',actionId:1,correct:true,bossHp:hp,bossMaxHp:10000});
    const base=Raid.resolvePlayerAction({...host,innateAbility:null},{roomId:'gate',actionId:1,correct:true,bossHp:hp,bossMaxHp:10000});
    assert.equal(raid.damage-base.damage,diff,`raid at ${hp}/10000`);
  }
});
test('triple barrier beam is attached only to the third accumulated correct strike and persists in raid resolution',()=>{
  let host=fighter('pojing','momentum');host.nascentSoul=null;
  host=advance(advance(host,true),false);host=advance(host,true);
  const out=duel(host,{});
  assert.equal(out.steps.filter(x=>x.innateEffect==='triple-beam').length,1);
  assert.equal(out.steps.find(x=>x.innateEffect==='triple-beam').damage,120);
  const raid=Raid.resolvePlayerAction(host,{roomId:'beam',actionId:3,correct:true,bossHp:3000,bossMaxHp:3000});
  assert.deepEqual(raid.innateEffects,[{kind:'triple-beam',damage:120}]);
  const wrong=duel({...host,answer:{correct:false,atMs:10}},{});
  assert.ok(!wrong.steps.some(x=>x.innateEffect==='triple-beam'));
});
function meteorFighter() {
  const p=account('xingchen','meteor');p.cultivationTraining.equippedCore.grade=1;p.nascentSoulGrowth.branches.core=10;
  let h=Raid.trustedRaidPlayerSnapshot(p,'h');h=advance(advance(h,true),true);
  return {...h,soulStarCorrectWindow:2,soulStarAnswerWindow:2,answer:{correct:false,atMs:10}};
}
test('each meteor settles separately, including a third wrong answer, consuming only one Dao shield per hit',()=>{
  const h=meteorFighter(),out=duel(h,{coreShield:true,goldenCore:{type:'ningxin',grade:9}},{round:3});
  const hits=out.steps.filter(x=>x.innateEffect==='meteor');
  assert.deepEqual(Array.from(hits,x=>x.damage),[0,100,120]);
  assert.deepEqual(Array.from(hits,x=>x.guestHp),[3000,2900,2780]);
  assert.equal(out.guestCoreShield,false);assert.equal(hits.at(-1).meteorCount,3);
  assert.equal(hits.at(-1).skill.includes('三星聚曜'),true);
  const lethal=duel(h,{hp:20,maxHp:3000},{round:3});
  assert.equal(lethal.steps.filter(x=>x.innateEffect==='meteor').length,1);
  assert.equal(lethal.guestHp,0);
});
test('raid meteors carry separate HP snapshots, replay identically and award the additional stone even with zero correct',()=>{
  const h=meteorFighter(),before=JSON.stringify(h);
  const input={roomId:'stones',actionId:3,correct:false,bossHp:3000,bossMaxHp:3000};
  const result=Raid.resolvePlayerAction(h,input);
  assert.deepEqual(result.meteorHits.map(x=>x.damage),[100,100,120]);
  assert.deepEqual(result.meteorHits.map(x=>[x.beforeHp,x.afterHp]),[[3000,2900],[2900,2800],[2800,2680]]);
  assert.equal(result.damage,320);assert.equal(JSON.stringify(h),before);
  assert.equal(JSON.stringify(result),JSON.stringify(Raid.resolvePlayerAction(h,input)));
  let wrong=fighter('xingchen','meteor');wrong=advance(advance(wrong,false),false);
  wrong.soulStarAnswerWindow=2;wrong.soulStarCorrectWindow=0;
  assert.deepEqual(Raid.resolvePlayerAction(wrong,input).meteorHits.map(x=>x.damage),[120]);
});
test('WuChen returns shield-absorbed normal damage as true damage, excluding incoming true damage and retaliation loops',()=>{
  const h=fighter('wugou','clarity',{coreShield:true,answer:{correct:false,atMs:20}});h.nascentSoul=null;
  const opponent={uid:'g',answer:{correct:true,atMs:10},artifactBattle:{effects:[
    {type:'equip_damage_percent',value:1},{type:'equip_true_damage_flat',value:80},{type:'equip_reflect_percent',value:1}]}};
  const out=duel(h,opponent);
  assert.equal(out.hostHp,1120);assert.equal(out.guestHp,2960);
  const light=out.steps.filter(x=>x.skill==='本命神通・無塵神光');
  assert.equal(light.length,1);assert.equal(light[0].damage,40);
  const raid=Raid.resolveBossDefense(h,{bossAction:{damage:200},bossHp:3000});
  assert.equal(raid.damage,0);assert.equal(raid.shieldDamage,20);assert.equal(raid.reflectedDamage,0);
  const suppressed=duel(h,{...opponent,totalScore:67});
  assert.ok(!suppressed.steps.some(x=>x.skill==='本命神通・無塵神光'));
});
test('new recovery branches retain exact rank scaling and two-correct streak cadence',()=>{
  for(let n=1;n<=10;n++) {
    const p=(type,branch)=>({...fighter(type,branch),innateAbility:{version:1,type,branch,level:n}});
    let pure=advance(p('wugou','purify'),true);assert.equal(Innate.healingOnAnswer(pure),0);
    pure=advance(pure,true);assert.equal(Innate.healingOnAnswer(pure),18*n);
    pure=advance(pure,true);assert.equal(Innate.healingOnAnswer(pure),0);
    pure=advance(advance(pure,false),true);assert.equal(Innate.healingOnAnswer(pure),0);
    assert.equal(Innate.healingOnAnswer(advance(p('reverse','balance'),true)),18*n);
    assert.equal(Innate.healingOnAnswer(advance(p('sword','unity'),true)),9*n);
    assert.equal(Innate.shieldDamage(p('wugou','clarity'),1000),10*n);
  }
});

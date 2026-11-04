'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const pool=require('../public/cultivation/soulbound-pool.js'),combo=require('../public/cultivation/combat-combo.js');
const generation=require('../artifact-generation-api.js'),raid=require('../raid-authority.cjs');
const read=file=>fs.readFileSync('public/cultivation/'+file,'utf8');
function catalog(){return vm.runInNewContext(read('artifact-catalog.js').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\n({normalizeArtifactDefinition});',{QASoulboundPool:pool});}
function resolver(){const ctx={window:{},QASoulboundPool:pool,QACombatCombo:combo};vm.runInNewContext(read('artifact-battle-effects.js').replace(/^import .*;\n/gm,''),ctx);return ctx.window;}
const effects=rows=>rows.map(([type,value])=>({type,value,soulbound:true}));
const player=list=>({uid:'u',atk:200,hp:1000,maxHp:1000,totalScore:10,artifactShield:0,coreCorrectStreak:0,artifactBattle:{effects:list}});

test('special affix ceilings use the 200 attack / 1000 HP combat scale, keeping the agreed flat attack and HP caps',()=>{
 const limits={equip_attack_flat:200,equip_hp_flat:800,equip_damage_reduction_flat:80,equip_shield_flat:400,
  equip_true_damage_flat:100,equip_on_correct_shield_flat:160,equip_attack_percent:.25,equip_hp_percent:.25,
  equip_damage_percent:.3,equip_streak_damage_percent:.75,equip_damage_reduction_percent:.25,
  equip_crit_chance:.2,equip_crit_damage_percent:.75,equip_combo_chance:.2,equip_combo_damage_percent:.5,
  equip_lifesteal_percent:.25,equip_reflect_percent:.35,equip_low_hp_damage_percent:.75,
  equip_low_hp_reduction_percent:.3,equip_first_hit_reduction_percent:.5,equip_damage_cap_percent:.65};
 assert.deepEqual(Object.fromEntries(Object.entries(pool.EFFECT_BOUNDS).map(([k,v])=>[k,v.max])),limits);
 assert.equal(pool.EFFECT_BOUNDS.equip_damage_cap_percent.min,.35);
});

test('old and current custom artifacts clamp without amplification, duplicate affixes, ownership changes or repeated migration',()=>{
 for(const version of [undefined,1,2]){
  const source={id:'owned-refined',equipSlot:'本命法寶',soulboundBalanceVersion:version,soulboundRefinementVersion:2,
   effects:[{type:'equip_attack_flat',value:50},{type:'equip_attack_flat',value:70},
    {type:'equip_damage_reduction_flat',value:800},{type:'equip_true_damage_flat',value:1500}]};
  const before=structuredClone(source),balanced=pool.balanceArtifact(source);
  assert.equal(balanced.id,source.id);assert.deepEqual(balanced.effects.map(e=>e.value),[70,80,100]);
  assert.deepEqual(source,before);assert.deepEqual(pool.balanceArtifact(balanced),balanced);
  const saved=JSON.parse(JSON.stringify(catalog().normalizeArtifactDefinition(balanced)));
  assert.deepEqual(JSON.parse(JSON.stringify(catalog().normalizeArtifactDefinition(saved))),saved);
 }
});

test('every original can complete two refinements even when every inherited affix rolls its maximum',()=>{
 for(const source of pool.ITEMS)for(const count of [2,8]){
  let previous=source;
  for(const stage of [2,3]){
   const result=generation.sanitizeGeneratedArtifact({name:'上限精煉',effects:previous.effects.map(e=>({...e,value:1e20}))},source.realm,stage,{}, {},count,{primaryArtifacts:[previous]});
   pool.assertRefinementImproves(result,[previous]);
   assert.equal(result.effects.length,3);
   for(const e of result.effects)assert.ok(e.value<=pool.EFFECT_BOUNDS[e.type].max,source.id+':'+e.type);
   previous={...result,id:'refined-'+source.id};
  }
 }
});

test('browser and authoritative raid stats agree after old percentage and duplicate attack inflation is removed',()=>{
 const item={id:'oversized-owned',name:'舊器',realm:'金丹',equipSlot:'本命法寶',soulboundBalanceVersion:1,
  effects:[{type:'equip_attack_flat',value:200},{type:'equip_attack_flat',value:200},
   {type:'equip_hp_flat',value:800},{type:'equip_attack_percent',value:2},{type:'equip_hp_percent',value:2}]};
 const user={stats:{totalScore:10,attack:200,maxHp:1000},artifactSystem:{inventory:{[item.id]:3},equipped:{本命法寶:item.id}}};
 const before=structuredClone(user),normalized=catalog().normalizeArtifactDefinition(item);
 const code=read('artifact-system.js'),start=code.indexOf('  function combatModifiers()'),end=code.indexOf('  function installCombatWrapper()',start);
 const context={equipmentEffects:()=>normalized.effects,activeBuffs:()=>[]};vm.runInNewContext(code.slice(start,end)+'\nthis.mod=combatModifiers();',context);
 const mod=context.mod,snapshot=raid.trustedRaidPlayerSnapshot(user,'u',{artifactCatalogSchemaVersion:2,items:[item]});
 assert.equal(snapshot.atk,500);assert.equal(snapshot.maxHp,2250);
 assert.equal(Math.round((200+mod.attackFlat)*mod.attackMultiplier),snapshot.atk);
 assert.equal(Math.round((1000+mod.hpFlat)*mod.hpMultiplier),snapshot.maxHp);
 assert.deepEqual(user,before);
});

test('copied soulbound effects cannot double true damage, shield gain or combo damage beyond their allowance',()=>{
 const api=resolver();
 const attacker=player(effects([['equip_true_damage_flat',100],['equip_copy_enemy_artifact',0]]));
 const defender=player(effects([['equip_true_damage_flat',100]]));
 assert.equal(api.resolveArtifactBattleAttack({attacker,defender,baseDamage:200}).trueDamage,100);
 assert.equal(pool.effectTotal(effects([['equip_on_correct_shield_flat',160],['equip_on_correct_shield_flat',160]]),'equip_on_correct_shield_flat'),160);
 assert.equal(combo.stats({},effects([['equip_combo_damage_percent',1.5],['equip_combo_damage_percent',1.5]])).multiplier,.8);
 assert.equal(combo.stats({},effects([['equip_combo_chance',.3],['equip_combo_chance',.3]])).chance,.2);
});

test('PvP and raid attacks cap old room true damage and repeat shields, retaining the normal streak bonus',()=>{
 const list=effects([['equip_true_damage_flat',1500],['equip_on_correct_shield_flat',1800],['equip_damage_percent',1.5],['equip_streak_damage_percent',2]]);
 const attacker=player(list);attacker.coreCorrectStreak=3;
 const hit=resolver().resolveArtifactBattleAttack({attacker,defender:player([]),baseDamage:200,seed:'balance'});
 assert.equal(hit.normalDamage,410);assert.equal(hit.trueDamage,100);assert.equal(hit.shieldGain,160);
 const member=player(list);member.coreCorrectStreak=2;
 const action=raid.resolvePlayerAction(member,{roomId:'balance',actionId:1,correct:true,bossHp:10000,bossMaxHp:10000});
 assert.equal(action.damage,510);assert.equal(action.member.artifactShield,160);
});

test('PvP and raid defenses preserve ordinary incoming damage instead of allowing flat reduction to erase every hit',()=>{
 const list=effects([['equip_damage_reduction_flat',800],['equip_damage_reduction_percent',.75],['equip_reflect_percent',1]]);
 const defense=resolver().resolveArtifactBattleDefense({defender:player(list),attacker:player([]),normalDamage:200,trueDamage:0});
 const boss=raid.resolveBossDefense(player(list),{roomId:'balance',bossAction:{id:1,damage:200}});
 assert.equal(defense.hpDamage,70);assert.equal(defense.reflectDamage,25);
 assert.equal(boss.damage,70);assert.equal(boss.reflectedDamage,25);
 const opening={id:'old-shield',equipSlot:'本命法寶',effects:[{type:'equip_shield_flat',value:6000}]};
 const snapshot=raid.trustedRaidPlayerSnapshot({stats:{totalScore:10},artifactSystem:{inventory:{'old-shield':1},equipped:{本命法寶:'old-shield'}}},'u',{items:[opening]});
 assert.equal(snapshot.artifactBattle.openingShield,400);
});

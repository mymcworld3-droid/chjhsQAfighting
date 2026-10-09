globalThis.QACombatCombo = require('../public/cultivation/combat-combo.js');
globalThis.QANascentGrowth = require('../public/cultivation/nascent-growth.js');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const talents=require('../public/cultivation/soul-talents.js');
const authority=require('../raid-authority.cjs');
const engine=new Function(fs.readFileSync(require('node:path').join(__dirname,'../public/cultivation/battle-engine-v2.js'),'utf8').replace(/^import \{\} from .*;\n/gm,'').replace(/^export /gm,'')+'\nreturn settleBattleRound;')();
const p=(type,grade=1,levels={leftTop:10,leftFarBottom:10,leftFinal:10})=>({
 uid:type,totalScore:68,hp:1000,maxHp:1000,atk:200,coreCorrectStreak:0,goldenCore:null,
 nascentSoul:{talent:talents.snapshot(type,grade,levels)},answer:{correct:true,atMs:1000}
});
test('nine distinct identities use a bounded 28–32% budget with preserved node investment',()=>{
 assert.equal(new Set(Object.values(talents.TYPES).map(t=>t.trait)).size,9);
 for(const type of Object.keys(talents.TYPES)){
  assert.ok(Math.abs(talents.strength(p(type).nascentSoul.talent)-.32)<1e-9);
  assert.ok(Math.abs(talents.strength(p(type,9).nascentSoul.talent)-.28)<1e-9);
  assert.equal(talents.strength(talents.snapshot(type,1,{})),0);
 }
});
test('true damage grows from fixed skill supply and remains 60–72 without a settlement clamp',()=>{
 for(let grade=1;grade<=9;grade++){
  const a=p('wugou',grade),target=p('ocean');
  assert.ok(talents.trueDamage(a.nascentSoul.talent)<=72);
  for(const atk of [1,200,600,100000]){
   a.atk=atk;assert.equal(talents.attack(a,target).trueDamage,talents.trueDamage(a.nascentSoul.talent));
  }
 }
 assert.equal(talents.trueDamage(p('wugou',9).nascentSoul.talent),60);
});
test('duel true damage passes Dao shield but ordinary attack still consumes the shield',()=>{
 const host=p('wugou'),guest=p('ocean');guest.answer.correct=false;guest.coreShield=true;guest.goldenCore={type:"wugou",grade:9};
 const r=engine({roomId:'true-shield',round:1,host,guest,soulTalents:talents});
 assert.equal(r.guestHp,928);assert.equal(r.guestCoreShield,false);
 assert.ok(r.steps.some(s=>s.damage===72&&/穿透道心/.test(s.skill)));
});
test('true damage bypasses soul flat reduction and incorrect answers never activate attacks',()=>{
 const host=p('wugou'),guest=p('ocean');guest.answer.correct=false;guest.nascentSoul.reductionFlat=1000;
 assert.equal(engine({roomId:'true-reduction',round:1,host,guest,soulTalents:talents}).guestHp,928);
 host.answer.correct=false;
 assert.equal(engine({roomId:'wrong-true',round:1,host,guest,soulTalents:talents}).guestHp,1000);
});
test('sword followup survives the first shield, has its own step and never calls attack equipment again',()=>{
 const host=p('sword'),guest=p('ocean');guest.answer.correct=false;guest.coreShield=true;guest.goldenCore={type:"wugou",grade:9};let calls=0;
 const r=engine({roomId:'combo-shield',round:1,host,guest,soulTalents:talents,
  resolveGuardedFollowup:()=>{calls++;return null;}});
 assert.equal(r.guestHp,910);assert.equal(calls,1);
 assert.ok(r.steps.some(s=>/追魂追擊/.test(s.skill)&&s.damage===90));
});
test('charge requires three consecutive correct answers and low HP talents use current HP',()=>{
 const target=p('ocean');
 assert.equal(talents.attack(p('xingchen'),target,{streak:2}).normal,0);
 assert.equal(talents.attack(p('xingchen'),target,{streak:3}).normal,256);
 assert.equal(talents.attack(p('xingchen'),target,{streak:0}).normal,0);
 const a=p('reverse'),healthy=talents.attack(a,target).normal;a.hp=500;
 assert.ok(talents.attack(a,target).normal>healthy);
 const execute=p('pojing'),high=talents.attack(execute,target).normal;target.hp=500;
 assert.ok(talents.attack(execute,target).normal>high);
});
test('lifesteal cannot heal from blocked or overkill damage',()=>{
 const a=p('taichu');assert.equal(talents.healing(a,0,64),0);
 assert.equal(talents.healing(a,5,64),5);
 const host=p('taichu'),guest=p('ocean');host.hp=400;guest.answer.correct=false;guest.hp=5;
 const r=engine({roomId:'leech-overkill',round:1,host,guest,soulTalents:talents});
 assert.equal(r.hostHp,405);
});
test('reflection is bounded by actual received damage and cannot recurse',()=>{
 const a=p('thunder');assert.equal(talents.reflection(a,0),0);
 assert.equal(talents.reflection(a,50),16);assert.equal(talents.reflection(a,100000),64);
 const host=p('thunder'),guest=p('thunder');guest.answer.correct=false;
 const r=engine({roomId:'no-reflection-loop',round:1,host,guest,soulTalents:talents});
 assert.equal(r.steps.filter(s=>s.type==='counter').length,1);
});
test('critical expected bonus matches its budget over deterministic seeds',()=>{
 const a=p('ningxin'),target=p('ocean');let damage=0;
 for(let i=0;i<20000;i++)damage+=talents.attack(a,target,{seed:'balance-'+i}).normal;
 assert.ok(damage/20000>43&&damage/20000<53,damage/20000);
});
test('nascent talents are suppressed against Golden Core or lower players',()=>{
 const host=p('wugou'),guest=p('ocean');guest.totalScore=28;guest.answer.correct=false;guest.coreShield=true;guest.goldenCore={type:"wugou",grade:9};
 assert.equal(engine({roomId:'sealed-true',round:1,host,guest,soulTalents:talents}).guestHp,1000);
});
test('raid server applies fixed true damage, charge, reflection and real Boss HP conditions',()=>{
 assert.equal(authority.resolvePlayerAction(p('wugou'),{roomId:'r',actionId:1,correct:true,bossHp:1000,bossMaxHp:1000}).damage,272);
 const execute=p('pojing');
 const high=authority.resolvePlayerAction(execute,{roomId:'r',actionId:1,correct:true,bossHp:1000,bossMaxHp:1000}).damage;
 const low=authority.resolvePlayerAction(execute,{roomId:'r',actionId:1,correct:true,bossHp:500,bossMaxHp:1000}).damage;
 assert.ok(low>high);
 assert.equal(authority.resolveBossDefense(p('thunder'),{roomId:'r',bossAction:{id:1,damage:50}}).reflectedDamage,16);
});
test('real artifact defense preserves true damage through Dao but still absorbs it with artifact shields',()=>{
 const context={window:{},QACombatCombo:globalThis.QACombatCombo};vm.createContext(context);
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../public/cultivation/artifact-battle-effects.js'),'utf8').replace(/^import \{\} from .*;\n/gm,''),context);
 const run=shield=>{
  const host=p('wugou'),guest=p('ocean');guest.answer.correct=false;guest.coreShield=true;guest.goldenCore={type:'wugou',grade:9};
  guest.artifactShield=shield;guest.nascentSoul.reductionFlat=500;
  guest.artifactBattle={effects:[{type:'equip_damage_reduction_percent',value:.9}]};
  return engine({roomId:'artifact-true',round:1,host,guest,soulTalents:talents,
   resolveEquipmentHit:context.window.resolveArtifactBattleHit,
   resolveGuardedFollowup:context.window.resolveArtifactGuardedFollowup,
   resolveTalentDefense:context.window.resolveArtifactBattleDefense});
 };
 assert.equal(run(0).guestHp,928);assert.equal(run(100).guestHp,1000);
});
test('raid trusted snapshot and browser growth rules agree for every equipped core',()=>{
 const Growth=globalThis.QANascentGrowth;for(const type of Object.keys(talents.TYPES)){const p={stats:{totalScore:68},cultivationTraining:{equippedCore:{type,grade:1}},nascentSoulGrowth:{version:1,branches:{attack:10,vitality:10,core:10,coreChance:10,coreDamage:10}}};const client=Growth.bonuses(p,p.cultivationTraining.equippedCore);const server=authority.trustedRaidPlayerSnapshot(p,'u',{items:[]}).nascentSoul;assert.equal(JSON.stringify(server),JSON.stringify(client));assert.equal(client.attackFlat,70);assert.equal(client.maxHpFlat,500);}
});
test('artifact true damage values remain unchanged and combine with Dao-piercing soul true damage once',()=>{
 const context={window:{},QACombatCombo:globalThis.QACombatCombo};vm.createContext(context);
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../public/cultivation/artifact-battle-effects.js'),'utf8').replace(/^import \{\} from .*;\n/gm,''),context);
 const host=p('wugou'),guest=p('ocean');guest.answer.correct=false;guest.coreShield=true;guest.goldenCore={type:'wugou',grade:9};
 host.artifactBattle={effects:[{type:'equip_true_damage_flat',value:5}]};
 const r=engine({roomId:'combined-true',round:1,host,guest,soulTalents:talents,
  resolveEquipmentHit:context.window.resolveArtifactBattleHit,
  resolveGuardedFollowup:context.window.resolveArtifactGuardedFollowup,
  resolveTalentDefense:context.window.resolveArtifactBattleDefense});
 assert.equal(r.guestHp,923);
 assert.equal(context.window.resolveArtifactBattleAttack({attacker:host,defender:guest,baseDamage:200,seed:'unchanged'}).trueDamage,5);
});

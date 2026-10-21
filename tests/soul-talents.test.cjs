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
test('starfall counts correct answers in every three attempts and low HP talents use current HP',()=>{
 const target=p('ocean');
 assert.equal(talents.attack(p('xingchen'),target,{streak:3}).normal,0);
 assert.equal(talents.starfall(p('xingchen'),0),0);
 assert.equal(talents.starfall(p('xingchen'),2),192);
 assert.equal(talents.starfall(p('xingchen'),3),288);
 const a=p('reverse'),healthy=talents.attack(a,target).normal;a.hp=500;
 assert.ok(talents.attack(a,target).normal>healthy);
 const execute=p('pojing'),high=talents.attack(execute,target).normal;target.hp=500;
 assert.ok(talents.attack(execute,target).normal>high);
});
test('ocean burst includes 60% current target HP in both duel and raid settlement',()=>{
 const host=p('ocean');host.nascentSoul.talent.powerScale=.5;
 for(const [hp,expected] of [[700,64],[650,64],[600,64],[599,19]]){
  const guest=p('taichu');guest.hp=hp;guest.answer.correct=false;
  assert.equal(talents.attack(host,guest).normal,expected);
  const duel=engine({roomId:'ocean-hp-'+hp,round:1,host,guest,soulTalents:talents});
  assert.equal(duel.guestHp,hp-200-expected);
  const raid=authority.resolvePlayerAction(host,{roomId:'ocean-hp',actionId:1,correct:true,bossHp:hp,bossMaxHp:1000});
  assert.equal(raid.damage,200+expected);
 }
});
test('starfall triggers on the third answered question even when that answer is wrong',()=>{
 const h=p('xingchen'),g=p('ocean');g.answer.correct=false;
 for(let round=1;round<=3;round++){
  h.answer.correct=round===1||round===2;
  const r=engine({roomId:'three-answers',round,host:h,guest:g,soulTalents:talents});
  h.hp=r.hostHp;g.hp=r.guestHp;
  h.coreCorrectStreak=r.hostCoreStreak;g.coreCorrectStreak=r.guestCoreStreak;
  h.soulStarCorrectWindow=r.hostStarCorrectWindow;g.soulStarCorrectWindow=r.guestStarCorrectWindow;
  if(round===3){
   assert.ok(r.logs.some(x=>/星隕/.test(x.skill)&&x.damage===192));
   assert.equal(r.hostStarCorrectWindow,0);
  }
 }
});
test('correct-answer thunder can add 75% to equipment 16%, and soul can stack on the same hit',()=>{
 const context={window:{},QACombatCombo:globalThis.QACombatCombo};vm.createContext(context);
 const source=fs.readFileSync(require('node:path').join(__dirname,'../public/cultivation/artifact-battle-effects.js'),'utf8').replace(/^import \{\} from .*;\n/gm,'');
 vm.runInContext(source,context);
 const settle=(soul=false,roomId='stack-0')=>{
  const a=p('ocean'),d=p('thunder');a.uid='a';d.uid='d';a.nascentSoul=null;
  d.goldenCore={type:'thunder',grade:1};d.nascentSoul=soul?{talent:talents.snapshot('thunder',1,{leftTop:10,leftFarBottom:10,leftFinal:10})}:null;
  d.answer.correct=true;d.answer.atMs=1200;d.artifactBattle={effects:[{type:'equip_reflect_percent',value:.16}]};
  const r=engine({roomId,round:1,host:a,guest:d,soulTalents:talents,resolveEquipmentHit:args=>context.window.resolveArtifactBattleHit(args)});
  return r.logs.find(x=>x.type==='counter'&&x.coreEffect?.type==='thunder');
 };
 let bare=null,withSoul=null;
 for(let i=0;i<300;i++){
  const seed='stack-'+i;bare=settle(false,seed);
  if(bare){withSoul=settle(true,seed);break;}
 }
 assert.ok(bare);
 assert.equal(bare.damage,182,'200 normal HP loss × (16% weapon + 75% core) = 182');
 assert.equal(withSoul.damage,246,'same 200 HP × (16%+75%+32% soul) = 246');
});
test('pure true damage never contributes to thunder reflection',()=>{
 const h=p('wugou'),g=p('thunder');
 h.atk=1;g.goldenCore={type:'thunder',grade:1};g.answer.correct=false;g.coreShield=true;
 const r=engine({roomId:'true-only-thunder',round:1,host:h,guest:g,soulTalents:talents});
 assert.equal(r.guestHp,928);
 assert.equal(r.hostHp,1000);
 assert.equal(r.logs.filter(x=>x.type==='counter').length,0);
});
test('lifesteal cannot heal from blocked or overkill damage',()=>{
 const a=p('taichu');assert.equal(talents.healing(a,0,64),0);
 assert.equal(talents.healing(a,5,64),3);
 const host=p('taichu'),guest=p('ocean');host.hp=400;guest.answer.correct=false;guest.hp=5;
 const r=engine({roomId:'leech-overkill',round:1,host,guest,soulTalents:talents});
 assert.equal(r.hostHp,403);
});
test('taichu lifesteal scales to 50% without attack or 15% max-HP recovery caps',()=>{
 const a=p('taichu');a.atk=1;
 assert.equal(talents.leechRate(a.nascentSoul.talent),.5);
 assert.equal(talents.healing(a,2000),1000);
 assert.equal(talents.healing(p('taichu',9),2000),500);
 assert.equal(talents.healing(p('ocean'),2000),0);
 const guest=p('ocean');guest.answer.correct=false;
 a.atk=1000;a.hp=1;
 const r=engine({roomId:'uncapped-leech',round:1,host:a,guest,soulTalents:talents});
 assert.equal(r.hostHp,501);
 const raid=authority.resolvePlayerAction(a,{roomId:'uncapped-leech',actionId:1,correct:true,bossHp:2000,bossMaxHp:2000});
 assert.equal(raid.member.hp,501);
});
test('taichu absorbs true damage and combo damage with real artifact settlement',()=>{
 const context={window:{},QACombatCombo:globalThis.QACombatCombo};vm.createContext(context);
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../public/cultivation/artifact-battle-effects.js'),'utf8').replace(/^import \{\} from .*;\n/gm,''),context);
 const host=p('taichu'),guest=p('ocean');host.hp=100;guest.hp=guest.maxHp=10000;guest.answer.correct=false;
 host.artifactBattle={effects:[{type:'equip_true_damage_flat',value:100},{type:'equip_combo_chance',value:.75}]};
 host.comboChance=.65;
 let roomId;
 for(let i=0;i<1000;i++)if(globalThis.QACombatCombo.chain({damage:300,chance:.75,seed:'taichu-hits-'+i+':1:taichu:artifact',remainingHp:9700}).length>=2){roomId='taichu-hits-'+i;break;}
 assert.ok(roomId);
 const result=engine({roomId,round:1,host,guest,soulTalents:talents,
  resolveEquipmentHit:context.window.resolveArtifactBattleHit,resolveTalentDefense:context.window.resolveArtifactBattleDefense});
 const actual=10000-result.guestHp;
 assert.ok(result.steps.filter(step=>step.combo).length>=2);
 assert.ok(actual>300);
 assert.equal(result.hostHp,Math.min(1000,100+Math.round(actual*.5)));
 const blockedHost=p('taichu'),blockedGuest=p('ocean');blockedHost.hp=100;blockedGuest.answer.correct=false;
 blockedGuest.goldenCore={type:'wugou',grade:1};blockedGuest.coreShield=true;
 blockedHost.artifactBattle={effects:[{type:'equip_true_damage_flat',value:100}]};
 const guarded=engine({roomId:'taichu-true-shield',round:1,host:blockedHost,guest:blockedGuest,soulTalents:talents,
  resolveEquipmentHit:context.window.resolveArtifactBattleHit,resolveGuardedFollowup:context.window.resolveArtifactGuardedFollowup});
 assert.equal(guarded.hostHp,150);
});
test('taichu can leech from reflected attacks even after a wrong answer',()=>{
 const host=p('ocean'),guest=p('taichu');host.nascentSoul=null;guest.hp=400;guest.answer.correct=false;
 const r=engine({roomId:'counter-leech',round:1,host,guest,soulTalents:talents,resolveEquipmentHit:()=>({damage:200,reflectDamage:100})});
 assert.equal(r.guestHp,250);
 const member=p('taichu');member.hp=400;member.artifactBattle={effects:[{type:'equip_reflect_percent',value:.5}]};
 const raid=authority.resolveBossDefense(member,{roomId:'counter-leech',bossAction:{id:1,damage:200},bossHp:1000});
 assert.equal(raid.reflectedDamage,100);assert.equal(raid.member.hp,250);
});
test('independent pursuits and reflected starfall also provide taichu lifesteal',()=>{
 const host=p('taichu'),guest=p('ocean');host.hp=100;guest.answer.correct=false;
 const pursuit=engine({roomId:'leech-pursuit',round:1,host,guest,
  soulTalents:{...talents,attack:(...args)=>({...talents.attack(...args),followup:100})}});
 assert.equal(pursuit.hostHp,250);
 const starHost=p('ocean'),starGuest=p('taichu');starHost.answer.correct=false;starGuest.answer.correct=false;starGuest.hp=400;
 const star=engine({roomId:'leech-star-counter',round:3,host:starHost,guest:starGuest,
  soulTalents:{...talents,starfall:player=>player.uid==='ocean'?100:0},
  resolveTalentDefense:()=>({hpDamage:100,reflectDamage:50})});
 assert.equal(star.guestHp,325);
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
 const Growth=globalThis.QANascentGrowth;for(const type of Object.keys(talents.TYPES)){const p={stats:{totalScore:68},cultivationTraining:{equippedCore:{type,grade:1}},nascentSoulGrowth:{version:1,branches:{attack:10,vitality:10,core:10,coreChance:10,coreDamage:10}}};const client=Growth.bonuses(p,p.cultivationTraining.equippedCore);const server=authority.trustedRaidPlayerSnapshot(p,'u',{items:[]}).nascentSoul;assert.equal(JSON.stringify(server),JSON.stringify(client));assert.equal(client.attackFlat,35);assert.equal(client.maxHpFlat,250);}
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

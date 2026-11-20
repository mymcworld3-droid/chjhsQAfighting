'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Players=require('../dungeon-player-combat.cjs');
const Skills=require('../dungeon-skill-combat.cjs');
const Boss=require('../dungeon-boss-battle.cjs');
const Objectives=require('../dungeon-objectives.cjs');
const Manuals=require('../public/cultivation/manual-rules.js');
const Combat=require('../dungeon-enemy-combat.cjs');
const AI=require('../dungeon-enemy-ai.cjs');
const {generateDungeonLayout}=require('../dungeon-map-generator.cjs');
const API=require('../dungeon-room-api.cjs').__test;
const fs=require('node:fs'),path=require('node:path');
const threatSource=fs.readFileSync(path.join(__dirname,
  '../public/cultivation/dungeon-threat-plan.js'),'utf8')
  .replace(/^export /gm,'');
const {dungeonIncomingDamage}=new Function(threatSource+
  '\nreturn {dungeonIncomingDamage};')();

const foundation={uid:'a',accessScore:6,battleAttack:200,
  position:{x:5,y:5},battleHealth:1000,battleMaxHealth:1000,
  explorationStamina:10,downed:false,skillSeq:0};
const record={school:'sword',
  books:{'sword-wind':{exp:0}},
  equipped:['wind-slash'],activeLoadout:0,
  loadouts:[{name:'初階劍訣',skillIds:['wind-slash']},
    {name:'空白一',skillIds:[]},{name:'空白二',skillIds:[]}]};
const map={width:16,height:16,tiles:Array.from({length:256},(_,index)=>{
  const x=index%16,y=Math.floor(index/16);
  return x>0&&x<15&&y>0&&y<15?1:0;
})};

test('築基期副本 HP aligns with the stage-five trial scale and preserves roles',()=>{
  assert.deepEqual([
    Players.maxHealth('wisp'),Players.maxHealth('wolf'),
    Players.maxHealth('golem'),Objectives.GUARDIAN_HP,Boss.HP
  ],[440,500,650,1200,2800]);
  assert.equal(Players.maxHealth('guardian'),Objectives.GUARDIAN_HP);
  assert.equal(Players.maxHealth('boss'),Boss.HP);
  assert.equal(Boss.initialBoss().battleHealth,Boss.HP);
});

test('verified player attack, not fixed 30, drives skill previews and hits',()=>{
  const starting=Skills.initialCombatLoadout(foundation,record);
  assert.equal(starting.dungeonAttack,Skills.attackPower(record,foundation));
  assert.ok(starting.dungeonAttack>=foundation.battleAttack);
  assert.equal(starting.dungeonSkills.length,1);
  const move=Manuals.skillAtLevel(Manuals.BY_SKILL['wind-slash']);
  const expected=Manuals.singleHitDamage(starting.dungeonAttack,move).damage;
  assert.equal(starting.dungeonSkills[0].singleHitDamage,expected);
  const wolf={id:'beast-1',kind:'wolf',position:{x:6,y:5},
    battleHealth:500,battleMaxHealth:500};
  const state={status:'assembled',battleAppliedTick:0,enemies:[wolf],
    members:{a:{...foundation,...starting}}};
  const out=Skills.castSkill(state,'a',map,record,{
    skillId:'wind-slash',target:{x:6,y:5},seq:1
  });
  assert.equal(out.result.hits[0].damage,expected);
  assert.equal(out.enemies[0].battleHealth,500-expected);
  assert.equal(state.enemies[0].battleHealth,500);
});

test('older live dungeon enemies keep their original maximum and HP fraction',()=>{
  const legacy={kind:'wolf',battleMaxHealth:60,battleHealth:60};
  assert.equal(Players.recordedMax(legacy),60);
  assert.equal(Players.recordedMax({kind:'wolf'}),500);
  assert.equal(Boss.phase(900,900),1);
  assert.equal(Boss.phase(630,900),2);
  assert.equal(Boss.phase(315,900),3);
});

test('normal foundation beasts hit for the same exact values shown on client',()=>{
  const expected={wolf:80,wisp:60,golem:120,guardian:140};
  for(const [kind,damage] of Object.entries(expected)){
    const rule=Combat.ATTACK_RULES[kind];
    assert.equal(Combat.scaledDamage(rule.damage,foundation),damage,kind);
    assert.equal(dungeonIncomingDamage({damage:rule.damage},foundation),damage,kind);
  }
  assert.equal(Combat.scaledDamage(8,{battleMaxHealth:2500}),200);
  assert.equal(dungeonIncomingDamage({damage:8},{battleMaxHealth:2500}),200);
  assert.equal(dungeonIncomingDamage({damage:-1},foundation),null);
});

test('foundation beast attack resolves only after the two-tick warning',()=>{
  const wolf={id:'beast-1',kind:'wolf',position:{x:6,y:5},
    attack:{kind:'bite',damage:8,resolvesAtTick:4,
      cells:[{x:5,y:5}]}};
  const members={a:{...foundation}};
  const early=Combat.resolveAttack(wolf,members,3);
  assert.strictEqual(early.members,members);
  assert.deepEqual(early.hits,[]);
  const hit=Combat.resolveAttack(wolf,members,4);
  assert.deepEqual(hit.hits,['a']);
  assert.equal(hit.members.a.battleHealth,920);
  assert.equal(hit.members.a.lastDamage.amount,80);
  assert.equal(members.a.battleHealth,1000);
});

test('boss quake, charge and flame show exact foundation HP damage',()=>{
  const arena=Boss.mapFor('foundation-combat-scale-test');
  const initial=Boss.initialBoss();
  const targets={a:{...foundation,position:{x:11,y:10}}};
  const phases=[
    [{...initial,battleHealth:Boss.HP},'quake',110],
    [{...initial,battleHealth:Boss.HP*.5,attackCount:1},'charge',130],
    [{...initial,battleHealth:Boss.HP*.2,attackCount:2},'flame',160]
  ];
  for(const [enemy,kind,damage] of phases){
    const planned=Boss.plan(arena,enemy,targets,4);
    assert.equal(planned.kind,kind);
    assert.equal(Combat.scaledDamage(planned.damage,foundation),damage);
    assert.equal(dungeonIncomingDamage(planned,foundation),damage);
  }
});

test('normal strikes include trusted manuscript attack even with no equipped skill',()=>{
  const plain={...foundation,dungeonAttack:208,explorationStamina:10,
    dungeonSkillIds:[],strikeSeq:0};
  const wolf={id:'beast-1',kind:'wolf',position:{x:6,y:5},
    battleHealth:500,battleMaxHealth:500};
  const state={status:'assembled',battleAppliedTick:0,enemies:[wolf],
    members:{a:plain}};
  assert.equal(Players.playerStrikeDamage(plain),208);
  assert.equal(Players.playerStrikeDamage({battleAttack:200}),200);
  const result=Players.strikeEnemy(state,'a',map,{
    enemyId:wolf.id,seq:1
  });
  assert.equal(result.hit.damage,208);
  assert.equal(result.enemies[0].battleHealth,292);
  assert.equal(result.members.a.explorationStamina,8);
  assert.equal(state.enemies[0].battleHealth,500);
});

test('telegraph UI labels show server-scaled damage, not misleading raw 8 HP',()=>{
  const view=fs.readFileSync(path.join(__dirname,
    '../public/cultivation/dungeon-map-view.js'),'utf8');
  assert.match(view,/dungeonIncomingDamage\(beast\.attack,own\)/);
  assert.match(view,/預估累計/);
  assert.match(view,/預估 '/);
  assert.match(view,/未計掩護/);
});

test('all spawned normal, guardian and boss enemies carry trusted foundation realm',()=>{
  const dungeon=generateDungeonLayout('foundation-realm-check');
  const regular=AI.initialEnemies(dungeon);
  const spawned=Objectives.spawn(dungeon,regular);
  const all=[...spawned.enemies,Boss.initialBoss()];
  assert.ok(all.length>2);
  for(const enemy of all){
    assert.equal(enemy.realmStage,5,enemy.id);
    assert.equal(enemy.realm,'築基',enemy.id);
  }
  const now=1800000000000;
  const view=API.publicRoom('dungroomA123456',{
    mode:'dungeon',version:1,status:'assembled',revision:1,
    members:{a:{uid:'a',name:'A',position:{x:2,y:2},heartbeatAtMs:now}},
    enemies:all,expiresAtMs:now+60000,
    battleStartedAtMs:now,battleAppliedTick:0,
    dungeonArena:'boss',bossEncounter:null,dungeonProgress:null
  },now);
  assert.ok(view.enemies.every(enemy=>
    enemy.realm==='築基'&&enemy.realmStage===5));
});

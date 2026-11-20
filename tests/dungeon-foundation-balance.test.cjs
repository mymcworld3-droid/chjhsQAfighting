'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Players=require('../dungeon-player-combat.cjs');
const Skills=require('../dungeon-skill-combat.cjs');
const Boss=require('../dungeon-boss-battle.cjs');
const Objectives=require('../dungeon-objectives.cjs');
const Manuals=require('../public/cultivation/manual-rules.js');

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

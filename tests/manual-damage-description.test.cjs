'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Q=require('../public/cultivation/manual-rules.js');
const read=p=>fs.readFileSync(path.join(__dirname,'../public',p),'utf8');
const desc=(id,attack=200,level=1,options)=>
  Q.descriptionWithDamage(attack,Q.skillAtLevel(Q.BY_SKILL[id],level),options);
test('direct attacks insert numeric damage into existing description',()=>{
  assert.match(desc('wind-slash'),/三格，造成 240 傷害。$/);
  assert.match(desc('rock-fist'),/兩格，造成 260 傷害。$/);
  assert.match(desc('wind-slash',200,5),/造成 336 傷害。$/);
  assert.match(desc('tiger-throw'),/落地時造成 600 傷害/);
  assert.doesNotMatch(desc('tiger-throw'),/落地時造成傷害。/);
});
test('repeated hits use explicit number of strikes and individual damage, not a combined total',()=>{
  assert.match(desc('wind-step'),/造成 2 次 240 的傷害/);
  assert.match(desc('wind-step',200,5),/造成 2 次 336 的傷害/);
  assert.match(desc('wind-step',426,5),/造成 2 次 716 的傷害（戰場攻擊力 426 × 每擊倍率 1.68/);
  assert.match(desc('tiger-step'),/造成 2 次 320 的傷害/);
  assert.match(desc('dragon-guard'),/最多造成 4 次 240 的傷害/);
  assert.match(desc('dragon-guard'),/額外造成 120 撞擊傷害/);
  assert.equal(Q.BY_SKILL['dragon-guard'].cost,4);
  assert.match(desc('sky-cloud'),/一般劍氣每擊造成 360 傷害；中心交點最多造成 2 次 400 的傷害/);
  assert.match(desc('sky-sever'),/一般劍氣每擊造成 400 傷害；中心交點最多造成 8 次 150 的傷害/);
  assert.doesNotMatch(desc('wind-step'),/造成 560 傷害/);
});
test('buffs, flying swords and every manual use valid conditional descriptions',()=>{
  assert.match(desc('dragon-roar'),/不造成直接傷害。$/);
  assert.equal(Q.BY_SKILL['flight-summon'].cost,3,'召劍技能消耗 3 體力');
  assert.match(desc('flight-summon'),/沿途每次造成 480 傷害。.*首次召劍不造成傷害。$/);
  assert.match(desc('flight-summon',200,1,{flyingSwordReady:false}),/本次召劍不造成傷害。$/);
  assert.doesNotMatch(desc('flight-summon',200,1,{flyingSwordReady:true}),/本次召劍不造成傷害/);
  for(const book of Q.BOOKS)for(const skill of book.skills)for(const rank of [1,5,10]){
    const result=desc(skill.id,200,rank);
    assert(result.includes('傷害')&&!result.includes('NaN')&&!result.includes('undefined'),skill.id);
  }
});
test('all surfaces put damage in description and remove wheel/card damage badges',()=>{
  const library=read('cultivation/manual-training-page.js');
  const battle=read('cultivation/tactical-combat.js');
  const simulator=read('cultivation/skill-simulator.js');
  assert.match(library,/descriptionWithDamage:Catalog\.descriptionWithDamage/);
  assert.match(battle,/Manuals\.descriptionWithDamage\(me\.atk\*R\.dungeonDamageMultiplier\(state\?\.weaponDungeon,Manuals\.BY_BOOK\[shown\?\.manualId\]\?\.weaponType\),shown/);
  assert.match(battle,/Manuals\.descriptionWithDamage\(hero\.atk\*R\.dungeonDamageMultiplier\(state\?\.weaponDungeon,Manuals\.BY_BOOK\[option\.skill\?\.manualId\]\?\.weaponType\),option\.skill/);
  assert.match(simulator,/Manuals\.descriptionWithDamage\(player\.atk,chosen/);
  assert.doesNotMatch(library,/manual-skill-damage|damageDetails/);
  assert.doesNotMatch(battle,/tc-single-damage|tc-pvp-skill-damage|單次攻擊力/);
  assert.doesNotMatch(read('styles/manual-training.css'),/\.manual-skill-damage/);
});

test('shared dungeon multiplier keeps skill descriptions consistent with weapon family and saved dungeon',()=>{
  const R=require('../public/cultivation/tactical-rules.js');
  const W=require('../public/cultivation/weapon-dungeon-rules.js');
  const peak=W.selection({dungeonId:W.ID,difficulty:0});
  const wild=W.selection({dungeonId:W.WILD_ID,difficulty:0},{allowHidden:true});
  for(const [dungeon,totem,sword] of [[null,260,240],[{},299,240],[peak,299,240],[wild,260,240]]){
    for(const [skill,expected] of [['rock-fist',totem],['wind-slash',sword]]){
      const family=Q.BY_BOOK[Q.BY_SKILL[skill].manualId].weaponType;
      assert.match(desc(skill,200*R.dungeonDamageMultiplier(dungeon,family)),new RegExp('造成 '+expected+' 傷害'));
    }
  }
  assert.equal(R.dungeonDamageMultiplier(wild,'bow'),1.15);
  assert.equal(R.dungeonDamageMultiplier(peak,'bow'),1);
});

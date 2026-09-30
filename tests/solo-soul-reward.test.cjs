const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const soul=vm.runInNewContext(read('public/cultivation/nascent-soul-rules.js').replace(/^export /gm,'')+
  '\n({soulCultivationBonusForPlayer})',{QASoulTalents:require('../public/cultivation/soul-talents.js')});
const cultivationSource=read('public/cultivation/cultivation-rules.js');
function reward(player,correct=true,multiplier=1) {
  const apply=vm.runInNewContext(cultivationSource.replace(/^export /gm,'')+'\napplyCultivationReward',{
    window:{isGoldenCoreEnabled:()=>false, // stale UI must not mask actual saved core
      getNascentSoulCultivationBonuses(){throw Error('UI not ready');},
      applyArtifactCultivationGain:n=>({gain:n*multiplier})},console});
  return apply(player.stats,correct,{soulBonusGain:soul.soulCultivationBonusForPlayer(player,'solo')});
}
function player(score=68) {return {stats:{totalScore:score},cultivationTraining:{coreEnabled:true,equippedCore:{type:'sword'}},
  nascentSoulTree:{version:4,paths:{sword:{nodes:{leftBottom:5}}}}};}

test('ordinary quiz awards saved left-bottom cultivation without skill-tree UI',()=>{
  const p=player(); const result=reward(p);
  assert.equal(result.soulBonusGain,5);assert.equal(result.gain,7);assert.equal(p.stats.totalScore,75);
  assert.match(read('public/main-legacy.js'),/applyCultivationReward\(stats, isCorrect, \{\s*soulBonusGain: soulCultivationBonusForPlayer\(currentUserData, 'solo'\)/);
  assert.match(cultivationSource,/元嬰悟道 \+\$\{reward\.soulBonusGain\}/);
});

test('artifact multiplier includes soul cultivation once',()=>{
  const p=player(); const result=reward(p,true,2);
  assert.equal(result.soulBonusGain,5);assert.equal(result.gain,14);assert.equal(p.stats.totalScore,82);
});

test('disabled core, changed core and pre-nascent score do not activate old invested path',()=>{
  const off=player();off.cultivationTraining.coreEnabled=false;
  const changed=player();changed.cultivationTraining.equippedCore.type='ocean';
  for(const p of [off,changed,player(67)]) {
    const result=reward(p);assert.equal(result.soulBonusGain,0);assert.equal(result.gain,2);
  }
});

test('wrong answer gives no soul cultivation bonus',()=>{
  const p=player();const result=reward(p,false);
  assert.equal(result.soulBonusGain,0);assert.equal(result.gain,0);assert.equal(p.stats.totalScore,67);
});

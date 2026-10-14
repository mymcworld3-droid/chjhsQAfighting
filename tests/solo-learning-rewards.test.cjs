'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Learning=require('../public/cultivation/solo-learning-rules.js');
const question=(q,extra={})=>({data:{q},answerSelectedIndex:1,learningSubject:'數學',learningTopic:'方程式',learningDifficulty:'medium',...extra});
test('mistakes and skips never give reward; a distinct same-concept variant gives recovery only once',()=>{
 const stats={};const wrong=Learning.reward(stats,question('原題'),false);assert.equal(wrong.gain,0);stats.soloLearningV1=wrong.progress;
 assert.equal(Learning.reward(stats,question('原題',{recoveryOrigin:'原題'}),true).recovery,false);
 const variant=question('變式',{recoveryOrigin:'原題'}),correct=Learning.reward(stats,variant,true);
 assert.equal(correct.gain,1);assert.equal(correct.gold,10);stats.soloLearningV1=correct.progress;
 assert.equal(Learning.reward(stats,variant,true).gain,0);
 const skipped=Learning.reward({},question('跳過',{answerSelectedIndex:-1}),false);
 assert.equal(Object.keys(skipped.progress.mistakes).length,0);
});
test('difficulty comes from issued question and weakness from saved profile or observed results',()=>{
 assert.equal(Learning.reward({},question('難题',{learningDifficulty:'hard'}),true,{weakSubjects:'數學，英文'}).gain,2);
 assert.equal(Learning.reward({},question('簡單',{learningDifficulty:'easy'}),true).gain,0);
 assert.equal(Learning.reward({knowledgeMap:{數學:{方程式:{total:5,correct:2}}}},question('弱項'),true).weakPractice,true);
});
test('learning and recovery bonuses are not multiplied by artifacts; mistakes retain cultivation',()=>{
 const source=fs.readFileSync(require.resolve('../public/cultivation/cultivation-rules.js'),'utf8').replace(/^export /gm,'');
 const window={isGoldenCoreEnabled:()=>true,applyArtifactCultivationGain:n=>({gain:n*2}),
  resolveGoldenCoreCultivationReward:({isRecovery})=>({recoveryBonusGain:isRecovery?1:0})};
 const apply=vm.runInNewContext(source+'\napplyCultivationReward',{window,console});
 const stats={totalScore:30};const r=apply(stats,true,{learningBonusGain:3,isRecovery:true});
 assert.equal(r.gain,8);assert.equal(r.artifactBonusGain,2);
 const miss=apply(stats,false);assert.equal(stats.totalScore,38);assert.equal(miss.penalty,0);
});
test('Ningxin retains one streak and Wugou rewards correction while combat descriptions remain present',()=>{
 const source=fs.readFileSync(require.resolve('../public/cultivation/cultivation-training-v4.js'),'utf8');
 const start=source.indexOf('  const CORE_TYPES = ['),end=source.indexOf('  function coreType(',start);
 const types=vm.runInNewContext(source.slice(start,end)+'\nCORE_TYPES',{Math,chanceByGrade:()=>100,randomPercent:()=>true,breakthroughPercent:()=>20,inBreakthroughZone:()=>true});
 assert.equal(types.find(t=>t.id==='ningxin').resolve({isCorrect:false,previousStreak:5,hasShield:true}).preserveStreak,true);
 assert.equal(types.find(t=>t.id==='wugou').resolve({isCorrect:true,isRecovery:true}).recoveryBonusGain,1);
 assert.equal(types.find(t=>t.id==='wugou').resolve({isCorrect:false}).forceShield,undefined);
 assert.match(types.find(t=>t.id==='wugou').effect(1),/鬥法答錯時/);
});

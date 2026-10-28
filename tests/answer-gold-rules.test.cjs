'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Gold = require('../public/cultivation/answer-gold-rules.js');
const Learning = require('../public/cultivation/solo-learning-rules.js');

test('realm answer gold rises at each major threshold and never uses a stale saved rank', () => {
  const rows = [[0,20],[6,25],[28,30],[68,40],[188,50],[428,60],[788,70],[1268,80],[1868,100]];
  for (let i=0;i<rows.length;i++) {
    const [score,gold] = rows[i];
    assert.equal(Gold.perCorrect(score),gold);
    assert.equal(Gold.perCorrect(score,30),gold+10,'caves retain their higher base');
    if(i)assert.equal(Gold.perCorrect(score-.5),rows[i-1][1]);
  }
  for(const invalid of [undefined,null,NaN,Infinity,-10,'invalid'])assert.equal(Gold.perCorrect(invalid),20);
  assert.equal(Gold.perCorrect(100000),100);
});

test('browser and server share identical realm gold values', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/cultivation/answer-gold-rules.js'),'utf8'),context);
  for(const score of [0,5,6,9,10,27,28,67,68,187,188,428,788,1268,1868])
    assert.equal(context.QAAnswerGoldRules.perCorrect(score),Gold.perCorrect(score));
});

test('solo transaction rechecks realm before the answer and displays the amount actually deposited', async () => {
  const source = fs.readFileSync(require.resolve('../public/main-legacy.js'),'utf8');
  const start = source.indexOf('    const persistAnswer = () => runTransaction(');
  const end = source.indexOf('    try {\n        const p1 = shouldSaveAnswer',start);
  assert.ok(start>=0&&end>start);
  for(const correct of [true,false]) {
    const stats = {gold:100,totalScore:67,adaptiveLearningV1:{version:1,scopes:{stale:{answered:1}}}},remote = {stats:{gold:100,totalScore:68,adaptiveLearningV1:{version:1,scopes:{latest:{answered:2}}}}};
    const q = {data:{q:'test'},answerSelectedIndex:0,learningSubject:'數學',learningDifficulty:'hard'};
    const learningReward = Learning.reward(stats,q,correct);
    const title = {innerHTML:''};let patch;
    const context = {adaptiveRows:[],db:{},doc:()=>({}),auth:{currentUser:{uid:'u'}},answerUser:{uid:'u'},currentUserData:{stats},
      stats,isCorrect:correct,trialAnswerId:'',learningRules:Learning,learningReward,quiz:q,
      cultivationDelta:correct?2:0,recoveryCoreGain:0,originalGoldenMessage:'',cultivationReward:{},scoreGain:30,
      calculateRankFromScore:()=>0,updateUIStats(){},showCultivationFeedback(){},cultivationFeedback:null,fbTitle:title,t:()=> '答對',CustomEvent:class{},
      window:{QAKnowledgePoints:require('../public/cultivation/knowledge-points.js'),QAAnswerGoldRules:Gold,XianxiaQuestRules:{recordEvent:()=>({})},dispatchEvent(){}},
      runTransaction:async(_,worker)=>worker({get:async()=>({exists:()=>true,data:()=>remote}),update:(_,value)=>{patch=value;}})};
    vm.runInNewContext(source.slice(start,end)+'\nthis.persist=persistAnswer;',context);
    await context.persist();
    assert.equal(patch.stats.gold,correct?150:100,'元嬰 40 plus hard-question 10; wrong answers earn zero');
    assert.equal(patch.stats.totalScore,correct?70:68);
    if(correct)assert.match(title.innerHTML,/\+50💰/);
    assert.equal(stats.gold,patch.stats.gold);
    assert.equal(patch.stats.adaptiveLearningV1,remote.stats.adaptiveLearningV1,'ordinary answers preserve the latest background observations');
  }
});

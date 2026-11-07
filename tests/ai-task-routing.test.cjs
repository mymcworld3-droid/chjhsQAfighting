'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const router = require('../ai-router.js');
const server = fs.readFileSync('server.js', 'utf8');

function withEnv(values, action) {
  const prior = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) {
    if (v == null) delete process.env[k]; else process.env[k] = v;
  }
  return Promise.resolve().then(action).finally(() => {
    for (const [k, v] of Object.entries(prior)) {
      if (v == null) delete process.env[k]; else process.env[k] = v;
    }
  });
}
const onlyKey = key => ({
  GEMINI_API_KEYS: key,
  GEMINI_API_KEY: undefined,
  GEMINI_MODEL: undefined,
  GEMINI_MODELS: undefined,
  OPENAI_API_KEY: undefined,
  OPENAI_MODEL: undefined,
  AI_PROVIDERS_JSON: undefined
});
const fakeResponse = data => ({
  ok:true, json:async () => ({
    candidates:[{content:{parts:[{text:JSON.stringify(data)}]}}]
  })
});

test('keys-only configuration exposes six models, Lite-only production routes and Flash-only appeals', async () => {
  await withEnv(onlyKey('SIX-MODELS-TEST'), () => {
    const generation = router.buildTaskProviders('quiz-generate');
    const review = router.buildTaskProviders('quiz-review');
    const appeal = router.buildTaskProviders('appeal-confirm');
    assert.deepEqual(generation.map(x => x.model), ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
    assert.deepEqual(review.map(x => x.model), ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']);
    assert.deepEqual(appeal.map(x => x.model), [
      'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3-flash', 'gemini-2.5-flash'
    ]);
    assert.equal(router.getStatus().length, 6);
    assert.equal(router.buildTaskProviders('quiz-review',{excludeModels:['gemini-3.1-flash-lite']})[0].model,'gemini-3.5-flash-lite');
  });
});

test('one Lite request per ordinary task; second-stage appeal consumes Flash, all with HIGH reasoning', async () => {
  const oldFetch = global.fetch, calls = [];
  try {
    await withEnv(onlyKey('TASK-ROUTER-TEST'), async () => {
      global.fetch = async (url, init) => {
        calls.push({url, payload:JSON.parse(init.body)});
        return fakeResponse({valid:true});
      };
      await router.generateJSON('generate', {task:'quiz-generate',parallel:true});
      await router.generateJSON('check', {task:'quiz-review',parallel:true});
      await router.generateJSON('appeal', {task:'appeal-confirm',parallel:true});
    });
  } finally { global.fetch = oldFetch; }
  assert.equal(calls.length,3);
  assert.deepEqual(calls.map(x => x.url.split('/models/')[1].split(':')[0]), [
    'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'
  ]);
  assert(calls.every(x => x.payload.generationConfig.responseMimeType === 'application/json'));
  assert(calls.every(x => x.payload.generationConfig.thinkingConfig.thinkingLevel === 'HIGH'));
});

test('HTTP 429 quarantines a limited model and falls back without repeatedly spending its requests', async () => {
  const oldFetch = global.fetch, called = [];
  try {
    await withEnv(onlyKey('QUOTA-TEST-KEY'), async () => {
      global.fetch = async url => {
        const model = url.split('/models/')[1].split(':')[0];
        called.push(model);
        if (model === 'gemini-3.5-flash-lite')
          return {ok:false,status:429,text:async()=> 'Quota exhausted'};
        return fakeResponse({accepted:true});
      };
      assert.equal((await router.generateJSON('question',{task:'quiz-generate'})).model, 'gemini-3.1-flash-lite');
      assert.equal((await router.generateJSON('question',{task:'quiz-generate'})).model, 'gemini-3.1-flash-lite');
    });
  } finally { global.fetch = oldFetch; }
  assert.deepEqual(called, ['gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemini-3.1-flash-lite']);
});

test('quiz review rejects invalid answers and correction uses the Flash reserve only when Lite gives no verdict', async () => {
  for (const {approved, correction, liteUnavailable} of [
    {approved:false}, {approved:true}, {approved:false,correction:true},
    {approved:true,correction:true,liteUnavailable:true}
  ]) {
    let handler, generations = 0, audits = 0;
    const calls = [];
    const sourceQuestion = '原題要求用疾病盛行率、靈敏度與偽陽性率求陽性者患病的機率。' + '補充說明。'.repeat(60) + '最末條件';
    const ctx = {
      process:{env:{GEMINI_API_KEYS:'test-key'}},
      console:{log(){},error(){},warn(){}},Math,
      app:{post:(_route,fn)=>{handler=fn;}},
      SUBJECT_SCHEMA:{數學:['一次方程式']},SUBJECT_DETAILS:{},
      getRandomItem:items=>items[0],
      questionQualityAnalytics:{recordGenerated:async()=>{}},
      playerRepository:{resolve:()=>({db:{}})},
      verifyMainIdentity:async()=> 'player',
      aiQuestionBank:{enabled:true,find:async()=>{throw Error('correction must bypass the shared AI bank');}},
      QUESTION_FORMS:require('../quiz-generation-tasks.cjs').QUESTION_FORMS,
      createQuizTaskPlan:require('../quiz-generation-tasks.cjs').createQuizTaskPlan,
      FAST_QUIZ_MODES:require('../fast-quiz-prompt.cjs').MODES,
      quickQuizPrompt:require('../fast-quiz-prompt.cjs').quickQuizPrompt,
      Knowledge:require('../public/cultivation/knowledge-points.js'),
      ANSWER_AND_EXPLANATION_RULES:require('../quiz-answer-prompt.cjs').ANSWER_AND_EXPLANATION_RULES,
      subjectReliabilityPrompt:require('../quiz-answer-prompt.cjs').subjectReliabilityPrompt,
      questionQualityIssue:require('../question-quality.cjs').questionQualityIssue,
      removeUnstableOptionLabels:require('../question-quality.cjs').removeUnstableOptionLabels,
      quizSparePool:require('../quiz-spare-pool.cjs').createSparePool()
    };
    ctx.aiRouter = {generateJSON:async(prompt,opts)=>{
      calls.push(opts.task);
      if (opts.task==='quiz-review' || opts.task==='quiz-escalate') {
        audits++;
        if (correction) {
          assert.ok(prompt.includes(sourceQuestion), 'review receives the complete correction reference');
          assert.match(prompt, /省略原題的關鍵推理/);
        }
        assert.ok(opts.excludeModels.includes('gemini-3.5-flash-lite'));
        if (liteUnavailable && opts.task==='quiz-review') {
          throw Object.assign(Error('Lite HTTP 503'),{attempts:[{httpStatus:503}]});
        }
        return {data:{approved,validIndices:approved?[0]:[0,1],reason:approved?'算式正確':'此題有多解'},model:'gemini-3.1-flash-lite',provider:'review'};
      }
      assert.equal(opts.task,'quiz-generate');
      if (correction) {
        assert.ok(prompt.includes(sourceQuestion), 'generation receives the original even beyond the topic length limit');
        assert.match(prompt, /先驗及兩類條件機率反推後驗/);
      }
      generations++;
      const taskLine=prompt.split('\n').find(x=>x.startsWith('任務規格 JSON：'));
      const task=JSON.parse(taskLine.slice('任務規格 JSON：'.length));
      const candidate = correction ? {
        q:'晶片中有 10% 是瑕疵品。檢測會標記 90% 的瑕疵品，也會標記 10% 的良品。任取一顆被標記的晶片，它有瑕疵的機率是多少？',
        correct:'50%',wrong:['10%','18%','90%'],
        exp:'以 100 顆晶片估算，標記的瑕疵品有 9 顆，標記的良品也有 9 顆。18 顆被標記晶片中有 9 顆瑕疵品，答案為 50%。',
        knowledge_points:[{subject:'數學',id:'math-7',name:'機率與統計'}]
      } : {
        q:'解方程式 x+2=6，x 的數值為何？',
        correct:'4',wrong:['2','3','5'],
        exp:'從 x+2=6 兩邊減去 2，得到 x=4，所以正確答案為 4。',
        knowledge_points:[{subject:'數學',id:'math-3',name:'方程與不等式'}]
      };
      return {model:'gemini-3.5-flash-lite',provider:'generate',data:{
        ...candidate,subject:'數學',
        generation_task_id:task.generation_task_id,question_form:task.question_form
      }};
    }};
    const start = server.indexOf('function cleanQuestionText('), helperEnd=server.indexOf('const { MODES: FAST_QUIZ_MODES',start);
    const endpointStart=server.indexOf("app.post('/api/generate-quiz',"),endpointEnd=server.indexOf('// API 5:',endpointStart);
    vm.runInNewContext(server.slice(start,helperEnd) + server.slice(endpointStart,endpointEnd),ctx);
    const output={};
    await handler({body:{subject:'數學',specificTopic:correction?'條件機率':'一次方程式',level:correction?'高中二年級':'國中一年級',difficulty:'medium',quizMode:'solo',
      ...(correction ? {correctionPractice:{sourceQuestion}} : {})}},{
      status(n){output.status=n;return this;}, json(value){output.body=value;return this;}
    });
    assert.equal(audits,liteUnavailable?2:approved?1:3);
    assert.equal(generations,approved?1:3);
    assert.deepEqual(calls.slice(0,2),['quiz-generate','quiz-review']);
    assert.equal(calls.filter(task=>task==='quiz-escalate').length,liteUnavailable?1:0);
    if (approved) {
      assert.equal(JSON.parse(output.body.text).correct,correction?'50%':'4');
      assert.equal(output.status,undefined);
    } else {
      assert.equal(output.status,correction?503:500);
      if(correction)assert.equal(output.body.code,'CORRECTION_NOT_APPROVED');
      else assert.equal(output.body.error,'生成失敗');
      assert.equal(output.body.text,undefined,'rejected question must never be served');
    }
  }
});

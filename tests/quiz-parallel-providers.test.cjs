'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const router=require('../ai-router');
const server=fs.readFileSync('server.js','utf8');
const {QUESTION_FORMS,createQuizTaskPlan}=require('../quiz-generation-tasks.cjs');
const {createSparePool}=require('../quiz-spare-pool.cjs');
function taskFrom(prompt){return JSON.parse(prompt.split('\n').find(line=>line.startsWith('任務規格 JSON：')).slice('任務規格 JSON：'.length));}

async function withMockProviders(fn) {
  const keys=['GEMINI_API_KEYS','GEMINI_API_KEY','OPENAI_API_KEY','OPENAI_MODEL','AI_PROVIDERS_JSON','AI_PROVIDER_STRATEGY'];
  const originals=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const oldFetch=global.fetch;
  delete process.env.GEMINI_API_KEYS;delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;delete process.env.OPENAI_MODEL;
  process.env.AI_PROVIDER_STRATEGY='round-robin';
  process.env.AI_PROVIDERS_JSON=JSON.stringify(['slow','fast','backup'].map(name=>({
    name,type:'openai-compatible',baseUrl:'https://'+name+'.test/v1',apiKey:'key-'+name,model:'quiz'
  })));
  try {await fn();}
  finally {
    global.fetch=oldFetch;
    for(const [key,value] of Object.entries(originals)) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
}
function response(value) {
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(value)}}]})};
}
test('quiz races three distinct API credentials and returns the fastest valid JSON',async()=>{
  await withMockProviders(async()=>{
    const called=[];
    global.fetch=async(url)=>{
      const name=new URL(url).hostname.split('.')[0];
      called.push(name);
      await new Promise(resolve=>setTimeout(resolve,name==='fast'?5:40));
      return response({winner:name});
    };
    const result=await router.generateJSON('generate quiz',{parallel:true,timeoutMs:3000});
    assert.equal(result.data.winner,'fast');
    assert.equal(result.provider,'fast');
    assert.deepEqual(new Set(called),new Set(['slow','fast','backup']));
    // Draining late responses avoids background log mutations during other tests.
    await new Promise(resolve=>setTimeout(resolve,50));
  });
});

test('a malformed parallel response does not beat a successful valid response',async()=>{
  await withMockProviders(async()=>{
    global.fetch=async(url)=>{
      const name=new URL(url).hostname.split('.')[0];
      if(name==='slow') return {ok:true,json:async()=>({choices:[{message:{content:'not-json'}}]})};
      return response({correct:true,name});
    };
    const result=await router.generateJSON('generate quiz',{parallel:true,timeoutMs:3000});
    assert.equal(result.data.correct,true);
  });
});

test('a fast answer/explanation mismatch cannot win the quiz race or enter the spare pool',async()=>{
  const {questionQualityIssue}=require('../question-quality.cjs');
  await withMockProviders(async()=>{
    const correct={q:'點 $(2,1)$ 到直線 $3x-4y+5=0$ 的距離為何？',correct:'$\\frac{7}{5}$',
      wrong:['$\\frac{3}{5}$','$\\frac{1}{5}$','$\\frac{9}{5}$'],exp:'代入點到直線距離公式得 $\\frac{|6-4+5|}{5}=\\frac{7}{5}$。答案為 $\\frac{7}{5}$。'};
    const wrong={...correct,correct:correct.wrong[0],wrong:[correct.correct,...correct.wrong.slice(1)]};
    const spares=[];
    global.fetch=async(url)=>{
      const name=new URL(url).hostname.split('.')[0];
      if(name==='fast')return response(wrong);
      await new Promise(resolve=>setTimeout(resolve,5));return response(correct);
    };
    const result=await router.generateJSON('generate quiz',{parallel:true,timeoutMs:3000,
      validate:data=>{const issue=questionQualityIssue(data);if(issue)throw Error(issue);},
      onSpare:spare=>spares.push(spare)});
    assert.notEqual(result.provider,'fast');assert.equal(result.data.correct,correct.correct);
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(spares.every(spare=>spare.provider!=='fast'));
  });
});

test('wrong arithmetic in both fast and late responses cannot win or enter the spare pool',async()=>{
  const {questionQualityIssue}=require('../question-quality.cjs');
  await withMockProviders(async()=>{
    const plan=createQuizTaskPlan({difficulty:'medium'}),pool=createSparePool();
    const key=pool.key({owner:'session:abcdefghijklmnopqrst',subject:'數學',topic:'向量'});
    const pending=[],called=[];
    global.fetch=(_url,init)=>new Promise(resolve=>{
      const task=taskFrom(JSON.parse(init.body).messages[1].content);called.push(task);
      const bad=task.question_form!==plan.get(1).form;
      pending.push(()=>resolve(response({
        q:'已知兩向量長度為 3、5，內積為 12，求向量和的長度。',
        correct:bad?String.raw`$\sqrt{38}$`:String.raw`$\sqrt{58}$`,wrong:['8','38','6'],
        exp:bad?String.raw`平方為 $3^2+2(12)+5^2=9+24+25=38$。答案為 $\sqrt{38}$。`
          :String.raw`平方為 $3^2+2(12)+5^2=9+24+25=58$。答案為 $\sqrt{58}$。`,
        generation_task_id:task.generation_task_id,question_form:task.question_form
      })));
    });
    const work=router.generateJSON('向量單選題',{parallel:true,
      promptForProvider:(base,index)=>plan.prompt(base,index),
      validate:(data,context)=>{const issue=questionQualityIssue(data);if(issue)throw Error(issue);plan.validate(data,context.index);},
      onWinner:item=>pool.markServed(key,item.data),onSpare:item=>pool.offer(key,item)});
    assert.equal(called.length,3);
    pending[0]();await new Promise(resolve=>setImmediate(resolve));
    pending[1]();const delivered=await work;
    assert.equal(delivered.data.correct,String.raw`$\sqrt{58}$`);
    pending[2]();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(pool.count(key),0,'the late invalid calculation must not be cached');
    assert.equal(called.length,3,'deterministic checks do not buy another AI review');
  });
});

test('real quiz handler rewrites the entire question when every API repeats the same arithmetic error',async()=>{
  await withMockProviders(async()=>{
    for(const mode of ['solo','battle-fast']) {
      let handler,calls=0;const prompts=[];
      const context={QUESTION_FORMS,createQuizTaskPlan,app:{post:(_path,fn)=>{handler=fn;}},aiRouter:router,
        FAST_QUIZ_MODES:require('../fast-quiz-prompt.cjs').MODES,quickQuizPrompt:require('../fast-quiz-prompt.cjs').quickQuizPrompt,
        Knowledge:require('../public/cultivation/knowledge-points.js'),
        ANSWER_AND_EXPLANATION_RULES:require('../quiz-answer-prompt.cjs').ANSWER_AND_EXPLANATION_RULES,
        subjectReliabilityPrompt:require('../quiz-answer-prompt.cjs').subjectReliabilityPrompt,
        questionQualityIssue:require('../question-quality.cjs').questionQualityIssue,removeUnstableOptionLabels:require('../question-quality.cjs').removeUnstableOptionLabels,
        SUBJECT_SCHEMA:{數學:['向量']},SUBJECT_DETAILS:{},getRandomItem:items=>items[0],console:{log(){},error(){}},
        quizSparePool:createSparePool({similar:(a,b)=>a===b})};
      const helperStart=server.indexOf('function cleanQuestionText('),helperEnd=server.indexOf('const { MODES: FAST_QUIZ_MODES',helperStart);
      const start=server.indexOf("app.post('/api/generate-quiz',"),end=server.indexOf('// API 5:',start);
      vm.runInNewContext(server.slice(helperStart,helperEnd)+server.slice(start,end),context);
      global.fetch=async(_url,init)=>{
        const prompt=JSON.parse(init.body).messages[1].content,task=taskFrom(prompt),bad=calls++<3;
        prompts.push(prompt);
        return response({q:'已知向量長度為 3、5，內積為 12，求向量和的長度。',
          correct:bad?String.raw`$\sqrt{38}$`:String.raw`$\sqrt{58}$`,wrong:['8','38','6'],
          exp:bad?String.raw`平方為 $9+24+25=38$。答案為 $\sqrt{38}$。`:String.raw`平方為 $9+24+25=58$。答案為 $\sqrt{58}$。`,
          subject:'數學',knowledge_points:[{subject:'數學',id:'math-5',name:'幾何與向量'}],
          generation_task_id:task.generation_task_id,question_form:task.question_form});
      };
      const output={};
      await handler({body:{subject:'數學',specificTopic:'向量',quizMode:mode}},
        {status(n){output.status=n;return this;},json(value){output.body=value;return this;}});
      assert.equal(output.status,undefined,JSON.stringify(output.body));
      const question=JSON.parse(output.body.text);
      assert.equal(question.correct,String.raw`$\sqrt{58}$`);assert(!question.exp.includes('38'));
      assert.equal(calls,6,'one bad parallel wave is followed by one complete replacement wave');
      assert.ok(prompts.slice(3).every(prompt=>prompt.includes('數值等式')&&/重寫|重新生成/.test(prompt)));
      await new Promise(resolve=>setImmediate(resolve));
    }
  });
});

test('one configured API retains the ordinary sequential path and quiz endpoint opts in for all modes',()=>{
  assert.match(server,/aiRouter\.generateJSON\(prompt, \{/);
  assert.match(server,/parallel: true/);
  assert.match(server,/onSpare: spare => quizSparePool\.offer\(spareKey, spare\)/);
  assert.match(server,/const saved = attempts === 0 \? .*quizSparePool\.take\(spareKey, validateCandidate\)/);
  assert.match(server,/const combatFastMode = FAST_QUIZ_MODES\.has/);
  assert.match(server,/app\.post\('\/api\/generate-quiz'/);
  assert.match(fs.readFileSync('fast-quiz-prompt.cjs','utf8'),/raid-quick-simple.*battle-fast.*immortal-fast/);
});

test('all APIs start with different tasks together; late valid tasks become reusable spares',async()=>{
  await withMockProviders(async()=>{
    const plan=createQuizTaskPlan({difficulty:'medium'}),pool=createSparePool({similar:(a,b)=>a===b});
    const key=pool.key({owner:'session:abcdefghijklmnopqrst',subject:'數學',topic:'方程式'});
    const assigned=[],pending=[];
    global.fetch=(url,init)=>new Promise(resolve=>{
      const task=taskFrom(JSON.parse(init.body).messages[1].content);assigned.push(task);
      pending.push(()=>resolve(response({q:'獨立題目 '+task.question_form,correct:'正解',wrong:['錯一','錯二','錯三'],exp:'完整解析',
        template_id:'template-'+task.question_form,question_form:task.question_form,generation_task_id:task.generation_task_id})));
    });
    const work=router.generateJSON('同一指定範圍',{
      parallel:true,promptForProvider:(base,index)=>plan.prompt(base,index),validate:(data,context)=>plan.validate(data,context.index),
      onWinner:result=>pool.markServed(key,result.data),onSpare:result=>pool.offer(key,result)
    });
    assert.equal(assigned.length,3,'every API is started before waiting for a result');
    assert.equal(new Set(assigned.map(x=>x.generation_task_id)).size,3);
    assert.equal(new Set(assigned.map(x=>x.question_form)).size,3);
    assert.equal(new Set(assigned.map(x=>x.goal)).size,3);
    pending[1]();const winner=await work;assert.equal(winner.data.generation_task_id,assigned[1].generation_task_id);
    pending[0]();pending[2]();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(pool.count(key),2);
    assert(pool.take(key,()=>true));assert(pool.take(key,()=>true));assert.equal(assigned.length,3,'spares need no new API requests');
  });
});

test('a fast response with another task ID cannot win or become a spare',async()=>{
  await withMockProviders(async()=>{
    const plan=createQuizTaskPlan({difficulty:'medium'}),spares=[];
    global.fetch=async(url,init)=>{
      const task=taskFrom(JSON.parse(init.body).messages[1].content),name=new URL(url).hostname.split('.')[0];
      if(name!=='fast')await new Promise(resolve=>setTimeout(resolve,5));
      return response({generation_task_id:name==='fast'?'another-task':task.generation_task_id,question_form:task.question_form});
    };
    const result=await router.generateJSON('scope',{parallel:true,promptForProvider:(base,index)=>plan.prompt(base,index),
      validate:(data,context)=>plan.validate(data,context.index),onSpare:result=>spares.push(result)});
    assert.notEqual(result.provider,'fast');await new Promise(resolve=>setTimeout(resolve,20));
    assert(spares.every(result=>result.provider!=='fast'));
  });
});

test('fallback models sharing a credential receive new task numbers after the parallel wave',async()=>{
  await withMockProviders(async()=>{
    process.env.AI_PROVIDERS_JSON=JSON.stringify(['a','b','c'].flatMap(key=>[1,2].map(model=>({
      name:key+model,type:'openai-compatible',baseUrl:'https://'+key+'.test/v1',apiKey:'key-'+key,model:String(model)
    }))));
    const plan=createQuizTaskPlan({difficulty:'medium'}),assigned=[],indices=[];
    global.fetch=async(_url,init)=>{
      const body=JSON.parse(init.body),task=taskFrom(body.messages[1].content);assigned.push(task);
      if(assigned.length<=3)return {ok:true,json:async()=>({choices:[{message:{content:'invalid'}}]})};
      return response({generation_task_id:task.generation_task_id,question_form:task.question_form});
    };
    const result=await router.generateJSON('scope',{parallel:true,promptForProvider:(base,index)=>{indices.push(index);return plan.prompt(base,index);},
      validate:(data,context)=>plan.validate(data,context.index)});
    assert(result.data.generation_task_id);
    assert.equal(new Set(assigned.map(x=>x.generation_task_id)).size,assigned.length);
    assert.deepEqual(indices,Array.from({length:assigned.length},(_,i)=>i));
    assert.equal(assigned.length,4);
  });
});

test('a single configured API receives one complete task without additional generation calls',async()=>{
  await withMockProviders(async()=>{
    const configured=JSON.parse(process.env.AI_PROVIDERS_JSON);process.env.AI_PROVIDERS_JSON=JSON.stringify(configured.slice(0,1));
    const plan=createQuizTaskPlan({difficulty:'easy'});let calls=0;
    global.fetch=async(_url,init)=>{
      calls++;const task=taskFrom(JSON.parse(init.body).messages[1].content);
      return response({generation_task_id:task.generation_task_id,question_form:task.question_form});
    };
    const result=await router.generateJSON('scope',{parallel:true,promptForProvider:(base,index)=>plan.prompt(base,index),
      validate:(data,context)=>plan.validate(data,context.index)});
    assert.equal(calls,1);assert.equal(result.data.generation_task_id,plan.get(0).id);
  });
});

test('real quiz handler delivers the fastest assigned form, strips internal IDs and reuses other tasks in solo and combat',async()=>{
  await withMockProviders(async()=>{
    for(const mode of ['solo','battle-fast']) {
      let handler;const pending=[],assigned=[];let calls=0;
      const context={QUESTION_FORMS:require('../quiz-generation-tasks.cjs').QUESTION_FORMS,createQuizTaskPlan,
        app:{post:(_path,fn)=>{handler=fn;}},aiRouter:router,crypto:require('node:crypto'),
        FAST_QUIZ_MODES:require('../fast-quiz-prompt.cjs').MODES,quickQuizPrompt:require('../fast-quiz-prompt.cjs').quickQuizPrompt,
        Knowledge:require('../public/cultivation/knowledge-points.js'),
        ANSWER_AND_EXPLANATION_RULES:require('../quiz-answer-prompt.cjs').ANSWER_AND_EXPLANATION_RULES,
        subjectReliabilityPrompt:require('../quiz-answer-prompt.cjs').subjectReliabilityPrompt,
        questionQualityIssue:require('../question-quality.cjs').questionQualityIssue,removeUnstableOptionLabels:require('../question-quality.cjs').removeUnstableOptionLabels,
        SUBJECT_SCHEMA:{數學:['一次方程式']},SUBJECT_DETAILS:{},getRandomItem:items=>items[0],console:{log(){},error(){}},
        quizSparePool:createSparePool({similar:(a,b)=>a===b})};
      const helperStart=server.indexOf('function cleanQuestionText('),helperEnd=server.indexOf('const { MODES: FAST_QUIZ_MODES',helperStart);
      const start=server.indexOf("app.post('/api/generate-quiz',"),end=server.indexOf('// API 5:',start);
      vm.runInNewContext(server.slice(helperStart,helperEnd)+server.slice(start,end),context);
      const questions=[
        {q:'方程式 x+2=6 中，x 的值為何？',correct:'4',wrong:['2','3','5'],exp:'移項得 x=6-2=4，所以答案為 4。'},
        {q:'某數乘以 3 等於 15，這個數是多少？',correct:'5',wrong:['2','3','4'],exp:'設此數為 x，3x=15，兩邊除以 3 得 x=5。'},
        {q:'解方程式 x+3=7 時，將 x 寫成 7+3。正確的移項結果為何？',correct:'x=4',wrong:['x=10','x=7','x=3'],exp:'原式兩邊同減 3，應得 x=7-3=4。'}
      ];
      global.fetch=(_url,init)=>new Promise(resolve=>{
        const task=taskFrom(JSON.parse(init.body).messages[1].content),index=calls++;assigned.push(task);
        pending.push(()=>resolve(response({...questions[index],subject:'數學',
          knowledge_points:[{subject:'數學',id:'math-3',name:'方程與不等式'}],
          question_form:task.question_form,generation_task_id:task.generation_task_id,
          concept_id:'linear-equation',template_id:'independent-'+index,reasoning_steps:1,cognitive_level:2})));
      });
      const invoke=async()=>{
        const output={};
        await handler({body:{subject:'數學',specificTopic:'一次方程式',level:'國中一年級',difficulty:'medium',quizMode:mode,quizSessionId:'abcdefghijklmnopqrst-session'}},
          {status(n){output.status=n;return this;},json(value){output.body=value;return this;}});
        return output;
      };
      const first=invoke();assert.equal(calls,3);
      pending[1]();const delivered=await first;
      assert.equal(delivered.status,undefined);const question=JSON.parse(delivered.body.text);
      assert.equal(question.q,questions[1].q);assert(!Object.hasOwn(question,'generation_task_id'));
      assert.equal(question.question_form,assigned[1].question_form);assert.notEqual(question.question_form,assigned[0].question_form);
      pending[0]();pending[2]();await new Promise(resolve=>setImmediate(resolve));
      const next=await invoke();assert.equal(calls,3,'compatible late tasks are reused without a new batch');
      assert.notEqual(JSON.parse(next.body.text).q,question.q);
      assert(!Object.hasOwn(JSON.parse(next.body.text),'generation_task_id'));
    }
  });
});

test('adaptive solo handler assigns different fine methods to simultaneous APIs, strips binding fields and preserves spare eligibility',async()=>{
  await withMockProviders(async()=>{
    const Adaptive=require('../adaptive-learning-api.cjs').__test;
    const Rules=require('../public/cultivation/adaptive-learning-rules.js');
    const unit={path:'物理/高中二年級/下學期/物理',detail:'鉛直圓周運動'};
    let stats={};const db={collection:name=>({doc:()=>({get:async()=>({exists:name==='users',data:()=>({stats,gameSettings:{sourceMode:'focused',focusedUnits:[unit],difficulty:'auto'}})}),set:async()=>{}})})};
    const adaptiveLearning=Adaptive.createAdaptiveLearning({verify:async()=> 'u1',resolve:()=>({db}),generate:async(_prompt,options)=>{
      const data={concepts:Adaptive.seedConcepts(Adaptive.scopeFor(unit))};options.validate(data);return {data};
    }});
    let handler,calls=0;const pending=[],assignments=[];
    const context={QUESTION_FORMS,createQuizTaskPlan,adaptiveLearning,app:{post:(_path,fn)=>{handler=fn;}},aiRouter:router,crypto:require('node:crypto'),
      FAST_QUIZ_MODES:new Set(),quickQuizPrompt:require('../fast-quiz-prompt.cjs').quickQuizPrompt,Knowledge:require('../public/cultivation/knowledge-points.js'),
      ANSWER_AND_EXPLANATION_RULES:'完整單選題',subjectReliabilityPrompt:()=>'',questionQualityIssue:()=>'',removeUnstableOptionLabels:text=>text,
      SUBJECT_SCHEMA:{物理:['圓周運動']},SUBJECT_DETAILS:{},getRandomItem:items=>items[0],console:{log(){},error(){}},quizSparePool:createSparePool({similar:(a,b)=>a===b})};
    const helperStart=server.indexOf('function cleanQuestionText('),helperEnd=server.indexOf('const { MODES: FAST_QUIZ_MODES',helperStart);
    const start=server.indexOf("app.post('/api/generate-quiz',"),end=server.indexOf('// API 5:',start);
    vm.runInNewContext(server.slice(helperStart,helperEnd)+server.slice(start,end),context);
    global.fetch=(_url,init)=>new Promise(resolve=>{
      const prompt=JSON.parse(init.body).messages[1].content,task=taskFrom(prompt),binding=JSON.parse(prompt.split('[範圍細觀念與考法]\n')[1].split('\n')[0]),index=calls++;
      assignments.push(binding);pending.push(()=>resolve(response({q:'獨立練習情境：'+binding.method+'，請選出正確關係。',correct:'關係甲',wrong:['關係乙','關係丙','關係丁'],exp:'依照題目條件，完整推導可得關係甲。',
        subject:'物理',knowledge_points:[{subject:'物理',id:'physics-1',name:'力與運動'}],question_form:task.question_form,generation_task_id:task.generation_task_id,
        adaptive_scope_id:binding.adaptive_scope_id,adaptive_facet_id:binding.adaptive_facet_id,adaptive_difficulty:binding.adaptive_difficulty,template_id:'adaptive-template-'+index,reasoning_steps:1,cognitive_level:1})));
    });
    const invoke=async(extra={})=>{
      const out={};await handler({body:{subject:'數學',level:'國中一年級',difficulty:'hard',specificTopic:'不可信範圍',quizMode:'solo',adaptiveScope:unit,...extra}},
        {status(n){out.status=n;return this;},json(value){out.body=value;return this;}});return out;
    };
    const first=invoke();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,3);assert.equal(new Set(assignments.map(x=>x.adaptive_facet_id)).size,3);
    assert(assignments.every(x=>x.adaptive_difficulty==='easy'&&x.scope.subject==='物理'&&x.scope.level==='高中二年級'));
    pending[1]();const delivered=await first;assert.equal(delivered.status,undefined);const question=JSON.parse(delivered.body.text);
    assert.equal(question.adaptive.facetId,assignments[1].adaptive_facet_id);assert.equal(question.adaptive.outline.length,6);assert.equal(question.subject,'物理');
    for(const key of ['generation_task_id','adaptive_scope_id','adaptive_facet_id','adaptive_difficulty'])assert(!Object.hasOwn(question,key));
    pending[0]();pending[2]();await new Promise(resolve=>setImmediate(resolve));
    stats={adaptiveLearningV1:Rules.record(undefined,question.adaptive,{correct:true,at:1000})};
    const next=await invoke();assert.equal(calls,3,'an eligible spare for another unpracticed concept is reused');
    const nextQuestion=JSON.parse(next.body.text);assert.notEqual(nextQuestion.adaptive.conceptId,question.adaptive.conceptId);
    const denied=await invoke({quizMode:'battle-fast'});assert.equal(denied.status,400);
  });
});

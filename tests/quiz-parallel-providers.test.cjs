'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const router=require('../ai-router');
const server=fs.readFileSync('server.js','utf8');

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

test('one configured API retains the ordinary sequential path and quiz endpoint opts in for all modes',()=>{
  assert.match(server,/aiRouter\.generateJSON\(prompt, \{/);
  assert.match(server,/parallel: true/);
  assert.match(server,/onSpare: spare => quizSparePool\.offer\(spareKey, spare\)/);
  assert.match(server,/const saved = attempts === 0 \? quizSparePool\.take\(spareKey, validateCandidate\)/);
  assert.match(server,/const combatFastMode = FAST_QUIZ_MODES\.has/);
  assert.match(server,/app\.post\('\/api\/generate-quiz'/);
  assert.match(fs.readFileSync('fast-quiz-prompt.cjs','utf8'),/raid-quick-simple.*battle-fast.*immortal-fast/);
});

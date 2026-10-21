'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {quickQuizPrompt}=require('../fast-quiz-prompt.cjs');
const source=fs.readFileSync('server.js','utf8');
const a=source.indexOf('function qualityPolicy('),b=source.indexOf('function chooseQuestionForm(',a);
const policy=vm.runInNewContext(source.slice(a,b)+'\nqualityPolicy');

test('hard adopts original medium, medium adopts original easy and easy becomes introductory',()=>{
  for(const subject of ['數學','物理','國文','英文','歷史','地理','公民']) {
    assert.equal(policy(subject,'easy').cognitive,'1-2');
    assert.equal(policy(subject,'easy').steps,'1');
    assert.equal(policy(subject,'medium').cognitive,'2-3');
    assert.equal(policy(subject,'medium').steps,'1-2');
    assert.equal(policy(subject,'hard').cognitive,'3-4');
    assert.equal(policy(subject,'hard').steps,'2-3');
  }
  assert.match(policy('數學','medium').instruction,/原簡單題標準/);
  assert.match(policy('國文','medium').instruction,/原簡單題標準/);
  assert.match(policy('數學','hard').instruction,/原中等題標準/);
  assert.match(policy('國文','hard').instruction,/原中等題標準/);
});

test('compact combat prompts retain the same depth policy and emit numeric metadata examples',()=>{
  for(const mode of ['battle-fast','immortal-fast','raid-standard']) {
    for(const difficulty of ['easy','medium','hard']) {
      const quality=policy('數學',difficulty);
      const prompt=quickQuizPrompt({mode,subject:'數學',level:'國中一年級',topic:'一元一次方程式',difficulty,quality});
      assert.ok(prompt.includes(quality.instruction));
      assert.ok(prompt.includes('難度='+difficulty));
      const spec=JSON.parse(prompt.split('只回傳這個 JSON 結構（內容請依題目替換）：')[1]);
      assert.equal(spec.cognitive_level,parseInt(quality.cognitive));
      assert.equal(spec.reasoning_steps,parseInt(quality.steps));
    }
  }
});

test('dedicated raid quick-answer mode retains its single-step combat pacing',()=>{
  const quality=policy('數學','hard');
  const prompt=quickQuizPrompt({mode:'raid-quick-simple',subject:'數學',difficulty:'hard',quality});
  assert.match(prompt,/難度=easy/);
  assert.match(prompt,/推理步數=1/);
  assert.ok(!prompt.includes(quality.instruction));
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {quickQuizPrompt}=require('../fast-quiz-prompt.cjs');
const source=fs.readFileSync('server.js','utf8');
const a=source.indexOf('function qualityPolicy('),b=source.indexOf('function chooseQuestionForm(',a);
const policy=vm.runInNewContext(source.slice(a,b)+'\nqualityPolicy');

test('easy adopts the previous medium depth and medium adopts the previous hard depth',()=>{
  for(const subject of ['數學','物理','國文','英文','歷史','地理','公民']) {
    assert.equal(policy(subject,'easy').cognitive,'3-4');
    assert.equal(policy(subject,'easy').steps,'2-3');
    assert.equal(policy(subject,'medium').cognitive,'4-5');
    assert.equal(policy(subject,'medium').steps,'3-5');
    assert.equal(policy(subject,'hard').cognitive,'5');
    assert.equal(policy(subject,'hard').steps,'4-6');
  }
  assert.match(policy('數學','medium').instruction,/至少需要 3 個有意義的解題步驟/);
  assert.match(policy('國文','medium').instruction,/推論、比較、資料或語境判讀/);
  assert.match(policy('數學','hard').instruction,/不得.*超綱/);
  assert.match(policy('國文','hard').instruction,/指定年級與單元範圍/);
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

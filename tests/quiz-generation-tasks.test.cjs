'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {QUESTION_FORMS,createQuizTaskPlan}=require('../quiz-generation-tasks.cjs');
const {quickQuizPrompt}=require('../fast-quiz-prompt.cjs');

test('concurrent task assignments have distinct forms, objectives and IDs before any answer returns',()=>{
  const plan=createQuizTaskPlan({targetForm:'scenario-modeling',difficulty:'medium'});
  const tasks=[0,1,2].map(plan.get);
  for(const field of ['id','form','goal'])assert.equal(new Set(tasks.map(task=>task[field])).size,3,field);
  assert.equal(tasks[0].form,'scenario-modeling');assert.equal(plan.get(1),tasks[1]);
  assert.equal(createQuizTaskPlan({difficulty:'medium'}).get(0).id===tasks[0].id,false,'new batches have new IDs');
  assert.throws(()=>plan.get(-1));assert.throws(()=>plan.get(.5));
});
test('all eight forms have explicit goals and fallback attempts never reuse a task ID',()=>{
  const plan=createQuizTaskPlan({difficulty:'hard'}),tasks=Array.from({length:18},(_,i)=>plan.get(i));
  assert.deepEqual(new Set(tasks.slice(0,8).map(t=>t.form)),new Set(QUESTION_FORMS));
  assert.equal(new Set(tasks.map(t=>t.id)).size,18);
  assert.notEqual(tasks[0].angle,tasks[8].angle);
});
test('recent forms are avoided when alternatives exist, without inventing forms',()=>{
  const plan=createQuizTaskPlan({difficulty:'medium',targetForm:'multi-step',previousMeta:[{question_form:'direct-application'},{question_form:'inverse-reasoning'}]});
  assert.equal(plan.get(0).form,'multi-step');
  assert([0,1,2].every(i=>!['direct-application','inverse-reasoning'].includes(plan.get(i).form)));
});
test('easy questions and dedicated raid quick answers get different single-step tasks',()=>{
  for(const options of [{difficulty:'easy'},{mode:'raid-quick-simple',difficulty:'hard'}]) {
    const plan=createQuizTaskPlan({...options,targetForm:'multi-step'}),tasks=[0,1,2].map(plan.get);
    assert.equal(new Set(tasks.map(t=>t.form)).size,3);
    assert(tasks.every(t=>['direct-application','comparison','error-analysis'].includes(t.form)));
    assert.match(plan.prompt('固定範圍',0),/只需一步/);
    const task=tasks[0];assert.throws(()=>plan.validate({generation_task_id:task.id,question_form:task.form,reasoning_steps:2},0),/一步/);
  }
});
test('each compact prompt contains only its assigned form and keeps scope, difficulty and knowledge requirements',()=>{
  const plan=createQuizTaskPlan({targetForm:'direct-application',difficulty:'medium'});
  const prompts=[0,1,2].map(index=>{
    const task=plan.get(index);
    const base=quickQuizPrompt({mode:'battle-fast',subject:'數學',level:'國中一年級',topic:'一元一次方程式',difficulty:'medium',
      targetForm:task.form,quality:{cognitive:2,steps:2},knowledgePointId:'math-3',generationTaskId:task.id});
    assert.equal(JSON.parse(base.split('只回傳這個 JSON 結構（內容請依題目替換）：')[1]).generation_task_id,task.id);
    const prompt=plan.prompt(base,index);
    assert.match(prompt,/國中一年級/);assert.match(prompt,/一元一次方程式/);assert.match(prompt,/難度=medium/);assert.match(prompt,/math-3/);
    assert(prompt.includes('"question_form":"'+task.form+'"'));
    assert(prompt.length<4000,'task instructions remain bounded');
    return prompt;
  });
  assert.equal(new Set(prompts).size,3);
});
test('responses from the wrong task or form fail before becoming winners or spares',()=>{
  const plan=createQuizTaskPlan({difficulty:'medium'}),a=plan.get(0),b=plan.get(1);
  assert(plan.validate({generation_task_id:a.id,question_form:a.form},0));
  for(const value of [{generation_task_id:b.id,question_form:a.form},{generation_task_id:a.id,question_form:b.form},{question_form:a.form}])
    assert.throws(()=>plan.validate(value,0),/任務或題型不符/);
});
test('endpoint builds the full specification for each task and validates task binding before collecting results',()=>{
  const server=fs.readFileSync(require.resolve('../server.js'),'utf8');
  assert.match(server,/generationPrompt\(task\.form, task\.id,\{difficulty:taskDifficulty,quality:taskQuality,adaptiveFields\}\)/);
  assert.match(server,/targetForm:task\.form/);
  assert.match(server,/validateCandidate\(parsed\);\s*taskPlan\.validate\(parsed, context\.index\)/);
  assert.match(server,/delete parsed\.generation_task_id/);
  assert.doesNotMatch(server,/候選題目差異化/);
});

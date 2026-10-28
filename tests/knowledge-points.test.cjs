'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Knowledge = require('../public/cultivation/knowledge-points.js');
const Core = require('../public/cultivation/ability-insights-core.js');
const { quickQuizPrompt, MODES } = require('../fast-quiz-prompt.cjs');
const math = { subject:'數學',knowledge_subject:'數學',knowledge_point_id:'math-3',knowledge_point:'方程與不等式' };

test('ten fixed subjects have eight stable knowledge points each, independent of curriculum scopes', () => {
  assert.deepEqual(Knowledge.SUBJECT_NAMES,['國文','英文','數學','物理','化學','生物','地科','公民','地理','歷史']);
  assert.equal(Knowledge.SUBJECTS.every(x => x.points.length===8),true);
  assert.equal(new Set(Knowledge.SUBJECTS.flatMap(x=>x.points.map(p=>p.id))).size,80);
  assert.ok(Knowledge.points('國文').some(x=>x.name==='閱讀理解'));
  assert.ok(Knowledge.points('國文').some(x=>x.name==='文言文'));
  const empty = Core.build(), polluted = Core.build({數學:{'七上第一章':{total:100,correct:100}},資訊科技:{程式:{total:5,correct:5}}});
  assert.equal(empty.topics.length,80);assert.deepEqual(empty.topics,polluted.topics);
  assert.equal(polluted.total,0,'scope-only legacy answers are never reclassified as knowledge evidence');
  const measured = Core.build(Knowledge.record({},math,true));
  assert.deepEqual(measured.subjects.map(x=>x.name),Knowledge.SUBJECT_NAMES);
  assert.deepEqual(measured.topics.map(x=>x.knowledgePointId),empty.topics.map(x=>x.knowledgePointId));
  assert.equal(measured.topics.filter(x=>x.subject==='數學').length,8);
  assert.equal(measured.topics.find(x=>x.knowledgePointId==='math-3').total,1);
  assert.equal(measured.domains.find(x=>x.name==='英文').estimate,null);
});

test('classification validates matching subject, ID and label, supports aliases, and never guesses from scope', () => {
  assert.equal(Knowledge.subject('地球科學'),'地科');assert.equal(Knowledge.subject('數學A'),'數學');
  assert.equal(Knowledge.subject('__proto__'),'');
  assert.equal(Knowledge.label({subject:'數學',sub_topic:'方程與不等式',concept_id:'math-3'}),null);
  for(const bad of [{...math,knowledge_subject:'英文'},{...math,knowledge_point_id:'english-3'},
    {...math,knowledge_point:'AI 新節點'},{...math,knowledge_point_id:'不存在'},{}]) {
    assert.throws(()=>Knowledge.assertLabel(bad,'數學'),/知識點標記無效/);
  }
  assert.equal(Knowledge.assertLabel(math,'數學A').id,'math-3');
  assert.throws(()=>Knowledge.assertLabel(math,'數學','math-4'),/知識點標記無效/);
  assert.equal(Knowledge.assertLabel({knowledge_subject:'',knowledge_point_id:'',knowledge_point:''},'資訊科技'),null);
  assert.deepEqual(Knowledge.metadata({meta:math,learningSubject:'數學B'}),{
    knowledge_subject:'數學',knowledge_point_id:'math-3',knowledge_point:'方程與不等式',knowledge_points:[{subject:'數學',id:'math-3',name:'方程與不等式'}]});
  let map=Knowledge.record({},math,true);map=Knowledge.record(map,{meta:math,learningSubject:'數學'},false);
  assert.deepEqual(map.數學['math-3'],{total:2,correct:1});
  assert.equal(Knowledge.record(map,{subject:'數學',sub_topic:'方程與不等式'},true),map);
});

test('all combat prompts include the same fixed taxonomy without replacing the requested scope', () => {
  for(const mode of MODES) {
    const prompt=quickQuizPrompt({mode,subject:'數學',topic:'七上第三章 3-2 移項',targetForm:'multi-step'});
    assert.match(prompt,/七上第三章 3-2 移項/);assert.match(prompt,/knowledge_points/);
    assert.match(prompt,/方程與不等式/);assert.doesNotMatch(prompt,/chinese-1/);
  }
});

test('multiple points count once per node while subject and overall totals count one actual answer',()=>{
  const algebra={subject:'數學',id:'math-2',name:'代數運算'},equation={subject:'數學',id:'math-3',name:'方程與不等式'};
  const question={subject:'數學A',knowledge_points:[algebra,equation,algebra]};
  assert.deepEqual(Knowledge.labels(question),[algebra,equation]);
  let map=Knowledge.record({},question,true);map=Knowledge.record(map,question,false);
  for(const id of ['math-2','math-3'])assert.deepEqual(map.數學[id],{total:2,correct:1});
  assert.deepEqual(map._totals.all,{total:2,correct:1});assert.deepEqual(map._totals.subjects.數學,{total:2,correct:1});
  const report=Core.build(map);assert.equal(report.total,2);assert.equal(report.correct,1);
  assert.equal(report.subjects.find(x=>x.name==='數學').total,2);assert.equal(report.studiedTopics,2);
  assert.equal(Core.aiSummary(report,'數學').total,2);assert.equal(Core.aiSummary(report).total,2);
  assert.equal(Knowledge.assertLabel(question,'數學','math-3').id,'math-2','required trial point can be any tagged point');
  const migrated=Knowledge.record({數學:{'math-2':{total:7,correct:4},'math-3':{total:5,correct:1}}},question,true);
  assert.deepEqual(migrated._totals.all,{total:13,correct:6},'old single-label maps migrate without losing answer totals');
});

test('every array item is validated, invalid points cannot hide behind a valid first point',()=>{
  const point={subject:'數學',id:'math-3',name:'方程與不等式'};
  for(const invalid of [{...point,id:'invented'},{...point,name:'自訂章節'}, {subject:'英文',id:'english-4',name:'閱讀理解'},'math-3']) {
    const question={subject:'數學',knowledge_points:[point,invalid]};
    assert.throws(()=>Knowledge.assertLabel(question,'數學'),/知識點標記無效/);
    const old={};assert.equal(Knowledge.record(old,question,true),old);
  }
  assert.throws(()=>Knowledge.assertLabel({knowledge_points:[]},'數學'),/知識點標記無效/);
  assert.equal(Knowledge.assertLabel({knowledge_points:[]},'資訊科技'),null);
  const mixed={subject:'綜合',knowledge_points:[point,{subject:'物理',id:'physics-1',name:'力與運動'}]};
  const map=Knowledge.record({},mixed,true);assert.equal(Core.build(map).total,1);
  assert.equal(map._totals.subjects.數學.total,1);assert.equal(map._totals.subjects.物理.total,1);
  const logs=[{subject:'綜合',knowledgePoints:mixed.knowledge_points,isCorrect:true,timestamp:new Date(),questionForm:'multi-step'}];
  assert.equal(Core.recentTrend(logs,'物理').recent.count,1);assert.equal(Core.skillStats(logs,'物理').find(x=>x.code==='multi-step').total,1);
});

function generationHarness(candidates) {
  let handler,calls=0;const prompts=[];
  const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
  const a=source.indexOf("app.post('/api/generate-quiz',"),b=source.indexOf('// API 5:',a);
  const context={Knowledge,createQuizTaskPlan:require('../quiz-generation-tasks.cjs').createQuizTaskPlan,app:{post:(_,fn)=>handler=fn},FAST_QUIZ_MODES:MODES,
    SUBJECT_SCHEMA:{數學:['原範圍']},SUBJECT_DETAILS:{},QUESTION_FORMS:['multi-step'],
    cleanQuestionText:x=>String(x),normalizeQuestionMeta:x=>x,getRandomItem:x=>x[0],
    qualityPolicy:()=>({cognitive:2,steps:2,instruction:'理解推理'}),chooseQuestionForm:()=> 'multi-step',
    ANSWER_AND_EXPLANATION_RULES:'獨立驗算',subjectReliabilityPrompt:require('../quiz-answer-prompt.cjs').subjectReliabilityPrompt,quickQuizPrompt,
    isTooSimilarQuestion:()=>false,questionQualityIssue:()=>'',removeUnstableOptionLabels:x=>x,
    quizSparePool:{key:()=>'',take:()=>null,markServed(){},offer(){}},
    aiRouter:{async generateJSON(prompt,options){
      prompts.push(prompt);
      const task=JSON.parse(prompt.split('\n').find(line=>line.startsWith('任務規格 JSON：')).slice('任務規格 JSON：'.length));
      const candidate=candidates[Math.min(calls++,candidates.length-1)];
      const data={...candidate,question_form:candidate.question_form||task.question_form,
        generation_task_id:candidate.generation_task_id||task.generation_task_id};
      options.validate(data,{index:0});return {data,provider:'test',model:'test'};
    }},
    console:{log(){},error(){}},crypto:require('node:crypto')};
  vm.runInNewContext(source.slice(a,b),context);
  return {prompts,calls:()=>calls,async invoke(body){const result={};await handler({body},{status(n){result.status=n;return this;},json(x){result.body=JSON.parse(JSON.stringify(x));return this;}});return result;}};
}
test('quiz API rejects invented or cross-subject labels, retries, and returns scope and knowledge separately',async()=>{
  const question={...math,q:'方程式 x+2=6 中，x 的值為何？',correct:'4',wrong:['2','3','5'],exp:'移項得 x=6-2=4。答案為 4。'};
  const h=generationHarness([{...question,knowledge_point_id:'made-up'},question]);
  const result=await h.invoke({subject:'數學',specificTopic:'七上第三章 3-2 移項',quizMode:'battle-fast'});
  assert.equal(h.calls(),2);const generated=JSON.parse(result.body.text);
  assert.equal(generated.sub_topic,'七上第三章 3-2 移項');assert.equal(generated.knowledge_point_id,'math-3');
  assert.equal(generated.knowledge_point,'方程與不等式');assert.equal(generated.knowledge_subject,'數學');
  const wrong=generationHarness([{...question,knowledge_subject:'英文'}]);
  const failed=await wrong.invoke({subject:'數學',specificTopic:'移項'});
  assert.equal(failed.status,500);assert.equal(wrong.calls(),3);
});

test('quiz API normalizes multiple knowledge points while preserving the requested scope',async()=>{
  const points=[{subject:'數學',id:'math-2',name:'代數運算'},{subject:'數學',id:'math-3',name:'方程與不等式'}];
  const h=generationHarness([{knowledge_points:[...points,points[0]],q:'方程式 x+2=6 中，x 的值為何？',correct:'4',wrong:['2','3','5'],exp:'移項得 x=6-2=4。答案為 4。'}]);
  const result=await h.invoke({subject:'數學',specificTopic:'七上第三章 3-2 移項',quizMode:'battle-fast'});
  const question=JSON.parse(result.body.text);assert.deepEqual(question.knowledge_points,points);
  assert.equal(question.sub_topic,'七上第三章 3-2 移項');assert.equal(question.knowledge_point_id,'math-2');
});

test('combat history transaction counts a tagged answer once and leaves old untagged answers unclassified',async()=>{
  const source=fs.readFileSync(require.resolve('../public/cultivation/data/player-repository.js'),'utf8');
  const a=source.indexOf('  async saveExamAnswer('),b=source.indexOf('  async shareCurriculum(',a);
  const rows=new Map([['users/u',{stats:{knowledgePointMapV1:{}}}]]);
  const context={globalThis:{QAKnowledgePoints:Knowledge},getMainUser:()=>({uid:'u'}),services:async()=>({db:{}}),
    COLLECTION:'users',doc:(_,collection,id)=>collection+'/'+id,serverTimestamp:()=>1,
    runTransaction:async(_,worker)=>{
      const writes=[];const result=await worker({get:async ref=>{assert.equal(writes.length,0,'all reads precede writes');return {exists:()=>rows.has(ref),data:()=>rows.get(ref)};},
        set:(ref,value)=>writes.push(()=>rows.set(ref,value)),
        update:(ref,patch)=>writes.push(()=>{rows.get(ref).stats.knowledgePointMapV1=patch['stats.knowledgePointMapV1'];})});
      writes.forEach(fn=>fn());return result;
    }};
  vm.runInNewContext('this.save=({'+source.slice(a,b)+'}).saveExamAnswer;',context);
  const input={...math,knowledge_points:[{subject:'數學',id:'math-3',name:'方程與不等式'},{subject:'數學',id:'math-4',name:'函數與圖形'}],mode:'duel',question:'原題',subTopic:'七上第三章',isCorrect:true};
  assert.equal(await context.save('duel_u_round1',input),true);
  assert.equal(await context.save('duel_u_round1',input),false);
  assert.deepEqual(rows.get('users/u').stats.knowledgePointMapV1.數學['math-3'],{total:1,correct:1});
  assert.equal(rows.get('exam_logs/duel_u_round1').knowledgePoint,'方程與不等式');
  assert.deepEqual(rows.get('exam_logs/duel_u_round1').knowledgePoints,input.knowledge_points);
  assert.equal(rows.get('users/u').stats.knowledgePointMapV1.數學['math-4'].total,1);
  assert.equal(rows.get('users/u').stats.knowledgePointMapV1._totals.all.total,1);
  assert.equal(rows.get('exam_logs/duel_u_round1').subTopic,'七上第三章');
  await context.save('duel_u_round2',{subject:'數學',subTopic:'方程與不等式',isCorrect:false});
  assert.equal(rows.get('users/u').stats.knowledgePointMapV1.數學['math-3'].total,1);
});

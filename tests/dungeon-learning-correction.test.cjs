'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Adaptive=require('../public/cultivation/adaptive-learning-rules.js');
const Knowledge=require('../public/cultivation/knowledge-points.js');
const Solo=require('../public/cultivation/solo-learning-rules.js');
const Learning=require('../dungeon-learning-correction.cjs');
const S='a'.repeat(24),C='c_'+'b'.repeat(16),F='f_'+'c'.repeat(16);
const meta={scopeId:S,conceptId:C,facetId:F,questionId:'dungeon_answer_invalid',
  difficulty:'medium',role:'diagnostic'};
const observe=(raw,id,correct,at)=>
  Adaptive.record(raw,{...meta,questionId:id},{id,correct,help:0,at});
test('invalid adaptive answer restores exact previous lesson, spaced-review and mastery status',()=>{
  const before=observe(undefined,'prior_valid_answer',true,1000);
  const after=observe(before,meta.questionId,false,2000);
  const evidence={before:before.scopes[S],after:after.scopes[S],
    eventId:meta.questionId,at:2000,help:0};
  assert.equal(Adaptive.scopeState(after,S).concepts[C].w,1);
  const reverted=Learning.inverseAdaptive(after,meta,false,evidence);
  assert.deepEqual(reverted,before);
  assert.equal(Adaptive.scopeState(reverted,S).concepts[C].w,0);
  assert.equal(Adaptive.scopeState(reverted,S).concepts[C].stage,
    Adaptive.scopeState(before,S).concepts[C].stage);
  assert.equal(Adaptive.scopeState(reverted,S).concepts[C].dueAt,
    Adaptive.scopeState(before,S).concepts[C].dueAt);
});
test('older invalid adaptive question is removed without erasing newer valid work',()=>{
  const before=observe(undefined,'prior_valid_answer',true,1000);
  const invalid=observe(before,meta.questionId,false,2000);
  const latest=observe(invalid,'later_valid_answer',true,3000);
  const evidence={before:before.scopes[S],after:invalid.scopes[S],
    eventId:meta.questionId,at:2000,help:0};
  const fixed=Learning.inverseAdaptive(latest,meta,false,evidence);
  const expected=observe(before,'later_valid_answer',true,3000);
  assert.deepEqual(fixed,expected,
    'after invalidation later valid answers must retain their true review schedule');
  const state=Adaptive.scopeState(fixed,S);
  assert.equal(state.answered,2);
  assert.equal(state.concepts[C].n,2);
  assert.equal(state.concepts[C].c,2);
  assert.equal(state.facets[F].n,2);
  assert.equal(state.facets[F].c,2);
  assert(!state.seen.includes(meta.questionId));
  assert(state.seen.includes('later_valid_answer'));
  assert(!state.recent.some(row=>row.id===meta.questionId));
  assert(state.recent.some(row=>row.id==='later_valid_answer'));
});
test('invalid answer retraction subtracts all touched knowledge nodes just once',()=>{
  const labels=Knowledge.points('數學').slice(0,2);
  const question={q:'以下兩項數學能力的綜合應用，哪個條件正確？',subject:'數學',
    learningTopic:'核心知識',meta:{knowledge_points:
      labels.map(p=>({subject:'數學',id:p.id,name:p.name}))}};
  let map=Knowledge.record({},question,true);
  map=Knowledge.record(map,question,false);
  const fixed=Learning.inverseKnowledge(map,question,false);
  for(const point of labels)assert.deepEqual(fixed['數學'][point.id],{total:1,correct:1});
  assert.deepEqual(fixed._totals.all,{total:1,correct:1});
  assert.deepEqual(fixed._totals.subjects['數學'],{total:1,correct:1});
});
test('wrong-answer correction removes its mistake but keeps explicit game rewards',()=>{
  const q={q:'哪些條件可以確立一個無歧義的敘述？',
    subject:'數學',learningTopic:'觀念辨析',correct:false};
  const prior={totalAnswered:7,totalCorrect:5,totalScore:20,
    currentStreak:3,bestStreak:4,
    knowledgeMap:{數學:{觀念辨析:{total:3,correct:2}}},
    knowledgePointMapV1:{},
    soloLearningV1:{version:1,mistakes:{},concepts:{}}};
  const learn=Solo.reward(prior,{data:{q:q.q},learningSubject:'數學',
    learningTopic:'觀念辨析',answerSelectedIndex:1},false);
  const patch={'stats.currentStreak':0,'stats.bestStreak':4};
  const ev=Learning.evidenceBefore(prior,q,false,0,1000,patch);
  const graded={...prior,totalAnswered:8,knowledgeMap:{數學:{觀念辨析:{total:4,correct:2}}},
    soloLearningV1:learn.progress,currentStreak:0,
    lastQuizAnswer:{question:q.q,isCorrect:false}};
  const result=Learning.reverse({stats:graded},q,{learningCorrectionEvidence:ev});
  assert.equal(result['stats.totalAnswered'],7);
  assert.equal(result['stats.totalCorrect'],5);
  assert.equal(result['stats.currentStreak'],3);
  assert.equal(result['stats.knowledgeMap'].數學['觀念辨析'].total,3);
  assert.equal(Object.keys(result['stats.soloLearningV1'].mistakes).length,0);
  assert(!Object.hasOwn(result,'stats.totalScore'));
  assert.equal(result['stats.lastQuizAnswer'].excludedFromLearning,true);
});

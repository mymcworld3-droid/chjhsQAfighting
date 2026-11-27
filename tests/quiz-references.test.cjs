'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quizReferences: liveReferences, referencePrompt: livePrompt, referenceVersion, __test: {selectCandidates:quizReferences,candidatePrompt:referencePrompt} } = require('../quiz-references.cjs');
const { scopeCode } = require('../ai-question-bank.cjs');
const { questionQualityIssue } = require('../question-quality.cjs');

const target = { subject: '數學', level: '高中二年級', topic: '向量內積', difficulty: 'medium' };
test('retired information technology references no longer load', () => { assert.deepEqual(quizReferences({subject:'資訊科技',level:'高中一年級',topic:'程式設計'}),[]); });

test('finds the same concept for live battle and formatted background warmup', () => {
  const group = require.resolve('../question-references/數學/高中二年級/平面向量內積.json');
  assert.equal(require.cache[group], undefined);
  assert.deepEqual(quizReferences({ ...target, topic: '向量加減' }), []);
  assert.equal(require.cache[group], undefined);
  const [reference] = quizReferences(target);
  const loadedGroup = require.cache[group];
  assert.ok(loadedGroup);
  assert.equal(quizReferences(target)[0], reference);
  assert.equal(require.cache[group], loadedGroup);
  assert.doesNotMatch(JSON.stringify(reference), /https?:\/\//);
  assert.equal(questionQualityIssue(reference.question), '');
  assert.match(referencePrompt([reference]), /同觀念命題參考例/);
  assert.match(referencePrompt([reference]), /同層次/);
  assert.match(referencePrompt([reference]), /荒謬情節/);
  assert.equal(quizReferences({ ...target, topic:'高中二年級／第一學期／數學：平面向量 (核心考點細項：向量內積)' })[0].id, reference.id);
  assert.notEqual(scopeCode(target), scopeCode({ ...target, referenceVersion:reference.id }));
});

test('respects the current facet, grade, space-vectors scope and custom exclusions', () => {
  const scope = { path: '數學/高中二年級/第一學期/平面向量', sub_topics: [] };
  assert.equal(quizReferences({ ...target, topic: '平面向量', scope, facet: { concept:'內積的定義' } }).length, 3);
  for (const overrides of [
    { facet:{ concept:'向量加減' } }, { topic:'空間向量／向量內積' },
    { level:'國中二年級' }, { topic:'平面向量' }
  ]) {
    assert.deepEqual(quizReferences({ ...target, ...overrides }), []);
  }
});

test('an exclusion keeps eligible same-concept references instead of disabling the bank', () => {
  const refs=quizReferences({...target,exclusions:['不要出投影']});
  assert.ok(refs.length>0);
  assert.ok(refs.every(r=>!/(投影)/.test(r.question.q+r.question.exp)));
});

test('whitespace in curriculum acronyms never prevents exact index lookup', () => {
  const cases=[
    ['生物','高中一年級','DNA 與基因'],
    ['生物','高中二年級','DNA 複製與基因表現'],
    ['地理','高中三年級','GIS 與空間資料']
  ];
  for (const [subject,level,topic] of cases) {
    const expected=quizReferences({subject,level,topic});
    assert.equal(expected.length,3,topic);
    assert.ok(expected.every(r=>r.question.sub_topic===topic));
    const noSpaces=quizReferences({subject,level,topic:topic.split(' ').join('')});
    assert.deepEqual(noSpaces.map(r=>r.id),expected.map(r=>r.id));
  }
});

test('loads exact Chinese curriculum concepts containing punctuation', () => {
  const target = { subject: '國文', level: '高中一年級' };
  const punctuated = '韻腳、對仗與詩意理解';
  const reference = quizReferences({ ...target, topic: punctuated });
  assert.equal(reference.length, 3);
  assert.ok(reference.every(item => item.question.sub_topic === punctuated));
  assert.equal(quizReferences({ ...target, topic: '高中一年級／第一學期／古典韻文（核心考點細項：韻腳、對仗與詩意理解）' })[0].id, reference[0].id);
  const other = quizReferences({ ...target, topic: '主旨、段落結構、語氣' });
  assert.equal(other.length, 3);
  assert.ok(other.every(item => item.question.sub_topic === '主旨、段落結構、語氣'));
  assert.deepEqual(quizReferences({ ...target, topic: '化學反應' }), []);
});


test('grade 11 Chinese first semester references follow exact fine concepts', () => {
  const target = { subject: '國文', level: '高中二年級' };
  const concepts = [
    '文章論點與論據', '篇章結構', '修辭與文史背景',
    '意象、典故與詩風', '詞牌與語言特色', '跨文本比較',
    '非連續文本', '媒體識讀', '比較閱讀',
    '應用文與書信', '語意與語用', '重點摘要'
  ];
  for (const concept of concepts) {
    const refs = quizReferences({ ...target, topic: concept });
    assert.equal(refs.length, 3, concept);
    for (const ref of refs) {
      assert.equal(ref.question.sub_topic, concept);
      assert.equal(ref.question.wrong.length, 3);
      assert.equal(new Set([ref.question.correct, ...ref.question.wrong]).size, 4);
      assert.doesNotMatch(JSON.stringify(ref), /https?:\/\//);
    }
  }
  const formatted = quizReferences({
    ...target, topic: '高中二年級／第一學期／唐宋詩詞（核心考點細項：意象、典故與詩風）'
  });
  assert.equal(formatted.length, 3);
  assert.ok(formatted.every(ref => ref.question.sub_topic === '意象、典故與詩風'));
  assert.deepEqual(quizReferences({ ...target, topic: '意象、典故與詩風', exclusions:['排除典故相關題型'] }), []);
  assert.deepEqual(quizReferences({ ...target, topic: '高中三年級寫作技巧' }), []);
});

test('every expanded history reference appears across seeded three-item samples',()=>{
 const query={subject:'歷史',level:'高中二年級',topic:'宗教與社會'};
 const all=require('../question-references/歷史/高中二年級/宗教與社會.json').references;
 assert.equal(all.length,8);
 const ids=new Set();
 for(let i=0;i<100;i++) for(const ref of quizReferences({...query,referenceSeed:'seed-'+i}))ids.add(ref.id);
 assert.deepEqual(ids,new Set(all.map(r=>r.id)));
});

test('production references require verified human provenance, never a source label alone',()=>{
 const {isApproved}=require('../human-reference-policy.cjs');
 const candidates=quizReferences(target);
 const active=liveReferences(target);
 const group=require('../question-references/數學/高中二年級/平面向量內積.json');
 const eligible=group.references.filter(r=>isApproved(r,'question-references/數學/高中二年級/平面向量內積.json'));
 assert.equal(active.length,Math.min(3,eligible.length));
 assert.ok(active.every(r=>eligible.includes(r)));
 const forged={...candidates[0],id:'forged-human-source',source:'大考中心 115 學年度學測數學第 1 題'};
 assert.equal(isApproved(forged),false);
 assert.equal(livePrompt([forged]),'');
 assert.match(referenceVersion([]),/^human-reference-v1:/);
});
test('provenance requires original text/options, human comparison, rights and exact content hash',()=>{
 const {checkApproval,digest}=require('../human-reference-policy.cjs');
 const file='question-references/數學/高中二年級/平面向量內積.json';
 const ref={id:'official-original-test-fixture',source:'正式考試原題測試資料',question:{q:'fixture',correct:'1',wrong:['2','3','4']}};
 const approval={file,referenceId:ref.id,referenceHash:digest(ref),status:'approved',authorship:'human-original',method:'human-original-source-comparison',
 originalTextAndOptionsMatched:true,answerVerified:true,sourceRightsVerified:true,sourceType:'official-exam',rightsBasis:'statutory-exam',sourceTitle:'fixture',sourceAuthorOrInstitution:'fixture',originalQuestionNumberOrLocator:'1',rightsEvidence:'fixture',reviewer:'fixture',reviewEvidence:'fixture',reviewedAt:'2026-11-27',originalSourceUrl:'https://example.invalid/test-fixture'};
 assert.equal(checkApproval(ref,approval,file),true);
 for(const key of ['originalSourceUrl','reviewer','reviewEvidence','rightsEvidence','originalQuestionNumberOrLocator','referenceHash','sourceAuthorOrInstitution','authorship','method','originalTextAndOptionsMatched','answerVerified','sourceRightsVerified'])
  assert.equal(checkApproval(ref,{...approval,[key]:null},file),false,key);
 assert.equal(checkApproval({...ref,question:{...ref.question,q:'modified'}},approval,file),false);
 for(const source of ['自編高中課綱參考題','大考中心試題，依命題思路改寫','AI 生成']){
  const modified={...ref,source};
  assert.equal(checkApproval(modified,{...approval,referenceHash:digest(modified)},file),false);
 }
 assert.equal(checkApproval(ref,approval,'question-references/數學/高中一年級/其他.json'),false);
});
test('every reference is audited; new or changed banks cannot contain unverified entries',()=>{
 const {audit}=require('../scripts/audit-human-reference-provenance.cjs');
 const report=audit();
 console.log('HUMAN_REFERENCE_AUDIT '+JSON.stringify(report.summary));
 assert.ok(report.summary.total>0);
 assert.equal(report.summary.total,report.summary.approved+report.summary.quarantined);
 assert.deepEqual(report.errors,[]);
});

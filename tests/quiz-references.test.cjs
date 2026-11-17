'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quizReferences, referencePrompt } = require('../quiz-references.cjs');
const { scopeCode } = require('../ai-question-bank.cjs');
const { questionQualityIssue } = require('../question-quality.cjs');

const target = { subject: '數學', level: '高中二年級', topic: '向量內積', difficulty: 'medium' };

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
  assert.match(referencePrompt([reference]), /同觀念的人類命題範例/);
  assert.equal(quizReferences({ ...target, topic:'高中二年級／第一學期／數學：平面向量 (核心考點細項：向量內積)' })[0].id, reference.id);
  assert.notEqual(scopeCode(target), scopeCode({ ...target, referenceVersion:reference.id }));
});

test('respects the current facet, grade, space-vectors scope and custom exclusions', () => {
  const scope = { path: '數學/高中二年級/第一學期/平面向量', sub_topics: [] };
  assert.equal(quizReferences({ ...target, topic: '平面向量', scope, facet: { concept:'內積的定義' } }).length, 1);
  for (const overrides of [
    { facet:{ concept:'向量加減' } }, { topic:'空間向量／向量內積' },
    { level:'國中二年級' }, { exclusions:['不要出投影'] }, { topic:'平面向量' }
  ]) {
    assert.deepEqual(quizReferences({ ...target, ...overrides }), []);
  }
});

test('loads exact Chinese curriculum concepts containing punctuation', () => {
  const target = { subject: '國文', level: '高中一年級' };
  const punctuated = '韻腳、對仗與詩意理解';
  const reference = quizReferences({ ...target, topic: punctuated });
  assert.equal(reference.length, 2);
  assert.ok(reference.every(item => item.question.sub_topic === punctuated));
  assert.equal(quizReferences({ ...target, topic: '高中一年級／第一學期／古典韻文（核心考點細項：韻腳、對仗與詩意理解）' })[0].id, reference[0].id);
  const other = quizReferences({ ...target, topic: '主旨、段落結構、語氣' });
  assert.equal(other.length, 2);
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
    assert.equal(refs.length, 2, concept);
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
  assert.equal(formatted.length, 2);
  assert.ok(formatted.every(ref => ref.question.sub_topic === '意象、典故與詩風'));
  assert.deepEqual(quizReferences({ ...target, topic: '意象、典故與詩風', exclusions:['排除典故相關題型'] }), []);
  assert.deepEqual(quizReferences({ ...target, topic: '高中三年級寫作技巧' }), []);
});

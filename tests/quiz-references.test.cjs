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

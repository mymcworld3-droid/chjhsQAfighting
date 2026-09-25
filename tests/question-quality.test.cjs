const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  questionSkeleton,
  normalizeHistory,
  chooseQuestionForm,
  planQuestionBlueprint,
  duplicateReason,
  sanitizeGeneratedMetadata,
  validateGeneratedMetadata
} = require('../question-quality.cjs');

test('number/name variants share the same structural skeleton', () => {
  const a = '小明在長方形中，已知長為 8、寬為 6，求對角線長。';
  const b = '小明在長方形中，已知長為 12、寬為 5，求對角線長。';
  assert.equal(questionSkeleton(a), questionSkeleton(b));
});

test('structured history accepts legacy strings and rich metadata', () => {
  const history = normalizeHistory([
    '舊版題目',
    { q: '新版題目', templateId: 'rect-diagonal', conceptId: 'pythagorean', questionForm: 'application_modeling' }
  ]);
  assert.equal(history.length, 2);
  assert.equal(history[1].template_id, 'rect-diagonal');
  assert.equal(history[1].concept_id, 'pythagorean');
});

test('duplicate detector rejects exact, skeleton, template and rapid concept-form repeats', () => {
  assert.equal(duplicateReason({ q: '計算 3+4', template_id: 'sum', concept_id: 'addition', question_form: 'application' },
    [{ q: '計算 3+4' }]), 'exact-question');

  assert.equal(duplicateReason({ q: '長方形長 12 寬 5，求對角線', template_id: 'different', concept_id: 'pythagorean', question_form: 'application' },
    [{ q: '長方形長 8 寬 6，求對角線' }]), 'same-question-skeleton');

  assert.equal(duplicateReason({ q: '完全不同敘述甲乙丙丁', template_id: 'shared-template', concept_id: 'c2', question_form: 'reverse' },
    [{ q: '另一道不同題目甲乙丙丁', template_id: 'shared-template' }]), 'same-template');

  assert.equal(duplicateReason({ q: '新的題目內容需要推理甲乙丙', template_id: 'new-template', concept_id: 'same-concept', question_form: 'error-analysis' },
    [{ q: '舊題內容需要推理甲乙丙', template_id: 'old-template', concept_id: 'same-concept', question_form: 'error-analysis' }]),
    'same-concept-form-too-soon');
});

test('planner rotates away from the last three question forms', () => {
  const history = [
    { q: 'a', question_form: 'application_modeling' },
    { q: 'b', question_form: 'reverse_reasoning' },
    { q: 'c', question_form: 'error_analysis' }
  ];
  const chosen = chooseQuestionForm('數學', history, 0);
  assert.equal(['application_modeling', 'reverse_reasoning', 'error_analysis'].includes(chosen), false);
});

test('hard blueprint enforces deeper cognitive and reasoning requirements', () => {
  const plan = planQuestionBlueprint('數學', 'hard', [], 'fixed-seed');
  assert.equal(plan.cognitiveMin >= 3, true);
  assert.equal(plan.minReasoningSteps >= 3, true);

  const shallow = sanitizeGeneratedMetadata({
    concept_id: '畢氏定理',
    skill_id: '建模',
    template_id: 'rectangle-diagonal',
    question_form: plan.questionForm,
    cognitive_level: 2,
    reasoning_steps: 1
  }, plan, '畢氏定理');
  assert.match(validateGeneratedMetadata(shallow, plan), /認知層級|推理步驟/);

  const deep = { ...shallow, cognitive_level: plan.cognitiveMin, reasoning_steps: plan.minReasoningSteps };
  assert.equal(validateGeneratedMetadata(deep, plan), '');
});

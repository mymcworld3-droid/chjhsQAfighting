'use strict';

const DIFFICULTY_PROFILES = Object.freeze({
  easy: Object.freeze({
    minCognitive: 1, maxCognitive: 2, minReasoningSteps: 1,
    guidance: '以單一核心觀念為主，但仍需理解而非純背誦；可有一個簡短判斷或計算步驟。'
  }),
  medium: Object.freeze({
    minCognitive: 2, maxCognitive: 4, minReasoningSteps: 2,
    guidance: '至少需要兩個有意義的判斷／計算步驟，優先使用變形、比較、情境判讀或資料解讀，不可只是換數字套公式。'
  }),
  hard: Object.freeze({
    minCognitive: 3, maxCognitive: 5, minReasoningSteps: 3,
    guidance: '至少需要三個有意義的推理步驟，優先使用逆向推理、錯誤分析、陌生情境、多條件整合或跨表徵；禁止單步套公式、直接定義題與只換數字的例題。'
  })
});

const FORM_POOLS = Object.freeze({
  '數學': ['application_modeling', 'reverse_reasoning', 'error_analysis', 'multi_step_reasoning', 'representation_translation', 'concept_discrimination'],
  '物理': ['data_interpretation', 'causal_reasoning', 'experimental_reasoning', 'multi_step_calculation', 'error_analysis', 'real_world_transfer'],
  '化學': ['data_interpretation', 'experimental_reasoning', 'particle_to_macro', 'multi_step_calculation', 'error_analysis', 'real_world_transfer'],
  '生物': ['experimental_reasoning', 'data_interpretation', 'causal_reasoning', 'mechanism_explanation', 'error_analysis', 'scenario_transfer'],
  '歷史': ['source_inference', 'causal_chain', 'chronology_reasoning', 'perspective_comparison', 'evidence_evaluation', 'cross_context_transfer'],
  '地理': ['map_chart_interpretation', 'regional_comparison', 'causal_chain', 'multi_factor_reasoning', 'scenario_transfer', 'error_analysis'],
  '公民': ['case_application', 'institution_comparison', 'cause_effect_reasoning', 'evidence_evaluation', 'scenario_transfer', 'error_analysis'],
  '國文': ['contextual_interpretation', 'evidence_inference', 'structure_analysis', 'comparison_reasoning', 'error_analysis', 'cross_text_transfer'],
  '英文': ['contextual_usage', 'grammar_contrast', 'sentence_inference', 'paragraph_logic', 'reading_inference', 'error_analysis']
});

const DEFAULT_FORMS = Object.freeze([
  'application_reasoning', 'reverse_reasoning', 'error_analysis',
  'multi_step_reasoning', 'evidence_inference', 'scenario_transfer'
]);

function compact(value, max = 160) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？；：、,.!?;:'"「」『』（）()【】\[\]{}<>]/g, '');
}

function questionSkeleton(value) {
  return normalizeText(value)
    .replace(/[-+]?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?/g, '#')
    .replace(/[a-z][a-z0-9_]*/g, 'v');
}

function normalizeId(value, max = 100) {
  return compact(value, max).toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
}

function normalizeHistoryEntry(value) {
  if (typeof value === 'string') {
    const q = compact(value, 220);
    return q ? { q, concept_id: '', skill_id: '', template_id: '', question_form: '', cognitive_level: 0 } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const q = compact(value.q ?? value.question ?? value.data?.q, 220);
  if (!q) return null;
  return {
    q,
    concept_id: normalizeId(value.concept_id ?? value.conceptId ?? value.meta?.conceptId ?? value.meta?.concept_id),
    skill_id: normalizeId(value.skill_id ?? value.skillId ?? value.meta?.skillId ?? value.meta?.skill_id),
    template_id: normalizeId(value.template_id ?? value.templateId ?? value.meta?.templateId ?? value.meta?.template_id),
    question_form: normalizeId(value.question_form ?? value.questionForm ?? value.meta?.questionForm ?? value.meta?.question_form),
    cognitive_level: Number(value.cognitive_level ?? value.cognitiveLevel ?? value.meta?.cognitiveLevel ?? 0) || 0
  };
}

function normalizeHistory(values, max = 60) {
  return (Array.isArray(values) ? values : [])
    .map(normalizeHistoryEntry).filter(Boolean).slice(-Math.max(1, max));
}

function chooseQuestionForm(subject, history = [], randomValue = Math.random()) {
  const pool = FORM_POOLS[subject] || DEFAULT_FORMS;
  const recent = normalizeHistory(history, 12);
  const lastThree = new Set(recent.slice(-3).map(item => item.question_form).filter(Boolean));
  let available = pool.filter(form => !lastThree.has(form));
  if (!available.length) {
    const counts = Object.fromEntries(pool.map(form => [form, 0]));
    for (const item of recent) if (counts[item.question_form] !== undefined) counts[item.question_form]++;
    const minimum = Math.min(...Object.values(counts));
    available = pool.filter(form => counts[form] === minimum);
  }
  const n = Number.isFinite(Number(randomValue)) ? Number(randomValue) : 0;
  const index = Math.min(available.length - 1, Math.max(0, Math.floor(Math.abs(n % 1) * available.length)));
  return available[index] || pool[0];
}

function planQuestionBlueprint(subject, difficulty, history = [], randomSeed = '') {
  const profile = DIFFICULTY_PROFILES[difficulty] || DIFFICULTY_PROFILES.medium;
  let seedValue = 0;
  for (const char of String(randomSeed)) seedValue = (seedValue * 33 + char.charCodeAt(0)) >>> 0;
  const randomValue = (seedValue % 10000) / 10000;
  const questionForm = chooseQuestionForm(subject, history, randomValue);
  return {
    questionForm,
    cognitiveMin: profile.minCognitive,
    cognitiveMax: profile.maxCognitive,
    minReasoningSteps: profile.minReasoningSteps,
    guidance: profile.guidance
  };
}

function sanitizeGeneratedMetadata(parsed, plan, targetTopic) {
  const questionForm = normalizeId(parsed?.question_form || plan.questionForm);
  return {
    concept_id: normalizeId(parsed?.concept_id || parsed?.concept || targetTopic, 100),
    skill_id: normalizeId(parsed?.skill_id || parsed?.skill || questionForm, 100),
    template_id: normalizeId(parsed?.template_id || '', 120),
    question_form: questionForm,
    cognitive_level: Number(parsed?.cognitive_level) || 0,
    reasoning_steps: Number(parsed?.reasoning_steps) || 0,
    target_misconception: compact(parsed?.target_misconception, 120)
  };
}

function validateGeneratedMetadata(meta, plan) {
  if (!meta.concept_id || meta.concept_id.length < 2) return '缺少可追蹤的 concept_id';
  if (!meta.skill_id || meta.skill_id.length < 2) return '缺少可追蹤的 skill_id';
  if (!meta.template_id || meta.template_id.length < 3) return '缺少可追蹤的 template_id';
  if (meta.question_form !== normalizeId(plan.questionForm)) return 'question_form 未遵守題目藍圖';
  if (!Number.isInteger(meta.cognitive_level) ||
      meta.cognitive_level < plan.cognitiveMin || meta.cognitive_level > plan.cognitiveMax) {
    return '認知層級與指定難度不符';
  }
  if (!Number.isInteger(meta.reasoning_steps) || meta.reasoning_steps < plan.minReasoningSteps) {
    return '推理步驟不足';
  }
  return '';
}

function duplicateReason(candidate, history = []) {
  const current = normalizeHistoryEntry(candidate);
  if (!current) return '題目內容無效';
  const recent = normalizeHistory(history, 60);
  const exact = normalizeText(current.q);
  if (recent.some(old => normalizeText(old.q) === exact)) return 'exact-question';

  const skeleton = questionSkeleton(current.q);
  if (skeleton.length >= 10 && recent.slice(-30).some(old => questionSkeleton(old.q) === skeleton)) {
    return 'same-question-skeleton';
  }
  if (current.template_id && recent.slice(-18).some(old => old.template_id && old.template_id === current.template_id)) {
    return 'same-template';
  }
  if (current.concept_id && current.question_form &&
      recent.slice(-4).some(old => old.concept_id === current.concept_id && old.question_form === current.question_form)) {
    return 'same-concept-form-too-soon';
  }
  return '';
}

function historyForPrompt(history = [], max = 30) {
  return normalizeHistory(history, max).map(item => ({
    q: item.q,
    concept_id: item.concept_id || undefined,
    template_id: item.template_id || undefined,
    question_form: item.question_form || undefined
  }));
}

module.exports = {
  DIFFICULTY_PROFILES,
  FORM_POOLS,
  normalizeText,
  questionSkeleton,
  normalizeHistory,
  chooseQuestionForm,
  planQuestionBlueprint,
  sanitizeGeneratedMetadata,
  validateGeneratedMetadata,
  duplicateReason,
  historyForPrompt
};

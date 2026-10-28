'use strict';
// Compact generation instruction. Existing server validation is always retained.
const MODES = new Set(['raid-quick-simple', 'raid-standard', 'battle-fast', 'immortal-fast']);
const { ANSWER_AND_EXPLANATION_RULES, subjectReliabilityPrompt } = require('./quiz-answer-prompt.cjs');
const Knowledge = require('./public/cultivation/knowledge-points.js');
function quickQuizPrompt({ mode, subject, level, topic, rank, difficulty, previousQuestions = [],
  previousMeta = [], targetForm = '', quality = {}, retryIssue = '', randomSeed = '', knowledgePointId = '', generationTaskId = '', adaptiveFields = null } = {}) {
  if (!MODES.has(mode)) throw new Error('Unsupported fast quiz mode');
  const safe = (value, n=140) => String(value ?? '').slice(0,n);
  const previous = previousQuestions.slice(-10).map(value => safe(value,140));
  const previousForms = previousMeta.slice(-7).map(item => [safe(item.concept_id,45),safe(item.template_id,60),safe(item.question_form,35)]);
  const quick = mode === 'raid-quick-simple';
  const spec = {
    q: '完整題幹', correct: '唯一正解',
    wrong: ['確定錯誤一','確定錯誤二','確定錯誤三'],
    exp: '精簡且答案一致的解析', subject: safe(subject,40), sub_topic: safe(topic,180),
    knowledge_points:[{subject:Knowledge.subject(subject),id:'清單中的 ID',name:'清單中的名稱'}],
    concept_id: '考點短ID', template_id: '解題骨架短ID', question_form: safe(targetForm,40),
    ...(generationTaskId ? {generation_task_id:safe(generationTaskId,100)} : {}),
    ...(adaptiveFields||{}),
    cognitive_level: quick ? 1 : Number.parseInt(quality.cognitive,10) || 2,
    reasoning_steps: quick ? 1 : Number.parseInt(quality.steps,10) || 2
  };
  return [
    '你是台灣國教專業教師。只出一道高品質繁體中文單選題，回傳純 JSON。',
    ANSWER_AND_EXPLANATION_RULES,
    subjectReliabilityPrompt(subject),
    '科目='+safe(subject,40)+'；程度='+safe(level,32)+'；指定範圍='+safe(topic,180)+'；難度='+
      (quick?'easy':safe(difficulty,16))+'；段位='+Number(rank||0)+'；隨機種子='+safe(randomSeed,24),
    '保持指定學制與難度，題目清楚而有實質理解、推理深度；勿冗長敘事。',
    '題型='+safe(targetForm,40)+'；認知層級='+(quick?1:quality.cognitive||2)+
      '；推理步數='+(quick?1:quality.steps||2),
    !quick && quality.instruction ? '深度要求：'+safe(quality.instruction,300) : '',
    '獨立解題、逐項核對四個選項。只能一個正解，三個錯誤選項不可與正解等價或互相同義。',
    Knowledge.promptFor(subject, knowledgePointId),
    '題目請要整齊。',
    '發現錯題直接重寫 q、correct、wrong、exp，解析禁止「本題有錯」「原答案錯誤」「更正」等修訂註記。',
    '不得附帶選項於題幹、引用不存在的圖片、超綱或跨科。',
    '數學式用 $...$，JSON 反斜線正確跳脫。',
    '最近題目：'+JSON.stringify(previous),
    '近期考點／骨架／形式：'+JSON.stringify(previousForms),
    retryIssue ? '上次失敗：'+safe(retryIssue,280)+'。完整重新生成 JSON，禁止僅在解析註記錯誤。' : '',
    '只回傳這個 JSON 結構（內容請依題目替換）：'+JSON.stringify(spec)
  ].filter(Boolean).join('\n');
}
module.exports = { MODES, quickQuizPrompt };

import { pickBattleKnowledge } from './battle-question-scope.js';

function randomId(prefix = 'raidq') {
  if (globalThis.crypto?.randomUUID) return prefix + '-' + crypto.randomUUID();
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

export function normalizeRaidQuestion(raw, request) {
  const source = Array.isArray(raw) ? raw[0] : (raw?.questions?.[0] || raw || {});
  const q = String(source.q ?? source.question ?? '').trim();
  let opts = Array.isArray(source.opts) ? [...source.opts] : Array.isArray(source.options) ? [...source.options] : null;
  let ans = source.ans ?? source.answer ?? source.correctIndex;
  if (!opts && typeof source.correct === 'string' && Array.isArray(source.wrong)) {
    opts = [source.correct, ...source.wrong];
    ans = 0;
  }
  if (!Array.isArray(opts)) throw new Error('題目缺少單選選項');
  if (typeof ans === 'string' && /^[A-Da-d]$/.test(ans.trim())) ans = ans.trim().toUpperCase().charCodeAt(0) - 65;
  if (!Number.isInteger(Number(ans)) && typeof ans === 'string') ans = opts.findIndex(item => String(item) === ans);
  ans = Number(ans);
  const choices = opts.map(value => String(value ?? '').trim());
  const unique = new Set(choices.map(value => value.replace(/\s+/g, '').toLowerCase()));
  const exp = String(source.exp ?? source.explanation ?? '').trim();
  if (q.length < 5 || choices.length !== 4 || choices.some(value => !value) || unique.size !== 4 ||
      !Number.isInteger(ans) || ans < 0 || ans >= 4 || exp.length < 5) throw new Error('題目格式或答案無效');
  const asked = Array.isArray(request.avoidQuestions) ? request.avoidQuestions : [];
  const fingerprint = value => String(value).replace(/\s+/g, '').toLowerCase();
  if (asked.some(previous => fingerprint(previous) === fingerprint(q))) throw new Error('本場出現重複題目');
  if (source.subject && String(source.subject).trim() !== request.subject) throw new Error('AI 題目科目與指定範圍不符');
  for (let i = choices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
    if (ans === i) ans = j;
    else if (ans === j) ans = i;
  }
  return {
    id: randomId(), q, opts: choices, ans, exp,
    subject: request.subject,
    topic: request.specificTopic || String(source.sub_topic || ''),
    level: request.level,
    concept_id: String(source.concept_id || '').slice(0, 100),
    template_id: String(source.template_id || '').slice(0, 120),
    question_form: String(source.question_form || '').slice(0, 60),
    cognitive_level: Math.max(1, Math.min(5, Number(source.cognitive_level) || 1)),
    reasoning_steps: Math.max(1, Math.min(6, Number(source.reasoning_steps) || 1))
  };
}

export async function generateRaidQuestion({ scope, round, rank = 0, history = [] } = {}) {
  const selected = pickBattleKnowledge(scope, round);
  const recent = (Array.isArray(history) ? history : []).slice(-30);
  const request = {
    ...selected,
    rank: Math.max(0, Number(rank) || 0),
    avoidQuestions: recent.map(item => String(item?.q || '')).filter(Boolean),
    avoidQuestionMeta: recent.map(item => ({
      q: String(item?.q || ''),
      concept_id: String(item?.concept_id || ''),
      template_id: String(item?.template_id || ''),
      question_form: String(item?.question_form || ''),
      cognitive_level: Number(item?.cognitive_level) || 1,
      reasoning_steps: Number(item?.reasoning_steps) || 1
    }))
  };
  const response = await fetch('/api/generate-quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });
  if (!response.ok) throw new Error('quiz api ' + response.status);
  const body = await response.json();
  let raw = body?.text ?? body;
  if (typeof raw === 'string') {
    raw = raw.trim();
    const fence = String.fromCharCode(96).repeat(3);
    if (raw.startsWith(fence)) {
      const firstLine = raw.indexOf('\n');
      const lastFence = raw.lastIndexOf(fence);
      raw = raw.slice(firstLine >= 0 ? firstLine + 1 : 3, lastFence > 0 ? lastFence : raw.length).trim();
    }
    raw = JSON.parse(raw);
  }
  return normalizeRaidQuestion(raw, request);
}

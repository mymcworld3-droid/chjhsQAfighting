'use strict';

// Generated questions are text only. Reject prompts that depend on an absent
// figure and explanations that explicitly contradict or correct the answer.
const { questionIntegrityIssue } = require('./question-answer-integrity.cjs');
const MathGuard = require('./public/cultivation/math-guard.js');

function questionQualityIssue({ q, correct, wrong, exp } = {}) {
  // Partial legacy checks still report their specific problems; full generated
  // questions receive the stronger answer/explanation consistency verification.
  if (typeof correct === 'string' && Array.isArray(wrong) && wrong.length === 3 &&
      typeof exp === 'string') {
    const concreteIssue = questionIntegrityIssue({ q, correct, wrong, exp });
    if (concreteIssue) return concreteIssue;
  }
  // Validate TeX even when a human-readable explanation superficially looks correct.
  for (const piece of [q, correct, ...(Array.isArray(wrong) ? wrong : []), exp]) {
    const checked = MathGuard.inspect(piece);
    if (!checked.valid) return '數學公式定界符或結構不完整';
  }
  const stem = String(q || '');
  const explanation = String(exp || '');
  if (/(?:正確答案|本題正解)\s*(?:[:：]|(?:是|為)(?!何|什麼|哪|多少|幾|否))/.test(stem)) return '題幹直接洩漏正解';
  const errorIdentification = /(?:文法|語法|用字|用詞|語病).*(?:錯|誤)|(?:找出|何者|哪個).*(?:錯誤|不正確)|\b(?:error|incorrect|mistake)\b/i.test(stem);
  if (errorIdentification) {
    const labels = stem.match(/[（(][A-D][）)]/g) || [];
    const marks = [...stem.matchAll(/<u\b[^>]*>([\s\S]*?)<\/u>|\\underline\{([^{}]*)\}|\*\*([^*]+)\*\*|__([^_]+)__/gi)]
      .map(match => match.slice(1).find(value => value !== undefined) || '');
    const clean = value => String(value || '').replace(/[（(][A-D][）)]/g, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    const answer = clean(correct);
    const markedAnswers = marks.filter(value => answer && clean(value) === answer);
    if ((labels.length > 0 && labels.length < 4) || (markedAnswers.length > 0 && marks.length === markedAnswers.length)) {
      return '題幹只標示錯誤位置或正解，洩漏答案；請取消標記並讓玩家自行判斷';
    }
  }
  if (/(?:附圖|下圖|右圖|左圖|如圖所示|圖中所示)/.test(stem)) return '題目引用未提供的圖片';
  if (/[（(][A-D][）)]/.test(stem) && (stem.match(/[（(][A-D][）)]/g) || []).length >= 3) {
    return '題幹重複列出會再被排序的選項';
  }
  if (/(?:題目|數據|資料|條件|選項).{0,20}(?:矛盾|衝突|不一致|有誤)|(?:矛盾|衝突|不一致).{0,20}(?:題目|數據|資料|條件|選項)/.test(explanation)) {
    return '解析指出題目條件互相矛盾';
  }
  if (/(?:修正|更正).{0,16}(?:答案|正解)|(?:答案|正解).{0,12}(?:修正|更正)/.test(explanation)) {
    return '解析自行修正答案';
  }
  const alternatives = Array.isArray(wrong) ? wrong : [];
  for (const option of alternatives) {
    const value = String(option || '').trim();
    if (value.length >= 2 && explanation.includes(value) &&
        new RegExp('(?:正確答案|正解|答案應為|因此選|故選)[^。；\n]{0,20}' + escapeRegExp(value)).test(explanation)) {
      return '解析將錯誤選項稱為正解';
    }
  }
  return '';
}

// The browser shuffles the four answers. AI-authored A/B/C/D references in an
// explanation describe an imagined order and can point at the wrong choice.
function removeUnstableOptionLabels(explanation) {
  return String(explanation || '')
    .replace(/(?:錯誤\s*)?(?:選項|答案)\s*第?\s*[一二三四1-4](?:項|個)?/g, '相關敘述')
    .replace(/第[一二三四1-4]項(?=\s*(?:的|是|為|正確|錯誤|與|雖|則|將|過度|強調))/g, '相關敘述')
    .replace(/(?:選項|答案)\s*[（(]?[A-D][）)]?/gi, '相關敘述')
    .replace(/[（(][A-D][）)](?=\s*(?:的|是|為|正確|錯誤|與|雖|則|將|過度|強調))/gi, '相關敘述');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { questionQualityIssue, removeUnstableOptionLabels };

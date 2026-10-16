'use strict';

// Lightweight, deterministic checks supplement (but do not replace) independent
// model review. Only block issues provable from the returned data.
const clean = value => String(value ?? '').normalize('NFKC')
  .replace(/\u00a0/g, ' ').trim();
const normalized = value => clean(value)
  .replace(/^\s*(?:\\\(|\\\[|\$\$?)/, '')
  .replace(/(?:\\\)|\\\]|\$\$?)\s*$/, '')
  .replace(/[「」『』"'\s。，．.；;！!]/g, '')
  .toLowerCase();

function solutionCorrectionNote(explanation) {
  const s = clean(explanation);
  return /(?:這|此|本|原)(?:題|題目|試題).{0,16}(?:有誤|出錯|錯誤|不成立|有問題|不合理|矛盾)|(?:原(?:本)?(?:正確)?答案|原(?:本)?解析|原(?:本)?選項).{0,20}(?:錯誤|不正確|有誤|更正|修正|應改|改為)|(?:需|需要|應|必須)(?:把|將)?(?:原題|題目|正解|答案|選項).{0,14}(?:修改|修正|更正|改成|改為)|(?:更正|修正)(?:後)?(?:的)?(?:答案|解析)|(?:題目|答案|解析).{0,18}(?:應該修正|需要修正)/.test(s);
}

function explicitSolutionAnswer(explanation) {
  const s = clean(explanation);
  // Only a clearly delimited answer statement is strong enough for a hard
  // mismatch: do not infer a numeric answer from unrelated intermediate steps.
  const patterns = [
    /(?:正確答案|標準答案|最終答案|唯一正解|答案應為|答案為|答案是|正解為|正解是|故選|應選|因此選)\s*(?:[:：]|為|是)?\s*[「『"'（(]?\s*([^\s,，。；;。\n「」『』"'（）()]{1,100})/gi
  ];
  const results = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(s)) !== null && results.length < 6) {
      const answer = normalized(match[1]);
      if (answer) results.push(answer);
    }
  }
  return results;
}

function arithmeticExpected(question) {
  const stem = clean(question);
  // Only expressions explicitly asking the result of a single integer
  // arithmetic operation; never evaluate arbitrary user-provided JavaScript.
  const match = /(?:計算|求|試求|算出|等於|=|？|\?)\s*[:：]?\s*[\(（]?\s*(-?\d{1,6})\s*([+＋\-−×*÷/])\s*(-?\d{1,6})\s*[\)）]?\s*(?:=|等於|的值|結果|是多少|為何|[？?])?/u.exec(stem)
    || /^\s*(-?\d{1,6})\s*([+＋\-−×*÷/])\s*(-?\d{1,6})\s*(?:=|等於|的值|結果|是多少|為何|[？?])/u.exec(stem);
  if (!match) return null;
  const a = Number(match[1]), b = Number(match[3]);
  let answer;
  switch (match[2]) {
    case '+': case '＋': answer = a + b; break;
    case '-': case '−': answer = a - b; break;
    case '×': case '*': answer = a * b; break;
    case '÷': case '/': answer = b ? a / b : NaN; break;
    default: return null;
  }
  return Number.isSafeInteger(answer) ? String(answer) : null;
}

function questionIntegrityIssue(input, { rejectRepairNotes = true } = {}) {
  const q = clean(input?.q), correct = clean(input?.correct);
  const wrong = Array.isArray(input?.wrong) ? input.wrong.map(clean) : [];
  const exp = clean(input?.exp);
  if (!q || !correct || wrong.length !== 3 || !exp ||
    wrong.some(x => !x) ||
    new Set([correct, ...wrong].map(normalized)).size !== 4)
    return '題目、唯一正解、三個錯誤選項或完整解析的結構有誤';
  if (rejectRepairNotes && solutionCorrectionNote(exp))
    return '解析包含題目出錯或修改答案的註記；必須直接產出全新且正確的完整解析';
  const choices = [correct, ...wrong];
  const answerSignals = explicitSolutionAnswer(exp);
  for (const answer of answerSignals) {
    const matchingChoices = choices.filter(x => normalized(x) === answer);
    if (matchingChoices.length && normalized(correct) !== answer)
      return '解析所標示的最終答案與 correct 不一致';
  }
  const expected = arithmeticExpected(q);
  if (expected !== null && choices.every(x => /^-?\d+$/.test(normalized(x))) &&
      normalized(correct) !== expected)
    return '題目明確算式的數值答案與 correct 不一致';
  return '';
}

module.exports = { questionIntegrityIssue, solutionCorrectionNote, explicitSolutionAnswer, arithmeticExpected };

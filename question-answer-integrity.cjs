'use strict';

// Lightweight, deterministic checks supplement (but do not replace) independent
// model review. Only block issues provable from the returned data.
const clean = value => String(value ?? '').normalize('NFKC')
  .replace(/\u00a0/g, ' ').trim();
const normalized = value => clean(value)
  .replace(/^\s*(?:\\\(|\\\[|\$\$?)/, '')
  .replace(/(?:\\\)|\\\]|\$\$?)\s*$/, '')
  .replace(/^(['"])([\s\S]*)\1$/, '$2')
  .replace(/[’‘]/g, "'")
  .replace(/[「」『』"\s。，．；;！!]/g, '').replace(/\.+$/, '')
  .toLowerCase();

function numericAnswer(value) {
  let s = clean(value).replace(/[。.]$/, '').replace(/\$/g, '')
    .replace(/\\[()[\]]/g, '').replace(/\\(?:left|right|displaystyle)\b/g, '')
    .replace(/\\[,!;: ]/g, '').replace(/\s/g, '').replace(/−/g, '-');
  if (s.length > 100) return null;
  s = s.replace(/^\\boxed\{([\s\S]*)\}$/, '$1');
  const fraction = /^([+-]?)\\(?:dfrac|tfrac|frac)\{([+-]?\d{1,24})\}\{([+-]?\d{1,24})\}$/.exec(s);
  if (fraction) s = String(BigInt(fraction[2]) * (fraction[1] === '-' ? -1n : 1n)) + '/' + fraction[3];
  const ratio = /^([+-]?\d{1,24})\/([+-]?\d{1,24})$/.exec(s);
  const decimal = /^([+-]?)(\d{1,24})(?:\.(\d{1,24}))?$/.exec(s);
  let numerator, denominator;
  if (ratio) { numerator = BigInt(ratio[1]); denominator = BigInt(ratio[2]); }
  else if (decimal) {
    numerator = BigInt(decimal[2] + (decimal[3] || '')) * (decimal[1] === '-' ? -1n : 1n);
    denominator = 10n ** BigInt((decimal[3] || '').length);
  } else return null;
  if (!denominator) return null;
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  let a = numerator < 0n ? -numerator : numerator, b = denominator;
  while (b) { const remainder = a % b; a = b; b = remainder; }
  numerator /= a; denominator /= a;
  return denominator === 1n ? String(numerator) : `${numerator}/${denominator}`;
}
const answerKey = value => numericAnswer(value) ?? normalized(value);

function solutionCorrectionNote(explanation) {
  const s = clean(explanation);
  return /(?:這|此|本|原)(?:題|題目|試題).{0,16}(?:有誤|出錯|錯誤|不成立|有問題|不合理|矛盾)|(?:原(?:本)?(?:正確)?答案|原(?:本)?解析|原(?:本)?選項).{0,20}(?:錯誤|不正確|有誤|更正|修正|應改|改為)|(?:需|需要|應|必須)(?:把|將)?(?:原題|題目|正解|答案|選項).{0,14}(?:修改|修正|更正|改成|改為)|(?:更正|修正)(?:後)?(?:的)?(?:答案|解析)|(?:題目|答案|解析).{0,18}(?:應該修正|需要修正)/.test(s);
}

function explicitSolutionAnswer(explanation) {
  const s = clean(explanation);
  // Only a clearly delimited answer statement is strong enough for a hard
  // mismatch: do not infer a numeric answer from unrelated intermediate steps.
  const value = String.raw`(\${1,2}[^$\n]{1,180}\${1,2}|\\\([^\n]{1,180}?\\\)|[+-]?\s*\\(?:dfrac|tfrac|frac)\s*\{[+-]?\d{1,24}\}\s*\{[+-]?\d{1,24}\}|[^\s,，。；;\n「」『』"'（）()]{1,100})`;
  const patterns = [
    new RegExp(String.raw`(?:正確答案|標準答案|最終答案|唯一正解|答案應為|答案為|答案是|正解為|正解是|故選|應選|因此選)\s*(?:[:：]|為|是)?\s*[「『"'（(]?\s*` + value, 'gi'),
    new RegExp(String.raw`(?:因此|所以|故|可得)[，,\s]*(?:所求|最短|垂直)?(?:距離|面積|體積|長度|周長|角度|機率|速度|加速度|電流|電壓|電阻|功率|結果|數值)?(?:為|是|等於)\s*` + value + String.raw`\s*[。.!！]?\s*$`, 'gi')
  ];
  const results = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(s)) !== null && results.length < 6) {
      const answer = answerKey(match[1]);
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
    new Set([correct, ...wrong].map(answerKey)).size !== 4)
    return '題目、唯一正解、三個錯誤選項或完整解析的結構有誤';
  if (rejectRepairNotes && solutionCorrectionNote(exp))
    return '解析包含題目出錯或修改答案的註記；必須直接產出全新且正確的完整解析';
  const choices = [correct, ...wrong];
  const answerSignals = explicitSolutionAnswer(exp);
  for (const answer of answerSignals) {
    const matchingChoices = choices.filter(x => answerKey(x) === answer);
    const numericChoices = choices.every(x => numericAnswer(x) !== null);
    if ((matchingChoices.length || numericChoices && numericAnswer(answer) !== null) && answerKey(correct) !== answer)
      return '解析所標示的最終答案與 correct 不一致';
  }
  const expected = arithmeticExpected(q);
  if (expected !== null && choices.every(x => /^-?\d+$/.test(normalized(x))) &&
      normalized(correct) !== expected)
    return '題目明確算式的數值答案與 correct 不一致';
  return '';
}

module.exports = { questionIntegrityIssue, solutionCorrectionNote, explicitSolutionAnswer, arithmeticExpected, numericAnswer, answerKey };

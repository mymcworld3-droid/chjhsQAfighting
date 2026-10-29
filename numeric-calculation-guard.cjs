'use strict';

// A bounded arithmetic grammar, never eval/Function. Unknown notation is not
// evidence of an error. Rationals stay exact; irrational roots use a tolerance.
function rational(n, d = 1n) {
  if (!d || n.toString().length > 256 || d.toString().length > 256) throw Error('range');
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n, b = d;
  while (b) { const r = a % b; a = b; b = r; }
  n /= a; d /= a;
  return { n, d, value: Number(n) / Number(d) };
}
function bounded(value) {
  if (!Number.isFinite(value.value) || Math.abs(value.value) > 1e100) throw Error('range');
  return value;
}
function calculate(a, op, b) {
  if (op === '^') {
    if (!Number.isInteger(b.value) || Math.abs(b.value) > 12) throw Error('power');
    if (a.value === 0 && b.value <= 0) throw Error('undefined');
    if (a.n !== undefined && b.n !== undefined) {
      const p = BigInt(Math.abs(b.value));
      return bounded(b.value < 0 ? rational(a.d ** p, a.n ** p) : rational(a.n ** p, a.d ** p));
    }
  } else if (a.n !== undefined && b.n !== undefined) {
    if (op === '+') return bounded(rational(a.n * b.d + b.n * a.d, a.d * b.d));
    if (op === '-') return bounded(rational(a.n * b.d - b.n * a.d, a.d * b.d));
    if (op === '*') return bounded(rational(a.n * b.n, a.d * b.d));
    if (op === '/') return bounded(rational(a.n * b.d, a.d * b.n));
  }
  return bounded({ value: op === '+' ? a.value + b.value : op === '-' ? a.value - b.value
    : op === '*' ? a.value * b.value : op === '/' ? a.value / b.value : a.value ** b.value });
}
function squareRoot(a) {
  if (a.value < 0) throw Error('complex');
  if (a.n !== undefined) {
    const n = Math.sqrt(Number(a.n)), d = Math.sqrt(Number(a.d));
    if (Number.isSafeInteger(n) && Number.isSafeInteger(d) && BigInt(n) ** 2n === a.n && BigInt(d) ** 2n === a.d)
      return rational(BigInt(n), BigInt(d));
  }
  return bounded({ value: Math.sqrt(a.value) });
}
function normalizeNotation(text) {
  const superscripts = {'⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁺':'+','⁻':'-'};
  return String(text ?? '').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, exponent =>
    '^{'+[...exponent].map(c => superscripts[c]).join('')+'}').normalize('NFKC')
    .replace(/\\(?:left|right|displaystyle|textstyle)\b/g, '')
    .replace(/\\(?:quad|qquad)\b|\\[,!;: ]/g, ' ')
    .replace(/\\[()[\]]|\$\$?/g, '')
    .replace(/\\(?:times|cdot)\b|[×·]/g, '*')
    .replace(/\\div\b|÷/g, '/').replace(/[−–]/g, '-');
}

function numericExpression(input) {
  const text = normalizeNotation(input).trim();
  if (!text || text.length > 400) return null;
  try {
    const tokens = [];
    for (let i = 0; i < text.length;) {
      if (/\s/.test(text[i])) { i++; continue; }
      const number = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(text.slice(i));
      const command = /^\\(frac|dfrac|tfrac|sqrt)\b/.exec(text.slice(i));
      if (number) {
        if (number[0].length > 32) return null;
        const [whole, decimals = ''] = number[0].split('.');
        tokens.push(rational(BigInt((whole || '0') + decimals), 10n ** BigInt(decimals.length)));
        i += number[0].length;
      } else if (command) {
        tokens.push(command[1] === 'sqrt' ? 'sqrt' : 'frac'); i += command[0].length;
      } else if ('+-*/^(){}|√'.includes(text[i])) {
        tokens.push(text[i] === '√' ? 'sqrt' : text[i]); i++;
      } else return null;
      if (tokens.length > 160) return null;
    }
    let at = 0, depth = 0;
    function group(open, close) {
      if (tokens[at++] !== open || ++depth > 20) throw Error('group');
      const value = sum();
      if (tokens[at++] !== close) throw Error('group');
      depth--;
      return value;
    }
    function atom() {
      const token = tokens[at];
      if (token && typeof token === 'object') { at++; return token; }
      if (token === '(') return group('(', ')');
      if (token === '{') return group('{', '}');
      if (token === '|') {
        const value = group('|', '|');
        return value.value < 0 ? calculate(rational(-1n), '*', value) : value;
      }
      if (token === 'frac') {
        at++;
        const numerator = group('{', '}'), denominator = group('{', '}');
        return calculate(numerator, '/', denominator);
      }
      if (token === 'sqrt') {
        at++;
        // Require an explicit radicand group: do not guess the scope of √38+2.
        return squareRoot(tokens[at] === '{' ? group('{', '}') : group('(', ')'));
      }
      throw Error('atom');
    }
    function unary() {
      if (++depth > 20) throw Error('depth');
      const token = tokens[at];
      let value;
      if (token === '+' || token === '-') {
        at++; value = unary();
        if (token === '-') value = calculate(rational(-1n), '*', value);
      } else {
        value = atom();
        if (tokens[at] === '^') { at++; value = calculate(value, '^', unary()); }
      }
      depth--;
      return value;
    }
    function product() {
      let value = unary();
      while (tokens[at] === '*' || tokens[at] === '/' || tokens[at] === '(' || tokens[at] === '{' || tokens[at] === 'sqrt') {
        const op = tokens[at];
        if (op === '*' || op === '/') at++;
        value = calculate(value, op === '/' ? '/' : '*', unary());
      }
      return value;
    }
    function sum() {
      let value = product();
      while (tokens[at] === '+' || tokens[at] === '-') {
        const op = tokens[at++]; value = calculate(value, op, product());
      }
      return value;
    }
    const result = sum();
    return at === tokens.length ? bounded(result) : null;
  } catch (_) { return null; }
}
function sameValue(a, b) {
  if (a.n !== undefined && b.n !== undefined) return a.n === b.n && a.d === b.d;
  return Math.abs(a.value - b.value) <= 1e-10 * Math.max(1e-12, Math.abs(a.value), Math.abs(b.value));
}

function numericCalculationIssue(explanation) {
  const text = normalizeNotation(explanation);
  if (text.length > 12000) return '';
  for (const sentence of text.split(/[。；;！？!?\n]/)) {
    // False equations can legitimately be discussed or quoted. Rounded work is
    // not exact equality. Prefer a miss over rejecting such teaching material.
    if (/[錯誤約≈≠「」『』“”"]|並非|不能|不可|不應|不成立|不等|近似|(?:取|保留|精確至).{0,8}位|有效數字|取整|截尾|四捨五入|\\(?:approx|ne|neq)\b|\b(?:wrong|incorrect|false|not|round\w*|approx\w*)\b/i.test(sentence)) continue;
    // Keep unknown symbols, Latin/Greek variables, subscripts, ratios and units
    // in each side. Clipping π+3=6.14 to +3=6.14 would be a false rejection.
    for (const run of sentence.matchAll(/(?:(?!\p{Script=Han})[\p{L}\p{N}\p{M}\p{S}\\{}()[\]+\-*/^.=|\s_,:%'′])+/gu)) {
      if (!run[0].includes('=')) continue;
      // A Chinese variable must not disappear at the prose boundary either:
      // 甲 + 3 = 4 is symbolic, whereas 計算 -3 + 4 = 1 is an assertion.
      const prefix = sentence.slice(0, run.index).trimEnd();
      if (/\p{Script=Han}$/u.test(prefix) && /^[+\-*/^(]/.test(run[0].trim()) &&
          !/(?:計算|運算|得到|可得|相加|相減|相乘|相除|代入|總和|結果|展開|為|是|即|得)$/.test(prefix)) continue;
      const sides = run[0].trim().replace(/^[,:]+|[,:]+$/g, '').trim().replace(/\.$/, '').split('=');
      for (let i = 1; i < sides.length; i++) {
        // Always parse WHOLE adjacent sides. Never turn x+9+24+25=38 into
        // 9+24+25=38, nor drop unsupported units/functions from one side.
        const left = numericExpression(sides[i - 1]), right = numericExpression(sides[i]);
        if (left && right && !sameValue(left, right)) {
          const detail = `${sides[i - 1].trim()} = ${sides[i].trim()}`.slice(0, 160);
          return '解析中的數值等式計算不成立：' + detail + '；必須重新計算並重寫整題與選項';
        }
      }
    }
  }
  return '';
}

module.exports = { numericExpression, numericCalculationIssue };

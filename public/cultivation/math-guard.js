// Guard malformed math from untrusted AI/bank text before MathJax attempts typesetting.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QAMathGuard = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const escape = text => String(text ?? '').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function isEscaped(text, at) {
    let count = 0;
    for (let k = at - 1; k >= 0 && text[k] === '\\'; k--) count++;
    return count % 2 === 1;
  }
  function tokenAt(text, at) {
    if (isEscaped(text, at)) return null;
    for (const [mark, kind, open] of [
      ['$$', 'display-dollar', true], ['\\[', 'display-bracket', true],
      ['\\]', 'display-bracket', false], ['\\(', 'inline-bracket', true],
      ['\\)', 'inline-bracket', false], ['$', 'inline-dollar', true]
    ]) if (text.startsWith(mark, at)) return { mark, kind, open };
    return null;
  }
  const symbols = Object.freeze({times:'×',cdot:'·',div:'÷',pm:'±',mp:'∓',le:'≤',leq:'≤',ge:'≥',geq:'≥',ne:'≠',neq:'≠',
    approx:'≈',equiv:'≡',infty:'∞',pi:'π',theta:'θ',alpha:'α',beta:'β',gamma:'γ',delta:'δ',Delta:'Δ',lambda:'λ',mu:'μ',
    sigma:'σ',Sigma:'Σ',omega:'ω',Omega:'Ω',phi:'φ',epsilon:'ε',rho:'ρ',tau:'τ',nu:'ν',eta:'η',degree:'°',
    in:'∈',notin:'∉',subset:'⊂',subseteq:'⊆',cup:'∪',cap:'∩',emptyset:'∅',to:'→',rightarrow:'→',leftarrow:'←',leftrightarrow:'↔',
    Rightarrow:'⇒',Leftrightarrow:'⇔',therefore:'∴',because:'∵',ldots:'…',cdots:'⋯',angle:'∠',perp:'⊥',parallel:'∥'});
  const argumentsFor = Object.freeze({frac:2,dfrac:2,tfrac:2,sqrt:1,vec:1,overline:1,bar:1,hat:1,mathrm:1,mathbf:1,text:1,underline:1,binom:2});
  function decodeEntities(value) {
    const named = {lt:'<',gt:'>',amp:'&',quot:'"',apos:"'",nbsp:' ',times:'×',divide:'÷',plusmn:'±',radic:'√',infin:'∞',
      le:'≤',leq:'≤',ge:'≥',geq:'≥',ne:'≠',neq:'≠',...symbols};
    return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity,key) => {
      if (key[0] !== '#') return named[key] ?? entity;
      const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
      return code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
    });
  }
  function argument(text, at) {
    let start = at;
    while (/\s/.test(text[start] || '') && start < text.length) start++;
    if (text[start] !== '{') return null;
    let depth = 1;
    for (let i = start + 1; i < text.length; i++) {
      if (!isEscaped(text,i)) {
        if (text[i] === '{') depth++;
        if (text[i] === '}' && --depth === 0) return {body:text.slice(start+1,i),end:i+1};
      }
    }
    return null;
  }
  function bareMath(prose, plain = false) {
    let output = '';
    for (let i = 0; i < prose.length;) {
      const command = prose[i] === '\\' && !isEscaped(prose,i) && /^\\([a-zA-Z]+)/.exec(prose.slice(i));
      if (!command) { output += prose[i++]; continue; }
      const name = command[1];
      if (plain && ['left','right'].includes(name)) { i += command[0].length; continue; }
      if (Object.hasOwn(symbols,name)) { output += symbols[name]; i += command[0].length; continue; }
      let end = i + command[0].length;
      const args = [];
      for (let n = 0; n < (argumentsFor[name] || 0); n++) {
        const arg = argument(prose,end);
        if (!arg) break;
        args.push(arg.body); end = arg.end;
      }
      if (argumentsFor[name] && args.length === argumentsFor[name]) {
        if (!plain) output += '\\(' + prose.slice(i,end) + '\\)';
        else {
          const values = args.map(value => bareMath(value,true));
          if (['frac','dfrac','tfrac'].includes(name)) output += '('+values[0]+')/('+values[1]+')';
          else if (name === 'sqrt') output += '√('+values[0]+')';
          else if (name === 'vec') output += '向量 '+values[0];
          else if (name === 'binom') output += 'C('+values[0]+','+values[1]+')';
          else if (['bar','overline'].includes(name)) output += '上劃線('+values[0]+')';
          else if (name === 'hat') output += '帽號('+values[0]+')';
          else if (name === 'underline') output += '底線('+values[0]+')';
          else output += values[0];
        }
        i = end; continue;
      }
      output += command[0]; i += command[0].length;
    }
    return output;
  }
  // Infer only bounded known commands; ordinary Chinese/English and existing
  // delimited equations remain text and complete equations respectively.
  function normalizeMathText(value) {
    const text = decodeEntities(expandTextEscapes(value));
    const pattern = /(?<!\\)\$\$[\s\S]*?\$\$|(?<!\\)\\\[[\s\S]*?\\\]|(?<!\\)\\\([\s\S]*?\\\)|(?<!\\)\$(?!\$)(?:\\.|[^$\\])*?\$/g;
    const prose = value => {
      const repaired = value.replace(/\\\\(?=(?:frac|dfrac|tfrac|sqrt|vec|overline|bar|hat|mathrm|mathbf|text|underline|binom|times|div|cdot|leq|geq|neq|pi|theta|alpha|beta|gamma|infty)\b|[()[\]])/g, '\\');
      return repaired === value ? bareMath(value) : normalizeMathText(repaired);
    };
    let output = '', start = 0;
    for (const match of text.matchAll(pattern)) {
      output += prose(text.slice(start,match.index)) + match[0];
      start = match.index + match[0].length;
    }
    return output + prose(text.slice(start));
  }
  function readableMath(value) {
    const text = decodeEntities(expandTextEscapes(value));
    if (!inspect(text).valid) return text;
    return bareMath(text.replace(/\$\$|(?<!\\)\$|\\[()[\]]/g,''),true);
  }
  // Interpret serialized prose escapes outside math; never damage TeX commands.
  function expandTextEscapes(value) {
    const input = String(value ?? '');
    let output = '', mode = null;
    for (let i = 0; i < input.length;) {
      const token = tokenAt(input, i);
      const ending = token && mode && (
        (mode === 'inline-dollar' && token.mark === '$') ||
        (mode === 'display-dollar' && token.mark === '$$') ||
        (mode === 'inline-bracket' && token.mark === '\\)') ||
        (mode === 'display-bracket' && token.mark === '\\]')
      );
      if (token && ((!mode && token.open) || ending)) {
        output += token.mark;
        mode = ending ? null : token.kind;
        i += token.mark.length;
        continue;
      }
      if (!mode && input[i] === '\\' && !isEscaped(input, i)) {
        const tail = input.slice(i), pair = tail.slice(0, 2);
        if (tail.startsWith('\\r\\n')) { output += '\n'; i += 4; continue; }
        if (!/[a-z]/.test(input[i + 2] || '')) {
          if (pair === '\\n' || pair === '\\r') { output += '\n'; i += 2; continue; }
          if (pair === '\\t') { output += '\u3000'; i += 2; continue; }
        }
        if (pair === '\\"' || pair === '\\/') { output += input[i + 1]; i += 2; continue; }
        const surrogate = /^\\u([dD][89aAbB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})/.exec(tail);
        if (surrogate) {
          output += String.fromCodePoint(0x10000 + ((parseInt(surrogate[1],16)-0xd800)<<10) + parseInt(surrogate[2],16)-0xdc00);
          i += surrogate[0].length; continue;
        }
        const unicode = /^\\u\{([0-9a-fA-F]{1,6})\}/.exec(tail) ||
          /^\\u([0-9a-fA-F]{4})(?![0-9a-fA-F])/.exec(tail) ||
          /^\\x([0-9a-fA-F]{2})(?![0-9a-fA-F])/.exec(tail);
        if (unicode) {
          const point = parseInt(unicode[1], 16);
          if (point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)) {
            output += String.fromCodePoint(point); i += unicode[0].length; continue;
          }
        }
      }
      output += input[i++];
    }
    return output.replace(/\r\n?/g, '\n');
  }
  function validBody(body) {
    let depth = 0;
    const envs = [];
    let left = 0, right = 0;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '\\' && !isEscaped(body, i)) {
        const env = /^\\(begin|end)\{([a-zA-Z*]+)\}/.exec(body.slice(i));
        if (env) {
          if (env[1] === 'begin') envs.push(env[2]);
          else if (envs.pop() !== env[2]) return false;
          i += env[0].length - 1;
          continue;
        }
        const delimiter = /^\\(left|right)(?=[^a-zA-Z]|$)/.exec(body.slice(i));
        if (delimiter) {
          if (delimiter[1] === 'left') left++;
          else right++;
          i += delimiter[0].length - 1;
          continue;
        }
      }
      if (body[i] === '{' && !isEscaped(body, i)) depth++;
      else if (body[i] === '}' && !isEscaped(body, i) && --depth < 0) return false;
    }
    return depth === 0 && envs.length === 0 && left === right;
  }
  function inspect(value) {
    const text = String(value ?? '');
    let mode = null, start = 0;
    let checked = 0;
    if (text.length > 12000) return { valid: false, reason: 'too-long' };
    for (let i = 0; i < text.length;) {
      const t = tokenAt(text, i);
      if (!mode) {
        if (t) {
          if (!t.open) return { valid: false, reason: 'unmatched-closing-delimiter' };
          mode = t.kind; start = i + t.mark.length;
          i += t.mark.length; continue;
        }
        i++; continue;
      }
      if (t) {
        const closing = mode === 'inline-dollar' && t.mark === '$' ||
          mode === 'display-dollar' && t.mark === '$$' ||
          mode === 'inline-bracket' && t.mark === '\\)' ||
          mode === 'display-bracket' && t.mark === '\\]';
        if (closing) {
          if (!validBody(text.slice(start, i))) return { valid: false, reason: 'unbalanced-tex' };
          mode = null; checked++;
          i += t.mark.length; continue;
        }
        // An opener embedded in TeX is often a malformed delimiter.
        if (t.open && (t.mark === '$$' || t.mark === '\\(' || t.mark === '\\['))
          return { valid: false, reason: 'mixed-delimiters' };
      }
      i++;
    }
    return mode ? { valid: false, reason: 'unclosed-math' } : { valid: true, expressions: checked };
  }
  function fallback(value) {
    return '<span class="tex2jax_ignore quiz-math-fallback" title="原始數學式未能安全排版">' +
      escape(readableMath(value)).replace(/\n/g, '<br>') + '</span>';
  }
  return Object.freeze({ inspect, fallback, escape, expandTextEscapes, normalizeMathText, readableMath });
});

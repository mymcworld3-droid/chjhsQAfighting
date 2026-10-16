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
      escape(value).replace(/\n/g, '<br>') + '</span>';
  }
  return Object.freeze({ inspect, fallback, escape });
});

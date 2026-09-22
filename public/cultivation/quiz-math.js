// Single safe LaTeX rendering path for solo quiz, real battle, story fights and Dongtian.
(function () {
  'use strict';
  let queue = Promise.resolve();
  const math = () => window.MathJax;
  const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

  // Preserve Chinese and other ordinary words as text. Only a standalone TeX command
  // without its delimiters can be inferred as an inline formula.
  function normalize(value) {
    const text = String(value ?? '');
    const trimmed = text.trim();
    if (!trimmed || /(\$\$|\\\[|\\\(|(?<!\\)\$(?!\$))/.test(trimmed)) return text;
    if (/\\(?:frac|dfrac|tfrac|sqrt|sum|int|lim|pi|theta|alpha|beta|gamma|cdot|times|div|leq|geq|neq|infty|overline|vec|binom|left|right)\b/.test(trimmed)
      && !/[\u3400-\u9fff]/u.test(trimmed)
      && trimmed.length < 400) return text.replace(trimmed, '\\(' + trimmed + '\\)');
    return text;
  }

  function rich(value) {
    const text = normalize(value);
    // main-legacy defines this formatter and already protects math delimiters from
    // HTML escaping while rendering optional Markdown images.
    if (typeof window.formatQuizRichText === 'function') return window.formatQuizRichText(text);
    return escape(text).replace(/\n/g, '<br>');
  }

  function clear(nodes) {
    const roots = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
    if (!roots.length) return;
    try { math()?.typesetClear?.(roots); } catch (error) {
      console.warn('[Quiz Math] unable to clear previous typesetting', error);
    }
  }

  // Wait for async MathJax boot: the quiz may be ready before the CDN script.
  // MathJax startup.promise becomes available after the script is initialized.
  function readyMath() {
    const mj = math();
    return mj?.startup?.promise || Promise.resolve();
  }

  function typeset(nodes) {
    const roots = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
    if (!roots.length) return Promise.resolve();
    // MathJax cannot safely process concurrent DOM updates. Keep independent
    // question, option and explanation requests in document order.
    const job = async () => {
      const mj = math();
      if (!mj?.typesetPromise) return;
      try {
        await readyMath();
        const live = roots.filter(node => node.isConnected);
        if (live.length) await mj.typesetPromise(live);
      } catch (error) {
        console.warn('[Quiz Math] typesetting failed; original text remains readable', error);
      }
    };
    queue = queue.then(job,job);
    return queue;
  }

  // Use this after every dynamic question, choice, explanation or feedback update.
  // Clearing BEFORE replacing DOM avoids stale MathJax equation entries.
  function put(node, value) {
    if (!node) return Promise.resolve();
    clear(node);
    node.innerHTML = rich(value);
    return typeset(node);
  }

  window.quizMathRichText = rich;
  window.quizMathClear = clear;
  window.quizMathTypeset = typeset;
  window.quizMathSet = put;
})();

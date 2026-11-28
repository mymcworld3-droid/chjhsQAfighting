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
    const text = window.QAMathGuard?.normalizeMathText?.(value) ?? String(value ?? '');
    const trimmed = text.trim();
    if (!trimmed || /(\$\$|\\\[|\\\(|(?<!\\)\$(?!\$))/.test(trimmed)) return text;
    if (/\\(?:frac|dfrac|tfrac|sqrt|sum|int|lim|pi|theta|alpha|beta|gamma|cdot|times|div|leq|geq|neq|infty|overline|vec|binom|left|right)\b/.test(trimmed)
      && !/[\u3400-\u9fff]/u.test(trimmed)
      && trimmed.length < 400) return text.replace(trimmed, '\\(' + trimmed + '\\)');
    return text;
  }

  function rich(value) {
    const visual=window.QAQuestionVisualEngine?.renderInline(value,rich);
    if(visual!==null&&visual!==undefined)return visual;
    // Normalize only prose escapes; TeX commands and math environments stay intact.
    const text = normalize(window.QAMathGuard?.expandTextEscapes?.(value) ?? value);
    // If the AI supplied malformed delimiters/TeX, preserve its original
    // readable expression as literal text rather than expose Math input error.
    const guard = window.QAMathGuard;
    if (guard && !guard.inspect(text).valid)
      return '<span data-invalid-tex>' + guard.fallback(text) + '</span>';
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

  function reportInvalid(node, source) {
    console.warn('[Quiz Math] invalid TeX displayed as literal text');
    if (typeof CustomEvent === 'function') {
      window.dispatchEvent?.(new CustomEvent('qa:invalid-tex', { detail: { node, source } }));
    }
  }

  function readableFallback(roots) {
    if (typeof document === 'undefined' || !document.createTreeWalker || !window.QAMathGuard) return;
    for (const node of roots.filter(root => root.isConnected)) {
      const walker = document.createTreeWalker(node, 4); // SHOW_TEXT
      while (walker.nextNode()) {
        const text = walker.currentNode;
        if (text.parentElement?.closest('mjx-container,script,style,.tex2jax_ignore')) continue;
        if (/\\[a-zA-Z]+|\\[()[\]]|\$[^$]+\$/.test(text.nodeValue || '')) {
          text.nodeValue = window.QAMathGuard.readableMath(text.nodeValue);
        }
      }
    }
  }

  function typeset(nodes) {
    const roots = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
    if (!roots.length) return Promise.resolve();
    // MathJax cannot safely process concurrent DOM updates.
    const job = async () => {
      const mj = math();
      try {
        await mj?.startup?.promise;
        const live = roots.filter(node => node.isConnected);
        for (const node of live) {
          for (const literal of node.querySelectorAll?.('[data-invalid-tex]') || []) {
            literal.removeAttribute('data-invalid-tex');
            reportInvalid(literal, literal.textContent);
          }
        }
        if (!live.length) return;
        if (!mj?.typesetPromise) {
          readableFallback(live);
          return;
        }
        const originals = live.map(node => node.textContent || '');
        await mj.typesetPromise(live);
        for (const [index, node] of live.entries()) {
          if (!node.isConnected) continue;
          const errorSelector = 'mjx-merror, .mjx-merror, [data-mjx-error]';
          const errors = Array.from(node.querySelectorAll?.(errorSelector) || [node.querySelector?.(errorSelector)]);
          if (!errors.some(Boolean) && /(?:Math input error|TeX parse error|MathJax internal error)/i.test(node.textContent || '')) {
            errors.push(node.querySelector?.('mjx-container'));
          }
          const formulas = new Set(errors.filter(Boolean).map(error =>
            error.matches?.('mjx-container') ? error : error.closest?.('mjx-container') || error));
          const items = formulas.size ? mj.startup?.document?.getMathItemsWithin?.(node) || [] : [];
          for (const formula of formulas) {
            const item = items.find(math => math.typesetRoot === formula);
            const source = item?.math || formula.getAttribute?.('data-latex') || originals[index];
            const literal = document.createElement('span');
            literal.className = 'quiz-math-fallback tex2jax_ignore';
            literal.textContent = window.QAMathGuard?.readableMath(source) || source;
            try { mj.typesetClear?.([formula]); } catch (_) {}
            formula.replaceWith(literal);
            reportInvalid(node, source);
          }
        }
      } catch (error) {
        readableFallback(roots);
        console.warn('[Quiz Math] typesetting failed; original text remains readable', error);
      }
    };
    queue = queue.then(job, job);
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

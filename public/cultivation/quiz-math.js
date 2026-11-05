// Single safe LaTeX rendering path for solo quiz, real battle, story fights and Dongtian.
(function () {
  'use strict';
  let queue = Promise.resolve();
  const pending = new Set();
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
    // Normalize only prose escapes; TeX commands and math environments stay intact.
    const text = normalize(window.QAMathGuard?.expandTextEscapes?.(value) ?? value);
    // If the AI supplied malformed delimiters/TeX, preserve its original
    // readable expression as literal text rather than expose Math input error.
    const guard = window.QAMathGuard;
    if (guard && !guard.inspect(text).valid) return guard.fallback(text);
    // main-legacy defines this formatter and already protects math delimiters from
    // HTML escaping while rendering optional Markdown images.
    if (typeof window.formatQuizRichText === 'function') return window.formatQuizRichText(text);
    return escape(text).replace(/\n/g, '<br>');
  }

  function clear(nodes) {
    const roots = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
    if (!roots.length) return;
    for (const request of pending) if (roots.some(root => root === request.node || root.contains?.(request.node) || request.node.contains?.(root))) request.cancelled = true;
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

  function snapshotTree(node) {
    return { node, value: node.nodeValue, children: Array.from(node.childNodes || [], snapshotTree) };
  }

  function restoreTree(saved) {
    const {node,children,value} = saved;
    if (node.nodeType === 3) { node.nodeValue = value; return; }
    const current = Array.from(node.childNodes || []);
    if (current.length !== children.length || children.some((child,i) => child.node !== current[i])) node.replaceChildren(...children.map(child => child.node));
    children.forEach(restoreTree);
  }

  // Only replace formula text nodes. A root may contain answer buttons, images,
  // whiteboard/helper controls and their listeners; never flatten its innerHTML.
  function readableFallback(node) {
    const doc = node.ownerDocument || (typeof document === 'undefined' ? null : document);
    if (!doc?.createTreeWalker) return;
    const walker = doc.createTreeWalker(node,4), texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (const text of texts) {
      if (text.parentElement?.closest('mjx-container,script,style,textarea,pre,code,.tex2jax_ignore')) continue;
      const value = text.nodeValue || '';
      if (!/\\[a-zA-Z]+|\\[()[\]]|\$[^$]+\$/.test(value)) continue;
      const fallback = doc.createElement('span');
      fallback.className = 'tex2jax_ignore quiz-math-fallback';
      fallback.title = '公式暫以文字顯示';fallback.style.whiteSpace = 'pre-wrap';
      fallback.textContent = window.QAMathGuard?.readableMath(value) ?? value;
      text.replaceWith(fallback);
    }
  }

  function typeset(nodes) {
    const roots = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
    if (!roots.length) return Promise.resolve();
    const requests = roots.map(node => ({node,cancelled:false}));
    requests.forEach(request => pending.add(request));
    const current = request => request.node.isConnected && !request.cancelled;
    // MathJax cannot safely process concurrent DOM updates. Keep independent
    // question, option and explanation requests in document order.
    const job = async () => {
      try {
        const mj = math();
        if (!mj?.typesetPromise) {
          requests.filter(current).forEach(({node}) => readableFallback(node));
          return;
        }
        await readyMath();
        const live = requests.filter(current);
        if (!live.length) return;
        const backups = live.map(request => ({request,tree:snapshotTree(request.node)}));
        try {
          await mj.typesetPromise(live.map(({node}) => node));
          for (const {request,tree} of backups) {
            if (!current(request)) continue;
            const node = request.node;
            const broken = node.querySelector?.('mjx-merror, .mjx-merror, [data-mjx-error]') ||
              (/(?:Math input error|TeX parse error|MathJax internal error)/i.test(node.textContent || '') &&
                node.querySelector?.('mjx-container'));
            if (!broken) continue;
            try { mj.typesetClear?.([node]); } catch (_) {}
            restoreTree(tree);readableFallback(node);
            console.warn('[Quiz Math] invalid TeX displayed as literal text');
          }
        } catch (renderError) {
          for (const {request,tree} of backups) {
            if (!current(request)) continue;
            try { mj.typesetClear?.([request.node]); } catch (_) {}
            restoreTree(tree);readableFallback(request.node);
          }
          throw renderError;
        }
      } catch (error) {
        requests.filter(current).forEach(({node}) => readableFallback(node));
        console.warn('[Quiz Math] typesetting failed; original text remains readable', error);
      } finally {
        requests.forEach(request => pending.delete(request));
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

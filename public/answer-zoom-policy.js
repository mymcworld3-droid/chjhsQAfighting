// Page scaling belongs to displayed questions, never to navigation or combat scenes.
(function () {
  'use strict';

  const root = document.documentElement;
  const viewport = document.querySelector('meta[name="viewport"]');
  const base = 'width=device-width, initial-scale=1, minimum-scale=1, ';
  const lockedViewport = base + 'maximum-scale=1, user-scalable=no, viewport-fit=cover';
  const resetViewport = 'width=device-width, initial-scale=1.0001, minimum-scale=1, maximum-scale=1.0001, user-scalable=no, viewport-fit=cover';
  const blockingSelector = [
    '#login-screen:not(.hidden)', '#page-onboarding:not(.hidden)',
    '#game-startup-gate', '#startup-cloud-curtain', '#xiuxian-opening-cinematic',
    '#xiuxian-story-layer', '#xiuxian-story-archive', '#newbie-tutorial-layer',
    '#golden-core-tutorial-layer', '#qi-five-dongtian-tutorial-layer',
    '#battle-tutorial-layer.bt-final-mode', '#report-modal:not(.hidden)',
    '#custom-alert-modal:not(.hidden)', '#custom-confirm-modal:not(.hidden)',
    '.uib-modal-backdrop', '.amm-modal', '.aam-modal', '.dt-modal',
    '.progression-modal-backdrop', '.training-v3-modal-backdrop', '#realm-breakthrough-feedback',
    '#scope-studio', '#admin-product-editor', '.xpp-backdrop', '.op-confirm',
    // The five-immortal dialog and the calculation board belong to answering.
    '[role="dialog"]:not(.fi-modal):not(#quiz-whiteboard-panel)',
    '[aria-modal="true"]:not(.fi-modal):not(#quiz-whiteboard-panel)'
  ].join(',');
  const overlayQuestions = [
    ['#opportunity-overlay', '.op-workspace'],
    ['#dongtian-overlay', '.dt-question'],
    ['#daily-meditation-overlay', '#dm-question'],
    ['#five-immortal-challenge', '.fi-question']
  ];
  const pageQuestions = [
    '#page-quiz.active-page #quiz-container:not(.hidden)',
    '#page-battle.active-page #bv2-quiz:not(.hidden)',
    '#page-raid.active-page #raid-question:not(.hidden)'
  ];
  let allowed = null;
  let question = null;
  let answerScale = 1;
  let pinch = null;
  let gesture = null;
  let viewportFrame = 0;
  let resetAttempts = 0;

  function visible(element) {
    return !!element && !element.closest('.hidden, [hidden], [aria-hidden="true"]') &&
      element.getClientRects().length > 0;
  }

  function currentQuestion() {
    if (Array.from(document.querySelectorAll(blockingSelector)).some(visible)) return null;
    // An overlay's offer, loading or result view must override an underlying quiz.
    for (const [selector, question] of overlayQuestions) {
      const overlay = document.querySelector(selector);
      if (visible(overlay)) {
        const content = overlay.querySelector(question);
        return visible(content) ? content : null;
      }
    }
    for (const selector of pageQuestions) {
      const content = document.querySelector(selector);
      if (visible(content) && !content.querySelector('.raid-loading')) return content;
    }
    return null;
  }

  function setViewport(content) {
    if (viewport && viewport.getAttribute('content') !== content) viewport.setAttribute('content', content);
  }

  function restoreScale() {
    if (allowed || viewportFrame) return;
    setViewport(lockedViewport);
    const scale = Number(window.visualViewport?.scale) || 1;
    if (Math.abs(scale - 1) < 0.01 || resetAttempts >= 2) return;
    resetAttempts++;
    // Best effort for native scaling left over from an older version or input
    // focus. Answer gestures below never depend on a browser accepting this.
    setViewport(resetViewport);
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      if (!allowed) setViewport(lockedViewport);
    });
  }

  function resetAnswerScale() {
    answerScale = 1;
    pinch = null;
    gesture = null;
    root.style.removeProperty('--app-answer-zoom');
  }

  function setAnswerScale(value) {
    if (!allowed || !Number.isFinite(value)) return;
    answerScale = Math.round(Math.max(1, Math.min(5, value)) * 1000) / 1000;
    if (answerScale === 1) root.style.removeProperty('--app-answer-zoom');
    else root.style.setProperty('--app-answer-zoom', String(answerScale));
  }

  function sync() {
    const next = currentQuestion();
    if (next === question && allowed !== null) return allowed;
    cancelAnimationFrame(viewportFrame);
    viewportFrame = 0;
    resetAttempts = 0;
    // Clear the actual rendered magnification before locking or opening another
    // question surface. Native page zoom cannot reliably be reset by a website.
    resetAnswerScale();
    question = next;
    allowed = !!next;
    root.classList.toggle('app-zoom-locked', !allowed);
    root.classList.toggle('app-answer-zoom-allowed', allowed);
    setViewport(lockedViewport);
    if (!allowed) restoreScale();
    window.dispatchEvent(new CustomEvent('app:zoom-policy', { detail: { allowed } }));
    return allowed;
  }

  function handleZoom(event) {
    // Re-read the displayed view even before the mutation callback runs.
    const canZoom = sync();
    if (event.cancelable) event.preventDefault();
    return canZoom;
  }

  function touchDistance(touches) {
    return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  }

  document.addEventListener('touchstart', event => {
    if (event.touches.length < 2) return;
    if (handleZoom(event)) {
      const distance = touchDistance(event.touches);
      pinch = distance > 0 ? { distance, scale: answerScale } : null;
      gesture = null;
    }
  }, { passive: false, capture: true });
  document.addEventListener('touchmove', event => {
    if (event.touches.length < 2 || !handleZoom(event)) return;
    const distance = touchDistance(event.touches);
    if (pinch) setAnswerScale(pinch.scale * distance / pinch.distance);
    else if (distance > 0) pinch = { distance, scale: answerScale };
  }, { passive: false, capture: true });
  for (const type of ['touchend', 'touchcancel']) {
    document.addEventListener(type, event => {
      if (event.touches.length < 2) pinch = null;
    }, { passive: true, capture: true });
  }
  // Safari trackpads emit GestureEvents; iOS may also emit them during a touch
  // pinch. Let the touch path own that gesture to avoid applying it twice.
  document.addEventListener('gesturestart', event => {
    if (handleZoom(event) && !pinch) gesture = answerScale;
  }, { passive: false, capture: true });
  document.addEventListener('gesturechange', event => {
    if (handleZoom(event) && !pinch && gesture !== null) setAnswerScale(gesture * event.scale);
  }, { passive: false, capture: true });
  document.addEventListener('gestureend', event => {
    handleZoom(event);
    gesture = null;
  }, { passive: false, capture: true });
  document.addEventListener('wheel', event => {
    if (!(event.ctrlKey || event.metaKey) || !handleZoom(event) || gesture !== null) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    const delta = Math.max(-100, Math.min(100, event.deltaY * unit));
    setAnswerScale(answerScale * Math.exp(-delta * 0.01));
  }, { passive: false, capture: true });
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === '0') {
      if (sync()) { handleZoom(event); resetAnswerScale(); }
      return;
    }
    if (!['+', '=', '-', '_', 'Add', 'Subtract'].includes(event.key) || !handleZoom(event)) return;
    setAnswerScale(answerScale * (['-', '_', 'Subtract'].includes(event.key) ? 1 / 1.2 : 1.2));
  }, { capture: true });

  function restoreLockedView() {
    sync();
    if (!allowed) restoreScale();
  }
  window.visualViewport?.addEventListener?.('resize', restoreLockedView, { passive: true });
  window.addEventListener('pageshow', restoreLockedView);
  window.addEventListener('orientationchange', restoreLockedView);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) restoreLockedView();
  });
  // Question overlays and phase changes often bypass switchToPage; observe the
  // displayed DOM instead. Ignore inline animation styles and text-only updates.
  new MutationObserver(sync).observe(document.body, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'hidden', 'aria-hidden']
  });
  window.isAnswerZoomAllowed = () => sync();
  sync();
})();

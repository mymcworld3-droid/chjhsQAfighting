// Page scaling belongs to displayed questions, never to navigation or combat scenes.
(function () {
  'use strict';

  const root = document.documentElement;
  const viewport = document.querySelector('meta[name="viewport"]');
  const base = 'width=device-width, initial-scale=1, minimum-scale=1, ';
  const lockedViewport = base + 'maximum-scale=1, user-scalable=no, viewport-fit=cover';
  const answerViewport = base + 'maximum-scale=5, user-scalable=yes, viewport-fit=cover';
  const unlockViewport = answerViewport.replace('initial-scale=1,', 'initial-scale=1.0001,');
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
  let viewportFrame = 0;
  let resetAttempts = 0;

  function visible(element) {
    return !!element && !element.closest('.hidden, [hidden], [aria-hidden="true"]') &&
      element.getClientRects().length > 0;
  }

  function questionVisible() {
    if (Array.from(document.querySelectorAll(blockingSelector)).some(visible)) return false;
    // An overlay's offer, loading or result view must override an underlying quiz.
    for (const [selector, question] of overlayQuestions) {
      const overlay = document.querySelector(selector);
      if (visible(overlay)) return visible(overlay.querySelector(question));
    }
    return pageQuestions.some(selector => visible(document.querySelector(selector)));
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
    // Changing initial-scale also requests a reset on WebKit, which can ignore
    // min/max-scale. Finalize at exactly 1; bound retries to avoid resize loops.
    setViewport(resetViewport);
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      if (!allowed) setViewport(lockedViewport);
    });
  }

  function sync() {
    const next = questionVisible();
    if (next === allowed) return allowed;
    cancelAnimationFrame(viewportFrame);
    viewportFrame = 0;
    resetAttempts = 0;
    allowed = next;
    root.classList.toggle('app-zoom-locked', !allowed);
    root.classList.toggle('app-answer-zoom-allowed', allowed);
    if (allowed) {
      // Chromium can retain the previous scale bounds when only max-scale changes.
      // Pulse initial-scale for one frame to apply the new bounds, then use 1.
      setViewport(unlockViewport);
      viewportFrame = requestAnimationFrame(() => {
        viewportFrame = 0;
        if (allowed) setViewport(answerViewport);
      });
    } else restoreScale();
    window.dispatchEvent(new CustomEvent('app:zoom-policy', { detail: { allowed } }));
    return allowed;
  }

  function blockZoom(event) {
    // Re-read the displayed view even before the mutation callback runs.
    if (!sync() && event.cancelable) event.preventDefault();
  }

  document.addEventListener('touchstart', event => {
    if (event.touches.length > 1) blockZoom(event);
  }, { passive: false, capture: true });
  document.addEventListener('touchmove', event => {
    if (event.touches.length > 1) blockZoom(event);
  }, { passive: false, capture: true });
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, blockZoom, { passive: false, capture: true });
  }
  document.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey) blockZoom(event);
  }, { passive: false, capture: true });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '_', 'Add', 'Subtract'].includes(event.key)) blockZoom(event);
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

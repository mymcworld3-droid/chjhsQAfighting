// Global visual viewport guard for mobile Safari / iPad browser chrome.
// Keeps fullscreen gameplay surfaces inside the actually visible viewport.
(function () {
  'use strict';

  const ROOT = document.documentElement;
  let raf = 0;
  let delayed = 0;

  function px(value) {
    const n = Number(value);
    return (Number.isFinite(n) ? Math.max(0, n) : 0).toFixed(2) + 'px';
  }

  function syncVisualViewport() {
    const vv = window.visualViewport;
    const layoutWidth = Math.max(1, Number(window.innerWidth) || ROOT.clientWidth || 1);
    const layoutHeight = Math.max(1, Number(window.innerHeight) || ROOT.clientHeight || 1);
    const width = Math.max(1, Number(vv?.width) || layoutWidth);
    const height = Math.max(1, Number(vv?.height) || layoutHeight);
    const top = Math.max(0, Number(vv?.offsetTop) || 0);
    const left = Math.max(0, Number(vv?.offsetLeft) || 0);
    const bottom = Math.max(0, layoutHeight - (top + height));
    const right = Math.max(0, layoutWidth - (left + width));

    ROOT.style.setProperty('--app-vv-top', px(top));
    ROOT.style.setProperty('--app-vv-left', px(left));
    ROOT.style.setProperty('--app-vv-width', px(width));
    ROOT.style.setProperty('--app-vv-height', px(height));
    ROOT.style.setProperty('--app-vv-bottom', px(bottom));
    ROOT.style.setProperty('--app-vv-right', px(right));
    ROOT.classList.add('app-visual-viewport-ready');

    window.dispatchEvent(new CustomEvent('app:visual-viewport', {
      detail: { top, left, right, bottom, width, height, layoutWidth, layoutHeight }
    }));
  }

  function scheduleVisualViewportSync() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      syncVisualViewport();
      cancelAnimationFrame(delayed);
      delayed = requestAnimationFrame(syncVisualViewport);
    });
  }

  syncVisualViewport();
  window.addEventListener('resize', scheduleVisualViewportSync, { passive: true });
  window.addEventListener('orientationchange', scheduleVisualViewportSync, { passive: true });
  window.addEventListener('pageshow', scheduleVisualViewportSync, { passive: true });
  window.visualViewport?.addEventListener?.('resize', scheduleVisualViewportSync, { passive: true });
  window.visualViewport?.addEventListener?.('scroll', scheduleVisualViewportSync, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      scheduleVisualViewportSync();
      setTimeout(scheduleVisualViewportSync, 80);
      setTimeout(scheduleVisualViewportSync, 320);
    }
  });
})();

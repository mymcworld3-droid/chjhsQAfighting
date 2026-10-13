// Fullscreen surfaces follow the page layout, including the fixed-size game document.
// Legacy --app-vv-* properties remain compatible but no longer follow visualViewport.
(function () {
  'use strict';

  const ROOT = document.documentElement;
  let raf = 0;
  let delayed = 0;

  function px(value) {
    const n = Number(value);
    return (Number.isFinite(n) ? Math.max(0, n) : 0).toFixed(2) + 'px';
  }

  function syncPageViewport() {
    const layoutWidth = Math.max(1, Number(ROOT.clientWidth) || Number(window.innerWidth) || 1);
    const layoutHeight = Math.max(1, Number(ROOT.clientHeight) || Number(window.innerHeight) || 1);
    const width = layoutWidth, height = layoutHeight;
    const top = 0, left = 0, bottom = 0, right = 0;

    ROOT.style.setProperty('--app-vv-top', px(top));
    ROOT.style.setProperty('--app-vv-left', px(left));
    ROOT.style.setProperty('--app-vv-width', px(width));
    ROOT.style.setProperty('--app-vv-height', px(height));
    ROOT.style.setProperty('--app-vv-bottom', px(bottom));
    ROOT.style.setProperty('--app-vv-right', px(right));
    ROOT.classList.add('app-visual-viewport-ready');

    window.dispatchEvent(new CustomEvent('app:layout-viewport', {
      detail: { top, left, right, bottom, width, height, layoutWidth, layoutHeight }
    }));
  }

  function schedulePageViewportSync() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      syncPageViewport();
      cancelAnimationFrame(delayed);
      delayed = requestAnimationFrame(syncPageViewport);
    });
  }

  syncPageViewport();
  window.addEventListener('resize', schedulePageViewportSync, { passive: true });
  window.addEventListener('orientationchange', schedulePageViewportSync, { passive: true });
  window.addEventListener('pageshow', schedulePageViewportSync, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(schedulePageViewportSync).observe(ROOT);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      schedulePageViewportSync();
      setTimeout(schedulePageViewportSync, 80);
      setTimeout(schedulePageViewportSync, 320);
    }
  });
})();

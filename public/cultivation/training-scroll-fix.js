// 修煉頁捲動守門：實際捲動容器是 <main>，不能只重設 window/page-training。
(function () {
  'use strict';

  const PAGE_ID = 'page-training';
  let switchWrapped = false;

  function mainScroller() {
    return document.querySelector('body > main') || document.querySelector('main');
  }

  function resetTrainingScroll() {
    const main = mainScroller();
    if (main) {
      main.scrollTop = 0;
      if (typeof main.scrollTo === 'function') {
        try {
          main.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        } catch (_) {
          main.scrollTop = 0;
        }
      }
    }

    const page = document.getElementById(PAGE_ID);
    if (page) page.scrollTop = 0;

    // 保留這兩個歸零作為瀏覽器 fallback；真正關鍵仍是上面的 <main>。
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  function resetTrainingScrollSoon() {
    resetTrainingScroll();
    requestAnimationFrame(() => {
      resetTrainingScroll();
      requestAnimationFrame(resetTrainingScroll);
    });
    setTimeout(resetTrainingScroll, 80);
  }

  function wrapSwitchToPage() {
    if (switchWrapped || typeof window.switchToPage !== 'function') return;
    const baseSwitchToPage = window.switchToPage;

    window.switchToPage = function (pageId, ...args) {
      const result = baseSwitchToPage.call(this, pageId, ...args);
      if (pageId === PAGE_ID) resetTrainingScrollSoon();
      return result;
    };

    switchWrapped = true;
  }

  function observeTrainingVisibility() {
    if (!document.body) return;

    const page = document.getElementById(PAGE_ID);
    let wasVisible = !!page && !page.classList.contains('hidden');

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'attributes') continue;
        const target = mutation.target;
        if (target?.id !== PAGE_ID) continue;

        const visible = !target.classList.contains('hidden');
        if (visible && !wasVisible) resetTrainingScrollSoon();
        wasVisible = visible;
      }
    });

    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
  }

  function boot() {
    wrapSwitchToPage();
    observeTrainingVisibility();

    // 同時涵蓋築基期與金丹期動態建立的修煉按鈕。
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('#nav-training, [data-target="page-training"]');
      if (button) resetTrainingScrollSoon();
    }, true);

    window.addEventListener('foundation-training-stage-changed', wrapSwitchToPage);
    window.addEventListener('golden-core-access-changed', wrapSwitchToPage);
    window.addEventListener('xiuxian:features-ready', wrapSwitchToPage);
  }

  window.resetTrainingScroll = resetTrainingScrollSoon;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

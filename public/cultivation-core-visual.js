// 金丹視覺精緻度：依一品～九品逐級增加丹紋、金光、靈氣粒子。
(function () {
  'use strict';

  const CSS_HREF = 'cultivation-core-visual.css';
  let queued = false;

  function loadStyle() {
    if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  function qualityTier(grade) {
    if (grade === 1) return 'supreme';
    if (grade <= 3) return 'high';
    if (grade <= 6) return 'mid';
    return 'low';
  }

  function createDecoration(className) {
    const span = document.createElement('span');
    span.className = className;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  function decorateStage(stage, grade) {
    for (let i = 1; i <= 9; i += 1) stage.classList.remove(`core-grade-${i}`);
    stage.classList.remove('core-quality-low', 'core-quality-mid', 'core-quality-high', 'core-quality-supreme');
    stage.classList.add(`core-grade-${grade}`, `core-quality-${qualityTier(grade)}`);
    stage.dataset.coreGrade = String(grade);

    if (!stage.querySelector('.core-quality-rays')) {
      stage.appendChild(createDecoration('core-quality-rays'));
    }

    if (!stage.querySelector('.core-dan-pattern.pattern-a')) {
      stage.appendChild(createDecoration('core-dan-pattern pattern-a'));
      stage.appendChild(createDecoration('core-dan-pattern pattern-b'));
      stage.appendChild(createDecoration('core-dan-pattern pattern-c'));
    }

    if (!stage.querySelector('.core-quality-sparks')) {
      const sparks = createDecoration('core-quality-sparks');
      for (let i = 0; i < 10; i += 1) {
        const spark = createDecoration('core-quality-spark');
        spark.style.setProperty('--spark-index', String(i));
        sparks.appendChild(spark);
      }
      stage.appendChild(sparks);
    }

    const sphere = stage.querySelector('.golden-core-sphere-v3');
    if (sphere && !sphere.querySelector('.core-inner-seal')) {
      sphere.appendChild(createDecoration('core-inner-seal'));
      sphere.appendChild(createDecoration('core-inner-vein vein-a'));
      sphere.appendChild(createDecoration('core-inner-vein vein-b'));
    }
  }

  function decorateAll() {
    queued = false;
    const state = window.getGoldenCoreState?.();
    if (!state) return;
    const grade = Math.min(9, Math.max(1, Number(state.grade) || 9));
    document.querySelectorAll('.golden-core-stage-v3').forEach((stage) => decorateStage(stage, grade));
  }

  function scheduleDecorate() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(decorateAll);
  }

  function boot() {
    loadStyle();
    scheduleDecorate();

    const root = document.body;
    if (root) {
      new MutationObserver((mutations) => {
        if (mutations.some((mutation) => mutation.addedNodes.length || mutation.removedNodes.length)) {
          scheduleDecorate();
        }
      }).observe(root, { childList: true, subtree: true });
    }

    // 洗髓會重新渲染金丹；定期同步一次避免任何動態流程漏掉視覺品階。
    setInterval(scheduleDecorate, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

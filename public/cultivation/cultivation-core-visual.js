// 金丹視覺精緻度：依一品～九品逐級增加丹紋、金光、靈氣、符文與粒子。
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

  function ensureChild(parent, selector, className) {
    let node = parent.querySelector(selector);
    if (!node) {
      node = createDecoration(className);
      parent.appendChild(node);
    }
    return node;
  }

  function decorateStage(stage, grade) {
    for (let i = 1; i <= 9; i += 1) stage.classList.remove(`core-grade-${i}`);
    stage.classList.remove('core-quality-low', 'core-quality-mid', 'core-quality-high', 'core-quality-supreme');
    stage.classList.add(`core-grade-${grade}`, `core-quality-${qualityTier(grade)}`);
    stage.dataset.coreGrade = String(grade);

    // 外層：日冕、放射金芒、靈霧、符文光輪。
    ensureChild(stage, '.core-celestial-aura', 'core-celestial-aura');
    ensureChild(stage, '.core-quality-rays', 'core-quality-rays');
    ensureChild(stage, '.core-ray-burst', 'core-ray-burst');
    ensureChild(stage, '.core-aether-mist', 'core-aether-mist');
    ensureChild(stage, '.core-rune-ring.rune-outer', 'core-rune-ring rune-outer');
    ensureChild(stage, '.core-rune-ring.rune-inner', 'core-rune-ring rune-inner');

    // 四道交錯弧光，高品金丹會像有氣流繞行。
    if (!stage.querySelector('.core-arc-light.arc-1')) {
      for (let i = 1; i <= 4; i += 1) stage.appendChild(createDecoration(`core-arc-light arc-${i}`));
    }

    // 丹體外部丹紋。
    if (!stage.querySelector('.core-dan-pattern.pattern-a')) {
      stage.appendChild(createDecoration('core-dan-pattern pattern-a'));
      stage.appendChild(createDecoration('core-dan-pattern pattern-b'));
      stage.appendChild(createDecoration('core-dan-pattern pattern-c'));
      stage.appendChild(createDecoration('core-dan-pattern pattern-d'));
    }

    // 外部星塵／靈光，最多 18 顆；品階控制實際可見數量。
    if (!stage.querySelector('.core-quality-sparks')) {
      const sparks = createDecoration('core-quality-sparks');
      for (let i = 0; i < 18; i += 1) {
        const spark = createDecoration('core-quality-spark');
        spark.style.setProperty('--spark-index', String(i));
        sparks.appendChild(spark);
      }
      stage.appendChild(sparks);
    }

    const sphere = stage.querySelector('.golden-core-sphere-v3');
    if (sphere) {
      ensureChild(sphere, '.core-inner-seal', 'core-inner-seal');
      ensureChild(sphere, '.core-inner-vein.vein-a', 'core-inner-vein vein-a');
      ensureChild(sphere, '.core-inner-vein.vein-b', 'core-inner-vein vein-b');
      ensureChild(sphere, '.core-inner-vein.vein-c', 'core-inner-vein vein-c');
      ensureChild(sphere, '.core-surface-runes', 'core-surface-runes');
      ensureChild(sphere, '.core-liquid-light', 'core-liquid-light');
      ensureChild(sphere, '.core-specular-glint', 'core-specular-glint');
      ensureChild(sphere, '.core-shimmer-sweep', 'core-shimmer-sweep');
    }
  }

  function decorateAll() {
    queued = false;
    const state = window.getGoldenCoreState?.();
    if (!state) return;
    const candidateGrade = Math.min(9, Math.max(1, Number(state.grade) || 9));
    document.querySelectorAll('.golden-core-stage-v3').forEach((stage) => {
      // 金丹頁使用候選丹品級，元嬰地圖則使用實際裝配品級。
      // 不可拿 getGoldenCoreState() 的候選等級覆寫畫面上每一顆丹。
      const explicitGrade = Number(stage.dataset.coreVisualGrade);
      const grade = Number.isInteger(explicitGrade) && explicitGrade >= 1 && explicitGrade <= 9
        ? explicitGrade : candidateGrade;
      decorateStage(stage, grade);
    });
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

    // 洗髓會重建 DOM；定期同步避免任何動態流程漏掉新品階外觀。
    setInterval(scheduleDecorate, 1100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

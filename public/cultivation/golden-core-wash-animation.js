// 本命金丹頁內洗髓演出：只讓金丹本體發光、脈動與重塑，不建立光束或彈窗。
const STYLE_HREF = 'cultivation-golden-core-wash.css?v=20260924-3';
const MINIMUM_WASH_MS = 1650;
const REVEAL_MS = 650;
const FAILURE_MS = 320;

function ensureWashStyle() {
  if (document.querySelector('link[data-golden-core-wash-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = STYLE_HREF;
  link.dataset.goldenCoreWashStyle = '1';
  document.head.appendChild(link);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createGoldenCoreWashAnimation() {
  ensureWashStyle();
  const card = document.querySelector('.core-minimal-card');
  const sphere = card?.querySelector('.golden-core-sphere-v3');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;

  // 離開修煉頁後，仍容許遠端保存完成，避免演出 DOM 不存在導致額外失敗。
  if (!card || !sphere) {
    return {
      minimumDuration: Promise.resolve(),
      async reveal() {},
      async fail() {},
      cleanup() {}
    };
  }

  card.classList.add('is-core-washing');
  const minimumDuration = sleep(reducedMotion ? 0 : MINIMUM_WASH_MS);

  return {
    minimumDuration,
    async reveal(freshCore, freshType) {
      if (card.isConnected) {
        card.classList.remove('is-core-washing');
        card.classList.add('is-core-wash-revealed');
        for (const tone of [...sphere.classList]) {
          if (tone.startsWith('core-tone-')) sphere.classList.remove(tone);
        }
        sphere.classList.add('core-tone-' + freshType.tone);
        // 洗髓揭曉時同步更新候選丹的品質外觀；元嬰裝配丹仍維持自己的品級。
        const stage = sphere.closest('.golden-core-stage-v3');
        if (stage) stage.dataset.coreVisualGrade = String(Math.min(9, Math.max(1, Number(freshCore.grade) || 9)));
        const icon = sphere.querySelector('span');
        if (icon) icon.textContent = freshType.icon;
        const name = card.querySelector('.core-minimal-name');
        const grade = card.querySelector('.core-minimal-grade');
        if (name) name.textContent = freshType.name;
        if (grade) grade.textContent = freshCore.grade + ' 品';
      }
      await sleep(reducedMotion ? 0 : REVEAL_MS);
    },
    async fail() {
      if (card.isConnected) {
        card.classList.remove('is-core-washing');
        card.classList.add('is-core-wash-failed');
      }
      await sleep(reducedMotion ? 0 : FAILURE_MS);
    },
    cleanup() {
      card.classList.remove('is-core-washing', 'is-core-wash-revealed', 'is-core-wash-failed');
    }
  };
}

// 本命金丹頁內洗髓演出：兩道靈光由洗髓按鈕注入金丹，不建立彈窗、不處理扣款。
const STYLE_HREF = 'cultivation-golden-core-wash.css?v=20260924-2';
const MINIMUM_WASH_MS = 1650;
const REVEAL_MS = 650;
const FAILURE_MS = 320;
const SVG_NS = 'http://www.w3.org/2000/svg';

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

function makeBeamPath(startX, startY, endX, endY, direction) {
  const lift = Math.max(34, (startY - endY) * .35);
  const curveX = direction * Math.max(24, Math.abs(endX - startX) * .7);
  return 'M ' + startX.toFixed(1) + ' ' + startY.toFixed(1) +
    ' C ' + (startX + curveX).toFixed(1) + ' ' + (startY - lift).toFixed(1) +
    ', ' + (endX + direction * 34).toFixed(1) + ' ' + (endY + lift).toFixed(1) +
    ', ' + endX.toFixed(1) + ' ' + endY.toFixed(1);
}

export function createGoldenCoreWashAnimation() {
  ensureWashStyle();
  const card = document.querySelector('.core-minimal-card');
  const button = card?.querySelector('#wash-golden-core');
  const sphere = card?.querySelector('.golden-core-sphere-v3');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;

  // 即使玩家在修煉頁卸載時觸發洗髓，保存流程仍可完成，避免額外的動畫錯誤。
  if (!card || !button || !sphere) {
    return {
      minimumDuration: Promise.resolve(),
      async reveal() {},
      async fail() {},
      cleanup() {}
    };
  }

  // 同一張卡片內以 SVG 對齊真實的按鈕及金丹位置，窄螢幕也不需要猜固定座標。
  const layer = document.createElement('div');
  layer.className = 'gc-wash-lightfield';
  layer.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('gc-wash-rays');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = [
    '<defs>',
    '<linearGradient id="gc-wash-ray-gold" x1="0%" y1="100%" x2="15%" y2="0%">',
    '<stop offset="0%" stop-color="#f2b74c"/><stop offset="55%" stop-color="#fff3c2"/><stop offset="100%" stop-color="#fff5d7"/>',
    '</linearGradient>',
    '<linearGradient id="gc-wash-ray-jade" x1="0%" y1="100%" x2="85%" y2="0%">',
    '<stop offset="0%" stop-color="#91b9dd"/><stop offset="55%" stop-color="#d9e9f7"/><stop offset="100%" stop-color="#fff3d3"/>',
    '</linearGradient>',
    '</defs>',
    '<path class="gc-wash-beam-a gc-wash-ray-glow" data-beam="a" />',
    '<path class="gc-wash-beam-b gc-wash-ray-glow" data-beam="b" />',
    '<path class="gc-wash-beam-a gc-wash-ray-flow" data-beam="a" pathLength="100" />',
    '<path class="gc-wash-beam-b gc-wash-ray-flow" data-beam="b" pathLength="100" />'
  ].join('');
  const impact = document.createElement('span');
  impact.className = 'gc-wash-impact';
  layer.appendChild(svg);
  layer.appendChild(impact);
  card.appendChild(layer);
  card.classList.add('is-core-washing');

  function positionBeams() {
    if (!card.isConnected || !button.isConnected || !sphere.isConnected) return;
    const bounds = card.getBoundingClientRect();
    const source = button.getBoundingClientRect();
    const target = sphere.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    svg.setAttribute('viewBox', '0 0 ' + bounds.width + ' ' + bounds.height);
    const startY = source.top - bounds.top + Math.min(source.height * .4, 24);
    const endY = target.top - bounds.top + target.height * .52;
    const startCenter = source.left - bounds.left + source.width / 2;
    const endCenter = target.left - bounds.left + target.width / 2;
    const separation = Math.min(58, source.width * .24);
    const paths = {
      a: makeBeamPath(startCenter - separation, startY, endCenter - target.width * .16, endY, -1),
      b: makeBeamPath(startCenter + separation, startY, endCenter + target.width * .16, endY, 1)
    };
    for (const kind of ['a', 'b']) {
      svg.querySelectorAll('[data-beam="' + kind + '"]').forEach(path => path.setAttribute('d', paths[kind]));
    }
    impact.style.left = endCenter + 'px';
    impact.style.top = endY + 'px';
  }

  positionBeams();
  window.addEventListener('resize', positionBeams);
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
      window.removeEventListener('resize', positionBeams);
      layer.remove();
      card.classList.remove('is-core-washing', 'is-core-wash-revealed', 'is-core-wash-failed');
    }
  };
}

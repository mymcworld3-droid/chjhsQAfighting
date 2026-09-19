// Newbie tutorial layout guard: keep the explanation card away from the highlighted content.
// This intentionally layers on top of newbie-tutorial-v2 without changing tutorial state/flow.
(function () {
  'use strict';

  const STYLE_ID = 'newbie-tutorial-layout-fix-style';
  const GAP = 14;
  let lastKey = '';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #newbie-tutorial-layer .newbie-tutorial-card{
        bottom:auto!important;
        transform:none!important;
        max-height:min(46dvh,430px);
        overflow:auto;
        overscroll-behavior:contain;
        transition:left .18s ease,top .18s ease,max-height .18s ease;
      }
      @media(max-width:640px){
        #newbie-tutorial-layer .newbie-tutorial-card{
          width:calc(100vw - 20px)!important;
          max-height:min(38dvh,360px);
          padding:15px!important;
          border-radius:20px!important;
        }
        #newbie-tutorial-layer .newbie-tutorial-card h3{font-size:17px!important;margin:4px 0 6px!important}
        #newbie-tutorial-layer .newbie-tutorial-card p{font-size:11px!important;line-height:1.6!important}
        #newbie-tutorial-layer .newbie-tutorial-note{margin-top:6px!important}
        #newbie-tutorial-layer .newbie-tutorial-progress{margin:9px 0 8px!important}
        #newbie-tutorial-layer .newbie-tutorial-actions button{min-height:36px!important;padding:0 9px!important}
      }
    `;
    document.head.appendChild(style);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function overlapArea(a, b) {
    const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return width * height;
  }

  function expanded(rect, amount) {
    return {
      left: rect.left - amount,
      top: rect.top - amount,
      right: rect.right + amount,
      bottom: rect.bottom + amount
    };
  }

  function candidate(left, top, width, height, name, preference) {
    const maxLeft = Math.max(GAP, innerWidth - width - GAP);
    const maxTop = Math.max(GAP, innerHeight - height - GAP);
    const x = clamp(left, GAP, maxLeft);
    const y = clamp(top, GAP, maxTop);
    return { name, preference, left: x, top: y, right: x + width, bottom: y + height };
  }

  function positionTutorialCard() {
    ensureStyle();
    const layer = document.getElementById('newbie-tutorial-layer');
    const card = layer?.querySelector('.newbie-tutorial-card');
    const spot = layer?.querySelector('.newbie-tutorial-spotlight');
    if (!layer || !card || !spot || spot.style.display === 'none') {
      lastKey = '';
      return;
    }

    const target = spot.getBoundingClientRect();
    if (!target.width || !target.height) return;

    // Let CSS establish the current responsive card size before choosing a side.
    const cardRect = card.getBoundingClientRect();
    const width = Math.min(cardRect.width || 520, innerWidth - GAP * 2);
    const height = Math.min(card.scrollHeight || cardRect.height || 280, Math.max(180, innerHeight - GAP * 2));
    const safeTarget = expanded(target, 12);
    const centeredLeft = target.left + target.width / 2 - width / 2;
    const centeredTop = target.top + target.height / 2 - height / 2;

    const candidates = [
      candidate(centeredLeft, target.bottom + GAP, width, height, 'below', 0),
      candidate(centeredLeft, target.top - height - GAP, width, height, 'above', 1),
      candidate(target.right + GAP, centeredTop, width, height, 'right', 2),
      candidate(target.left - width - GAP, centeredTop, width, height, 'left', 3)
    ];

    // On narrow screens, vertical placement is easier to read and less likely to cover controls.
    if (innerWidth <= 640) {
      candidates.forEach((entry) => {
        if (entry.name === 'right' || entry.name === 'left') entry.preference += 20;
      });
    }

    candidates.forEach((entry) => {
      entry.overlap = overlapArea(entry, safeTarget);
      entry.score = entry.overlap * 1000 + entry.preference;
    });
    candidates.sort((a, b) => a.score - b.score || a.preference - b.preference);
    // 底部導覽的按鈕必須完全露出：教學卡固定放在它上方，不用一般的側邊候選位置。
    const best = spot.dataset.navigation === 'true'
      ? candidate(centeredLeft, target.top - height - GAP, width, height, 'above', 0)
      : candidates[0];

    const key = [Math.round(best.left), Math.round(best.top), Math.round(width), Math.round(height), best.name].join(':');
    if (key === lastKey) return;
    lastKey = key;
    card.dataset.placement = best.name;
    card.style.left = `${Math.round(best.left)}px`;
    card.style.top = `${Math.round(best.top)}px`;
  }

  function boot() {
    ensureStyle();
    // The base tutorial updates its spotlight after page navigation/scrolling. A light poll keeps
    // the card aligned without observing our own style mutations and creating an observer loop.
    setInterval(positionTutorialCard, 180);
    window.addEventListener('resize', () => { lastKey = ''; positionTutorialCard(); }, { passive: true });
    window.addEventListener('scroll', () => { lastKey = ''; positionTutorialCard(); }, { passive: true, capture: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

// Gacha-free entry point for the 修仙世界 branch.
// The previous main.js is retained as main-legacy.js for rollback/reference only.
import './main-legacy.js';

const GACHA_SELECTORS = [
  '.summon-banner',
  '#page-cards',
  '[onclick="drawSingleCard()"]',
  '[onclick="draw11Cards()"]',
  '#home-best-card-container'
];

function removeLegacyGachaUI() {
  GACHA_SELECTORS.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => node.remove());
  });

  document.querySelectorAll('button, a, [role="button"]').forEach((node) => {
    const text = (node.textContent || '').trim();
    if (/卡牌|Cards|召喚|Summon|抽卡|Gacha/i.test(text)) node.remove();
  });

  // Make the old draw entry points unavailable even if legacy code exposed them.
  window.drawSingleCard = undefined;
  window.draw11Cards = undefined;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', removeLegacyGachaUI, { once: true });
} else {
  removeLegacyGachaUI();
}

new MutationObserver(removeLegacyGachaUI).observe(document.documentElement, {
  childList: true,
  subtree: true
});

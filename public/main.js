// 修仙世界入口：先載入核心遊戲，再套用修仙主題、修為規則與五大仙位玩法。
import './main-legacy.js';
import './cultivation-theme.js';
import './cultivation-rules.js';
import './five-immortals.js';

// 防止歷史版本的抽卡入口或殘留 UI 回到畫面。
const LEGACY_SELECTORS = [
  '.summon-banner',
  '#page-cards',
  '[onclick="drawSingleCard()"]',
  '[onclick="draw11Cards()"]',
  '#home-best-card-container'
];

function removeLegacyGachaUI() {
  LEGACY_SELECTORS.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => node.remove());
  });

  document.querySelectorAll('button, a, [role="button"]').forEach((node) => {
    const text = (node.textContent || '').trim();
    if (/卡牌|Cards|召喚|Summon|抽卡|Gacha/i.test(text)) node.remove();
  });

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

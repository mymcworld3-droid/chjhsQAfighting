// 修仙世界入口：先載入核心遊戲，再套用修仙主題、修為規則與五大仙位玩法。
import './main-legacy.js';
import './cultivation-theme.js';
import './cultivation-rules.js';
import './xiuxian-live-sync.js';
import './five-immortals.js';

// 僅移除已確認的歷史抽卡 UI。
// 不再依按鈕文字刪除元素，避免誤刪現有的卡牌/道具/管理功能。
const LEGACY_SELECTORS = [
  '.summon-banner',
  '#page-cards',
  '#nav-grid [data-target="page-cards"]',
  '[onclick="drawSingleCard()"]',
  '[onclick="draw11Cards()"]',
  '#home-best-card-container'
];

function removeLegacyGachaUI() {
  LEGACY_SELECTORS.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => node.remove());
  });

  // 清掉舊版全域入口，但保留可能被其他模組使用的 DOM。
  window.drawSingleCard = undefined;
  window.draw11Cards = undefined;
}

function bootLegacyCleanup() {
  removeLegacyGachaUI();

  // 只觀察 body，且 observer 本身不做文字掃描。
  // 這樣新 UI 動態插入時仍能清掉舊 selector，同時避免破壞正常按鈕。
  if (!document.body) return;
  new MutationObserver(removeLegacyGachaUI).observe(document.body, {
    childList: true,
    subtree: true
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLegacyCleanup, { once: true });
} else {
  bootLegacyCleanup();
}

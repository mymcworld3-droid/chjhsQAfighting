// 核心登入／遊戲模組必須優先且獨立載入。
// 任一附加修仙功能載入失敗，都不能再阻斷 Google 登入。
import './main-legacy.js';

const XIUXIAN_FEATURE_MODULES = [
  './cultivation-theme.js',
  './cultivation-rules.js',
  './xiuxian-live-sync.js',
  './five-immortals.js',
  './cultivation-progression-v2.js',
  './golden-core-access-guard.js',
  './cultivation-training-v4.js',
  './cultivation-core-visual.js',
  './cultivation-core-equip-warning.js',
  './cultivation-combat-stats.js',
  './cultivation-status-panel.js',
  './realm-breakthrough-feedback.js',
  './cultivation-rank-sync.js',
  './newbie-tutorial.js'
];

async function loadXiuxianFeaturesSafely() {
  for (const modulePath of XIUXIAN_FEATURE_MODULES) {
    try {
      // 依序載入，保證進度遷移 → 金丹守門 → 金丹系統等相依順序不變。
      await import(modulePath);
    } catch (error) {
      // 附加功能故障時只停用該功能，絕不影響登入與核心答題。
      console.error(`[Xiuxian] Failed to load optional module: ${modulePath}`, error);
    }
  }

  window.dispatchEvent(new CustomEvent('xiuxian:features-ready'));
}

loadXiuxianFeaturesSafely();

// 恢復原本的科幻／電腦字體。
// Orbitron 負責英文字母與數字；中文字沒有對應字形時自動使用 Noto Sans TC。
function restoreComputerFont() {
  const fontHref = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&display=swap';

  if (!document.querySelector(`link[href="${fontHref}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontHref;
    document.head.appendChild(link);
  }

  document.documentElement.style.setProperty(
    '--xq-serif',
    "'Orbitron', 'Noto Sans TC', sans-serif"
  );
}

// 載入黑金主題，置於既有 xianxia.css 之後，僅覆蓋視覺色彩。
function loadCelestialGoldTheme() {
  const themeHref = 'xianxia-gold.css';
  if (document.querySelector(`link[href="${themeHref}"]`)) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = themeHref;
  document.head.appendChild(link);
}

// 再載入一層黑金補強，專門攔截舊版 Tailwind / Cyber UI 殘留的藍、青色。
function loadBlackGoldHarmonyTheme() {
  const themeHref = 'xianxia-blackgold-harmony.css';
  if (document.querySelector(`link[href="${themeHref}"]`)) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = themeHref;
  document.head.appendChild(link);
}

// 修煉頁緊湊版：分頁按鈕靠上並縮小，減少不必要的捲動。
function loadCompactTrainingLayout() {
  const themeHref = 'cultivation-training-compact.css';
  if (document.querySelector(`link[href="${themeHref}"]`)) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = themeHref;
  document.head.appendChild(link);
}

// Chart.js 的 canvas 顏色不受 CSS 控制，因此在繪圖前把舊藍青色轉成暖金。
function registerBlackGoldChartTheme() {
  if (!window.Chart || window.__blackGoldChartThemeRegistered) return;

  const isLegacyBlue = (value) => {
    if (typeof value !== 'string') return false;
    const c = value.toLowerCase().replace(/\s+/g, '');
    return c.includes('#22d3ee') ||
      c.includes('#3b82f6') ||
      c.includes('#06b6d4') ||
      c.includes('#0ea5e9') ||
      c.includes('34,211,238') ||
      c.includes('59,130,246') ||
      c.includes('6,182,212') ||
      c.includes('14,165,233') ||
      c === 'cyan' || c === 'blue';
  };

  const remap = (value, kind) => {
    if (Array.isArray(value)) return value.map((item) => remap(item, kind));
    if (!isLegacyBlue(value)) return value;
    return kind === 'border' ? '#d8b15d' : 'rgba(216, 177, 93, 0.66)';
  };

  window.Chart.register({
    id: 'blackGoldPalette',
    beforeUpdate(chart) {
      (chart.data?.datasets || []).forEach((dataset) => {
        dataset.backgroundColor = remap(dataset.backgroundColor, 'background');
        dataset.borderColor = remap(dataset.borderColor, 'border');
        dataset.hoverBackgroundColor = remap(dataset.hoverBackgroundColor, 'background');
        dataset.hoverBorderColor = remap(dataset.hoverBorderColor, 'border');
        dataset.pointBackgroundColor = remap(dataset.pointBackgroundColor, 'background');
        dataset.pointBorderColor = remap(dataset.pointBorderColor, 'border');
      });
    }
  });

  window.__blackGoldChartThemeRegistered = true;
}

restoreComputerFont();
loadCelestialGoldTheme();
loadBlackGoldHarmonyTheme();
loadCompactTrainingLayout();
registerBlackGoldChartTheme();

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

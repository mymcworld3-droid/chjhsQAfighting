// 核心登入／遊戲模組必須優先且獨立載入。
// 任一附加修仙功能載入失敗，都不能再阻斷 Google 登入。
import './main-legacy.js';
import './cultivation/dongtian-entry.js';

const XIUXIAN_FEATURE_MODULES = [
  './cultivation/cultivation-theme.js',
  './cultivation/golden-core-activation-feedback.js',
  './cultivation/cultivation-rules.js',
  './cultivation/xiuxian-live-sync.js',
  './cultivation/five-immortals.js',
  './cultivation/cultivation-progression-v2.js',
  './cultivation/cultivation-inventory.js',
  './cultivation/golden-core-access-guard.js',
  './cultivation/foundation-training-page.js',
  './cultivation/cultivation-training-v4.js',
  './cultivation/reverse-core-multiples.js',
  './cultivation/golden-core-battle-effects.js',
  './cultivation/cultivation-core-visual.js',
  './cultivation/cultivation-core-equip-warning.js',
  './cultivation/cultivation-combat-stats.js',
  './cultivation/battle-mode-v2.js',
  './cultivation/cultivation-status-panel.js',
  './cultivation/realm-breakthrough-feedback.js',
  './cultivation/cultivation-rank-sync.js',
  './cultivation/dongfu-settings-collapsible.js',
  './cultivation/dongtian.js',
  './cultivation/newbie-tutorial-v2.js',
  './cultivation/golden-core-tutorial.js',
  './cultivation/admin-self-transfer.js'
];

let xiuxianFeatureLoadStarted = false;
let xiuxianReadyTimer = null;

async function loadXiuxianFeaturesSafely() {
  for (const modulePath of XIUXIAN_FEATURE_MODULES) {
    try {
      await import(modulePath);
    } catch (error) {
      console.error(`[Xiuxian] Failed to load optional module: ${modulePath}`, error);
    }
  }
  window.dispatchEvent(new CustomEvent('xiuxian:features-ready'));
}

function cultivationUserDataReady() {
  try {
    return !!window.getCurrentUserData?.()?.stats;
  } catch (_) {
    return false;
  }
}

function startXiuxianFeaturesWhenReady() {
  if (xiuxianFeatureLoadStarted) return;

  // 修仙附加功能一律等登入核心完成使用者資料載入後才啟動。
  // 這可避免 observer / timer / Firebase 附加邏輯介入 Google 登入畫面。
  if (cultivationUserDataReady()) {
    xiuxianFeatureLoadStarted = true;
    if (xiuxianReadyTimer) clearTimeout(xiuxianReadyTimer);
    xiuxianReadyTimer = null;
    loadXiuxianFeaturesSafely();
    return;
  }

  xiuxianReadyTimer = setTimeout(startXiuxianFeaturesWhenReady, 250);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startXiuxianFeaturesWhenReady, { once: true });
} else {
  startXiuxianFeaturesWhenReady();
}

// 若未來核心登入流程主動派發 ready event，也能立即開始，不必等下一次輪詢。
window.addEventListener('xiuxian:user-ready', startXiuxianFeaturesWhenReady);

function restoreComputerFont() {
  const fontHref = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&display=swap';
  if (!document.querySelector(`link[href="${fontHref}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontHref;
    document.head.appendChild(link);
  }
  document.documentElement.style.setProperty('--xq-serif', "'Orbitron', 'Noto Sans TC', sans-serif");
}

function loadCelestialGoldTheme() {
  const themeHref = 'xianxia-gold.css';
  if (document.querySelector(`link[href="${themeHref}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = themeHref;
  document.head.appendChild(link);
}

function loadBlackGoldHarmonyTheme() {
  const themeHref = 'xianxia-blackgold-harmony.css';
  if (document.querySelector(`link[href="${themeHref}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = themeHref;
  document.head.appendChild(link);
}

function loadCompactTrainingLayout() {
  const themeHref = 'styles/cultivation-training-compact.css';
  if (document.querySelector(`link[href="${themeHref}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = themeHref;
  document.head.appendChild(link);
}

function registerBlackGoldChartTheme() {
  if (!window.Chart || window.__blackGoldChartThemeRegistered) return;
  const isLegacyBlue = (value) => {
    if (typeof value !== 'string') return false;
    const c = value.toLowerCase().replace(/\s+/g, '');
    return c.includes('#22d3ee') || c.includes('#3b82f6') || c.includes('#06b6d4') ||
      c.includes('#0ea5e9') || c.includes('34,211,238') || c.includes('59,130,246') ||
      c.includes('6,182,212') || c.includes('14,165,233') || c === 'cyan' || c === 'blue';
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

const LEGACY_SELECTORS = [
  '.summon-banner', '#page-cards', '#nav-grid [data-target="page-cards"]',
  '[onclick="drawSingleCard()"]', '[onclick="draw11Cards()"]', '#home-best-card-container'
];

function removeLegacyGachaUI() {
  LEGACY_SELECTORS.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => node.remove());
  });
  window.drawSingleCard = undefined;
  window.draw11Cards = undefined;
}

function bootLegacyCleanup() {
  removeLegacyGachaUI();
  if (!document.body) return;
  new MutationObserver(removeLegacyGachaUI).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLegacyCleanup, { once: true });
} else {
  bootLegacyCleanup();
}

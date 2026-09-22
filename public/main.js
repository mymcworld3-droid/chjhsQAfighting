// 核心登入模組必須優先且獨立載入。
// Google 登入本身不被附加模組阻斷；登入後的遊戲則必須等所有修仙模組載入成功才開始。
import './main-legacy.js?v=20260922-product-editor-fullscreen1';
import './cultivation/dongtian-entry.js';

// 帳號刪除是登入核心旁的獨立增強；載入失敗也不能阻斷 Google 登入。
void import('./account-delete.js').catch((error) => {
  console.error('[Account Delete] failed to load account deletion controls', error);
});

const XIUXIAN_FEATURE_MODULES = [
  './cultivation/cultivation-theme.js',
  './cultivation/daily-meditation.js',
  './cultivation/identity-system.js',
  './cultivation/golden-core-activation-feedback.js',
  './cultivation/cultivation-rules.js',
  './cultivation/xiuxian-live-sync.js',
  './cultivation/five-immortals.js',
  './cultivation/cultivation-progression-v2.js',
  './cultivation/cultivation-inventory.js',
  './cultivation/golden-core-access-guard.js',
  './cultivation/foundation-training-page.js',
  './cultivation/cultivation-training-v4.js',
  './cultivation/training-scroll-fix.js',
  './cultivation/reverse-core-multiples.js',
  './cultivation/golden-core-battle-effects.js',
  './cultivation/cultivation-core-visual.js',
  './cultivation/cultivation-core-equip-warning.js',
  './cultivation/cultivation-combat-stats.js',
  './cultivation/artifact-catalog-sync.js',
  './cultivation/material-catalog-sync.js',
  './cultivation/artifact-system.js',
  './cultivation/artifact-battle-effects.js',
  './cultivation/combat-power.js',
  './cultivation/player-profile.js',
  './cultivation/material-system.js',
  './cultivation/unified-inventory-grid.js',
  './cultivation/refinery-ai-jobs.js',
  './cultivation/cultivation-refinery-v2.js',
  './cultivation/training-fluid-layout.js',
  './cultivation/market-fluid-layout.js',
  './cultivation/material-realm-ui.js',
  './cultivation/content-capacity-layout.js',
  './cultivation/material-drop-system.js',
  './cultivation/battle-v3-stability-ui.js',
  './cultivation/battle-mode-v2.js',
  './cultivation/cultivation-status-panel.js',
  './cultivation/realm-breakthrough-feedback.js',
  './cultivation/cultivation-rank-sync.js',
  './cultivation/dongfu-settings-collapsible.js',
  './cultivation/dongtian.js',
  './cultivation/story/story-engine.js',
  './cultivation/battle-tutorial.js',
  './cultivation/newbie-tutorial-v2.js',
  './cultivation/newbie-tutorial-layout-fix.js',
  './cultivation/golden-core-tutorial.js',
  './cultivation/admin-self-transfer.js',
  './cultivation/admin-account-manager.js',
  './cultivation/admin-artifact-manager.js',
  './cultivation/admin-artifact-effect-bounds.js',
  './cultivation/admin-artifact-delete.js',
  './cultivation/admin-material-manager.js',
  './cultivation/admin-material-realm-editor.js',
  './cultivation/admin-panel-collapsible.js',
  './cultivation/admin-realm-sorting.js',
  './cultivation/admin-single-row-layout.js'
];

let xiuxianFeatureLoadStarted = false;
let xiuxianReadyTimer = null;
let resolveXiuxianFeatureGate;
const xiuxianFeatureGate = new Promise((resolve) => { resolveXiuxianFeatureGate = resolve; });
const XIUXIAN_FEATURE_BUILD = '20260922-daily-meditation1';

// 交易市集僅為可選功能，載入失敗不可阻止玩家登入或進入遊戲。
let xiuxianMarketLoad = null;
function loadPlayerMarketSafely() {
  if (!xiuxianMarketLoad) {
    xiuxianMarketLoad = import(`./cultivation/player-marketplace.js?v=${XIUXIAN_FEATURE_BUILD}`)
      .catch((error) => {
        console.error('[Xiuxian] Optional player marketplace failed:', error);
        window.__xiuxianMarketplaceLoadError = true;
        const status = document.getElementById('pm-market-load-state');
        if (status) status.textContent = '交易市集目前無法載入，請重新整理遊戲後再試。';
        // 保留重新嘗試的入口，但不可將市集故障加入遊戲啟動失敗清單。
        xiuxianMarketLoad = null;
        return false;
      });
  }
  return xiuxianMarketLoad;
}
const queueMarketOpen = (view = 'all') => {
  // 即使市集模組尚在載入，也先切進坊市並顯示市集容器，
  // 避免玩家按下入口後看起來毫無反應。
  window.switchToPage?.('page-store');
  const page = document.getElementById('page-store');
  const panel = document.getElementById('player-market');
  const tabs = page?.querySelector('.store-tab')?.parentElement;
  const grid = document.getElementById('store-grid');
  page?.classList.add('pm-market-active');
  panel?.classList.remove('hidden');
  panel?.style.setProperty('display','block','important');
  tabs?.style.setProperty('display','none','important');
  grid?.style.setProperty('display','none','important');
  const status = document.getElementById('pm-market-load-state');
  if (status) status.textContent = '正在載入交易市集…';
  void loadPlayerMarketSafely().then((loaded) => {
    if (loaded !== false && window.openPlayerMarketplace !== queueMarketOpen) {
      window.openPlayerMarketplace?.(view);
    } else if (loaded !== false) {
      const status = document.getElementById('pm-market-load-state');
      if (status) status.textContent = '交易市集正在準備中，請稍後再按一次。';
    }
  });
};
window.openPlayerMarketplace = queueMarketOpen;

window.__xiuxianFeaturesReady = false;
window.waitForXiuxianFeatures = () => xiuxianFeatureGate;

async function loadXiuxianFeaturesSafely() {
  const failures = [];
  const total = XIUXIAN_FEATURE_MODULES.length;

  for (let index = 0; index < total; index += 1) {
    const modulePath = XIUXIAN_FEATURE_MODULES[index];
    window.dispatchEvent(new CustomEvent('xiuxian:feature-load-progress', {
      detail: { loaded: index, total, modulePath }
    }));
    try {
      await import(`${modulePath}?v=${XIUXIAN_FEATURE_BUILD}`);
    } catch (error) {
      failures.push(modulePath);
      console.error(`[Xiuxian] Failed to load optional module: ${modulePath}`, error);
    }
    window.dispatchEvent(new CustomEvent('xiuxian:feature-load-progress', {
      detail: { loaded: index + 1, total, modulePath }
    }));
  }

  if (failures.length) {
    window.__xiuxianFeatureLoadError = failures.slice();
    const result = { ok: false, total, failures: failures.slice() };
    resolveXiuxianFeatureGate(result);
    window.dispatchEvent(new CustomEvent('xiuxian:features-failed', { detail: result }));
    return;
  }

  window.__xiuxianFeaturesReady = true;
  const result = { ok: true, total, failures: [] };
  window.dispatchEvent(new CustomEvent('xiuxian:features-ready', { detail: result }));
  // user-ready 僅在所有功能模組都已註冊監聽器後才派發。
  window.dispatchEvent(new CustomEvent('xiuxian:user-ready'));
  resolveXiuxianFeatureGate(result);
  // 遊戲已可開始，再載入市集。市集若故障不影響其餘功能。
  void loadPlayerMarketSafely();
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
    // 市集與主遊戲解耦：玩家資料一就緒便準備入口，不受其他可選功能載入順序影響。
    void loadPlayerMarketSafely();
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

// 使用者資料完成後立即開始載入；輪詢仍作為事件遺失時的保險。
window.addEventListener('xiuxian:user-data-ready', startXiuxianFeaturesWhenReady);

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
  const themeHref = 'styles/cultivation-training-compact.css?v=20260917-fit1';
  if (document.querySelector(`link[href="${themeHref}"]`)) return;
  document.querySelectorAll('link[href^="styles/cultivation-training-compact.css"]').forEach((node) => node.remove());
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

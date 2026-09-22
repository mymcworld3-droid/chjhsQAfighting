// 修煉頁「狀態」分頁：顯示目前調御中的本命金丹與玩家戰鬥數值。
// 鬥法生命是單場投影資料；離開鬥法後不帶出，所以此處只顯示目前可用生命值。
(function () {
  'use strict';

  const CSS_HREF = 'cultivation-status-panel.css?v=20260922-core-layout2';
  let statusActive = false;
  let rendering = false;
  let coreTogglePending = false;

  const CORE_META = {
    ocean: { icon: '≈', tone: 'ocean' },
    taichu: { icon: '☀', tone: 'gold' },
    ningxin: { icon: '◈', tone: 'ivory' },
    pojing: { icon: '✦', tone: 'amber' },
    xingchen: { icon: '✧', tone: 'pale' },
    wugou: { icon: '◇', tone: 'silver' },
    thunder: { icon: 'ϟ', tone: 'thunder' },
    reverse: { icon: '↺', tone: 'violet' },
    sword: { icon: '⚔', tone: 'silver' }
  };

  const FALLBACK_COMBAT = {
    attack: 200,
    hp: 1000,
    maxHp: 1000
  };

  function loadStyle() {
    if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getCombatSnapshot() {
    const live = window.getCombatStats?.();
    if (live) return live;

    const stats = window.getCurrentUserData?.()?.stats || {};
    const maxHp = Number.isFinite(Number(stats.maxHp)) ? Number(stats.maxHp) : FALLBACK_COMBAT.maxHp;
    return {
      attack: Number.isFinite(Number(stats.attack)) ? Number(stats.attack) : FALLBACK_COMBAT.attack,
      hp: Number.isFinite(Number(stats.hp)) ? Number(stats.hp) : maxHp,
      maxHp
    };
  }

  function currentCoreSnapshot() {
    const core = window.getStoredGoldenCoreState?.() || window.getEquippedGoldenCoreState?.() || null;
    if (!core) return null;
    return {
      type: core.type || 'taichu',
      name: core.name || '金丹',
      grade: Number(core.grade) || 9,
      effect: core.effect || '尚無特性資料',
      equipped: core.coreEnabled !== false && core.equipped !== false
    };
  }

  function currentCoreMarkup(core, pending = false) {
    if (!core) {
      return `
        <div class="status-core-empty">
          <i class="fa-solid fa-circle-notch"></i>
          <span>目前沒有調御中的金丹丹相</span>
        </div>
      `;
    }

    const meta = CORE_META[core.type] || CORE_META.taichu;
    return `
      <div class="status-core-row">
        <div class="status-core-detail" data-status-core-detail role="button" tabindex="0" title="查看金丹詳細">
          <div class="status-core-orb core-tone-${meta.tone}" aria-hidden="true">
            <span>${meta.icon}</span>
            <i></i>
          </div>
          <div class="status-core-copy">
            <div class="status-core-topline">
              <span class="status-core-grade">${escapeHtml(core.grade)} 品</span>
              <span class="status-core-equipped ${core.equipped ? 'on' : 'off'}">${core.equipped ? '啟用中' : '已停用'}</span>
            </div>
            <h3>${escapeHtml(core.name)}</h3>
            <p>${core.equipped ? escapeHtml(core.effect) : '金丹效果已暫停；重新啟用後恢復原本丹相與品級。'}</p>
          </div>
        </div>
        <button class="status-core-toggle ${core.equipped ? 'is-enabled' : 'is-disabled'}" type="button"
          data-status-core-toggle aria-label="${core.equipped ? '停用金丹' : '啟用金丹'}"
          title="${core.equipped ? '停用金丹' : '啟用金丹'}" aria-pressed="${core.equipped}"
          ${pending || typeof window.setGoldenCoreEnabled !== 'function' ? 'disabled' : ''}>
          <i class="fa-solid ${pending ? 'fa-spinner fa-spin' : core.equipped ? 'fa-power-off' : 'fa-circle-play'}" aria-hidden="true"></i>
          <span>${pending ? '儲存中' : core.equipped ? '停用' : '啟用'}</span>
        </button>
      </div>
    `;
  }

  function statCard(icon, label, value, note = '') {
    return `
      <div class="status-stat-card">
        <div class="status-stat-icon"><i class="fa-solid ${icon}"></i></div>
        <div class="status-stat-copy">
          <span>${label}</span>
          <strong>${escapeHtml(value)}</strong>
          ${note ? `<small>${escapeHtml(note)}</small>` : ''}
        </div>
      </div>
    `;
  }

  // 與正式鬥法使用同一份已裝備法寶效果快照，不另外猜測背包內物品的加成。
  // 百分比的 sortValue 換算成百分點，讓 9% 排在 5% 前面。
  const BATTLE_STAT_META = Object.freeze({
    equip_damage_percent: { label: '傷害加成', icon: 'fa-burst', percent: true },
    equip_damage_reduction_flat: { label: '固定減傷', icon: 'fa-shield-halved' },
    equip_damage_reduction_percent: { label: '減傷', icon: 'fa-shield', percent: true, cap: 0.90 },
    equip_crit_chance: { label: '暴擊率', icon: 'fa-crosshairs', percent: true, cap: 0.75 },
    equip_crit_damage_percent: { label: '暴擊額外傷害', icon: 'fa-bolt', percent: true, note: '額外暴傷；基礎暴擊為 150%' },
    equip_combo_chance: { label: '連擊率', icon: 'fa-arrows-rotate', percent: true, cap: 0.10 },
    equip_lifesteal_percent: { label: '吸血率', icon: 'fa-droplet', percent: true, cap: 0.50 },
    equip_reflect_percent: { label: '反傷率', icon: 'fa-shield-heart', percent: true, cap: 1 },
    equip_shield_flat: { label: '開場護盾', icon: 'fa-shield-halved' },
    equip_true_damage_flat: { label: '追加真實傷害', icon: 'fa-fire' },
    equip_low_hp_damage_percent: { label: '低血量增傷', icon: 'fa-burst', percent: true, note: '生命 ≤30% 時生效' },
    equip_low_hp_reduction_percent: { label: '低血量減傷', icon: 'fa-shield', percent: true, note: '生命 ≤30% 時生效；與常駐減傷合計上限 90%' },
    equip_first_hit_reduction_percent: { label: '首次受傷減傷', icon: 'fa-shield-halved', percent: true, note: '每場首次受傷時生效；合計上限 90%' },
    equip_damage_cap_percent: { label: '單次生命傷害上限', icon: 'fa-heart-pulse', percent: true, note: '最高受傷占最大生命比例（數值越低越好）', minValue: true },
    equip_on_correct_shield_flat: { label: '答對獲得護盾', icon: 'fa-shield-heart', note: '鬥法中答對並攻擊後獲得' }
  });

  function finitePositive(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function formatStatNumber(number) {
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(number);
  }

  function buildCombatStatList(player, battle) {
    const maxHp = Math.max(1, finitePositive(player?.maxHp) || FALLBACK_COMBAT.maxHp);
    const hp = Math.min(maxHp, finitePositive(player?.hp));
    const values = [
      { key: 'hp', label: '生命值', icon: 'fa-heart', sortValue: hp, value: formatStatNumber(Math.round(hp)), note: hp < maxHp ? '最大生命：' + formatStatNumber(Math.round(maxHp)) : '鬥法開始時為滿血' },
      { key: 'attack', label: '攻擊力', icon: 'fa-khanda', sortValue: finitePositive(player?.attack), value: formatStatNumber(Math.round(finitePositive(player?.attack))), note: '已計入裝備與目前生效的攻擊加成' }
    ];
    const effects = Array.isArray(battle?.effects) ? battle.effects : [];
    const totals = new Map();
    for (const effect of effects) {
      const key = String(effect?.type || '');
      if (!Object.prototype.hasOwnProperty.call(BATTLE_STAT_META, key)) continue;
      const meta = BATTLE_STAT_META[key];
      const value = finitePositive(effect.value);
      if (meta.minValue) {
        // 同時佩戴數個傷害上限效果時，鬥法採最小值。
        if (value > 0) totals.set(key, Math.min(totals.get(key) ?? 1, Math.max(0.05, Math.min(1, value))));
      } else {
        totals.set(key, (totals.get(key) || 0) + value);
      }
    }
    for (const [key, raw] of totals) {
      const meta = BATTLE_STAT_META[key];
      const finalValue = meta.cap ? Math.min(raw, meta.cap) : raw;
      if (finalValue <= 0) continue;
      const display = meta.percent ? finalValue * 100 : finalValue;
      values.push({
        key, label: meta.label, icon: meta.icon, sortValue: display,
        value: formatStatNumber(display) + (meta.percent ? '%' : ''),
        note: meta.note || (meta.cap && raw > meta.cap ? '已達鬥法生效上限' : '')
      });
    }
    return values.sort((a, b) => b.sortValue - a.sortValue);
  }

  // 便於與鬥法快照交叉驗證，避免狀態頁另行套用法寶而重複加成。
  window.getCultivationStatusStats = buildCombatStatList;

  function statusSnapshot() {
    return {
      player: getCombatSnapshot(),
      battle: window.getArtifactBattleSnapshot?.() || { effects: [] },
      core: currentCoreSnapshot(),
      power: window.getCombatPower?.() || null,
      coreTogglePending
    };
  }

  function statusMarkup(snapshot) {
    const stats = buildCombatStatList(snapshot.player, snapshot.battle);
    const effects = Array.isArray(snapshot.battle?.effects) ? snapshot.battle.effects : [];
    const passive = [];
    const power = snapshot.power || { total:0, base:0, core:0, equipment:0, items:[] };
    if (effects.some(effect => effect?.type === 'equip_cheat_death')) passive.push('每場一次免死');
    if (effects.some(effect => effect?.type === 'equip_copy_enemy_artifact')) passive.push('鬥法時複製敵方法寶效果');
    return `
      <section class="training-status-panel">
        <div class="status-section status-power-section" aria-label="綜合戰力">
          <div class="status-section-title"><span>綜合戰力</span><small>COMBAT POWER</small></div>
          <div class="status-power-main"><i class="fa-solid fa-bolt"></i><strong>${formatStatNumber(power.total)}</strong></div>
          <div class="status-power-sources">
            <div><span>基礎</span><b>${formatStatNumber(power.base)}</b></div>
            <div><span>金丹 · 品質</span><b>${formatStatNumber(power.core)}</b></div>
            <div><span>裝備 · 境界與屬性</span><b>${formatStatNumber(power.equipment)}</b></div>
          </div>
          ${power.items?.length ? `<div class="status-power-items">${power.items.map(item => `<span>${escapeHtml(item.name)}（${escapeHtml(item.realm)}） +${formatStatNumber(item.power)}</span>`).join("")}</div>` : ""}
          <p class="status-power-note">僅計入目前啟用金丹及已裝備法寶；停用金丹不計戰力。戰力不直接增加鬥法傷害。</p>
        </div>
        <div class="status-section status-core-section">
          <div class="status-section-title"><span>目前調御金丹</span><small>ATTUNED CORE</small></div>
          ${currentCoreMarkup(snapshot.core, snapshot.coreTogglePending)}
        </div>

        <div class="status-section status-player-section">
          <div class="status-section-title"><span>戰鬥數值</span><small>由高至低</small></div>
          <p class="status-stat-hint">已計入生效裝備；百分比按百分點排列，條件加成另行標明。</p>
          <div class="status-stat-grid status-stat-grid-simple">
            ${stats.map(stat => statCard(stat.icon, stat.label, stat.value, stat.note)).join('')}
          </div>
          ${passive.length ? `<div class="status-stat-passive"><b>其他被動</b>${passive.map(label => `<span>${escapeHtml(label)}</span>`).join('')}</div>` : ''}
        </div>
      </section>
    `;
  }

  function renderStatus() {
    if (!statusActive || rendering) return;
    const content = document.getElementById('training-tab-content');
    if (!content) return;

    const snapshot = statusSnapshot();
    const key = JSON.stringify(snapshot);
    const alreadyShowing = !!content.querySelector(':scope > .training-status-panel');
    if (alreadyShowing && content.dataset.statusSnapshot === key) return;

    rendering = true;
    content.innerHTML = statusMarkup(snapshot);
    content.dataset.statusSnapshot = key;
    const coreButton = content.querySelector('[data-status-core-detail]');
    const openDetail = () => snapshot.core && window.openGoldenCoreDetails?.(snapshot.core);
    coreButton?.addEventListener('click', openDetail);
    coreButton?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(); } });
    content.querySelector('[data-status-core-toggle]')?.addEventListener('click', async () => {
      if (coreTogglePending || typeof window.setGoldenCoreEnabled !== 'function') return;
      coreTogglePending = true;
      renderStatus();
      try {
        await window.setGoldenCoreEnabled(!snapshot.core.equipped);
      } catch (error) {
        console.error('Status golden core toggle failed:', error);
      } finally {
        coreTogglePending = false;
        renderStatus();
      }
    });
    rendering = false;
  }

  function setNativeTabsInactive(page) {
    page.querySelectorAll('.training-subtab-v3').forEach((button) => {
      button.classList.remove('active');
      button.setAttribute('aria-selected', 'false');
    });
  }

  function activateStatus() {
    const page = document.getElementById('page-training');
    const button = document.getElementById('training-status-tab');
    if (!page || !button) return;
    statusActive = true;
    setNativeTabsInactive(page);
    button.classList.add('active');
    button.setAttribute('aria-selected', 'true');
    window.ensureCombatStats?.();
    renderStatus();
  }

  function deactivateStatus() {
    statusActive = false;
    const button = document.getElementById('training-status-tab');
    button?.classList.remove('active');
    button?.setAttribute('aria-selected', 'false');
  }

  function ensureStatusTab() {
    const tabs = document.querySelector('#page-training .training-subtabs-v3');
    if (!tabs || document.getElementById('training-status-tab')) return;

    const button = document.createElement('button');
    button.id = 'training-status-tab';
    button.type = 'button';
    button.className = 'training-subtab-v3 training-status-tab';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.innerHTML = '<i class="fa-solid fa-chart-simple"></i><span>狀態</span>';
    button.addEventListener('click', activateStatus);
    tabs.appendChild(button);
  }

  function bindNativeTabExit() {
    const page = document.getElementById('page-training');
    if (!page || page.dataset.statusExitBound === '1') return;
    page.dataset.statusExitBound = '1';
    page.addEventListener('click', (event) => {
      const nativeTab = event.target.closest?.('[data-training-tab]');
      if (nativeTab) deactivateStatus();
    }, true);
  }

  function sync() {
    ensureStatusTab();
    bindNativeTabExit();
    if (statusActive) renderStatus();
  }

  function boot() {
    loadStyle();
    sync();
    window.addEventListener('combat-stats-ready', renderStatus);
    window.addEventListener('golden-core-equipped-changed', renderStatus);

    new MutationObserver(() => {
      sync();
    }).observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
      if (statusActive) renderStatus();
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

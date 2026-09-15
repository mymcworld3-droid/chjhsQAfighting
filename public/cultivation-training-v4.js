import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 修煉 v4：玩家永遠只有一顆金丹；洗髓直接重塑該金丹，金丹不進背包。
(function () {
  'use strict';

  const GOLDEN_CORE_SCORE = 150;
  const WASH_COST = 100;
  const STATE_KEY = 'xiuxian_training_state_v4';
  const LEGACY_KEYS = [
    'xiuxian_training_state_v3',
    'xiuxian_training_state_v2',
    'xiuxian_training_state_v1'
  ];
  const CSS_HREF = 'cultivation-training-v3.css';
  const REMOTE_FIELD = 'cultivationTraining';
  const REALM_THRESHOLDS = [200, 300, 450, 650, 900, 1200, 1600];

  const GRADE_WEIGHTS = [
    { grade: 9, chance: 25 },
    { grade: 8, chance: 20 },
    { grade: 7, chance: 16 },
    { grade: 6, chance: 12 },
    { grade: 5, chance: 9 },
    { grade: 4, chance: 7 },
    { grade: 3, chance: 5 },
    { grade: 2, chance: 4 },
    { grade: 1, chance: 2 }
  ];

  let activeTab = 'core';
  let busy = false;
  let lastUnlocked = false;

  function clampGrade(value) {
    return Math.min(9, Math.max(1, Number(value) || 9));
  }

  function chanceByGrade(grade, base, step, cap = 95) {
    return Math.min(cap, base + (9 - clampGrade(grade)) * step);
  }

  function randomPercent(chance) {
    return Math.random() * 100 < chance;
  }

  const CORE_TYPES = [
    {
      id: 'ocean', name: '大海無垠丹', icon: '≈', tone: 'ocean',
      effect(grade) { return `獲取修為時有 ${chanceByGrade(grade, 50, 5, 90)}% 機率，使本次基礎修為增加一倍。`; },
      ability: '能自由操縱、憑空生成汪洋海水。',
      upkeep: '需日日飲五湖之水。',
      warning: '將水納入腹中時請確保此水無主，以免遭遇牢獄之災。',
      note: '召喚出的水是鹹的，不宜飲用。',
      resolve({ isCorrect, grade }) {
        if (!isCorrect) return {};
        const chance = chanceByGrade(grade, 50, 5, 90);
        return randomPercent(chance)
          ? { bonusGain: 1, message: `${this.name}潮聲大作，本次修為翻倍` }
          : {};
      }
    },
    {
      id: 'taichu', name: '太初回元丹', icon: '☀', tone: 'gold',
      effect(grade) { return `每累積 ${Math.max(2, grade + 1)} 次悟道成功，額外獲得 1 修為。`; },
      ability: '可將昨夜的疲憊暫時塞回昨夜。',
      upkeep: '每日清晨面向東方吸三口「看起來很貴」的空氣。',
      warning: '若所在地空氣品質不佳，請勿為修仙硬吸。',
      note: '丹方聲稱可返本歸元，但無法返還已繳交的作業。',
      resolve({ isCorrect, grade, counters }) {
        if (!isCorrect) return {};
        const interval = Math.max(2, grade + 1);
        return counters.correct % interval === 0
          ? { bonusGain: 1, message: `${this.name}回元，額外 +1 修為` }
          : {};
      }
    },
    {
      id: 'ningxin', name: '凝心靜音丹', icon: '◈', tone: 'ivory',
      effect(grade) { return `連續悟道達 ${Math.max(1, Math.ceil(grade / 3)) + 1} 次即可形成道心護體。`; },
      ability: '可將周圍雜音視為「與本道無關」。',
      upkeep: '每日靜坐一刻鐘，手機需反扣桌面。',
      warning: '靜音效果過強時，師尊喊你吃飯也可能聽不見。',
      note: '對樓上裝修聲的實際效果仍在研究中。',
      resolve({ isCorrect, grade, previousStreak }) {
        if (!isCorrect) return {};
        const threshold = Math.max(1, Math.ceil(grade / 3));
        return previousStreak >= threshold
          ? { forceShield: true, message: `${this.name}凝神，道心護體成形` }
          : {};
      }
    },
    {
      id: 'pojing', name: '破境拆牆丹', icon: '✦', tone: 'amber',
      effect(grade) { return `距離下一境界 ${Math.max(2, (10 - grade) * 2)} 修為內時，悟道成功額外 +1 修為。`; },
      ability: '對「瓶頸」一詞具有非常字面的理解。',
      upkeep: '每日尋找一堵不存在的牆並將其推倒。',
      warning: '請勿拿鄰居家的牆驗證藥效。',
      note: '對真正的牆無效，對心理障礙偶爾有效。',
      resolve({ isCorrect, grade, score }) {
        if (!isCorrect) return {};
        const next = REALM_THRESHOLDS.find((need) => need > score);
        const range = Math.max(2, (10 - grade) * 2);
        return next && next - score <= range
          ? { bonusGain: 1, message: `${this.name}助你破境，額外 +1 修為` }
          : {};
      }
    },
    {
      id: 'xingchen', name: '星辰吞月丹', icon: '✧', tone: 'pale',
      effect(grade) { return `連續悟道達 ${Math.max(1, grade)} 次後，每次成功額外 +1 修為。`; },
      ability: '夜間仰頭時會覺得星星跟你很熟。',
      upkeep: '每月需選一晚認真看月亮五分鐘。',
      warning: '太陽也是星星，但請勿直視以追求九倍效率。',
      note: '陰天時可看天氣 App 圖示代替，藥師說勉強算。',
      resolve({ isCorrect, grade, previousStreak }) {
        return isCorrect && previousStreak >= Math.max(1, grade)
          ? { bonusGain: 1, message: `${this.name}引星入體，額外 +1 修為` }
          : {};
      }
    },
    {
      id: 'wugou', name: '無垢摸魚丹', icon: '◇', tone: 'silver',
      effect(grade) { return `答錯時有 ${chanceByGrade(grade, 10, 8, 74)}% 機率保留既有道心護體。`; },
      ability: '可在心中迅速建立「我其實有在做事」的結界。',
      upkeep: '每日需合理休息，不得把合理二字刪掉。',
      warning: '本丹只保護道心，不保護瀏覽器歷史紀錄。',
      note: '摸魚太久仍會被現實世界的師尊發現。',
      resolve({ isCorrect, grade, hasShield }) {
        if (isCorrect || !hasShield) return {};
        const chance = chanceByGrade(grade, 10, 8, 74);
        return randomPercent(chance)
          ? { preserveShield: true, message: `${this.name}護住道心，護體未散` }
          : {};
      }
    },
    {
      id: 'thunder', name: '雷公安眠丹', icon: 'ϟ', tone: 'thunder',
      effect(grade) { return `悟道成功時有 ${chanceByGrade(grade, 8, 5, 48)}% 機率直接形成道心護體。`; },
      ability: '掌心偶爾冒出非常有禮貌的小閃電。',
      upkeep: '雷雨天需早睡，因為雷公正在值夜班。',
      warning: '理論上可替手機充電；實測後手機通常不再需要充電。',
      note: '安眠是指別人被雷聲嚇醒後，你會顯得睡得特別安穩。',
      resolve({ isCorrect, grade }) {
        if (!isCorrect) return {};
        const chance = chanceByGrade(grade, 8, 5, 48);
        return randomPercent(chance)
          ? { forceShield: true, message: `${this.name}雷光護體` }
          : {};
      }
    },
    {
      id: 'reverse', name: '倒反天罡丹', icon: '↺', tone: 'violet',
      effect(grade) { return `連續悟道達 ${Math.max(2, grade + 1)} 次時，額外獲得 2 修為。`; },
      ability: '偶爾能把「我不會」倒轉成「會不我」，效果主要是讓敵人困惑。',
      upkeep: '每日倒著讀一句話，但不建議倒著走樓梯。',
      warning: '施術前請先確認手上的湯與咖啡已放下。',
      note: '目前尚未成功將星期一倒轉成星期五。',
      resolve({ isCorrect, grade, previousStreak }) {
        const threshold = Math.max(2, grade + 1);
        return isCorrect && previousStreak + 1 === threshold
          ? { bonusGain: 2, message: `${this.name}倒轉氣機，額外 +2 修為` }
          : {};
      }
    }
  ];

  function coreType(id) {
    return CORE_TYPES.find((item) => item.id === id) || CORE_TYPES[0];
  }

  function normalizeCore(core, fallback = null) {
    if (!core || typeof core !== 'object') return fallback;
    return {
      type: core.type || core.id || 'taichu',
      grade: clampGrade(core.grade),
      createdAt: Number(core.createdAt || core.formedAt) || Date.now()
    };
  }

  function starterCore() {
    return { type: 'taichu', grade: 9, createdAt: Date.now() };
  }

  function defaultState() {
    return {
      announced: false,
      core: starterCore(),
      equipped: true,
      counters: { correct: 0, mistakes: 0 },
      items: []
    };
  }

  function migrate(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;

    // 舊版可能有 equipped / preview / inventory 多顆金丹；升級後只保留一顆。
    const chosen = normalizeCore(raw.core || raw.preview || raw.equipped, base.core);
    let equipped = true;
    if (typeof raw.equipped === 'boolean') equipped = raw.equipped;
    else if (raw.preview && raw.equipped && raw.preview.instanceId && raw.equipped.instanceId) {
      equipped = raw.preview.instanceId === raw.equipped.instanceId;
    }

    return {
      announced: !!raw.announced,
      core: chosen,
      equipped,
      counters: { ...base.counters, ...(raw.counters || {}) },
      // 背包只保留非金丹物品；舊版金丹 inventory 全部丟棄。
      items: Array.isArray(raw.items) ? raw.items : []
    };
  }

  function loadState() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STATE_KEY)); } catch (_) {}
    if (!raw) {
      for (const key of LEGACY_KEYS) {
        try { raw = JSON.parse(localStorage.getItem(key)); } catch (_) {}
        if (raw) break;
      }
    }
    return migrate(raw);
  }

  let state = loadState();

  function saveLocal() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function serializableState() {
    return {
      announced: state.announced,
      core: state.core,
      equipped: state.equipped,
      counters: state.counters,
      items: state.items
    };
  }

  function currentScore() {
    return Math.max(0, Number(window.getCurrentUserData?.()?.stats?.totalScore) || 0);
  }

  function currentSpiritStones() {
    return Math.max(0, Number(window.getCurrentUserData?.()?.stats?.gold) || 0);
  }

  function isUnlocked() {
    return currentScore() >= GOLDEN_CORE_SCORE;
  }

  function loadStyle() {
    if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  function toast(message) {
    document.getElementById('training-v4-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'training-v4-toast';
    el.className = 'training-v3-toast';
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => el.remove(), 2800);
  }

  function randomGrade() {
    const roll = Math.random() * 100;
    let cursor = 0;
    for (const item of GRADE_WEIGHTS) {
      cursor += item.chance;
      if (roll < cursor) return item.grade;
    }
    return 9;
  }

  function randomCore() {
    const type = CORE_TYPES[Math.floor(Math.random() * CORE_TYPES.length)];
    return { type: type.id, grade: randomGrade(), createdAt: Date.now() };
  }

  function coreVisualMarkup(core, clickable = true) {
    const type = coreType(core.type);
    return `
      <button type="button" class="golden-core-stage-v3 ${clickable ? 'clickable' : ''}" ${clickable ? 'id="training-core-orb" aria-label="查看金丹詳細資料"' : 'tabindex="-1"'}>
        <span class="golden-core-halo-v3 halo-a"></span>
        <span class="golden-core-halo-v3 halo-b"></span>
        <span class="golden-core-orbit-v3 orbit-a"></span>
        <span class="golden-core-orbit-v3 orbit-b"></span>
        <span class="golden-core-sphere-v3 core-tone-${type.tone}"><span>${type.icon}</span></span>
        <span class="golden-core-shadow-v3"></span>
      </button>
    `;
  }

  function coreTabMarkup() {
    const core = state.core;
    const type = coreType(core.type);
    return `
      <section class="core-minimal-card">
        <div class="core-minimal-center">
          ${coreVisualMarkup(core, true)}
          <h3 class="core-minimal-name">${type.name}</h3>
          <div class="core-minimal-grade">${clampGrade(core.grade)} 品</div>

          <div class="core-wash-row">
            <button id="wash-golden-core" type="button" class="core-wash-btn" ${busy ? 'disabled' : ''}>
              <i class="fa-solid fa-rotate"></i>
              <span>${busy ? '洗髓中…' : '洗髓（100 靈石）'}</span>
            </button>
            <button id="core-odds-info" type="button" class="core-info-btn" aria-label="查看品質機率">
              <i class="fa-solid fa-exclamation"></i>
            </button>
          </div>

          <button id="equip-current-core" type="button" class="core-equip-btn ${state.equipped ? 'equipped' : ''}" ${state.equipped || busy ? 'disabled' : ''}>
            ${state.equipped ? '<i class="fa-solid fa-circle-check"></i> 已裝配此金丹' : '<i class="fa-solid fa-circle-dot"></i> 裝配此金丹'}
          </button>
        </div>
      </section>
    `;
  }

  function bagTabMarkup() {
    const items = Array.isArray(state.items) ? state.items : [];
    if (!items.length) {
      return `
        <section class="training-v3-empty">
          <i class="fa-solid fa-box-open"></i>
          <h3>背包尚空</h3>
          <p>金丹屬於丹田本命之物，不會放入背包。</p>
        </section>
      `;
    }

    return `
      <section class="training-v3-bag-grid">
        ${items.map((item) => `
          <div class="training-v3-bag-item">
            <span class="training-v3-mini-core">${item.icon || '◆'}</span>
            <span class="training-v3-bag-copy">
              <strong>${item.name || '修煉物品'}</strong>
              <small>× ${Math.max(1, Number(item.qty) || 1)}</small>
            </span>
          </div>
        `).join('')}
      </section>
    `;
  }

  function renderTrainingPage() {
    const content = document.getElementById('training-tab-content');
    if (!content) return;
    content.innerHTML = activeTab === 'bag' ? bagTabMarkup() : coreTabMarkup();
    if (activeTab === 'core') bindCoreActions();
  }

  function createNavButton() {
    if (document.getElementById('nav-training')) return;
    const nav = document.getElementById('nav-grid');
    const homeButton = nav?.querySelector('[data-target="page-home"]');
    if (!nav || !homeButton) return;

    const button = document.createElement('button');
    button.id = 'nav-training';
    button.type = 'button';
    button.className = 'nav-btn training-nav-btn group flex-1 flex flex-col items-center justify-center h-full transition-all';
    button.dataset.target = 'page-training';
    button.innerHTML = `<div class="relative p-1 training-nav-orb"><i class="fa-solid fa-fire-flame-curved text-lg"></i></div><span class="text-[10px] mt-1">修煉</span>`;
    button.addEventListener('click', () => {
      window.switchToPage?.('page-training');
      renderTrainingPage();
    });
    homeButton.insertAdjacentElement('afterend', button);
  }

  function createTrainingPage() {
    if (document.getElementById('page-training')) return;
    const home = document.getElementById('page-home');
    if (!home) return;

    const page = document.createElement('div');
    page.id = 'page-training';
    page.className = 'page-section hidden px-4 training-page training-page-v3';
    page.innerHTML = `
      <div class="training-page-heading-v3">
        <div><div class="training-eyebrow-v3">INNER ALCHEMY ／ 內丹修行</div><h2>修煉</h2></div>
        <div class="training-realm-seal-v3">金丹</div>
      </div>
      <div class="training-subtabs-v3" role="tablist">
        <button type="button" class="training-subtab-v3 active" data-training-tab="core"><i class="fa-solid fa-circle-dot"></i><span>金丹</span></button>
        <button type="button" class="training-subtab-v3" data-training-tab="bag"><i class="fa-solid fa-box-open"></i><span>背包</span></button>
      </div>
      <div id="training-tab-content"></div>
    `;
    home.insertAdjacentElement('afterend', page);

    page.querySelectorAll('[data-training-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        activeTab = button.dataset.trainingTab === 'bag' ? 'bag' : 'core';
        page.querySelectorAll('[data-training-tab]').forEach((tab) => {
          tab.classList.toggle('active', tab.dataset.trainingTab === activeTab);
        });
        renderTrainingPage();
      });
    });
    renderTrainingPage();
  }

  function modalShell(id, title, body) {
    document.getElementById(id)?.remove();
    const modal = document.createElement('div');
    modal.id = id;
    modal.className = 'training-v3-modal-backdrop';
    modal.innerHTML = `
      <section class="training-v3-modal" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="training-v3-modal-head"><h3>${title}</h3><button type="button" class="training-v3-modal-close" aria-label="關閉"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="training-v3-modal-body">${body}</div>
      </section>
    `;
    const close = () => modal.remove();
    modal.querySelector('.training-v3-modal-close').addEventListener('click', close);
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    document.body.appendChild(modal);
  }

  function showOdds() {
    modalShell('training-v3-odds-modal', '金丹品質機率', `
      <div class="training-v3-odds-list">
        ${GRADE_WEIGHTS.slice().reverse().map((item) => `<div class="training-v3-odds-row grade-${item.grade}"><span>${item.grade} 品</span><strong>${item.chance}%</strong></div>`).join('')}
      </div>
    `);
  }

  function showCoreDetails(core) {
    const type = coreType(core.type);
    modalShell('training-v3-detail-modal', `${core.grade} 品 · ${type.name}`, `
      <div class="training-v3-detail-top">${coreVisualMarkup(core, false)}</div>
      <div class="training-v3-lore">
        <div><span>特性效果</span><p>${type.effect(core.grade)}</p></div>
        <div><span>神通</span><p>${type.ability}</p></div>
        <div><span>修煉代價</span><p>${type.upkeep}</p></div>
        <div><span>溫馨提醒</span><p>${type.warning}</p></div>
        <div><span>備註</span><p>${type.note}</p></div>
      </div>
    `);
  }

  function bindCoreActions() {
    document.getElementById('training-core-orb')?.addEventListener('click', () => showCoreDetails(state.core));
    document.getElementById('core-odds-info')?.addEventListener('click', showOdds);
    document.getElementById('wash-golden-core')?.addEventListener('click', washCore);
    document.getElementById('equip-current-core')?.addEventListener('click', equipCore);
  }

  async function persistRemote(extraFields = {}) {
    saveLocal();
    const auth = getAuth(getApp());
    const user = auth.currentUser;
    if (!user) return;
    const db = getFirestore(getApp());
    await updateDoc(doc(db, 'users', user.uid), {
      [REMOTE_FIELD]: serializableState(),
      ...extraFields
    });
  }

  async function washCore() {
    if (busy) return;
    const userData = window.getCurrentUserData?.();
    if (!userData?.stats) return toast('尚未讀取到修士資料。');

    const stones = currentSpiritStones();
    if (stones < WASH_COST) return toast(`靈石不足，洗髓需要 ${WASH_COST} 靈石。`);

    busy = true;
    renderTrainingPage();
    const previousCore = { ...state.core };
    const previousEquipped = state.equipped;
    const previousGold = stones;

    try {
      const fresh = randomCore();
      // 洗髓是直接重塑唯一的一顆金丹，不生成第二顆。
      state.core = fresh;
      state.equipped = false;
      userData.stats.gold = stones - WASH_COST;
      await persistRemote({ 'stats.gold': stones - WASH_COST });
      toast(`洗髓完成：${fresh.grade} 品 ${coreType(fresh.type).name}`);
    } catch (error) {
      console.error('Wash golden core failed:', error);
      state.core = previousCore;
      state.equipped = previousEquipped;
      userData.stats.gold = previousGold;
      saveLocal();
      toast('洗髓失敗，靈石未扣除。');
    } finally {
      busy = false;
      renderTrainingPage();
    }
  }

  async function equipCore() {
    if (busy || state.equipped) return;
    busy = true;
    state.equipped = true;
    renderTrainingPage();
    try {
      await persistRemote();
      toast(`已裝配：${state.core.grade} 品 ${coreType(state.core.type).name}`);
    } catch (error) {
      console.error('Equip golden core failed:', error);
      state.equipped = false;
      saveLocal();
      toast('裝配失敗，請稍後再試。');
    } finally {
      busy = false;
      renderTrainingPage();
    }
  }

  function ensureUnlockedUI() {
    loadStyle();
    createNavButton();
    createTrainingPage();
    document.body.classList.add('cultivation-training-unlocked');
    if (!state.announced) {
      state.announced = true;
      saveLocal();
      toast('金丹已成，「修煉」分頁已開啟。');
    }
  }

  function removeLockedUI() {
    document.getElementById('nav-training')?.remove();
    document.getElementById('page-training')?.remove();
    document.body.classList.remove('cultivation-training-unlocked');
  }

  // 只有唯一金丹被裝配時，其特性才會進入答題結算。
  window.resolveGoldenCoreCultivationReward = function ({ stats, isCorrect }) {
    if (!isUnlocked() || !state.equipped || !state.core) {
      return { bonusGain: 0, message: '' };
    }

    const type = coreType(state.core.type);
    const grade = clampGrade(state.core.grade);
    const previousStreak = Math.max(0, Number(stats?.currentStreak) || 0);
    const score = Math.max(0, Number(stats?.totalScore) || 0);

    if (isCorrect) state.counters.correct = Math.max(0, Number(state.counters.correct) || 0) + 1;
    else state.counters.mistakes = Math.max(0, Number(state.counters.mistakes) || 0) + 1;

    const effect = type.resolve({
      isCorrect,
      grade,
      previousStreak,
      score,
      counters: state.counters,
      hasShield: !!stats?.cultivationShield
    }) || {};

    saveLocal();
    return {
      bonusGain: Math.max(0, Number(effect.bonusGain) || 0),
      forceShield: !!effect.forceShield,
      preserveShield: !!effect.preserveShield,
      message: effect.message || ''
    };
  };

  window.getGoldenCoreState = function () {
    if (!isUnlocked()) return null;
    const type = coreType(state.core.type);
    return {
      type: state.core.type,
      name: type.name,
      grade: state.core.grade,
      effect: type.effect(state.core.grade),
      equipped: state.equipped,
      core: { ...state.core }
    };
  };

  function syncUnlock() {
    const unlocked = isUnlocked();
    if (unlocked) ensureUnlockedUI();
    else if (lastUnlocked) removeLockedUI();
    lastUnlocked = unlocked;
  }

  function boot() {
    loadStyle();
    syncUnlock();
    setInterval(syncUnlock, 900);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

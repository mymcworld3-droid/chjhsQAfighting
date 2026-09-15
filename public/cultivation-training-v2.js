import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 金丹期解鎖的「修煉」系統 v2：100 金幣抽丹、隨機丹種／品階、背包與本命金丹。
(function () {
  'use strict';

  const GOLDEN_CORE_SCORE = 150;
  const DRAW_COST = 100;
  const STATE_KEY = 'xiuxian_training_state_v2';
  const LEGACY_STATE_KEY = 'xiuxian_training_state_v1';
  const CSS_HREF = 'cultivation-training-v2.css';
  const REMOTE_FIELD = 'cultivationTraining';

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

  const REALM_THRESHOLDS = [200, 300, 450, 650, 900, 1200, 1600];

  const percentByQuality = (grade, base, step, cap = 95) => Math.min(cap, base + (9 - clampGrade(grade)) * step);

  const PILL_TYPES = [
    {
      id: 'ocean',
      name: '大海無垠丹',
      short: '無垠',
      icon: '≈',
      tone: 'ocean',
      effect(grade) {
        return `獲取修為時有 ${percentByQuality(grade, 50, 5, 90)}% 機率，使本次基礎修為增加一倍`;
      },
      ability: '能自由操縱、憑空生成汪洋海水。',
      upkeep: '需日日飲五湖之水。',
      warning: '將水納入腹中時請確保此水無主，以免遭遇牢獄之災。',
      note: '召喚出的水是鹹的，不宜飲用。',
      resolve({ isCorrect, grade }) {
        if (!isCorrect) return {};
        const chance = percentByQuality(grade, 50, 5, 90);
        return randomPercent(chance)
          ? { bonusGain: 1, message: `${this.name}潮聲大作，本次修為翻倍` }
          : {};
      }
    },
    {
      id: 'taichu',
      name: '太初回元丹',
      short: '太初',
      icon: '☀',
      tone: 'gold',
      effect(grade) {
        return `每累積 ${clampGrade(grade) + 1} 次悟道成功，額外獲得 1 修為`;
      },
      ability: '可將散落靈氣重新揉成一團，理論上也能把碎掉的餅乾拼回去。',
      upkeep: '每日卯時吸納第一縷晨光，陰天請自行想像。',
      warning: '不可用於回復已送出的訊息、已繳交的作業或已說出口的話。',
      note: '丹師堅稱「回元」不包含退款。',
      resolve({ isCorrect, grade, counters }) {
        if (!isCorrect) return {};
        const interval = clampGrade(grade) + 1;
        return counters.correct % interval === 0
          ? { bonusGain: 1, message: `${this.name}回元成功，額外 +1 修為` }
          : {};
      }
    },
    {
      id: 'ningxin',
      name: '凝心靜音丹',
      short: '凝心',
      icon: '◈',
      tone: 'ivory',
      effect(grade) {
        const required = Math.max(2, 4 - Math.floor((9 - clampGrade(grade)) / 3));
        return `連續悟道 ${required} 次即可提前形成道心護體`;
      },
      ability: '可屏蔽雜念、群組通知與「方便講一下嗎」的訊息震動。',
      upkeep: '每日靜坐一炷香，手機須正面朝下。',
      warning: '靜音效果過強時，可能連師尊叫你都聽不見。後果自負。',
      note: '對鬧鐘有效，故不建議睡前服用。',
      resolve({ isCorrect, grade, previousStreak }) {
        if (!isCorrect) return {};
        const required = Math.max(2, 4 - Math.floor((9 - clampGrade(grade)) / 3));
        return previousStreak >= required - 1
          ? { forceShield: true, message: `${this.name}封住雜念，道心護體成形` }
          : {};
      }
    },
    {
      id: 'pojing',
      name: '破境拆牆丹',
      short: '破境',
      icon: '✦',
      tone: 'amber',
      effect(grade) {
        return `距下一境界 ${4 + (9 - clampGrade(grade)) * 2} 修為內，悟道成功額外 +1 修為`;
      },
      ability: '看見瓶頸時會自動將其理解成一堵可以拆的牆。',
      upkeep: '丹田旁常備一塊磚，以提醒自己萬物皆可突破。',
      warning: '請勿拿鄰居家的牆測試「破境」效果。',
      note: '修仙界建築公會拒絕承保本丹造成的任何結構性損害。',
      resolve({ isCorrect, grade, score }) {
        if (!isCorrect) return {};
        const next = REALM_THRESHOLDS.find((need) => need > score);
        const range = 4 + (9 - clampGrade(grade)) * 2;
        return next && next - score <= range
          ? { bonusGain: 1, message: `${this.name}聞到瓶頸，額外 +1 修為` }
          : {};
      }
    },
    {
      id: 'xingchen',
      name: '星辰吞月丹',
      short: '星辰',
      icon: '✧',
      tone: 'pale',
      effect(grade) {
        return `連續悟道達 ${Math.max(2, clampGrade(grade))} 次後，每次成功額外 +1 修為`;
      },
      ability: '可引星輝入體，夜間修煉時自帶柔光，不必另外買檯燈。',
      upkeep: '每月至少仰望星空三次；住都市者可改看天文館海報。',
      warning: '太陽也是星星，但請勿直視以追求九倍效率。',
      note: '陰天不退費，月蝕期間客服暫停服務。',
      resolve({ isCorrect, grade, previousStreak }) {
        if (!isCorrect) return {};
        const required = Math.max(2, clampGrade(grade));
        return previousStreak + 1 >= required
          ? { bonusGain: 1, message: `${this.name}引星入體，額外 +1 修為` }
          : {};
      }
    },
    {
      id: 'wugou',
      name: '無垢摸魚丹',
      short: '無垢',
      icon: '◇',
      tone: 'silver',
      effect(grade) {
        return `失誤時有 ${percentByQuality(grade, 20, 5, 60)}% 機率保留既有道心護體`;
      },
      ability: '能洗去塵垢、疲憊與部分不想面對的工作痕跡。',
      upkeep: '每日必須合法摸魚三十分鐘，過度勤奮會使藥效下降。',
      warning: '摸魚期間若被師尊抓包，請勿宣稱「這是修煉的一部分」並出示本說明。',
      note: '對瀏覽器歷史紀錄無效，真的無效。',
      resolve({ isCorrect, grade, hasShield }) {
        if (isCorrect || !hasShield) return {};
        const chance = percentByQuality(grade, 20, 5, 60);
        return randomPercent(chance)
          ? { preserveShield: true, message: `${this.name}摸得恰到好處，道心護體未散` }
          : {};
      }
    },
    {
      id: 'leigong',
      name: '雷公安眠丹',
      short: '雷眠',
      icon: 'ϟ',
      tone: 'thunder',
      effect(grade) {
        return `悟道成功時有 ${percentByQuality(grade, 12, 4, 44)}% 機率直接形成道心護體`;
      },
      ability: '可借九天雷意淬神，附帶在雷雨夜睡得特別香的副作用。',
      upkeep: '每逢打雷需默念「我沒有在充電」三遍。',
      warning: '修煉時請遠離路由器、避雷針與正在更新韌體的家電。',
      note: '理論上能替手機充電；實測後手機通常不再需要充電。',
      resolve({ isCorrect, grade }) {
        if (!isCorrect) return {};
        const chance = percentByQuality(grade, 12, 4, 44);
        return randomPercent(chance)
          ? { forceShield: true, message: `${this.name}雷意護體，道心護體成形` }
          : {};
      }
    },
    {
      id: 'tiangang',
      name: '倒反天罡丹',
      short: '天罡',
      icon: '↟',
      tone: 'violet',
      effect(grade) {
        const interval = Math.max(3, clampGrade(grade) + 1);
        return `每連續悟道 ${interval} 次，第 ${interval} 次額外獲得 2 修為`;
      },
      ability: '可短暫顛倒上下左右與一些不太重要的常識。',
      upkeep: '每日倒著看一頁書；看懂與否不影響藥效。',
      warning: '施術前請先把湯、咖啡與沒有蓋子的飲料放下。',
      note: '天花板只有在你倒著時才算地板，房東通常不同意。',
      resolve({ isCorrect, grade, previousStreak }) {
        if (!isCorrect) return {};
        const interval = Math.max(3, clampGrade(grade) + 1);
        return (previousStreak + 1) % interval === 0
          ? { bonusGain: 2, message: `${this.name}倒轉常理，額外 +2 修為` }
          : {};
      }
    }
  ];

  let activeTab = 'core';
  let lastUnlocked = false;
  let drawing = false;
  let remoteHydratedForUid = null;

  function clampGrade(value) {
    return Math.min(9, Math.max(1, Number(value) || 9));
  }

  function randomUnit() {
    if (globalThis.crypto?.getRandomValues) {
      const a = new Uint32Array(1);
      globalThis.crypto.getRandomValues(a);
      return a[0] / 4294967296;
    }
    return Math.random();
  }

  function randomPercent(percent) {
    return randomUnit() * 100 < percent;
  }

  function randomGrade() {
    let roll = randomUnit() * 100;
    for (const row of GRADE_WEIGHTS) {
      roll -= row.chance;
      if (roll < 0) return row.grade;
    }
    return 9;
  }

  function randomType() {
    return PILL_TYPES[Math.floor(randomUnit() * PILL_TYPES.length)] || PILL_TYPES[0];
  }

  function typeFor(id) {
    return PILL_TYPES.find((pill) => pill.id === id) || PILL_TYPES[0];
  }

  function defaultState() {
    return {
      version: 2,
      announced: false,
      core: { type: 'taichu', grade: 9, formedAt: Date.now(), sourceId: 'innate' },
      counters: { correct: 0, mistakes: 0 },
      inventory: [],
      lastDrawId: null,
      totalDraws: 0
    };
  }

  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    const inventory = Array.isArray(raw.inventory) ? raw.inventory.map((item) => ({ ...item })) : [];
    return {
      ...base,
      ...raw,
      version: 2,
      core: { ...base.core, ...(raw.core || {}) },
      counters: { ...base.counters, ...(raw.counters || {}) },
      inventory
    };
  }

  function loadState() {
    let parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(STATE_KEY)); } catch (_) {}
    if (parsed) return normalizeState(parsed);

    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_STATE_KEY));
      if (legacy) return normalizeState(legacy);
    } catch (_) {}
    return defaultState();
  }

  let state = loadState();

  function saveState() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function remoteSafeState(value = state) {
    return JSON.parse(JSON.stringify({
      version: 2,
      announced: !!value.announced,
      core: value.core,
      counters: value.counters,
      inventory: value.inventory,
      lastDrawId: value.lastDrawId || null,
      totalDraws: Number(value.totalDraws) || 0
    }));
  }

  function currentUserData() {
    return window.getCurrentUserData?.() || null;
  }

  function currentScore() {
    return Math.max(0, Number(currentUserData()?.stats?.totalScore) || 0);
  }

  function currentGold() {
    return Math.max(0, Number(currentUserData()?.stats?.gold) || 0);
  }

  function isUnlocked() {
    return currentScore() >= GOLDEN_CORE_SCORE;
  }

  function currentType() {
    return typeFor(state.core?.type);
  }

  function gradeLabel(grade) {
    return `${clampGrade(grade)}品`;
  }

  function loadStyle() {
    if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  function toast(message) {
    const old = document.getElementById('training-unlock-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'training-unlock-toast';
    el.className = 'training-toast';
    el.innerHTML = `<span class="training-toast-mark">✦</span><span>${message}</span>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => el.remove(), 3800);
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
    button.setAttribute('aria-label', '修煉');
    button.innerHTML = `
      <div class="relative p-1 training-nav-orb"><i class="fa-solid fa-fire-flame-curved text-lg"></i></div>
      <span class="text-[10px] mt-1">修煉</span>
    `;
    button.addEventListener('click', () => {
      window.switchToPage?.('page-training');
      renderTrainingPage();
    });
    homeButton.insertAdjacentElement('afterend', button);
  }

  function coreVisualMarkup(type, grade, compact = false) {
    return `
      <div class="golden-core-stage ${compact ? 'compact' : ''}" aria-label="${gradeLabel(grade)} ${type.name}">
        <div class="golden-core-halo halo-one"></div><div class="golden-core-halo halo-two"></div>
        <div class="golden-core-orbit orbit-one"></div><div class="golden-core-orbit orbit-two"></div>
        <div class="golden-core-sphere core-tone-${type.tone}"><span class="golden-core-glyph">${type.icon}</span></div>
        <div class="golden-core-shadow"></div>
      </div>`;
  }

  function detailMarkup(type) {
    return `
      <div class="pill-lore">
        <div><span>神通</span><p>${type.ability}</p></div>
        <div><span>修煉代價</span><p>${type.upkeep}</p></div>
        <div><span>溫馨提醒</span><p>${type.warning}</p></div>
        <div><span>備註</span><p>${type.note}</p></div>
      </div>`;
  }

  function gradeScaleMarkup(currentGrade) {
    return `
      <div class="core-grade-scale" aria-label="金丹品階，一品最佳，九品最低">
        ${Array.from({ length: 9 }, (_, i) => i + 1).map((grade) => `
          <div class="core-grade-node ${grade === currentGrade ? 'current' : ''} ${grade < currentGrade ? 'higher' : 'lower'}">
            <span>${grade}</span><small>品</small>
          </div>`).join('')}
      </div>
      <div class="core-grade-hint"><span>一品 · 極品</span><span>九品 · 初成</span></div>`;
  }

  function oddsMarkup() {
    return GRADE_WEIGHTS.slice().reverse().map((row) => `
      <span class="grade-odds grade-${row.grade}"><b>${row.grade}品</b>${row.chance}%</span>`).join('');
  }

  function lastDrawMarkup() {
    const item = state.inventory.find((entry) => entry.id === state.lastDrawId && entry.kind === 'golden-core');
    if (!item) return '';
    const type = typeFor(item.type);
    return `
      <section class="draw-result grade-${clampGrade(item.grade)}">
        <div class="draw-result-label">最近一次結丹</div>
        <div class="draw-result-main">
          ${coreVisualMarkup(type, item.grade, true)}
          <div class="draw-result-copy">
            <div class="draw-result-title"><span>${gradeLabel(item.grade)}</span><h3>${type.name}</h3></div>
            <p class="effect-line">${type.effect(item.grade)}</p>
            ${detailMarkup(type)}
            <button type="button" class="equip-core-btn ${state.core.sourceId === item.id ? 'equipped' : ''}" data-equip-core="${item.id}" ${state.core.sourceId === item.id ? 'disabled' : ''}>
              ${state.core.sourceId === item.id ? '正在丹田中運轉' : '納入丹田'}
            </button>
          </div>
        </div>
      </section>`;
  }

  function drawPanelMarkup() {
    const gold = currentGold();
    const insufficient = gold < DRAW_COST;
    return `
      <section class="training-card core-draw-panel">
        <div class="training-section-heading draw-heading">
          <div><div class="training-section-kicker">ALCHEMY LOT</div><h3>百金結丹</h3></div>
          <div class="training-wallet"><i class="fa-solid fa-coins"></i><span id="training-gold-balance">${gold.toLocaleString()}</span></div>
        </div>
        <p class="draw-intro">投入 100 金幣，天地隨機決定丹種與品階。天地表示：機率都寫在下面了，不接受「我朋友一抽就一品」作為申訴理由。</p>
        <div class="grade-odds-row">${oddsMarkup()}</div>
        <button id="draw-golden-core" type="button" class="draw-core-btn" ${drawing || insufficient ? 'disabled' : ''}>
          <i class="fa-solid fa-coins"></i>
          <span>${drawing ? '天道正在擲骰子…' : insufficient ? '金幣不足' : '消耗 100 金幣 · 抽取金丹'}</span>
        </button>
        <div class="draw-footnote">丹種等機率抽取；品階一品最佳、九品最低。抽到的金丹會永久收入背包，可自由更換本命金丹。</div>
      </section>
      ${lastDrawMarkup()}`;
  }

  function pillCatalogueMarkup() {
    return PILL_TYPES.map((pill) => `
      <article class="pill-type-card ${pill.id === state.core.type ? 'owned' : ''}">
        <div class="pill-type-icon core-tone-${pill.tone}">${pill.icon}</div>
        <div class="pill-type-copy">
          <div class="pill-type-title-row"><h4>${pill.name}</h4><span class="pill-status">九品基準</span></div>
          <p class="effect-line">${pill.effect(9)}</p>
          <details class="pill-details"><summary>查看丹方秘錄</summary>${detailMarkup(pill)}</details>
        </div>
      </article>`).join('');
  }

  function coreTabMarkup() {
    const type = currentType();
    const grade = clampGrade(state.core.grade);
    return `
      ${drawPanelMarkup()}
      <div class="training-core-layout">
        <section class="core-showcase training-card">
          <div class="training-section-kicker">CURRENT GOLDEN CORE</div>
          ${coreVisualMarkup(type, grade)}
          <div class="core-name-block">
            <span class="core-grade-badge grade-${grade}">${gradeLabel(grade)}</span>
            <h3>${type.name}</h3>
            <p class="effect-line">${type.effect(grade)}</p>
          </div>
          <details class="pill-details current-core-details" open><summary>本命金丹詳細資料</summary>${detailMarkup(type)}</details>
        </section>
        <section class="core-details training-card">
          <div class="training-section-heading"><div><div class="training-section-kicker">QUALITY</div><h3>金丹品階</h3></div><span class="quality-note">一品最好</span></div>
          ${gradeScaleMarkup(grade)}
          <div class="core-rule-note"><i class="fa-solid fa-circle-info"></i><span>品質越高，被動特性越強。丹種決定玩法，品階決定它到底有多離譜。</span></div>
        </section>
      </div>
      <section class="training-card pill-catalogue">
        <div class="training-section-heading"><div><div class="training-section-kicker">CORE PATHS</div><h3>金丹圖鑑</h3></div><span class="quality-note">${PILL_TYPES.length} 種丹性</span></div>
        <div class="pill-type-grid">${pillCatalogueMarkup()}</div>
      </section>`;
  }

  function inventoryCoreCard(item) {
    const type = typeFor(item.type);
    const grade = clampGrade(item.grade);
    const equipped = state.core.sourceId === item.id;
    return `
      <article class="inventory-core-card grade-${grade}">
        <div class="inventory-core-head">
          <div class="mini-core core-tone-${type.tone}">${type.icon}</div>
          <div><span class="inventory-grade">${gradeLabel(grade)}</span><h3>${type.name}</h3></div>
          ${equipped ? '<span class="equipped-tag">本命</span>' : ''}
        </div>
        <p class="effect-line">${type.effect(grade)}</p>
        <details class="pill-details"><summary>查看詳細資料</summary>${detailMarkup(type)}</details>
        <button type="button" class="equip-core-btn ${equipped ? 'equipped' : ''}" data-equip-core="${item.id}" ${equipped ? 'disabled' : ''}>${equipped ? '正在丹田中運轉' : '納入丹田'}</button>
      </article>`;
  }

  function inventoryMarkup() {
    const cores = state.inventory.filter((item) => item.kind === 'golden-core');
    const others = state.inventory.filter((item) => item.kind !== 'golden-core');
    if (!cores.length && !others.length) {
      return `<section class="training-card backpack-panel"><div class="backpack-empty-icon"><i class="fa-solid fa-box-open"></i></div><h3>背包尚空</h3><p>抽到的金丹會收納在此。天地不提供七日鑑賞期。</p><div class="backpack-tip"><i class="fa-solid fa-circle-info"></i> 本命金丹可隨時從背包更換，不會被吃掉。</div></section>`;
    }

    return `
      <section class="training-card backpack-summary"><div><span>金丹收藏</span><strong>${cores.length}</strong></div><div><span>累計抽丹</span><strong>${Number(state.totalDraws) || 0}</strong></div><div><span>目前本命</span><strong>${gradeLabel(state.core.grade)} ${currentType().short}</strong></div></section>
      ${cores.length ? `<section class="inventory-core-grid">${cores.map(inventoryCoreCard).join('')}</section>` : ''}
      ${others.length ? `<section class="training-card backpack-panel has-items"><div class="inventory-grid">${others.map((item) => `<div class="inventory-slot"><div class="inventory-icon">${item.icon || '◆'}</div><div><strong>${item.name || '修煉物品'}</strong><small>× ${Math.max(1, Number(item.qty) || 1)}</small></div></div>`).join('')}</div></section>` : ''}`;
  }

  function createTrainingPage() {
    if (document.getElementById('page-training')) return;
    const home = document.getElementById('page-home');
    if (!home) return;

    const page = document.createElement('div');
    page.id = 'page-training';
    page.className = 'page-section hidden px-4 training-page';
    page.innerHTML = `
      <div class="training-page-heading"><div><div class="training-eyebrow">INNER ALCHEMY ／ 內丹修行</div><h2>修煉</h2><p>金丹既成，自此內觀丹田；若不滿意，也可以花錢請天道重抽。</p></div><div class="training-realm-seal">金丹</div></div>
      <div class="training-subtabs" role="tablist" aria-label="修煉分頁">
        <button type="button" class="training-subtab active" data-training-tab="core" role="tab" aria-selected="true"><i class="fa-solid fa-circle-dot"></i><span>金丹</span></button>
        <button type="button" class="training-subtab" data-training-tab="bag" role="tab" aria-selected="false"><i class="fa-solid fa-box-open"></i><span>背包</span></button>
      </div>
      <div id="training-tab-content" class="training-tab-content"></div>`;

    home.insertAdjacentElement('afterend', page);
    page.querySelectorAll('[data-training-tab]').forEach((button) => button.addEventListener('click', () => switchTrainingTab(button.dataset.trainingTab)));
    renderTrainingPage();
  }

  function switchTrainingTab(tab) {
    activeTab = tab === 'bag' ? 'bag' : 'core';
    document.querySelectorAll('#page-training [data-training-tab]').forEach((button) => {
      const active = button.dataset.trainingTab === activeTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderTrainingPage();
  }

  function bindContentActions() {
    document.getElementById('draw-golden-core')?.addEventListener('click', drawGoldenCore);
    document.querySelectorAll('[data-equip-core]').forEach((button) => {
      button.addEventListener('click', () => equipCore(button.dataset.equipCore));
    });
  }

  function renderTrainingPage() {
    const content = document.getElementById('training-tab-content');
    if (!content) return;
    content.innerHTML = activeTab === 'bag' ? inventoryMarkup() : coreTabMarkup();
    bindContentActions();
  }

  async function persistRemote(nextState, newGold = null) {
    const auth = getAuth(getApp());
    if (!auth.currentUser) throw new Error('尚未登入');
    const db = getFirestore(getApp());
    const patch = { [REMOTE_FIELD]: remoteSafeState(nextState) };
    if (newGold != null) patch['stats.gold'] = newGold;
    await updateDoc(doc(db, 'users', auth.currentUser.uid), patch);
  }

  async function drawGoldenCore() {
    if (drawing) return;
    if (!isUnlocked()) return toast('尚未結成金丹，天道拒絕收錢。');
    const user = currentUserData();
    const gold = currentGold();
    if (!user?.stats) return toast('玩家資料仍在雲海中，請稍後再試。');
    if (gold < DRAW_COST) return toast(`金幣不足：抽一次需要 ${DRAW_COST} 金幣。`);

    drawing = true;
    renderTrainingPage();

    const type = randomType();
    const grade = randomGrade();
    const item = {
      id: `core_${Date.now()}_${Math.floor(randomUnit() * 1e9).toString(36)}`,
      kind: 'golden-core',
      type: type.id,
      grade,
      createdAt: Date.now()
    };
    const nextState = normalizeState({
      ...state,
      inventory: [item, ...state.inventory],
      lastDrawId: item.id,
      totalDraws: (Number(state.totalDraws) || 0) + 1
    });
    const newGold = gold - DRAW_COST;

    try {
      await persistRemote(nextState, newGold);
      state = nextState;
      saveState();
      user.stats.gold = newGold;
      const storePts = document.getElementById('store-user-points');
      if (storePts) storePts.textContent = newGold.toLocaleString();
      toast(`結丹成功：${gradeLabel(grade)}・${type.name}！`);
    } catch (error) {
      console.error('Golden core draw failed:', error);
      toast('結丹失敗，金幣未扣除。天道今天可能在維護。');
    } finally {
      drawing = false;
      renderTrainingPage();
    }
  }

  async function equipCore(itemId) {
    const item = state.inventory.find((entry) => entry.id === itemId && entry.kind === 'golden-core');
    if (!item) return toast('找不到這顆金丹，它可能自己悟道去了。');
    const type = typeFor(item.type);
    const nextState = normalizeState({
      ...state,
      core: { type: item.type, grade: clampGrade(item.grade), formedAt: item.createdAt || Date.now(), sourceId: item.id }
    });
    state = nextState;
    saveState();
    renderTrainingPage();
    toast(`${gradeLabel(item.grade)} ${type.name} 已納入丹田。`);

    try {
      await persistRemote(nextState);
    } catch (error) {
      console.warn('Golden core equip sync failed:', error);
    }
  }

  function hydrateRemoteState() {
    const auth = getAuth(getApp());
    const userData = currentUserData();
    const uid = auth.currentUser?.uid;
    if (!uid || !userData || remoteHydratedForUid === uid) return;
    remoteHydratedForUid = uid;
    if (userData[REMOTE_FIELD] && typeof userData[REMOTE_FIELD] === 'object') {
      const remote = normalizeState(userData[REMOTE_FIELD]);
      remote.counters.correct = Math.max(Number(remote.counters.correct) || 0, Number(state.counters.correct) || 0);
      remote.counters.mistakes = Math.max(Number(remote.counters.mistakes) || 0, Number(state.counters.mistakes) || 0);
      state = remote;
      saveState();
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
      saveState();
      toast('金丹已成！「修煉」分頁已開啟。');
    }
  }

  function removeLockedUI() {
    document.getElementById('nav-training')?.remove();
    document.getElementById('page-training')?.remove();
    document.body.classList.remove('cultivation-training-unlocked');
  }

  window.resolveGoldenCoreCultivationReward = function ({ stats, isCorrect }) {
    if (!isUnlocked()) return { bonusGain: 0, message: '' };

    const type = currentType();
    const grade = clampGrade(state.core.grade);
    const previousStreak = Math.max(0, Number(stats?.currentStreak) || 0);
    const score = Math.max(0, Number(stats?.totalScore) || 0);
    if (isCorrect) state.counters.correct = Math.max(0, Number(state.counters.correct) || 0) + 1;
    else state.counters.mistakes = Math.max(0, Number(state.counters.mistakes) || 0) + 1;

    const result = type.resolve({
      isCorrect,
      grade,
      previousStreak,
      score,
      counters: state.counters,
      hasShield: !!stats?.cultivationShield
    }) || {};

    saveState();
    return {
      bonusGain: Math.max(0, Number(result.bonusGain) || 0),
      forceShield: !!result.forceShield,
      preserveShield: !!result.preserveShield,
      message: result.message || ''
    };
  };

  window.getGoldenCoreState = function () {
    if (!isUnlocked()) return null;
    const type = currentType();
    const grade = clampGrade(state.core.grade);
    return {
      type: type.id,
      name: type.name,
      grade,
      effect: type.effect(grade),
      gold: currentGold(),
      totalDraws: Number(state.totalDraws) || 0,
      inventory: state.inventory.map((item) => ({ ...item }))
    };
  };

  function syncUnlock() {
    hydrateRemoteState();
    const unlocked = isUnlocked();
    if (unlocked) {
      ensureUnlockedUI();
      if (!lastUnlocked) renderTrainingPage();
      const balance = document.getElementById('training-gold-balance');
      if (balance) balance.textContent = currentGold().toLocaleString();
    } else if (lastUnlocked) {
      removeLockedUI();
    }
    lastUnlocked = unlocked;
  }

  function boot() {
    loadStyle();
    syncUnlock();
    setInterval(syncUnlock, 900);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

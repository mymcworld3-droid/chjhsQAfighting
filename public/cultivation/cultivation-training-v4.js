import {} from './golden-core-pity.js';
import './golden-core-art.js';
import {} from './soul-talents.js';
import { equipmentShellMarkup, refineryShellMarkup } from './training-shared-shells.js';
import { createGoldenCoreWashAnimation } from './golden-core-wash-animation.js';
import {} from './nascent-growth.js';
import {} from './innate-ability.js';
import './tactical-rules.js';
import { NASCENT_SOUL_THRESHOLD, normalizeSpirit } from './nascent-soul-rules.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc, runTransaction } from '../data-store.js';

// 修煉 v4：金丹是修士在自身靈田／丹田中凝聚的本命金丹；玩家永遠只有一顆，洗髓只重塑其丹性與品級。
(function () {
  'use strict';

  const GOLDEN_CORE_SCORE = 28;
  const WASH_COST = 100;
  const Pity = globalThis.QAGoldenCorePity;
  const WASH_FIELD = 'goldenCoreWashV1';
  const STATE_KEY = 'xiuxian_training_state_v4';
  const LEGACY_KEYS = [
    'xiuxian_training_state_v3',
    'xiuxian_training_state_v2',
    'xiuxian_training_state_v1'
  ];
  const CSS_HREF = 'cultivation-training-v3.css';
  const REMOTE_FIELD = 'cultivationTraining';
  const REALM_THRESHOLDS = [68, 188, 428, 788, 1268, 1868];

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
  let soulBusy = false;
  const Growth = globalThis.QANascentGrowth;
  const Innate = globalThis.QAInnateAbility;
  let innateBusy = false;
  // 選取只屬於目前畫面；檢視節點不寫入或消耗碎精。
  const soulView = { selected: null, choosing: false, owner: '' };
  let migrationBusy = false;
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

  function breakthroughPercent(grade) {
    return 20 + (9 - clampGrade(grade)) * 5;
  }

  function inBreakthroughZone(score, grade) {
    const value = Math.max(0, Number(score) || 0);
    const thresholds = [GOLDEN_CORE_SCORE, ...REALM_THRESHOLDS];
    const next = thresholds.find((need) => need > value);
    if (!next) return false;

    let previous = GOLDEN_CORE_SCORE;
    for (const need of thresholds) {
      if (need <= value) previous = need;
      else break;
    }

    const span = Math.max(1, next - previous);
    const range = span * (breakthroughPercent(grade) / 100);
    return next - value <= range;
  }

  const CORE_TYPES = [
    {
      id: 'ocean', name: '大海無垠丹', icon: '≈', tone: 'ocean',
      effect(grade) {
        const chance = chanceByGrade(grade, 10, 5, 50);
        return `獲得修為時有 ${chance}% 機率使本次基礎修為翻倍；鬥法攻擊時有 ${chance}% 機率召喚千尺巨浪，額外造成 150 傷害。`;
      },
      ability: '潮汐入丹，悟道與鬥法皆可借海勢增幅。',
      upkeep: '每日觀水片刻，平心定氣。',
      warning: '巨浪只在鬥法結算中造成額外傷害。',
      note: '金丹內自成一片汪洋。據說大成後可號令萬水；目前最明顯的副作用，是看見水龍頭沒關會產生一種莫名的責任感。',
      resolve({ isCorrect, grade }) {
        if (!isCorrect) return {};
        const chance = chanceByGrade(grade, 10, 5, 50);
        return randomPercent(chance)
          ? { bonusGain: 1, message: `${this.name}潮聲大作，本次基礎修為翻倍` }
          : {};
      }
    },
    {
      id: 'taichu', name: '太初回元丹', icon: '☀', tone: 'gold',
      effect(grade) { return `每累積 ${Math.max(2, grade + 1)} 次悟道成功，額外獲得 1 修為；鬥法中每連續答對 ${Math.max(2, grade + 1)} 次，回復 100 生命。`; },
      ability: '以太初元氣反覆回補修行底蘊。',
      upkeep: '每日清晨靜坐片刻。',
      warning: '計數只累積悟道成功次數。',
      note: '太初元氣可返本歸元，但無法返還已交出去的作業、已讀的訊息，以及手滑花掉的靈石。',
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
      effect(grade) { return `連續悟道達 ${Math.max(1, Math.ceil(grade / 3)) + 1} 次，即凝聚金丹道心，問道失誤可消耗道心保留一次連答；鬥法中連續答對同樣次數也可形成道心護體；護體每次僅抵銷一次傷害後就消失，須由金丹再次凝聚；完全擋下普通首擊時不觸發連擊；真傷與追擊依各自效果結算。`; },
      ability: '凝神斂念，以連續悟道穩固金丹道心。',
      upkeep: '保持專注即可。',
      warning: '一般連勝本身沒有護體，必須調御此丹相才會觸發。',
      note: '金丹會替你隔絕雜念。師尊叫三次都沒回應時，通常會改用物理方式突破你的靜音結界。',
      resolve({ isCorrect, grade, previousStreak, hasShield }) {
        if (!isCorrect) return hasShield && previousStreak > 0 ? {preserveStreak:true,message:'凝心道心保留一次連答'} : {};
        const threshold = Math.max(1, Math.ceil(grade / 3));
        return previousStreak >= threshold
          ? { forceShield: true, message: `${this.name}凝神，金丹道心護體成形` }
          : {};
      }
    },
    {
      id: 'pojing', name: '破境衝仙丹', icon: '✦', tone: 'amber',
      effect(grade) { return `進入下一境界前最後 ${breakthroughPercent(grade)}% 的修為區間時，悟道成功額外 +5 修為；此時鬥法答對額外造成 100 傷害。`; },
      ability: '越近瓶頸，丹力越能衝擊境界壁障。',
      upkeep: '突破前保持穩定悟道。',
      warning: '只在接近下一境界的指定比例區間生效。',
      note: '專治修行瓶頸。對真正的牆壁沒有作用，請勿以額頭驗證丹力。',
      resolve({ isCorrect, grade, score }) {
        if (!isCorrect || !inBreakthroughZone(score, grade)) return {};
        return { bonusGain: 5, message: `${this.name}衝破瓶頸，額外 +5 修為` };
      }
    },
    {
      id: 'xingchen', name: '星辰吞月丹', icon: '✧', tone: 'pale',
      effect(grade) { return `連續悟道達 ${Math.max(1, grade)} 次後，之後每次成功額外 +2 修為；鬥法連續答對後每次額外造成 80 傷害。`; },
      ability: '連勝越久，星月之力越穩定。',
      upkeep: '維持連續悟道。',
      warning: '中斷連勝後需重新累積。',
      note: '陰天時可打開天氣 App 對著月亮圖示修煉；丹師表示「理論上應該差不多」。',
      resolve({ isCorrect, grade, previousStreak }) {
        return isCorrect && previousStreak >= Math.max(1, grade)
          ? { bonusGain: 2, message: `${this.name}引星吞月，額外 +2 修為` }
          : {};
      }
    },
    {
      id: 'wugou', name: '無垢清心丹', icon: '◇', tone: 'silver',
      effect(grade) { return `首次答對先前錯題的同概念變式，額外 +1 修為；鬥法答錯時有 ${chanceByGrade(grade, 20, 5, 60)}% 機率產生道心護體；護體每次僅抵銷一次傷害後就消失，須由金丹再次凝聚；完全擋下普通首擊時不觸發連擊；真傷與追擊依各自效果結算。`; },
      ability: '以訂正清心悟道，鬥法失誤時可凝聚護體。',
      upkeep: '答錯後重新定神即可。',
      warning: '訂正加成每道來源錯題一次，戰鬥護體仍只抵擋一次普通傷害。',
      note: '號稱心如明鏡、萬念不生。答錯時仍可能先懷疑答案，再懷疑出題老師。',
      resolve({ isCorrect, isRecovery }) {
        return isCorrect && isRecovery ? {recoveryBonusGain:1,message:'無垢明心，訂正額外 +1 修為'} : {};
      }
    },
    {
      id: 'thunder', name: '萬劫雷霆丹', icon: '⚡', tone: 'thunder',
      effect(grade) {
        return `進入下一境界前最後 ${breakthroughPercent(grade)}% 的修為區間時，悟道成功額外 +1 修為；答對時有 ${chanceByGrade(grade, 30, 5, 70)}% 機率使本回合反擊傷害 +75%（與元嬰、法寶加成相加，例如法寶 16% 觸發後變 91%；基於實際普通承傷，不含真傷；團本持續至下次首領攻擊，不疊加）。`;
      },
      ability: '以雷劫淬丹，答對蓄雷，受擊反攻。',
      upkeep: '須先答對蓄雷，再承受攻擊；未受擊不造成額外傷害。',
      warning: '若該次攻擊已使你倒下，則不再發動反擊。',
      note: '丹中雷光常年遊走。有人研究能不能順便替手機充電；手機沒充到，頭髮倒先充滿了。',
      resolve({ isCorrect, grade, score }) {
        if (!isCorrect || !inBreakthroughZone(score, grade)) return {};
        return { bonusGain: 1, message: `${this.name}雷劫淬體，額外 +1 修為` };
      }
    },
    {
      id: 'reverse', name: '陰陽反轉丹', icon: '↺', tone: 'violet',
      effect(grade) { const n = Math.max(2, grade + 1); return `每逢連續悟道達 ${n} 次的倍數（如 ${n}、${n * 2}、${n * 3}…），額外 +3 修為；鬥法連續答對達同樣倍數時，該次攻擊額外造成 120 傷害。`; },
      ability: '陰陽翻轉，在指定連勝節點爆發丹力。',
      upkeep: '保持連勝直到觸發節點。',
      warning: '只在達到指定連勝的那一次觸發。',
      note: '能逆轉陰陽、倒轉氣機。目前仍無法把星期一反轉成星期五，相關研究經費持續申請中。',
      resolve({ isCorrect, grade, previousStreak }) {
        const threshold = Math.max(2, grade + 1);
        return isCorrect && (previousStreak + 1) % threshold === 0
          ? { bonusGain: 3, message: `${this.name}陰陽反轉，額外 +3 修為` }
          : {};
      }
    },
    {
      id: 'sword', name: '破鋒劍心丹', icon: '⚔', tone: 'silver',
      effect(grade) { return `鬥法發動攻擊時有 ${chanceByGrade(grade, 10, 5, 50)}% 機率召喚萬劍追擊，額外造成 200 傷害。`; },
      ability: '丹心化劍，命中後有機率萬劍追擊。',
      upkeep: '只在鬥法攻擊命中時判定。',
      warning: '本丹沒有額外修為效果。',
      note: '一念萬劍生。初成時偶爾只聽見腦中「鏘」的一聲，但本人通常會堅稱萬劍只是尚未抵達。',
      resolve() { return {}; }
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

  function sameGoldenCore(a, b) {
    return !!a && !!b && (a.type || a.id) === (b.type || b.id) &&
      clampGrade(a.grade) === clampGrade(b.grade) &&
      Number(a.createdAt || a.formedAt || 0) === Number(b.createdAt || b.formedAt || 0);
  }

  function starterCore() {
    return { type: 'taichu', grade: 9, createdAt: Date.now() };
  }

  function defaultState() {
    const core = starterCore();
    return {
      announced: false,
      // core 是洗髓後目前正在查看／準備調御的候選丹相。
      core,
      // equippedCore 才是目前真正調御、正在作用中的本命金丹；洗髓不會把它清掉。
      equippedCore: { ...core },
      equipped: true,
      coreEnabled: true,
      counters: { correct: 0, mistakes: 0 },
      items: []
    };
  }

  function migrate(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;

    const legacyEquippedObject = raw.equipped && typeof raw.equipped === 'object' ? raw.equipped : null;
    const chosen = normalizeCore(raw.core || raw.preview || legacyEquippedObject, base.core);

    let equippedCore = normalizeCore(raw.equippedCore || legacyEquippedObject, null);
    let repairedLegacyWashState = false;
    if (!equippedCore && raw.equipped === true) equippedCore = { ...chosen };
    // 很舊的資料沒有 equipped 欄位時，原本金丹就是已裝配狀態。
    if (!equippedCore && typeof raw.equipped === 'undefined' && !raw.preview) equippedCore = { ...chosen };
    // v4 舊版洗髓會把原裝備丹覆蓋後只留下 equipped=false。舊丹已無法還原，
    // 因此僅對「沒有 equippedCore 的舊格式」做一次修復：讓目前金丹成為裝備丹，避免狀態頁永久空白。
    if (!equippedCore && raw.equipped === false && !Object.prototype.hasOwnProperty.call(raw, 'equippedCore')) {
      equippedCore = { ...chosen };
      repairedLegacyWashState = true;
    }

    let equipped = repairedLegacyWashState;
    if (!repairedLegacyWashState && typeof raw.equipped === 'boolean') equipped = raw.equipped && !!equippedCore;
    else if (raw.preview && legacyEquippedObject && raw.preview.instanceId && legacyEquippedObject.instanceId) {
      equipped = raw.preview.instanceId === legacyEquippedObject.instanceId;
    } else if (equippedCore) {
      equipped = chosen.type === equippedCore.type &&
        clampGrade(chosen.grade) === clampGrade(equippedCore.grade) &&
        Number(chosen.createdAt || 0) === Number(equippedCore.createdAt || 0);
    }

    return {
      announced: !!raw.announced,
      core: chosen,
      equippedCore,
      equipped,
      // Older accounts did not store this setting and should remain enabled.
      coreEnabled: raw.coreEnabled !== false,
      counters: { ...base.counters, ...(raw.counters || {}) },
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
      equippedCore: state.equippedCore,
      equipped: state.equipped,
      coreEnabled: state.coreEnabled,
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
    return currentScore() >= GOLDEN_CORE_SCORE || window.getTrainingAccessScore?.() >= GOLDEN_CORE_SCORE;
  }

  function nascentUnlocked() {
    return currentScore() >= NASCENT_SOUL_THRESHOLD || window.getTrainingAccessScore?.() >= NASCENT_SOUL_THRESHOLD;
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
    const tag = clickable ? 'button' : 'div';
    return `
      <${tag} ${clickable ? 'type="button"' : ''} class="golden-core-stage-v3 has-core-art ${clickable ? 'clickable' : ''}" data-core-visual-grade="${clampGrade(core.grade)}" data-core-visual-type="${type.id}" ${clickable ? 'id="training-core-orb" aria-label="查看金丹詳細資料"' : 'aria-hidden="true"'}>
        <span class="golden-core-halo-v3 halo-a"></span>
        <span class="golden-core-halo-v3 halo-b"></span>
        <span class="golden-core-orbit-v3 orbit-a"></span>
        <span class="golden-core-orbit-v3 orbit-b"></span>
        <span class="golden-core-sphere-v3 core-tone-${type.tone}">${globalThis.QAGoldenCoreArt.markup(type.id,core.grade,type.name,'golden-core-art')}<span class="golden-core-art-fallback" hidden>${type.icon}</span></span>
        <span class="golden-core-shadow-v3"></span>
      </${tag}>
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

          <p class="core-gold-balance" aria-live="polite">現有靈石：<strong>${Growth.count(window.getCurrentUserData?.()?.stats?.gold).toLocaleString("zh-TW")}</strong></p>
          <p class="ns-progress-caption" aria-live="polite">再洗髓 ${Pity.remaining(window.getCurrentUserData?.()?.[WASH_FIELD]?.count)} 次，必得三品以上金丹</p>
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
            ${state.equipped ? '<i class="fa-solid fa-circle-check"></i> 已調御此丹相' : '<i class="fa-solid fa-circle-dot"></i> 調御此丹相'}
          </button>
        </div>
      </section>
    `;
  }

  // 元嬰只與目前正式裝配／調御的金丹綁定，洗髓候選丹不可作為中心或決定天賦。
  function currentSoulType() {
    return state.equippedCore?.type || null;
  }

  function branchDisplayValue(core, id, level) {
    if (id === 'cultivation') return Math.round(level / 2);
    if (id === 'attack') return Math.round(level * 3.5);
    if (id === 'coreChance') return Math.round((Growth.branches(core).find(branch => branch.id === id)?.maxBonus || 0) * Math.min(level,Growth.CAP) / Growth.CAP * 100) / 100;
    return Growth.branchValue(core, id, level);
  }

  function innateBranchIcon(branchId) {
    return ({tide:'fa-water',surge:'fa-water',renew:'fa-heart-circle-plus',devour:'fa-seedling',
      focus:'fa-crosshairs',calm:'fa-spa',execute:'fa-skull',momentum:'fa-khanda',
      meteor:'fa-meteor',moon:'fa-moon',clarity:'fa-shield-halved',purify:'fa-heart',
      rebound:'fa-bolt',nourish:'fa-heart-circle-plus',defy:'fa-fire',balance:'fa-yin-yang',
      pursuit:'fa-khanda',unity:'fa-khanda'})[branchId] || 'fa-circle-nodes';
  }

  function soulOrbMarkup({id, name, icon, level, x, y, innate = false, canUpgrade = false}) {
    const selected = soulView.selected === id && !soulView.choosing;
    return `<button type="button" class="ns-growth-node ${level ? 'is-grown' : ''} ${selected ? 'is-selected' : ''} ${innate ? 'is-innate' : ''}"
      style="--branch-x:${x}%;--branch-y:${y}%" ${innate ? 'data-ia-node' : `data-ns-node="${id}"`}
      data-upgradable="${canUpgrade}" aria-label="${name}，${level} / 10 階，點擊查看資料" aria-pressed="${selected}"
      aria-haspopup="dialog" aria-controls="ns-node-dialog">
      <svg class="ns-orb-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="ns-orb-track" cx="50" cy="50" r="45"/>
        <circle class="ns-orb-progress" cx="50" cy="50" r="45" pathLength="100" stroke-dasharray="${level * 10} 100"/></svg>
      <span class="ns-orb-surface" aria-hidden="true"><i class="fa-solid ${icon}"></i></span>
    </button>`;
  }

  function innateAbilityMarkup(player) {
    const info = Innate.status(player);
    if (!info.ok) return '';
    const rank = info.path?.level || 1;
    const disabled = innateBusy || soulBusy || busy;
    const note = '切換變化保留階數；更換丹性保留各丹性進度。對戰金丹期及以下修士時，神通全部封印。';
    if (soulView.choosing) {
      const cards = Innate.branches(info.type).map(branch => {
        const selected = info.path?.branch === branch.id;
        const tactical=globalThis.QATactical.spiritBranch(info.type,branch.id)?.skill;
        return `<article class="ia-branch ${selected ? 'is-selected' : ''}">
          <i class="fa-solid ${innateBranchIcon(branch.id)} ia-choice-icon" aria-hidden="true"></i>
          <h4>${branch.name}</h4><span class="ia-choice-rank">${rank} / 10 階</span><p>${branch.describe(rank)}</p>
          ${tactical?`<p class="ia-tactical-skill"><strong>戰場技能：${tactical.name} · ${tactical.cost} 體力</strong><span>${tactical.description}</span></p>`:''}
          <button type="button" class="core-equip-btn" data-ia-select="${branch.id}" ${disabled ? 'disabled' : ''}>${selected ? '保留此變化' : info.path ? '選擇此變化' : '覺醒此變化 · 免費一階'}</button></article>`;
      }).join('');
      return `<section class="ia-panel ns-branch-choice" role="dialog" aria-modal="false" aria-labelledby="ns-choice-title">
        <header><div><span class="ia-eyebrow">元嬰化神</span><h3 id="ns-choice-title" tabindex="-1">選擇元神分支</h3></div>
          <button type="button" class="ns-detail-close" data-ns-close ${disabled ? 'disabled' : ''} aria-label="返回節點">×</button></header>
        <p class="ia-intro">${Innate.TYPES[info.type].name} · 選擇一種本命神通變化</p>
        <div class="ia-branches">${cards}</div><p class="ia-note">${note}</p></section>`;
    }
    if (!info.path) return '';
    const branch = Innate.branches(info.type).find(item => item.id === info.path.branch);
    const tactical=globalThis.QATactical.spiritBranch(info.type,branch.id)?.skill;
    return `<aside class="ns-orb-detail" id="ns-node-dialog" role="dialog" aria-modal="false" aria-labelledby="ns-detail-title">
      <button type="button" class="ns-detail-close" data-ns-close aria-label="關閉節點資料">×</button>
      <i class="fa-solid ${innateBranchIcon(branch.id)} ns-detail-icon" aria-hidden="true"></i>
      <span class="ia-eyebrow">化神 · 本命神通</span><h3 id="ns-detail-title">${branch.name}</h3>
      <span class="ns-detail-rank">${rank} / 10 階</span><p>${branch.describe(rank)}</p>
      ${tactical?`<p class="ia-tactical-skill"><strong>戰場技能：${tactical.name} · ${tactical.cost} 體力</strong><span>${tactical.description}</span></p>`:''}
      ${rank < Innate.CAP ? `<p class="ns-detail-preview">下一階：${branch.describe(rank + 1)}</p>` : ''}
      <div class="ns-detail-footer"><p>${rank >= Innate.CAP ? '十階圓滿' : `升至 ${rank + 1} 階需 ${info.cost} 元嬰碎精`}</p>
        <button type="button" class="core-wash-btn" data-ia-upgrade ${disabled || !info.canUpgrade ? 'disabled' : ''}>${innateBusy ? '保存中…' : rank >= Innate.CAP ? '已圓滿' : info.canUpgrade ? '提升神通' : '碎精不足'}</button>
        <button type="button" class="ns-reset-btn" data-ia-reselect ${disabled ? 'disabled' : ''}>重選元嬰</button></div>
      ${player.cultivationTraining?.coreEnabled === false ? '<p class="ia-note">金丹已停用，神通效果暫停。</p>' : ''}
      <p class="ia-note">${note}</p></aside>`;
  }

  function soulBranchDetailMarkup(player, core, branch) {
    const status = Growth.status(player, branch.id), level = status.level;
    const unit = branch.unit === '%' ? '%' : '';
    const disabled = soulBusy || innateBusy || busy || !status.ok;
    return `<aside class="ns-orb-detail" id="ns-node-dialog" role="dialog" aria-modal="false" aria-labelledby="ns-detail-title">
      <button type="button" class="ns-detail-close" data-ns-close aria-label="關閉節點資料">×</button>
      <i class="fa-solid ${branch.icon} ns-detail-icon" aria-hidden="true"></i>
      <span class="ia-eyebrow">元嬰分支</span><h3 id="ns-detail-title">${branch.name}</h3>
      <span class="ns-detail-rank">${level} / 10 階</span>
      <strong class="ns-detail-value">+${branchDisplayValue(core, branch.id, level)}${unit}</strong>
      <p>${branch.description}</p>
      ${level < Growth.CAP ? `<p class="ns-detail-preview">下一階：+${branchDisplayValue(core, branch.id, level + 1)}${unit}</p>` : ''}
      <div class="ns-detail-footer"><p>${level >= Growth.CAP ? '十階圓滿' : `升至 ${level + 1} 階需 ${status.cost} 元嬰碎精`}</p>
        <button type="button" class="core-wash-btn" data-ns-upgrade="${branch.id}" ${disabled ? 'disabled' : ''}>${soulBusy ? '保存中…' : status.reason || '提升節點'}</button></div>
      ${player.cultivationTraining?.coreEnabled === false ? '<p class="ia-note">金丹已停用，元嬰效果暫停。</p>' : ''}</aside>`;
  }

  async function saveInnateAbility(branchId=null) {
    if (innateBusy || soulBusy || busy) return;
    const user=getAuth(getApp()).currentUser;
    if(!user)return toast('尚未登入，無法保存神通。');
    const core={...state.equippedCore};
    innateBusy=true;
    renderTrainingPage();
    try {
      const result=await runTransaction(getFirestore(getApp()),async tx=>{
        const ref=doc(getFirestore(getApp()),'users',user.uid),snap=await tx.get(ref);
        if(!snap.exists())throw new Error('找不到玩家資料');
        if(getAuth(getApp()).currentUser?.uid!==user.uid)throw new Error('登入帳號已變更');
        const data=snap.data();
        if(!sameGoldenCore(data.cultivationTraining?.equippedCore,core))throw new Error('裝配金丹已變更，請重開元神頁');
        const next=branchId?Innate.select(data,branchId):Innate.upgrade(data);
        if(!next.ok)throw new Error(next.reason);
        const tactical=globalThis.QATactical.spiritBranch(core.type,next.growth.paths[core.type].branch);
        tx.update(ref,{...Innate.patch(next),...(tactical?{['tacticalPreferences.'+core.type]:tactical.id}:{})});
        return next;
      });
      if(getAuth(getApp()).currentUser?.uid===user.uid) {
        const local=window.getCurrentUserData?.();
        if(local)Innate.apply(local,result);
        if(local){const tactical=globalThis.QATactical.spiritBranch(core.type,result.growth.paths[core.type].branch);if(tactical)(local.tacticalPreferences||={})[core.type]=tactical.id;}
        soulView.choosing=false;
        soulView.selected='innate';
        const chosen=result.growth.paths[result.type];
        const name=Innate.branches(result.type).find(item=>item.id===chosen.branch).name;
        globalThis.QAGameAudio?.play('spirit-pulse');
        toast(branchId?`${name}已啟用 · ${chosen.level} 階`:`${name}升至 ${chosen.level} 階，消耗 ${result.cost} 元嬰碎精`);
        window.dispatchEvent(new CustomEvent('xiuxian:stats-updated',{detail:{source:'innate-ability'}}));
      }
    } catch(error) {toast('神通保存未完成：'+(error?.message||'請重試'));}
    finally {innateBusy=false;renderTrainingPage();}
  }

  function nascentSoulTabMarkup() {
    if (!nascentUnlocked()) return '<section class="ns-panel"><h3>元嬰未成</h3><p>修為達到 68 後，方可凝聚本命元嬰。</p></section>';
    const getFragmentsButton = '<button type="button" class="ns-get-fragments-btn" data-ns-get-fragments><i class="fa-solid fa-gem" aria-hidden="true"></i><span>去獲取元嬰碎精</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>';
    if (!state.equippedCore) return `<section class="ns-panel"><h3>尚未調御金丹</h3><p>請先在金丹頁調御丹相，再溫養元嬰。</p>${getFragmentsButton}</section>`;
    const player = window.getCurrentUserData?.() || {};
    const prepared = Growth.prepare(player);
    const core = state.equippedCore;
    const branches = Growth.branches(core);
    const info = Innate.status(player);
    const owner = `${getAuth(getApp()).currentUser?.uid || ''}:${core.type}:${core.grade}:${core.createdAt || 0}`;
    if (soulView.owner !== owner) Object.assign(soulView, {owner, selected:null, choosing:false});
    if (!info.ok && soulView.selected === 'innate') Object.assign(soulView, {selected:null, choosing:false});
    if (soulView.choosing) return `<section class="ns-panel ns-growth-panel is-choosing">${innateAbilityMarkup(player)}</section>`;
    const count = branches.length + (info.ok ? 1 : 0);
    const positions = count === 6
      ? [[50,12],[82,30],[82,70],[50,88],[18,70],[18,30]]
      : count === 5 ? [[50,14],[82,39],[70,84],[30,84],[18,39]]
      : [[24,22],[76,22],[76,82],[24,82]];
    const nodes = branches.map((branch, index) => {
      const status = Growth.status(player, branch.id);
      const [x, y] = positions[index + (info.ok ? 1 : 0)];
      return soulOrbMarkup({id:branch.id, name:branch.name, icon:branch.icon, level:status.level,
        x, y, canUpgrade:status.ok && !soulBusy && !innateBusy && !busy});
    });
    if (info.ok) {
      const branch = Innate.branches(info.type).find(item => item.id === info.path?.branch);
      nodes.unshift(soulOrbMarkup({id:'innate', name:branch ? `化神・${branch.name}` : '化神・選擇元神分支',
        icon:branch ? innateBranchIcon(branch.id) : 'fa-atom', level:info.path?.level || 0,
        x:positions[0][0], y:positions[0][1], innate:true, canUpgrade:info.canUpgrade}));
    }
    const lines = positions.map(([x, y]) => `<line class="ns-growth-link" x1="50" y1="50" x2="${x}" y2="${y}"/>`).join('');
    const selectedBranch = branches.find(branch => branch.id === soulView.selected);
    const detail = soulView.selected === 'innate' ? innateAbilityMarkup(player)
      : selectedBranch ? soulBranchDetailMarkup(player, core, selectedBranch) : '';
    return `<section class="ns-panel ns-growth-panel">
      <div class="ns-growth-toolbar"><span class="ns-growth-resource">元嬰碎精 <strong aria-live="polite">${prepared.fragments}</strong></span><div class="ns-growth-actions">${getFragmentsButton}<button type="button" class="ns-reset-btn" data-ns-reset ${soulBusy || innateBusy || busy || !Growth.spent(prepared.growth) ? 'disabled' : ''}>重修</button></div></div>
      <div class="ns-growth-workspace ${detail ? 'has-detail' : ''}">
        <div class="ns-growth-map" data-branch-count="${branches.length}" role="group" aria-label="元嬰與化神節點">
          <svg class="ns-growth-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>
          <div class="ns-growth-core">${coreVisualMarkup(core, false)}<div class="ns-growth-core-caption"><strong>${coreType(core.type).name}</strong><span>${clampGrade(core.grade)} 品</span></div></div>
          ${nodes.join('')}
        </div>${detail}
      </div>
    </section>`;
  }

  async function saveSoulBranch(branchId, reset = false) {
    if (soulBusy || busy || innateBusy) return;
    const user = getAuth(getApp()).currentUser;
    if (!user) return toast('尚未登入，無法保存元嬰。');
    const core = {...state.equippedCore};
    if (reset && await window.openConfirm?.('重修將清除元嬰分支並返還全部已投入碎精，確定重修？') !== true) return;
    const before = window.captureGrowthSnapshot?.();
    soulBusy = true;
    renderTrainingPage();
    try {
      const db = getFirestore(getApp());
      const result = await runTransaction(db, async tx => {
        const ref = doc(db, 'users', user.uid), snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('找不到玩家資料');
        if (getAuth(getApp()).currentUser?.uid !== user.uid) throw new Error('登入帳號已變更');
        const data = snap.data();
        if (!sameGoldenCore(data.cultivationTraining?.equippedCore, core)) throw new Error('裝配金丹已變更，請重開元嬰頁');
        if ((globalThis.QATrainingAccessRules?.score(data) ?? Growth.count(data.stats?.totalScore)) < NASCENT_SOUL_THRESHOLD) throw new Error('元嬰境界不足');
        const next = reset ? Growth.reset(data) : Growth.upgrade(data, branchId);
        if (!reset && !next.ok) throw new Error(next.reason);
        tx.update(ref, Growth.patch(next));
        return next;
      });
      if (getAuth(getApp()).currentUser?.uid === user.uid) {
        const local = window.getCurrentUserData?.();
        if (local) Growth.apply(local,result);
        globalThis.QAGameAudio?.play('spirit-pulse');
        toast(reset ? '元嬰已重修，返還 '+result.returned+' 碎精' : '升級成功，消耗 '+result.cost+' 碎精');
        const extra = reset ? [] : [{label:result.branch.name + '分支等級',before:{value:result.level,unit:'級'},after:{value:result.level + 1,unit:'級'}}];
        if (!reset && ['cultivation','core'].includes(branchId)) extra.push({label:result.branch.name + '加成',
          before:{value:branchDisplayValue(core,branchId,result.level),unit:result.branch.unit === '%' ? '%' : ''},
          after:{value:branchDisplayValue(core,branchId,result.level + 1),unit:result.branch.unit === '%' ? '%' : '',note:local?.cultivationTraining?.coreEnabled === false ? '重新啟用金丹後生效' : ''}});
        if (before) window.showGrowthComparison?.({uid:user.uid,title:reset ? '元嬰重修後的變化' : '元嬰升級後的變化',before,after:window.captureGrowthSnapshot?.(),extra});
        window.dispatchEvent(new CustomEvent('xiuxian:stats-updated',{detail:{source:'nascent-growth'}}));
      }
    } catch (error) { toast('保存未完成：'+(error?.message || '請重試')); }
    finally { soulBusy = false; renderTrainingPage(); }
  }

  async function migrateSoulResources() {
    const local = window.getCurrentUserData?.();
    const user = getAuth(getApp()).currentUser;
    if (!local || !user || local.nascentSoulGrowth?.version === 1 || migrationBusy || soulBusy) return;
    migrationBusy = true;
    try {
      const db = getFirestore(getApp());
      const result = await runTransaction(db, async tx => {
        const ref = doc(db,'users',user.uid), snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('找不到玩家資料');
        const remote = snap.data();
        const next = Growth.prepare(remote);
        if (remote.nascentSoulGrowth?.version !== 1) tx.update(ref,Growth.patch(next));
        return next;
      });
      if (getAuth(getApp()).currentUser?.uid === user.uid && local === window.getCurrentUserData?.()) {
        Growth.apply(local,result);
        window.dispatchEvent(new CustomEvent('xiuxian:stats-updated',{detail:{source:'nascent-migration'}}));
        renderTrainingPage();
      }
    } catch (error) { console.warn('[Nascent migration]',error); }
    finally { migrationBusy = false; }
  }

  function closeSoulDetails() {
    if (innateBusy) return;
    const previous = soulView.selected;
    // 重選取消後返回原神通詳情；初次取消則返回節點圖。
    const backToDetail = soulView.choosing && !!Innate.status(window.getCurrentUserData?.() || {}).path;
    soulView.choosing = false;
    soulView.selected = backToDetail ? 'innate' : null;
    renderTrainingPage();
    const selector = backToDetail ? '[data-ia-reselect]' : previous === 'innate' ? '[data-ia-node]' : `[data-ns-node="${previous}"]`;
    const target = backToDetail ? document.getElementById('ns-node-dialog')?.querySelector(selector)
      : document.getElementById('training-tab-content')?.querySelector(selector);
    target?.focus({preventScroll:true});
  }

  // 直式詳情移至 body，避開節點圖的 stacking context 與分頁裁切，才能蓋過導覽。
  function syncSoulDetailLayout() {
    const detail = document.getElementById('ns-node-dialog');
    if (!detail) return;
    if (window.matchMedia('(orientation: portrait)').matches) {
      detail.dataset.nsPortraitSheet = '';
      document.body.appendChild(detail);
    } else {
      delete detail.dataset.nsPortraitSheet;
      document.querySelector('#training-tab-content .ns-growth-workspace')?.appendChild(detail);
    }
  }

  function bindSoulActions() {
    const content = document.getElementById('training-tab-content');
    content?.querySelector('[data-ns-get-fragments]')?.addEventListener('click', () => {
      if (typeof window.openRaidHub === 'function') window.openRaidHub();
      else toast('秘境試煉尚未準備好，請稍後再試。');
    });
    const inspect = (id, choosing = false) => {
      soulView.selected = id;
      soulView.choosing = choosing;
      renderTrainingPage();
      const target = choosing ? content?.querySelector('#ns-choice-title')
        : document.getElementById('ns-node-dialog')?.querySelector('[data-ns-close]');
      target?.focus({preventScroll:true});
    };
    content?.querySelectorAll('[data-ns-node]').forEach(button => button.addEventListener('click', () => inspect(button.dataset.nsNode)));
    content?.querySelector('[data-ia-node]')?.addEventListener('click', () => inspect('innate', !Innate.status(window.getCurrentUserData?.() || {}).path));
    content?.querySelector('[data-ia-reselect]')?.addEventListener('click', () => inspect('innate', true));
    content?.querySelector('[data-ns-close]')?.addEventListener('click', closeSoulDetails);
    content.onkeydown = event => {
      if (event.key === 'Escape' && soulView.selected) { event.preventDefault(); closeSoulDetails(); }
    };
    const detail = content?.querySelector('.ns-orb-detail');
    if (detail) detail.onkeydown = content.onkeydown;
    content?.querySelectorAll('[data-ns-upgrade]').forEach(button => button.addEventListener('click',()=>void saveSoulBranch(button.dataset.nsUpgrade)));
    content?.querySelector('[data-ns-reset]')?.addEventListener('click',()=>void saveSoulBranch(null,true));
    content?.querySelectorAll('[data-ia-select]').forEach(button=>button.addEventListener('click',()=>void saveInnateAbility(button.dataset.iaSelect)));
    content?.querySelector('[data-ia-upgrade]')?.addEventListener('click',()=>void saveInnateAbility());
    syncSoulDetailLayout();
    void migrateSoulResources();
  }

  window.getNascentSoulCultivationBonuses = function () {
    const data = window.getCurrentUserData?.() || {};
    return Object.fromEntries(['solo','daily','cave'].map(source=>[source,Growth.cultivation(data,source)]));
  };
  window.getNascentSoulBattleSnapshot = function () {
    if (state.coreEnabled === false) return null;
    return Growth.bonuses(window.getCurrentUserData?.() || {}, state.equippedCore);
  };

  function bagTabMarkup() {
    // 背包物品改由統一背包模組渲染，避免舊的純文字卡先出現在畫面。
    return '<section class="uib-bag-loading" aria-hidden="true"></section>';
  }

  function renderTrainingPage() {
    const content = document.getElementById('training-tab-content');
    if (!content) return;
    document.querySelector('[data-ns-portrait-sheet]')?.remove?.();
    const soulLabel=document.querySelector('#page-training [data-training-tab="nascent-soul"] span');
    if(soulLabel)soulLabel.textContent=Innate.status(window.getCurrentUserData?.()||{}).ok?'元神':'元嬰';
    // 煉器／裝備可提前返回，先清理元嬰專屬的一屏模式，避免裁切其他分頁。
    if (activeTab !== 'nascent-soul') {
      document.body.classList.remove('ns-map-active');
      Object.assign(soulView, {selected:null, choosing:false});
      content.onkeydown = null;
    }
    if (activeTab === 'contract') {
      window.mountSoulboundTrainingPage?.(content);
      return;
    }
    if (activeTab === 'refinery') {
      if (!content.querySelector('.cultivation-refinery')) content.innerHTML = refineryShellMarkup();
      window.dispatchEvent(new CustomEvent('xiuxian:refinery-open-request'));
      return;
    }
    if (activeTab === 'equipment') {
      // 四個裝配格先立即出現，再由共用裝備模組填入實際法寶。
      content.innerHTML = equipmentShellMarkup();
      window.openCultivationEquipment?.();
      window.dispatchEvent(new CustomEvent('xiuxian:equipment-open-request'));
      return;
    }
    // 舊畫面仍是元嬰分支時，只更新數值，不視為再次切入分頁。
    const previouslySoulMap = !!content.querySelector('.ns-growth-panel');
    content.innerHTML = activeTab === 'bag' ? bagTabMarkup()
      : activeTab === 'nascent-soul' ? nascentSoulTabMarkup() : coreTabMarkup();
    const enteringSoulMap = activeTab === 'nascent-soul' && (currentScore() >= NASCENT_SOUL_THRESHOLD || window.getTrainingAccessScore?.() >= NASCENT_SOUL_THRESHOLD);
    document.body.classList.remove('ns-map-active');
    // 從可能已捲動的煉器／背包切入元嬰時，讓分頁與碎精摘要回到畫面最上方。
    if (enteringSoulMap && !previouslySoulMap) {
      const main = document.querySelector('main');
      if (main) main.scrollTop = 0;
      const page = document.getElementById('page-training');
      if (page) page.scrollTop = 0;
    }
    if (activeTab === 'core') bindCoreActions();
    if (activeTab === 'nascent-soul') bindSoulActions();
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
      window.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      const trainingPage = document.getElementById('page-training');
      if (trainingPage) trainingPage.scrollTop = 0;
      renderTrainingPage();
      requestAnimationFrame(() => window.scrollTo?.({ top: 0, left: 0, behavior: 'auto' }));
    });
    homeButton.insertAdjacentElement('afterend', button);
  }

  function createTrainingPage() {
    const home = document.getElementById('page-home');
    if (!home) return;

    let page = document.getElementById('page-training');
    if (!page) {
      page = document.createElement('div');
      page.id = 'page-training';
      page.className = 'page-section hidden px-4 training-page training-page-v3';
      page.innerHTML = `
        <div class="training-page-heading-v3">
          <div><h2>修煉</h2></div>
          <div class="training-realm-seal-v3">金丹</div>
        </div>
        <div class="training-subtabs-v3" role="tablist">
          <button type="button" class="training-subtab-v3 active" data-training-tab="core" aria-selected="true"><i class="fa-solid fa-circle-dot"></i><span>金丹</span></button>
          <button type="button" class="training-subtab-v3" data-training-tab="nascent-soul" aria-selected="false" disabled><i class="fa-solid fa-child-reaching"></i><span>元嬰</span></button>
          <button type="button" class="training-subtab-v3" data-training-tab="refinery" aria-selected="false"><i class="fa-solid fa-hammer"></i><span>煉器</span></button>
          <button type="button" class="training-subtab-v3" data-training-tab="contract" aria-selected="false"><i class="fa-solid fa-dharmachakra"></i><span>契器</span></button>
          <button type="button" class="training-subtab-v3" data-training-tab="equipment" aria-selected="false"><i class="fa-solid fa-shield-halved"></i><span>裝備</span></button>
          <button type="button" class="training-subtab-v3" data-training-tab="bag" aria-selected="false"><i class="fa-solid fa-box-open"></i><span>背包</span></button>
        </div>
        <div id="training-tab-content"></div>
      `;
      home.insertAdjacentElement('afterend', page);
    }

    const alreadyHydrated = page.dataset.trainingV4Ready === '1' && page.dataset.foundationTraining !== '1';
    delete page.dataset.foundationTraining;
    page.classList.remove('foundation-training-page');
    page.classList.add('training-page', 'training-page-v3');
    if (alreadyHydrated) {
      const soulTab = page.querySelector('[data-training-tab="nascent-soul"]');
      if (soulTab) { soulTab.hidden = false; soulTab.disabled = !nascentUnlocked(); }
      return;
    }

    let heading = page.querySelector('.training-page-heading-v3');
    if (!heading) {
      heading = document.createElement('div');
      heading.className = 'training-page-heading-v3';
      page.prepend(heading);
    }
    heading.innerHTML = '<div><h2>修煉</h2></div><div class="training-realm-seal-v3">金丹</div>';

    const tabs = page.querySelector('.training-subtabs-v3');
    if (!tabs) return;
    let coreTab = tabs.querySelector('[data-training-tab="core"]');
    // 築基／初始狀態共用修煉頁時，原本可能沒有金丹分頁。
    if (!coreTab) {
      tabs.insertAdjacentHTML('afterbegin', '<button type="button" class="training-subtab-v3" data-training-tab="core" aria-selected="false"><i class="fa-solid fa-circle-dot"></i><span>金丹</span></button>');
      coreTab = tabs.querySelector('[data-training-tab="core"]');
    }
    coreTab?.classList.remove('hidden');
    let soulTab = tabs.querySelector('[data-training-tab="nascent-soul"]');
    if (!soulTab) {
      coreTab?.insertAdjacentHTML('afterend', '<button type="button" class="training-subtab-v3" data-training-tab="nascent-soul" aria-selected="false"><i class="fa-solid fa-child-reaching"></i><span>元嬰</span></button>');
      soulTab = tabs.querySelector('[data-training-tab="nascent-soul"]');
    }
    if (soulTab) { soulTab.hidden = false; soulTab.disabled = !nascentUnlocked(); }
    if (!tabs.querySelector('[data-training-tab="equipment"]')) {
      tabs.querySelector('[data-training-tab="bag"]')?.insertAdjacentHTML('beforebegin',
        '<button type="button" class="training-subtab-v3" data-training-tab="equipment" aria-selected="false"><i class="fa-solid fa-shield-halved"></i><span>裝備</span></button>');
    }

    if (!tabs.querySelector('[data-training-tab="contract"]')) {
      tabs.querySelector('[data-training-tab="refinery"]')?.insertAdjacentHTML('afterend', '<button type="button" class="training-subtab-v3" data-training-tab="contract" aria-selected="false"><i class="fa-solid fa-dharmachakra"></i><span>契器</span></button>');
    }

    if (page.dataset.trainingV4Bound !== '1') {
      page.dataset.trainingV4Bound = '1';
      page.querySelectorAll('[data-training-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          if (!isUnlocked() || page.dataset.foundationTraining === '1') return;
          const requested = button.dataset.trainingTab;
          const content = document.getElementById('training-tab-content');
          const theme = requested === 'refinery' ? 'alchemy' : requested === 'nascent-soul' ? 'raid' : 'alchemy';
          const tabOrder = [...page.querySelectorAll('[data-training-tab]')].map(tab => tab.dataset.trainingTab);
          const fromStatus = !page.querySelector('[data-training-tab].active');
          const direction = fromStatus || tabOrder.indexOf(requested) < tabOrder.indexOf(activeTab) ? -1 : 1;
          const finishTransition = requested !== activeTab || fromStatus ? window.beginSceneTransition?.(content, content, theme, 'training-tab', true, direction) : null;
          activeTab = ['bag', 'refinery', 'equipment', 'contract'].includes(requested) || (requested === 'nascent-soul' && nascentUnlocked()) ? requested : 'core';
          page.querySelectorAll('[data-training-tab]').forEach((tab) => {
            const selected = tab.dataset.trainingTab === activeTab;
            tab.classList.toggle('active', selected);
            tab.setAttribute('aria-selected', selected ? 'true' : 'false');
          });
          renderTrainingPage();
          finishTransition?.();
        });
      });
    }

    page.dataset.trainingV4Ready = '1';
    activeTab = 'core';
    page.querySelectorAll('[data-training-tab]').forEach((tab) => {
      const selected = tab.dataset.trainingTab === activeTab;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
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
      <p>每第 5 次成功洗髓必得一至三品；前四次使用下列機率。保底三／二／一品機率為 5/11、4/11、2/11，丹性仍等機率。</p>
      <div class="training-v3-odds-list">
        ${GRADE_WEIGHTS.slice().reverse().map((item) => `<div class="training-v3-odds-row grade-${item.grade}"><span>${item.grade} 品</span><strong>${item.chance}%</strong></div>`).join('')}
      </div>
    `);
  }

  function showCoreDetails(core) {
    const type = coreType(core.type);
    modalShell('training-v3-detail-modal', `${core.grade} 品 · ${type.name}`, `
      <div class="training-v3-detail-top">${coreVisualMarkup(core, false)}</div>
      <div class="training-v3-lore training-core-detail-two">
        <div class="training-core-feature"><span>特性</span><p><strong>效果：</strong>${type.effect(core.grade)}</p><p><strong>神通：</strong>${type.ability}</p><p><strong>元嬰左脈：</strong>${globalThis.QASoulTalents?.TYPES[core.type]?.trait || '本命能力'}（元嬰境界後修習）</p><p><strong>修煉：</strong>${type.upkeep}</p><p><strong>提醒：</strong>${type.warning}</p></div>
        <div class="training-core-story"><span>故事</span><p>${type.note}</p><p>此丹並非外來丹藥，而是修士在自身靈田／丹田中凝聚，並可透過洗髓重塑丹性與品級的本命金丹。</p></div>
      </div>
    `);
  }

  window.openGoldenCoreDetails = function (coreLike) {
    if (!coreLike) return;
    showCoreDetails({ type: coreLike.type || 'taichu', grade: clampGrade(coreLike.grade) });
  };

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
    const snapshot = serializableState();
    await updateDoc(doc(db, 'users', user.uid), {
      [REMOTE_FIELD]: snapshot,
      ...extraFields
    });
    const data = window.getCurrentUserData?.();
    if (data) data[REMOTE_FIELD] = snapshot;
  }

  // Status owns the activation control; never replace its DOM with the core tab.
  function renderCoreTabIfVisible() {
    if (activeTab !== 'core' || document.getElementById('training-status-tab')?.classList.contains('active')) return;
    renderTrainingPage();
  }

  // The equipped core is kept intact when disabled; only its activation bit changes.
  async function toggleGoldenCore() {
    if (busy || !isUnlocked() || !state.equippedCore) return;
    const previous = state.coreEnabled;
    busy = true;
    state.coreEnabled = !previous;
    renderCoreTabIfVisible();
    try {
      await persistRemote();
      toast(state.coreEnabled ? '本命金丹已啟用，效果恢復。' : '本命金丹已停用，效果暫停。');
      window.dispatchEvent(new CustomEvent('golden-core-equipped-changed', {
        detail: { enabled: state.coreEnabled }
      }));
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { source: 'golden-core-toggle' } }));
    } catch (error) {
      console.error('Toggle golden core failed:', error);
      state.coreEnabled = previous;
      saveLocal();
      toast('金丹狀態儲存失敗，已恢復原狀。');
    } finally {
      busy = false;
      renderCoreTabIfVisible();
    }
  }

  window.setGoldenCoreEnabled = async function (enabled) {
    if (typeof enabled !== 'boolean') return false;
    if (busy || !isUnlocked() || !state.equippedCore) return false;
    if (state.coreEnabled === enabled) return true;
    await toggleGoldenCore();
    return state.coreEnabled === enabled;
  };

  window.isGoldenCoreEnabled = function () {
    return isUnlocked() && !!state.equippedCore && state.coreEnabled !== false;
  };

  async function washCore() {
    if (busy || !isUnlocked()) return;
    const user = getAuth(getApp()).currentUser;
    const local = window.getCurrentUserData?.();
    if (!user || !local?.stats) return toast('尚未登入或玩家資料尚未準備完成。');
    const storageKey = 'xiuxian:golden-wash:' + user.uid;
    let request;
    try { request = JSON.parse(localStorage.getItem(storageKey)); } catch (_) {}
    if (!request?.id) {
      request = {id:Date.now()+':'+Math.random().toString(36).slice(2),expectedCount:Pity.count(local[WASH_FIELD]?.count),
        typeRoll:Math.random(),gradeRoll:Math.random(),createdAt:Date.now()};
      try { localStorage.setItem(storageKey,JSON.stringify(request)); } catch (_) {}
    }
    busy = true;
    renderTrainingPage();
    let animation;
    try {
      animation = createGoldenCoreWashAnimation();
      const ref = doc(getFirestore(getApp()),'users',user.uid);
      const result = await runTransaction(getFirestore(getApp()),async tx => {
        const snap=await tx.get(ref);
        if(!snap.exists()) throw new Error('玩家資料不存在');
        if(getAuth(getApp()).currentUser?.uid !== user.uid) throw new Error('登入帳號已變更');
        const remote=snap.data(), saved=remote[WASH_FIELD] || {}, training=migrate(remote[REMOTE_FIELD]);
        if(saved.lastRequestId===request.id) return {training,gold:remote.stats.gold,wash:saved};
        if(Pity.count(saved.count)!==request.expectedCount) throw new Error('洗髓紀錄已由其他分頁更新，請重新整理');
        if((globalThis.QATrainingAccessRules?.score(remote) ?? Number(remote.stats?.totalScore))<GOLDEN_CORE_SCORE) throw new Error('金丹境界不足');
        const gold=Number(remote.stats?.gold) || 0;
        if(gold<WASH_COST) throw new Error('靈石不足，洗髓需要 100 靈石');
        const draw=Pity.draw(saved.count,request.typeRoll,request.gradeRoll,CORE_TYPES.map(item=>item.id),request.createdAt);
        const next={...training,core:draw.core,equipped:false,counters:{
          correct:Math.max(Pity.count(training.counters.correct),Pity.count(state.counters.correct)),
          mistakes:Math.max(Pity.count(training.counters.mistakes),Pity.count(state.counters.mistakes))}};
        const wash={version:1,count:draw.count,lastRequestId:request.id,guaranteed:draw.guaranteed};
        tx.update(ref,{[REMOTE_FIELD]:next,[WASH_FIELD]:wash,'stats.gold':gold-WASH_COST});
        return {training:next,gold:gold-WASH_COST,wash};
      });
      if(getAuth(getApp()).currentUser?.uid !== user.uid) return;
      state=migrate(result.training);local[REMOTE_FIELD]=result.training;local[WASH_FIELD]=result.wash;local.stats.gold=result.gold;
      try { saveLocal(); } catch (_) {}
      try { localStorage.removeItem(storageKey); } catch (_) {}
      try {
        await animation.minimumDuration;
        await animation.reveal(state.core,coreType(state.core.type));
      } catch (error) { console.warn('[Golden core] reveal unavailable after successful save:',error); }
      toast(`${result.wash.guaranteed?'五次保底！':''}洗髓完成：${state.core.grade} 品 ${coreType(state.core.type).name}`);
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated',{detail:{source:'golden-core-wash'}}));
    } catch(error) {
      console.error('Wash golden core failed:',error);
      if(animation) await animation.fail();
      if(/其他分頁|不足/.test(error?.message || '')) try {localStorage.removeItem(storageKey);} catch(_) {}
      toast('洗髓尚未確認：'+(error?.message || '請再按洗髓確認同次結果，不會重複扣款'));
    } finally {
      animation?.cleanup();busy=false;
      if(getAuth(getApp()).currentUser?.uid !== user.uid) restoreRemoteTraining(); else renderTrainingPage();
    }
  }

  async function equipCore() {
    if (busy || soulBusy || state.equipped || !isUnlocked()) return;
    const user = getAuth(getApp()).currentUser;
    if (!user) return toast('尚未登入，無法保存調御結果。');
    const candidate = { ...state.core };
    busy = true;
    renderTrainingPage();
    try {
      const db = getFirestore(getApp());
      const ref = doc(db, 'users', user.uid);
      // 金丹與配點一起提交；交易重試時重新讀取投入，避免跨分頁重複返還。
      const result = await runTransaction(db, async tx => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists()) throw new Error('找不到玩家資料');
        if (getAuth(getApp()).currentUser?.uid !== user.uid) throw new Error('登入帳號已變更，請重新登入');
        const remote = snapshot.data();
        if ((globalThis.QATrainingAccessRules?.score(remote) ?? normalizeSpirit(remote.stats?.totalScore)) < GOLDEN_CORE_SCORE) throw new Error('金丹境界不足');
        const training = remote[REMOTE_FIELD];
        if (!sameGoldenCore(training?.core, candidate)) throw new Error('候選金丹已變更，請重新開啟金丹頁');
        const changed = !sameGoldenCore(training.equippedCore, candidate);
        if (!changed && training.equipped === true) {
          return { training, growthState: Growth.prepare(remote), changed, returned: 0 };
        }
        const refund = changed ? Growth.reset(remote) : Growth.prepare(remote);
        const next = { ...training, equippedCore: { ...candidate }, equipped: true };
        const patch = { [REMOTE_FIELD]: next, ...Growth.patch(refund) };

        tx.update(ref, patch);
        return { training: next, growthState: refund,
          changed, returned: refund?.returned || 0 };
      });
      if (getAuth(getApp()).currentUser?.uid !== user.uid) return;
      state = migrate(result.training);
      const local = window.getCurrentUserData?.();
      if (local) {
        local[REMOTE_FIELD] = result.training;
        if (result.growthState) Growth.apply(local,result.growthState);
      }
      try { saveLocal(); } catch (error) { console.warn('[Golden core] local cache save failed:', error); }
      toast(`已調御丹相：${candidate.grade} 品 ${coreType(candidate.type).name}` +
        (result.returned ? `，已自動返還 ${result.returned} 元嬰碎精` : ''));
      window.dispatchEvent(new CustomEvent('golden-core-equipped-changed', {
        detail: { fragmentsReturned: result.returned }
      }));
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', {
        detail: { source: 'golden-core-equip', fragmentsReturned: result.returned }
      }));
    } catch (error) {
      console.error('Equip golden core failed:', error);
      if (getAuth(getApp()).currentUser?.uid === user.uid) {
        toast('調御未完成：' + (error?.message || '請檢查連線後重試'));
      }
    } finally {
      busy = false;
      if (getAuth(getApp()).currentUser?.uid !== user.uid) restoreRemoteTraining();
      else renderTrainingPage();
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
    document.body.classList.remove('ns-map-active');
    // 金丹回落至築基（例如舊角色修為重算）時，築基模組已接管同一個
    // #page-training 和 #nav-training。不能在後觸發的金丹清理中把它們刪掉。
    if (window.isFoundationTrainingStage?.() &&
        document.getElementById('page-training')?.dataset.foundationTraining === '1') {
      return;
    }
    document.getElementById('nav-training')?.remove();
    const page = document.getElementById('page-training');
    if (page?.dataset.staticLayout === '1') {
      page.classList.add('hidden');
      page.classList.remove('active-page', 'foundation-training-page');
      delete page.dataset.foundationTraining;
      delete page.dataset.trainingV4Ready;
    } else {
      page?.remove();
    }
    document.body.classList.remove('cultivation-training-unlocked');
  }

  window.resolveGoldenCoreCultivationReward = function ({ stats, isCorrect, isRecovery = false }) {
    const equippedCore = state.equippedCore;
    if (!isUnlocked() || !equippedCore || state.coreEnabled === false) {
      return { bonusGain: 0, message: '' };
    }

    const type = coreType(equippedCore.type);
    const grade = clampGrade(equippedCore.grade);
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
      isRecovery,
      hasShield: !!stats?.goldenCoreShield
    }) || {};

    saveLocal();
    return {
      bonusGain: Math.max(0, Number(effect.bonusGain) || 0),
      forceShield: !!effect.forceShield,
      preserveShield: !!effect.preserveShield,
      preserveStreak: !!effect.preserveStreak,
      recoveryBonusGain: Math.max(0,Number(effect.recoveryBonusGain) || 0),
      message: effect.message || ''
    };
  };

  // 公開金丹資料只解釋丹性與品級；不讀取他人的洗髓候選或帳號私有欄位。
  window.getGoldenCorePublicDetails = function (coreLike) {
    if (!coreLike || !CORE_TYPES.some((entry) => entry.id === coreLike.type)) return null;
    const grade = clampGrade(coreLike.grade);
    const type = coreType(coreLike.type);
    return { type: type.id, name: type.name, grade, effect: type.effect(grade), imageUrl:globalThis.QAGoldenCoreArt?.source(type.id,grade) || '', equipped: true };
  };

  // 候選丹相：供金丹頁與「品質下降警告」使用。
  window.getGoldenCoreState = function () {
    if (!isUnlocked()) return null;
    const type = coreType(state.core.type);
    return {
      type: state.core.type,
      name: type.name,
      grade: state.core.grade,
      effect: type.effect(state.core.grade),
      equipped: state.equipped,
      coreEnabled: state.coreEnabled,
      core: { ...state.core }
    };
  };

  // 狀態頁可看到暫停中的原金丹；生效中的修為與鬥法只使用下方嚴格 getter。
  window.getStoredGoldenCoreState = function () {
    if (!isUnlocked() || !state.equippedCore) return null;
    const core = state.equippedCore;
    const type = coreType(core.type);
    return {
      type: core.type,
      name: type.name,
      grade: core.grade,
      effect: type.effect(core.grade),
      equipped: state.coreEnabled !== false,
      coreEnabled: state.coreEnabled !== false,
      core: { ...core }
    };
  };

  window.getEquippedGoldenCoreState = function () {
    const snapshot = window.getStoredGoldenCoreState();
    return snapshot?.coreEnabled ? snapshot : null;
  };

  function restoreRemoteTraining() {
    if (busy) return;
    const remote = window.getCurrentUserData?.()?.cultivationTraining;
    if (!remote || typeof remote !== 'object') return;
    // Account state is authoritative on login, even after changing devices.
    const incoming = migrate(remote);
    if (JSON.stringify(incoming) === JSON.stringify(state)) return;
    state = incoming;
    saveLocal();
    if (lastUnlocked && ['core', 'nascent-soul'].includes(activeTab)) renderTrainingPage();
  }

  function syncUnlock() {
    const unlocked = window.isGoldenCoreUnlocked?.() ?? isUnlocked();
    if (unlocked) void migrateSoulResources();
    if (lastUnlocked === unlocked) {
      if (unlocked) {
        const soulTab = document.querySelector('#page-training [data-training-tab="nascent-soul"]');
        if (soulTab) { soulTab.hidden = false; soulTab.disabled = !nascentUnlocked(); }
        if (['core','nascent-soul'].includes(activeTab)) renderTrainingPage();
      }
      return;
    }

    if (unlocked) ensureUnlockedUI();
    else if (lastUnlocked === true) removeLockedUI();
    lastUnlocked = unlocked;
  }

  function boot() {
    window.matchMedia('(orientation: portrait)').addEventListener('change', syncSoulDetailLayout);
    window.addEventListener('xiuxian:contract-page-opened', () => { activeTab = 'contract'; });
    loadStyle();
    restoreRemoteTraining();
    syncUnlock();
    window.addEventListener('xiuxian:user-ready', restoreRemoteTraining);
    ['xiuxian:stats-updated','xiuxian:user-ready','xiuxian:migration-ready','golden-core-access-changed','xiuxian:training-access-updated']
      .forEach((name) => window.addEventListener(name, syncUnlock));
    window.dispatchEvent(new CustomEvent('golden-core-runtime-ready'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

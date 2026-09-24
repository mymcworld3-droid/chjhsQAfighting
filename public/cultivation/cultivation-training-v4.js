import { equipmentShellMarkup, refineryShellMarkup } from './training-shared-shells.js';
import { createGoldenCoreWashAnimation } from './golden-core-wash-animation.js';
import {
  NASCENT_SOUL_THRESHOLD, NASCENT_SOUL_ATTRIBUTES, nascentSoulForCore, nascentSoulStage,
  normalizeSpirit, normalizeSoulTree, soulSkills, soulAvailableSpirit,
  soulSpentSpirit, soulNodeStatus, allocateSoulNode, soulCombatBonuses
} from './nascent-soul-rules.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc, runTransaction } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 修煉 v4：金丹是修士在自身靈田／丹田中凝聚的本命金丹；玩家永遠只有一顆，洗髓只重塑其丹性與品級。
(function () {
  'use strict';

  const GOLDEN_CORE_SCORE = 28;
  const WASH_COST = 100;
  const STATE_KEY = 'xiuxian_training_state_v4';
  const LEGACY_KEYS = [
    'xiuxian_training_state_v3',
    'xiuxian_training_state_v2',
    'xiuxian_training_state_v1'
  ];
  const CSS_HREF = 'cultivation-training-v3.css';
  const REMOTE_FIELD = 'cultivationTraining';
  const REALM_THRESHOLDS = [68, 128, 208, 308, 448, 628, 868];

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
        return `獲得修為時有 ${chance}% 機率使本次基礎修為翻倍；鬥法攻擊時有 ${chance}% 機率召喚千尺巨浪，額外造成 100 傷害。`;
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
      effect(grade) { return `連續悟道達 ${Math.max(1, Math.ceil(grade / 3)) + 1} 次，即凝聚金丹道心護體；鬥法中連續答對同樣次數也可形成道心護體；護體每次僅抵銷一次傷害後就消失，須由金丹再次凝聚；連擊的第二段傷害仍會命中。`; },
      ability: '凝神斂念，以連續悟道穩固金丹道心。',
      upkeep: '保持專注即可。',
      warning: '一般連勝本身沒有護體，必須調御此丹相才會觸發。',
      note: '金丹會替你隔絕雜念。師尊叫三次都沒回應時，通常會改用物理方式突破你的靜音結界。',
      resolve({ isCorrect, grade, previousStreak }) {
        if (!isCorrect) return {};
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
      effect(grade) { return `答錯時有 ${chanceByGrade(grade, 20, 10, 100)}% 機率凝聚金丹道心護體；鬥法答錯時也有相同機率產生道心護體；護體每次僅抵銷一次傷害後就消失，須由金丹再次凝聚；連擊的第二段傷害仍會命中。`; },
      ability: '失誤之際清心去垢，反而護住道心。',
      upkeep: '答錯後重新定神即可。',
      warning: '只產生金丹道心，不屬於舊版通用道心系統。',
      note: '號稱心如明鏡、萬念不生。答錯時仍可能先懷疑答案，再懷疑出題老師。',
      resolve({ isCorrect, grade }) {
        if (isCorrect) return {};
        const chance = chanceByGrade(grade, 20, 10, 100);
        return randomPercent(chance)
          ? { forceShield: true, message: `${this.name}清心去垢，金丹道心護體成形` }
          : {};
      }
    },
    {
      id: 'thunder', name: '萬劫雷霆丹', icon: '⚡', tone: 'thunder',
      effect(grade) {
        const counterChance = chanceByGrade(grade, 10, 10, 90);
        return `進入下一境界前最後 ${breakthroughPercent(grade)}% 的修為區間時，悟道成功額外 +1 修為；鬥法受到攻擊時有 ${counterChance}% 機率雷光反擊，造成等同本次實際承受傷害的反擊傷害。`;
      },
      ability: '以雷劫淬丹，突破與受擊皆可引雷。',
      upkeep: '雷意需在實戰中承受攻擊才會反擊。',
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
            ${state.equipped ? '<i class="fa-solid fa-circle-check"></i> 已調御此丹相' : '<i class="fa-solid fa-circle-dot"></i> 調御此丹相'}
          </button>
        </div>
      </section>
    `;
  }

  function currentSoulType() {
    return state.equippedCore?.type || state.core?.type || 'taichu';
  }

  function soulBonusLabel(bonus) {
    return [
      bonus.attackFlat ? '+' + bonus.attackFlat + ' 攻擊' : '',
      bonus.maxHpFlat ? '+' + bonus.maxHpFlat + ' 生命' : '',
      bonus.bonusDamage ? '+' + bonus.bonusDamage + ' 答對攻擊傷害' : ''
    ].filter(Boolean).join(' · ');
  }

  function nascentSoulTabMarkup() {
    if (currentScore() < NASCENT_SOUL_THRESHOLD) {
      return '<section class="ns-panel"><h3>元嬰未成</h3><p>修為達到 68 後，方可凝聚本命元嬰。</p></section>';
    }
    // 以正式調御的金丹決定元嬰類型；洗髓候選丹不改變已點亮的技能樹。
    const type = currentSoulType();
    const soul = nascentSoulForCore(type);
    const player = window.getCurrentUserData?.() || {};
    const earned = normalizeSpirit(player.stats?.nascentSoulSpirit);
    const tree = normalizeSoulTree(player.nascentSoulTree);
    const spent = soulSpentSpirit(tree);
    const available = soulAvailableSpirit(tree, earned);
    const bonuses = soulCombatBonuses(tree, type);
    const stage = nascentSoulStage(earned);
    const levels = tree.paths[type]?.nodes || {};
    const progress = stage.next
      ? Math.max(0, Math.min(100, (earned - stage.min) / (stage.next.min - stage.min) * 100))
      : 100;
    const attributes = NASCENT_SOUL_ATTRIBUTES.map(attr => {
      const status = soulNodeStatus(tree, type, attr.id, earned);
      const current = (levels[attr.id] || 0) * attr.value;
      return `
        <article class="ns-node ns-attribute ${status.level ? 'is-lit' : ''}">
          <div class="ns-node-symbol"><i class="fa-solid ${attr.icon}" aria-hidden="true"></i></div>
          <div class="ns-node-content"><strong>${attr.name}</strong><small>${attr.desc}</small>
            <span class="ns-node-benefit">現有效果：+${current}</span>
            <span class="ns-node-level">${status.level} / ${attr.max} 級</span>
          </div>
          <button type="button" class="ns-light-btn" data-ns-node="${attr.id}"
            ${!status.ok || soulBusy ? 'disabled' : ''}
            title="${status.reason || '消耗 ' + status.cost + ' 神識點亮'}">
            ${status.level >= attr.max ? '已滿' : status.ok ? '點亮 · ' + status.cost : status.reason}
          </button>
        </article>`;
    }).join('');
    const skills = soulSkills(type).map((skill, index) => {
      const status = soulNodeStatus(tree, type, skill.id, earned);
      const lit = !!levels[skill.id];
      return `
        <article class="ns-node ns-skill ${lit ? 'is-lit' : ''} ${!lit && !status.ok ? 'is-locked' : ''}">
          <div class="ns-node-symbol"><i class="fa-solid ${['fa-seedling','fa-sun','fa-dharmachakra'][index]}" aria-hidden="true"></i></div>
          <div class="ns-node-content">
            <span class="ns-skill-tier">第 ${index + 1} 階 · ${['靈胎','顯化','法域'][index]}</span>
            <strong>${skill.name}</strong><small>${skill.description}</small>
            <span class="ns-node-benefit">${soulBonusLabel(skill)}</span>
            <span class="ns-skill-condition">累計神識 ${skill.minSpirit} ${index ? ' · 需先點亮上一階' : ' · 需先點亮一項屬性'}</span>
          </div>
          <button type="button" class="ns-light-btn" data-ns-node="${skill.id}"
            ${!status.ok || soulBusy ? 'disabled' : ''}
            title="${status.reason || '消耗 ' + status.cost + ' 神識點亮'}">
            ${lit ? '已點亮' : status.ok ? '點亮 · ' + status.cost : status.reason}
          </button>
        </article>`;
    }).join('');
    return `
      <section class="ns-panel" aria-label="本命元嬰">
        <div class="ns-overview">
          <div class="ns-stage" aria-hidden="true">
            <span class="ns-stage-halo"></span>
            <div class="ns-avatar core-tone-${soul.tone}"><span>${soul.icon}</span></div>
          </div>
          <div class="ns-overview-copy">
            <div class="ns-kicker">NASCENT SOUL · 本命元嬰</div>
            <h3>${soul.name}</h3>
            <div class="ns-stage-name">${stage.name} · ${soul.trait}</div>
            <p class="ns-progress-caption">${soul.description}</p>
            <div class="ns-resource" aria-live="polite">
              <div><small>累計神識</small><strong>${earned}</strong></div>
              <div><small>已投入</small><strong>${spent}</strong></div>
              <div class="ns-resource-free"><small>可用神識</small><strong>${available}</strong></div>
            </div>
            <div class="ns-progress" role="progressbar" aria-valuemin="${stage.min}"
              aria-valuenow="${earned}" aria-valuemax="${stage.next?.min || Math.max(earned,1)}"
              aria-label="神識修煉進度"><span style="width:${progress}%"></span></div>
            <p class="ns-progress-caption">${stage.next ? '距離' + stage.next.name + '尚需 ' + Math.max(0, stage.next.min - earned) + ' 神識' : '神識圓滿'}</p>
            <p class="ns-combat-summary">本丹相已點亮：${soulBonusLabel(bonuses) || '尚無額外屬性'}</p>
          </div>
        </div>
        <div class="ns-trees">
          <section class="ns-tree-section">
            <div class="ns-tree-head"><span>01 / 元嬰屬性</span><h4>凝神煉體</h4><p>消耗可用神識逐級點亮，上限各 5 級。</p></div>
            <div class="ns-node-list">${attributes}</div>
          </section>
          <section class="ns-tree-section">
            <div class="ns-tree-head"><span>02 / ${soul.name}技能樹</span><h4>本命神通</h4><p>依序點亮三階支脈；不同丹相各自保存進度。</p></div>
            <div class="ns-node-list ns-skill-list">${skills}</div>
          </section>
        </div>
        <p class="ns-save-tip">點亮後永久保存，不消耗累計修煉階段；目前不提供洗點。更換丹相時，各元嬰進度保留。鬥法效果在下一場配對時生效。</p>
        <div class="ns-reward-guide">
          <strong>獲得神識</strong>
          <span>問道答對一題 +1</span>
          <span>每日閉關全對 +3</span>
          <span>每次完成洞天：依答對題數獲得等量神識</span>
        </div>
      </section>`;
  }

  async function illuminateSoulNode(nodeId) {
    if (soulBusy || busy || currentScore() < NASCENT_SOUL_THRESHOLD) return;
    const user = getAuth(getApp()).currentUser;
    if (!user) return toast('尚未登入，無法保存元嬰技能。');
    const type = currentSoulType();
    const originalData = window.getCurrentUserData?.();
    const preview = soulNodeStatus(originalData?.nascentSoulTree,
      type, nodeId, originalData?.stats?.nascentSoulSpirit);
    if (!preview.ok) return toast(preview.reason);

    soulBusy = true;
    renderTrainingPage();
    try {
      let awarded;
      const db = getFirestore(getApp());
      await runTransaction(db, async tx => {
        const ref = doc(db, 'users', user.uid);
        const snapshot = await tx.get(ref);
        if (!snapshot.exists()) throw new Error('找不到玩家資料');
        const remote = snapshot.data();
        if (normalizeSpirit(remote.stats?.totalScore) < NASCENT_SOUL_THRESHOLD) throw new Error('元嬰境界不足');
        const remoteType = remote.cultivationTraining?.equippedCore?.type ||
          remote.cultivationTraining?.core?.type || type;
        if (remoteType !== type) throw new Error('金丹丹相已變更，請重新開啟元嬰頁');
        awarded = allocateSoulNode(remote.nascentSoulTree, type, nodeId, remote.stats?.nascentSoulSpirit);
        if (!awarded.ok) throw new Error(awarded.reason);
        tx.update(ref, { nascentSoulTree: awarded.tree });
      });
      const local = window.getCurrentUserData?.();
      if (getAuth(getApp()).currentUser?.uid === user.uid && local) {
        local.nascentSoulTree = awarded.tree;
        toast('元嬰點亮成功，消耗 ' + awarded.cost + ' 神識');
        window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: {
          source: 'nascent-soul-tree', spiritSpent: awarded.cost
        } }));
      }
    } catch (error) {
      console.error('[Nascent soul allocation]', error);
      toast('點亮未完成：' + (error?.message || '請檢查連線後重試'));
    } finally {
      soulBusy = false;
      if (activeTab === 'nascent-soul') renderTrainingPage();
    }
  }

  function bindSoulActions() {
    document.querySelectorAll('#training-tab-content [data-ns-node]').forEach(button => {
      button.addEventListener('click', () => void illuminateSoulNode(button.dataset.nsNode));
    });
  }

  // 鬥法配對時讀取已投資節點，生成固定單場快照；不寫回角色原始攻擊／生命。
  window.getNascentSoulBattleSnapshot = function () {
    if (currentScore() < NASCENT_SOUL_THRESHOLD || state.coreEnabled === false || !state.equippedCore) return null;
    const type = state.equippedCore.type;
    const bonus = soulCombatBonuses(window.getCurrentUserData?.()?.nascentSoulTree, type);
    return { type, ...bonus };
  };

  function bagTabMarkup() {
    // 背包物品改由統一背包模組渲染，避免舊的純文字卡先出現在畫面。
    return '<section class="uib-bag-loading" aria-hidden="true"></section>';
  }

  function renderTrainingPage() {
    const content = document.getElementById('training-tab-content');
    if (!content) return;
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
    content.innerHTML = activeTab === 'bag' ? bagTabMarkup()
      : activeTab === 'nascent-soul' ? nascentSoulTabMarkup() : coreTabMarkup();
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
          <div><div class="training-eyebrow-v3">INNER ALCHEMY ／ 內丹修行</div><h2>修煉</h2></div>
          <div class="training-realm-seal-v3">金丹</div>
        </div>
        <div class="training-subtabs-v3" role="tablist">
          <button type="button" class="training-subtab-v3 active" data-training-tab="core" aria-selected="true"><i class="fa-solid fa-circle-dot"></i><span>金丹</span></button>
          <button type="button" class="training-subtab-v3" data-training-tab="nascent-soul" aria-selected="false" hidden><i class="fa-solid fa-child-reaching"></i><span>元嬰</span></button>
          <button type="button" class="training-subtab-v3" data-training-tab="refinery" aria-selected="false"><i class="fa-solid fa-hammer"></i><span>煉器</span></button>
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
      if (soulTab) soulTab.hidden = currentScore() < NASCENT_SOUL_THRESHOLD;
      return;
    }

    let heading = page.querySelector('.training-page-heading-v3');
    if (!heading) {
      heading = document.createElement('div');
      heading.className = 'training-page-heading-v3';
      page.prepend(heading);
    }
    heading.innerHTML = '<div><div class="training-eyebrow-v3">INNER ALCHEMY ／ 內丹修行</div><h2>修煉</h2></div><div class="training-realm-seal-v3">金丹</div>';

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
    if (soulTab) soulTab.hidden = currentScore() < NASCENT_SOUL_THRESHOLD;
    if (!tabs.querySelector('[data-training-tab="equipment"]')) {
      tabs.querySelector('[data-training-tab="bag"]')?.insertAdjacentHTML('beforebegin',
        '<button type="button" class="training-subtab-v3" data-training-tab="equipment" aria-selected="false"><i class="fa-solid fa-shield-halved"></i><span>裝備</span></button>');
    }

    if (page.dataset.trainingV4Bound !== '1') {
      page.dataset.trainingV4Bound = '1';
      page.querySelectorAll('[data-training-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          if (!isUnlocked() || page.dataset.foundationTraining === '1') return;
          const requested = button.dataset.trainingTab;
          activeTab = ['bag', 'refinery', 'equipment'].includes(requested) || (requested === 'nascent-soul' && currentScore() >= NASCENT_SOUL_THRESHOLD) ? requested : 'core';
          page.querySelectorAll('[data-training-tab]').forEach((tab) => {
            const selected = tab.dataset.trainingTab === activeTab;
            tab.classList.toggle('active', selected);
            tab.setAttribute('aria-selected', selected ? 'true' : 'false');
          });
          renderTrainingPage();
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
        <div class="training-core-feature"><span>特性</span><p><strong>效果：</strong>${type.effect(core.grade)}</p><p><strong>神通：</strong>${type.ability}</p><p><strong>修煉：</strong>${type.upkeep}</p><p><strong>提醒：</strong>${type.warning}</p></div>
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
    if (busy) return;
    const userData = window.getCurrentUserData?.();
    if (!userData?.stats) return toast('尚未讀取到修士資料。');
    if (!getAuth(getApp()).currentUser) return toast('尚未登入，無法保存洗髓結果。');

    const stones = currentSpiritStones();
    if (stones < WASH_COST) return toast(`靈石不足，洗髓需要 ${WASH_COST} 靈石。`);

    busy = true;
    renderTrainingPage();
    const previousCore = { ...state.core };
    const previousEquippedCore = state.equippedCore ? { ...state.equippedCore } : null;
    const previousEquipped = state.equipped;
    const previousGold = stones;

    let animation = null;
    try {
      // 在原本金丹位置播放發光、脈動動畫，不建立光束或彈窗。
      animation = createGoldenCoreWashAnimation();
      const fresh = randomCore();
      state.core = fresh;
      // 洗髓只產生候選丹；原本裝備中的丹繼續生效，直到玩家主動裝配新丹。
      state.equipped = false;
      userData.stats.gold = stones - WASH_COST;
      await persistRemote({ 'stats.gold': stones - WASH_COST });
      // 保存成功後才在原位置揭曉丹相；保留最短演出時間，避免網路過快導致特效閃過。
      await animation.minimumDuration;
      await animation.reveal(fresh, coreType(fresh.type));
      toast(`洗髓完成：${fresh.grade} 品 ${coreType(fresh.type).name}`);
    } catch (error) {
      console.error('Wash golden core failed:', error);
      state.core = previousCore;
      state.equippedCore = previousEquippedCore;
      state.equipped = previousEquipped;
      userData.stats.gold = previousGold;
      saveLocal();
      if (animation) await animation.fail();
      toast('洗髓未完成，請重新整理確認靈石與丹相。');
    } finally {
      animation?.cleanup();
      busy = false;
      renderTrainingPage();
    }
  }

  async function equipCore() {
    if (busy || state.equipped) return;
    busy = true;
    const previousEquippedCore = state.equippedCore ? { ...state.equippedCore } : null;
    state.equippedCore = { ...state.core };
    state.equipped = true;
    renderTrainingPage();
    try {
      await persistRemote();
      toast(`已調御丹相：${state.core.grade} 品 ${coreType(state.core.type).name}`);
      window.dispatchEvent(new CustomEvent('golden-core-equipped-changed'));
    } catch (error) {
      console.error('Equip golden core failed:', error);
      state.equippedCore = previousEquippedCore;
      state.equipped = false;
      saveLocal();
      toast('調御失敗，請稍後再試。');
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

  window.resolveGoldenCoreCultivationReward = function ({ stats, isCorrect }) {
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
      hasShield: !!stats?.goldenCoreShield
    }) || {};

    saveLocal();
    return {
      bonusGain: Math.max(0, Number(effect.bonusGain) || 0),
      forceShield: !!effect.forceShield,
      preserveShield: !!effect.preserveShield,
      message: effect.message || ''
    };
  };

  // 公開金丹資料只解釋丹性與品級；不讀取他人的洗髓候選或帳號私有欄位。
  window.getGoldenCorePublicDetails = function (coreLike) {
    if (!coreLike || !CORE_TYPES.some((entry) => entry.id === coreLike.type)) return null;
    const grade = clampGrade(coreLike.grade);
    const type = coreType(coreLike.type);
    return { type: type.id, name: type.name, grade, effect: type.effect(grade), equipped: true };
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
    if (lastUnlocked === unlocked) {
      if (unlocked) {
        const soulTab = document.querySelector('#page-training [data-training-tab="nascent-soul"]');
        if (soulTab) soulTab.hidden = currentScore() < NASCENT_SOUL_THRESHOLD;
        if (activeTab === 'nascent-soul') renderTrainingPage();
      }
      return;
    }

    if (unlocked) ensureUnlockedUI();
    else if (lastUnlocked === true) removeLockedUI();
    lastUnlocked = unlocked;
  }

  function boot() {
    loadStyle();
    restoreRemoteTraining();
    syncUnlock();
    window.addEventListener('xiuxian:user-ready', restoreRemoteTraining);
    ['xiuxian:stats-updated','xiuxian:user-ready','xiuxian:migration-ready','golden-core-access-changed']
      .forEach((name) => window.addEventListener(name, syncUnlock));
    window.dispatchEvent(new CustomEvent('golden-core-runtime-ready'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
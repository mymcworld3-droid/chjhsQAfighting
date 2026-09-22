import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ARTIFACT_CATALOG, ARTIFACT_REALMS, ARTIFACT_EQUIP_SLOTS, getArtifactById, realmForScore, realmOrderByName, artifactRealmColor } from './artifact-catalog.js';

// 資料驅動法寶系統：法寶內容只在 artifact-catalog.js 定義。
// 本檔負責通用打造、持有、裝備、限時效果與題目中使用，不寫任何單一法寶的專屬 if/else。
(function () {
  'use strict';

  const FIELD = 'artifactSystem';
  const COLLAPSE_KEY = 'artifactForgeCollapsedV1';
  const SUPPORTED_EFFECTS = new Set([
    'equip_attack_flat', 'equip_attack_percent', 'equip_hp_flat', 'equip_hp_percent',
    'equip_damage_percent', 'equip_damage_reduction_flat', 'equip_damage_reduction_percent',
    'equip_crit_chance', 'equip_crit_damage_percent', 'equip_combo_chance',
    'equip_lifesteal_percent', 'equip_reflect_percent', 'equip_shield_flat',
    'equip_true_damage_flat', 'equip_low_hp_damage_percent', 'equip_low_hp_reduction_percent',
    'equip_first_hit_reduction_percent', 'equip_damage_cap_percent',
    'equip_on_correct_shield_flat', 'equip_cheat_death', 'equip_copy_enemy_artifact',
    'timed_attack_multiplier', 'timed_cultivation_multiplier', 'remove_wrong_option'
  ]);
  const BATTLE_RUNTIME_EFFECTS = new Set([
    'equip_damage_percent', 'equip_damage_reduction_flat', 'equip_damage_reduction_percent',
    'equip_crit_chance', 'equip_crit_damage_percent', 'equip_combo_chance',
    'equip_lifesteal_percent', 'equip_reflect_percent', 'equip_shield_flat',
    'equip_true_damage_flat', 'equip_low_hp_damage_percent', 'equip_low_hp_reduction_percent',
    'equip_first_hit_reduction_percent', 'equip_damage_cap_percent',
    'equip_on_correct_shield_flat', 'equip_cheat_death', 'equip_copy_enemy_artifact'
  ]);
  const usedQuestionKeys = new Set();
  let busyAction = '';
  let combatWrapped = false;
  let renderQueued = false;
  let eligibilityBusy = false;

  function userData() { return window.getCurrentUserData?.() || null; }
  function authUser() {
    try { return getAuth(getApp()).currentUser; } catch (_) { return null; }
  }
  function database() { return getFirestore(getApp()); }
  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function toast(message) {
    const old = document.getElementById('artifact-toast');
    old?.remove();
    const el = document.createElement('div');
    el.id = 'artifact-toast';
    el.textContent = message;
    el.style.cssText = 'position:fixed;left:50%;bottom:135px;z-index:10050;max-width:calc(100vw - 28px);transform:translateX(-50%);padding:10px 15px;border:1px solid rgba(216,177,93,.42);border-radius:999px;background:rgba(8,8,8,.97);color:#f5dda0;font-size:10px;font-weight:900;box-shadow:0 16px 48px rgba(0,0,0,.55)';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }
  function clonePlain(value) {
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value || {})); }
  }
  function itemHasEquipEffects(item) { return (item?.effects || []).some((effect) => String(effect.type).startsWith('equip_')); }
  function canonicalEquipSlot(item) {
    if (!itemHasEquipEffects(item)) return '';
    const configured = String(item?.equipSlot || '').trim();
    return ARTIFACT_EQUIP_SLOTS.includes(configured) ? configured : '輔助法寶';
  }
  function normalizeSystem(raw = {}) {
    const inventory = {};
    Object.entries(raw?.inventory || {}).forEach(([id, value]) => {
      const qty = Math.max(0, Math.floor(Number(value) || 0));
      if (qty > 0) inventory[id] = qty;
    });
    const equipped = {};
    Object.entries(raw?.equipped || {}).forEach(([slot, id]) => {
      const item = typeof id === 'string' ? getArtifactById(id) : null;
      const canonicalSlot = canonicalEquipSlot(item);
      if (ARTIFACT_EQUIP_SLOTS.includes(slot) && item && canonicalSlot === slot && inventory[id] > 0) {
        equipped[slot] = id;
      }
    });
    const buffs = {};
    Object.entries(raw?.buffs || {}).forEach(([key, buff]) => {
      if (!buff || typeof buff !== 'object') return;
      const expiresAt = Number(buff.expiresAt) || 0;
      if (!buff.type || expiresAt <= 0) return;
      buffs[key] = { ...buff, expiresAt };
    });
    return { inventory, equipped, buffs };
  }
  function state() { return normalizeSystem(userData()?.[FIELD] || {}); }
  function setLocalState(next) {
    const data = userData();
    if (data) data[FIELD] = normalizeSystem(next);
    window.dispatchEvent(new CustomEvent('artifact-system-updated', { detail: clonePlain(normalizeSystem(next)) }));
    scheduleRender();
    syncQuestionTools();
  }
  function currentRealm() {
    return realmForScore(Math.max(0, Number(userData()?.stats?.totalScore) || 0));
  }
  // Item realm is a quality/power tier, never an equipment requirement.
  function realmAllowedToEquip(item) { return !!item && itemHasEquipEffects(item); }
  function quantity(itemId) { return Math.max(0, Number(state().inventory[itemId]) || 0); }
  function activeBuffs() {
    const now = Date.now();
    return Object.values(state().buffs).filter((buff) => Number(buff.expiresAt) > now);
  }
  function equipmentEffects() {
    const s = state();
    const result = [];
    Object.entries(s.equipped).forEach(([slot, id]) => {
      const item = getArtifactById(id);
      if (!item) return;
      (item.effects || []).forEach((effect, effectIndex) => {
        if (String(effect.type).startsWith('equip_')) result.push({ ...effect, item, slot, effectIndex });
      });
    });
    return result;
  }
  function battleSnapshot() {
    const effects = equipmentEffects()
      .filter((effect) => BATTLE_RUNTIME_EFFECTS.has(effect.type))
      .map((effect) => ({
        type: effect.type,
        value: Number(effect.value) || 0,
        artifactId: effect.item?.id || '',
        artifactName: effect.item?.name || '',
        effectIndex: Number(effect.effectIndex) || 0
      }));
    const openingShield = effects
      .filter((effect) => effect.type === 'equip_shield_flat')
      .reduce((sum, effect) => sum + Math.max(0, Number(effect.value) || 0), 0);
    return { version: 1, effects, openingShield: Math.max(0, Math.round(openingShield)) };
  }

  window.getArtifactBattleSnapshot = function () {
    return clonePlain(battleSnapshot());
  };

  function itemHasTimedEffects(item) { return (item?.effects || []).some((effect) => String(effect.type).startsWith('timed_')); }
  function removeOptionEffect(item, context) {
    return (item?.effects || []).find((effect) => effect.type === 'remove_wrong_option' && (!Array.isArray(effect.contexts) || effect.contexts.includes(context)));
  }
  function effectLabel(effect) {
    const pct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
    switch (effect?.type) {
      case 'equip_attack_flat': return `裝備：攻擊 +${Number(effect.value) || 0}`;
      case 'equip_attack_percent': return `裝備：攻擊 +${pct(effect.value)}`;
      case 'equip_hp_flat': return `裝備：生命 +${Number(effect.value) || 0}`;
      case 'equip_hp_percent': return `裝備：生命 +${pct(effect.value)}`;
      case 'equip_damage_percent': return `鬥法：傷害 +${pct(effect.value)}`;
      case 'equip_damage_reduction_flat': return `鬥法：每次受傷 -${Number(effect.value) || 0}`;
      case 'equip_damage_reduction_percent': return `鬥法：受到傷害 -${pct(effect.value)}`;
      case 'equip_crit_chance': return `鬥法：暴擊率 +${pct(effect.value)}`;
      case 'equip_crit_damage_percent': return `鬥法：暴擊額外 +${pct(effect.value)}`;
      case 'equip_combo_chance': return `鬥法：連擊率 ${pct(Math.min(0.10, Number(effect.value) || 0))}（上限 10%）`;
      case 'equip_lifesteal_percent': return `鬥法：吸血 ${pct(effect.value)}`;
      case 'equip_reflect_percent': return `鬥法：反傷 ${pct(effect.value)}`;
      case 'equip_shield_flat': return `鬥法：開場護盾 +${Number(effect.value) || 0}`;
      case 'equip_true_damage_flat': return `鬥法：命中追加 ${Number(effect.value) || 0} 真實傷害`;
      case 'equip_low_hp_damage_percent': return `鬥法：生命≤30% 時傷害 +${pct(effect.value)}`;
      case 'equip_low_hp_reduction_percent': return `鬥法：生命≤30% 時減傷 +${pct(effect.value)}`;
      case 'equip_first_hit_reduction_percent': return `鬥法：首次受傷減少 ${pct(effect.value)}`;
      case 'equip_damage_cap_percent': return `鬥法：單次生命傷害≤最大生命 ${pct(effect.value)}`;
      case 'equip_on_correct_shield_flat': return `鬥法：答對攻擊後護盾 +${Number(effect.value) || 0}`;
      case 'equip_cheat_death': return '鬥法：每場一次致命傷保留 1 HP';
      case 'equip_copy_enemy_artifact': return '鬥法：複製敵方一項可複製法寶效果';
      case 'timed_attack_multiplier': return `使用：攻擊 ×${Number(effect.multiplier) || 1} · ${formatDuration(effect.durationMs)}`;
      case 'timed_cultivation_multiplier': return `使用：修為 ×${Number(effect.multiplier) || 1} · ${formatDuration(effect.durationMs)}`;
      case 'remove_wrong_option': return `答題：排除 1 個錯誤選項`;
      default: return `未知效果：${escapeHtml(effect?.type || '')}`;
    }
  }
  function formatDuration(ms) {
    const seconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
    if (seconds >= 3600) return `${Math.round(seconds / 3600)} 小時`;
    if (seconds >= 60) return `${Math.round(seconds / 60)} 分鐘`;
    return `${seconds} 秒`;
  }
  function formatRemaining(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  async function updateArtifactSystem(mutator) {
    const user = authUser();
    if (!user) throw new Error('尚未登入');
    let committed = null;
    await runTransaction(database(), async (tx) => {
      const ref = doc(database(), 'users', user.uid);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('玩家資料不存在');
      const next = normalizeSystem(snap.data()?.[FIELD] || {});
      await mutator(next, snap.data(), tx, ref);
      committed = normalizeSystem(next);
      tx.update(ref, { [FIELD]: committed });
    });
    setLocalState(committed);
    return committed;
  }

  async function craftArtifact(itemId) {
    const item = getArtifactById(itemId);
    const user = authUser();
    if (!item || !user) return;
    const cost = Math.max(0, Math.floor(Number(item.craft?.gold) || 0));
    const gain = Math.max(1, Math.floor(Number(item.craft?.yield) || 1));
    busyAction = `craft:${itemId}`; scheduleRender();
    try {
      let newGold = 0;
      let committed = null;
      await runTransaction(database(), async (tx) => {
        const ref = doc(database(), 'users', user.uid);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('玩家資料不存在');
        const raw = snap.data();
        const gold = Math.max(0, Number(raw.stats?.gold) || 0);
        if (gold < cost) throw new Error(`金幣不足，打造需要 ${cost}`);
        const next = normalizeSystem(raw[FIELD] || {});
        next.inventory[itemId] = (Number(next.inventory[itemId]) || 0) + gain;
        newGold = gold - cost;
        committed = next;
        tx.update(ref, { [FIELD]: next, 'stats.gold': newGold });
      });
      const data = userData();
      if (data?.stats) data.stats.gold = newGold;
      setLocalState(committed);
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { gold: newGold, artifactCrafted: itemId } }));
      toast(`煉器成功：${item.name} × ${gain}`);
    } finally {
      busyAction = ''; scheduleRender();
    }
  }

  function equipmentStatus(itemId) {
    const item = getArtifactById(itemId);
    const isEquipment = !!item && itemHasEquipEffects(item);
    const slot = canonicalEquipSlot(item);
    const s = state();
    const equippedItemId = slot ? String(s.equipped[slot] || '') : '';
    const equippedItem = getArtifactById(equippedItemId);
    const owned = quantity(itemId);
    const canEquip = !!item && isEquipment && !!slot && owned > 0;
    let reason = '';
    if (!item) reason = '法寶不存在';
    else if (!isEquipment) reason = '此法寶不是裝備型';
    else if (owned <= 0) reason = '尚未持有';
    return {
      itemId: String(itemId || ''),
      slot,
      equipped: equippedItemId === itemId,
      equippedItemId,
      equippedItemName: equippedItem?.name || '',
      owned,
      canEquip,
      reason
    };
  }

  async function toggleEquipArtifact(itemId) {
    const item = getArtifactById(itemId);
    if (!item || !itemHasEquipEffects(item)) throw new Error('此法寶不是可裝備法寶');
    const slot = canonicalEquipSlot(item);
    if (!slot) throw new Error('此法寶沒有可用裝備欄位');

    busyAction = `equip:${itemId}`; scheduleRender();
    try {
      let unequipped = false;
      let replacedId = '';
      await updateArtifactSystem((next, raw) => {
        const owned = Math.max(0, Number(next.inventory[itemId]) || 0);
        if (owned <= 0) throw new Error('你尚未持有此法寶');
        if (next.equipped[slot] === itemId) {
          delete next.equipped[slot];
          unequipped = true;
        } else {
          replacedId = String(next.equipped[slot] || '');
          next.equipped[slot] = itemId;
        }
      });
      const replaced = getArtifactById(replacedId);
      toast(unequipped
        ? `已卸下 ${item.name}`
        : (replaced ? `已將 ${replaced.name} 替換為 ${item.name}` : `已裝備 ${item.name}`));
    } finally {
      busyAction = ''; scheduleRender();
    }
  }

  async function activateTimedArtifact(itemId) {
    const item = getArtifactById(itemId);
    const effects = (item?.effects || []).filter((effect) => String(effect.type).startsWith('timed_'));
    if (!item || !effects.length) return;
    if (quantity(itemId) <= 0) { toast('你尚未持有此法寶。'); return; }
    busyAction = `use:${itemId}`; scheduleRender();
    try {
      const now = Date.now();
      await updateArtifactSystem((next) => {
        const qty = Math.max(0, Number(next.inventory[itemId]) || 0);
        if (qty <= 0) throw new Error('法寶數量不足');
        if (qty === 1) delete next.inventory[itemId]; else next.inventory[itemId] = qty - 1;
        effects.forEach((effect, index) => {
          const key = `${itemId}:${index}:${effect.type}`;
          const durationMs = Math.max(1000, Number(effect.durationMs) || 1000);
          const previous = next.buffs[key];
          const base = effect.stacking === 'extend' && Number(previous?.expiresAt) > now ? Number(previous.expiresAt) : now;
          next.buffs[key] = {
            artifactId: itemId,
            artifactName: item.name,
            type: effect.type,
            value: Number(effect.value) || 0,
            multiplier: Number(effect.multiplier) || 1,
            expiresAt: base + durationMs
          };
        });
      });
      toast(`${item.name} 已催動，限時效果生效。`);
    } finally {
      busyAction = ''; scheduleRender();
    }
  }

  function combatModifiers() {
    let attackFlat = 0;
    let attackMultiplier = 1;
    let hpFlat = 0;
    let hpMultiplier = 1;
    equipmentEffects().forEach((effect) => {
      if (effect.type === 'equip_attack_flat') attackFlat += Number(effect.value) || 0;
      if (effect.type === 'equip_attack_percent') attackMultiplier *= 1 + Math.max(-0.95, Number(effect.value) || 0);
      if (effect.type === 'equip_hp_flat') hpFlat += Number(effect.value) || 0;
      if (effect.type === 'equip_hp_percent') hpMultiplier *= 1 + Math.max(-0.95, Number(effect.value) || 0);
    });
    activeBuffs().forEach((buff) => {
      if (buff.type === 'timed_attack_multiplier') attackMultiplier *= Math.max(0, Number(buff.multiplier) || 1);
    });
    return { attackFlat, attackMultiplier, hpFlat, hpMultiplier };
  }

  function installCombatWrapper() {
    if (combatWrapped || typeof window.getCombatStats !== 'function') return;
    const base = window.getCombatStats;
    if (base.__artifactWrapped) { combatWrapped = true; return; }
    const wrapped = function () {
      const stats = base() || { attack: 200, hp: 1000, maxHp: 1000 };
      const mod = combatModifiers();
      const baseMaxHp = Math.max(1, Number(stats.maxHp) || 1000);
      const hpRatio = Math.max(0, Math.min(1, (Number(stats.hp) || 0) / baseMaxHp));
      const maxHp = Math.max(1, Math.round((baseMaxHp + mod.hpFlat) * mod.hpMultiplier));
      return {
        ...stats,
        attack: Math.max(0, Math.round(((Number(stats.attack) || 0) + mod.attackFlat) * mod.attackMultiplier)),
        maxHp,
        hp: Math.max(0, Math.min(maxHp, Math.round(maxHp * hpRatio)))
      };
    };
    Object.defineProperty(wrapped, '__artifactWrapped', { value: true });
    window.getCombatStats = wrapped;
    combatWrapped = true;
  }

  window.applyArtifactCultivationGain = function (baseGain) {
    const original = Math.max(0, Number(baseGain) || 0);
    let multiplier = 1;
    const names = [];
    activeBuffs().forEach((buff) => {
      if (buff.type !== 'timed_cultivation_multiplier') return;
      multiplier *= Math.max(0, Number(buff.multiplier) || 1);
      if (buff.artifactName) names.push(buff.artifactName);
    });
    const gain = Math.max(0, Math.round(original * multiplier));
    return {
      gain,
      bonusGain: Math.max(0, gain - original),
      multiplier,
      message: names.length && multiplier !== 1 ? `${names.join('、')}生效，修為 ×${multiplier}` : ''
    };
  };

  function currentQuestionContext() {
    const dongtian = window.getDongtianArtifactQuestionContext?.();
    if (dongtian?.correctIndex >= 0) return normalizeQuestionContext(dongtian);
    const tutorial = window.getBattleTutorialQuestionContext?.();
    if (tutorial?.correctIndex >= 0) return normalizeQuestionContext(tutorial);
    const battle = window.getBattleArtifactQuestionContext?.();
    if (battle?.correctIndex >= 0) return normalizeQuestionContext(battle);

    const quiz = window.currentActiveQuiz?.data;
    const buttons = [...document.querySelectorAll('[id^="option-btn-"]')].filter((button) => button.offsetParent !== null);
    if (!quiz || !buttons.length || !Number.isInteger(Number(quiz.ans))) return null;
    return {
      context: 'quiz',
      key: `quiz:${String(quiz.q || '')}:${Number(window.quizStartTime) || 0}`,
      correctIndex: Number(quiz.ans),
      answered: buttons.every((button) => button.disabled),
      buttons,
      container: buttons[0]?.parentElement || null
    };
  }
  function normalizeQuestionContext(raw) {
    const buttons = raw.buttons || [...document.querySelectorAll(raw.buttonsSelector || '')];
    const container = raw.container || document.querySelector(raw.containerSelector || '') || buttons[0]?.parentElement || null;
    return {
      context: raw.context,
      key: String(raw.key || ''),
      correctIndex: Number(raw.correctIndex),
      answered: !!raw.answered,
      buttons: [...buttons],
      container
    };
  }
  function buttonIndex(button, fallback) {
    const candidates = [button?.dataset?.index, button?.dataset?.dtAnswer, button?.dataset?.artifactIndex];
    const idMatch = String(button?.id || '').match(/option-btn-(\d+)/);
    if (idMatch) candidates.push(idMatch[1]);
    for (const value of candidates) {
      if (Number.isInteger(Number(value))) return Number(value);
    }
    return fallback;
  }
  async function useRemoveOptionArtifact(itemId, context) {
    const item = getArtifactById(itemId);
    const effect = removeOptionEffect(item, context.context);
    if (!item || !effect || usedQuestionKeys.has(context.key)) return;
    const candidates = context.buttons.filter((button, index) => {
      const idx = buttonIndex(button, index);
      return idx !== context.correctIndex && !button.disabled && button.style.display !== 'none' && button.dataset.artifactRemoved !== '1';
    });
    if (!candidates.length) { toast('目前沒有可排除的錯誤選項。'); return; }
    busyAction = `question:${itemId}`; syncQuestionTools();
    try {
      await updateArtifactSystem((next) => {
        const qty = Math.max(0, Number(next.inventory[itemId]) || 0);
        if (qty <= 0) throw new Error('法寶數量不足');
        if (qty === 1) delete next.inventory[itemId]; else next.inventory[itemId] = qty - 1;
      });
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];
      chosen.dataset.artifactRemoved = '1';
      chosen.disabled = true;
      chosen.style.display = 'none';
      usedQuestionKeys.add(context.key);
      toast(`${item.name}發動：已排除一個錯誤選項。`);
    } finally {
      busyAction = ''; syncQuestionTools(); scheduleRender();
    }
  }

  function syncQuestionTools() {
    const context = currentQuestionContext();
    document.querySelectorAll('.artifact-question-tools').forEach((node) => {
      if (!context || node.dataset.questionKey !== context.key) node.remove();
    });
    if (!context?.container || !context.key || context.answered) return;
    const available = ARTIFACT_CATALOG.filter((item) => quantity(item.id) > 0 && !!removeOptionEffect(item, context.context));
    if (!available.length) {
      context.container.parentElement?.querySelector?.(`.artifact-question-tools[data-question-key="${CSS.escape(context.key)}"]`)?.remove();
      return;
    }
    let bar = context.container.parentElement?.querySelector?.(`.artifact-question-tools[data-question-key="${CSS.escape(context.key)}"]`);
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'artifact-question-tools';
      bar.dataset.questionKey = context.key;
      context.container.before(bar);
    }
    const used = usedQuestionKeys.has(context.key);
    const renderKey = JSON.stringify([
      context.key,
      used,
      !!busyAction,
      available.map((item) => [item.id, item.name, item.icon || '◆', quantity(item.id)])
    ]);
    // MutationObserver 會再次看見 innerHTML 造成的 childList 變動；內容沒有改變時絕對不能重寫 DOM，
    // 否則會形成 observer -> syncQuestionTools -> innerHTML -> observer 的無限循環，改法寶名稱時尤其容易觸發。
    if (bar.dataset.artifactRenderKey === renderKey) return;
    bar.dataset.artifactRenderKey = renderKey;
    bar.innerHTML = `<span class="artifact-question-label"><i class="fa-solid fa-wand-sparkles"></i> 法寶</span>${available.map((item) => `<button type="button" data-artifact-question-use="${escapeHtml(item.id)}" ${used || busyAction ? 'disabled' : ''}><b>${escapeHtml(item.icon || '◆')}</b>${escapeHtml(item.name)} ×${quantity(item.id)}<small>排除錯項</small></button>`).join('')}`;
    bar.querySelectorAll('[data-artifact-question-use]').forEach((button) => {
      button.onclick = () => useRemoveOptionArtifact(button.dataset.artifactQuestionUse, currentQuestionContext() || context).catch((error) => toast(window.xiuxianSafeActionError?.('法寶答題使用', error, '法寶使用未完成。') || '法寶使用未完成。'));
    });
  }

  function activeBuffFor(itemId) {
    return activeBuffs().filter((buff) => buff.artifactId === itemId).sort((a, b) => b.expiresAt - a.expiresAt)[0] || null;
  }
  function equippedSlotFor(itemId) {
    return Object.entries(state().equipped).find(([, id]) => id === itemId)?.[0] || '';
  }
  function forgeItemMarkup(item) {
    const qty = quantity(item.id);
    const cost = Math.max(0, Number(item.craft?.gold) || 0);
    const yieldCount = Math.max(1, Number(item.craft?.yield) || 1);
    const hasEquip = itemHasEquipEffects(item);
    const hasTimed = itemHasTimedEffects(item);
    const eqSlot = equippedSlotFor(item.id);
    const buff = activeBuffFor(item.id);
    const canEquip = realmAllowedToEquip(item);
    const invalidEffects = (item.effects || []).filter((effect) => !SUPPORTED_EFFECTS.has(effect.type));
    const realmColor = artifactRealmColor(item.realm);
    return `<article class="artifact-item ${eqSlot ? 'is-equipped' : ''}" style="--artifact-realm-color:${escapeHtml(realmColor)}">
      <div class="artifact-icon" aria-hidden="true">${escapeHtml(item.icon || '◆')}</div>
      <div class="artifact-copy">
        <div class="artifact-name-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.realm)}</span><em>${escapeHtml(item.category || '法寶')}</em></div>
        <p>${escapeHtml(item.description || '')}</p>
        <div class="artifact-effects">${(item.effects || []).map((effect) => `<span>${effectLabel(effect)}</span>`).join('')}${invalidEffects.map((effect) => `<span class="artifact-invalid">尚未支援：${escapeHtml(effect.type)}</span>`).join('')}</div>
        <div class="artifact-meta">持有 <b>×${qty}</b>${eqSlot ? ` · 已裝備於 <b>${escapeHtml(eqSlot)}</b>` : ''}${buff ? ` · 效果剩餘 <b data-artifact-expire="${buff.expiresAt}">${formatRemaining(buff.expiresAt - Date.now())}</b>` : ''}</div>
      </div>
      <div class="artifact-actions">
        <button type="button" data-artifact-craft="${escapeHtml(item.id)}" ${busyAction ? 'disabled' : ''}>${busyAction === `craft:${item.id}` ? '煉製中…' : `煉製 ×${yieldCount}`}<small>${cost} 金幣</small></button>
        ${hasEquip ? `<button type="button" data-artifact-equip="${escapeHtml(item.id)}" ${qty <= 0 || !canEquip || busyAction ? 'disabled' : ''}>${eqSlot ? '卸下' : '裝備'}<small>${escapeHtml(item.equipSlot || '法寶')}</small></button>` : ''}
        ${hasTimed ? `<button type="button" data-artifact-use="${escapeHtml(item.id)}" ${qty <= 0 || busyAction ? 'disabled' : ''}>${buff ? '重新催動' : '催動'}<small>消耗 1 件</small></button>` : ''}
        ${(item.effects || []).some((effect) => effect.type === 'remove_wrong_option') ? `<span class="artifact-question-only">於題目作答前使用</span>` : ''}
      </div>
    </article>`;
  }

  function ensureStyle() {
    if (document.getElementById('artifact-system-style')) return;
    const style = document.createElement('style');
    style.id = 'artifact-system-style';
    style.textContent = `
      .artifact-forge-card .dongfu-collapse-icon{color:#f2c66d;border-color:rgba(216,177,93,.3);background:rgba(216,177,93,.07)}
      .artifact-forge-body{display:grid;gap:12px}.artifact-forge-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.artifact-forge-summary div{padding:9px;border:1px solid rgba(216,177,93,.13);border-radius:12px;background:rgba(216,177,93,.025);text-align:center}.artifact-forge-summary span{display:block;color:#83765f;font-size:7px}.artifact-forge-summary b{display:block;margin-top:3px;color:#e5c677;font-size:10px}.artifact-forge-note{margin:0;color:#8e816b;font-size:8px;line-height:1.7}.artifact-list{display:grid;gap:9px}.artifact-item{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px;border:1px solid color-mix(in srgb,var(--artifact-realm-color,#d8b15d) 30%,rgba(255,255,255,.07));border-radius:16px;background:radial-gradient(circle at 8% 45%,color-mix(in srgb,var(--artifact-realm-color,#d8b15d) 8%,transparent),transparent 35%),linear-gradient(145deg,rgba(20,17,11,.9),rgba(7,7,7,.96))}.artifact-item.is-equipped{border-color:color-mix(in srgb,var(--artifact-realm-color,#d8b15d) 68%,#fff 8%);box-shadow:inset 0 0 25px color-mix(in srgb,var(--artifact-realm-color,#d8b15d) 8%,transparent)}.artifact-icon{width:48px;height:48px;display:grid;place-items:center;border-radius:15px;border:1px solid color-mix(in srgb,var(--artifact-realm-color,#d8b15d) 55%,transparent);color:var(--artifact-realm-color,#f4d889);background:radial-gradient(circle at 35% 28%,color-mix(in srgb,var(--artifact-realm-color,#d8b15d) 22%,transparent),rgba(39,25,7,.72));box-shadow:0 0 18px color-mix(in srgb,var(--artifact-realm-color,#d8b15d) 10%,transparent);font-size:16px;font-weight:900}.artifact-copy{min-width:0}.artifact-name-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.artifact-name-row strong{color:#f2e6cc;font-size:11px}.artifact-name-row span,.artifact-name-row em{padding:2px 6px;border-radius:999px;border:1px solid color-mix(in srgb,var(--artifact-realm-color,#d8b15d) 35%,rgba(216,177,93,.12));color:var(--artifact-realm-color,#c4a75e);font-size:7px;font-style:normal}.artifact-name-row em{color:#a89b83}.artifact-copy p{margin:5px 0;color:#9e917b;font-size:8px;line-height:1.55}.artifact-effects{display:flex;gap:4px;flex-wrap:wrap}.artifact-effects span{padding:3px 6px;border-radius:8px;background:rgba(216,177,93,.045);color:#c7b78f;font-size:7px}.artifact-effects .artifact-invalid{color:#fca5a5;border:1px solid rgba(248,113,113,.25)}.artifact-meta{margin-top:6px;color:#776c59;font-size:7px}.artifact-meta b{color:#d7b96b}.artifact-meta i{color:#f1a5a5;font-style:normal}.artifact-actions{display:grid;gap:5px;min-width:90px}.artifact-actions button{min-height:34px;padding:5px 9px;border-radius:10px;border:1px solid rgba(216,177,93,.26);background:rgba(216,177,93,.06);color:#efdca8;font-size:8px;font-weight:900}.artifact-actions button:hover:not(:disabled){border-color:#d8b15d;background:rgba(216,177,93,.12)}.artifact-actions button:disabled{opacity:.38;cursor:not-allowed}.artifact-actions button small{display:block;margin-top:2px;color:#8f8063;font-size:6px}.artifact-question-only{color:#907f5e;font-size:7px;text-align:center}.artifact-question-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0;padding:7px;border:1px solid rgba(216,177,93,.17);border-radius:12px;background:rgba(17,13,7,.78)}.artifact-question-label{color:#cda84d;font-size:8px;font-weight:900}.artifact-question-tools button{display:flex;align-items:center;gap:5px;min-height:31px;padding:4px 8px;border-radius:9px;border:1px solid rgba(216,177,93,.27);background:rgba(216,177,93,.08);color:#ead49a;font-size:8px;font-weight:900}.artifact-question-tools button b{width:20px;height:20px;display:grid;place-items:center;border-radius:50%;background:#201607}.artifact-question-tools button small{color:#8f8068;font-size:6px}.artifact-question-tools button:disabled{opacity:.38}.artifact-removed-option{display:none!important}
      .artifact-icon{border-radius:12px;box-shadow:inset 0 0 0 2px rgba(255,242,195,.1),0 0 18px color-mix(in srgb,var(--artifact-realm-color,#d8b15d) 12%,transparent)}
      @media(max-width:600px){.artifact-forge-summary{grid-template-columns:1fr 1fr}.artifact-item{grid-template-columns:44px minmax(0,1fr)}.artifact-icon{width:42px;height:42px}.artifact-actions{grid-column:1/-1;grid-template-columns:repeat(2,minmax(0,1fr));width:100%}.artifact-question-only{grid-column:1/-1}.artifact-actions button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function setCollapsed(card, body, collapsed) {
    body.hidden = !!collapsed;
    card.classList.toggle('is-collapsed', !!collapsed);
    card.querySelector('.dongfu-collapse-head')?.setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (_) {}
  }
  function mountForge() {
    ensureStyle();
    const page = document.getElementById('page-settings');
    if (!page || document.getElementById('artifact-forge-card')) return;
    const analysis = page.querySelector('.dongfu-analysis-card') || page.querySelector('#knowledgeChart')?.closest('.glass-panel');
    if (!analysis) return;
    const card = document.createElement('section');
    card.id = 'artifact-forge-card';
    card.className = 'glass-panel rounded-2xl mb-6 relative overflow-hidden dongfu-collapse-card artifact-forge-card';
    card.innerHTML = `<button type="button" class="dongfu-collapse-head" aria-expanded="false"><span class="dongfu-collapse-icon"><i class="fa-solid fa-hammer"></i></span><span class="dongfu-collapse-copy"><span class="dongfu-collapse-title">煉器室</span><span class="dongfu-collapse-summary">打造、裝備與催動法寶</span></span><span class="dongfu-collapse-chevron"><i class="fa-solid fa-chevron-down"></i></span></button><div id="artifact-forge-body" class="dongfu-collapse-body artifact-forge-body" hidden><div id="artifact-forge-content"></div></div>`;
    analysis.before(card);
    const body = card.querySelector('#artifact-forge-body');
    let collapsed = true;
    try { collapsed = localStorage.getItem(COLLAPSE_KEY) !== '0'; } catch (_) {}
    setCollapsed(card, body, collapsed);
    card.querySelector('.dongfu-collapse-head').onclick = () => { setCollapsed(card, body, !body.hidden); if (!body.hidden) renderForge(); };
    card.addEventListener('click', (event) => {
      const craft = event.target.closest('[data-artifact-craft]');
      const equip = event.target.closest('[data-artifact-equip]');
      const use = event.target.closest('[data-artifact-use]');
      if (craft) craftArtifact(craft.dataset.artifactCraft).catch((error) => toast(window.xiuxianSafeActionError?.('舊煉器', error, '煉器未完成，請稍後再試。') || '煉器未完成，請稍後再試。'));
      else if (equip) toggleEquipArtifact(equip.dataset.artifactEquip).catch((error) => toast(window.xiuxianSafeActionError?.('法寶裝備', error, '裝備未完成，請稍後再試。') || '裝備未完成，請稍後再試。'));
      else if (use) activateTimedArtifact(use.dataset.artifactUse).catch((error) => toast(window.xiuxianSafeActionError?.('法寶催動', error, '法寶催動未完成，請稍後再試。') || '法寶催動未完成，請稍後再試。'));
    });
    renderForge();
  }
  function renderForge() {
    renderQueued = false;
    const content = document.getElementById('artifact-forge-content');
    if (!content) return;
    const data = userData();
    const gold = Math.max(0, Number(data?.stats?.gold) || 0);
    const equippedCount = Object.keys(state().equipped).length;
    const activeCount = activeBuffs().length;
    content.innerHTML = `<div class="artifact-forge-summary"><div><span>目前境界</span><b>${escapeHtml(currentRealm().name)}</b></div><div><span>金幣</span><b>${gold.toLocaleString()}</b></div><div><span>已裝備／限時效果</span><b>${equippedCount} ／ ${activeCount}</b></div></div><p class="artifact-forge-note">所有境界的修士都能裝備任何境界的裝備型法寶；只需要持有法寶並使用對應的四個裝備欄位。法寶境界僅代表品質與生成數值範圍。法寶資料全部來自 <code>artifact-catalog.js</code>，新增清單項目後會自動出現在這裡。</p><div class="artifact-list">${ARTIFACT_CATALOG.map(forgeItemMarkup).join('')}</div>`;
  }
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { mountForge(); renderForge(); });
  }

  async function pruneExpiredBuffs() {
    const s = state();
    const now = Date.now();
    if (!Object.values(s.buffs).some((buff) => Number(buff.expiresAt) <= now)) return;
    try {
      await updateArtifactSystem((next) => {
        Object.keys(next.buffs).forEach((key) => { if (Number(next.buffs[key]?.expiresAt) <= now) delete next.buffs[key]; });
      });
    } catch (error) { console.warn('[Artifact] expired buff cleanup skipped', error); }
  }
  async function enforceEquipmentEligibility() {
    if (eligibilityBusy) return;
    const rawEquipped = userData()?.[FIELD]?.equipped || {};
    const invalidSlots = Object.entries(rawEquipped).filter(([slot, id]) => {
      const item = getArtifactById(id);
      return !ARTIFACT_EQUIP_SLOTS.includes(slot) ||
        !item ||
        canonicalEquipSlot(item) !== slot ||
        quantity(id) <= 0;
    }).map(([slot]) => slot);
    if (!invalidSlots.length) return;
    eligibilityBusy = true;
    try {
      await updateArtifactSystem((next) => invalidSlots.forEach((slot) => delete next.equipped[slot]));
      toast('已清除不存在、未持有或欄位不符的裝備。');
    } catch (error) { console.warn('[Artifact] equipment eligibility sync failed', error); }
    finally { eligibilityBusy = false; }
  }

  window.getArtifactCatalog = () => ARTIFACT_CATALOG;
  window.getArtifactSystemState = state;
  window.getArtifactCombatModifiers = combatModifiers;
  window.getArtifactEquipmentSlots = () => ARTIFACT_EQUIP_SLOTS.slice();
  window.getArtifactEquipmentStatus = (itemId) => clonePlain(equipmentStatus(itemId));
  window.craftArtifact = craftArtifact;
  window.toggleEquipArtifact = toggleEquipArtifact;
  window.useArtifact = activateTimedArtifact;
  window.openArtifactForge = function () {
    mountForge();
    window.switchToPage?.('page-settings');
    const card = document.getElementById('artifact-forge-card');
    const body = document.getElementById('artifact-forge-body');
    if (card && body) {
      setCollapsed(card, body, false);
      renderForge();
      card.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }
  };

  function validateCatalog() {
    const seen = new Set();
    ARTIFACT_CATALOG.forEach((item) => {
      if (!item?.id || seen.has(item.id)) console.error('[Artifact catalog] id 缺少或重複:', item?.id);
      seen.add(item.id);
      if (!ARTIFACT_REALMS.some((realm) => realm.name === item.realm)) console.error('[Artifact catalog] 未知境界:', item.id, item.realm);
      (item.effects || []).forEach((effect) => {
        if (!SUPPORTED_EFFECTS.has(effect.type)) console.warn('[Artifact catalog] 尚未支援的 effect.type:', item.id, effect.type);
      });
    });
  }

  function boot() {
    validateCatalog();
    ensureStyle();
    mountForge();
    installCombatWrapper();
    scheduleRender();
    syncQuestionTools();
    enforceEquipmentEligibility();

    window.addEventListener('artifact-system-updated', scheduleRender);
    window.addEventListener('artifact-catalog-updated', () => { scheduleRender(); enforceEquipmentEligibility(); });
    window.addEventListener('xiuxian:stats-updated', () => { scheduleRender(); enforceEquipmentEligibility(); });
    window.addEventListener('combat-stats-ready', installCombatWrapper);
    window.addEventListener('dongfu:settings-collapsible-ready', mountForge);
    window.addEventListener('xiuxian:user-ready', () => { mountForge(); installCombatWrapper(); scheduleRender(); });

    new MutationObserver(() => { mountForge(); syncQuestionTools(); installCombatWrapper(); }).observe(document.body, { childList: true, subtree: true });
    setInterval(() => {
      installCombatWrapper();
      syncQuestionTools();
      pruneExpiredBuffs();
      enforceEquipmentEligibility();
      if (!document.getElementById('artifact-forge-body')?.hidden) renderForge();
    }, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
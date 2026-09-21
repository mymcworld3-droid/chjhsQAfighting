import { ARTIFACT_EQUIP_SLOTS, getArtifactById, realmOrderByName } from './artifact-catalog.js';

// 戰力是獨立展示用的綜合評分，不參與傷害、配對或勝負判定。
// 金丹只按目前調御的品級給分；法寶按境界品質與裝備特性給分。
// 不使用背包內未裝備法寶，也不把裝備提供的攻擊／生命重複計入角色基礎值。
const CORE_LOWEST_POWER = 4000;
const CORE_GRADE_STEP = 2000;

const EFFECT_WEIGHTS = Object.freeze({
  equip_attack_flat: 1.5,
  equip_attack_percent: 600,
  equip_hp_flat: 0.3,
  equip_hp_percent: 400,
  equip_damage_percent: 900,
  equip_damage_reduction_flat: 1,
  equip_damage_reduction_percent: 650,
  equip_crit_chance: 700,
  equip_crit_damage_percent: 300,
  equip_combo_chance: 1500,
  equip_lifesteal_percent: 400,
  equip_reflect_percent: 400,
  equip_shield_flat: 0.3,
  equip_true_damage_flat: 2,
  equip_low_hp_damage_percent: 350,
  equip_low_hp_reduction_percent: 250,
  equip_first_hit_reduction_percent: 250,
  equip_damage_cap_percent: -500,
  equip_on_correct_shield_flat: 0.3,
  equip_cheat_death: 500,
  equip_copy_enemy_artifact: 400
});

const EFFECT_LIMITS = Object.freeze({
  equip_attack_flat: 100000,
  equip_attack_percent: 5,
  equip_hp_flat: 100000,
  equip_hp_percent: 5,
  equip_damage_percent: 3,
  equip_damage_reduction_flat: 100000,
  equip_damage_reduction_percent: 0.9,
  equip_crit_chance: 0.75,
  equip_crit_damage_percent: 3,
  equip_combo_chance: 0.1,
  equip_lifesteal_percent: 0.5,
  equip_reflect_percent: 1,
  equip_shield_flat: 100000,
  equip_true_damage_flat: 100000,
  equip_low_hp_damage_percent: 2,
  equip_low_hp_reduction_percent: 0.9,
  equip_first_hit_reduction_percent: 0.9,
  equip_on_correct_shield_flat: 100000
});

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const positive = (value) => Math.max(0, finite(value));

export function calculateGoldenCorePower(core) {
  if (!core || core.equipped === false || !core.type) return 0;
  const grade = Math.max(1, Math.min(9, Math.floor(finite(core.grade, 9))));
  return CORE_LOWEST_POWER + (9 - grade) * CORE_GRADE_STEP;
}

export function calculateArtifactPower(item) {
  if (!item || !Array.isArray(item.effects)) return 0;
  const effects = item.effects.filter((effect) => Object.prototype.hasOwnProperty.call(EFFECT_WEIGHTS, effect?.type));
  // Consumables, recipes and non-equipment artifacts have no passive combat power.
  if (!effects.length) return 0;
  const realm = Math.max(0, Math.floor(finite(realmOrderByName(item.realm))));
  const realmPower = 45 * (realm + 1) ** 2;
  const effectsPower = effects.reduce((sum, effect) => {
    const type = effect.type;
    if (type === 'equip_damage_cap_percent') {
      return sum + Math.round((1 - Math.max(0.05, Math.min(1, finite(effect.value, 1)))) * 500);
    }
    if (type === 'equip_cheat_death' || type === 'equip_copy_enemy_artifact') return sum + EFFECT_WEIGHTS[type];
    const value = Math.min(positive(effect.value), EFFECT_LIMITS[type] ?? 100000);
    return sum + Math.round(value * EFFECT_WEIGHTS[type]);
  }, 0);
  return Math.max(0, Math.round(realmPower + effectsPower));
}

export function calculateCombatPower({ stats = {}, core = null, equipped = {}, inventory = {}, getArtifact = getArtifactById } = {}) {
  const attack = positive(stats.attack ?? 200);
  const maxHp = Math.max(1, finite(stats.maxHp, 1000));
  const base = Math.round(attack * 2 + maxHp * 0.2);
  const corePower = calculateGoldenCorePower(core);
  const items = ARTIFACT_EQUIP_SLOTS.map((slot) => {
    const itemId = String(equipped?.[slot] || '');
    if (!itemId || positive(inventory?.[itemId]) < 1) return null;
    const item = getArtifact(itemId);
    // The official equipment system requires an item to belong to this exact slot.
    const itemSlot = ARTIFACT_EQUIP_SLOTS.includes(item?.equipSlot) ? item.equipSlot : '輔助法寶';
    if (itemSlot !== slot) return null;
    const power = calculateArtifactPower(item);
    return power > 0 ? { slot, id: itemId, name: String(item.name || '未命名法寶'), realm: String(item.realm || '凡人'), power } : null;
  }).filter(Boolean);
  const equipment = items.reduce((total, item) => total + item.power, 0);
  return { total: base + corePower + equipment, base, core: corePower, equipment, items };
}

export function getCurrentCombatPower() {
  const data = window.getCurrentUserData?.() || {};
  const core = window.getEquippedGoldenCoreBattleSnapshot?.() || null;
  const system = data.artifactSystem || {};
  return calculateCombatPower({
    stats: data.stats || {}, core,
    equipped: system.equipped || {}, inventory: system.inventory || {}
  });
}

window.calculateGoldenCorePower = calculateGoldenCorePower;
window.calculateArtifactPower = calculateArtifactPower;
window.calculateCombatPower = calculateCombatPower;
window.getCombatPower = getCurrentCombatPower;

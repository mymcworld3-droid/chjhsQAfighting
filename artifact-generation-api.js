'use strict';

const aiRouter = require('./ai-router');

const ALLOWED_EFFECTS = new Set([
  'equip_attack_flat','equip_attack_percent','equip_hp_flat','equip_hp_percent',
  'equip_damage_percent','equip_damage_reduction_flat','equip_damage_reduction_percent',
  'equip_crit_chance','equip_crit_damage_percent','equip_combo_chance',
  'equip_lifesteal_percent','equip_reflect_percent','equip_shield_flat',
  'equip_true_damage_flat','equip_low_hp_damage_percent','equip_low_hp_reduction_percent',
  'equip_first_hit_reduction_percent','equip_damage_cap_percent',
  'equip_on_correct_shield_flat','equip_cheat_death','equip_copy_enemy_artifact',
  'timed_attack_multiplier','timed_cultivation_multiplier','remove_wrong_option'
]);
const EQUIP_SLOTS = ['本命法寶','護身法寶','佩飾法寶','輔助法寶'];
const FORGE_METHODS = Object.freeze(['自由發揮','劍道鍛造','護體鑄造','符籙煉製','陣法刻印']);
const WEAPON_FORMS = Object.freeze(['劍','刀','槍','弓','斧','錘','戟','棍','鞭','匕首','飛劍','法盾','法杖','符籙','陣盤','寶珠','玉佩','法鏡','鈴','幡','印','鼎','鐘','器胚','其他']);
const METHOD_FORMS = Object.freeze({ 劍道鍛造:'劍', 護體鑄造:'法盾', 符籙煉製:'符籙', 陣法刻印:'陣盤' });
function normalizeForgeMethod(value) {
  return FORGE_METHODS.includes(value) ? value : '自由發揮';
}
function lockedWeaponForm(payload = {}) {
  const { primary } = ingredientHierarchy(payload);
  // A deep artifact's existing shape takes priority over a newly selected style.
  const prior = primary.find((item) => item.type === 'artifact' && WEAPON_FORMS.includes(item.weaponForm));
  const prepared = primary.find((item) => item.type === 'material' && WEAPON_FORMS.includes(item.weaponForm));
  return prior?.weaponForm || prepared?.weaponForm || METHOD_FORMS[normalizeForgeMethod(payload.forgeMethod)] || '';
}
const REALMS = ['凡人','煉氣','築基','金丹','元嬰','化神','煉虛','合體','大乘','渡劫','真仙'];

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value)));
}
function cleanText(value, max = 120) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
}
function realmOrder(realm) {
  const index = REALMS.indexOf(String(realm || ''));
  return index < 0 ? 0 : index;
}
function maxEffectsForRealm(order) {
  return order >= 7 ? 3 : order >= 3 ? 2 : 1;
}

function normalizeRefinementStage(value) {
  return Math.max(1, Math.min(3, Math.floor(finite(value, 1))));
}

function deriveRefinementStage(payload = {}) {
  const selected = Array.isArray(payload.selectedIngredients) ? payload.selectedIngredients.slice(0, 8) : [];
  const existingArtifacts = Array.isArray(payload.existingArtifacts) ? payload.existingArtifacts : [];
  const artifactById = new Map(existingArtifacts.map((item) => [String(item?.id || ''), item]));
  let stage = 1;

  for (const row of selected) {
    if (row?.type !== 'artifact') continue;
    const trusted = artifactById.get(String(row?.id || '').trim());
    if (!trusted) continue;
    const sourceDepth = Math.max(0, Math.min(2, Math.floor(finite(trusted.refinementDepth, 0))));
    stage = Math.max(stage, Math.min(3, sourceDepth + 2));
  }
  return stage;
}

function powerScaleForStage(stage) {
  return ({ 1: 0.40, 2: 0.72, 3: 1.00 })[normalizeRefinementStage(stage)] || 0.40;
}

function maxEffectsForGeneration(order, stage) {
  const normalizedStage = normalizeRefinementStage(stage);
  const realmMax = maxEffectsForRealm(order);
  if (normalizedStage === 1) return 1;
  if (normalizedStage === 2) return Math.min(2, Math.max(1, realmMax));
  return Math.min(3, Math.max(2, realmMax));
}

function effectAllowedForStage(type, stage) {
  const normalizedStage = normalizeRefinementStage(stage);
  if (normalizedStage === 1) {
    return !['equip_cheat_death','equip_copy_enemy_artifact','equip_damage_cap_percent','remove_wrong_option'].includes(type);
  }
  if (normalizedStage === 2 && type === 'equip_copy_enemy_artifact') return false;
  return true;
}

function deriveTargetRealm(payload = {}) {
  const selected = Array.isArray(payload.selectedIngredients) ? payload.selectedIngredients.slice(0, 8) : [];
  const allMaterials = Array.isArray(payload.allMaterials) ? payload.allMaterials : [];
  const existingArtifacts = Array.isArray(payload.existingArtifacts) ? payload.existingArtifacts : [];
  const materialById = new Map(allMaterials.map((item) => [String(item?.id || ''), item]));
  const artifactById = new Map(existingArtifacts.map((item) => [String(item?.id || ''), item]));

  let best = '煉氣';
  let bestOrder = 1;
  for (const row of selected) {
    const type = row?.type === 'artifact' ? 'artifact' : 'material';
    const id = String(row?.id || '').trim();
    const trusted = type === 'artifact' ? artifactById.get(id) : materialById.get(id);
    if (!trusted) throw new Error(`未知的${type === 'artifact' ? '法寶' : '材料'}素材：${id || '空白'}`);
    const realm = REALMS.includes(trusted.realm) ? trusted.realm : '凡人';
    const order = realmOrder(realm);
    if (order > bestOrder) {
      best = realm;
      bestOrder = order;
    }
  }
  return best;
}
function minRealmForEffect(type) {
  return ({
    equip_cheat_death: 5,
    equip_copy_enemy_artifact: 6,
    equip_damage_cap_percent: 4,
    equip_combo_chance: 2,
    equip_lifesteal_percent: 2,
    equip_reflect_percent: 2
  })[type] || 0;
}
// This is the single source of truth for the AI's per-realm, per-refinement
// numeric bounds. The same ranges are used when validating the AI's response.
// Percentages are stored as fractions (0.10 = 10%). Unlike other values,
// equip_damage_cap_percent gets STRONGER as its number becomes SMALLER.
const EFFECT_LABELS = Object.freeze({
  equip_attack_flat:'固定攻擊',
  equip_attack_percent:'百分比攻擊',
  equip_hp_flat:'固定生命',
  equip_hp_percent:'百分比生命',
  equip_damage_percent:'百分比增傷',
  equip_damage_reduction_flat:'固定減傷',
  equip_damage_reduction_percent:'百分比減傷',
  equip_crit_chance:'暴擊率',
  equip_crit_damage_percent:'暴擊增傷',
  equip_combo_chance:'連擊率',
  equip_lifesteal_percent:'吸血',
  equip_reflect_percent:'反傷',
  equip_shield_flat:'開場護盾',
  equip_true_damage_flat:'固定真實傷害',
  equip_low_hp_damage_percent:'低血增傷',
  equip_low_hp_reduction_percent:'低血減傷',
  equip_first_hit_reduction_percent:'首次受傷減免',
  equip_damage_cap_percent:'單次生命傷害上限',
  equip_on_correct_shield_flat:'答對獲盾',
  equip_cheat_death:'一次保命',
  equip_copy_enemy_artifact:'鏡映敵方法寶',
  timed_attack_multiplier:'限時攻擊倍率',
  timed_cultivation_multiplier:'限時修為倍率',
  remove_wrong_option:'排除錯誤選項'
});
const FLAT_VALUE_TYPES = new Set([
  'equip_attack_flat', 'equip_hp_flat', 'equip_damage_reduction_flat',
  'equip_shield_flat', 'equip_true_damage_flat', 'equip_on_correct_shield_flat'
]);
function roundRange(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}
// Legacy V1 is accepted for historical unit tests, but new administrator edits
// use the simpler V2 scheme: refinement depth -> effect -> one global min/max.
const HARD_EFFECT_CAPS = Object.freeze({
  equip_attack_percent:5, equip_hp_percent:5, equip_damage_percent:3,
  equip_damage_reduction_percent:0.8, equip_crit_chance:0.75, equip_crit_damage_percent:3,
  equip_combo_chance:0.10, equip_lifesteal_percent:0.5, equip_reflect_percent:1,
  equip_low_hp_damage_percent:2, equip_low_hp_reduction_percent:0.8,
  equip_first_hit_reduction_percent:0.9, equip_damage_cap_percent:1
});
function normalizeEffectBounds(raw) {
  if (raw == null) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('法寶效果上下限格式錯誤');
  const result = {};
  for (const [realm, stages] of Object.entries(raw)) {
    if (!REALMS.includes(realm) || !stages || typeof stages !== 'object' || Array.isArray(stages)) throw new Error('未知的法寶境界設定');
    for (const [stageKey, effects] of Object.entries(stages)) {
      const stage = Number(stageKey);
      if (![1, 2, 3].includes(stage) || !effects || typeof effects !== 'object' || Array.isArray(effects)) throw new Error('未知的煉器階段設定');
      for (const [type, values] of Object.entries(effects)) {
        const defaults = effectRange(type, realmOrder(realm), stage);
        if (!defaults || !['value', 'multiplier'].includes(defaults.field)) throw new Error('此境界與階段不允許設定效果：' + type);
        if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('效果上下限格式錯誤：' + type);
        const keys = defaults.field === 'multiplier'
          ? ['min','max','durationMinutesMin','durationMinutesMax'] : ['min','max'];
        if (Object.keys(values).some(key => !keys.includes(key))) throw new Error('不支援的法寶上下限欄位：' + type);
        if (keys.some(key => values[key] === undefined || values[key] === null || values[key] === '' || !Number.isFinite(Number(values[key])))) throw new Error('請填寫完整的有限數值：' + type);
        const bounds = Object.fromEntries(keys.map(key => [key, Number(values[key])]));
        const integer = FLAT_VALUE_TYPES.has(type);
        const lower = type === 'equip_damage_cap_percent' ? 0.05 : (defaults.field === 'multiplier' ? 1.01 : (integer ? 1 : 0.0001));
        const hardCaps = { equip_attack_percent:5, equip_hp_percent:5, equip_damage_percent:3,
          equip_damage_reduction_percent:0.8, equip_crit_chance:0.75, equip_crit_damage_percent:3,
          equip_combo_chance:0.10, equip_lifesteal_percent:0.5, equip_reflect_percent:1,
          equip_low_hp_damage_percent:2, equip_low_hp_reduction_percent:0.8,
          equip_first_hit_reduction_percent:0.9, equip_damage_cap_percent:1 };
        const upper = integer ? 1000000 : defaults.field === 'multiplier' ? 5 : hardCaps[type] ?? 1;
        if (bounds.min < lower || bounds.max > upper || bounds.min > bounds.max ||
            (integer && (!Number.isInteger(bounds.min) || !Number.isInteger(bounds.max)))) {
          throw new Error(type + ' 上下限不合法（允許 ' + lower + '～' + upper + '）');
        }
        if (defaults.field === 'multiplier' &&
            (bounds.durationMinutesMin < 0.02 || bounds.durationMinutesMax > 1440 ||
             bounds.durationMinutesMin > bounds.durationMinutesMax)) {
          throw new Error(type + ' 持續分鐘範圍不合法（0.02～1440 分鐘）');
        }
        ((result[realm] ||= {})[stageKey] ||= {})[type] = bounds;
      }
    }
  }
  return result;
}

// Each of the twelve equal intervals includes both endpoints. For realm
// rank r (Qi=1...Immortal=10), select intervals r through r+2.
// An inverse effect, damage cap, is mapped in reverse because lower is stronger.
// Existing two-to-eight-slot refinery: every ingredient above three adds 5%.
// Defaults to three when there is no recipe context (e.g. admin depth preview).
function ingredientCountMultiplier(count = 3) {
  const n = Number(count);
  const total = Number.isFinite(n) ? Math.max(2, Math.min(8, Math.floor(n))) : 3;
  return roundRange(1 + (total - 3) * 0.05, 2);
}
function ingredientTotal(selected = []) {
  return Array.isArray(selected) && selected.length
    ? selected.reduce((sum, row) => sum + Math.max(1, Math.floor(finite(row?.quantity, 1))), 0)
    : 3;
}
function scaleIngredientRange(range, count = 3) {
  const multiplier = ingredientCountMultiplier(count);
  if (multiplier === 1 || !['value', 'multiplier'].includes(range?.field)) return range;
  const integer = FLAT_VALUE_TYPES.has(range.type);
  const floor = range.type === 'equip_damage_cap_percent' ? 0.05 :
    range.field === 'multiplier' ? 1.01 : integer ? 1 : 0.0001;
  const cap = integer ? 1000000 : range.field === 'multiplier' ? 5 : HARD_EFFECT_CAPS[range.type] ?? 1;
  // The damage cap is inverse: a lower cap is stronger, so extra materials must lower it.
  const strengthMultiplier = range.type === 'equip_damage_cap_percent' ? 1 / multiplier : multiplier;
  const low = clamp(Number(range.min) * strengthMultiplier, floor, cap);
  const high = clamp(Number(range.max) * strengthMultiplier, floor, cap);
  const min = integer ? Math.ceil(low - 1e-9) : roundRange(low);
  const max = integer ? Math.max(min, Math.floor(high + 1e-9)) : Math.max(min, roundRange(high));
  // Time duration is not effect strength; the ingredient factor does not change it.
  return { ...range, min, max };
}
function realmSlice(bounds, order, inverse = false, integer = false) {
  const low = Number(bounds.min);
  const high = Number(bounds.max);
  const step = (high - low) / 12;
  const start = inverse ? 10 - order : order - 1;
  const end = start + 3;
  const lower = low + start * step;
  const upper = low + end * step;
  if (integer) {
    const min = Math.ceil(lower - 1e-9);
    return { min, max:Math.max(min, Math.floor(upper + 1e-9)) };
  }
  return { min:roundRange(lower), max:roundRange(upper) };
}

// The default editable depth-wide bounds are taken from the weakest eligible
// realm and the highest realm's previous hard cap. No stored config is needed.
function defaultDepthEffectRanges(stage = 1) {
  return [...ALLOWED_EFFECTS].map((type) => {
    const lowest = Math.max(1, minRealmForEffect(type));
    const low = effectRange(type, lowest, stage, {}, true);
    const high = effectRange(type, 10, stage, {}, true);
    if (!low || !high) return null;
    if (!['value', 'multiplier'].includes(high.field)) return { ...high };
    const inverse = type === 'equip_damage_cap_percent';
    const result = { ...high, min:inverse ? high.min : low.min,
      max:inverse ? low.max : high.max };
    if (high.field === 'multiplier') {
      result.durationMinutesMin = low.durationMinutesMin;
      result.durationMinutesMax = high.durationMinutesMax;
    }
    return result;
  }).filter(Boolean);
}

function normalizeDepthEffectBounds(raw) {
  if (raw == null) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('深度數值上下限格式錯誤');
  const result = {};
  for (const [stageKey, effects] of Object.entries(raw)) {
    if (!['1','2','3'].includes(stageKey) || !effects || typeof effects !== 'object' || Array.isArray(effects))
      throw new Error('未知的煉製深度設定');
    const defaults = new Map(defaultDepthEffectRanges(Number(stageKey)).map(row => [row.type, row]));
    for (const [type, values] of Object.entries(effects)) {
      const range = defaults.get(type);
      if (!range || !['value','multiplier'].includes(range.field))
        throw new Error('此深度不可修改的法寶功能：' + type);
      const keys = range.field === 'multiplier'
        ? ['min','max','durationMinutesMin','durationMinutesMax'] : ['min','max'];
      if (!values || typeof values !== 'object' || Array.isArray(values) ||
          Object.keys(values).some(key => !keys.includes(key)) ||
          keys.some(key => values[key] == null || values[key] === '' || !Number.isFinite(Number(values[key]))))
        throw new Error(type + ' 深度上下限須填完整有效數值');
      const bounds = Object.fromEntries(keys.map(key => [key, Number(values[key])]));
      const integer = FLAT_VALUE_TYPES.has(type);
      const floor = type === 'equip_damage_cap_percent' ? 0.05 :
        range.field === 'multiplier' ? 1.01 : integer ? 1 : 0.0001;
      const cap = integer ? 1000000 : range.field === 'multiplier' ? 5 : HARD_EFFECT_CAPS[type] ?? 1;
      if (bounds.min < floor || bounds.max > cap || bounds.min > bounds.max ||
          (integer && (!Number.isInteger(bounds.min) || !Number.isInteger(bounds.max)))) {
        throw new Error(type + ' 深度上下限不合法（允許 ' + floor + '～' + cap + '）');
      }
      if (range.field === 'multiplier' &&
          (bounds.durationMinutesMin < 0.02 || bounds.durationMinutesMax > 1440 ||
           bounds.durationMinutesMin > bounds.durationMinutesMax)) {
        throw new Error(type + ' 持續時間上下限不合法');
      }
      (result[stageKey] ||= {})[type] = bounds;
    }
  }
  return result;
}

function effectRange(type, order, stage = 1, effectBoundsV1 = {}, rawDefault = false, effectBoundsV2 = {}, ingredientCount = 3) {
  if (!ALLOWED_EFFECTS.has(type) ||
      order < minRealmForEffect(type) ||
      !effectAllowedForStage(type, stage)) return null;
  const override = effectBoundsV1?.[REALMS[order]]?.[String(normalizeRefinementStage(stage))]?.[type];
  const scale = powerScaleForStage(stage);
  const capByType = {
    equip_attack_flat: 35 + order * 35,
    equip_hp_flat: 160 + order * 180,
    equip_damage_reduction_flat: 20 + order * 18,
    equip_shield_flat: 100 + order * 100,
    equip_true_damage_flat: 15 + order * 18,
    equip_on_correct_shield_flat: 45 + order * 45,
    equip_attack_percent: 0.06 + order * 0.025,
    equip_hp_percent: 0.07 + order * 0.025,
    equip_damage_percent: 0.05 + order * 0.02,
    equip_damage_reduction_percent: 0.04 + order * 0.015,
    equip_crit_chance: 0.025 + order * 0.007,
    equip_crit_damage_percent: 0.15 + order * 0.045,
    equip_combo_chance: Math.min(0.10, 0.02 + order * 0.005),
    equip_lifesteal_percent: 0.03 + order * 0.012,
    equip_reflect_percent: 0.04 + order * 0.015,
    equip_low_hp_damage_percent: 0.10 + order * 0.03,
    equip_low_hp_reduction_percent: 0.08 + order * 0.02,
    equip_first_hit_reduction_percent: 0.15 + order * 0.035,
    equip_damage_cap_percent: Math.max(0.22, 0.55 - order * 0.025)
  };
  const label = EFFECT_LABELS[type];
  if (type === 'equip_cheat_death' || type === 'equip_copy_enemy_artifact') {
    return { type, label, field:'none', min:null, max:null, unit:'每場固定一次',
      note: type === 'equip_cheat_death' ? '致命傷保留 1 HP' : '複製敵方一項可複製的戰鬥效果' };
  }
  if (type === 'remove_wrong_option') {
    return { type, label, field:'perQuestion', min:1, max:1, unit:'個錯誤選項/題',
      note:'問道、鬥法、洞天每題至多移除一個錯項' };
  }
  if (!rawDefault && order >= 1) {
    const global = defaultDepthEffectRanges(stage).find(row => row.type === type);
    if (global && (global.field === 'value' || global.field === 'multiplier')) {
      const depth = effectBoundsV2?.[String(normalizeRefinementStage(stage))]?.[type] || global;
      const inverse = type === 'equip_damage_cap_percent';
      const numeric = realmSlice(depth, order, inverse, FLAT_VALUE_TYPES.has(type));
      const chosen = override || numeric;
      const output = { ...global, min:chosen.min, max:chosen.max };
      if (global.field === 'multiplier') {
        const duration = realmSlice({
          min:depth.durationMinutesMin, max:depth.durationMinutesMax
        }, order);
        output.durationMinutesMin = override?.durationMinutesMin ?? duration.min;
        output.durationMinutesMax = override?.durationMinutesMax ?? duration.max;
      }
      return scaleIngredientRange(output, ingredientCount);
    }
  }
  if (type === 'timed_attack_multiplier' || type === 'timed_cultivation_multiplier') {
    const fullMax = 1.35 + order * 0.06;
    const bonus = (fullMax - 1) * scale;
    const fullDuration = 5 + order * 2;
    const maxMinutes = Math.max(2, fullDuration * (0.55 + 0.45 * scale));
    return { type, label, field:'multiplier',
      min:override?.min ?? roundRange(1 + bonus * 0.35), max:override?.max ?? roundRange(1 + bonus),
      unit:'倍', durationMinutesMin:override?.durationMinutesMin ?? 2,
      durationMinutesMax:override?.durationMinutesMax ?? roundRange(maxMinutes, 2),
      note:'同時填入 multiplier 與 durationMinutes，催動後消耗一件' };
  }
  if (type === 'equip_damage_cap_percent') {
    const base = capByType[type];
    const min = roundRange(base + (0.80 - base) * (1 - scale));
    return { type, label, field:'value', min:override?.min ?? min,
      max:override?.max ?? roundRange(Math.min(0.80, min + 0.12)),
      unit:'最大生命比例', note:'越小越強；0.35 表示單次生命傷害至多 35%' };
  }
  const fullCap = capByType[type];
  if (!Number.isFinite(fullCap)) throw new Error(`效果未設定境界數值表：${type}`);
  const scaledMax = fullCap * scale;
  const integer = FLAT_VALUE_TYPES.has(type);
  const min = integer ? Math.max(1, Math.ceil(scaledMax * 0.35)) : roundRange(scaledMax * 0.35);
  const max = integer ? Math.max(min, Math.floor(scaledMax)) : roundRange(scaledMax);
  return { type, label, field:'value', min:override?.min ?? min,
    max:override?.max ?? max, unit:integer ? '點' : '比例',
    note:integer ? '使用整數' : '0.10 代表 10%' };
}
function effectRangesForRealm(realm, stage = 1, effectBoundsV1 = {}, effectBoundsV2 = {}, ingredientCount = 3) {
  const order = realmOrder(realm);
  if (order < 1) return [];
  return [...ALLOWED_EFFECTS].map((type) => effectRange(type, order, stage, effectBoundsV1, false, effectBoundsV2, ingredientCount)).filter(Boolean);
}
function sanitizeValue(type, value, order, stage = 1, effectBoundsV1 = {}, effectBoundsV2 = {}, ingredientCount = 3) {
  const range = effectRange(type, order, stage, effectBoundsV1, false, effectBoundsV2, ingredientCount);
  if (!range || range.field !== 'value') return null;
  const proposed = Number(value);
  const chosen = Number.isFinite(proposed) ? proposed : (range.min + range.max) / 2;
  const bounded = clamp(chosen, range.min, range.max);
  return FLAT_VALUE_TYPES.has(type) ? Math.round(bounded) : roundRange(bounded);
}
function sanitizeEffect(raw, order, stage = 1, effectBoundsV1 = {}, effectBoundsV2 = {}, ingredientCount = 3) {
  const type = cleanText(raw?.type, 64);
  const range = effectRange(type, order, stage, effectBoundsV1, false, effectBoundsV2, ingredientCount);
  if (!range) return null;
  const out = { type };
  if (range.field === 'value') {
    out.value = sanitizeValue(type, raw?.value, order, stage, effectBoundsV1, effectBoundsV2, ingredientCount);
  } else if (range.field === 'multiplier') {
    const proposed = Number(raw?.multiplier);
    out.multiplier = roundRange(clamp(
      Number.isFinite(proposed) ? proposed : (range.min + range.max) / 2,
      range.min, range.max
    ));
    const minutes = Number(raw?.durationMinutes);
    const duration = clamp(
      Number.isFinite(minutes) ? minutes : range.durationMinutesMax,
      range.durationMinutesMin, range.durationMinutesMax
    );
    out.durationMs = Math.round(duration * 60000);
  } else if (type === 'remove_wrong_option') {
    out.contexts = ['quiz','battle','dongtian'];
    out.perQuestion = 1;
  }
  return out;
}

function sanitizeGeneratedArtifact(raw, targetRealm, refinementStage = 1, effectBoundsV1 = {}, effectBoundsV2 = {}, ingredientCount = 3, options = {}) {
  const realm = REALMS.includes(targetRealm) && targetRealm !== '凡人' ? targetRealm : '煉氣';
  const order = realmOrder(realm);
  const stage = normalizeRefinementStage(refinementStage);
  const requested = Array.isArray(raw?.effects) ? raw.effects.map((e) => sanitizeEffect(e, order, stage, effectBoundsV1, effectBoundsV2, ingredientCount)).filter(Boolean) : [];
  const wantsEquip = requested.some((effect) => effect.type.startsWith('equip_'));
  let effects = wantsEquip
    ? requested.filter((effect) => effect.type.startsWith('equip_'))
    : requested.filter((effect) => !effect.type.startsWith('equip_'));
  // Never let the model silently erase the deepest artifact's defining effect.
  const primaryArtifacts = Array.isArray(options.primaryArtifacts) ? options.primaryArtifacts : [];
  const inherited = primaryArtifacts.flatMap((item) => Array.isArray(item.effects) ? item.effects : [])
    .map((effect) => sanitizeEffect(effect, order, stage, effectBoundsV1, effectBoundsV2, ingredientCount))
    .filter(Boolean);
  const core = inherited.find((effect) => effect.type.startsWith('equip_')) || inherited[0];
  if (core) {
    effects = effects.filter((effect) => effect.type.startsWith('equip_') === core.type.startsWith('equip_'));
    const already = effects.findIndex((effect) => effect.type === core.type);
    // Preserve the new rolled numeric strength when the same effect is already present.
    if (already < 0) effects.unshift(core);
    else if (already > 0) effects.unshift(effects.splice(already, 1)[0]);
  }
  effects = effects.filter((effect, index, all) => all.findIndex((row) => row.type === effect.type) === index)
    .slice(0, maxEffectsForGeneration(order, stage));

  if (!effects.length) {
    const fallbackRange = effectRange('equip_attack_flat', order, stage, effectBoundsV1, false, effectBoundsV2, ingredientCount);
    effects = [sanitizeEffect({ type: 'equip_attack_flat', value: (fallbackRange.min + fallbackRange.max) / 2 }, order, stage, effectBoundsV1, effectBoundsV2, ingredientCount)].filter(Boolean);
  }

  const equipped = effects.some((effect) => effect.type.startsWith('equip_'));
  const result = {
    name: cleanText(raw?.name, 18) || realm + '無名靈器',
    icon: cleanText(raw?.icon, 4) || '◆',
    realm,
    category: equipped ? '裝備法寶' : '消耗法寶',
    description: cleanText(raw?.description, 180) || '由未知配方自行衍化而成的法寶。',
    effects,
    weaponForm: WEAPON_FORMS.includes(options.weaponForm) ? options.weaponForm :
      (WEAPON_FORMS.includes(raw?.weaponForm) ? raw.weaponForm : '其他'),
    forgeMethod: normalizeForgeMethod(options.forgeMethod),
    coreEffect: core?.type || effects[0]?.type || ''
  };
  if (equipped) {
    const slot = cleanText(raw?.equipSlot, 16);
    result.equipSlot = EQUIP_SLOTS.includes(slot) ? slot : EQUIP_SLOTS[order % EQUIP_SLOTS.length];
  }
  return result;
}

function ingredientHierarchy(payload = {}) {
  const materials = new Map((payload.allMaterials || []).map(item => [String(item.id), item]));
  const artifacts = new Map((payload.existingArtifacts || []).map(item => [String(item.id), item]));
  const ingredients = (payload.selectedIngredients || []).slice(0, 8).map(row => {
    const type = row.type === 'artifact' ? 'artifact' : 'material';
    const id = String(row.id || '').trim();
    const record = (type === 'artifact' ? artifacts : materials).get(id);
    if (!record) throw new Error(`未知煉器素材：${id}`);
    // 原材料為 0；配方深度 0 的第一煉法寶為 1，之後依序增加。
    const depth = type === 'artifact' ? 1 + Math.max(0, Math.min(2, Math.floor(finite(record.refinementDepth)))) : 0;
    return { ...record, id, type, quantity:Math.max(1, Math.floor(finite(row.quantity, 1))), ingredientDepth:depth };
  });
  const deepest = Math.max(0, ...ingredients.map(item => item.ingredientDepth));
  return {
    primary: ingredients.filter(item => item.ingredientDepth === deepest),
    supporting: ingredients.filter(item => item.ingredientDepth < deepest)
  };
}

function buildPrompt(payload) {
  const allMaterials = Array.isArray(payload.allMaterials) ? payload.allMaterials.slice(0, 160) : [];
  const existingArtifacts = Array.isArray(payload.existingArtifacts) ? payload.existingArtifacts.slice(0, 160) : [];
  const adminGenerationDirection = cleanText(payload.adminGenerationDirection, 80);
  const adminGenerationPrompt = cleanText(payload.adminGenerationPrompt, 1200);
  const targetRealm = REALMS.includes(payload.targetRealm) && payload.targetRealm !== '凡人' ? payload.targetRealm : deriveTargetRealm(payload);
  const order = realmOrder(targetRealm);
  const refinementStage = deriveRefinementStage(payload);
  const forgeMethod = normalizeForgeMethod(payload.forgeMethod);
  const fixedForm = lockedWeaponForm(payload);
  const stageDirections = {
    1: [
      '【內部生成規則：第一煉】本次產物應像「木材加工成木棍」：是可繼續加工的器胚、零件、核心、刃胚、握柄、符骨、靈芯、甲片等半成品，而不是完整武器或終極法寶。',
      '第一煉產物必須有一個清楚可感知、但偏弱的功能或特性；重點是留下可供下一次煉器承接的性質，不要一次完成所有用途。',
      '【攻擊型器胚可直接產出】若主素材或管理員要求偏攻擊，優先考慮劍胚、刃胚、槍尖、箭簇、破甲符骨、雷擊核心、炎脈器芯等攻擊性半成品；第一煉就能提供合理的固定攻擊、百分比攻擊、增傷、真傷或暴擊等一項實際效果，不必等到完整武器才有攻擊能力。須依當前境界與階段的允許 type 和數值上下限選擇。',
      '名稱與描述要自然呈現它是一件可繼續加工的實體部件，但不要在文字中說「第一煉」「階段一」「低階產物」或解釋系統規則。'
    ],
    2: [
      '【內部生成規則：第二煉】本次應把前一煉的部件與其他素材整合成一件完整可用的武器、護具、法器或靈寶。',
      '第二煉應有不錯且明確的實戰或修煉功能，並承接投入部件的核心性質；完成度要顯著高於單純零件，但仍保留未來再次精煉、融合更多特性的空間。',
      '承接攻擊型器胚時，優先形成可用的劍、槍、刃、弓、戰符或攻擊法器，保留器胚代表性的攻擊能力；可以在效果數量限制內加入協調的第二特性。',
      '不要在名稱或描述中提到「第二煉」「階段二」「升級層級」等系統資訊。'
    ],
    3: [
      '【內部生成規則：第三煉】本次是三次煉器中完成度最高的一次：把前階成品與新素材的多種特性深度融合成成熟重寶。',
      '第三煉可集結更多彼此協調的特性，效果組合比前兩次更豐富，數值在同境界硬上限內也可更接近上限；但仍不得突破任何平衡規則。',
      '攻擊型前階成品應延續其核心攻擊能力，優先考慮攻擊、增傷、真傷、暴擊、連擊或低血增傷之間合適的組合；勿因再次煉製無故變成完全不同用途的防具。',
      '產物要像真正完成的強力法寶，不要在名稱或描述中提到「第三煉」「最終階段」「層級三」或任何系統內部規則。'
    ]
  };
  const hierarchy = ingredientHierarchy(payload);
  const specifiedWeapon = hierarchy.primary.find((item) =>
    ['劍','刀','槍','弓','斧','錘','戟','棍','鞭','匕首','飛劍'].includes(item.weaponForm));
  const weaponFormRule = specifiedWeapon
    ? '【正式兵器材料例外】本次主材料「' + specifiedWeapon.name + '」已明確設定 weaponForm=' +
      specifiedWeapon.weaponForm + '、weaponName=' + (specifiedWeapon.weaponName || '（未指定）') +
      '。其成品須保持此兵器類型；即使是第一煉，也應直接完成可用的' +
      specifiedWeapon.weaponForm + '類武器，而非只鍛出刃胚、刀柄或核心。承接正式材料故事，' +
      '並給予當前階段允許的實際攻擊效果。若管理員有相容的命名指示，可調整名字但不得更改器型。'
    : '';
  const hiddenStageDirection = stageDirections[refinementStage].join('\n');
  const ingredientCount = ingredientTotal(payload.selectedIngredients);
  const allowedRanges = effectRangesForRealm(targetRealm, refinementStage, {}, payload.effectBoundsV2, ingredientCount);
  const allowedTypes = allowedRanges.map((range) => range.type);
  const hasAdminGuidance = !!(adminGenerationDirection || adminGenerationPrompt);
  // Six of eight ordinary creative directions favor offense (~75% of sampled
  // directions). Ingredient lore and explicit admin instructions take priority.
  const creativeDirections = [
    '鋒銳兵胚：由金鐵、獸骨或利刃意象延伸，優先產出劍胚、刃胚、槍尖等，效果偏固定攻擊、百分比攻擊或真傷。',
    '雷火攻器：結合雷、火與爆發素材，優先產出雷擊核心、炎脈器芯、攻擊法器，效果偏攻擊與增傷。',
    '破陣戰器：偏向破甲、迅擊與穩定輸出，優先保留攻擊型主素材的器型與代表性能力。',
    '星辰殺器：結合星力、虛空與高速攻勢，效果偏增傷、暴擊或真實傷害，但不得虛構未支援效果。',
    '兇烈戰器：名字短而有力，效果偏暴擊、真傷、連擊或低血增傷，但仍符合境界平衡。',
    '精巧飛刃：可發展符刃、箭簇、飛針、短兵或核心，效果偏攻擊、暴擊與靈力輸出。',
    '守御重器：當主素材明確偏防護時，可走護盾、減傷、保命或反震路線。',
    '文雅靈寶：當主素材明確偏悟道、療癒或輔助時，可走修為、護體或節奏型路線。'
  ];
  const creativeDirection = creativeDirections[Math.floor(Math.random() * creativeDirections.length)];
  const methodRule = forgeMethod === '自由發揮'
    ? '未指定煉器手法，依最深主材的用途自由創作。'
    : '本次指定煉器手法：' + forgeMethod + '。除非最深主材已有正式兵器器型，否則必須依手法形成' + (METHOD_FORMS[forgeMethod] || '相容器物') + '。此指定優先於預設攻擊傾向。';
  return [
    '你是修仙世界的「天工器靈」，負責從從未出現過的素材組合中推演新法寶。',
    '請非常有創意，不要只把材料名稱機械拼接。名稱要像真正的修仙法寶，2~8 個中文字為佳；描述要能讓人看出材料之間的意象、性質或衝突如何形成此器。',
    '【預設產出傾向】在沒有管理員特別指示且素材用途允許的情況下，請讓攻擊型法寶占多數（目標約七成至八成），同時保留少量防禦、悟道和輔助法寶。攻擊型不能僅是名字兇猛，effects 至少要有一項實際的攻擊／增傷／真傷／暴擊／連擊／低血增傷等效果；若第一煉則可用較弱的攻擊效果作為器胚核心。這是生成方向而非突破數值、素材故事或管理員要求的藉口。',
    '同一批材料可能蘊含攻擊、防禦、奇術、悟道、護命等方向；攻擊型優先不等於所有成品都固定加攻擊，請依素材性質在合法的攻擊型效果中挑選有辨識度的組合。純防禦、療癒、悟道主材或管理員指定非攻擊方向時，應尊重其核心用途。',
    hasAdminGuidance ? '管理員已有指定方向；不要用隨機風格取代管理員要求。下列創意方向僅在相容時作次要參考：' + creativeDirection : '本次創意方向：' + creativeDirection,
    hiddenStageDirection,
    methodRule,
    fixedForm ? '正式器型已鎖定為「' + fixedForm + '」，不得被隨機方向、名稱或次要素材覆蓋。' : '',
    weaponFormRule,
    '上述煉器階段規則只供你內部生成時使用。輸出的 name、description、icon、effects 不得解釋玩家正在第幾次煉器，也不得出現「深度」「套娃」「生成規則」「階段」等系統詞。',
    '名稱要有辨識度，避免大量使用「玄、天、神、靈」作為固定前綴；可使用器型、異象、典故、動作、自然意象來命名。',
    '描述請像法寶誌異條目：說明它如何由這批素材的性質融合而成，以及使用時會出現什麼具體異象。',
    '【素材內容優先】投入列只有 ID 與數量；下面主從表／投入素材詳表才有正式名稱、境界、分類、詳細說明、背景故事、原法寶效果與煉製深度。逐項閱讀這些內容，先由主材故事、材質特性及用途決定成品核心，再由輔材的記載補足外形或能力，不可只看到名稱就自由猜測。',
    '若 story 有內容，將它視為已設定的世界觀事實，名稱與描述要合理承接其來源、傳說、遭遇或歷史；若 story 為空，僅可根據 description 創作，不要偽稱另有正式背景故事。不要把素材原文直接整段複製到玩家描述。',
    '',
    '硬性規則：',
    '1. 法寶境界已由遊戲鎖定為「' + targetRealm + '」，不得改境界。',
    '2. 只輸出 JSON，不要 Markdown。',
    '3. 效果只能使用下方允許的 type；依本次內部煉器階段與境界，最多 ' + maxEffectsForGeneration(order, refinementStage) + ' 個效果。',
    '4. 每個效果必須使用下方境界＋煉製階段與投入素材數量調整後的 min～max（含上下限），不准填 0、不得突破範圍；百分比一律用小數，例如 0.10 = 10%。連擊上限 0.10。',
    '4d. 本次投入素材總數 ' + ingredientCount + '，數值範圍倍率 ×' + ingredientCountMultiplier(ingredientCount) + '；表內已計入此倍率，請勿再次乘算。',
    '4a. 法寶無修士境界裝備限制：不論玩家境界高低，只要持有裝備型法寶就能裝備；本表的「境界」僅影響法寶效果數值。',
    '4b. 單次生命傷害上限 equip_damage_cap_percent 數值越小代表越強，不要誤選較大數字當成強化。',
    '4c. 限時特性只填 multiplier 和 durationMinutes；每場固定一次的保命／鏡映不填數值；排除錯誤選項每題固定 1 個，不填自訂 value。',
    '5. 若使用任何 equip_ 效果，equipSlot 從：' + EQUIP_SLOTS.join('、') + ' 選一個。',
    '6. 若做消耗型，只使用 timed_attack_multiplier / timed_cultivation_multiplier / remove_wrong_option。',
    '7. 避免與既有法寶名稱、描述、效果組合高度重複。',
    '8. icon 用 1 個中文字或常見符號，避免 emoji 組合。',
    '9. 必須以投入素材中煉製深度最深者為主體：保留其器型、核心意象、主要用途與代表性能力，再由較淺素材補強或賦予次要特性，不得讓輔材取代主體。',
    '9a. 第一煉允許直接生成攻擊型器胚與其實際攻擊效果；禁止誤認器胚只能給防禦或無戰鬥特性。若正式主材料指定 weaponForm，第一煉直接完成對應兵器；第二、三煉承接攻擊型主材時也應保留其攻擊路線。',
    '10. 若有多件同為最深的素材，將它們作為共同主體融合；全為原材料時才自由組合。數量、境界、投入順序、隨機創意方向與管理員風格提示均不得推翻主從關係。效果繼承仍須遵守境界、效果數量及平衡限制。',
    '11. 管理員的額外提示詞與大概動向不是可忽略的隨機風格：逐條落實其中與素材、煉製階段、允許特性及數值範圍相容的要求，包括名稱禁用詞、器型、故事、用途、效果方向及不要使用的特性。若有衝突，只調整衝突部分，其他要求仍須遵守；絕不能單純以預設創意方向推翻。',
    '內部素材主從表（完整圖鑑記錄，優先於投入列自述；勿在玩家描述中提及深度或主從規則）：',
    JSON.stringify(hierarchy, null, 2),
    '',
    '【高優先：管理員指定的大概動向；只受上述硬性規則限制】：',
    adminGenerationDirection || '自由發揮',
    '',
    '【高優先：管理員額外提示詞；逐條遵守可行的創作要求，不得覆蓋境界、數值及效果硬性規則】：',
    adminGenerationPrompt || '（未設定）',
    '',
    '本次投入素材完整設定（不可只有名字；description／story／effects 必須參照）：',
    JSON.stringify([...hierarchy.primary, ...hierarchy.supporting], null, 2),
    '',
    '全材料圖鑑（補充整體世界觀與階序；優先級低於本次實際投入素材的完整設定）：',
    JSON.stringify(allMaterials, null, 2),
    '',
    '既有法寶摘要（用於避免重複）：',
    JSON.stringify(existingArtifacts, null, 2),
    '',
    '本次法寶「' + targetRealm + '」境界與煉製階段 ' + refinementStage + ' 的各特性實際數值上下限（唯一權威表，未列出的效果不得選用）：',
    JSON.stringify(allowedRanges, null, 2),
    '允許效果 type：',
    JSON.stringify(allowedTypes),
    '',
    '輸出前自行核對：成品是否能由主材及其故事推導？是否保留適當原法寶能力？是否遵守管理員每一項可行要求？是否僅使用本階段允許的效果與數值？全部確認後才輸出 JSON。',
    '輸出格式：',
    '{"name":"法寶名","icon":"單字或符號","description":"繁體中文描述","weaponForm":"器型（劍、刀、法盾、符籙、陣盤等）","equipSlot":"本命法寶|護身法寶|佩飾法寶|輔助法寶（若為裝備型）","effects":[{"type":"表中允許效果之一","value":"依該 type 的 value 範圍填數字；無 value 時省略","multiplier":"只有限時類才填","durationMinutes":"只有限時類才填"}]}'
  ].join('\\n');
}

// Admin guidance is optional. Give it a separate, bounded review only when
// explicitly supplied, so ordinary forging keeps its single-call latency.
function buildGuidanceReviewPrompt(payload, artifact, targetRealm, stage) {
  const direction = cleanText(payload.adminGenerationDirection, 80);
  const guidance = cleanText(payload.adminGenerationPrompt, 1200);
  const hierarchy = ingredientHierarchy(payload);
  return [
    '你是煉器品質複核員。檢查成品有無遵守管理員可行的提示詞，以及正式素材的描述和背景故事。',
    '管理員要求若與硬性境界、煉製階段、素材主從、允許效果及數值表衝突，只忽略衝突部分；其餘每項均須遵守。',
    '對明確的名稱、器型、禁用效果、故事設定、特性選擇與用途要求逐條檢查；不要因個人口味而判失敗。',
    '若已符合，輸出 {"aligned":true,"issues":[],"revisedArtifact":null}。',
    '若不符合，列出具體不符合的項目並直接提供修改後的完整 revisedArtifact，不能只作空泛評論。',
    'revisedArtifact 需維持原有 JSON 結構（name、icon、description、equipSlot、effects），不得擅自更改法寶境界。',
    '只能使用本次允許的效果 type 及每個特性 min～max；無需填不存在的屬性。',
    '不得憑空改寫已設定素材的正式故事；改進描述時須保留深度最深的主素材核心。',
    '請只輸出 JSON。',
    '管理員大概動向：', direction || '未設定',
    '管理員額外提示詞：', guidance || '未設定',
    '投入主素材完整設定：', JSON.stringify(hierarchy.primary),
    '投入輔素材完整設定：', JSON.stringify(hierarchy.supporting),
    '鎖定境界與煉製階段：', JSON.stringify({ targetRealm, stage }),
    '可用特性範圍：', JSON.stringify(effectRangesForRealm(targetRealm, stage, {}, payload.effectBoundsV2, ingredientTotal(payload.selectedIngredients))),
    '目前成品：', JSON.stringify(artifact)
  ].join('\n');
}

async function reviewGuidedArtifact(payload, artifact, targetRealm, stage) {
  if (!cleanText(payload.adminGenerationDirection, 80) &&
      !cleanText(payload.adminGenerationPrompt, 1200)) {
    return { artifact, guidanceReview: 'not-requested' };
  }
  try {
    const response = await aiRouter.generateJSON(
      buildGuidanceReviewPrompt(payload, artifact, targetRealm, stage),
      { timeoutMs: 35000 }
    );
    const review = response.data || {};
    if (review.aligned === true && (!Array.isArray(review.issues) || review.issues.length === 0)) {
      return { artifact, guidanceReview: 'aligned' };
    }
    const revised = review.revisedArtifact;
    // A reviewer cannot replace a valid artifact with an empty/partial answer.
    if (!revised || typeof revised !== 'object' || Array.isArray(revised) ||
        !cleanText(revised.name, 18) || !cleanText(revised.description, 180) ||
        !Array.isArray(revised.effects) || !revised.effects.length) {
      return { artifact, guidanceReview: 'unresolved' };
    }
    const sanitized = sanitizeGeneratedArtifact(revised, targetRealm, stage, {}, payload.effectBoundsV2, ingredientTotal(payload.selectedIngredients));
    const validType = revised.effects.some((effect) =>
      effectRange(cleanText(effect?.type, 64), realmOrder(targetRealm), stage, {}, false, payload.effectBoundsV2, ingredientTotal(payload.selectedIngredients)) !== null
    );
    if (!validType) return { artifact, guidanceReview: 'unresolved' };
    return { artifact: sanitized, guidanceReview: 'revised' };
  } catch (error) {
    console.warn('[Artifact Generation API] optional guidance review unavailable:', error?.message || error);
    return { artifact, guidanceReview: 'unavailable' };
  }
}

function registerArtifactGenerationApi(app) {
  app.get('/api/artifact-effect-ranges', (req, res) => {
    const realm = String(req.query?.realm || '煉氣');
    const stage = Number(req.query?.stage || 1);
    if (realm === '凡人' || !REALMS.includes(realm) || ![1,2,3].includes(stage)) return res.status(400).json({ error:'未知境界或煉器階段' });
    res.json({ realm, stage, ranges:effectRangesForRealm(realm, stage) });
  });
  app.get('/api/artifact-depth-effect-ranges', (req, res) => {
    const stage = Number(req.query?.stage || 1);
    if (![1,2,3].includes(stage)) return res.status(400).json({ error:'未知煉製深度' });
    res.json({ stage, ranges:defaultDepthEffectRanges(stage), realms:REALMS.slice(1) });
  });
  app.post('/api/generate-artifact', async (req, res) => {
    try {
      const selected = Array.isArray(req.body?.selectedIngredients) ? req.body.selectedIngredients : [];
      const allMaterials = Array.isArray(req.body?.allMaterials) ? req.body.allMaterials : [];
      const totalIngredients = selected.reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row?.quantity) || 1)), 0);
      if (totalIngredients < 2 || totalIngredients > 8) return res.status(400).json({ error: '煉器素材必須為 2 到 8 個' });
      if (!allMaterials.length) return res.status(400).json({ error: '缺少完整材料圖鑑' });

      // 境界永遠由伺服器依投入素材在完整圖鑑中的正式境界重算，忽略前端傳來的 targetRealm。
      const targetRealm = deriveTargetRealm(req.body || {});
      const effectBoundsV2 = normalizeDepthEffectBounds(req.body?.effectBoundsV2);
      const safePayload = { ...(req.body || {}), targetRealm, effectBoundsV2,
        forgeMethod: normalizeForgeMethod(req.body?.forgeMethod) };
      const refinementStage = deriveRefinementStage(safePayload);
      const prompt = buildPrompt(safePayload);
      const routed = await aiRouter.generateJSON(prompt, { timeoutMs: 35000 });
      const hierarchy = ingredientHierarchy(safePayload);
      const forgeOptions = { weaponForm: lockedWeaponForm(safePayload),
        forgeMethod: safePayload.forgeMethod,
        primaryArtifacts: hierarchy.primary.filter((item) => item.type === 'artifact') };
      const initialArtifact = sanitizeGeneratedArtifact(routed.data, targetRealm, refinementStage, {}, effectBoundsV2, totalIngredients, forgeOptions);
      const reviewed = await reviewGuidedArtifact(safePayload, initialArtifact, targetRealm, refinementStage);
      // A secondary AI review cannot undo the locked form or inherited signature effect.
      const finalArtifact = sanitizeGeneratedArtifact(reviewed.artifact, targetRealm, refinementStage,
        {}, effectBoundsV2, totalIngredients, forgeOptions);
      res.json({ artifact: finalArtifact, provider: routed.provider, model: routed.model,
        guidanceReview: reviewed.guidanceReview });
    } catch (error) {
      console.error('[Artifact Generation API]', error);
      res.status(/上下限|境界設定|階段設定|不允許設定|效果上下限|有限數值|不支援的法寶/.test(error?.message || '') ? 400 : 500)
        .json({ error: error?.message || 'AI 法寶生成失敗' });
    }
  });
}

module.exports = registerArtifactGenerationApi;
module.exports.buildPrompt = buildPrompt;
module.exports.ingredientHierarchy = ingredientHierarchy;
module.exports.sanitizeGeneratedArtifact = sanitizeGeneratedArtifact;
module.exports.deriveTargetRealm = deriveTargetRealm;
module.exports.deriveRefinementStage = deriveRefinementStage;
module.exports.REALMS = REALMS;
module.exports.ALLOWED_EFFECTS = ALLOWED_EFFECTS;
module.exports.FORGE_METHODS = FORGE_METHODS;
module.exports.lockedWeaponForm = lockedWeaponForm;
module.exports.EFFECT_LABELS = EFFECT_LABELS;
module.exports.effectRange = effectRange;
module.exports.effectRangesForRealm = effectRangesForRealm;
module.exports.sanitizeEffect = sanitizeEffect;
module.exports.buildGuidanceReviewPrompt = buildGuidanceReviewPrompt;
module.exports.reviewGuidedArtifact = reviewGuidedArtifact;

module.exports.normalizeEffectBounds = normalizeEffectBounds;

module.exports.defaultDepthEffectRanges = defaultDepthEffectRanges;
module.exports.normalizeDepthEffectBounds = normalizeDepthEffectBounds;
module.exports.realmSlice = realmSlice;

module.exports.ingredientCountMultiplier = ingredientCountMultiplier;
module.exports.ingredientTotal = ingredientTotal;
module.exports.scaleIngredientRange = scaleIngredientRange;

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

  let best = '凡人';
  let bestOrder = 0;
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
function effectRange(type, order, stage = 1) {
  if (!ALLOWED_EFFECTS.has(type) ||
      order < minRealmForEffect(type) ||
      !effectAllowedForStage(type, stage)) return null;
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
  if (type === 'timed_attack_multiplier' || type === 'timed_cultivation_multiplier') {
    const fullMax = 1.35 + order * 0.06;
    const bonus = (fullMax - 1) * scale;
    const fullDuration = 5 + order * 2;
    const maxMinutes = Math.max(2, fullDuration * (0.55 + 0.45 * scale));
    return { type, label, field:'multiplier',
      min:roundRange(1 + bonus * 0.35), max:roundRange(1 + bonus),
      unit:'倍', durationMinutesMin:2, durationMinutesMax:roundRange(maxMinutes, 2),
      note:'同時填入 multiplier 與 durationMinutes，催動後消耗一件' };
  }
  if (type === 'equip_damage_cap_percent') {
    const base = capByType[type];
    const min = roundRange(base + (0.80 - base) * (1 - scale));
    return { type, label, field:'value', min, max:roundRange(Math.min(0.80, min + 0.12)),
      unit:'最大生命比例', note:'越小越強；0.35 表示單次生命傷害至多 35%' };
  }
  const fullCap = capByType[type];
  if (!Number.isFinite(fullCap)) throw new Error(`效果未設定境界數值表：${type}`);
  const scaledMax = fullCap * scale;
  const integer = FLAT_VALUE_TYPES.has(type);
  const min = integer ? Math.max(1, Math.ceil(scaledMax * 0.35)) : roundRange(scaledMax * 0.35);
  const max = integer ? Math.max(min, Math.floor(scaledMax)) : roundRange(scaledMax);
  return { type, label, field:'value', min, max, unit:integer ? '點' : '比例',
    note:integer ? '使用整數' : '0.10 代表 10%' };
}
function effectRangesForRealm(realm, stage = 1) {
  const order = realmOrder(realm);
  return [...ALLOWED_EFFECTS].map((type) => effectRange(type, order, stage)).filter(Boolean);
}
function sanitizeValue(type, value, order, stage = 1) {
  const range = effectRange(type, order, stage);
  if (!range || range.field !== 'value') return null;
  const proposed = Number(value);
  const chosen = Number.isFinite(proposed) ? proposed : (range.min + range.max) / 2;
  const bounded = clamp(chosen, range.min, range.max);
  return FLAT_VALUE_TYPES.has(type) ? Math.round(bounded) : roundRange(bounded);
}
function sanitizeEffect(raw, order, stage = 1) {
  const type = cleanText(raw?.type, 64);
  const range = effectRange(type, order, stage);
  if (!range) return null;
  const out = { type };
  if (range.field === 'value') {
    out.value = sanitizeValue(type, raw?.value, order, stage);
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

function sanitizeGeneratedArtifact(raw, targetRealm, refinementStage = 1) {
  const realm = REALMS.includes(targetRealm) ? targetRealm : '凡人';
  const order = realmOrder(realm);
  const stage = normalizeRefinementStage(refinementStage);
  const requested = Array.isArray(raw?.effects) ? raw.effects.map((e) => sanitizeEffect(e, order, stage)).filter(Boolean) : [];
  const wantsEquip = requested.some((effect) => effect.type.startsWith('equip_'));
  let effects = wantsEquip
    ? requested.filter((effect) => effect.type.startsWith('equip_'))
    : requested.filter((effect) => !effect.type.startsWith('equip_'));
  effects = effects.slice(0, maxEffectsForGeneration(order, stage));

  if (!effects.length) {
    const fallbackRange = effectRange('equip_attack_flat', order, stage);
    effects = [sanitizeEffect({ type: 'equip_attack_flat', value: (fallbackRange.min + fallbackRange.max) / 2 }, order, stage)].filter(Boolean);
  }

  const equipped = effects.some((effect) => effect.type.startsWith('equip_'));
  const result = {
    name: cleanText(raw?.name, 18) || realm + '無名靈器',
    icon: cleanText(raw?.icon, 4) || '◆',
    realm,
    category: equipped ? '裝備法寶' : '消耗法寶',
    description: cleanText(raw?.description, 180) || '由未知配方自行衍化而成的法寶。',
    effects
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
  const selected = Array.isArray(payload.selectedIngredients) ? payload.selectedIngredients.slice(0, 8) : [];
  const allMaterials = Array.isArray(payload.allMaterials) ? payload.allMaterials.slice(0, 160) : [];
  const existingArtifacts = Array.isArray(payload.existingArtifacts) ? payload.existingArtifacts.slice(0, 160) : [];
  const adminGenerationDirection = cleanText(payload.adminGenerationDirection, 80);
  const adminGenerationPrompt = cleanText(payload.adminGenerationPrompt, 1200);
  const targetRealm = REALMS.includes(payload.targetRealm) ? payload.targetRealm : deriveTargetRealm(payload);
  const order = realmOrder(targetRealm);
  const refinementStage = deriveRefinementStage(payload);
  const stageDirections = {
    1: [
      '【內部生成規則：第一煉】本次產物應像「木材加工成木棍」：是可繼續加工的器胚、零件、核心、刃胚、握柄、符骨、靈芯、甲片等半成品，而不是完整武器或終極法寶。',
      '第一煉產物必須有一個清楚可感知、但偏弱的功能或特性；重點是留下可供下一次煉器承接的性質，不要一次完成所有用途。',
      '名稱與描述要自然呈現它是一件可繼續加工的實體部件，但不要在文字中說「第一煉」「階段一」「低階產物」或解釋系統規則。'
    ],
    2: [
      '【內部生成規則：第二煉】本次應把前一煉的部件與其他素材整合成一件完整可用的武器、護具、法器或靈寶。',
      '第二煉應有不錯且明確的實戰或修煉功能，並承接投入部件的核心性質；完成度要顯著高於單純零件，但仍保留未來再次精煉、融合更多特性的空間。',
      '不要在名稱或描述中提到「第二煉」「階段二」「升級層級」等系統資訊。'
    ],
    3: [
      '【內部生成規則：第三煉】本次是三次煉器中完成度最高的一次：把前階成品與新素材的多種特性深度融合成成熟重寶。',
      '第三煉可集結更多彼此協調的特性，效果組合比前兩次更豐富，數值在同境界硬上限內也可更接近上限；但仍不得突破任何平衡規則。',
      '產物要像真正完成的強力法寶，不要在名稱或描述中提到「第三煉」「最終階段」「層級三」或任何系統內部規則。'
    ]
  };
  const hiddenStageDirection = stageDirections[refinementStage].join('\n');
  const hierarchy = ingredientHierarchy(payload);
  const allowedRanges = effectRangesForRealm(targetRealm, refinementStage);
  const allowedTypes = allowedRanges.map((range) => range.type);
  const creativeDirections = [
    '古樸宗門鎮派器：名字沉穩、有歷史感，效果帶有守成或反制意味。',
    '邪異秘境奇器：名字詭譎但不俗氣，效果偏條件觸發、反傷、低血爆發或奇術。',
    '天象神兵：從雷、星、日月、風火、虛空等意象延伸，效果要有強烈主題。',
    '文雅靈寶：名字含蓄、有典故感，不直接把素材名稱拼在一起，效果偏悟道、護體、節奏型。',
    '兇烈戰器：名字短而有力，效果偏暴擊、真傷、追擊或壓血線，但仍符合境界平衡。',
    '守御重器：名字厚重，效果偏護盾、減傷、保命、反震，避免只是單純加生命。',
    '偏門奇寶：優先考慮少見效果組合，讓它和既有法寶玩法不同。'
  ];
  const creativeDirection = creativeDirections[Math.floor(Math.random() * creativeDirections.length)];
  return [
    '你是修仙世界的「天工器靈」，負責從從未出現過的素材組合中推演新法寶。',
    '請非常有創意，不要只把材料名稱機械拼接。名稱要像真正的修仙法寶，2~8 個中文字為佳；描述要能讓人看出材料之間的意象、性質或衝突如何形成此器。',
    '同一批材料可能蘊含攻擊、防禦、奇術、悟道、護命等方向；請根據素材氣質選擇最有特色的一種，不要每次都只做加攻擊。',
    '本次創意方向：' + creativeDirection,
    hiddenStageDirection,
    '上述煉器階段規則只供你內部生成時使用。輸出的 name、description、icon、effects 不得解釋玩家正在第幾次煉器，也不得出現「深度」「套娃」「生成規則」「階段」等系統詞。',
    '名稱要有辨識度，避免大量使用「玄、天、神、靈」作為固定前綴；可使用器型、異象、典故、動作、自然意象來命名。',
    '描述請像法寶誌異條目：說明它如何由這批素材的性質融合而成，以及使用時會出現什麼具體異象。',
    '',
    '硬性規則：',
    '1. 法寶境界已由遊戲鎖定為「' + targetRealm + '」，不得改境界。',
    '2. 只輸出 JSON，不要 Markdown。',
    '3. 效果只能使用下方允許的 type；依本次內部煉器階段與境界，最多 ' + maxEffectsForGeneration(order, refinementStage) + ' 個效果。',
    '4. 每個效果必須使用下方境界＋煉製階段數值表的 min～max（含上下限），不准填 0、不得突破範圍；百分比一律用小數，例如 0.10 = 10%。連擊上限 0.10。',
    '4a. 法寶無修士境界裝備限制：不論玩家境界高低，只要持有裝備型法寶就能裝備；本表的「境界」僅影響法寶效果數值。',
    '4b. 單次生命傷害上限 equip_damage_cap_percent 數值越小代表越強，不要誤選較大數字當成強化。',
    '4c. 限時特性只填 multiplier 和 durationMinutes；每場固定一次的保命／鏡映不填數值；排除錯誤選項每題固定 1 個，不填自訂 value。',
    '5. 若使用任何 equip_ 效果，equipSlot 從：' + EQUIP_SLOTS.join('、') + ' 選一個。',
    '6. 若做消耗型，只使用 timed_attack_multiplier / timed_cultivation_multiplier / remove_wrong_option。',
    '7. 避免與既有法寶名稱、描述、效果組合高度重複。',
    '8. icon 用 1 個中文字或常見符號，避免 emoji 組合。',
    '9. 必須以投入素材中煉製深度最深者為主體：保留其器型、核心意象、主要用途與代表性能力，再由較淺素材補強或賦予次要特性，不得讓輔材取代主體。',
    '10. 若有多件同為最深的素材，將它們作為共同主體融合；全為原材料時才自由組合。數量、境界、投入順序、隨機創意方向與管理員風格提示均不得推翻主從關係。效果繼承仍須遵守境界、效果數量及平衡限制。',
    '內部素材主從表（完整圖鑑記錄，優先於投入列自述；勿在玩家描述中提及深度或主從規則）：',
    JSON.stringify(hierarchy, null, 2),
    '',
    '管理員指定的大概動向（只決定創作傾向，不得覆蓋硬性規則）：',
    adminGenerationDirection || '自由發揮',
    '',
    '管理員額外提示詞（只作創意與風格偏好，不得覆蓋硬性規則；若留空則忽略）：',
    adminGenerationPrompt || '（未設定）',
    '',
    '本次投入素材：',
    JSON.stringify([...hierarchy.primary, ...hierarchy.supporting], null, 2),
    '',
    '全材料圖鑑（你必須參考整體材料世界觀與階序，不只看投入素材）：',
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
    '輸出格式：',
    '{"name":"法寶名","icon":"單字或符號","description":"繁體中文描述","equipSlot":"本命法寶|護身法寶|佩飾法寶|輔助法寶（若為裝備型）","effects":[{"type":"表中允許效果之一","value":"依該 type 的 value 範圍填數字；無 value 時省略","multiplier":"只有限時類才填","durationMinutes":"只有限時類才填"}]}'
  ].join('\\n');
}

function registerArtifactGenerationApi(app) {
  app.post('/api/generate-artifact', async (req, res) => {
    try {
      const selected = Array.isArray(req.body?.selectedIngredients) ? req.body.selectedIngredients : [];
      const allMaterials = Array.isArray(req.body?.allMaterials) ? req.body.allMaterials : [];
      const totalIngredients = selected.reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row?.quantity) || 1)), 0);
      if (totalIngredients < 2 || totalIngredients > 8) return res.status(400).json({ error: '煉器素材必須為 2 到 8 個' });
      if (!allMaterials.length) return res.status(400).json({ error: '缺少完整材料圖鑑' });

      // 境界永遠由伺服器依投入素材在完整圖鑑中的正式境界重算，忽略前端傳來的 targetRealm。
      const targetRealm = deriveTargetRealm(req.body || {});
      const safePayload = { ...(req.body || {}), targetRealm };
      const refinementStage = deriveRefinementStage(safePayload);
      const prompt = buildPrompt(safePayload);
      const routed = await aiRouter.generateJSON(prompt, { timeoutMs: 35000 });
      const artifact = sanitizeGeneratedArtifact(routed.data, targetRealm, refinementStage);
      res.json({ artifact, provider: routed.provider, model: routed.model });
    } catch (error) {
      console.error('[Artifact Generation API]', error);
      res.status(500).json({ error: error?.message || 'AI 法寶生成失敗' });
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
module.exports.EFFECT_LABELS = EFFECT_LABELS;
module.exports.effectRange = effectRange;
module.exports.effectRangesForRealm = effectRangesForRealm;
module.exports.sanitizeEffect = sanitizeEffect;

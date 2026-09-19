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
function sanitizeValue(type, value, order, stage = 1) {
  const caps = {
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
  const normalizedStage = normalizeRefinementStage(stage);
  const scale = powerScaleForStage(normalizedStage);
  if (type === 'equip_damage_cap_percent') {
    const base = caps[type];
    const weakest = 0.80;
    const stageFloor = base + (weakest - base) * (1 - scale);
    return clamp(value || stageFloor, stageFloor, 0.80);
  }
  return clamp(value, 0, (caps[type] ?? 999999) * scale);
}
function sanitizeEffect(raw, order, stage = 1) {
  const type = cleanText(raw?.type, 64);
  if (!ALLOWED_EFFECTS.has(type) || order < minRealmForEffect(type) || !effectAllowedForStage(type, stage)) return null;
  const normalizedStage = normalizeRefinementStage(stage);
  const scale = powerScaleForStage(normalizedStage);
  const out = { type };
  if (type.startsWith('equip_') && !['equip_cheat_death','equip_copy_enemy_artifact'].includes(type)) {
    out.value = sanitizeValue(type, raw?.value, order, normalizedStage);
  } else if (type === 'timed_attack_multiplier' || type === 'timed_cultivation_multiplier') {
    const fullMax = 1.35 + order * 0.06;
    const stageMax = 1 + (fullMax - 1) * scale;
    out.multiplier = clamp(raw?.multiplier || (1 + 0.25 * scale), 1.02, stageMax);
    const fullDuration = 5 + order * 2;
    const stageDuration = Math.max(2, fullDuration * (0.55 + 0.45 * scale));
    out.durationMs = Math.round(clamp(raw?.durationMinutes || stageDuration, 2, stageDuration) * 60000);
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
    effects = [sanitizeEffect({ type: 'equip_attack_flat', value: 35 + order * 25 }, order, stage)].filter(Boolean);
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
    '4. 連擊 equip_combo_chance 絕不可超過 0.10；數值會再由伺服器依境界平衡。',
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
    '允許效果：',
    JSON.stringify([...ALLOWED_EFFECTS]),
    '',
    '輸出格式：',
    '{"name":"法寶名","icon":"單字或符號","description":"繁體中文描述","equipSlot":"本命法寶|護身法寶|佩飾法寶|輔助法寶（若為裝備型）","effects":[{"type":"允許效果之一","value":0.1,"multiplier":1.3,"durationMinutes":10}]}'
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

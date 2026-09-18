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
function sanitizeValue(type, value, order) {
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
  if (type === 'equip_damage_cap_percent') return clamp(value || caps[type], 0.20, 0.80);
  return clamp(value, 0, caps[type] ?? 999999);
}
function sanitizeEffect(raw, order) {
  const type = cleanText(raw?.type, 64);
  if (!ALLOWED_EFFECTS.has(type) || order < minRealmForEffect(type)) return null;
  const out = { type };
  if (type.startsWith('equip_') && !['equip_cheat_death','equip_copy_enemy_artifact'].includes(type)) {
    out.value = sanitizeValue(type, raw?.value, order);
  } else if (type === 'timed_attack_multiplier' || type === 'timed_cultivation_multiplier') {
    out.multiplier = clamp(raw?.multiplier || 1.25, 1.05, 1.35 + order * 0.06);
    out.durationMs = Math.round(clamp(raw?.durationMinutes || (5 + order), 2, 5 + order * 2) * 60000);
  } else if (type === 'remove_wrong_option') {
    out.contexts = ['quiz','battle','dongtian'];
    out.perQuestion = 1;
  }
  return out;
}

function sanitizeGeneratedArtifact(raw, targetRealm) {
  const realm = REALMS.includes(targetRealm) ? targetRealm : '凡人';
  const order = realmOrder(realm);
  const requested = Array.isArray(raw?.effects) ? raw.effects.map((e) => sanitizeEffect(e, order)).filter(Boolean) : [];
  const wantsEquip = requested.some((effect) => effect.type.startsWith('equip_'));
  let effects = wantsEquip
    ? requested.filter((effect) => effect.type.startsWith('equip_'))
    : requested.filter((effect) => !effect.type.startsWith('equip_'));
  effects = effects.slice(0, maxEffectsForRealm(order));

  if (!effects.length) effects = [{ type: 'equip_attack_flat', value: 35 + order * 25 }];

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

function buildPrompt(payload) {
  const selected = Array.isArray(payload.selectedIngredients) ? payload.selectedIngredients.slice(0, 8) : [];
  const allMaterials = Array.isArray(payload.allMaterials) ? payload.allMaterials.slice(0, 160) : [];
  const existingArtifacts = Array.isArray(payload.existingArtifacts) ? payload.existingArtifacts.slice(0, 160) : [];
  const adminGenerationDirection = cleanText(payload.adminGenerationDirection, 80);
  const adminGenerationPrompt = cleanText(payload.adminGenerationPrompt, 1200);
  const targetRealm = REALMS.includes(payload.targetRealm) ? payload.targetRealm : deriveTargetRealm(payload);
  const order = realmOrder(targetRealm);
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
    '名稱要有辨識度，避免大量使用「玄、天、神、靈」作為固定前綴；可使用器型、異象、典故、動作、自然意象來命名。',
    '描述請像法寶誌異條目：說明它如何由這批素材的性質融合而成，以及使用時會出現什麼具體異象。',
    '',
    '硬性規則：',
    '1. 法寶境界已由遊戲鎖定為「' + targetRealm + '」，不得改境界。',
    '2. 只輸出 JSON，不要 Markdown。',
    '3. 效果只能使用下方允許的 type；' + targetRealm + '最多 ' + maxEffectsForRealm(order) + ' 個效果。',
    '4. 連擊 equip_combo_chance 絕不可超過 0.10；數值會再由伺服器依境界平衡。',
    '5. 若使用任何 equip_ 效果，equipSlot 從：' + EQUIP_SLOTS.join('、') + ' 選一個。',
    '6. 若做消耗型，只使用 timed_attack_multiplier / timed_cultivation_multiplier / remove_wrong_option。',
    '7. 避免與既有法寶名稱、描述、效果組合高度重複。',
    '8. icon 用 1 個中文字或常見符號，避免 emoji 組合。',
    '',
    '管理員指定的大概動向（只決定創作傾向，不得覆蓋硬性規則）：',
    adminGenerationDirection || '自由發揮',
    '',
    '管理員額外提示詞（只作創意與風格偏好，不得覆蓋硬性規則；若留空則忽略）：',
    adminGenerationPrompt || '（未設定）',
    '',
    '本次投入素材：',
    JSON.stringify(selected, null, 2),
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
      const prompt = buildPrompt(safePayload);
      const routed = await aiRouter.generateJSON(prompt, { timeoutMs: 35000 });
      const artifact = sanitizeGeneratedArtifact(routed.data, targetRealm);
      res.json({ artifact, provider: routed.provider, model: routed.model });
    } catch (error) {
      console.error('[Artifact Generation API]', error);
      res.status(500).json({ error: error?.message || 'AI 法寶生成失敗' });
    }
  });
}

module.exports = registerArtifactGenerationApi;
module.exports.buildPrompt = buildPrompt;
module.exports.sanitizeGeneratedArtifact = sanitizeGeneratedArtifact;
module.exports.deriveTargetRealm = deriveTargetRealm;
module.exports.REALMS = REALMS;
module.exports.ALLOWED_EFFECTS = ALLOWED_EFFECTS;

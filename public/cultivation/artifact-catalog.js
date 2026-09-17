// 法寶清單：內建清單是預設值與遠端設定失敗時的備援。
// 正式遊戲執行時可由 artifact-catalog-sync.js 用 Firestore 全站設定替換同一個陣列。
// 因為 artifact-system.js 始終持有這個陣列的同一個 reference，所以管理員新增／編輯後，
// 煉器室、裝備、限時效果、問道／鬥法／洞天法寶都不需要各自修改。
//
// 支援的通用 effect.type：
// - equip_attack_flat            裝備後固定增加攻擊
// - equip_attack_percent         裝備後按比例增加攻擊，例如 value: 0.2 = +20%
// - equip_hp_flat                裝備後固定增加生命上限
// - equip_hp_percent             裝備後按比例增加生命上限
// - timed_attack_multiplier      使用後一段時間攻擊倍率，例如 multiplier: 1.5
// - timed_cultivation_multiplier 使用後一段時間修為倍率，例如 multiplier: 2
// - remove_wrong_option          問道／鬥法／洞天時移除一個錯誤選項

export const ARTIFACT_REALMS = Object.freeze([
  { id: 'mortal', name: '凡人', order: 0, need: 0 },
  { id: 'qi', name: '煉氣', order: 1, need: 1 },
  { id: 'foundation', name: '築基', order: 2, need: 10 },
  { id: 'golden-core', name: '金丹', order: 3, need: 28 },
  { id: 'nascent-soul', name: '元嬰', order: 4, need: 68 },
  { id: 'spirit', name: '化神', order: 5, need: 128 },
  { id: 'void', name: '煉虛', order: 6, need: 208 },
  { id: 'fusion', name: '合體', order: 7, need: 308 },
  { id: 'mahayana', name: '大乘', order: 8, need: 448 },
  { id: 'tribulation', name: '渡劫', order: 9, need: 628 },
  { id: 'immortal', name: '真仙', order: 10, need: 868 }
]);

export const SUPPORTED_ARTIFACT_EFFECTS = Object.freeze([
  'equip_attack_flat',
  'equip_attack_percent',
  'equip_hp_flat',
  'equip_hp_percent',
  'timed_attack_multiplier',
  'timed_cultivation_multiplier',
  'remove_wrong_option'
]);

const DEFAULT_ARTIFACT_CATALOG = [
  {
    id: 'seven-treasure-ruler',
    name: '七寶玲瓏尺',
    icon: '尺',
    realm: '築基',
    category: '消耗法寶',
    description: '問道、鬥法或洞天作答前，排除一個錯誤選項。每題最多使用一次此類效果。',
    craft: { gold: 80, yield: 1 },
    effects: [
      { type: 'remove_wrong_option', contexts: ['quiz', 'battle', 'dongtian'], perQuestion: 1 }
    ]
  },
  {
    id: 'war-drum',
    name: '破軍戰鼓',
    icon: '鼓',
    realm: '金丹',
    category: '消耗法寶',
    description: '催動後一段時間提高鬥法攻擊力。',
    craft: { gold: 150, yield: 1 },
    effects: [
      { type: 'timed_attack_multiplier', multiplier: 1.5, durationMs: 15 * 60 * 1000 }
    ]
  },
  {
    id: 'enlightenment-lamp',
    name: '悟道玄燈',
    icon: '燈',
    realm: '金丹',
    category: '消耗法寶',
    description: '點燃玄燈後，一段時間內所有正確作答所得修為翻倍。',
    craft: { gold: 180, yield: 1 },
    effects: [
      { type: 'timed_cultivation_multiplier', multiplier: 2, durationMs: 10 * 60 * 1000 }
    ]
  },
  {
    id: 'mountain-armor',
    name: '鎮嶽玄甲',
    icon: '甲',
    realm: '金丹',
    category: '裝備法寶',
    equipSlot: '護身法寶',
    description: '裝備後提升攻擊與生命。法寶境界不得低於修士目前大境界。',
    craft: { gold: 300, yield: 1 },
    effects: [
      { type: 'equip_attack_flat', value: 80 },
      { type: 'equip_hp_flat', value: 400 }
    ]
  },
  {
    id: 'void-sword',
    name: '太虛劍',
    icon: '劍',
    realm: '元嬰',
    category: '裝備法寶',
    equipSlot: '本命法寶',
    description: '以太虛劍意加持鬥法攻擊。',
    craft: { gold: 520, yield: 1 },
    effects: [
      { type: 'equip_attack_flat', value: 180 }
    ]
  },
  {
    id: 'longevity-jade',
    name: '長生玉佩',
    icon: '玉',
    realm: '元嬰',
    category: '裝備法寶',
    equipSlot: '佩飾法寶',
    description: '溫養氣血，裝備後提高生命上限。',
    craft: { gold: 480, yield: 1 },
    effects: [
      { type: 'equip_hp_flat', value: 900 }
    ]
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeArtifactDefinition(raw = {}) {
  const item = {
    id: String(raw.id || '').trim(),
    name: String(raw.name || '').trim(),
    icon: String(raw.icon || '◆').trim().slice(0, 4) || '◆',
    realm: String(raw.realm || '凡人').trim(),
    category: String(raw.category || '法寶').trim(),
    description: String(raw.description || '').trim(),
    craft: {
      gold: Math.max(0, Math.floor(finite(raw.craft?.gold, 0))),
      yield: Math.max(1, Math.floor(finite(raw.craft?.yield, 1)))
    },
    effects: Array.isArray(raw.effects) ? raw.effects.map((effect) => {
      const next = { type: String(effect?.type || '').trim() };
      if ('value' in (effect || {})) next.value = finite(effect.value, 0);
      if ('multiplier' in (effect || {})) next.multiplier = Math.max(0, finite(effect.multiplier, 1));
      if ('durationMs' in (effect || {})) next.durationMs = Math.max(1000, Math.floor(finite(effect.durationMs, 1000)));
      if (Array.isArray(effect?.contexts)) next.contexts = effect.contexts.filter((v) => ['quiz', 'battle', 'dongtian'].includes(v));
      if ('perQuestion' in (effect || {})) next.perQuestion = Math.max(1, Math.floor(finite(effect.perQuestion, 1)));
      if (effect?.stacking === 'extend') next.stacking = 'extend';
      return next;
    }).filter((effect) => effect.type) : []
  };
  if (raw.equipSlot) item.equipSlot = String(raw.equipSlot).trim();
  return item;
}

export function validateArtifactCatalog(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('法寶清單不可為空');
  const seen = new Set();
  return items.map((raw) => {
    const item = normalizeArtifactDefinition(raw);
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(item.id)) throw new Error(`法寶 ID 不合法：${item.id || '空白'}`);
    if (seen.has(item.id)) throw new Error(`法寶 ID 重複：${item.id}`);
    seen.add(item.id);
    if (!item.name) throw new Error(`法寶 ${item.id} 缺少名稱`);
    if (!ARTIFACT_REALMS.some((realm) => realm.name === item.realm)) throw new Error(`法寶 ${item.name} 使用未知境界：${item.realm}`);
    if (!item.effects.length) throw new Error(`法寶 ${item.name} 至少需要一個效果`);
    item.effects.forEach((effect) => {
      if (!SUPPORTED_ARTIFACT_EFFECTS.includes(effect.type)) throw new Error(`法寶 ${item.name} 使用尚未支援的效果：${effect.type}`);
      if (effect.type.startsWith('timed_') && (!(effect.multiplier > 0) || !(effect.durationMs >= 1000))) throw new Error(`法寶 ${item.name} 的限時效果數值不合法`);
      if (effect.type === 'remove_wrong_option' && (!Array.isArray(effect.contexts) || !effect.contexts.length)) throw new Error(`法寶 ${item.name} 至少要指定一個答題場景`);
    });
    const needsSlot = item.effects.some((effect) => effect.type.startsWith('equip_'));
    if (needsSlot && !item.equipSlot) throw new Error(`裝備法寶 ${item.name} 必須指定裝備欄位`);
    return item;
  });
}

export const ARTIFACT_CATALOG = DEFAULT_ARTIFACT_CATALOG.map(normalizeArtifactDefinition);

export function getDefaultArtifactCatalog() {
  return clone(DEFAULT_ARTIFACT_CATALOG.map(normalizeArtifactDefinition));
}

export function replaceArtifactCatalog(items, source = 'runtime') {
  const normalized = validateArtifactCatalog(items);
  ARTIFACT_CATALOG.splice(0, ARTIFACT_CATALOG.length, ...normalized);
  if (typeof window !== 'undefined') {
    window.XIUXIAN_ARTIFACT_CATALOG = ARTIFACT_CATALOG;
    window.dispatchEvent(new CustomEvent('artifact-catalog-updated', { detail: { source, count: ARTIFACT_CATALOG.length } }));
    // 舊引擎已監聽此事件，用同一條更新路徑重繪煉器室。
    window.dispatchEvent(new CustomEvent('artifact-system-updated', { detail: { catalogChanged: true, source } }));
  }
  return ARTIFACT_CATALOG;
}

export function getArtifactById(id) {
  return ARTIFACT_CATALOG.find((item) => item.id === id) || null;
}

export function realmOrderByName(name) {
  return ARTIFACT_REALMS.find((realm) => realm.name === name)?.order ?? 0;
}

export function realmForScore(score) {
  let current = ARTIFACT_REALMS[0];
  for (const realm of ARTIFACT_REALMS) {
    if (Number(score) >= realm.need) current = realm;
  }
  return current;
}

if (typeof window !== 'undefined') {
  window.XIUXIAN_ARTIFACT_CATALOG = ARTIFACT_CATALOG;
  window.XIUXIAN_ARTIFACT_REALMS = ARTIFACT_REALMS;
}

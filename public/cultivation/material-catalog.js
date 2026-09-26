// 煉器材料與法寶配方的資料來源。
// 材料清單與配方可由 material-catalog-sync.js 以 Firestore 全站設定覆蓋。

import { ARTIFACT_CATALOG, ARTIFACT_REALMS, getArtifactById } from './artifact-catalog.js';

export const MATERIAL_CATEGORIES = Object.freeze(['礦石', '兵器材料', '靈木', '晶石', '妖獸材料', '特殊材料', '符材', '其他']);
export const MATERIAL_WEAPON_FORMS = Object.freeze(['','劍','刀','槍','弓','斧','錘','戟','棍','鞭','匕首','飛劍','法盾','法杖','符籙','陣盤','寶珠','玉佩','法鏡','鈴','幡','印','鼎','鐘','器胚']);
export const MIN_ARTIFACT_RECIPE_MATERIALS = 2;
export const MAX_ARTIFACT_RECIPE_MATERIALS = 8;
export const MAX_ARTIFACT_RECIPE_NESTING = 2;
export const MATERIAL_CATALOG_SCHEMA_VERSION = 2;
export const ARTIFACT_RECIPE_SCHEMA_VERSION = 2;

const MATERIAL_REALM_COLORS = Object.freeze({
  凡人: '#a1a1aa',
  煉氣: '#86efac',
  築基: '#60a5fa',
  金丹: '#fbbf24',
  元嬰: '#c084fc',
  化神: '#f472b6',
  煉虛: '#818cf8',
  合體: '#fb923c',
  大乘: '#f87171',
  渡劫: '#ef4444',
  真仙: '#f8fafc'
});

const MATERIAL_REALM_DROP_BASE = Object.freeze({
  凡人: { quizRate: 0.08, dongtianRate: 0.34 },
  煉氣: { quizRate: 0.06, dongtianRate: 0.30 },
  築基: { quizRate: 0.05, dongtianRate: 0.26 },
  金丹: { quizRate: 0.04, dongtianRate: 0.22 },
  元嬰: { quizRate: 0.032, dongtianRate: 0.18 },
  化神: { quizRate: 0.026, dongtianRate: 0.15 },
  煉虛: { quizRate: 0.021, dongtianRate: 0.13 },
  合體: { quizRate: 0.017, dongtianRate: 0.11 },
  大乘: { quizRate: 0.014, dongtianRate: 0.095 },
  渡劫: { quizRate: 0.011, dongtianRate: 0.08 },
  真仙: { quizRate: 0.009, dongtianRate: 0.07 }
});

export const MATERIAL_REALMS = Object.freeze(ARTIFACT_REALMS.map((realm) => Object.freeze({
  ...realm,
  color: MATERIAL_REALM_COLORS[realm.name] || '#d4d4d8',
  quizRate: MATERIAL_REALM_DROP_BASE[realm.name]?.quizRate || 0.01,
  dongtianRate: MATERIAL_REALM_DROP_BASE[realm.name]?.dongtianRate || 0.08
})));

// 完整材料系譜。既有五種材料保留原 ID，避免玩家 materialSystem.inventory 與既有配方失聯。
// 新增高階材料預設 buyGold=0，主要由境界掉落取得；管理員仍可自行調整採購價。
const DEFAULT_MATERIAL_CATALOG = [
  // 礦石系：玄鐵 → 赤銅精 → 紫金砂 → 太虛玄鐵 → 九天玄晶 → 虛空石 → 混元金 → 混沌晶 → 九霄神鐵 → 仙金
  { id: 'spirit-iron', name: '玄鐵', icon: '鐵', category: '礦石', realm: '煉氣', description: '常見煉器礦材，可鍛造兵刃與護具。', buyGold: 18 },
  { id: 'red-copper-essence', name: '赤銅精', icon: '銅', category: '礦石', realm: '築基', description: '赤銅反覆淬鍊所得精華，適合築基法器與陣器。', buyGold: 0 },
  { id: 'purple-gold-sand', name: '紫金砂', icon: '砂', category: '礦石', realm: '金丹', description: '帶有金紫靈輝的細砂，可強化法寶靈力傳導。', buyGold: 0 },
  { id: 'taixu-mystic-iron', name: '太虛玄鐵', icon: '太玄', category: '礦石', realm: '元嬰', description: '受太虛之氣浸染的玄鐵，質堅而能承載元嬰法力。', buyGold: 0 },
  { id: 'nine-heaven-crystal', name: '九天玄晶', icon: '玄晶', category: '礦石', realm: '化神', description: '九天靈氣凝成的玄晶，常作化神法寶主材。', buyGold: 0 },
  { id: 'void-stone', name: '虛空石', icon: '空石', category: '礦石', realm: '煉虛', description: '內蘊虛空波動的奇石，可承載空間類禁制。', buyGold: 0 },
  { id: 'hunyuan-gold', name: '混元金', icon: '混金', category: '礦石', realm: '合體', description: '混合多種靈金本源而成，能協調不同屬性法力。', buyGold: 0 },
  { id: 'chaos-crystal', name: '混沌晶', icon: '沌晶', category: '礦石', realm: '大乘', description: '混沌氣息凝結的晶礦，適合大乘期重寶。', buyGold: 0 },
  { id: 'nine-heaven-divine-iron', name: '九霄神鐵', icon: '神鐵', category: '礦石', realm: '渡劫', description: '歷經九霄雷劫淬鍊的神鐵，對天劫之力極為耐受。', buyGold: 0 },
  { id: 'immortal-gold', name: '仙金', icon: '仙金', category: '礦石', realm: '真仙', description: '仙靈之氣孕育的頂階靈金，可煉製仙器。', buyGold: 0 },

  // 明確可鑄造完整兵器的材料。第一煉即可成為基礎武器，之後仍可再次精煉。
  { id: 'sword-forging-iron', name: '鑄劍玄鐵', icon: '劍鐵', category: '兵器材料', realm: '煉氣',
    description: '預先去除雜質、適合直接鍛成完整劍身的玄鐵。與其他材料同爐時以劍為主要器型，可打造可裝備的初階長劍，而非只有劍胚。',
    story: '山門昔日以此鐵打造門下弟子的入門佩劍；鐵性穩定、鋒芒內斂，經多次淬火可逐步養成靈劍。',
    weaponForm: '劍', weaponName: '玄鐵劍', buyGold: 24 },
  { id: 'blade-forging-copper', name: '鍛刀赤銅', icon: '刀銅', category: '兵器材料', realm: '築基',
    description: '韌性與導熱兼具的赤銅精材，可鍛出完整的佩刀刀身，適合破甲與近戰，不應只生成刀柄或零件。',
    story: '邊境煉器坊將此銅反覆折鍛，製成巡防修士的佩刀；刀脊堅韌，後續可再融入妖骨或雷晶提升威力。',
    weaponForm: '刀', weaponName: '赤銅刀', buyGold: 30 },

  // 木材系：靈草 → 靈木 → 百年靈木 → 雷擊木 → 千年靈木 → 神魂木 → 界木 → 太古神木 → 世界樹枝
  { id: 'spirit-herb', name: '靈草', icon: '草', category: '靈木', realm: '凡人', description: '初具靈性的草木，可作低階符藥與煉器輔材。', buyGold: 0 },
  { id: 'spirit-wood', name: '靈木', icon: '木', category: '靈木', realm: '煉氣', description: '蘊含靈氣的木材，適合法尺、玉佩與靈器骨架。', buyGold: 14 },
  { id: 'century-spirit-wood', name: '百年靈木', icon: '百木', category: '靈木', realm: '築基', description: '生長百年的靈木，木性穩定，適合築基法器。', buyGold: 0 },
  { id: 'lightning-struck-wood', name: '雷擊木', icon: '雷木', category: '靈木', realm: '金丹', description: '經天雷擊而不毀的靈木，內藏剛烈雷性。', buyGold: 0 },
  { id: 'millennium-spirit-wood', name: '千年靈木', icon: '千木', category: '靈木', realm: '元嬰', description: '千年歲月溫養的靈木，靈性深厚且極難腐朽。', buyGold: 0 },
  { id: 'soul-wood', name: '神魂木', icon: '魂木', category: '靈木', realm: '化神', description: '能溫養神識與魂魄的奇木，常見於神魂類法寶。', buyGold: 0 },
  { id: 'boundary-wood', name: '界木', icon: '界木', category: '靈木', realm: '煉虛', description: '生於界域交界之處的靈木，帶有空間與界壁氣息。', buyGold: 0 },
  { id: 'primordial-divine-wood', name: '太古神木', icon: '古木', category: '靈木', realm: '大乘', description: '自太古存續至今的神木，蘊含厚重本源生機。', buyGold: 0 },
  { id: 'world-tree-branch', name: '世界樹枝', icon: '世樹', category: '靈木', realm: '真仙', description: '傳說承載一界生機的世界樹枝條，可作仙器根骨。', buyGold: 0 },

  // 晶石系：青靈石 → 寒玉 → 靈晶 → 嬰靈晶 → 天雷晶 → 空冥晶 → 仙靈玉 → 劫雷晶核 → 仙晶
  { id: 'azure-spirit-stone', name: '青靈石', icon: '青石', category: '晶石', realm: '煉氣', description: '蘊含清靈之氣的基礎靈石，可作法器靈力節點。', buyGold: 0 },
  { id: 'cold-jade', name: '寒玉', icon: '寒玉', category: '晶石', realm: '築基', description: '寒氣內斂的靈玉，適合穩定靈力與封存符紋。', buyGold: 0 },
  { id: 'spirit-crystal', name: '靈晶', icon: '晶石', category: '晶石', realm: '金丹', description: '凝聚靈力的晶石，常用於高階法寶核心。', buyGold: 28 },
  { id: 'nascent-soul-crystal', name: '嬰靈晶', icon: '嬰晶', category: '晶石', realm: '元嬰', description: '與元嬰靈息共鳴的晶體，可穩固法寶靈性。', buyGold: 0 },
  { id: 'heaven-thunder-crystal', name: '天雷晶', icon: '雷晶', category: '晶石', realm: '化神', description: '天雷之力凝成的晶石，適合雷法與破邪法寶。', buyGold: 0 },
  { id: 'kongming-crystal', name: '空冥晶', icon: '空晶', category: '晶石', realm: '煉虛', description: '晶內似有空冥虛界，可用於空間與遁法器物。', buyGold: 0 },
  { id: 'immortal-spirit-jade', name: '仙靈玉', icon: '仙玉', category: '晶石', realm: '合體', description: '帶有微弱仙靈氣息的玉石，可調和合體期龐大法力。', buyGold: 0 },
  { id: 'tribulation-thunder-core', name: '劫雷晶核', icon: '劫核', category: '晶石', realm: '渡劫', description: '劫雷深處凝成的晶核，可用於抗劫與雷道重寶。', buyGold: 0 },
  { id: 'immortal-crystal', name: '仙晶', icon: '仙晶', category: '晶石', realm: '真仙', description: '高度凝聚仙靈力的晶體，是仙器與仙陣的重要核心。', buyGold: 0 },

  // 妖獸系：獸皮 → 妖獸骨 → 妖丹碎片 → 完整妖丹 → 蛟龍鱗 → 鳳凰羽 → 真龍精血 → 鳳凰精血
  { id: 'beast-hide', name: '獸皮', icon: '皮', category: '妖獸材料', realm: '煉氣', description: '低階妖獸皮革，可製護具、符袋與法器包覆層。', buyGold: 0 },
  { id: 'demon-beast-bone', name: '妖獸骨', icon: '骨', category: '妖獸材料', realm: '築基', description: '妖獸骨骼蘊含氣血之力，可作法器骨架與強化材。', buyGold: 0 },
  { id: 'beast-core-shard', name: '妖丹碎片', icon: '丹', category: '妖獸材料', realm: '金丹', description: '妖獸內丹碎片，可為法寶注入爆發性的靈力。', buyGold: 35 },
  { id: 'complete-beast-core', name: '完整妖丹', icon: '妖丹', category: '妖獸材料', realm: '元嬰', description: '完整保存的高階妖丹，內蘊濃厚妖力與本命精華。', buyGold: 0 },
  { id: 'flood-dragon-scale', name: '蛟龍鱗', icon: '龍鱗', category: '妖獸材料', realm: '化神', description: '蛟龍護體之鱗，兼具堅韌與水行靈性。', buyGold: 0 },
  { id: 'phoenix-feather', name: '鳳凰羽', icon: '鳳羽', category: '妖獸材料', realm: '煉虛', description: '蘊含涅槃火意的鳳羽，可煉火系與遁光重寶。', buyGold: 0 },
  { id: 'true-dragon-blood', name: '真龍精血', icon: '龍血', category: '妖獸材料', realm: '大乘', description: '真龍本源精血，氣血與龍威極盛，可淬鍊頂階法寶。', buyGold: 0 },
  { id: 'phoenix-blood', name: '鳳凰精血', icon: '鳳血', category: '妖獸材料', realm: '真仙', description: '鳳凰涅槃本源所化精血，蘊含近乎不滅的生命火種。', buyGold: 0 },

  // 特殊系：靈符紙 → 地火石 → 星辰砂 → 天雷精魄 → 赤鳳石 → 五行精魄 → 天道碎片 → 法則碎片 → 大道碎片 → 鴻蒙紫氣
  { id: 'talisman-paper', name: '靈符紙', icon: '符', category: '特殊材料', realm: '築基', description: '承載符紋與陣法的基礎材料。', buyGold: 10 },
  { id: 'earthfire-stone', name: '地火石', icon: '地火', category: '特殊材料', realm: '金丹', description: '長年受地火灼煉的火性靈石，可提供穩定煉器火力。', buyGold: 0 },
  { id: 'star-sand', name: '星辰砂', icon: '星砂', category: '特殊材料', realm: '元嬰', description: '吸納星輝形成的細砂，可引星力入器。', buyGold: 0 },
  { id: 'heaven-thunder-essence', name: '天雷精魄', icon: '雷魄', category: '特殊材料', realm: '化神', description: '天雷中誕生的精魄，可賦予法寶雷霆神通。', buyGold: 0 },
  { id: 'scarlet-phoenix-stone', name: '赤鳳石', icon: '鳳石', category: '特殊材料', realm: '煉虛', description: '赤鳳真火長年凝結形成的奇石，兼具火意與靈性。', buyGold: 0 },
  { id: 'five-elements-essence', name: '五行精魄', icon: '五行', category: '特殊材料', realm: '合體', description: '金木水火土五行精華匯聚而成，可平衡多屬性法寶。', buyGold: 0 },
  { id: 'heavenly-dao-fragment', name: '天道碎片', icon: '天道', category: '特殊材料', realm: '大乘', description: '蘊有一絲天道規律的神秘碎片，可提升法寶道韻。', buyGold: 0 },
  { id: 'law-fragment', name: '法則碎片', icon: '法則', category: '特殊材料', realm: '渡劫', description: '天地法則顯化後留下的碎片，可承載高階法則之力。', buyGold: 0 },
  { id: 'great-dao-fragment', name: '大道碎片', icon: '大道', category: '特殊材料', realm: '真仙', description: '大道顯化的一角，蘊含遠超尋常法則的本源力量。', buyGold: 0 },
  { id: 'hongmeng-purple-qi', name: '鴻蒙紫氣', icon: '鴻蒙', category: '特殊材料', realm: '真仙', description: '傳說開天之前便存在的本源紫氣，屬於終局級稀世材料。', buyGold: 0 }
];

const DEFAULT_MATERIAL_REALM_BY_ID = Object.freeze(Object.fromEntries(
  DEFAULT_MATERIAL_CATALOG.map((item) => [item.id, item.realm])
));

const DEFAULT_ARTIFACT_RECIPES = {
  'seven-treasure-ruler': [
    { materialId: 'spirit-wood', quantity: 2 },
    { materialId: 'talisman-paper', quantity: 1 }
  ],
  'war-drum': [
    { materialId: 'spirit-iron', quantity: 2 },
    { materialId: 'beast-core-shard', quantity: 1 }
  ],
  'enlightenment-lamp': [
    { materialId: 'spirit-crystal', quantity: 2 },
    { materialId: 'talisman-paper', quantity: 2 }
  ],
  'mountain-armor': [
    { materialId: 'spirit-iron', quantity: 6 },
    { materialId: 'spirit-crystal', quantity: 2 }
  ],
  'void-sword': [
    { materialId: 'spirit-iron', quantity: 4 },
    { materialId: 'spirit-crystal', quantity: 2 },
    { materialId: 'beast-core-shard', quantity: 2 }
  ],
  'longevity-jade': [
    { materialId: 'spirit-crystal', quantity: 5 },
    { materialId: 'spirit-wood', quantity: 2 }
  ]
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function materialRealmMetaByName(name) {
  return MATERIAL_REALMS.find((realm) => realm.name === name) || MATERIAL_REALMS[1] || MATERIAL_REALMS[0];
}

export function materialRealmOrderByName(name) {
  return materialRealmMetaByName(name)?.order ?? 0;
}

// Unified market reference values: materials of the same realm always share
// one per-unit price, independently of their optional NPC purchase (buyGold).
// Mortal starts at 10 and Qi starts at 20; each subsequent realm doubles.
export function materialMarketReferencePrice(materialOrRealm) {
  const realm = typeof materialOrRealm === 'string' ? materialOrRealm : materialOrRealm?.realm;
  const index = Math.max(0, Math.min(10, materialRealmOrderByName(realm)));
  return 10 * 2 ** index;
}

export function materialMarketMinimumTotal(materialOrRealm, quantity = 1) {
  const count = Number(quantity);
  if (!Number.isSafeInteger(count) || count < 1) return 0;
  // Listing price is an integer TOTAL price, and must be strictly greater.
  return materialMarketReferencePrice(materialOrRealm) * count + 1;
}

export function materialRealmColor(name) {
  return materialRealmMetaByName(name)?.color || '#d4d4d8';
}

export function materialRealmForScore(score) {
  let current = MATERIAL_REALMS[0];
  for (const realm of MATERIAL_REALMS) {
    if (Number(score) >= realm.need) current = realm;
  }
  return current;
}

export function materialDropRateFor(materialOrRealm, playerScore, source = 'quiz') {
  const realmName = typeof materialOrRealm === 'string' ? materialOrRealm : materialOrRealm?.realm;
  const materialRealm = materialRealmMetaByName(realmName);
  const playerRealm = materialRealmForScore(playerScore);
  if (!materialRealm || !playerRealm || playerRealm.order < materialRealm.order) return 0;
  const key = source === 'dongtian' ? 'dongtianRate' : 'quizRate';
  const base = Math.max(0, Number(materialRealm[key]) || 0);
  const gap = Math.max(0, playerRealm.order - materialRealm.order);
  const multiplier = 1 + Math.min(gap, 5) * 0.30;
  const cap = source === 'dongtian' ? 0.48 : 0.12;
  return Math.min(cap, base * multiplier);
}

export function normalizeMaterialDefinition(raw = {}) {
  const id = String(raw.id || '').trim();
  const fallbackRealm = DEFAULT_MATERIAL_REALM_BY_ID[id] || '煉氣';
  const item = {
    id,
    name: String(raw.name || '').trim(),
    icon: String(raw.icon || ({
      '礦石':'礦','兵器材料':'兵','靈木':'木','晶石':'晶',
      '妖獸材料':'獸','特殊材料':'異','符材':'符','其他':'材'
    }[raw.category] || '材')).trim().slice(0, 4) || '材',
    category: String(raw.category || '其他').trim() || '其他',
    realm: String(raw.realm || fallbackRealm).trim() || fallbackRealm,
    description: String(raw.description || '').trim(),
    story: String(raw.story || '').trim().slice(0, 2000),
    weaponForm: MATERIAL_WEAPON_FORMS.includes(String(raw.weaponForm || '').trim())
      ? String(raw.weaponForm || '').trim() : '',
    weaponName: String(raw.weaponName || '').trim().slice(0, 18),
    buyGold: Math.max(0, Math.floor(finite(raw.buyGold, 0)))
  };
  if (raw.imageUrl) item.imageUrl = String(raw.imageUrl).trim().slice(0, 2048);
  if (['generating','ready','error'].includes(raw.imageStatus)) item.imageStatus = raw.imageStatus;
  if (raw.imageModel) item.imageModel = String(raw.imageModel).trim().slice(0, 120);
  if (raw.imagePromptVersion) item.imagePromptVersion = String(raw.imagePromptVersion).trim().slice(0, 80);
  if (raw.imageStoragePath) item.imageStoragePath = String(raw.imageStoragePath).trim().slice(0, 512);
  if (raw.imageUpdatedAtMs) item.imageUpdatedAtMs = Math.max(0, Math.floor(finite(raw.imageUpdatedAtMs, 0)));
  if (raw.imageError) item.imageError = String(raw.imageError).trim().slice(0, 260);
  if (raw.imageJobId) item.imageJobId = String(raw.imageJobId).trim().slice(0, 80);
  return item;
}

export function validateMaterialCatalog(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('材料清單不可為空');
  const seen = new Set();
  return items.map((raw) => {
    const item = normalizeMaterialDefinition(raw);
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(item.id)) throw new Error(`材料 ID 不合法：${item.id || '空白'}`);
    if (seen.has(item.id)) throw new Error(`材料 ID 重複：${item.id}`);
    seen.add(item.id);
    if (!item.name) throw new Error(`材料 ${item.id} 缺少名稱`);
    if (!MATERIAL_REALMS.some((realm) => realm.name === item.realm)) throw new Error(`材料 ${item.name} 使用未知境界：${item.realm}`);
    return item;
  });
}

export const MATERIAL_CATALOG = DEFAULT_MATERIAL_CATALOG.map(normalizeMaterialDefinition);

export function getDefaultMaterialCatalog() {
  return clone(DEFAULT_MATERIAL_CATALOG.map(normalizeMaterialDefinition));
}

// 舊 Firestore materialCatalogV1 只有少量材料時，先以遠端同 ID 設定覆蓋預設值，
// 再自動補上缺少的系統材料。額外由管理員建立的材料也會保留。
export function mergeMaterialCatalogWithDefaults(items = []) {
  const merged = new Map(getDefaultMaterialCatalog().map((item) => [item.id, item]));
  (Array.isArray(items) ? items : []).forEach((raw) => {
    const id = String(raw?.id || '').trim();
    if (!id) return;
    const base = merged.get(id) || {};
    merged.set(id, normalizeMaterialDefinition({ ...base, ...raw, id }));
  });
  return validateMaterialCatalog([...merged.values()]);
}

export function replaceMaterialCatalog(items, source = 'runtime') {
  const normalized = validateMaterialCatalog(items);
  MATERIAL_CATALOG.splice(0, MATERIAL_CATALOG.length, ...normalized);
  if (typeof window !== 'undefined') {
    window.XIUXIAN_MATERIAL_CATALOG = MATERIAL_CATALOG;
    window.XIUXIAN_MATERIAL_REALMS = MATERIAL_REALMS;
    window.dispatchEvent(new CustomEvent('material-catalog-updated', { detail: { source, count: MATERIAL_CATALOG.length } }));
  }
  return MATERIAL_CATALOG;
}

export function getMaterialById(id) {
  return MATERIAL_CATALOG.find((item) => item.id === id) || null;
}

export function recipeIngredientKey(row = {}) {
  const artifactId = String(row?.artifactId || '').trim();
  if (artifactId) return `artifact:${artifactId}`;
  const materialId = String(row?.materialId || '').trim();
  return materialId ? `material:${materialId}` : '';
}

export function normalizeArtifactRecipe(recipe = []) {
  const totals = new Map();
  (Array.isArray(recipe) ? recipe : []).forEach((row) => {
    const artifactId = String(row?.artifactId || '').trim();
    const materialId = String(row?.materialId || '').trim();
    const quantity = Math.max(0, Math.floor(finite(row?.quantity, 0)));
    if (quantity <= 0) return;
    const key = artifactId ? `artifact:${artifactId}` : (materialId ? `material:${materialId}` : '');
    if (!key) return;
    totals.set(key, (totals.get(key) || 0) + quantity);
  });
  return [...totals.entries()].map(([key, quantity]) => {
    if (key.startsWith('artifact:')) return { artifactId: key.slice(9), quantity };
    return { materialId: key.slice(9), quantity };
  });
}

function recipeDepthFor(artifactId, recipes, visiting = new Set(), memo = new Map()) {
  const id = String(artifactId || '').trim();
  if (!id) return 0;
  if (memo.has(id)) return memo.get(id);
  if (visiting.has(id)) throw new Error(`法寶配方形成循環套娃：${[...visiting, id].join(' → ')}`);

  visiting.add(id);
  const recipe = Array.isArray(recipes?.[id]) ? recipes[id] : [];
  const dependencies = recipe
    .filter((row) => row?.artifactId)
    .map((row) => String(row.artifactId).trim())
    .filter(Boolean);

  let depth = 0;
  for (const dependencyId of dependencies) {
    if (dependencyId === id) throw new Error(`法寶 ${id} 不可把自己當成煉器材料`);
    depth = Math.max(depth, 1 + recipeDepthFor(dependencyId, recipes, visiting, memo));
  }
  visiting.delete(id);
  memo.set(id, depth);
  return depth;
}

export function artifactRecipeDepth(artifactId, recipes = ARTIFACT_RECIPES) {
  return recipeDepthFor(artifactId, recipes, new Set(), new Map());
}

export function repairArtifactRecipes(rawRecipes = {}, options = {}) {
  const source = rawRecipes && typeof rawRecipes === 'object' && !Array.isArray(rawRecipes) ? rawRecipes : {};
  const artifactIds = new Set(
    Array.isArray(options?.artifactIds)
      ? options.artifactIds.map((id) => String(id || '').trim()).filter(Boolean)
      : ARTIFACT_CATALOG.map((item) => String(item?.id || '').trim()).filter(Boolean)
  );
  const materialIds = new Set(
    Array.isArray(options?.materialIds)
      ? options.materialIds.map((id) => String(id || '').trim()).filter(Boolean)
      : MATERIAL_CATALOG.map((item) => String(item?.id || '').trim()).filter(Boolean)
  );
  const normalized = {};
  const invalidRecipeIds = new Set();
  const reasons = [];

  Object.entries(source).forEach(([artifactId, rawRecipe]) => {
    const id = String(artifactId || '').trim();
    if (!id) return;
    const recipe = normalizeArtifactRecipe(rawRecipe);
    normalized[id] = recipe;

    if (!artifactIds.has(id)) {
      invalidRecipeIds.add(id);
      reasons.push({ recipeId: id, reason: 'recipe-target-missing', missingId: id });
      return;
    }

    for (const row of recipe) {
      if (row.materialId && !materialIds.has(String(row.materialId))) {
        invalidRecipeIds.add(id);
        reasons.push({ recipeId: id, reason: 'material-missing', missingId: String(row.materialId) });
        break;
      }
      if (row.artifactId && !artifactIds.has(String(row.artifactId))) {
        invalidRecipeIds.add(id);
        reasons.push({ recipeId: id, reason: 'artifact-missing', missingId: String(row.artifactId) });
        break;
      }
    }
  });

  // 一個配方失效後，所有以該「成品」當作二次煉製材料的上游配方也一併取消，
  // 避免刪除法寶後留下不可重現的殘缺配方鏈。
  let changed = true;
  while (changed) {
    changed = false;
    Object.entries(normalized).forEach(([id, recipe]) => {
      if (invalidRecipeIds.has(id)) return;
      const brokenDependency = recipe.find((row) => row?.artifactId && invalidRecipeIds.has(String(row.artifactId)));
      if (!brokenDependency) return;
      invalidRecipeIds.add(id);
      reasons.push({ recipeId: id, reason: 'depends-on-invalid-recipe', missingId: String(brokenDependency.artifactId) });
      changed = true;
    });
  }

  const repaired = {};
  Object.entries(normalized).forEach(([id, recipe]) => {
    if (!invalidRecipeIds.has(id) && recipe.length) repaired[id] = recipe;
  });

  return {
    recipes: validateArtifactRecipes(repaired),
    removedRecipeIds: [...invalidRecipeIds],
    reasons,
    changed: invalidRecipeIds.size > 0
  };
}

export function validateArtifactRecipes(rawRecipes = {}) {
  const source = rawRecipes && typeof rawRecipes === 'object' && !Array.isArray(rawRecipes) ? rawRecipes : {};
  const result = {};
  Object.entries(source).forEach(([artifactId, rawRecipe]) => {
    const id = String(artifactId || '').trim();
    if (!id) return;
    const recipe = normalizeArtifactRecipe(rawRecipe);
    recipe.forEach((row) => {
      if (row.materialId && !getMaterialById(row.materialId)) {
        throw new Error(`配方 ${id} 使用不存在的材料：${row.materialId}`);
      }
      if (row.artifactId && !getArtifactById(row.artifactId)) {
        throw new Error(`配方 ${id} 使用不存在的法寶：${row.artifactId}`);
      }
    });
    const totalItems = recipe.reduce((sum, row) => sum + Math.max(0, Number(row.quantity) || 0), 0);
    if (recipe.length && totalItems < MIN_ARTIFACT_RECIPE_MATERIALS) {
      throw new Error(`配方 ${id} 至少需要 ${MIN_ARTIFACT_RECIPE_MATERIALS} 個煉器素材，目前只有 ${totalItems} 個`);
    }
    if (totalItems > MAX_ARTIFACT_RECIPE_MATERIALS) {
      throw new Error(`配方 ${id} 共需 ${totalItems} 個煉器素材，超過煉器陣 ${MAX_ARTIFACT_RECIPE_MATERIALS} 格上限`);
    }
    if (recipe.length) result[id] = recipe;
  });

  const memo = new Map();
  for (const artifact of ARTIFACT_CATALOG) {
    const depth = recipeDepthFor(artifact.id, result, new Set(), memo);
    if (depth > MAX_ARTIFACT_RECIPE_NESTING) {
      throw new Error(`法寶 ${artifact.name} 的二次煉製套娃深度為 ${depth}，最多只允許 ${MAX_ARTIFACT_RECIPE_NESTING} 層`);
    }
  }
  return result;
}

export const ARTIFACT_RECIPES = validateArtifactRecipes(DEFAULT_ARTIFACT_RECIPES);

export function getDefaultArtifactRecipes() {
  return clone(validateArtifactRecipes(DEFAULT_ARTIFACT_RECIPES));
}

// Recipe schema migration only: restore built-in recipes that may have been lost
// by an older catalog race, while preserving remote/admin/AI recipes verbatim.
// Invalid remote entries are intentionally left for repairArtifactRecipes().
export function mergeArtifactRecipesWithDefaults(rawRecipes = {}) {
  const source = rawRecipes && typeof rawRecipes === 'object' && !Array.isArray(rawRecipes)
    ? rawRecipes : {};
  const merged = clone(DEFAULT_ARTIFACT_RECIPES);
  Object.entries(source).forEach(([artifactId, recipe]) => {
    const id = String(artifactId || '').trim();
    if (!id) return;
    merged[id] = normalizeArtifactRecipe(recipe);
  });
  return merged;
}

export function replaceArtifactRecipes(recipes, source = 'runtime') {
  const normalized = validateArtifactRecipes(recipes);
  Object.keys(ARTIFACT_RECIPES).forEach((key) => delete ARTIFACT_RECIPES[key]);
  Object.assign(ARTIFACT_RECIPES, normalized);
  if (typeof window !== 'undefined') {
    window.XIUXIAN_ARTIFACT_RECIPES = ARTIFACT_RECIPES;
    window.dispatchEvent(new CustomEvent('artifact-recipes-updated', { detail: { source, count: Object.keys(ARTIFACT_RECIPES).length } }));
  }
  return ARTIFACT_RECIPES;
}

export function getArtifactRecipe(artifactId) {
  return clone(ARTIFACT_RECIPES[String(artifactId || '').trim()] || []);
}

if (typeof window !== 'undefined') {
  window.XIUXIAN_MATERIAL_CATALOG = MATERIAL_CATALOG;
  window.XIUXIAN_MATERIAL_REALMS = MATERIAL_REALMS;
  window.XIUXIAN_ARTIFACT_RECIPES = ARTIFACT_RECIPES;
}

// 煉器材料與法寶配方的資料來源。
// 材料清單與配方可由 material-catalog-sync.js 以 Firestore 全站設定覆蓋。

export const MATERIAL_CATEGORIES = Object.freeze(['礦石', '靈木', '晶石', '妖獸材料', '符材', '其他']);

const DEFAULT_MATERIAL_CATALOG = [
  { id: 'spirit-iron', name: '玄鐵', icon: '鐵', category: '礦石', description: '常見煉器礦材，可鍛造兵刃與護具。', buyGold: 18 },
  { id: 'spirit-wood', name: '靈木', icon: '木', category: '靈木', description: '蘊含靈氣的木材，適合法尺、玉佩與靈器骨架。', buyGold: 14 },
  { id: 'spirit-crystal', name: '靈晶', icon: '晶', category: '晶石', description: '凝聚靈力的晶石，常用於高階法寶核心。', buyGold: 28 },
  { id: 'beast-core-shard', name: '妖丹碎片', icon: '丹', category: '妖獸材料', description: '妖獸內丹碎片，可為法寶注入爆發性的靈力。', buyGold: 35 },
  { id: 'talisman-paper', name: '靈符紙', icon: '符', category: '符材', description: '承載符紋與陣法的基礎材料。', buyGold: 10 }
];

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
    { materialId: 'spirit-iron', quantity: 5 },
    { materialId: 'spirit-crystal', quantity: 4 },
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

export function normalizeMaterialDefinition(raw = {}) {
  return {
    id: String(raw.id || '').trim(),
    name: String(raw.name || '').trim(),
    icon: String(raw.icon || '材').trim().slice(0, 4) || '材',
    category: String(raw.category || '其他').trim() || '其他',
    description: String(raw.description || '').trim(),
    buyGold: Math.max(0, Math.floor(finite(raw.buyGold, 0)))
  };
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
    return item;
  });
}

export const MATERIAL_CATALOG = DEFAULT_MATERIAL_CATALOG.map(normalizeMaterialDefinition);

export function getDefaultMaterialCatalog() {
  return clone(DEFAULT_MATERIAL_CATALOG.map(normalizeMaterialDefinition));
}

export function replaceMaterialCatalog(items, source = 'runtime') {
  const normalized = validateMaterialCatalog(items);
  MATERIAL_CATALOG.splice(0, MATERIAL_CATALOG.length, ...normalized);
  if (typeof window !== 'undefined') {
    window.XIUXIAN_MATERIAL_CATALOG = MATERIAL_CATALOG;
    window.dispatchEvent(new CustomEvent('material-catalog-updated', { detail: { source, count: MATERIAL_CATALOG.length } }));
  }
  return MATERIAL_CATALOG;
}

export function getMaterialById(id) {
  return MATERIAL_CATALOG.find((item) => item.id === id) || null;
}

export function normalizeArtifactRecipe(recipe = []) {
  const totals = new Map();
  (Array.isArray(recipe) ? recipe : []).forEach((row) => {
    const materialId = String(row?.materialId || '').trim();
    const quantity = Math.max(0, Math.floor(finite(row?.quantity, 0)));
    if (!materialId || quantity <= 0) return;
    totals.set(materialId, (totals.get(materialId) || 0) + quantity);
  });
  return [...totals.entries()].map(([materialId, quantity]) => ({ materialId, quantity }));
}

export function validateArtifactRecipes(rawRecipes = {}) {
  const source = rawRecipes && typeof rawRecipes === 'object' && !Array.isArray(rawRecipes) ? rawRecipes : {};
  const result = {};
  Object.entries(source).forEach(([artifactId, rawRecipe]) => {
    const id = String(artifactId || '').trim();
    if (!id) return;
    const recipe = normalizeArtifactRecipe(rawRecipe);
    recipe.forEach((row) => {
      if (!getMaterialById(row.materialId)) throw new Error(`配方 ${id} 使用不存在的材料：${row.materialId}`);
    });
    if (recipe.length) result[id] = recipe;
  });
  return result;
}

export const ARTIFACT_RECIPES = validateArtifactRecipes(DEFAULT_ARTIFACT_RECIPES);

export function getDefaultArtifactRecipes() {
  return clone(validateArtifactRecipes(DEFAULT_ARTIFACT_RECIPES));
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
  window.XIUXIAN_ARTIFACT_RECIPES = ARTIFACT_RECIPES;
}

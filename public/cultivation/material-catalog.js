// 煉器材料與法寶配方的資料來源。
// 材料清單與配方可由 material-catalog-sync.js 以 Firestore 全站設定覆蓋。

import { ARTIFACT_REALMS } from './artifact-catalog.js';

export const MATERIAL_CATEGORIES = Object.freeze(['礦石', '靈木', '晶石', '妖獸材料', '符材', '其他']);
export const MAX_ARTIFACT_RECIPE_MATERIALS = 8;

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

const DEFAULT_MATERIAL_REALM_BY_ID = Object.freeze({
  'spirit-iron': '煉氣',
  'spirit-wood': '煉氣',
  'talisman-paper': '築基',
  'spirit-crystal': '金丹',
  'beast-core-shard': '金丹'
});

const DEFAULT_MATERIAL_CATALOG = [
  { id: 'spirit-iron', name: '玄鐵', icon: '鐵', category: '礦石', realm: '煉氣', description: '常見煉器礦材，可鍛造兵刃與護具。', buyGold: 18 },
  { id: 'spirit-wood', name: '靈木', icon: '木', category: '靈木', realm: '煉氣', description: '蘊含靈氣的木材，適合法尺、玉佩與靈器骨架。', buyGold: 14 },
  { id: 'spirit-crystal', name: '靈晶', icon: '晶石', category: '晶石', realm: '金丹', description: '凝聚靈力的晶石，常用於高階法寶核心。', buyGold: 28 },
  { id: 'beast-core-shard', name: '妖丹碎片', icon: '丹', category: '妖獸材料', realm: '金丹', description: '妖獸內丹碎片，可為法寶注入爆發性的靈力。', buyGold: 35 },
  { id: 'talisman-paper', name: '靈符紙', icon: '符', category: '符材', realm: '築基', description: '承載符紋與陣法的基礎材料。', buyGold: 10 }
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
  return {
    id,
    name: String(raw.name || '').trim(),
    icon: String(raw.icon || '材').trim().slice(0, 4) || '材',
    category: String(raw.category || '其他').trim() || '其他',
    realm: String(raw.realm || fallbackRealm).trim() || fallbackRealm,
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
    if (!MATERIAL_REALMS.some((realm) => realm.name === item.realm)) throw new Error(`材料 ${item.name} 使用未知境界：${item.realm}`);
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
    window.XIUXIAN_MATERIAL_REALMS = MATERIAL_REALMS;
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
    const totalMaterials = recipe.reduce((sum, row) => sum + Math.max(0, Number(row.quantity) || 0), 0);
    if (totalMaterials > MAX_ARTIFACT_RECIPE_MATERIALS) {
      throw new Error(`配方 ${id} 共需 ${totalMaterials} 個材料，超過煉器陣 ${MAX_ARTIFACT_RECIPE_MATERIALS} 格上限`);
    }
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
  window.XIUXIAN_MATERIAL_REALMS = MATERIAL_REALMS;
  window.XIUXIAN_ARTIFACT_RECIPES = ARTIFACT_RECIPES;
}

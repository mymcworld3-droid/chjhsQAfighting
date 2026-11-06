// 現役鍛造只使用同款法器、煉器碎片與二／三階升階石。
// 舊木鐵素材不再發放或參與配方；僅由舊物品分解 API 供玩家換回碎片。

import { ARTIFACT_CATALOG, ARTIFACT_REALMS, getArtifactById } from './artifact-catalog.js';
import './item-icons.js';

export const MATERIAL_CATEGORIES = Object.freeze(['鐵材', '木材', '礦石', '兵器材料', '靈木', '晶石', '妖獸材料', '特殊材料', '符材', '其他']);
export const MATERIAL_WEAPON_FORMS = Object.freeze(['','劍','刀','槍','弓','斧','錘','戟','棍','鞭','匕首','飛劍','法盾','法杖','符籙','陣盤','寶珠','玉佩','法鏡','鈴','幡','印','鼎','鐘','器胚']);
export const MIN_ARTIFACT_RECIPE_MATERIALS = 2;
export const MAX_ARTIFACT_RECIPE_MATERIALS = 8;
export const MAX_ARTIFACT_RECIPE_NESTING = 2;
export const MATERIAL_CATALOG_SCHEMA_VERSION = 6;
export const ARTIFACT_RECIPE_SCHEMA_VERSION = 3;

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

// 保留的物品型道具僅有二階與三階升階石，舊素材不再出現在目錄。
const DEFAULT_MATERIAL_CATALOG = [
  { id: 'raid-refine-key-ii', name: '二階升級石', icon: '二階', category: '升級石', realm: '築基',
    description: '第二次煉製所需的升階石，由秘境、試煉塔及任務取得。', buyGold: 0 },
  { id: 'raid-refine-key-iii', name: '三階升級石', icon: '三階', category: '升級石', realm: '金丹',
    description: '第三次煉製所需的升階石，由秘境、試煉塔及任務取得。', buyGold: 0 }
];

const DEFAULT_MATERIAL_REALM_BY_ID = Object.freeze(Object.fromEntries(
  DEFAULT_MATERIAL_CATALOG.map((item) => [item.id, item.realm])
));

// 僅供相容舊存檔的配方由伺服器個別追溯煉製次數；新煉製不再有配方。
const DEFAULT_ARTIFACT_RECIPES = {};

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

export const RAID_CRAFT_MATERIAL_IDS = Object.freeze([]);
export const RAID_REFINEMENT_KEYS = Object.freeze({
  2: 'raid-refine-key-ii',
  3: 'raid-refine-key-iii'
});
export const RAID_EXCLUSIVE_MATERIAL_IDS = Object.freeze([
  ...RAID_CRAFT_MATERIAL_IDS,
  ...Object.values(RAID_REFINEMENT_KEYS)
]);

export function raidRefinementKeyRequirement(stage, realm) {
  const level = Math.floor(Number(stage) || 0);
  if (level !== 2 && level !== 3) return { stage: level, materialId: '', quantity: 0 };
  // 凡人=0、煉氣=1 ... 真仙=10。第二煉約每兩個境界多一枚；
  // 第三煉更稀有，約每 1.5 個境界多一枚。
  const order = Math.max(1, materialRealmOrderByName(realm));
  const quantity = level === 2
    ? Math.max(1, Math.ceil(order / 2))
    : Math.max(1, Math.ceil(order * 2 / 3));
  return { stage: level, materialId: RAID_REFINEMENT_KEYS[level], quantity };
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

export function materialDropRateFor() {
  // 問道、洞天、商店與一般活動都不再自然產出煉器素材。
  return 0;
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
  const artwork=globalThis.QAItemIcons?.url(raw);
  if (artwork) item.imageUrl=artwork;
  else if (raw.imageUrl) item.imageUrl = String(raw.imageUrl).trim().slice(0, 2048);
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
  const allowed = new Set(Object.keys(DEFAULT_MATERIAL_REALM_BY_ID));
  if (items.length !== allowed.size) throw new Error('現行鍛造資源僅保留兩種升階石');
  const normalized = items.map((raw) => {
    const item = normalizeMaterialDefinition(raw);
    if (!allowed.has(item.id)) throw new Error(`材料 ${item.id || '空白'} 已停用；鍛造只保留二階、三階升階石`);
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(item.id)) throw new Error(`材料 ID 不合法：${item.id || '空白'}`);
    if (seen.has(item.id)) throw new Error(`材料 ID 重複：${item.id}`);
    seen.add(item.id);
    if (!item.name) throw new Error(`材料 ${item.id} 缺少名稱`);
    if (!MATERIAL_REALMS.some((realm) => realm.name === item.realm)) throw new Error(`材料 ${item.name} 使用未知境界：${item.realm}`);
    return item;
  });
  if ([...allowed].some((id) => !seen.has(id))) throw new Error('二、三階升階石必須完整保留');
  return normalized;
}

export const MATERIAL_CATALOG = DEFAULT_MATERIAL_CATALOG.map(normalizeMaterialDefinition);

export function getDefaultMaterialCatalog() {
  return clone(DEFAULT_MATERIAL_CATALOG.map(normalizeMaterialDefinition));
}

// Schema v6：只顯示二、三階升階石，舊素材透過獨立分解相容層保留。
export function mergeMaterialCatalogWithDefaults(items = []) {
  const merged = new Map(getDefaultMaterialCatalog().map((item) => [item.id, item]));
  (Array.isArray(items) ? items : []).forEach((raw) => {
    const id = String(raw?.id || '').trim();
    if (!id || !merged.has(id)) return;
    const base = merged.get(id) || {};
    merged.set(id, normalizeMaterialDefinition({ ...base, ...raw, id, buyGold: 0 }));
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

// 新版沒有配方；舊配方只在伺服器檢視既有法器升階紀錄時讀取。
export function mergeArtifactRecipesWithDefaults() {
  return {};
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

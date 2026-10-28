'use strict';
const { isDeepStrictEqual: equal } = require('node:util');
const pool = require('./public/cultivation/soulbound-pool.js');
const fragments = require('./public/cultivation/forge-fragments.js');
const generation = require('./artifact-generation-api.js');

const ARTIFACT = 'gameConfig/artifactCatalogV1';
const MATERIAL = 'gameConfig/materialCatalogV1';
const only = (value, keys) => Object.keys(value || {}).every(key => keys.includes(key));
const unchanged = (before, after, allowed) => equal(
  Object.fromEntries(Object.entries(before || {}).filter(([key]) => !allowed.includes(key))),
  Object.fromEntries(Object.entries(after || {}).filter(([key]) => !allowed.includes(key)))
);
function signature(recipe, method = '自由發揮') {
  return recipe.map(row => ({key:row.artifactId ? 'artifact:' + row.artifactId : 'material:' + row.materialId, quantity:row.quantity}))
    .sort((a,b) => a.key.localeCompare(b.key)).map(row => row.key + ':' + row.quantity).join('|') +
    (method && method !== '自由發揮' ? '|method:' + method : '');
}

// A narrowly scoped exception for the existing browser transaction. It never
// grants general gameConfig writes: both append-only config changes and exactly
// one award must be tied to the same completed job in the guarded SQL commit.
function mayCommitDiscovery({ tx, preview, uid, now = Date.now() }) {
  const userPath = 'users/' + uid;
  const paths = [userPath, ARTIFACT, MATERIAL];
  if (tx.writes.length !== 3 || new Set(tx.writes.map(op => op.ref.path)).size !== 3 ||
      tx.writes.some(op => !paths.includes(op.ref.path) || op.type === 'delete')) return false;
  const before = path => tx.reads.get(path)?.data();
  const user = before(userPath), nextUser = preview.get(userPath), job = user?.refineryJobV1;
  if (!job?.id || job.status !== 'refining' || !['discovery','known'].includes(job.kind) ||
      !Number.isSafeInteger(job.readyAtMs) || job.readyAtMs <= 0 || job.readyAtMs > now ||
      nextUser?.refineryJobV1 !== null || !unchanged(user, nextUser, ['artifactSystem','refineryJobV1'])) return false;
  if (!Array.isArray(job.recipe) || !job.recipe.length || job.recipe.length > 8 ||
      !generation.FORGE_METHODS.includes(job.forgeMethod || '自由發揮')) return false;
  const total = job.recipe.reduce((sum,row) => sum + (Number.isSafeInteger(row?.quantity) ? row.quantity : NaN), 0);
  if (total < 2 || total > 8 || !Number.isFinite(total) || job.recipe.some(row =>
    !row || row.quantity < 1 || Boolean(row.artifactId) === Boolean(row.materialId) ||
    !only(row, ['artifactId','materialId','quantity']))) return false;
  if (job.signature !== signature(job.recipe, job.forgeMethod)) return false;

  const oldCatalog = before(ARTIFACT) || {}, oldMaterials = before(MATERIAL) || {};
  const catalog = preview.get(ARTIFACT), materials = preview.get(MATERIAL);
  const oldItems = Array.isArray(oldCatalog.items) ? oldCatalog.items : [];
  if (!catalog || !materials || !Array.isArray(catalog.items) || catalog.items.length !== oldItems.length + 1 ||
      !equal(catalog.items.slice(1), oldItems) ||
      !unchanged(oldCatalog, catalog, ['version','items','aiGeneratedAtMs','aiGeneratedArtifactId']) ||
      !unchanged(oldMaterials, materials, ['recipes','aiGeneratedRecipeAtMs','aiGeneratedArtifactId']) ||
      catalog.version !== 1) return false;
  const item = catalog.items[0];
  if (!item || !/^ai-artifact-[a-z0-9-]{1,52}$/.test(item.id) || oldItems.some(row => row.id === item.id) || pool.get(item.id) ||
      item.recipeOwnerUid !== uid || item.generationSignature !== job.signature || item.realm !== job.targetRealm ||
      item.forgeMethod !== (job.forgeMethod || '自由發揮') || item.generatedByAI !== true || item.reviewStatus !== 'pending' ||
      typeof item.name !== 'string' || !item.name.trim() || item.name.length > 18 ||
      item.craft?.yield !== 1 || item.craft?.gold !== fragments.baseCost(item.realm) * 10 ||
      !only(item, ['id','name','icon','realm','category','description','weaponForm','forgeMethod','coreEffect','craft','effects',
        'equipSlot','soulboundRefinementVersion','soulboundBalanceVersion','reviewStatus','generatedByAI','generatedAtMs','recipeOwnerUid',
        'recipeOwnerName','recipeDiscoveredAtMs','generationSignature','generationMaterials','aiProvider','aiModel'])) return false;
  if (catalog.aiGeneratedArtifactId !== item.id || materials.aiGeneratedArtifactId !== item.id ||
      !Number.isSafeInteger(catalog.aiGeneratedAtMs) || !Number.isSafeInteger(materials.aiGeneratedRecipeAtMs)) return false;
  const oldRecipes = oldMaterials.recipes || {};
  if (Object.hasOwn(oldRecipes, item.id) || !equal(materials.recipes, {...oldRecipes, [item.id]:job.recipe})) return false;

  const artifacts = new Map([...fragments.DEFAULT_ARTIFACTS, ...oldItems, ...pool.ITEMS].map(row => [row.id,pool.balanceArtifact(row)]));
  const sources = [];
  for (const row of job.recipe) {
    const source = row.artifactId ? artifacts.get(row.artifactId) : fragments.MATERIALS.find(item => item.id === row.materialId);
    if (!source) return false;
    if (source.equipSlot === '本命法寶') sources.push(source);
  }
  const bound = sources.length > 0;
  if (!bound || item.equipSlot !== '本命法寶' || item.soulboundRefinementVersion !== pool.REFINEMENT_VERSION ||
      item.soulboundBalanceVersion !== pool.BALANCE_VERSION) return false;
  if (oldItems.some(existing => Array.isArray(oldRecipes[existing.id]) &&
      signature(oldRecipes[existing.id], existing.forgeMethod) === job.signature &&
      pool.refinementCompatible(existing, bound, sources))) return false;
  if ((item.equipSlot === '本命法寶') !== bound || !Array.isArray(item.effects) || !item.effects.length ||
      item.effects.length > (bound ? pool.MAX_REFINEMENT_EFFECTS : Math.min(3, job.refinementStage || 1)) ||
      ![1,2,3].includes(job.refinementStage) || !item.effects.some(effect => effect.type === item.coreEffect)) return false;
  if (new Set(item.effects.map(effect => effect.type)).size !== item.effects.length) return false;
  const order = fragments.order(item.realm);
  if (order < 1) return false;
  const equipped = item.effects.some(effect => effect.type.startsWith('equip_'));
  if (equipped ? !['本命法寶','護身法寶','佩飾法寶','輔助法寶'].includes(item.equipSlot) : Boolean(item.equipSlot)) return false;
  let required = [];
  if (bound) {
    try { required = pool.refineEffects([], sources); pool.assertRefinementImproves(item, sources); }
    catch (_) { return false; }
  }
  for (const effect of item.effects) {
    if (!generation.ALLOWED_EFFECTS.has(effect.type) || !only(effect, ['type','value','multiplier','durationMs','contexts','perQuestion'])) return false;
    const range = pool.effectRange(effect.type, order, job.refinementStage, total);
    const inherited = bound && sources.some(source => source.effects?.some(row => row.type === effect.type));
    if (!range && !inherited) return false;
    if (range?.field === 'none' || inherited && !Object.hasOwn(effect, 'value')) {
      if (!only(effect, ['type'])) return false;
    } else if (effect.type.startsWith('equip_')) {
      if (!Number.isFinite(effect.value) || effect.value < 0) return false;
      const inheritedFloor = required.find(row => row.type === effect.type)?.value || 0;
      const max = bound ? Math.min(pool.refinementCap(effect.type, pool.PERCENT_EFFECT_CAPS[effect.type] ?? Infinity, true),
        Math.max(range?.max || 0, inheritedFloor)) : range.max;
      if ((!inherited && range && effect.value < range.min) || effect.value > max || (effect.type === 'equip_damage_cap_percent' && effect.value < pool.EFFECT_BOUNDS.equip_damage_cap_percent.min)) return false;
    } else if (effect.type.startsWith('timed_')) {
      if (!Number.isFinite(effect.multiplier) || effect.multiplier < range.min || effect.multiplier > range.max ||
          !Number.isSafeInteger(effect.durationMs) || effect.durationMs < Math.round(range.durationMinutesMin * 60000) || effect.durationMs > Math.round(range.durationMinutesMax * 60000)) return false;
    } else if (!equal(effect.contexts, ['quiz','battle','dongtian']) || effect.perQuestion !== 1) return false;
  }
  const system = user.artifactSystem && typeof user.artifactSystem === 'object' ? user.artifactSystem : {inventory:{},equipped:{},buffs:[]};
  const inventory = Object.fromEntries(Object.entries(system.inventory || {}).map(([id,value]) =>
    [id, Math.max(0, Math.floor(Number(value) || 0))]).filter(([,value]) => value));
  inventory[item.id] = (inventory[item.id] || 0) + 1;
  return equal(nextUser.artifactSystem, {...system, inventory});
}
module.exports = { mayCommitDiscovery };

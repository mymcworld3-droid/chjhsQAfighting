// Display-only rules. Rewards and equipment mutations remain in their existing transactions.
(function (root) {
  'use strict';
  const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  function canReadRecipe(player, item, uid) {
    return !!item && (player?.isAdmin === true || (!!uid && item.recipeOwnerUid === uid) ||
      player?.recipeLicenses?.[item.id] === true || (!item.recipeOwnerUid && item.recipeSaleLocked !== true));
  }
  function ingredients(player, recipe, { getMaterial, getArtifact } = {}) {
    const rows = new Map();
    for (const row of recipe || []) {
      const type = row.artifactId ? 'artifact' : 'material', id = String(row.artifactId || row.materialId || '');
      const token = type + ':' + id;
      if (!id || !count(row.quantity)) continue;
      const old = rows.get(token) || { type, id, token, need:0 };
      old.need += count(row.quantity); rows.set(token, old);
    }
    return [...rows.values()].map(row => {
      const item = row.type === 'artifact' ? getArtifact?.(row.id) : getMaterial?.(row.id);
      const equipped = Object.values(player?.artifactSystem?.equipped || {}).filter(id => id === row.id).length;
      const have = row.type === 'artifact'
        ? Math.max(0, count(player?.artifactSystem?.inventory?.[row.id]) - equipped)
        : player?.isAdmin === true ? row.need : count(player?.materialSystem?.inventory?.[row.id]);
      return { ...row, name:item?.name || row.id, have, missing:Math.max(0, row.need - have) };
    });
  }
  function materialSource(id, tiers, score = 0) {
    const options = Object.values(tiers || {}).filter(tier => tier.materials?.includes(id));
    const tier = options.find(item => count(score) >= item.minScore) || options[0];
    return tier ? { difficulty:tier.id, label:tier.name + '清霜試煉', locked:count(score) < tier.minScore, minRealm:tier.minRealm }
      : { difficulty:'normal', label:'清霜試煉', locked:count(score) < 6, minRealm:'築基期' };
  }
  function statChanges(before = {}, after = {}) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter(key => before[key]?.value !== after[key]?.value).map(key => ({
      key, label:after[key]?.label || before[key]?.label || key,
      before:before[key] || null, after:after[key] || null,
      delta:Number.isFinite(before[key]?.value) && Number.isFinite(after[key]?.value)
        ? Math.round((after[key].value - before[key].value) * 100) / 100 : null
    }));
  }
  const api = Object.freeze({ count, canReadRecipe, ingredients, materialSource, statChanges });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QAPlayerGrowth = api;
})(globalThis);

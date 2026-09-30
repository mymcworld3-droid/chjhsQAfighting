'use strict';
// Small, guaranteed bundles; IDs are existing ordinary refinery materials.
const REALMS = [
  [0,'凡人','spirit-herb','spirit-herb'],
  [1,'煉氣','spirit-iron','azure-spirit-stone'],
  [10,'築基','red-copper-essence','cold-jade'],
  [28,'金丹','purple-gold-sand','spirit-crystal'],
  [68,'元嬰','taixu-mystic-iron','nascent-soul-crystal'],
  [188,'化神','nine-heaven-crystal','heaven-thunder-crystal'],
  [428,'煉虛','void-stone','kongming-crystal'],
  [788,'合體','hunyuan-gold','immortal-spirit-jade'],
  [1268,'大乘','chaos-crystal','primordial-divine-wood'],
  [1868,'渡劫','nine-heaven-divine-iron','tribulation-thunder-core'],
  [2588,'真仙','immortal-gold','immortal-crystal']
];
function realmMaterials(score, catalog) {
  const row = REALMS.filter(r => Number(score) >= r[0]).at(-1) || REALMS[0];
  // Admin catalogs can remove/change materials; respect the current complete
  // schema, while old partial catalogs keep default IDs like the browser does.
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  const complete = Number(catalog?.materialCatalogSchemaVersion) >= 3 && items.length > 0;
  const rewards = {};
  for (const [id,amount] of [[row[2],2],[row[3],1]]) {
    const item = items.find(m => m?.id === id);
    if (complete && (!item || item.realm !== row[1])) continue;
    if (item?.enabled === false || item?.realm && item.realm !== row[1]) continue;
    rewards[id] = (rewards[id] || 0) + amount;
  }
  return {realm:row[1],rewards};
}
function victoryDate(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return null;
  // Reset at midnight Taiwan time; use the trusted finish time, never claim time.
  return new Date(Number(ms) + 8 * 3600000).toISOString().slice(0,10);
}
const MEMENTO = Object.freeze({name:'清霜劍印',description:'首次通過沈清霜試煉的永久紀念。'});
module.exports = {REALMS,realmMaterials,victoryDate,MEMENTO};

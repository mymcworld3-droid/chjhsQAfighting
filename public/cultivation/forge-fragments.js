// 煉器碎片：瀏覽器與伺服器共用的數值，不接受客戶端指定分解售價。
(function (root) {
  'use strict';
  const VERSION = 'forge-fragments-v1';
  const FIELD = 'forgeFragments';
  const REALMS = Object.freeze(['凡人','煉氣','築基','金丹','元嬰','化神','煉虛','合體','渡劫','半仙','真仙']);
  const BASE = Object.freeze([6,12,24,42,70,110,165,235,325,440,580]);
  const integer = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const order = realm => Math.max(0, REALMS.indexOf(realm === '大乘' ? '渡劫' : realm));
  const baseCost = realm => BASE[order(realm)];
  const balance = player => integer(player?.[FIELD]);
  function unitValue(type, item) {
    if (!item || item.id === 'nascent-soul-essence' || item.nascentMaterial) return 0;
    if (type === 'material') return Math.max(1, Math.floor(baseCost(item.realm) / 3));
    if (type === 'artifact') return Math.max(1, Math.floor(baseCost(item.realm) * (item.equipSlot === '本命法寶' ? 1 : .5)));
    return 0;
  }
  // The small fallback mirrors the built-in catalog. Remote generated artifacts
  // are resolved from the authoritative gameConfig document during a transaction.
  const DEFAULT_ARTIFACTS = Object.freeze([
    ['seven-treasure-ruler','七寶玲瓏尺','築基',''], ['war-drum','破軍戰鼓','金丹',''],
    ['enlightenment-lamp','悟道玄燈','金丹',''], ['mountain-armor','鎮嶽玄甲','金丹','護身法寶'],
    ['void-sword','太虛劍','元嬰','本命法寶'], ['longevity-jade','長生玉佩','元嬰','佩飾法寶']
  ].map(([id,name,realm,equipSlot]) => Object.freeze({id,name,realm,equipSlot})));
  const MATERIALS = Object.freeze([
    ['qi-spirit-iron','玄鐵','煉氣'], ['foundation-refined-iron','精煉玄鐵','築基'],
    ['golden-purple-iron','紫金玄鐵','金丹'], ['qi-spirit-wood','靈木','煉氣'],
    ['foundation-century-wood','百年靈木','築基'], ['golden-lightning-wood','雷擊木','金丹'],
    ['nascent-star-iron','玄冥星鐵','元嬰'], ['nascent-soul-wood','千載魂木','元嬰'],
    ['raid-refine-key-ii','淬靈玄印','築基'], ['raid-refine-key-iii','玄天道印','金丹']
  ].map(([id,name,realm]) => Object.freeze({id,name,realm})));
  const api = Object.freeze({VERSION,FIELD,REALMS,BASE,integer,order,baseCost,balance,unitValue,DEFAULT_ARTIFACTS,MATERIALS});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QAForgeFragments = api;
})(globalThis);

export const REFINERY_JOB_FIELD = 'refineryJobV1';

export const REFINERY_REALMS = Object.freeze([
  '凡人','煉氣','築基','金丹','元嬰','化神','煉虛','合體','大乘','渡劫','真仙'
]);

const BASE_GOLD = Object.freeze([20,35,60,95,150,230,340,490,680,920,1200]);
const BASE_SECONDS = Object.freeze([12,20,32,48,70,98,132,172,220,276,340]);

export function refineryRealmOrder(name) {
  const index = REFINERY_REALMS.indexOf(String(name || '').trim());
  return index < 0 ? 0 : index;
}

export function baseRealmForgeGold(realm) {
  return BASE_GOLD[refineryRealmOrder(realm)] || BASE_GOLD[0];
}

export function calculateRefineryEconomy({
  targetRealm = '凡人',
  playerRealm = '凡人',
  baseGold = 0,
  discovery = false
} = {}) {
  const targetOrder = refineryRealmOrder(targetRealm);
  const playerOrder = refineryRealmOrder(playerRealm);
  const gap = targetOrder - playerOrder;

  const realmGold = Math.max(BASE_GOLD[targetOrder] || BASE_GOLD[0], Math.max(0, Number(baseGold) || 0));
  const goldGapMultiplier = gap > 0 ? 1 + gap * 0.35 : Math.max(0.60, 1 + gap * 0.08);
  const timeGapMultiplier = gap > 0 ? 1 + gap * 0.25 : Math.max(0.55, 1 + gap * 0.07);
  const discoveryMultiplier = discovery ? 1.25 : 1;

  const gold = Math.max(1, Math.round(realmGold * goldGapMultiplier * discoveryMultiplier));
  const durationMs = Math.max(
    5000,
    Math.round((BASE_SECONDS[targetOrder] || BASE_SECONDS[0]) * 1000 * timeGapMultiplier * discoveryMultiplier)
  );

  return {
    gold,
    durationMs,
    targetRealm,
    playerRealm,
    targetOrder,
    playerOrder,
    realmGap: gap,
    discovery: !!discovery
  };
}

export function formatRefineryDuration(ms) {
  const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain ? `${hours} 小時 ${remain} 分` : `${hours} 小時`;
}

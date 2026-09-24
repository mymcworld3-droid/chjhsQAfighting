// 元嬰規則純函式：九種丹性皆有唯一對應元嬰；神識與原修為分開儲存。
export const NASCENT_SOUL_THRESHOLD = 68;
export const NASCENT_SOUL_TYPES = Object.freeze({
  ocean: Object.freeze({ name: '滄海元嬰', trait: '滄海鎮岳', description: '以水勢護身，感悟滄海之力。', tone: 'ocean', icon: '≈' }),
  taichu: Object.freeze({ name: '太初元嬰', trait: '太初還神', description: '調息回元，溫養神魂。', tone: 'gold', icon: '☀' }),
  ningxin: Object.freeze({ name: '凝心元嬰', trait: '凝神守一', description: '凝聚道心，抵禦神識干擾。', tone: 'ivory', icon: '◈' }),
  pojing: Object.freeze({ name: '破境元嬰', trait: '破境衝霄', description: '聚神破障，領悟突破之機。', tone: 'amber', icon: '✦' }),
  xingchen: Object.freeze({ name: '星辰元嬰', trait: '引星入神', description: '牽引星輝，積蓄神識。', tone: 'pale', icon: '✧' }),
  wugou: Object.freeze({ name: '無垢元嬰', trait: '無垢明心', description: '滌淨雜念，保持神魂澄明。', tone: 'silver', icon: '◇' }),
  thunder: Object.freeze({ name: '雷霆元嬰', trait: '九霄雷劫', description: '以雷鍛魂，修習雷霆之道。', tone: 'thunder', icon: 'ϟ' }),
  reverse: Object.freeze({ name: '陰陽元嬰', trait: '陰陽歸一', description: '陰陽流轉，調和神魂。', tone: 'violet', icon: '↺' }),
  sword: Object.freeze({ name: '劍心元嬰', trait: '劍心追魂', description: '以神御劍，凝煉劍意。', tone: 'silver', icon: '⚔' })
});
export const NASCENT_SOUL_STAGES = Object.freeze([
  Object.freeze({ min: 0, name: '初生' }),
  Object.freeze({ min: 30, name: '凝神' }),
  Object.freeze({ min: 80, name: '通靈' }),
  Object.freeze({ min: 150, name: '化形' }),
  Object.freeze({ min: 250, name: '圓滿' })
]);

export function normalizeSpirit(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
export function nascentSoulForCore(coreType) {
  return NASCENT_SOUL_TYPES[coreType] || NASCENT_SOUL_TYPES.taichu;
}
export function nascentSoulStage(spirit) {
  const amount = normalizeSpirit(spirit);
  const index = NASCENT_SOUL_STAGES.findLastIndex(stage => amount >= stage.min);
  const current = NASCENT_SOUL_STAGES[Math.max(0, index)];
  return { ...current, next: NASCENT_SOUL_STAGES[index + 1] || null };
}
export function nascentSoulSpiritReward({ source, score, isCorrect = false, correct = 0, total = 0 } = {}) {
  if (normalizeSpirit(score) < NASCENT_SOUL_THRESHOLD) return 0;
  if (source === 'solo') return isCorrect === true ? 1 : 0;
  if (source === 'daily-meditation') return Number(correct) === 3 && Number(total) === 3 ? 3 : 0;
  if (source === 'dongtian') {
    const amount = normalizeSpirit(correct);
    return Math.min(amount, normalizeSpirit(total));
  }
  return 0;
}

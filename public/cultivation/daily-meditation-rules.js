// 每日閉關數值表。獎勵由境界與連續天數決定，不套用一般答題／法寶倍率。
const DAILY_MEDITATION_REALMS = Object.freeze([
  { min: 0, name: '煉氣', cultivation: 1, gold: 10 },
  { min: 6, name: '築基', cultivation: 2, gold: 20 },
  { min: 28, name: '金丹', cultivation: 3, gold: 30 },
  { min: 68, name: '元嬰', cultivation: 4, gold: 45 },
  { min: 188, name: '化神', cultivation: 5, gold: 60 },
  { min: 428, name: '煉虛', cultivation: 6, gold: 80 },
  { min: 788, name: '合體', cultivation: 7, gold: 100 },
  { min: 1268, name: '渡劫', cultivation: 8, gold: 130 },
  { min: 1868, name: '半仙', cultivation: 9, gold: 160 },
  { min: 2588, name: '仙道精進', cultivation: 10, gold: 200 }
]);
const DAILY_MEDITATION_STREAKS = Object.freeze([
  { min: 1, cultivation: 0, gold: 0 },
  { min: 2, cultivation: 0, gold: 10 },
  { min: 3, cultivation: 1, gold: 15 },
  { min: 5, cultivation: 1, gold: 25 },
  { min: 7, cultivation: 2, gold: 40 },
  { min: 10, cultivation: 2, gold: 50 },
  { min: 14, cultivation: 3, gold: 70 },
  { min: 21, cultivation: 3, gold: 90 },
  { min: 30, cultivation: 4, gold: 120 },
  { min: 60, cultivation: 5, gold: 160 },
  { min: 90, cultivation: 6, gold: 200 }
]);

// 永遠以台灣日期判定每日重置，避免瀏覽器所在時區不同。
function meditationDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return value.year + '-' + value.month + '-' + value.day;
}
function nextMeditationStreak(previousDate, previousStreak, today) {
  if (previousDate === today) return Math.max(1, Math.floor(Number(previousStreak) || 0));
  const previous = Date.parse(String(previousDate || '') + 'T00:00:00Z');
  const current = Date.parse(String(today || '') + 'T00:00:00Z');
  if (!Number.isFinite(previous) || !Number.isFinite(current) || current <= previous) return 1;
  return current - previous === 86400000
    ? Math.max(0, Math.floor(Number(previousStreak) || 0)) + 1 : 1;
}
function meditationReward(score, streak, correct) {
  const points = Math.max(0, Number(score) || 0);
  const days = Math.max(1, Math.floor(Number(streak) || 1));
  const count = Math.max(0, Math.min(3, Math.floor(Number(correct) || 0)));
  const realm = DAILY_MEDITATION_REALMS.filter(row => points >= row.min).at(-1);
  const bonus = DAILY_MEDITATION_STREAKS.filter(row => days >= row.min).at(-1);
  if (count < 2) return { cultivation: 0, gold: 5, baseCultivation: 0, baseGold: 5, bonusCultivation: 0, bonusGold: 0, realm: realm.name, streak: days };
  const full = count === 3;
  const baseCultivation = full ? realm.cultivation : Math.ceil(realm.cultivation / 2);
  const baseGold = full ? realm.gold : Math.ceil(realm.gold / 2);
  return {
    cultivation: baseCultivation + bonus.cultivation, gold: baseGold + bonus.gold,
    baseCultivation, baseGold, bonusCultivation: bonus.cultivation, bonusGold: bonus.gold,
    realm: realm.name, streak: days
  };
}

// 共修獎勵以出關時的境界固定，與連續天數、法寶倍率分開。
const MEDITATION_COOP_STEPS = Object.freeze([
  { stars:3, gold:1, fragments:0, raidTickets:0, drawTickets:0 },
  { stars:6, gold:1, fragments:1, raidTickets:0, drawTickets:0 },
  { stars:9, gold:2, fragments:0, raidTickets:0, drawTickets:0 },
  { stars:12, gold:1, fragments:2, raidTickets:0, drawTickets:0 },
  { stars:15, gold:1, fragments:0, raidTickets:1, drawTickets:1 }
].map(Object.freeze));
function meditationCoopReward(score, stars) {
  const step = MEDITATION_COOP_STEPS.find(row => row.stars === stars);
  if (!step) return null;
  const base = DAILY_MEDITATION_REALMS.filter(row => Number(score) >= row.min).at(-1) || DAILY_MEDITATION_REALMS[0];
  return { gold:base.gold * step.gold, fragments:step.fragments, raidTickets:step.raidTickets, drawTickets:step.drawTickets };
}
function rankMeditators(rows) {
  const timing = row => Number.isFinite(row.answerTimeMs) && row.answerTimeMs >= 0 ? row.answerTimeMs : Infinity;
  const sorted = rows.slice().sort((a,b) => b.stars-a.stars || timing(a)-timing(b) || a.uid.localeCompare(b.uid));
  let rank=0;
  return sorted.map((row,index) => {
    const previous=sorted[index-1];
    if (!previous || previous.stars!==row.stars || timing(previous)!==timing(row)) rank=index+1;
    return {...row,rank};
  });
}
const dailyMeditationRules = { DAILY_MEDITATION_REALMS, DAILY_MEDITATION_STREAKS, meditationDateKey,
  nextMeditationStreak, meditationReward, MEDITATION_COOP_STEPS, meditationCoopReward, rankMeditators };
if (typeof module === 'object' && module.exports) module.exports = dailyMeditationRules;
else globalThis.QADailyMeditationRules = dailyMeditationRules;

// Shared pure rules: used by browser settlement transactions and the server.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XianxiaQuestRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const number = value => Math.max(0, Math.floor(Number(value) || 0));
  function dateKey(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const p = Object.fromEntries(parts.map(row => [row.type, row.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  const quest = (id, title, description, metric, target, gold, cultivation, destination, minScore = 0, materials = {}) =>
    ({ id, title, description, metric, target, reward: { gold, cultivation, materials }, destination, minScore });
  const PATH = [
    quest('path-scope', '立下修習卷', '在仙府選擇至少一項學習範圍，並儲存出題範圍。', 'scope', 1, 30, 0, 'scope'),
    quest('path-first-answer', '初次問道', '問道答對 1 題，踏出修行第一步。', 'solo', 1, 30, 0, 'solo'),
    quest('path-qi-five', '引氣入體', '修為達 5，晉至煉氣五層。', 'score', 5, 50, 0, 'solo'),
    quest('path-meditation', '靜心一日', '完成 1 次每日閉關，不要求全對。', 'meditation', 1, 40, 0, 'meditation'),
    quest('path-foundation', '築基立道', '修為達 10，晉至築基初期。', 'score', 10, 100, 0, 'solo'),
    quest('path-duel', '以武會友', '完成 1 場正式鬥法，勝負皆計。', 'battle', 1, 100, 1, 'battle', 10),
    quest('path-cave', '尋訪洞天', '完成 1 次洞天答題並結算。', 'dongtian', 1, 100, 1, 'dongtian'),
    quest('path-solo-ten', '十問明心', '累計問道答對 10 題。', 'solo', 10, 120, 1, 'solo'),
    quest('path-golden', '丹成大道', '修為達 28，晉至金丹。', 'score', 28, 200, 0, 'solo'),
    quest('path-raid-one', '同門共戰', '成功通關團本 1 次。', 'raid', 1, 150, 2, 'raid', 10, { 'raid-refine-key-ii': 1 }),
    quest('path-raid-three', '並肩破敵', '累計成功通關團本 3 次。', 'raid', 3, 250, 2, 'raid', 10, { 'raid-refine-key-iii': 1 }),
    quest('path-nascent', '元嬰出竅', '修為達 68，晉至元嬰。', 'score', 68, 350, 0, 'solo'),
    quest('path-duel-five', '鬥法磨心', '累計完成 5 場正式鬥法。', 'battle', 5, 250, 2, 'battle', 10),
    quest('path-raid-ten', '護宗十戰', '累計成功通關團本 10 次。', 'raid', 10, 350, 3, 'raid', 10, { 'raid-refine-key-iii': 2 }),
    quest('path-spirit', '神念通天', '修為達 188，晉至化神。', 'score', 188, 500, 0, 'solo'),
    quest('path-solo-hundred', '百問悟道', '累計問道答對 100 題。', 'solo', 100, 400, 3, 'solo'),
    quest('path-void', '虛空悟道', '修為達 428，晉至煉虛。', 'score', 428, 700, 0, 'solo'),
    quest('path-union', '天地合一', '修為達 788，晉至合體。', 'score', 788, 900, 0, 'solo'),
    quest('path-mahayana', '大道將成', '修為達 1268，晉至大乘。', 'score', 1268, 1200, 0, 'solo'),
    quest('path-tribulation', '雷劫問道', '修為達 1868，晉至渡劫。', 'score', 1868, 1500, 0, 'solo'),
    quest('path-immortal', '仙門在望', '修為達 2588，晉至半仙。', 'score', 2588, 2000, 0, 'solo')
  ];
  const DAILY = [
    quest('daily-solo-three', '溫故知新', '今日問道答對 3 題。', 'solo', 3, 40, 1, 'solo'),
    quest('daily-solo-ten', '勤學不輟', '今日問道答對 10 題。', 'solo', 10, 80, 1, 'solo'),
    quest('daily-meditation', '靜心閉關', '今日完成每日閉關。', 'meditation', 1, 30, 0, 'meditation'),
    quest('daily-battle', '論道切磋', '今日完成 1 場正式鬥法，勝負皆計。', 'battle', 1, 80, 0, 'battle', 10),
    quest('daily-dongtian', '洞天探幽', '今日完成 1 次洞天答題並結算。', 'dongtian', 1, 60, 0, 'dongtian'),
    quest('daily-raid', '同門協力', '今日成功通關團本 1 次。', 'raid', 1, 100, 1, 'raid', 10, { 'raid-refine-key-ii': 1 })
  ];
  const METRICS = ['solo', 'meditation', 'battle', 'dongtian', 'raid'];
  function normalizeProgress(raw = {}, date = dateKey()) {
    const totals = Object.fromEntries(METRICS.map(key => [key, number(raw?.totals?.[key])]));
    const counts = Object.fromEntries(METRICS.map(key => [key, raw?.daily?.date === date ? number(raw.daily.counts?.[key]) : 0]));
    return { version: 1, totals, daily: { date, counts } };
  }
  function recordEvent(raw, metric, date = dateKey()) {
    if (!METRICS.includes(metric)) throw new Error('Unknown quest activity');
    const p = normalizeProgress(raw, date);
    p.totals[metric] += 1;
    p.daily.counts[metric] += 1;
    return p;
  }
  function normalizeState(raw = {}, date = dateKey()) {
    return { pathIndex: Math.min(PATH.length, number(raw?.pathIndex)), dailyDate: date,
      dailyClaimed: raw?.dailyDate === date && Array.isArray(raw.dailyClaimed) ? raw.dailyClaimed.filter(id => DAILY.some(q => q.id === id)) : [] };
  }
  function progressValue(q, user, p, kind, date) {
    if (q.metric === 'scope') return Array.isArray(user?.gameSettings?.focusedUnits) && user.gameSettings.focusedUnits.length ? 1 : 0;
    if (q.metric === 'score') return number(user?.stats?.totalScore);
    if (kind === 'daily' && q.metric === 'meditation' && user?.dailyMeditation?.lastDate === date) return 1;
    // Existing verified milestones remain useful for returning players.
    if (kind === 'path' && q.metric === 'meditation') return Math.max(p.totals.meditation, number(user?.dailyMeditation?.totalDays));
    if (kind === 'path' && q.metric === 'solo') return Math.max(p.totals.solo, number(user?.stats?.totalCorrect));
    if (kind === 'path' && q.metric === 'battle') return Math.max(p.totals.battle, number(user?.stats?.battleMatches));
    if (kind === 'path' && q.metric === 'raid' && user?.raidProgress?.['shen-qingshuang']?.firstVictoryRoomId) return Math.max(1, p.totals.raid);
    return kind === 'daily' ? p.daily.counts[q.metric] : p.totals[q.metric];
  }
  function view(user = {}, rawState = {}, date = dateKey()) {
    const p = normalizeProgress(user.questProgress, date), state = normalizeState(rawState, date);
    function row(q, kind, claimed = false) {
      const current = Math.min(q.target, progressValue(q, user, p, kind, date));
      const locked = number(user?.stats?.totalScore) < q.minScore;
      return { ...q, current, claimed, locked, complete: current >= q.target, claimable: !claimed && !locked && current >= q.target };
    }
    return { date, pathIndex: state.pathIndex, pathTotal: PATH.length,
      path: state.pathIndex < PATH.length ? row(PATH[state.pathIndex], 'path') : null,
      daily: DAILY.map(q => row(q, 'daily', state.dailyClaimed.includes(q.id))) };
  }
  return { PATH, DAILY, dateKey, normalizeProgress, recordEvent, normalizeState, view };
});

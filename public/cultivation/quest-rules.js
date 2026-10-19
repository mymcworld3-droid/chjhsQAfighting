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
  function weekKey(value = dateKey()) {
    const date = typeof value === 'string' ? value : dateKey(value);
    // Every weekly season begins Monday 00:00 Asia/Taipei; label by Monday date.
    const day = new Date(date + 'T00:00:00Z');
    if (!Number.isFinite(day.getTime())) return weekKey(dateKey());
    day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
    return day.toISOString().slice(0, 10);
  }
  const quest = (id, title, description, metric, target, gold, cultivation, destination, minScore = 0, materials = {}) =>
    ({ id, title, description, metric, target, reward: { gold, cultivation, materials }, destination, minScore });
  // 保留舊目錄順序，用固定 ID 將既有 pathIndex 轉成已領清單。
  const LEGACY_PATH = [
    quest('path-scope', '立下修習卷', '在設定的範圍設定選擇至少一項學習範圍，並儲存出題範圍。', 'scope', 1, 30, 0, 'scope'),
    quest('path-first-answer', '初次問道', '問道答對 1 題，踏出修行第一步。', 'solo', 1, 30, 0, 'solo'),
    quest('path-qi-five', '引氣入體', '修為達 5，晉至煉氣五層。', 'score', 5, 50, 0, 'solo'),
    quest('path-meditation', '靜心一日', '完成 1 次每日閉關，不要求全對。', 'meditation', 1, 40, 0, 'meditation'),
    quest('path-foundation', '築基立道', '修為達 6，晉至築基初期。', 'score', 6, 100, 0, 'solo'),
    quest('path-duel', '以武會友', '完成 1 場正式鬥法，勝負皆計。', 'battle', 1, 100, 1, 'battle', 6),
    quest('path-cave', '尋訪洞天', '完成 1 次洞天答題並結算。', 'dongtian', 1, 100, 1, 'dongtian'),
    quest('path-solo-ten', '十問明心', '累計問道答對 10 題。', 'solo', 10, 120, 1, 'solo'),
    quest('path-golden', '丹成大道', '修為達 28，晉至金丹。', 'score', 28, 200, 0, 'solo'),
    quest('path-raid-one', '同門共戰', '成功通關團本 1 次。', 'raid', 1, 150, 2, 'raid', 6, { 'raid-refine-key-ii': 1 }),
    quest('path-raid-three', '並肩破敵', '累計成功通關團本 3 次。', 'raid', 3, 250, 2, 'raid', 6, { 'raid-refine-key-iii': 1 }),
    quest('path-nascent', '元嬰出竅', '修為達 68，晉至元嬰。', 'score', 68, 350, 0, 'solo'),
    quest('path-duel-five', '鬥法磨心', '累計完成 5 場正式鬥法。', 'battle', 5, 250, 2, 'battle', 6),
    quest('path-raid-ten', '護宗十戰', '累計成功通關團本 10 次。', 'raid', 10, 350, 3, 'raid', 6, { 'raid-refine-key-iii': 2 }),
    quest('path-spirit', '神念通天', '修為達 188，晉至化神。', 'score', 188, 500, 0, 'solo'),
    quest('path-solo-hundred', '百問悟道', '累計問道答對 100 題。', 'solo', 100, 400, 3, 'solo'),
    quest('path-void', '虛空悟道', '修為達 428，晉至煉虛。', 'score', 428, 700, 0, 'solo'),
    quest('path-union', '天地合一', '修為達 788，晉至合體。', 'score', 788, 900, 0, 'solo'),
    quest('path-mahayana', '雷劫問道', '修為達 1268，晉至渡劫。', 'score', 1268, 1200, 0, 'solo'),
    quest('path-tribulation', '仙門在望', '修為達 1868，晉至半仙。', 'score', 1868, 1500, 0, 'solo'),
    quest('path-immortal', '仙道精進', '修為達 2588，繼續精進仙道。', 'score', 2588, 2000, 0, 'solo')
  ];
  const storyQuest = (chapterId, chapterTitle, minScore) => ({
    ...quest('path-story-' + chapterId, '觀看劇情 · ' + chapterTitle,
      '完整觀看「' + chapterTitle + '」，在結束本章後儲存觀看紀錄。', 'story', 1, minScore === 0 ? 30 : 50, 0, 'story', minScore),
    chapterId
  });
  const STORY_AFTER = {
    'path-qi-five': [storyQuest('qi-five-dongtian', '第二章 · 竹簡天尊', 5)]
  };
  const PATH_DRAW_TICKETS = Object.freeze({
    'path-golden': 1, 'path-raid-one': 2, 'path-nascent': 3, 'path-raid-ten': 5, 'path-solo-hundred': 5
  });
  const PATH = [{ ...storyQuest('prologue-enter-sect', '第一章 · 問道靈根', 0),
    title: '完成第一章 · 問道靈根',
    description: '準備好後，點「前往」認識青雲宗並完整觀看第一章；登入與選擇性別不會自動播放。' },
    ...LEGACY_PATH.flatMap(q => [q, ...(STORY_AFTER[q.id] || [])])]
    .map(q => ({ ...q, reward: { ...q.reward, drawTickets: PATH_DRAW_TICKETS[q.id] || 1 } }));
  const DAILY = [
    quest('daily-solo-three', '溫故知新', '今日問道答對 3 題。', 'solo', 3, 40, 1, 'solo'),
    quest('daily-solo-ten', '勤學不輟', '今日問道答對 10 題。', 'solo', 10, 80, 1, 'solo'),
    quest('daily-meditation', '靜心閉關', '今日完成每日閉關。', 'meditation', 1, 30, 0, 'meditation'),
    quest('daily-battle', '論道切磋', '今日完成 1 場正式鬥法，勝負皆計。', 'battle', 1, 80, 0, 'battle', 6),
    quest('daily-dongtian', '洞天探幽', '今日完成 1 次洞天答題並結算。', 'dongtian', 1, 60, 0, 'dongtian'),
    quest('daily-raid', '同門協力', '今日成功通關團本 1 次。', 'raid', 1, 100, 1, 'raid', 6, { 'raid-refine-key-ii': 1 })
  ];

  // 固定每日 UID + 臺灣日期種子；候選任務只採用現有可驗證的活動計數，
  // 特殊補強使用獨立伺服器簽發的悟道試煉完成紀錄。
  const COMMISSION_POOL = Object.freeze([
    quest('commission-solo-four', '今日誦經・四問', '今日問道答對 4 題。', 'solo', 4, 55, 0, 'solo'),
    quest('commission-solo-six', '今日誦經・六問', '今日問道答對 6 題。', 'solo', 6, 75, 0, 'solo'),
    quest('commission-solo-eight', '今日誦經・八問', '今日問道答對 8 題。', 'solo', 8, 100, 0, 'solo'),
    quest('commission-meditation', '宗門靜修令', '今日完成一次閉關，無須全對。', 'meditation', 1, 65, 0, 'meditation'),
    quest('commission-dongtian', '洞天巡訪令', '今日完成一次洞天答題並結算。', 'dongtian', 1, 85, 0, 'dongtian'),
    quest('commission-battle', '演武短箋', '今日完成一場正式鬥法，勝負皆可。', 'battle', 1, 100, 0, 'battle', 6),
    quest('commission-raid', '師門援戰令', '今日通關一次清霜秘境，任何難度均可。', 'raid', 1, 120, 0, 'raid', 6),
    quest('commission-enlightenment', '弱項研修令', '今日完成一次悟道試煉，依能力圖譜的弱項單元補強。', 'enlightenment', 1, 90, 0, 'enlightenment')
  ]);
  function seedNumber(value) {
    let hash = 2166136261;
    for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  }
  function dailyCommissions(user = {}, uid = '', date = dateKey()) {
    const score = number(user?.stats?.totalScore);
    const solo = COMMISSION_POOL.filter(q => q.metric === 'solo');
    const learningMap = user?.stats?.knowledgeMap || {};
    const hasWeakTopic = Object.values(learningMap).some(subject => subject && typeof subject === 'object' &&
      Object.values(subject).some(x => x && typeof x === 'object' && number(x.total) >= 5 &&
        ((number(x.correct) + 2) / (number(x.total) + 4)) < .78));
    const other = COMMISSION_POOL.filter(q => q.metric !== 'solo' && score >= q.minScore &&
      (q.metric !== 'enlightenment' || hasWeakTopic));
    const first = solo[seedNumber(uid + '|' + date + '|solo') % solo.length];
    const second = other[seedNumber(uid + '|' + date + '|activity') % other.length];
    return [first, second];
  }
  // 每週任務採七天累積，不要求每天到場；原日常、委託的獎勵均不受影響。
  const WEEKLY = Object.freeze([
    quest('week-solo-20','七日問道・勤習','本週累積問道答對 20 題，任意時間完成。','solo',20,140,1,'solo'),
    quest('week-solo-50','七日問道・精進','本週累積問道答對 50 題。','solo',50,230,2,'solo'),
    quest('week-correction-2','溫故研習','本週累積訂正並答對 2 題。','correction',2,100,0,'solo'),
    quest('week-activity-2','百藝兼修','本週累積完成 2 次閉關、洞天、鬥法或團本活動，不須每日連續。','activity',2,125,0,'meditation'),
    quest('week-raid-1','同門共進','本週通關團本 1 次，任意難度。','raid',1,130,0,'raid',6)
  ]);
  const METRICS = ['solo', 'meditation', 'battle', 'dongtian', 'raid', 'correction'];
  function normalizeProgress(raw = {}, date = dateKey()) {
    const totals = Object.fromEntries(METRICS.map(key => [key, number(raw?.totals?.[key])]));
    const counts = Object.fromEntries(METRICS.map(key => [key, raw?.daily?.date === date ? number(raw.daily.counts?.[key]) : 0]));
    const week = weekKey(date);
    const weeklyCounts = Object.fromEntries(METRICS.map(key => [
      key,raw?.weekly?.key===week ? number(raw.weekly.counts?.[key]) : 0
    ]));
    return { version: 2, totals, daily: { date, counts }, weekly:{key:week,counts:weeklyCounts} };
  }
  function recordEvent(raw, metric, date = dateKey()) {
    if (!METRICS.includes(metric)) throw new Error('Unknown quest activity');
    const p = normalizeProgress(raw, date);
    p.totals[metric] += 1;
    p.daily.counts[metric] += 1;
    p.weekly.counts[metric] += 1;
    return p;
  }
  function normalizeState(raw = {}, date = dateKey()) {
    const claimed = Array.isArray(raw?.pathClaimed) ? raw.pathClaimed
      : LEGACY_PATH.slice(0, number(raw?.pathIndex)).map(q => q.id);
    const pathClaimed = PATH.filter(q => claimed.includes(q.id)).map(q => q.id);
    // The first ticket rollout stored IDs only and paid exactly one per quest.
    // Preserve that amount even when the tickets have already been spent.
    const pathTicketAmounts = {};
    for (const q of PATH.filter(q => q.reward.drawTickets && pathClaimed.includes(q.id))) {
      const legacy = Array.isArray(raw?.pathTicketsClaimed) && raw.pathTicketsClaimed.includes(q.id) ? 1 : 0;
      const paid = Number(raw?.pathTicketAmounts?.[q.id]);
      const amount = Math.max(legacy, Number.isFinite(paid) ? number(paid) : 0);
      if (amount) pathTicketAmounts[q.id] = amount;
    }
    const pathTicketsClaimed = PATH.filter(q => q.reward.drawTickets &&
      (pathTicketAmounts[q.id] || 0) >= q.reward.drawTickets).map(q => q.id);
    const next = PATH.findIndex(q => !pathClaimed.includes(q.id));
    return { version: 2, pathClaimed, pathTicketsClaimed, pathTicketAmounts, pathIndex: next < 0 ? PATH.length : next, dailyDate: date,
      dailyClaimed: raw?.dailyDate === date && Array.isArray(raw.dailyClaimed) ? raw.dailyClaimed.filter(id => DAILY.some(q => q.id === id)) : [],
      commissionDate:raw?.commissionDate===date ? date : '',
      commissionIds:raw?.commissionDate===date && Array.isArray(raw.commissionIds) ? raw.commissionIds.filter(id => COMMISSION_POOL.some(q=>q.id===id)).slice(0,2) : [],
      commissionClaimed:raw?.commissionDate===date && Array.isArray(raw.commissionClaimed)
        ? raw.commissionClaimed.filter(id=>COMMISSION_POOL.some(q=>q.id===id)) : [],
      weeklyKey:raw?.weeklyKey===weekKey(date)?weekKey(date):'',
      weeklyClaimed:raw?.weeklyKey===weekKey(date)&&Array.isArray(raw.weeklyClaimed)
        ? raw.weeklyClaimed.filter(id=>WEEKLY.some(q=>q.id===id)) : [] };
  }
  function progressValue(q, user, p, kind, date, verifiedTrial = null) {
    if (kind === 'weekly') {
      const c=p.weekly.counts;
      return q.metric === 'activity' ? c.meditation+c.dongtian+c.battle+c.raid : number(c[q.metric]);
    }
    if (q.metric === 'enlightenment')
      return verifiedTrial?.day===date && verifiedTrial.status==='completed' ? 1 : 0;
    if (q.metric === 'story') {
      const seen = user?.storyProgressV1?.seen?.[q.chapterId];
      return seen === true || number(seen?.completedAtMs) > 0 ? 1 : 0;
    }
    if (q.metric === 'scope') return Array.isArray(user?.gameSettings?.focusedUnits) && user.gameSettings.focusedUnits.length ? 1 : 0;
    if (q.metric === 'score') return number(user?.stats?.totalScore);
    if (kind !== 'path' && q.metric === 'meditation' && user?.dailyMeditation?.lastDate === date) return 1;
    // Existing verified milestones remain useful for returning players.
    if (kind === 'path' && q.metric === 'meditation') return Math.max(p.totals.meditation, number(user?.dailyMeditation?.totalDays));
    if (kind === 'path' && q.metric === 'solo') return Math.max(p.totals.solo, number(user?.stats?.totalCorrect));
    if (kind === 'path' && q.metric === 'battle') return Math.max(p.totals.battle, number(user?.stats?.battleMatches));
    if (kind === 'path' && q.metric === 'raid' && user?.raidProgress?.['shen-qingshuang']?.firstVictoryRoomId) return Math.max(1, p.totals.raid);
    return kind !== 'path' ? p.daily.counts[q.metric] : p.totals[q.metric];
  }
  function view(user = {}, rawState = {}, date = dateKey(), verifiedTrial = null) {
    const p = normalizeProgress(user.questProgress, date), state = normalizeState(rawState, date);
    function row(q, kind, claimed = false) {
      const current = Math.min(q.target, progressValue(q, user, p, kind, date, verifiedTrial));
      const locked = number(user?.stats?.totalScore) < q.minScore;
      return { ...q, current, claimed, locked, complete: current >= q.target, claimable: !claimed && !locked && current >= q.target };
    }
    return { date, pathIndex: state.pathIndex, pathCompleted: state.pathClaimed.length, pathTotal: PATH.length,
      path: state.pathIndex < PATH.length ? row(PATH[state.pathIndex], 'path') : null,
      pathTicketRewards: PATH.filter(q => q.reward.drawTickets && state.pathClaimed.includes(q.id) &&
        (state.pathTicketAmounts[q.id] || 0) < q.reward.drawTickets).map(q => ({ ...q, supplemental: true,
          description: '已完成此仙道任務，可補領尚未領取的本命法器抽獎券。',
          current: 1, target: 1, complete: true, claimable: true, claimed: false, locked: false,
          reward: { gold: 0, cultivation: 0, materials: {}, drawTickets: q.reward.drawTickets - (state.pathTicketAmounts[q.id] || 0) } })),
      weeklyKey:weekKey(date),weekStart:weekKey(date),
      weekly: WEEKLY.map(q => row(q,'weekly',state.weeklyClaimed.includes(q.id))),
      daily: DAILY.map(q => row(q, 'daily', state.dailyClaimed.includes(q.id))),
      commissions:(state.commissionIds||[]).map(id=>COMMISSION_POOL.find(q=>q.id===id))
        .filter(Boolean).map(q=>row(q,'commission',state.commissionClaimed.includes(q.id))) };
  }
  return { PATH, LEGACY_PATH, DAILY, WEEKLY, COMMISSION_POOL, dailyCommissions, seedNumber, dateKey, weekKey, normalizeProgress, recordEvent, normalizeState, view };
});

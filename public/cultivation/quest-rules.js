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
  // 保留舊目錄順序，用固定 ID 將既有 pathIndex 轉成已領清單。
  const LEGACY_PATH = [
    quest('path-scope', '立下修習卷', '在洞府的範圍設定選擇至少一項學習範圍，並儲存出題範圍。', 'scope', 1, 30, 0, 'scope'),
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
  const storyQuest = (chapterId, chapterTitle, minScore) => ({
    ...quest('path-story-' + chapterId, '觀看劇情 · ' + chapterTitle,
      '完整觀看「' + chapterTitle + '」，在結束本章後儲存觀看紀錄。', 'story', 1, minScore === 0 ? 30 : 50, 0, 'story', minScore),
    chapterId
  });
  const STORY_AFTER = {
    'path-first-answer': [storyQuest('qi-one-ask-dao', '入門續篇 · 問道不是猜答案', 1)],
    'path-qi-five': [
      storyQuest('qi-five-dongtian', '第二章 · 竹簡天尊', 5),
      quest('path-dongtian-tutorial', '完成洞天新手教程', '親自完成洞天範例的作答、結算、返回與刪除，並在最後儲存教學完成紀錄。稍後再學不算完成。', 'dongtian-tutorial', 1, 50, 0, 'dongtian-tutorial', 5)
    ],
    'path-foundation': [
      storyQuest('foundation-first-battle', '第三章 · 築基之後，別只會做題', 10),
      storyQuest('foundation-refinery', '第四章 · 法寶不是把東西丟進火裡', 10)
    ],
    'path-solo-ten': [
      storyQuest('foundation-mid-alliance', '第五章 · 仙盟送來了一封很不吉利的信', 16),
      storyQuest('foundation-late-shadow', '第六章 · 沈清霜的劍第一次出鞘', 22)
    ],
    'path-golden': [storyQuest('golden-core-truth', '第七章 · 丹成之日，問道碑醒了', 28)],
    'path-nascent': [storyQuest('nascent-soul-expedition', '第八章 · 仙盟不是來請你喝茶', 68)],
    'path-spirit': [storyQuest('spirit-transformation-history', '第九章 · 天裂不是天災', 188)],
    'path-void': [storyQuest('void-refinement-choice', '第十章 · 無相客給了你一道沒有選項的題', 428)],
    'path-union': [storyQuest('integration-revelation', '第十一章 · 仙府真正的用途', 788)],
    'path-mahayana': [storyQuest('mahayana-alliance', '第十二章 · 大家都來了，因為你已經不能裝沒事', 1268)],
    'path-tribulation': [storyQuest('tribulation-final', '第十三章 · 天劫之上仍有一道題', 1868)],
    'path-immortal': [storyQuest('true-immortal-epilogue', '終章 · 出師這件事，師姐說了算', 2588)]
  };
  const PATH = [storyQuest('prologue-enter-sect', '第一章 · 問道靈根', 0),
    ...LEGACY_PATH.flatMap(q => [q, ...(STORY_AFTER[q.id] || [])])];
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
    const claimed = Array.isArray(raw?.pathClaimed) ? raw.pathClaimed
      : LEGACY_PATH.slice(0, number(raw?.pathIndex)).map(q => q.id);
    const pathClaimed = PATH.filter(q => claimed.includes(q.id)).map(q => q.id);
    const next = PATH.findIndex(q => !pathClaimed.includes(q.id));
    return { version: 2, pathClaimed, pathIndex: next < 0 ? PATH.length : next, dailyDate: date,
      dailyClaimed: raw?.dailyDate === date && Array.isArray(raw.dailyClaimed) ? raw.dailyClaimed.filter(id => DAILY.some(q => q.id === id)) : [] };
  }
  function progressValue(q, user, p, kind, date) {
    if (q.metric === 'dongtian-tutorial') {
      const lesson = user?.storyDongtianTutorialV1;
      const legacy = user?.qiFiveDongtianTutorialV1;
      return (lesson?.completed === true && lesson?.skipped !== true) ||
        (legacy?.completed === true && legacy?.played === true && legacy?.deleted === true) ? 1 : 0;
    }
    if (q.metric === 'story') {
      const seen = user?.storyProgressV1?.seen?.[q.chapterId];
      return seen === true || number(seen?.completedAtMs) > 0 ? 1 : 0;
    }
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
    return { date, pathIndex: state.pathIndex, pathCompleted: state.pathClaimed.length, pathTotal: PATH.length,
      path: state.pathIndex < PATH.length ? row(PATH[state.pathIndex], 'path') : null,
      daily: DAILY.map(q => row(q, 'daily', state.dailyClaimed.includes(q.id))) };
  }
  return { PATH, LEGACY_PATH, DAILY, dateKey, normalizeProgress, recordEvent, normalizeState, view };
});

'use strict';

// Anonymous browser cohorts + authenticated player cohorts. Never store quiz text,
// answers, e-mail, IP addresses or user-agent strings in analytics.
const crypto = require('node:crypto');
const { adminProject, PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const COOKIE = 'qa_analytics_vid';
const TYPES = new Set(['question_started', 'answer_completed', 'social_participated', 'question_load_failed']);
const MODES = new Set(['solo', 'raid', 'duel', 'meditation', 'other']);
const LIMIT = 12000;
const DAY_MS = 86400000;

function dayOf(date) {
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
function plusDays(day, amount) {
  return new Date(Date.parse(day + 'T00:00:00Z') + amount * DAY_MS).toISOString().slice(0, 10);
}
function percent(n, d) { return d ? Math.round(1000 * n / d) / 10 : null; }
function readVisitor(req, res) {
  const match = /(?:^|;\s*)qa_analytics_vid=([a-f0-9]{32})(?:;|$)/.exec(String(req.get?.('cookie') || ''));
  if (match) return match[1];
  const id = crypto.randomBytes(16).toString('hex');
  const secure = req.secure || req.get?.('x-forwarded-proto') === 'https';
  res.append?.('Set-Cookie', COOKIE + '=' + id + '; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : ''));
  return id;
}
function httpError(code, message) {
  const err = new Error(message); err.status = code; return err;
}
function bearer(req) {
  const m = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
  return m ? m[1] : '';
}
async function identity(req, a, optional = false) {
  const token = bearer(req);
  if (!token) {
    if (optional) return null;
    throw httpError(401, '請先登入才能記錄遊戲事件。');
  }
  let decoded;
  try { decoded = await a.auth.verifyIdToken(token, true); }
  catch (_) { throw httpError(401, '登入已過期。'); }
  if (!decoded?.uid || decoded.aud !== PROJECT_IDS.A ||
      decoded.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A) {
    throw httpError(401, '帳號所屬專案不正確。');
  }
  return decoded.uid;
}
function daysWith(values, today) {
  const minDay = plusDays(today, -90);
  return [...new Set([...(Array.isArray(values) ? values : []), today])]
    .filter(day => typeof day === 'string' && day >= minDay && day <= today)
    .sort();
}
function newPlayerData(uid, createdDay, today, now) {
  return {
    uid, firstDay: createdDay, firstTrackedDay: today,
    // Old users who first appear after instrumentation are not new-user cohorts.
    cohortEligible: createdDay === today,
    seenDays: [today], totalAnswers: 0,
    firstQuestionAt: null, firstThreeAt: null, socialDays: [],
    lastDay: today, lastAt: now
  };
}
async function createdDayFor(a, uid, today) {
  const user = await a.auth.getUser(uid);
  const date = new Date(user.metadata?.creationTime || 0);
  return Number.isFinite(date.getTime()) && date.getTime() > 0 ? dayOf(date) : today;
}
async function recordVisit(db, a, uid, vid, today, now) {
  const visitorRef = db.collection('playerAnalyticsVisitors').doc(vid);
  const playerRef = uid ? db.collection('playerAnalyticsPlayers').doc(uid) : null;
  const prior = playerRef ? await playerRef.get() : null;
  const createdDay = uid && !prior.exists ? await createdDayFor(a, uid, today) : null;
  await db.runTransaction(async tx => {
    const visitor = await tx.get(visitorRef);
    const player = playerRef ? await tx.get(playerRef) : null;
    if (!visitor.exists) {
      tx.set(visitorRef, { firstDay: today, firstAt: now, lastDay: today, lastAt: now, started: false });
    } else {
      tx.update(visitorRef, { lastDay: today, lastAt: now });
    }
    if (playerRef) {
      if (!player.exists) tx.set(playerRef, newPlayerData(uid, createdDay, today, now));
      else tx.update(playerRef, { lastDay: today, lastAt: now, seenDays: daysWith(player.data().seenDays, today) });
    }
  });
}
async function recordEvent(db, a, uid, vid, item, today, now) {
  const type = String(item?.type || '');
  const mode = String(item?.mode || 'other');
  const eventId = String(item?.eventId || '');
  if (!TYPES.has(type) || !MODES.has(mode) || !/^[A-Za-z0-9_-]{8,100}$/.test(eventId)) {
    throw httpError(400, '事件類型、模式或識別碼無效。');
  }
  if (type === 'question_started' && mode !== 'solo') throw httpError(400, '題目開始模式不正確。');
  if (type === 'question_load_failed' && mode !== 'solo') throw httpError(400, '載入失敗模式不正確。');
  if (type === 'social_participated' && !['raid', 'duel'].includes(mode)) throw httpError(400, '社交模式不正確。');
  const eventKey = crypto.createHash('sha256').update(uid + ':' + eventId).digest('hex');
  const eventRef = db.collection('playerAnalyticsEvents').doc(eventKey);
  const visitorRef = db.collection('playerAnalyticsVisitors').doc(vid);
  const playerRef = db.collection('playerAnalyticsPlayers').doc(uid);
  const dailyRef = db.collection('playerAnalyticsDaily').doc(crypto.createHash('sha256').update(uid + ':' + today).digest('hex'));
  const prior = await playerRef.get();
  const createdDay = prior.exists ? null : await createdDayFor(a, uid, today);
  return db.runTransaction(async tx => {
    const [existing, player, visitor, daily] = await Promise.all([
      tx.get(eventRef), tx.get(playerRef), tx.get(visitorRef), tx.get(dailyRef)
    ]);
    if (existing.exists) return { duplicate: true };
    const p = player.exists ? player.data() : newPlayerData(uid, createdDay, today, now);
    const d = daily.exists ? daily.data() : {};
    const increment = (name, bool) => (Number(d[name]) || 0) + (bool ? 1 : 0);
    const isAnswer = type === 'answer_completed';
    const isStart = type === 'question_started';
    const isSocial = type === 'social_participated';
    const totalAnswers = (Number(p.totalAnswers) || 0) + (isAnswer ? 1 : 0);
    const playerPatch = {
      lastDay: today, lastAt: now, seenDays: daysWith(p.seenDays, today),
      totalAnswers,
      firstQuestionAt: p.firstQuestionAt || (isStart ? now : null),
      firstThreeAt: p.firstThreeAt || (totalAnswers >= 3 ? now : null),
      socialDays: isSocial ? daysWith(p.socialDays, today) : (p.socialDays || [])
    };
    if (!player.exists) tx.set(playerRef, { ...p, ...playerPatch });
    else tx.update(playerRef, playerPatch);
    if (!visitor.exists) tx.set(visitorRef, {
      firstDay: today, firstAt: now, lastDay: today, lastAt: now, started: isStart
    });
    else tx.update(visitorRef, {
      lastDay: today, lastAt: now, started: !!visitor.data().started || isStart
    });
    tx.set(dailyRef, {
      uid, day: today, lastAt: now,
      answers: increment('answers', isAnswer),
      starts: increment('starts', isStart),
      social: increment('social', isSocial),
      loadFailures: increment('loadFailures', type === 'question_load_failed'),
      soloAnswers: increment('soloAnswers', isAnswer && mode === 'solo'),
      raidAnswers: increment('raidAnswers', isAnswer && mode === 'raid'),
      duelAnswers: increment('duelAnswers', isAnswer && mode === 'duel'),
      meditationAnswers: increment('meditationAnswers', isAnswer && mode === 'meditation')
    }, { merge: true });
    tx.create(eventRef, {
      uid, day: today, type, mode, at: now,
      expireAt: new Date(now.getTime() + 90 * DAY_MS)
    });
    return { duplicate: false };
  });
}
function buildReport({ visitors, players, days, events, now, range, truncated }) {
  const today = dayOf(now), first = plusDays(today, 1 - range);
  const recent = plusDays(today, -6);
  const visitorCohorts = visitors.filter(v => v.firstDay >= first && v.firstDay <= today);
  const playerCohorts = players.filter(p => p.cohortEligible === true && p.firstDay >= first && p.firstDay <= today);
  const startedVisitors = visitorCohorts.filter(v => v.started).length;
  const startedPlayers = playerCohorts.filter(p => !!p.firstQuestionAt).length;
  const threePlayers = playerCohorts.filter(p => !!p.firstThreeAt).length;
  const retained = n => {
    const matured = playerCohorts.filter(p => p.firstDay <= plusDays(today, -n));
    const returned = matured.filter(p => (p.seenDays || []).includes(plusDays(p.firstDay, n))).length;
    return { returned, eligible: matured.length, rate: percent(returned, matured.length) };
  };
  const d1 = retained(1), d7 = retained(7);
  const weeklyDays = days.filter(d => d.day >= recent && d.day <= today);
  const active = new Set(weeklyDays.map(d => d.uid));
  const social = new Set(weeklyDays.filter(d => (Number(d.social) || 0) > 0).map(d => d.uid));
  const sum = key => weeklyDays.reduce((n, d) => n + (Number(d[key]) || 0), 0);
  const started = sum('starts'), failed = sum('loadFailures');
  const socialCohort = playerCohorts.filter(p => (p.socialDays || []).includes(p.firstDay) && p.firstDay <= plusDays(today, -1));
  const nonSocialCohort = playerCohorts.filter(p => !(p.socialDays || []).includes(p.firstDay) && p.firstDay <= plusDays(today, -1));
  const cohortD1 = group => {
    const returned = group.filter(p => (p.seenDays || []).includes(plusDays(p.firstDay, 1))).length;
    return { returned, eligible: group.length, rate: percent(returned, group.length) };
  };
  return {
    range, from: first, to: today, timezone: 'Asia/Taipei',
    visitors: { total: visitorCohorts.length, started: startedVisitors, rate: percent(startedVisitors, visitorCohorts.length) },
    firstThree: { completed: threePlayers, started: startedPlayers, rate: percent(threePlayers, startedPlayers) },
    d1, d7,
    weekly: { answers: sum('answers'), active: active.size,
      solo: sum('soloAnswers'), raid: sum('raidAnswers'), duel: sum('duelAnswers'), meditation: sum('meditationAnswers') },
    social: { participants: social.size, active: active.size, rate: percent(social.size, active.size),
      cohortD1Social: cohortD1(socialCohort), cohortD1Other: cohortD1(nonSocialCohort) },
    loading: { success: started, failed, rate: percent(failed, started + failed) },
    daily: Array.from({ length: 7 }, (_, i) => {
      const day = plusDays(today, i - 6);
      const entries = weeklyDays.filter(d => d.day === day);
      return { day, answers: entries.reduce((n, d) => n + (Number(d.answers) || 0), 0),
        failures: entries.reduce((n, d) => n + (Number(d.loadFailures) || 0), 0) };
    }),
    recentEvents: events.slice(0, 25).map(e => ({
      day: e.day, type: e.type, mode: e.mode,
      player: crypto.createHash('sha256').update(String(e.uid || '')).digest('hex').slice(0, 8),
      at: e.at?.toDate?.()?.toISOString?.() || (e.at instanceof Date ? e.at.toISOString() : null)
    })),
    truncated
  };
}
async function report(db, now, range) {
  const today = dayOf(now), first = plusDays(today, 1 - range), recent = plusDays(today, -6);
  const [v, p, d, e] = await Promise.all([
    db.collection('playerAnalyticsVisitors').where('firstDay', '>=', first).limit(LIMIT).get(),
    db.collection('playerAnalyticsPlayers').where('firstDay', '>=', first).limit(LIMIT).get(),
    db.collection('playerAnalyticsDaily').where('day', '>=', recent).limit(LIMIT).get(),
    db.collection('playerAnalyticsEvents').orderBy('at', 'desc').limit(25).get()
  ]);
  return buildReport({
    visitors: v.docs.map(s => s.data()),
    players: p.docs.map(s => s.data()),
    days: d.docs.map(s => s.data()),
    events: e.docs.map(s => s.data()),
    now, range,
    truncated: [v, p, d].some(s => s.size >= LIMIT)
  });
}
function registerPlayerAnalytics(app, { resolve = role => adminProject(role), logger = console } = {}) {
  function route(fn) {
    return async (req, res) => {
      res.set?.('Cache-Control', 'no-store');
      try {
        const a = resolve('A');
        return await fn(req, res, a);
      } catch (error) {
        const status = Number(error.status) || 500;
        if (status >= 500) logger.error('[Player Analytics]', error);
        res.status(status).json({ error: status >= 500 ? '分析服務目前無法使用。' : error.message });
      }
    };
  }
  app.post('/api/analytics/visit', route(async (req, res, a) => {
    const uid = await identity(req, a, true);
    const vid = readVisitor(req, res), now = new Date();
    await recordVisit(a.db, a, uid, vid, dayOf(now), now);
    res.json({ ok: true });
  }));
  app.post('/api/analytics/event', route(async (req, res, a) => {
    const uid = await identity(req, a);
    const vid = readVisitor(req, res), now = new Date();
    const result = await recordEvent(a.db, a, uid, vid, req.body, dayOf(now), now);
    res.json({ ok: true, ...result });
  }));
  app.post('/api/admin/player-analytics', route(async (req, res, a) => {
    const uid = await identity(req, a);
    const admin = await a.db.collection('users').doc(uid).get();
    if (admin.data()?.isAdmin !== true) throw httpError(403, '沒有管理員權限。');
    const range = Number(req.body?.range);
    if (![7, 30].includes(range)) throw httpError(400, '日期範圍只允許 7 或 30 日。');
    res.json(await report(a.db, new Date(), range));
  }));
}
module.exports = registerPlayerAnalytics;
module.exports.__test = { dayOf, plusDays, percent, buildReport, daysWith, newPlayerData, recordEvent, recordVisit };

'use strict';

const crypto = require('node:crypto');
const aiRouter = require('./ai-router');
const { adminProject, PROJECT_IDS } = require('./firebase-admin-projects.cjs');

const RAID_SCHEMA_VERSION = 2;
const ROOM_COLLECTION = 'raidRooms';
const QUESTION_COLLECTION = 'questions';
const CLAIM_COLLECTION = 'raidRewardClaims';
const MAX_MEMBERS = 4;
const MIN_SCORE = 10;
const MIN_QUESTION_CYCLE_MS = 6000;
const REVIEW_LOCK_MS = 1500;
const BOSS_INTERVAL_MS = 18000;
const BOSS_TELEGRAPH_MS = 5000;
const MAX_BOSS_ACTIONS = 12;
const SECOND_REFINEMENT_KEY = 'raid-refine-key-2';
const THIRD_REFINEMENT_KEY = 'raid-refine-key-3';

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value, min)));
}
function safeText(value, max = 120) {
  return String(value || '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join('');
}
function normalizeRoomId(value) {
  return safeText(value, 12).toUpperCase().replace(/[^A-Z2-9]/g, '');
}
function memberList(room) {
  return Object.values(room?.members || {}).filter((row) => row && row.uid);
}
function shenPhaseForHp(hp, maxHp) {
  const ratio = clamp(finite(hp) / Math.max(1, finite(maxHp, 1)), 0, 1);
  if (ratio > 0.70) return 1;
  if (ratio > 0.30) return 2;
  return 3;
}
function bossIntent({ actionCount = 0, hp = 1, maxHp = 1 } = {}) {
  const turn = Math.max(1, Math.floor(finite(actionCount)) + 1);
  const phase = shenPhaseForHp(hp, maxHp);
  if (turn >= MAX_BOSS_ACTIONS) return { name: '霜華收劍', multiplier: 1.60, phase, kind: 'finisher' };
  if (phase === 3) return {
    name: turn % 2 === 0 ? '清霜一念' : '寒星連斬',
    multiplier: turn % 2 === 0 ? 1.45 : 1.30, phase, kind: 'danger'
  };
  if (phase === 2) return {
    name: turn % 3 === 0 ? '寒霜劍雨' : '流霜點劍',
    multiplier: turn % 3 === 0 ? 1.28 : 1.12, phase, kind: turn % 3 === 0 ? 'burst' : 'normal'
  };
  return {
    name: turn % 4 === 0 ? '霜痕' : '試劍',
    multiplier: turn % 4 === 0 ? 1.12 : 0.92, phase, kind: 'normal'
  };
}
function scaleBossForTeam(members = []) {
  const team = members.filter(Boolean).slice(0, MAX_MEMBERS);
  const n = Math.max(1, team.length);
  const totalAttack = team.reduce((sum, row) => sum + Math.max(1, finite(row.atk, 200)), 0);
  const averageHp = team.reduce((sum, row) => sum + Math.max(1, finite(row.maxHp, 1000)), 0) / n;
  const partyScale = 1 + 0.20 * (n - 1);
  const maxHp = Math.max(1800, Math.round(totalAttack * 8 * partyScale));
  return {
    id: 'shen-qingshuang',
    name: '沈清霜',
    title: '大師姐・清霜試煉',
    image: 'assets/story/characters/shen-qingshuang.png',
    hp: maxHp,
    maxHp,
    phase: 1,
    actionCount: 0,
    baseAttack: Math.max(70, Math.round(averageHp * 0.105)),
    nextActionAtMs: 0,
    lastAction: null
  };
}
function refinementKeyQuantity(realmOrder = 1) {
  const order = Math.max(1, Math.floor(finite(realmOrder, 1)));
  return 1 + Math.floor((order - 1) / 3);
}
function deterministicThirdKey(roomId, uid) {
  return crypto.createHash('sha256').update(String(roomId) + ':' + String(uid)).digest()[0] % 4 === 0;
}
function nextPersonalQuestionAt(issuedAtMs, resolvedAtMs) {
  const issued = Math.max(0, finite(issuedAtMs));
  const resolved = Math.max(issued, finite(resolvedAtMs, issued));
  return Math.max(issued + MIN_QUESTION_CYCLE_MS, resolved + REVIEW_LOCK_MS);
}

function serializeRoom(room) {
  if (!room) return null;
  const members = {};
  for (const [uid, raw] of Object.entries(room.members || {})) {
    members[uid] = {
      uid,
      name: safeText(raw?.name, 64) || '無名修士',
      avatar: safeText(raw?.avatar, 512),
      ready: raw?.ready === true,
      alive: raw?.alive !== false,
      left: raw?.left === true,
      hp: Math.max(0, Math.round(finite(raw?.hp))),
      maxHp: Math.max(1, Math.round(finite(raw?.maxHp, 1000))),
      atk: Math.max(1, Math.round(finite(raw?.atk, 200))),
      combatPower: Math.max(0, Math.round(finite(raw?.combatPower))),
      damage: Math.max(0, Math.round(finite(raw?.damage))),
      correct: Math.max(0, Math.floor(finite(raw?.correct))),
      answered: Math.max(0, Math.floor(finite(raw?.answered))),
      guardCharges: Math.max(0, Math.floor(finite(raw?.guardCharges))),
      nextQuestionAtMs: Math.max(0, finite(raw?.nextQuestionAtMs)),
      activeQuestionId: safeText(raw?.activeQuestionId, 100),
      lastSeenAtMs: Math.max(0, finite(raw?.lastSeenAtMs))
    };
  }
  const boss = room.boss ? {
    id: room.boss.id,
    name: room.boss.name,
    title: room.boss.title,
    image: room.boss.image,
    hp: Math.max(0, Math.round(finite(room.boss.hp))),
    maxHp: Math.max(1, Math.round(finite(room.boss.maxHp, 1))),
    phase: Math.max(1, Math.min(3, Math.floor(finite(room.boss.phase, 1)))),
    actionCount: Math.max(0, Math.floor(finite(room.boss.actionCount))),
    nextActionAtMs: Math.max(0, finite(room.boss.nextActionAtMs)),
    lastAction: room.boss.lastAction || null
  } : null;
  return {
    schemaVersion: RAID_SCHEMA_VERSION,
    id: room.id,
    leaderUid: room.leaderUid,
    status: room.status,
    members,
    boss,
    createdAtMs: finite(room.createdAtMs),
    startedAtMs: finite(room.startedAtMs),
    endedAtMs: finite(room.endedAtMs),
    maxMembers: MAX_MEMBERS,
    noQuestionTimer: true,
    bossIntervalMs: BOSS_INTERVAL_MS,
    bossTelegraphMs: BOSS_TELEGRAPH_MS,
    maxBossActions: MAX_BOSS_ACTIONS
  };
}

async function authenticate(req, resolve = role => adminProject(role)) {
  const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
  if (!bearer) {
    const error = new Error('請先登入後再進入團本。');
    error.status = 401;
    throw error;
  }
  const a = resolve('A');
  const c = resolve('C');
  const decoded = await a.auth.verifyIdToken(bearer[1], true);
  if (!decoded?.uid || decoded.aud !== PROJECT_IDS.A ||
      decoded.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A) {
    const error = new Error('登入身分無效，請重新登入。');
    error.status = 401;
    throw error;
  }
  return { uid: decoded.uid, a, c };
}

async function loadPlayer(a, uid) {
  const snap = await a.db.collection('users').doc(uid).get();
  if (!snap.exists) throw Object.assign(new Error('玩家資料不存在。'), { status: 404 });
  const data = snap.data() || {};
  const score = Math.max(0, finite(data.stats?.totalScore));
  if (score < MIN_SCORE) throw Object.assign(new Error('需達築基初期（10 修為）才可進入秘境。'), { status: 403 });
  return { data, score };
}

function memberFromPlayer(uid, player) {
  const data = player.data || {};
  const maxHp = Math.max(1, Math.min(1000000, Math.round(finite(data.stats?.maxHp, 1000))));
  const atk = Math.max(1, Math.min(100000, Math.round(finite(data.stats?.attack, 200))));
  return {
    uid,
    name: safeText(data.displayName, 64) || '無名修士',
    avatar: safeText(data.equipped?.avatar, 512),
    ready: false,
    alive: true,
    left: false,
    hp: maxHp,
    maxHp,
    atk,
    combatPower: Math.max(0, Math.round(finite(data.combatPower || data.stats?.combatPower))),
    damage: 0,
    correct: 0,
    answered: 0,
    guardCharges: data.stats?.goldenCoreShield === true ? 1 : 0,
    activeQuestionId: '',
    nextQuestionAtMs: 0,
    joinedAtMs: Date.now(),
    lastSeenAtMs: Date.now()
  };
}

function validMember(room, uid) {
  const member = room?.members?.[uid];
  if (!member) throw Object.assign(new Error('你不在這個團本房間。'), { status: 403 });
  return member;
}

function normalizeQuestion(raw, request) {
  const source = Array.isArray(raw) ? raw[0] : (raw?.questions?.[0] || raw || {});
  const q = safeText(source.q ?? source.question, 1600);
  let opts = Array.isArray(source.opts) ? source.opts.slice() :
    Array.isArray(source.options) ? source.options.slice() : null;
  let ans = source.ans ?? source.answer ?? source.correctIndex;
  if (!opts && typeof source.correct === 'string' && Array.isArray(source.wrong)) {
    opts = [source.correct, ...source.wrong];
    ans = 0;
  }
  if (!Array.isArray(opts)) throw new Error('題目缺少單選選項');
  opts = opts.map((value) => safeText(value, 600));
  if (typeof ans === 'string' && /^[A-Da-d]$/.test(ans.trim())) ans = ans.trim().toUpperCase().charCodeAt(0) - 65;
  if (!Number.isInteger(Number(ans)) && typeof ans === 'string') ans = opts.findIndex((item) => item === safeText(ans, 600));
  ans = Number(ans);
  const exp = safeText(source.exp ?? source.explanation, 3000);
  if (q.length < 5 || opts.length !== 4 || opts.some((value) => !value) ||
      new Set(opts.map((value) => value.replace(/\s+/g, '').toLowerCase())).size !== 4 ||
      !Number.isInteger(ans) || ans < 0 || ans > 3 || exp.length < 5) {
    throw new Error('AI 題目格式無效');
  }
  for (let i = opts.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [opts[i], opts[j]] = [opts[j], opts[i]];
    if (ans === i) ans = j;
    else if (ans === j) ans = i;
  }
  return {
    q, opts, ans, exp,
    subject: request.subject,
    level: request.level,
    topic: request.specificTopic,
    conceptId: safeText(source.concept_id, 100),
    templateId: safeText(source.template_id, 120)
  };
}

async function generateQuestion(request) {
  const prompt = [
    '你是修仙學習遊戲的團本出題器。請產生一題四選一單選題。',
    '科目：' + request.subject,
    '程度：' + request.level,
    '範圍：' + request.specificTopic,
    '難度：' + request.difficulty,
    '玩家可不限時思考，所以題目可以要求真正理解，但不可超出指定程度與範圍。',
    '四個選項必須互異且只有一個正確答案，解析需指出關鍵理由。',
    '只回傳 JSON：{"q":"題目","correct":"正確選項","wrong":["錯1","錯2","錯3"],"exp":"解析","subject":"' +
      request.subject.replace(/"/g, '') + '","concept_id":"考點ID","template_id":"解題骨架ID"}'
  ].join('\n');
  const routed = await aiRouter.generateJSON(prompt, { timeoutMs: 25000 });
  return normalizeQuestion(routed.data, request);
}

function requestShape(body = {}) {
  const raw = body.request || {};
  return {
    subject: safeText(raw.subject, 40) || '數學',
    level: safeText(raw.level, 40) || '國中一年級',
    specificTopic: safeText(raw.specificTopic || raw.topic, 220) || '綜合測驗',
    difficulty: ['easy', 'medium', 'hard'].includes(raw.difficulty) ? raw.difficulty : 'medium'
  };
}

function handleError(res, error, logger = console) {
  const status = Number(error?.status) || (/token|auth|登入身分/i.test(String(error?.message || '')) ? 401 : 500);
  if (status >= 500) logger.error('[Raid API]', error?.code || error?.message || error);
  return res.status(status).json({ ok: false, error: error?.message || '團本服務暫時無法使用。' });
}

function createRaidApi({ resolve = role => adminProject(role), generate = generateQuestion, now = Date.now, logger = console } = {}) {
  async function context(req) {
    try { return await authenticate(req, resolve); }
    catch (error) {
      if (!error.status) error.status = /credential|project|service account/i.test(String(error.message)) ? 503 : 401;
      throw error;
    }
  }

  async function create(req, res) {
    try {
      const ctx = await context(req);
      const player = await loadPlayer(ctx.a, ctx.uid);
      const member = memberFromPlayer(ctx.uid, player);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const id = roomCode();
        const ref = ctx.c.db.collection(ROOM_COLLECTION).doc(id);
        const room = {
          schemaVersion: RAID_SCHEMA_VERSION,
          id,
          leaderUid: ctx.uid,
          status: 'waiting',
          members: { [ctx.uid]: member },
          boss: null,
          createdAtMs: now(),
          startedAtMs: 0,
          endedAtMs: 0
        };
        try {
          await ref.create(room);
          return res.json({ ok: true, room: serializeRoom(room) });
        } catch (error) {
          if (String(error?.code || '').includes('already-exists')) continue;
          throw error;
        }
      }
      throw new Error('無法建立唯一團本房號，請重試。');
    } catch (error) { return handleError(res, error, logger); }
  }

  async function join(req, res) {
    try {
      const ctx = await context(req);
      const id = normalizeRoomId(req.body?.roomId);
      if (!id) throw Object.assign(new Error('請輸入團本房號。'), { status: 400 });
      const player = await loadPlayer(ctx.a, ctx.uid);
      const ref = ctx.c.db.collection(ROOM_COLLECTION).doc(id);
      let roomOut;
      await ctx.c.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error('找不到這個團本房間。'), { status: 404 });
        const room = snap.data();
        if (room.status !== 'waiting' && !room.members?.[ctx.uid]) {
          throw Object.assign(new Error('此團本已開始，無法加入。'), { status: 409 });
        }
        const members = { ...(room.members || {}) };
        if (!members[ctx.uid] && Object.keys(members).length >= MAX_MEMBERS) {
          throw Object.assign(new Error('此團本已滿 4 人。'), { status: 409 });
        }
        if (!members[ctx.uid]) members[ctx.uid] = memberFromPlayer(ctx.uid, player);
        members[ctx.uid] = { ...members[ctx.uid], left: false, lastSeenAtMs: now() };
        roomOut = { ...room, members };
        tx.update(ref, { members });
      });
      return res.json({ ok: true, room: serializeRoom(roomOut) });
    } catch (error) { return handleError(res, error, logger); }
  }

  async function state(req, res) {
    try {
      const ctx = await context(req);
      const id = normalizeRoomId(req.query?.roomId);
      const snap = await ctx.c.db.collection(ROOM_COLLECTION).doc(id).get();
      if (!snap.exists) throw Object.assign(new Error('團本房間已不存在。'), { status: 404 });
      const room = snap.data();
      validMember(room, ctx.uid);
      return res.json({ ok: true, room: serializeRoom(room) });
    } catch (error) { return handleError(res, error, logger); }
  }

  async function heartbeat(req, res) {
    try {
      const ctx = await context(req);
      const id = normalizeRoomId(req.body?.roomId);
      const ref = ctx.c.db.collection(ROOM_COLLECTION).doc(id);
      let roomOut;
      await ctx.c.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error('團本房間已不存在。'), { status: 404 });
        const room = snap.data();
        const member = validMember(room, ctx.uid);
        const members = { ...room.members, [ctx.uid]: { ...member, left: false, lastSeenAtMs: now() } };
        roomOut = { ...room, members };
        tx.update(ref, { members });
      });
      return res.json({ ok: true, room: serializeRoom(roomOut) });
    } catch (error) { return handleError(res, error, logger); }
  }

  async function ready(req, res) {
    try {
      const ctx = await context(req);
      const id = normalizeRoomId(req.body?.roomId);
      const ref = ctx.c.db.collection(ROOM_COLLECTION).doc(id);
      let roomOut;
      await ctx.c.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error('團本房間已不存在。'), { status: 404 });
        const room = snap.data();
        if (room.status !== 'waiting') throw Object.assign(new Error('團本已開始。'), { status: 409 });
        const member = validMember(room, ctx.uid);
        const members = { ...room.members, [ctx.uid]: { ...member, ready: req.body?.ready === true, lastSeenAtMs: now() } };
        roomOut = { ...room, members };
        tx.update(ref, { members });
      });
      return res.json({ ok: true, room: serializeRoom(roomOut) });
    } catch (error) { return handleError(res, error, logger); }
  }

  async function start(req, res) {
    try {
      const ctx = await context(req);
      const id = normalizeRoomId(req.body?.roomId);
      const ref = ctx.c.db.collection(ROOM_COLLECTION).doc(id);
      let roomOut;
      await ctx.c.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error('團本房間已不存在。'), { status: 404 });
        const room = snap.data();
        if (room.leaderUid !== ctx.uid) throw Object.assign(new Error('只有隊長可以開始團本。'), { status: 403 });
        if (room.status !== 'waiting') throw Object.assign(new Error('團本已開始。'), { status: 409 });
        const team = memberList(room).filter((row) => row.left !== true);
        if (!team.length || team.length > MAX_MEMBERS) throw Object.assign(new Error('隊伍人數必須為 1～4 人。'), { status: 409 });
        if (team.some((row) => row.ready !== true)) throw Object.assign(new Error('還有隊員尚未準備。'), { status: 409 });
        const members = {};
        for (const row of team) {
          members[row.uid] = {
            ...row, hp: row.maxHp, alive: true, left: false, damage: 0, correct: 0, answered: 0,
            activeQuestionId: '', nextQuestionAtMs: 0, lastSeenAtMs: now()
          };
        }
        const boss = scaleBossForTeam(team);
        boss.nextActionAtMs = now() + BOSS_INTERVAL_MS;
        roomOut = { ...room, status: 'active', members, boss, startedAtMs: now(), endedAtMs: 0 };
        tx.update(ref, {
          status: 'active', members, boss, startedAtMs: roomOut.startedAtMs, endedAtMs: 0
        });
      });
      return res.json({ ok: true, room: serializeRoom(roomOut) });
    } catch (error) { return handleError(res, error, logger); }
  }

  async function question(req, res) {
    try {
      const ctx = await context(req);
      const id = normalizeRoomId(req.body?.roomId);
      const roomRef = ctx.c.db.collection(ROOM_COLLECTION).doc(id);
      const roomSnap = await roomRef.get();
      if (!roomSnap.exists) throw Object.assign(new Error('團本房間已不存在。'), { status: 404 });
      const room = roomSnap.data();
      const member = validMember(room, ctx.uid);
      if (room.status !== 'active' || member.alive === false || member.left === true) {
        throw Object.assign(new Error('目前無法取得新題目。'), { status: 409 });
      }
      if (member.activeQuestionId) {
        const old = await roomRef.collection(QUESTION_COLLECTION).doc(member.activeQuestionId).get();
        if (old.exists && old.data()?.uid === ctx.uid && old.data()?.resolved !== true) {
          const q = old.data();
          return res.json({ ok: true, question: {
            id: old.id, q: q.q, opts: q.opts, subject: q.subject, level: q.level, topic: q.topic
          }, resumed: true, noQuestionTimer: true });
        }
      }
      const current = now();
      if (finite(member.nextQuestionAtMs) > current) {
        const error = new Error('下一題尚在招式收束中。');
        error.status = 429;
        error.retryAfterMs = finite(member.nextQuestionAtMs) - current;
        throw error;
      }
      const request = requestShape(req.body);
      const generated = await generate(request);
      const qid = crypto.randomUUID();
      const questionRef = roomRef.collection(QUESTION_COLLECTION).doc(qid);
      const issuedAtMs = now();
      await ctx.c.db.runTransaction(async (tx) => {
        const fresh = await tx.get(roomRef);
        if (!fresh.exists) throw Object.assign(new Error('團本房間已不存在。'), { status: 404 });
        const freshRoom = fresh.data();
        const freshMember = validMember(freshRoom, ctx.uid);
        if (freshRoom.status !== 'active' || freshMember.alive === false || freshMember.left === true) {
          throw Object.assign(new Error('戰鬥狀態已改變。'), { status: 409 });
        }
        if (freshMember.activeQuestionId) throw Object.assign(new Error('目前已有進行中的題目。'), { status: 409 });
        const members = {
          ...freshRoom.members,
          [ctx.uid]: { ...freshMember, activeQuestionId: qid, lastSeenAtMs: now() }
        };
        tx.create(questionRef, {
          uid: ctx.uid, roomId: id, ...generated, issuedAtMs, resolved: false, selectedChoice: null
        });
        tx.update(roomRef, { members });
      });
      return res.json({ ok: true, question: {
        id: qid, q: generated.q, opts: generated.opts, subject: generated.subject,
        level: generated.level, topic: generated.topic
      }, noQuestionTimer: true });
    } catch (error) {
      if (error?.status === 429) {
        return res.status(429).json({ ok: false, error: error.message, retryAfterMs: error.retryAfterMs });
      }
      return handleError(res, error, logger);
    }
  }

  async function answer(req, res) {
    try {
      const ctx = await context(req);
      const id = normalizeRoomId(req.body?.roomId);
      const questionId = safeText(req.body?.questionId, 100);
      const selectedChoice = Number(req.body?.selectedChoice);
      if (!questionId || !Number.isInteger(selectedChoice) || selectedChoice < 0 || selectedChoice > 3) {
        throw Object.assign(new Error('作答資料不完整。'), { status: 400 });
      }
      const roomRef = ctx.c.db.collection(ROOM_COLLECTION).doc(id);
      const questionRef = roomRef.collection(QUESTION_COLLECTION).doc(questionId);
      let result;
      await ctx.c.db.runTransaction(async (tx) => {
        const [roomSnap, questionSnap] = await Promise.all([tx.get(roomRef), tx.get(questionRef)]);
        if (!roomSnap.exists || !questionSnap.exists) throw Object.assign(new Error('題目已失效。'), { status: 404 });
        const room = roomSnap.data();
        const member = validMember(room, ctx.uid);
        const q = questionSnap.data();
        if (room.status !== 'active' || member.alive === false || member.left === true) {
          throw Object.assign(new Error('本場戰鬥已無法作答。'), { status: 409 });
        }
        if (q.uid !== ctx.uid || q.resolved === true || member.activeQuestionId !== questionId) {
          throw Object.assign(new Error('這道題目已結算。'), { status: 409 });
        }
        const correct = selectedChoice === Number(q.ans);
        const members = { ...room.members };
        const boss = { ...room.boss };
        const damage = correct ? Math.max(1, Math.round(finite(member.atk, 200))) : 0;
        boss.hp = Math.max(0, Math.round(finite(boss.hp)) - damage);
        boss.phase = shenPhaseForHp(boss.hp, boss.maxHp);
        const resolvedAtMs = now();
        members[ctx.uid] = {
          ...member,
          damage: Math.max(0, Math.round(finite(member.damage))) + damage,
          correct: Math.max(0, Math.floor(finite(member.correct))) + (correct ? 1 : 0),
          answered: Math.max(0, Math.floor(finite(member.answered))) + 1,
          activeQuestionId: '',
          nextQuestionAtMs: nextPersonalQuestionAt(q.issuedAtMs, resolvedAtMs),
          lastSeenAtMs: resolvedAtMs
        };
        let status = room.status;
        let endedAtMs = room.endedAtMs || 0;
        if (boss.hp <= 0) {
          status = 'won';
          endedAtMs = resolvedAtMs;
        }
        tx.update(questionRef, { resolved: true, selectedChoice, correct, resolvedAtMs });
        tx.update(roomRef, { members, boss, status, endedAtMs });
        result = {
          correct, correctIndex: Number(q.ans), explanation: q.exp, damage,
          room: serializeRoom({ ...room, members, boss, status, endedAtMs })
        };
      });
      return res.json({ ok: true, ...result });
    } catch (error) { return handleError(res, error, logger); }
  }

  async function tick(req, res) {
    try {
      const ctx = await context(req);
      const id = normalizeRoomId(req.body?.roomId);
      const ref = ctx.c.db.collection(ROOM_COLLECTION).doc(id);
      let roomOut;
      let actions = [];
      await ctx.c.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error('團本房間已不存在。'), { status: 404 });
        const room = snap.data();
        validMember(room, ctx.uid);
        if (room.status !== 'active' || !room.boss) { roomOut = room; return; }
        const boss = { ...room.boss };
        const members = { ...room.members };
        const current = now();
        let status = room.status;
        let endedAtMs = room.endedAtMs || 0;
        while (status === 'active' && current >= finite(boss.nextActionAtMs) && boss.actionCount < MAX_BOSS_ACTIONS) {
          const intent = bossIntent({ actionCount: boss.actionCount, hp: boss.hp, maxHp: boss.maxHp });
          const hit = {};
          for (const [uid, raw] of Object.entries(members)) {
            const member = { ...raw };
            if (member.left === true || member.alive === false || member.hp <= 0) continue;
            let damage = Math.max(70, Math.round(Math.max(1, finite(member.maxHp, 1000)) * 0.105 * intent.multiplier));
            let guarded = false;
            if (Math.max(0, finite(member.guardCharges)) > 0) {
              member.guardCharges = Math.max(0, Math.floor(finite(member.guardCharges)) - 1);
              damage = 0;
              guarded = true;
            }
            member.hp = Math.max(0, Math.round(finite(member.hp)) - damage);
            if (member.hp <= 0) member.alive = false;
            members[uid] = member;
            hit[uid] = { damage, guarded, hp: member.hp };
          }
          boss.actionCount = Math.max(0, Math.floor(finite(boss.actionCount))) + 1;
          boss.nextActionAtMs = finite(boss.nextActionAtMs) + BOSS_INTERVAL_MS;
          boss.phase = shenPhaseForHp(boss.hp, boss.maxHp);
          boss.lastAction = { number: boss.actionCount, name: intent.name, kind: intent.kind, atMs: current, hit };
          actions.push(boss.lastAction);
          const living = Object.values(members).some((row) => row.left !== true && row.alive !== false && row.hp > 0);
          if (!living) { status = 'lost'; endedAtMs = current; }
          else if (boss.actionCount >= MAX_BOSS_ACTIONS) { status = 'lost'; endedAtMs = current; }
        }
        roomOut = { ...room, members, boss, status, endedAtMs };
        if (actions.length || status !== room.status) tx.update(ref, { members, boss, status, endedAtMs });
      });
      return res.json({ ok: true, room: serializeRoom(roomOut), actions });
    } catch (error) { return handleError(res, error, logger); }
  }

  async function leave(req, res) {
    try {
      const ctx = await context(req);
      const id = normalizeRoomId(req.body?.roomId);
      const ref = ctx.c.db.collection(ROOM_COLLECTION).doc(id);
      let roomOut = null;
      await ctx.c.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const room = snap.data();
        validMember(room, ctx.uid);
        const members = { ...room.members };
        if (room.status === 'waiting') {
          delete members[ctx.uid];
          if (!Object.keys(members).length) {
            tx.delete(ref);
            return;
          }
          const leaderUid = room.leaderUid === ctx.uid ? Object.keys(members)[0] : room.leaderUid;
          roomOut = { ...room, members, leaderUid };
          tx.update(ref, { members, leaderUid });
          return;
        }
        members[ctx.uid] = { ...members[ctx.uid], left: true, alive: false, activeQuestionId: '', lastSeenAtMs: now() };
        let status = room.status;
        let endedAtMs = room.endedAtMs || 0;
        if (status === 'active' && !Object.values(members).some((row) => row.left !== true && row.alive !== false && row.hp > 0)) {
          status = 'lost';
          endedAtMs = now();
        }
        roomOut = { ...room, members, status, endedAtMs };
        tx.update(ref, { members, status, endedAtMs });
      });
      return res.json({ ok: true, room: serializeRoom(roomOut) });
    } catch (error) { return handleError(res, error, logger); }
  }

  async function claim(req, res) {
    try {
      const ctx = await context(req);
      const id = normalizeRoomId(req.body?.roomId);
      const roomSnap = await ctx.c.db.collection(ROOM_COLLECTION).doc(id).get();
      if (!roomSnap.exists) throw Object.assign(new Error('團本房間已不存在。'), { status: 404 });
      const room = roomSnap.data();
      validMember(room, ctx.uid);
      if (room.status !== 'won') throw Object.assign(new Error('只有成功討伐後才能領取獎勵。'), { status: 409 });
      const claimId = id + '_' + ctx.uid;
      const claimRef = ctx.a.db.collection(CLAIM_COLLECTION).doc(claimId);
      const userRef = ctx.a.db.collection('users').doc(ctx.uid);
      let reward;
      let materialSystem;
      await ctx.a.db.runTransaction(async (tx) => {
        const [claimSnap, userSnap] = await Promise.all([tx.get(claimRef), tx.get(userRef)]);
        if (claimSnap.exists) {
          reward = claimSnap.data()?.reward || {};
          materialSystem = userSnap.exists ? userSnap.data()?.materialSystem || { inventory: {} } : { inventory: {} };
          return;
        }
        if (!userSnap.exists) throw new Error('玩家資料不存在。');
        const raw = userSnap.data() || {};
        materialSystem = raw.materialSystem && typeof raw.materialSystem === 'object'
          ? JSON.parse(JSON.stringify(raw.materialSystem)) : { inventory: {} };
        materialSystem.inventory = materialSystem.inventory && typeof materialSystem.inventory === 'object'
          ? { ...materialSystem.inventory } : {};
        reward = {
          [SECOND_REFINEMENT_KEY]: 1,
          [THIRD_REFINEMENT_KEY]: deterministicThirdKey(id, ctx.uid) ? 1 : 0
        };
        for (const [materialId, quantity] of Object.entries(reward)) {
          if (quantity > 0) materialSystem.inventory[materialId] =
            Math.max(0, Math.floor(finite(materialSystem.inventory[materialId]))) + quantity;
        }
        tx.update(userRef, { materialSystem });
        tx.create(claimRef, {
          uid: ctx.uid, roomId: id, bossId: room.boss?.id || 'shen-qingshuang',
          reward, claimedAtMs: now()
        });
      });
      return res.json({ ok: true, reward, materialSystem });
    } catch (error) { return handleError(res, error, logger); }
  }

  return { create, join, state, heartbeat, ready, start, question, answer, tick, leave, claim };
}

function registerRaidApi(app, options = {}) {
  const api = createRaidApi(options);
  app.post('/api/raid/create', api.create);
  app.post('/api/raid/join', api.join);
  app.get('/api/raid/state', api.state);
  app.post('/api/raid/heartbeat', api.heartbeat);
  app.post('/api/raid/ready', api.ready);
  app.post('/api/raid/start', api.start);
  app.post('/api/raid/question', api.question);
  app.post('/api/raid/answer', api.answer);
  app.post('/api/raid/tick', api.tick);
  app.post('/api/raid/leave', api.leave);
  app.post('/api/raid/claim', api.claim);
  return api;
}

module.exports = registerRaidApi;
module.exports.createRaidApi = createRaidApi;
module.exports.scaleBossForTeam = scaleBossForTeam;
module.exports.shenPhaseForHp = shenPhaseForHp;
module.exports.bossIntent = bossIntent;
module.exports.refinementKeyQuantity = refinementKeyQuantity;
module.exports.nextPersonalQuestionAt = nextPersonalQuestionAt;
module.exports.constants = {
  RAID_SCHEMA_VERSION, MAX_MEMBERS, MIN_SCORE, MIN_QUESTION_CYCLE_MS, REVIEW_LOCK_MS,
  BOSS_INTERVAL_MS, BOSS_TELEGRAPH_MS, MAX_BOSS_ACTIONS,
  SECOND_REFINEMENT_KEY, THIRD_REFINEMENT_KEY
};

'use strict';

const { PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const { playerRepository, raidRepository } = require('./server-repositories.cjs');
const {
  loadTrustedRaidPlayer, memberSnapshotFromTrusted, createTeamBoss, bossPhase,
  resolvePlayerAction
} = require('./raid-authority.cjs');
const { readRaidQuestionTicket, assertRaidQuestionTicket } = require('./raid-question-ticket.cjs');
const { advanceRaidRoom, startRaidScheduler } = require('./raid-clock.cjs');

const COLLECTION = 'raidRooms';
const MAX_MEMBERS = 4;
const STALE_MS = 45000;
const ROOM_TTL_MS = 30 * 60 * 1000;
const RAID_ROOM_VERSION = 2;
const RAID_BOSS_ID = 'shen-qingshuang';
const BOSS_ACTION_INTERVAL_MS = 18000;

function now() { return Date.now(); }
function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function membersOf(room) {
  return room?.members && typeof room.members === 'object' ? room.members : {};
}
function memberOnline(member) {
  return !!member && member.online !== false && now() - finite(member.heartbeatAtMs) <= STALE_MS;
}
function activeMembers(room) {
  return Object.values(membersOf(room)).filter(memberOnline);
}
function roomUsable(room) {
  if (!room || room.status !== 'waiting') return false;
  if (now() - finite(room.createdAtMs) > ROOM_TTL_MS) return false;
  return activeMembers(room).length < MAX_MEMBERS;
}
function safeRoomId(value) {
  const roomId = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,160}$/.test(roomId) ? roomId : '';
}
function safeRoomCode(value) {
  const roomCode = String(value || '').trim().toUpperCase();
  return /^[A-Z2-9]{6}$/.test(roomCode) ? roomCode : '';
}
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
function cleanString(value, max = 160) {
  return String(value || '').slice(0, max);
}
function memberSnapshot(player, uid, host = false) {
  return memberSnapshotFromTrusted({ ...player, uid: String(uid || player?.uid || '') }, host);
}
function publicRoom(roomId, room) {
  if (!room) return null;
  return { id: roomId, ...room };
}
function requireMember(room, uid) {
  const member = membersOf(room)[uid];
  if (!member) {
    const error = new Error('你不在這個團本隊伍');
    error.status = 403;
    throw error;
  }
  return member;
}
async function uniqueCode(db) {
  for (let i = 0; i < 8; i += 1) {
    const candidate = makeCode();
    const snap = await db.collection(COLLECTION).where('code', '==', candidate).limit(1).get();
    if (snap.empty) return candidate;
  }
  throw new Error('無法建立唯一隊伍代碼');
}
async function createRoom(db, uid, player) {
  const ref = db.collection(COLLECTION).doc();
  const room = {
    version: RAID_ROOM_VERSION,
    code: await uniqueCode(db),
    status: 'waiting',
    hostUid: uid,
    createdAt: new Date(),
    createdAtMs: now(),
    startedAtMs: 0,
    finishedAtMs: 0,
    bossId: RAID_BOSS_ID,
    bossHp: 0,
    bossMaxHp: 0,
    bossBaseAttack: 0,
    bossPhase: 1,
    bossActionCount: 0,
    lastBossAction: null,
    maxMembers: MAX_MEMBERS,
    members: { [uid]: memberSnapshot(player, uid, true) }
  };
  await ref.set(room);
  return { roomId: ref.id, room: publicRoom(ref.id, room) };
}
async function joinWaitingRoom(db, uid, roomId, player) {
  const ref = db.collection(COLLECTION).doc(roomId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw Object.assign(new Error('隊伍已不存在'), { status: 404 });
    const room = snap.data() || {};
    const members = { ...membersOf(room) };
    if (!roomUsable(room)) throw Object.assign(new Error('隊伍已滿或已開始'), { status: 409 });
    if (!members[uid] && Object.keys(members).length >= MAX_MEMBERS) {
      throw Object.assign(new Error('隊伍已滿或已開始'), { status: 409 });
    }
    const previous = members[uid] || null;
    members[uid] = previous
      ? {
          ...memberSnapshot(player, uid, previous.host === true),
          ready: previous.ready === true,
          joinedAtMs: finite(previous.joinedAtMs) || now(),
          online: true,
          heartbeatAtMs: now()
        }
      : memberSnapshot(player, uid, false);
    tx.update(ref, { members });
    return { roomId, room: publicRoom(roomId, { ...room, members }) };
  });
}
async function findOrCreate(db, uid, player) {
  const snap = await db.collection(COLLECTION).where('status', '==', 'waiting').limit(24).get();
  const candidates = snap.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(roomUsable)
    .sort((a, b) => activeMembers(b).length - activeMembers(a).length || finite(a.createdAtMs) - finite(b.createdAtMs));
  for (const candidate of candidates) {
    try {
      return await joinWaitingRoom(db, uid, candidate.id, player);
    } catch (error) {
      if (![404, 409].includes(error?.status)) throw error;
    }
  }
  return createRoom(db, uid, player);
}
async function joinByCode(db, uid, roomCode, player) {
  const target = safeRoomCode(roomCode);
  if (!target) throw Object.assign(new Error('請輸入正確的 6 碼隊伍代碼'), { status: 400 });
  const snap = await db.collection(COLLECTION).where('code', '==', target).limit(5).get();
  const hit = snap.docs.find(item => roomUsable(item.data()));
  if (!hit) throw Object.assign(new Error('找不到可加入的隊伍'), { status: 404 });
  return joinWaitingRoom(db, uid, hit.id, player);
}

async function verifyRequest(req, resolveA) {
  const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
  if (!bearer) throw Object.assign(new Error('請先登入後再進入團本'), { status: 401 });
  const a = resolveA();
  let verified;
  try {
    verified = await a.auth.verifyIdToken(bearer[1], true);
  } catch (_) {
    throw Object.assign(new Error('登入狀態已失效，請重新登入'), { status: 401 });
  }
  if (!verified?.uid || verified.aud !== PROJECT_IDS.A ||
      verified.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A) {
    throw Object.assign(new Error('登入身分驗證失敗'), { status: 401 });
  }
  return verified.uid;
}

function createHandler({
  resolveA = () => playerRepository.resolve(),
  resolveC = () => raidRepository.resolve(),
  logger = console
} = {}) {
  return async function raidRoomHandler(req, res) {
    res.set?.('Cache-Control', 'no-store');
    let uid, db, playerDb;
    try {
      uid = await verifyRequest(req, resolveA);
      playerDb = resolveA().db;
      db = resolveC().db;
    } catch (error) {
      const status = error?.status || 503;
      if (status >= 500) logger.error('[Raid room] Firebase Admin unavailable:', error?.message || error);
      return res.status(status).json({ ok: false, error: error?.message || '團本服務尚未完成設定' });
    }

    const action = String(req.body?.action || '').trim();
    try {
      if (action === 'create') {
        const player = await loadTrustedRaidPlayer(playerDb, uid);
        const result = await createRoom(db, uid, player);
        return res.json({ ok: true, ...result });
      }
      if (action === 'quick') {
        const player = await loadTrustedRaidPlayer(playerDb, uid);
        const result = await findOrCreate(db, uid, player);
        return res.json({ ok: true, ...result });
      }
      if (action === 'join-code') {
        const player = await loadTrustedRaidPlayer(playerDb, uid);
        const result = await joinByCode(db, uid, req.body?.roomCode, player);
        return res.json({ ok: true, ...result });
      }

      const roomId = safeRoomId(req.body?.roomId);
      if (!roomId) return res.status(400).json({ ok: false, error: '團本房間代碼無效' });
      const ref = db.collection(COLLECTION).doc(roomId);
      // Catch up before accepting an answer, reconnect or heartbeat as well as
      // on the background timer. A sleeping/restarted server cannot skip damage.
      await advanceRaidRoom(db, ref);

      if (action === 'get') {
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ ok: false, error: '團本房間不存在' });
        const room = snap.data() || {};
        requireMember(room, uid);
        return res.json({ ok: true, room: publicRoom(roomId, room) });
      }

      if (action === 'reconnect') {
        const result = await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) return null;
          const room = snap.data() || {};
          const members = { ...membersOf(room) };
          if (!members[uid] || room.status === 'closed') return null;
          // A returning player must still see the result and claim a pending
          // reward if the server completed the fight while their tab was away.
          if (['won', 'lost'].includes(room.status)) return publicRoom(roomId, room);
          members[uid] = { ...members[uid], online: true, heartbeatAtMs: now() };
          tx.update(ref, { members });
          return publicRoom(roomId, { ...room, members });
        });
        return res.json({ ok: true, roomId: result ? roomId : null, room: result });
      }

      if (action === 'ready') {
        // Refresh the combat projection from Firebase A at the last safe pre-battle boundary.
        // Equipment/stat changes after Ready do not mutate an active raid.
        const trusted = await loadTrustedRaidPlayer(playerDb, uid);
        const room = await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw Object.assign(new Error('隊伍不存在'), { status: 404 });
          const current = snap.data() || {};
          if (current.status !== 'waiting') throw Object.assign(new Error('團本已開始'), { status: 409 });
          const members = { ...membersOf(current) };
          const previous = requireMember(current, uid);
          members[uid] = {
            ...memberSnapshot(trusted, uid, previous.host === true),
            ready: req.body?.ready === true,
            joinedAtMs: finite(previous.joinedAtMs) || now(),
            online: true,
            heartbeatAtMs: now()
          };
          tx.update(ref, { members });
          return publicRoom(roomId, { ...current, members });
        });
        return res.json({ ok: true, room });
      }

      if (action === 'start') {
        const room = await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw Object.assign(new Error('隊伍不存在'), { status: 404 });
          const current = snap.data() || {};
          requireMember(current, uid);
          if (current.hostUid !== uid) throw Object.assign(new Error('只有隊長可以開始'), { status: 403 });
          if (current.status !== 'waiting') return publicRoom(roomId, current);
          const members = activeMembers(current);
          if (!members.length || members.some(member => !member.ready)) {
            throw Object.assign(new Error('仍有隊員尚未準備'), { status: 409 });
          }
          const boss = createTeamBoss(members);
          const update = {
            status: 'active',
            serverDrivenBoss: true,
            startedAtMs: now(),
            bossHp: boss.maxHp,
            bossMaxHp: boss.maxHp,
            bossBaseAttack: boss.baseAttack,
            bossPhase: boss.phase,
            bossActionCount: 0,
            lastBossAction: null
          };
          tx.update(ref, update);
          return publicRoom(roomId, { ...current, ...update });
        });
        return res.json({ ok: true, room });
      }

      if (action === 'heartbeat') {
        await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const current = snap.data() || {};
          const members = { ...membersOf(current) };
          if (!members[uid]) return;
          members[uid] = { ...members[uid], online: true, heartbeatAtMs: now() };
          tx.update(ref, { members });
        });
        return res.json({ ok: true });
      }

      if (action === 'player-action') {
        const id = Math.max(1, Math.floor(finite(req.body?.actionId, 1)));
        const questionId = cleanString(req.body?.questionId || '', 180);
        const choice = Math.floor(finite(req.body?.choice, -1));
        if (!questionId || choice < 0 || choice > 3 || typeof req.body?.ticket !== 'string') {
          return res.status(400).json({ ok: false, error: '團本作答資料無效' });
        }
        const question = assertRaidQuestionTicket(readRaidQuestionTicket(req.body.ticket), {
          uid, roomId, actionId: id, questionId
        });
        const correct = choice === question.answerIndex;
        const result = await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw Object.assign(new Error('團本房間不存在'), { status: 404 });
          const current = snap.data() || {};
          if (current.status !== 'active') return { room: publicRoom(roomId, current), resolution: null };
          const members = { ...membersOf(current) };
          const me = requireMember(current, uid);
          if (me.alive === false) return { room: publicRoom(roomId, current), resolution: null };

          if (id <= finite(me.lastActionId)) {
            const prior = me.lastPlayerResolution;
            return {
              room: publicRoom(roomId, current),
              resolution: prior && finite(prior.actionId) === id ? prior : null
            };
          }
          if (id !== Math.floor(finite(me.lastActionId)) + 1) {
            throw Object.assign(new Error('團本出手序號不同步，請等待房間重新同步'), { status: 409 });
          }
          const answered = Array.isArray(me.answeredQuestionIds) ? me.answeredQuestionIds : [];
          if (answered.includes(questionId)) {
            throw Object.assign(new Error('這道團本題目已經結算'), { status: 409 });
          }

          const combat = resolvePlayerAction({ ...me }, { roomId, actionId: id, correct });
          const dealt = correct ? Math.max(0, Math.round(finite(combat.damage))) : 0;
          const nextBossHp = Math.max(0, Math.round(finite(current.bossHp)) - dealt);
          const resolution = {
            actionId: id,
            questionId,
            correct,
            correctIndex: question.answerIndex,
            explanation: cleanString(question.explanation || '', 3000),
            damage: dealt,
            healed: Math.max(0, Math.round(finite(combat.healed))),
            playerHp: Math.max(0, Math.round(finite(combat.member.hp))),
            bossHp: nextBossHp
          };
          members[uid] = {
            ...combat.member,
            alive: finite(combat.member.hp) > 0,
            damage: Math.max(0, Math.round(finite(me.damage))) + dealt,
            correct: Math.max(0, Math.round(finite(me.correct))) + (correct ? 1 : 0),
            attempts: Math.max(0, Math.round(finite(me.attempts))) + 1,
            lastActionId: id,
            answeredQuestionIds: [...answered, questionId].slice(-30),
            lastPlayerResolution: resolution,
            online: true,
            heartbeatAtMs: now()
          };
          const update = {
            members,
            bossHp: nextBossHp,
            bossPhase: bossPhase(nextBossHp, current.bossMaxHp)
          };
          if (nextBossHp <= 0) {
            update.status = 'won';
            update.finishedAtMs = now();
          }
          tx.update(ref, update);
          return { room: publicRoom(roomId, { ...current, ...update }), resolution };
        });
        return res.json({ ok: true, ...result });
      }

      if (action === 'boss-defense' || action === 'member-state' || action === 'advance-boss') {
        // Older clients may acknowledge an animation. These compatibility calls
        // only read the server's settled result and never apply another hit.
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ ok: false, error: '團本房間不存在' });
        const current = snap.data() || {};
        const me = requireMember(current, uid);
        const seen = Math.floor(finite(req.body?.bossActionSeen));
        const resolution = action === 'boss-defense' && me.lastBossResolution?.bossActionSeen === seen
          ? me.lastBossResolution : null;
        return res.json({ ok: true, room: publicRoom(roomId, current), resolution });
      }

      if (action === 'leave') {
        await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const current = snap.data() || {};
          const members = { ...membersOf(current) };
          if (!members[uid]) return;
          members[uid] = { ...members[uid], online: false, ready: false, host: false, heartbeatAtMs: now() };
          let hostUid = current.hostUid;
          if (hostUid === uid) {
            const replacement = Object.values(members).find(member => member?.uid !== uid && memberOnline(member));
            hostUid = replacement?.uid || uid;
            if (replacement) members[replacement.uid] = { ...replacement, host: true };
          }
          const update = { members, hostUid };
          if (!Object.values(members).some(memberOnline)) update.status = 'closed';
          tx.update(ref, update);
        });
        return res.json({ ok: true });
      }

      return res.status(400).json({ ok: false, error: '未知的團本房間操作' });
    } catch (error) {
      const status = error?.status || 503;
      logger.error('[Raid room]', action || 'unknown', error?.code || error?.message || error);
      return res.status(status).json({ ok: false, error: error?.message || '團本房間暫時無法使用' });
    }
  };
}

module.exports = function registerRaidRoomApi(app) {
  app.post('/api/raid/room', createHandler());
};
module.exports.startScheduler = options => startRaidScheduler({
  resolveDb: () => raidRepository.resolve().db, ...options
});
module.exports.__test = {
  COLLECTION, MAX_MEMBERS, STALE_MS, ROOM_TTL_MS, RAID_ROOM_VERSION, RAID_BOSS_ID,
  BOSS_ACTION_INTERVAL_MS,
  finite, membersOf, memberOnline, activeMembers, roomUsable, safeRoomId, safeRoomCode,
  memberSnapshot, createHandler
};

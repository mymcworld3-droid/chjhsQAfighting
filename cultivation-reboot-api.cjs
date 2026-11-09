'use strict';

const { randomUUID } = require('node:crypto');
const { playerRepository } = require('./server-repositories.cjs');
const { verifyMainIdentity } = require('./raid-question-ticket.cjs');
const Access = require('./public/cultivation/training-access-rules.js');
const Rules = require('./public/cultivation/cultivation-reboot-rules.js');
const Nodes = require('./public/cultivation/cultivation-path-nodes.js');

// A server-owned record in the existing player database. Old clients can update
// the entire users document without overwriting the experimental progression.
const stateRef = (db, uid) => db.collection('cultivationRebootStates').doc(uid);
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const combatStat = (value, fallback, min) => Number.isFinite(Number(value)) ? Math.max(min, Number(value)) : fallback;

function initialState(player) {
  const peakScore = Access.score(player);
  return {
    version: 1, revision: 0, legacyAccess: peakScore >= Rules.GOLDEN_CORE,
    route: null, pathNodes: [], peakScore, trial: null, seal: null
  };
}

function applyAction(state, score, request, attemptId, now) {
  if (state.revision !== request.revision) throw fail('修行已在另一處更新，請同步後再操作。');
  switch (request.action) {
    case 'choose':
      if (state.route) throw fail('已立下流派。');
      if (state.peakScore < Rules.FOUNDATION) throw fail('築基初期開放修行流派。');
      if (typeof request.route !== 'string' || !Object.hasOwn(Rules.ROUTES, request.route)) throw fail('未知的修行流派。', 400);
      return { ...state, route: request.route };
    case 'learn': {
      const target = Nodes.findNode(state.route, request.node);
      if (!target) throw fail('找不到這個流派節點。', 400);
      const { chapter, node } = target;
      const learned = Nodes.learnedSet(state);
      const access = Rules.realmScore(state.peakScore, state);
      const status = Nodes.nodeState(chapter, node, access, learned);
      const errors = { learned: '此節點已研修。', realm: '尚未達到此節點的境界。',
        prerequisite: '請先研修前置節點。', lane: '請先修成其中一脈。', points: '本境界的研修點不足。' };
      if (status !== 'ready') throw fail(errors[status]);
      return { ...state, pathNodes: [...learned, node.id] };
    }
    case 'start':
      if (!Rules.canStart(score, state)) throw fail('須立下流派並達到金丹修為才能引劫。');
      if (state.trial?.status === 'active') throw fail('天劫尚未結束。');
      return { ...state, trial: Rules.newAttempt(attemptId) };
    case 'turn': {
      if (state.seal || !state.trial || request.attemptId !== state.trial.id || request.round !== state.trial.round)
        throw fail('天劫回合已更新，請先同步。');
      const trial = Rules.playTurn(state.route, state.trial, request.move);
      if (!trial) throw fail('此回合無法使用該招式。', 400);
      const seal = trial.status === 'passed' ? { attemptId: trial.id, achievedAtMs: now } : null;
      return { ...state, trial, seal };
    }
    default:
      throw fail('未知的修行操作。', 400);
  }
}

async function transact(db, uid, request, now = Date.now()) {
  const ref = stateRef(db, uid);
  const attemptId = request.action === 'start' ? randomUUID() : null;
  return db.runTransaction(async tx => {
    const [playerSnapshot, saved] = await Promise.all([tx.get(db.collection('users').doc(uid)), tx.get(ref)]);
    if (!playerSnapshot.exists) throw fail('玩家資料尚未就緒。', 404);
    const player = playerSnapshot.data();
    if (player.uid && player.uid !== uid) throw fail('玩家身分不符。', 403);
    if (!saved.exists && request.action !== 'sync') throw fail('請先同步修行紀錄。');
    const previous = saved.exists ? saved.data() : initialState(player);
    const peakScore = Math.max(previous.peakScore, Access.score(player));
    const score = Rules.number(player.stats?.totalScore);
    let state = { ...previous, peakScore };
    if (request.action !== 'sync') {
      state = applyAction(state, score, request, attemptId, now);
      state.revision += 1;
    }
    if (!saved.exists || peakScore !== previous.peakScore || state.revision !== previous.revision) tx.set(ref, state);
    return { state, score };
  });
}

// Feed branch progression into the existing battle snapshot builders. Stored
// equipment, raw cultivation, matchmaking scores and reward inputs stay intact.
function combatPlayer(player, state) {
  const stats = player.stats || {};
  const perks = Rules.bonuses(state);
  const base = {
    ...player, artifactSystem: {},
    stats: { ...stats, attack: combatStat(stats.attack, 200, 0) + perks.attack,
      maxHp: combatStat(stats.maxHp, 1000, 1) + perks.maxHp }
  };
  if (state?.seal && Access.rawScore(player) < Rules.GOLDEN_CORE) {
    base.trainingAccess = { version: 1, highestRealmScore: Rules.GOLDEN_CORE };
  }
  if (!state?.seal && !state?.legacyAccess) {
    base.stats.totalScore = Rules.realmScore(Rules.number(stats.totalScore), state || {});
    base.trainingAccess = { version: 1, highestRealmScore: Math.min(Access.savedScore(player), Rules.GOLDEN_CORE - 1) };
    base.cultivationTraining = null;
  }
  return base;
}

function combatSkills(build, state) {
  const artifactBattle = Rules.battleSnapshot(state, build.goldenCore);
  return { ...build, artifactBattle, artifactShield: artifactBattle.openingShield, equipment: [] };
}

function registerCultivationReboot(app, { resolveA = () => playerRepository.resolve(), logger = console } = {}) {
  app.post('/api/cultivation-reboot', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!req.get('authorization')) throw fail('請先登入再修行。', 401);
      const uid = await verifyMainIdentity(req, { resolveA });
      const body = req.body;
      if (!body || !['sync', 'choose', 'learn', 'start', 'turn'].includes(body.action))
        throw fail('未知的修行操作。', 400);
      if (body.action !== 'sync' && !Number.isSafeInteger(body.revision))
        throw fail('請先同步修行紀錄。', 400);
      return res.json(await transact(resolveA().db, uid, body));
    } catch (error) {
      if (!error.status) logger.error('[Cultivation reboot]', error.code || error.message);
      return res.status(error.status || 503).json({
        error: error.status ? error.message : '修行資料暫時無法同步，請重試。'
      });
    }
  });
}

module.exports = { registerCultivationReboot, stateRef, initialState, transact, combatPlayer, combatSkills };

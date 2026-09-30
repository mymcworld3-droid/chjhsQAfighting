'use strict';

const crypto = require('node:crypto');
const { PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const { playerRepository, raidRepository } = require('./server-repositories.cjs');
const { victoryDate, MEMENTO } = require('./raid-loot.cjs');
const { runRewardReceipt } = require('./reward-receipt.cjs');

const RAID_ROOM_COLLECTION = 'raidRooms';
const CLAIM_COLLECTION = 'raidRewardClaims';
const RAID_BOSS_ID = 'shen-qingshuang';
const RAID_ROOM_VERSION = 2;
const REWARDS = Object.freeze({
  'raid-secret-realm-essence': 2,
  'raid-shen-sword-soul': 1
});

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function safeRoomId(value) {
  const roomId = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,160}$/.test(roomId) ? roomId : '';
}
function claimId(roomId, uid) {
  return crypto.createHash('sha256').update(String(roomId) + '\n' + String(uid)).digest('hex');
}
function membersOf(room) {
  return room?.members && typeof room.members === 'object' ? room.members : {};
}

function validateRaidVictory(room, uid) {
  if (!room || Number(room.version) !== RAID_ROOM_VERSION) return { ok:false, reason:'團本房間版本無效' };
  if (room.bossId !== RAID_BOSS_ID) return { ok:false, reason:'團本 Boss 不符' };
  if (room.status !== 'won' || finite(room.bossHp, 1) > 0) return { ok:false, reason:'此團本尚未完成勝利結算' };
  const members = membersOf(room);
  const member = members[uid];
  if (!member || member.uid !== uid) return { ok:false, reason:'你不是此團本的參戰成員' };

  const maxHp = Math.max(0, Math.round(finite(room.bossMaxHp)));
  if (maxHp < 1800) return { ok:false, reason:'團本 Boss 資料異常' };
  const actionCount = Math.max(0, Math.floor(finite(room.bossActionCount)));
  if (!Number.isFinite(actionCount) || actionCount < 0) return { ok:false, reason:'團本行動紀錄異常' };
  const startedAtMs = Math.max(0, finite(room.startedAtMs));
  const finishedAtMs = Math.max(0, finite(room.finishedAtMs));
  if (!startedAtMs || !finishedAtMs || finishedAtMs < startedAtMs) return { ok:false, reason:'團本時間紀錄不完整' };

  let totalDamage = 0;
  for (const row of Object.values(members)) {
    if (!row || typeof row !== 'object') return { ok:false, reason:'隊員紀錄異常' };
    const damage = finite(row.damage, -1);
    const attempts = finite(row.attempts, -1);
    const correct = finite(row.correct, -1);
    if (damage < 0 || attempts < 0 || correct < 0 || correct > attempts) {
      return { ok:false, reason:'隊員戰鬥紀錄異常' };
    }
    totalDamage += Math.max(0, Math.round(damage));
  }
  // The boss can only reach zero through player damage or recorded reflection;
  // both are accumulated in members[*].damage by the room protocol.
  if (totalDamage < maxHp) return { ok:false, reason:'團本傷害紀錄不足以擊敗 Boss' };
  return { ok:true, finishedAtMs, member, totalDamage, partySize:Object.keys(members).length, bossMaxHp:maxHp };
}

async function awardRaidReward(db, uid, roomId, validation, {
  rewards = REWARDS,
  fieldValue = require('firebase-admin/firestore').FieldValue
} = {}) {
  const userRef = db.collection('users').doc(uid);
  const receipt = await runRewardReceipt({
    db,
    collection: CLAIM_COLLECTION,
    receiptId: claimId(roomId, uid),
    fieldValue,
    onFirstClaim: async ({ tx }) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new Error('玩家資料不存在');
      const user = userSnap.data() || {};
      const date = victoryDate(validation.finishedAtMs);
      const dailyRef = date ? db.collection('raidDailyClaims').doc(claimId(RAID_BOSS_ID + ':' + date, uid)) : null;
      const dailySnap = dailyRef ? await tx.get(dailyRef) : null;
      if (user.uid && user.uid !== uid) throw new Error('玩家資料 UID 不符');

      const firstVictory = !user.raidProgress?.[RAID_BOSS_ID]?.firstVictoryRoomId;
      const dailyFirstVictory = !!date && !dailySnap.exists;
      const granted = { ...rewards };
      if (dailyFirstVictory) {
        granted['raid-secret-realm-essence'] = (granted['raid-secret-realm-essence'] || 0) + 1;
      }
      // Boss 專屬材料讓首通也有一次明顯躍升，但後續仍可重複農取。
      if (firstVictory) {
        granted['raid-shen-sword-soul'] = (granted['raid-shen-sword-soul'] || 0) + 1;
      }
      const raidProgress = { ...(user.raidProgress || {}) };
      raidProgress[RAID_BOSS_ID] = { ...(raidProgress[RAID_BOSS_ID] || {}),
        ...(firstVictory ? {firstVictoryRoomId:roomId, firstVictoryAtMs:validation.finishedAtMs || 0, memento:MEMENTO} : {})
      };
      const materialSystem = user.materialSystem && typeof user.materialSystem === 'object'
        ? JSON.parse(JSON.stringify(user.materialSystem)) : { inventory:{} };
      materialSystem.inventory = materialSystem.inventory && typeof materialSystem.inventory === 'object'
        ? { ...materialSystem.inventory } : {};
      for (const [materialId, amount] of Object.entries(granted)) {
        const qty = Math.max(0, Math.floor(Number(amount) || 0));
        if (!qty) continue;
        materialSystem.inventory[materialId] = Math.max(0, Math.floor(Number(materialSystem.inventory[materialId]) || 0)) + qty;
      }
      const inventory = Object.fromEntries(
        Object.keys(granted).map(id => [id, Number(materialSystem.inventory[id]) || 0])
      );
      tx.update(userRef, { materialSystem, raidProgress });
      if (dailyFirstVictory) tx.create(dailyRef, {uid,roomId,bossId:RAID_BOSS_ID,date});
      return { inventory, rewards:granted, firstVictory, dailyFirstVictory, date,
        memento:firstVictory ? MEMENTO : null };
    },
    createReceipt: result => ({
      uid,
      roomId,
      bossId: RAID_BOSS_ID,
      ...result,
      partySize: validation.partySize,
      totalDamage: validation.totalDamage,
      bossMaxHp: validation.bossMaxHp
    })
  });

  if (receipt.duplicate) {
    return {
      status:'duplicate',
      awarded:false,
      rewards:receipt.receipt.rewards || rewards,
      inventory:receipt.receipt.inventory || null,
      firstVictory:receipt.receipt.firstVictory || false,
      dailyFirstVictory:receipt.receipt.dailyFirstVictory || false,
      memento:receipt.receipt.memento || null,
      realm:receipt.receipt.realm || null,
      date:receipt.receipt.date || null
    };
  }
  return {
    status:'awarded',
    awarded:true,
    ...receipt.result
  };
}

function createHandler({
  resolveA = () => playerRepository.resolve(),
  resolveC = () => raidRepository.resolve(),
  award = awardRaidReward,
  logger = console
} = {}) {
  return async function raidRewardHandler(req, res) {
    res.set?.('Cache-Control', 'no-store');
    const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
    if (!bearer) return res.status(401).json({ ok:false, error:'請先登入後再領取團本獎勵' });
    const roomId = safeRoomId(req.body?.roomId);
    if (!roomId) return res.status(400).json({ ok:false, error:'團本房間代碼無效' });

    let a, c;
    try {
      a = resolveA();
      c = resolveC();
    } catch (error) {
      logger.error('[Raid reward] Firebase Admin unavailable:', error?.message || error);
      return res.status(503).json({ ok:false, error:'團本獎勵服務尚未完成設定' });
    }

    let verified;
    try {
      verified = await a.auth.verifyIdToken(bearer[1], true);
    } catch (_) {
      return res.status(401).json({ ok:false, error:'登入狀態已失效，請重新登入' });
    }
    if (!verified?.uid || verified.aud !== PROJECT_IDS.A ||
        verified.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A) {
      return res.status(401).json({ ok:false, error:'登入身分驗證失敗' });
    }

    try {
      const snap = await c.db.collection(RAID_ROOM_COLLECTION).doc(roomId).get();
      if (!snap.exists) return res.status(404).json({ ok:false, error:'找不到團本結算紀錄' });
      const room = snap.data() || {};
      const validation = validateRaidVictory(room, verified.uid);
      if (!validation.ok) return res.status(409).json({ ok:false, error:validation.reason });
      const outcome = await award(a.db, verified.uid, roomId, validation);
      return res.json({ ok:true, ...outcome });
    } catch (error) {
      logger.error('[Raid reward] settlement failed:', error?.code || error?.message || error);
      return res.status(503).json({ ok:false, error:'團本獎勵尚未完成入帳，請稍後重試' });
    }
  };
}

module.exports = function registerRaidRewardApi(app) {
  app.post('/api/raid/reward', createHandler());
};
module.exports.__test = {
  RAID_ROOM_COLLECTION, CLAIM_COLLECTION, RAID_BOSS_ID, RAID_ROOM_VERSION,
  REWARDS, safeRoomId, claimId, validateRaidVictory,
  awardRaidReward, createHandler
};


'use strict';
// Invalid historical Five Immortals placements are pruned with server credentials;
// clients cannot delete another player's seat. Run only for authenticated players.
const { playerRepository } = require('./server-repositories.cjs');
const { PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const TRIBULATION_SCORE = 1268;
const ROLE_IDS = new Set(['ru-xian','fa-xian','suan-xian','xuan-xian','wai-xian']);

function invalidSeat(data, userData) {
  return !data?.uid || !userData || (Number(userData.stats?.totalScore) || 0) < TRIBULATION_SCORE;
}

async function pruneInvalidSeats(db) {
  const seats = await db.collection('worldImmortals').get();
  const records = seats.docs.filter(doc => ROLE_IDS.has(doc.id));
  if (!records.length) return 0;
  // Read each seat again inside the transaction so a fresh challenge cannot be deleted.
  return db.runTransaction(async tx => {
    const current = await Promise.all(records.map(row => tx.get(row.ref)));
    const uids = [...new Set(current.filter(s => s.exists && s.data()?.uid).map(s => s.data().uid))];
    const profiles = await Promise.all(uids.map(uid => tx.get(db.collection('users').doc(uid))));
    const users = new Map(uids.map((uid, index) => [uid, profiles[index].exists ? profiles[index].data() : null]));
    let deleted = 0;
    for (const seat of current) {
      if (!seat.exists) continue;
      const data = seat.data();
      if (!invalidSeat(data, users.get(data.uid))) continue;
      tx.delete(seat.ref);
      deleted++;
    }
    return deleted;
  });
}

function createHandler({ resolve = () => playerRepository.resolve(), logger = console } = {}) {
  return async (req, res) => {
    res.set?.('Cache-Control','no-store');
    const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
    if (!match) return res.status(401).json({ ok:false, error:'請先登入' });
    try {
      const project = resolve();
      const identity = await project.auth.verifyIdToken(match[1], true);
      if (!identity?.uid || identity.aud !== PROJECT_IDS.A ||
          identity.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A) {
        return res.status(401).json({ ok:false, error:'登入身分驗證失敗' });
      }
      const deleted = await pruneInvalidSeats(project.db);
      return res.json({ok:true, removed:deleted});
    } catch (error) {
      logger.warn?.('[Five Immortals cleanup]', error?.code || error?.message || error);
      return res.status(503).json({ok:false, error:'仙榜清理暫時無法完成'});
    }
  };
}
module.exports = app => app.post('/api/immortals/prune-ineligible', createHandler());
module.exports.__test = { TRIBULATION_SCORE, ROLE_IDS, invalidSeat, pruneInvalidSeats, createHandler };

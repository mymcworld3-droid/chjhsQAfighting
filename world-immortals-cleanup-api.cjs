'use strict';
// Migrate the historical shared Five Immortals seats into separate school cohorts
// and delete invalid placements, using an authenticated server transaction.
const { playerRepository } = require('./server-repositories.cjs');
const { PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const TRIBULATION_SCORE = 1268;
const ROLE_IDS = new Set(['ru-xian','fa-xian','suan-xian','xuan-xian','wai-xian']);
const COHORTS = ['elementary','junior'];

function educationCohort(level) {
  const grade = String(level || '').trim();
  if (/^(國小|小學|幼兒|學齡前|未就學)/.test(grade)) return 'elementary';
  if (/^(國中|初中|高中|高職|高中職|大學|專科|研究所|社會人士|成人)/.test(grade)) return 'junior';
  return null;
}
function seatId(group, role) { return COHORTS.includes(group) && ROLE_IDS.has(role) ? group + '__' + role : null; }
function seatDetails(id) {
  if (ROLE_IDS.has(id)) return { legacy: true, role: id, group: null };
  for (const group of COHORTS) {
    const prefix = group + '__';
    if (id.startsWith(prefix) && ROLE_IDS.has(id.slice(prefix.length)))
      return { legacy: false, role: id.slice(prefix.length), group };
  }
  return null;
}
function invalidSeat(data, userData, docId) {
  const group = educationCohort(userData?.profile?.educationLevel);
  if (!data?.uid || !userData || !group || (Number(userData.stats?.totalScore) || 0) < TRIBULATION_SCORE) return true;
  if (docId) {
    const details = seatDetails(docId);
    if (!details || (!details.legacy && (details.group !== group || data.cohort !== group))) return true;
  }
  return false;
}

async function pruneInvalidSeats(db) {
  const seatCollection = db.collection('worldImmortals');
  const existing = await seatCollection.get();
  const records = existing.docs.filter(row => seatDetails(row.id));
  if (!records.length) return 0;
  // Reads precede writes. Target seats are read even when absent in the first
  // snapshot, so two simultaneous clients cannot overwrite a fresh challenge.
  return db.runTransaction(async tx => {
    const current = await Promise.all(records.map(row => tx.get(row.ref)));
    const uids = [...new Set(current.filter(s => s.exists && s.data()?.uid).map(s => s.data().uid))];
    const profiles = await Promise.all(uids.map(uid => tx.get(db.collection('users').doc(uid))));
    const users = new Map(uids.map((uid,i) => [uid,profiles[i].exists ? profiles[i].data() : null]));
    const targetIds = COHORTS.flatMap(group => [...ROLE_IDS].map(role => seatId(group,role)));
    const targets = await Promise.all(targetIds.map(id => tx.get(seatCollection.doc(id))));
    const targetMap = new Map(targetIds.map((id,i) => [id,targets[i]]));
    const existingMap = new Map(records.map((row,i) => [row.id,current[i]]));
    let removed = 0;
    // Existing scoped seats must belong to a qualified player of that cohort.
    for (const row of records) {
      const seat = existingMap.get(row.id);
      if (!seat?.exists) continue;
      const details = seatDetails(row.id);
      if (!details.legacy && invalidSeat(seat.data(),users.get(seat.data().uid),row.id)) {
        tx.delete(row.ref);
        removed++;
      }
    }
    // Place valid legacy seat holders in their own school cohort. Never replace
    // a valid occupied destination or grant two seats within the same cohort.
    for (const row of records) {
      const details = seatDetails(row.id);
      if (!details?.legacy) continue;
      const seat = existingMap.get(row.id);
      if (!seat?.exists) continue;
      const data = seat.data();
      const profile = users.get(data.uid);
      if (!invalidSeat(data,profile,row.id)) {
        const group = educationCohort(profile.profile?.educationLevel);
        const destination = seatId(group,details.role);
        const destSnapshot = targetMap.get(destination);
        const destInvalid = destSnapshot.exists &&
          invalidSeat(destSnapshot.data(),users.get(destSnapshot.data().uid),destination);
        const alreadyHasSeat = targetIds.some(id => {
          if (!id.startsWith(group + '__') || id === destination) return false;
          const other = targetMap.get(id);
          return other?.exists && other.data().uid === data.uid &&
            !invalidSeat(other.data(),users.get(other.data().uid),id);
        });
        if ((!destSnapshot.exists || destInvalid) && !alreadyHasSeat) {
          tx.set(seatCollection.doc(destination), { ...data, cohort:group, role:details.role, migratedFrom:'legacy' });
        }
      }
      tx.delete(row.ref);
      removed++;
    }
    return removed;
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
      const removed = await pruneInvalidSeats(project.db);
      return res.json({ok:true, removed});
    } catch (error) {
      logger.warn?.('[Five Immortals migration]', error?.code || error?.message || error);
      return res.status(503).json({ok:false, error:'五仙榜整理暫時無法完成'});
    }
  };
}
module.exports = app => app.post('/api/immortals/prune-ineligible', createHandler());
module.exports.__test = {TRIBULATION_SCORE, ROLE_IDS, COHORTS, educationCohort, seatId, seatDetails, invalidSeat, pruneInvalidSeats, createHandler};

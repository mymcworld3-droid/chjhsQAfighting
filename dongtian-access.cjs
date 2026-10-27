'use strict';
const fail = (message, status = 403) => Object.assign(Error(message), { status, code: status === 403 ? 'permission-denied' : 'failed-precondition' });
function listed(cave, now = Date.now()) {
  return cave?.status === 'active' && !cave.tutorialOnly && (!cave.visibility || cave.visibility === 'public') &&
    (!cave.openAtMs || cave.openAtMs <= now) && (!cave.closeAtMs || cave.closeAtMs > now);
}
async function teacherAccess(db, uid) {
  const [user, teacher] = await Promise.all([db.collection('users').doc(uid).get(), db.collection('classroomTeacherAccounts').doc(uid).get()]);
  return { admin: user.data()?.isAdmin === true, teacher: teacher.data()?.status === 'approved' };
}
async function assertEntry(cave, uid, db, now = Date.now()) {
  const visibility = cave.visibility || 'public';
  // Legacy public caves retain their established entry behavior.
  if (!cave.teacherManaged && !cave.visibility) return;
  const manager = cave.ownerUid === uid && (!cave.teacherManaged || db && Object.values(await teacherAccess(db, uid)).some(Boolean));
  if (manager) return;
  if (cave.status !== 'active' || cave.openAtMs && now < cave.openAtMs || cave.closeAtMs && now >= cave.closeAtMs) throw fail('洞天尚未開放或已超過開放時間', 409);
  if (['public', 'unlisted'].includes(visibility)) return;
  if (visibility === 'class' && db && cave.classId) {
    const room = (await db.collection('classrooms').doc(cave.classId).get()).data();
    if (room?.status === 'active' && (room.members?.some(m => m.uid === uid) || room.ownerUid === uid && (await teacherAccess(db, uid)).teacher)) return;
  }
  throw fail('此洞天未對你開放');
}
module.exports = { listed, teacherAccess, assertEntry };

'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { setup } = require('./helpers/d1-db.cjs');
const register = require('../teacher-dongtian-api.cjs');
const { perform } = register;
const { listed, assertEntry } = require('../dongtian-access.cjs');
const { createEntryHandler } = require('../dongtian-entry-api.cjs');
const Settlement = require('../dongtian-settlement-api.cjs').__test;
const NOW = 1900000000000;
function body() { return { name: '代數練習', subject: '數學', level: '國中一年級', difficulty: 'medium', questions: [
  { q: '1+1=?', correct: '2', wrong: ['1', '3', '4'], exp: '一加一等於二。', knowledge_points: [{ subject: '數學', id: 'math-1', name: '數與運算' }] },
  { q: '2+2=?', correct: '4', wrong: ['1', '2', '3'], exp: '二加二等於四。' }
] }; }
async function fixture() {
  const { db: a, secondary: bd } = setup(); let n = 0;
  for (const uid of ['teacher', 'other', 'student', 'admin', 'applicant']) await a.doc('users/' + uid).set({ uid, displayName: uid, isAdmin: uid === 'admin', isTeacher: true });
  for (const uid of ['teacher', 'other']) await a.doc('classroomTeacherAccounts/' + uid).set({ uid, status: 'approved', version: 1 });
  await a.doc('classrooms/class-1').set({ id: 'class-1', ownerUid: 'teacher', teacherName: 'teacher', name: '七年一班', status: 'active', members: [{ uid: 'student', name: '學生', seat: '1' }], assignmentIds: [] });
  await a.doc('classroomProfiles/teacher').set({ classIds: ['class-1'] });
  await a.doc('classroomProfiles/student').set({ classIds: ['class-1'] });
  const call = (uid, action, data = {}) => perform(a, bd, uid, { action, ...data }, { now: () => NOW, makeId: () => 'cave-' + ++n });
  const save = async (data = body()) => (await call('teacher', 'save', data)).cave;
  const publish = async cave => (await call('teacher', 'publish', { id: cave.id, version: cave.version, reviewed: true })).cave;
  return { a, bd, call, save, publish };
}
test('studio and navigation roles require approved teachers or administrators; ordinary role flags cannot grant access', async () => {
  const f = await fixture();
  assert.equal((await f.call('applicant', 'status')).allowed, false);
  assert.equal((await f.call('teacher', 'status')).classes[0].id, 'class-1');
  assert.equal((await f.call('admin', 'status')).allowed, true);
  for (const action of ['list', 'get', 'save', 'copy', 'publish', 'unpublish', 'assign']) await assert.rejects(f.call('applicant', action, { ...body(), id: 'missing', sourceId: 'missing', isAdmin: true }), e => e.status === 403);
});
test('generated or manual questions save as private drafts; no AI approval is needed for direct edits', async () => {
  const f = await fixture(), cave = await f.save();
  assert.equal(cave.visibility, 'private'); assert.equal(cave.status, 'draft'); assert.equal(cave.teacherManaged, true);
  assert.equal(listed(cave, NOW), false); assert.equal(cave.questions.length, 2);
  const modified = structuredClone(cave); modified.questions[0].q = '直接修改的題幹'; modified.questions[0].exp = '教師自行更改的解析';
  modified.questions[0].correct = '3'; modified.questions[0].wrong = ['1', '2', '4']; modified.questions[0].optionOrder = ['1', '2', '3', '4'];
  const changed = await f.save(modified);
  assert.equal(changed.questions[0].q, '直接修改的題幹'); assert.equal(changed.questions[0].correct, '3');
  assert.notEqual(changed.questions[0].id, cave.questions[0].id); assert.equal(changed.questions[1].id, cave.questions[1].id);
  assert.equal((await f.bd.doc('dongtians/' + cave.id).get()).data().questions[0].exp, '教師自行更改的解析');
  await assert.rejects(f.save(modified), e => e.status === 409);
});
test('owner isolation, role revocation, immutable ownership, and administrator recovery apply to every studio operation', async () => {
  const f = await fixture(), cave = await f.save();
  for (const action of ['get', 'save', 'publish', 'unpublish', 'assign']) await assert.rejects(f.call('other', action, { ...cave, reviewed: true, classId: 'class-1' }), e => e.status === 403);
  await assert.rejects(f.call('other', 'copy', { sourceId: cave.id }), e => e.status === 403);
  const saved = await f.save({ ...cave, ownerUid: 'other' }); assert.equal(saved.ownerUid, 'teacher');
  await f.a.doc('classroomTeacherAccounts/teacher').update({ status: 'revoked' });
  await assert.rejects(f.call('teacher', 'get', { id: cave.id }), e => e.status === 403);
  assert.equal((await f.call('admin', 'get', { id: cave.id })).cave.ownerUid, 'teacher');
});
test('publishing requires teacher review, unpublishing closes access, and public discovery respects scope and time', async () => {
  const f = await fixture(), cave = await f.save({ ...body(), visibility: 'public', openAtMs: NOW - 1, closeAtMs: NOW + 10000 });
  await assert.rejects(f.call('teacher', 'publish', { id: cave.id, version: cave.version }), /預覽/);
  const live = await f.publish(cave); assert.equal(listed(live, NOW), true);
  for (const value of ['private', 'unlisted', 'class']) assert.equal(listed({ ...live, visibility: value }, NOW), false);
  assert.equal(listed(live, NOW + 10000), false); assert.equal(listed({ ...live, openAtMs: NOW + 1 }, NOW), false);
  const closed = (await f.call('teacher', 'unpublish', { id: live.id, version: live.version })).cave;
  assert.equal(closed.status, 'draft'); assert.equal(listed(closed, NOW), false);
  assert.equal(listed({ status: 'active' }, NOW), true, 'legacy public caves remain discoverable');
});
test('private, unlisted, class-only and scheduled access is enforced by authenticated entry and reward eligibility', async () => {
  const f = await fixture(); let cave = await f.publish(await f.save());
  await assert.rejects(assertEntry(cave, 'student', f.a, NOW), e => e.status === 403);
  await assertEntry(cave, 'teacher', f.a, NOW);
  await assertEntry({ ...cave, visibility: 'unlisted' }, 'student', f.a, NOW);
  await assertEntry({ ...cave, visibility: 'class', classId: 'class-1' }, 'student', f.a, NOW);
  await assert.rejects(assertEntry({ ...cave, visibility: 'class', classId: 'class-1' }, 'other', f.a, NOW), e => e.status === 403);
  await assert.rejects(assertEntry({ ...cave, visibility: 'public', openAtMs: NOW + 1 }, 'student', f.a, NOW), e => e.status === 409);
  const handler = createEntryHandler({ verifyPlayer: async () => 'student', content: () => f.bd, progress: () => f.a, logger: { warn() {} } });
  const res = { code: 200, set() {}, status(n) { this.code = n; return this; }, json(data) { this.data = data; } };
  await handler({ body: { dongtianId: cave.id, action: 'read' } }, res);
  assert.equal(res.code, 403); assert.equal(res.data.cave, undefined);
  await assert.rejects(Settlement.claimEligibility(f.bd, 'student', cave.id, 'run-private', cave.questions.map(q => ({ id: q.id, selected: q.correct })), f.a), e => e.status === 403);
  cave = await f.save({ ...cave, visibility: 'class', classId: 'class-1' });
  await f.a.doc('classrooms/class-1').update({ members: [] });
  await assert.rejects(assertEntry(cave, 'student', f.a, NOW), e => e.status === 403);
});
test('teachers cannot target unassigned classes or retain class publication authority after reassignment', async () => {
  const f = await fixture();
  await assert.rejects(f.save({ ...body(), visibility: 'class', classId: 'missing' }), e => e.status === 403);
  const cave = await f.save({ ...body(), visibility: 'class', classId: 'class-1' });
  await f.a.doc('classrooms/class-1').update({ ownerUid: 'other' });
  await assert.rejects(f.publish(cave), e => e.status === 403);
});
test('copies are private drafts; class assignments preserve fixed snapshots after later cave edits', async () => {
  const f = await fixture(), cave = await f.publish(await f.save({ ...body(), visibility: 'public' }));
  const copied = (await f.call('teacher', 'copy', { sourceId: cave.id })).cave;
  assert.notEqual(copied.id, cave.id); assert.equal(copied.status, 'draft'); assert.equal(copied.visibility, 'private');
  const assigned = (await f.call('teacher', 'assign', { id: cave.id, version: cave.version, classId: 'class-1' })).assignment;
  const changed = structuredClone(cave); changed.questions[0].q = '後來的新題幹'; await f.save(changed);
  const fixed = (await f.a.doc('classroomAssignments/' + assigned.id).get()).data();
  assert.equal(fixed.status, 'draft'); assert.equal(fixed.questions[0].question, '1+1=?');
});
test('direct saves and publication preserve visit and completion counts and reject invalid settings', async () => {
  const f = await fixture(), cave = await f.save();
  await f.bd.doc('dongtianIndex/' + cave.id).update({ playCount: 9, completionCount: 5 });
  const live = await f.publish(cave); assert.equal(live.playCount, 9); assert.equal(live.completionCount, 5);
  const changed = await f.save({ ...live, description: '教學介紹' }); assert.equal(changed.playCount, 9);
  for (const values of [{ visibility: 'fake' }, { openAtMs: NOW, closeAtMs: NOW - 1 }, { settings: { passPercent: 101 } }, { settings: { shuffleQuestions: 'false' } }, { settings: { feedback: 'never' } }, { questions: [] }, { questions: Array(31).fill(body().questions[0]) }]) await assert.rejects(f.save({ ...body(), ...values }));
  await assert.rejects(f.save({ ...body(), questions: [{ ...body().questions[0], optionOrder: ['2', '2', '3', '4'] }] }));
});
test('question shuffling is graded by unique stable IDs, while pass standards use server-verified answers', async () => {
  const f = await fixture(), cave = await f.save({ ...body(), settings: { shuffleQuestions: true, passPercent: 75, feedback: 'completion', shuffleOptions: false } });
  const answers = cave.questions.map(q => ({ id: q.id, selected: q.correct }));
  const correct = Settlement.verifyAnswers(cave, [...answers].reverse()); assert.equal(correct.correct, 2); assert.equal(correct.passed, true);
  const mixed = [{ ...answers[1], selected: '1' }, answers[0]];
  const result = Settlement.verifyAnswers(cave, mixed); assert.equal(result.correct, 1); assert.equal(result.passed, false); assert.equal(result.passPercent, 75);
  for (const invalid of [[answers[0], answers[0]], [...answers, { id: 'unknown', selected: 'a' }], [answers[0]]]) assert.throws(() => Settlement.verifyAnswers(cave, invalid), e => e.status === 409);
});
test('generic D1 reads and writes cannot bypass teacher-managed privacy or strip protected markers', async () => {
  const f = await fixture(), cave = await f.save();
  const { mayRead, authorizeWrite } = require('../d1-browser-api.cjs');
  for (const uid of ['student', 'teacher']) assert.equal(mayRead({ role: 'BD', path: 'dongtians/' + cave.id, data: { ...cave, status: 'active' }, uid, admin: false }), false);
  assert.equal(mayRead({ role: 'BD', path: 'dongtianIndex/' + cave.id, data: { ...cave, status: 'active' }, uid: 'student', admin: false }), false);
  for (const after of [{ ...cave, visibility: 'public' }, { ...cave, teacherManaged: false }, null]) assert.throws(() => authorizeWrite({ role: 'BD', path: 'dongtians/' + cave.id, before: cave, after, operation: { type: 'update' }, context: { uid: 'teacher', admin: false }, preview: new Map() }), e => e.status === 403);
  assert.throws(() => authorizeWrite({ role: 'BD', path: 'dongtians/' + cave.id, before: { ...cave, status: 'active' }, after: { ...cave, status: 'suspended', activeReportId: 'fake' }, operation: { type: 'update' }, context: { uid: 'student', admin: false }, preview: new Map([['dongtianReports/fake', { reporterUid: 'student', dongtianId: cave.id, status: 'confirmed' }]]) }), e => e.status === 403);
});
test('studio HTTP authentication verifies main-project tokens and never accepts a forged actor', async () => {
  const f = await fixture(); let handler;
  register({ post: (path, callback) => { if (path === '/api/teacher/dongtian') handler = callback; } }, {
    resolveA: () => ({ db: f.a, auth: { verifyIdToken: async token => ({ uid: token === 'teacher' ? 'teacher' : 'student', aud: token === 'wrong' ? 'wrong' : 'question-learning', iss: 'https://securetoken.google.com/question-learning' }) } }), resolveBD: () => ({ db: f.bd })
  });
  const request = async token => { const res = { code: 200, set() {}, status(n) { this.code = n; return this; }, json(data) { this.data = data; } }; await handler({ get: () => token, body: { action: 'save', ...body(), uid: 'teacher', isAdmin: true } }, res); return res; };
  assert.equal((await request('')).code, 401); assert.equal((await request('Bearer wrong')).code, 401); assert.equal((await request('Bearer student')).code, 403); assert.equal((await request('Bearer teacher')).data.cave.visibility, 'private');
});
test('teacher question reports authenticate scope, deduplicate, and can only be resolved by the authorized teacher', async () => {
  const f = await fixture(), cave = await f.publish(await f.save({ ...body(), visibility: 'class', classId: 'class-1' }));
  const handlers = new Map();
  register({ post: (path, callback) => handlers.set(path, callback) }, {
    resolveA: () => ({ db: f.a, auth: { verifyIdToken: async uid => ({ uid, aud: 'question-learning', iss: 'https://securetoken.google.com/question-learning' }) } }), resolveBD: () => ({ db: f.bd })
  });
  const send = async (uid, extra = {}) => { const res = { code: 200, set() {}, status(n) { this.code = n; return this; }, json(data) { this.data = data; } }; await handlers.get('/api/dongtian/teacher-report')({ get: () => 'Bearer ' + uid, body: { id: cave.id, questionId: cave.questions[0].id, reason: '條件可能不足，請老師確認', ...extra } }, res); return res; };
  assert.equal((await send('other')).code, 403);
  assert.equal((await send('student', { questionId: 'missing' })).code, 409);
  const first = await send('student'); assert.equal(first.data.ok, true); assert.equal((await send('student')).data.duplicate, true);
  const rows = await f.call('teacher', 'reports', { id: cave.id }); assert.equal(rows.reports.length, 1); assert.equal(rows.reports[0].reporterUid, 'student');
  await assert.rejects(f.call('other', 'resolveReport', { id: cave.id, reportId: first.data.reportId }), e => e.status === 403);
  await f.call('teacher', 'resolveReport', { id: cave.id, reportId: first.data.reportId, resolution: '已直接修改條件' });
  assert.equal((await f.call('teacher', 'reports', { id: cave.id })).reports[0].status, 'teacher-resolved');
  const { mayRead, authorizeWrite } = require('../d1-browser-api.cjs'), report = rows.reports[0];
  assert.equal(mayRead({ role: 'BD', path: 'dongtianReports/' + first.data.reportId, data: report, uid: 'teacher', admin: false }), false);
  assert.throws(() => authorizeWrite({ role: 'BD', path: 'dongtianReports/' + first.data.reportId, before: report, after: { ...report, teacherManaged: false }, operation: { type: 'update' }, context: { uid: 'student', admin: false }, preview: new Map() }), e => e.status === 403);
});
test('server completion retains pass decisions and rejects pre-edit answers for newly changed questions', async () => {
  const f = await fixture(), cave = await f.publish(await f.save({ ...body(), visibility: 'public', settings: { passPercent: 75 } }));
  const answers = cave.questions.map((q, i) => ({ id: q.id, selected: i ? q.wrong[0] : q.correct }));
  const eligibility = await Settlement.claimEligibility(f.bd, 'student', cave.id, 'run-graded', answers, f.a);
  const result = await Settlement.awardProgress(f.a, 'student', eligibility);
  assert.equal(result.passed, false); assert.equal(result.passPercent, 75);
  assert.equal((await f.a.doc('dongtianPlays/student__' + cave.id).get()).data().passed, false);
  const edited = structuredClone(cave); edited.questions[0].q = '教師已更新此題'; await f.save(edited);
  await assert.rejects(Settlement.claimEligibility(f.bd, 'student', cave.id, 'run-stale', answers, f.a), e => e.status === 409);
});

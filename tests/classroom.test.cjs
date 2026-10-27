'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers/d1-db.cjs');
const register = require('../classroom-api.cjs');
const { perform } = register;
const CLOCK = 1900000000000;
const questions = () => [
  { question: '1 + 1 = ?', options: ['1', '2', '3', '4'], answerIndex: 1, explanation: '一加一等於二。', knowledge_points: [{ subject: '數學', id: 'math-1', name: '數與運算' }] },
  { question: '2 + 2 = ?', options: ['1', '2', '3', '4'], answerIndex: 3, explanation: '二加二等於四。' }
];
async function fixture() {
  const { db } = setup(); let counter = 0, code = 0;
  const options = { now: () => CLOCK, makeId: () => 'id-' + ++counter, makeCode: () => ['ABCDEFGH', 'BCDEFGHJ', 'CDEFGHJK'][code++] };
  const call = (uid, action, body = {}, overrides = {}) => perform(db, uid, { action, ...body }, { ...options, ...overrides });
  await db.doc('users/teacher').set({isAdmin:true,displayName:'陳老師'});
  const created = await call('teacher', 'createClass', { name: '七年一班', teacherName: '陳老師' });
  const classId = created.classroom.id;
  const act = (uid, action, body = {}, overrides = {}) => call(uid, action, { classId, ...body }, overrides);
  const join = (uid = 'student', name = '王同學') => call(uid, 'joinClass', { joinCode: created.classroom.joinCode, name, seat: '2' });
  const draft = async () => (await act('teacher', 'saveAssignment', { title: '加法練習', subject: '數學', questions: questions(), dueAtMs: CLOCK + 60000 })).assignment;
  const publish = async () => {
    const a = await draft();
    return (await act('teacher', 'publishAssignment', { assignmentId: a.id, version: a.version, reviewed: true })).assignment;
  };
  return { db, call, act, join, draft, publish, classId, options };
}
const progress = (f, a, answers = [1, null], version = 0, uid = 'student') => f.act(uid, 'saveProgress', { assignmentId: a.id, answers, version });
const submit = (f, a, answers = [1, 0], version = 0, uid = 'student', overrides) => f.act(uid, 'submit', { assignmentId: a.id, answers, version, score: 100, correctCount: 2, uid: 'teacher' }, overrides);

test('administrators create classes and zero-cultivation students join without game progression requirements', async () => {
  const f = await fixture(); await f.join();
  const teacher = await f.act('teacher', 'classDetail'), student = await f.act('student', 'classDetail');
  assert.equal(teacher.classroom.role, 'teacher'); assert.equal(teacher.classroom.members[0].name, '王同學');
  assert.equal(student.classroom.role, 'student'); assert.equal(student.classroom.student.uid, 'student');
  assert.equal(student.classroom.members, undefined); assert.equal(student.classroom.joinCode, undefined);
  assert.equal((await f.call('student', 'list')).classes.length, 1);
  await f.join(); assert.equal((await f.act('teacher', 'classDetail')).classroom.members.length, 1);
});
test('membership, teacher rights, and assignments cannot be forged with request fields', async () => {
  const f = await fixture(); await f.join(); const a = await f.draft();
  for (const action of ['renameClass', 'rotateCode', 'archiveClass', 'removeStudent', 'saveAssignment', 'deleteDraft', 'publishAssignment', 'closeAssignment', 'report', 'exportReport']) {
    await assert.rejects(f.act('student', action, { assignmentId: a.id, ownerUid: 'student', teacherUid: 'student', name: 'fake', title: 'fake', subject: '數學', questions: questions(), reviewed: true, version: a.version }), e => e.status === 403);
  }
  await assert.rejects(f.act('outsider', 'classDetail'), e => e.status === 403);
  await assert.rejects(f.act('outsider', 'getAssignment', { assignmentId: a.id }), e => e.status === 403);
  assert.equal((await f.call('outsider', 'list')).classes.length, 0);
});
test('drafts, answer keys, explanations, classmates, and other student grades are private', async () => {
  const f = await fixture(); await f.join(); const draft = await f.draft();
  assert.deepEqual((await f.act('student', 'classDetail')).assignments, []);
  await assert.rejects(f.act('student', 'getAssignment', { assignmentId: draft.id }), e => e.status === 404);
  await f.act('teacher', 'publishAssignment', { assignmentId: draft.id, version: draft.version, reviewed: true });
  await f.join('other', '另一位'); await submit(f, draft);
  const other = await f.act('other', 'getAssignment', { assignmentId: draft.id, studentUid: 'student' });
  assert.equal(other.submission, null);
  assert.ok(other.assignment.questions.every(q => !Object.hasOwn(q, 'answerIndex') && !Object.hasOwn(q, 'explanation')));
  assert.doesNotMatch(JSON.stringify(await f.act('other', 'classDetail')), /王同學|correctCount/);
});
test('draft edits use revisions, require review, freeze after publishing, and support deletion only before publication', async () => {
  const f = await fixture(); const a = await f.draft();
  await assert.rejects(f.act('teacher', 'publishAssignment', { assignmentId: a.id, version: a.version }), /預覽/);
  const b = (await f.act('teacher', 'saveAssignment', { ...a, assignmentId: a.id, title: '新版' })).assignment;
  await assert.rejects(f.act('teacher', 'saveAssignment', { ...a, assignmentId: a.id }), e => e.status === 409);
  await assert.rejects(f.act('teacher', 'publishAssignment', { assignmentId: a.id, version: a.version, reviewed: true }), e => e.status === 409);
  await f.act('teacher', 'publishAssignment', { assignmentId: b.id, version: b.version, reviewed: true });
  await assert.rejects(f.act('teacher', 'saveAssignment', { ...b, assignmentId: b.id }), e => e.status === 409);
  await assert.rejects(f.act('teacher', 'deleteDraft', { assignmentId: b.id }), e => e.status === 409);
  const disposable = await f.draft(); await f.act('teacher', 'deleteDraft', { assignmentId: disposable.id });
  assert.equal((await f.act('teacher', 'classDetail')).assignments.length, 1);
});
test('progress survives reload, remains ungraded, and rejects conflicting tabs and malformed answers', async () => {
  const f = await fixture(); await f.join(); const a = await f.publish();
  const p = await progress(f, a);
  assert.equal(p.submission.version, 1); assert.equal(p.submission.score, undefined);
  const loaded = await f.act('student', 'getAssignment', { assignmentId: a.id });
  assert.deepEqual(loaded.submission.answers, [1, null]);
  assert.equal(loaded.assignment.questions[0].answerIndex, undefined);
  await assert.rejects(progress(f, a, [0, null]), e => e.status === 409);
  for (const answers of [[1], [1, 4], [1, '3'], [1, -1]]) await assert.rejects(progress(f, a, answers, 1));
  await assert.rejects(submit(f, a, [1, null], 1), /完成/);
});
test('first score is server-graded, atomic, and unchanged by retries, client scores, or corrections', async () => {
  const f = await fixture(); await f.join(); const a = await f.publish();
  const [first, retry] = await Promise.all([submit(f, a), submit(f, a)]);
  assert.equal(first.submission.score, 50); assert.equal(retry.submission.score, 50);
  assert.deepEqual((await submit(f, a, [1, 3])).submission.answers, [1, 0]);
  assert.equal(first.questions[1].answerIndex, 3);
  const bad = await f.act('student', 'correct', { assignmentId: a.id, questionId: 'q2', selectedIndex: 2 });
  assert.equal(bad.correct, false);
  const good = await f.act('student', 'correct', { assignmentId: a.id, questionId: 'q2', selectedIndex: 3 });
  assert.equal(good.correct, true); assert.equal(good.submission.score, 50);
  const repeated = await f.act('student', 'correct', { assignmentId: a.id, questionId: 'q2', selectedIndex: 0 });
  assert.equal(repeated.submission.version, good.submission.version);
  const report = (await f.act('teacher', 'report', { assignmentId: a.id })).report;
  assert.equal(report.totals.average, 50); assert.equal(report.students[0].correctedCount, 1);
  assert.equal(report.students[0].wrongCount, 1);
  assert.deepEqual(report.knowledgePoints[0], { subject: '數學', id: 'math-1', name: '數與運算', correct: 1, total: 1 });
});
test('deadlines are authoritative; existing receipts and post-deadline corrections remain available', async () => {
  const f = await fixture(); await f.join(); await f.join('late', '遲交同學'); const a = await f.publish();
  await submit(f, a);
  const lateClock = { now: () => CLOCK + 60001 };
  await assert.rejects(f.act('late', 'submit', { assignmentId: a.id, answers: [1, 3], version: 0 }, lateClock), e => e.status === 409);
  assert.equal((await submit(f, a, [0, 3], 0, 'student', lateClock)).submission.score, 50);
  assert.equal((await f.act('student', 'correct', { assignmentId: a.id, questionId: 'q2', selectedIndex: 3 }, lateClock)).correct, true);
});
test('closing or archiving blocks new submissions and joining while preserving review and reports', async () => {
  const f = await fixture(); await f.join(); const a = await f.publish();
  await f.act('teacher', 'closeAssignment', { assignmentId: a.id, version: a.version });
  await assert.rejects(submit(f, a), e => e.status === 409);
  assert.equal((await f.act('student', 'getAssignment', { assignmentId: a.id })).assignment.status, 'closed');
  await f.act('teacher', 'archiveClass', { archived: true });
  await assert.rejects(f.join('other'), e => e.status === 409);
  await assert.rejects(f.draft(), e => e.status === 409);
  await f.act('teacher', 'archiveClass', { archived: false }); await f.join('other');
});
test('removal revokes access and updates both indexes while keeping published-assignment history', async () => {
  const f = await fixture(); await f.join(); const a = await f.publish(); await submit(f, a);
  await f.act('teacher', 'removeStudent', { studentUid: 'student' });
  assert.deepEqual((await f.call('student', 'list')).classes, []);
  await assert.rejects(f.act('student', 'getAssignment', { assignmentId: a.id }), e => e.status === 403);
  await assert.rejects(submit(f, a), e => e.status === 403);
  const report = (await f.act('teacher', 'report', { assignmentId: a.id })).report;
  assert.equal(report.students[0].active, false); assert.equal(report.students[0].score, 50);
  await f.join(); await f.act('student', 'leaveClass');
  assert.equal((await f.act('teacher', 'classDetail')).classroom.studentCount, 0);
  await assert.rejects(f.act('teacher', 'leaveClass'), /教師不能/);
});
test('rotating a code revokes the old code, keeps current members, and lets new students join', async () => {
  const f = await fixture(); await f.join();
  const result = await f.act('teacher', 'rotateCode');
  assert.equal(result.classroom.joinCode, 'BCDEFGHJ');
  await assert.rejects(f.join('other'), e => e.status === 404);
  await f.call('other', 'joinClass', { joinCode: 'bcdefghj', name: '新同學' });
  assert.equal((await f.act('teacher', 'classDetail')).classroom.studentCount, 2);
});
test('work by students who join after publication remains in reports after they leave', async () => {
  const f = await fixture(); const a = await f.publish(); await f.join();
  await progress(f, a); await submit(f, a, [1, 0], 1); await f.act('student', 'leaveClass');
  const report = (await f.act('teacher', 'report', { assignmentId: a.id })).report;
  assert.equal(report.totals.submitted, 1); assert.equal(report.students[0].score, 50);
  assert.equal(report.students[0].active, false);
});
test('assignments cannot be read, modified, submitted, or reported through another class', async () => {
  const f = await fixture(); await f.join(); const a = await f.publish();
  const second = (await f.call('teacher', 'createClass', { name: '另一班', teacherName: '老師' })).classroom;
  for (const action of ['getAssignment', 'report', 'closeAssignment', 'saveAssignment', 'deleteDraft']) await assert.rejects(f.call('teacher', action, { classId: second.id, assignmentId: a.id, ...(['saveAssignment'].includes(action) ? { title: 'fake', subject: '數學', questions: questions() } : {}) }));
});
test('empty reports show missing averages, and CSV protects formula-like names and preserves zero scores', async () => {
  const f = await fixture(); await f.join('student', '=HYPERLINK("evil")'); const a = await f.publish();
  const empty = (await f.act('teacher', 'report', { assignmentId: a.id })).report;
  assert.equal(empty.totals.average, null); assert.equal(empty.students[0].score, null);
  await submit(f, a, [0, 0]);
  const csv = (await f.act('teacher', 'exportReport', { assignmentId: a.id })).csv;
  assert.ok(csv.startsWith('\uFEFF')); assert.match(csv, /'=HYPERLINK/); assert.match(csv, /"0"/);
  const report = (await f.act('teacher', 'report', { assignmentId: a.id })).report;
  assert.equal(report.totals.average, 0);
});
test('question, size, scope, and deadline validation reject malformed or excessive drafts', async () => {
  const f = await fixture();
  const invalid = [[], Array(31).fill(questions()[0]), [{ ...questions()[0], answerIndex: '1' }], [{ ...questions()[0], options: ['a', 'a', 'b', 'c'] }], [{ ...questions()[0], knowledge_points: [{ subject: '數學', id: 'fake', name: 'fake' }] }]];
  for (const q of invalid) await assert.rejects(f.act('teacher', 'saveAssignment', { title: '測試', subject: '數學', questions: q }));
  await assert.rejects(f.act('teacher', 'saveAssignment', { title: '測試', subject: '數學', questions: questions(), dueAtMs: CLOCK - 1 }));
  await assert.rejects(f.call('teacher', 'createClass', { name: 'x'.repeat(61), teacherName: '老師' }));
  await assert.rejects(f.call('student', 'joinClass', { joinCode: '../xx', name: 'x' }));
  for (const badId of ['../x', '', 'a/b']) await assert.rejects(f.call('teacher', 'classDetail', { classId: badId }));
});
test('API verifies main-project tokens, ignores spoofed actors, and uses no-store responses', async () => {
  const f = await fixture(); let handler;
  register({ post: (path, cb) => { assert.equal(path, '/api/classrooms'); handler = cb; } }, {
    resolveA: () => ({ db: f.db, auth: { verifyIdToken: async token => ({ uid: 'student', aud: token === 'bad' ? 'wrong' : 'question-learning', iss: 'https://securetoken.google.com/question-learning' }) } })
  });
  const response = () => ({ code: 200, headers: {}, set(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; } });
  for (const token of ['', 'Bearer bad']) { const res = response(); await handler({ get: () => token, body: { action: 'list' } }, res); assert.equal(res.code, 401); }
  const res = response(); await handler({ get: () => 'Bearer good', body: { action: 'renameClass', uid: 'teacher', classId: f.classId, name: 'forged' } }, res);
  assert.equal(res.code, 403); assert.equal(res.headers['Cache-Control'], 'no-store');
  const invalid = response(); await handler({ get: () => 'Bearer good', body: { action: 'sql' } }, invalid); assert.equal(invalid.code, 400);
});
test('generic browser data endpoints cannot read or forge classroom records', () => {
  const { mayRead, authorizeWrite } = require('../d1-browser-api.cjs');
  for (const collection of ['classroomTeacherAccounts', 'classroomProfiles', 'classrooms', 'classroomCodes', 'classroomAssignments', 'classroomSubmissions']) {
    assert.equal(mayRead({ role: 'A', path: collection + '/student', uid: 'student', data: { uid: 'student', ownerUid: 'student' }, admin: false }), false);
    assert.throws(() => authorizeWrite({ role: 'A', path: collection + '/student', before: null, after: { uid: 'student' }, operation: { type: 'set' }, context: { uid: 'student', admin: false }, preview: new Map() }), e => e.status === 403);
  }
});
const application = { name: '林老師', school: '青雲中學', reason: '數學課派題與成績管理' };
async function approve(f, uid = 'applicant') {
  await f.db.doc('users/' + uid).set({ uid, isAdmin: false, isTeacher: true, displayName: application.name });
  const account = (await f.call(uid, 'applyTeacher', application)).account;
  return (await f.call('teacher', 'reviewTeacher', { teacherUid: uid, decision: 'approve', version: account.version })).account;
}
test('only administrators create classes; applications never self-grant teacher or administrator access', async () => {
  const f = await fixture();
  const create = () => f.call('applicant', 'createClass', { name: '禁止建班', teacherName: '偽教師', isAdmin: true, role: 'admin', uid: 'teacher' });
  await assert.rejects(create(), e => e.status === 403);
  const pending = (await f.call('applicant', 'applyTeacher', { ...application, status: 'approved', reviewedByUid: 'teacher' })).account;
  assert.equal(pending.status, 'pending');
  await assert.rejects(create(), e => e.status === 403);
  assert.equal((await f.call('applicant', 'list')).access.isTeacher, false);
  await assert.rejects(f.call('applicant', 'teacherAccounts'), e => e.status === 403);
  await assert.rejects(f.call('applicant', 'reviewTeacher', { teacherUid: 'applicant', version: pending.version, decision: 'approve' }), e => e.status === 403);
  await approve(f); assert.equal((await f.call('applicant', 'list')).access.isTeacher, true);
  await assert.rejects(create(), e => e.status === 403);
});
test('application review has explicit approval, rejection, resubmission, revocation and revision protection', async () => {
  const f = await fixture();
  const pending = (await f.call('applicant', 'applyTeacher', application)).account;
  const duplicate = (await f.call('applicant', 'applyTeacher', { ...application, name: '另一名字' })).account;
  assert.deepEqual(duplicate, pending);
  const rejected = (await f.call('teacher', 'reviewTeacher', { teacherUid: 'applicant', version: pending.version, decision: 'reject', reviewNote: '請補充任教資料' })).account;
  assert.equal(rejected.status, 'rejected');
  assert.equal((await f.call('applicant', 'list')).access.account.reviewNote, '請補充任教資料');
  const renewed = (await f.call('applicant', 'applyTeacher', { ...application, reason: '已補充' })).account;
  await assert.rejects(f.call('teacher', 'reviewTeacher', { teacherUid: 'applicant', version: pending.version, decision: 'approve' }), e => e.status === 409);
  const approved = (await f.call('teacher', 'reviewTeacher', { teacherUid: 'applicant', version: renewed.version, decision: 'approve' })).account;
  assert.equal(approved.status, 'approved');
  const revoked = (await f.call('teacher', 'reviewTeacher', { teacherUid: 'applicant', version: approved.version, decision: 'revoke' })).account;
  assert.equal(revoked.status, 'revoked');
  await assert.rejects(f.call('teacher', 'reviewTeacher', { teacherUid: 'applicant', version: renewed.version, decision: 'approve' }), e => e.status === 409);
  assert.equal((await f.call('applicant', 'list')).access.isTeacher, false);
});
test('administrators assign approved teachers, revoke access immediately, and preserve student work', async () => {
  const f = await fixture(); await f.join(); const a = await f.publish(); const account = await approve(f);
  await assert.rejects(f.act('applicant', 'classDetail'), e => e.status === 403);
  await assert.rejects(f.act('student', 'assignTeacher', { teacherUid: 'student', expectedOwnerUid: 'teacher' }), e => e.status === 403);
  await assert.rejects(f.act('teacher', 'assignTeacher', { teacherUid: 'student', expectedOwnerUid: 'teacher' }), e => e.status === 403);
  await f.act('teacher', 'assignTeacher', { teacherUid: 'applicant', expectedOwnerUid: 'teacher' });
  assert.equal((await f.act('applicant', 'classDetail')).classroom.role, 'teacher');
  assert.equal((await f.call('applicant', 'list')).classes.length, 1);
  await f.act('applicant', 'saveAssignment', { title: '教師草稿', subject: '數學', questions: questions() });
  await submit(f, a);
  assert.equal((await f.act('applicant', 'report', { assignmentId: a.id })).report.totals.submitted, 1);
  await f.call('teacher', 'reviewTeacher', { teacherUid: 'applicant', decision: 'revoke', version: account.version });
  for (const action of ['classDetail', 'report', 'exportReport', 'getAssignment', 'saveAssignment']) await assert.rejects(f.act('applicant', action, { assignmentId: a.id, title: 'fake', subject: '數學', questions: questions() }), e => e.status === 403);
  assert.equal((await f.call('applicant', 'list')).classes.length, 0);
  assert.equal((await f.act('student', 'getAssignment', { assignmentId: a.id })).submission.score, 50);
  await f.act('teacher', 'assignTeacher', { teacherUid: 'teacher', expectedOwnerUid: 'applicant' });
  assert.deepEqual((await f.db.doc('classroomProfiles/applicant').get()).data().classIds, []);
});
test('legacy class ownership and editable isTeacher flags do not substitute for administrator approval', async () => {
  const f = await fixture(); await f.db.doc('users/teacher').set({ isAdmin: false, isTeacher: true, role: 'teacher' });
  assert.equal((await f.call('teacher', 'list')).classes.length, 0);
  await assert.rejects(f.act('teacher', 'classDetail'), e => e.status === 403);
  await assert.rejects(f.join('teacher'), e => e.status === 403);
  await assert.rejects(f.call('teacher', 'createClass', { name: '偽班級', teacherName: '偽教師' }), e => e.status === 403);
});
test('teacher-account and global-class lists paginate only for administrators', async () => {
  const f = await fixture();
  for (let i = 0; i < 53; i++) await f.db.doc('classroomTeacherAccounts/t' + String(i).padStart(2, '0')).set({ ...application, uid: 't' + i, status: 'pending', version: 1, requestedAtMs: CLOCK });
  const first = await f.call('teacher', 'teacherAccounts');
  const second = await f.call('teacher', 'teacherAccounts', { cursor: first.nextCursor });
  assert.equal(first.accounts.length, 50); assert.equal(second.accounts.length, 3); assert.equal(second.nextCursor, null);
  assert.equal((await f.call('teacher', 'teacherAccounts', { status: 'approved' })).accounts.length, 0);
  await assert.rejects(f.call('student', 'teacherAccounts', { cursor: first.nextCursor }), e => e.status === 403);
});
test('administrator removal between initial authorization and a write is checked inside the transaction', async () => {
  const f = await fixture(), original = f.db.runTransaction.bind(f.db); let change = true;
  f.db.runTransaction = async worker => {
    if (change) { change = false; await original(async tx => { const target = f.db.doc('users/teacher'); await tx.get(target); tx.update(target, { isAdmin: false }); }); }
    return original(worker);
  };
  await assert.rejects(f.call('teacher', 'createClass', { name: '撤權後禁止', teacherName: '教師' }), e => e.status === 403);
});
test('teacher revocation racing with a draft save is checked in the same transaction', async () => {
  const f = await fixture(); await approve(f);
  await f.act('teacher', 'assignTeacher', { teacherUid: 'applicant', expectedOwnerUid: 'teacher' });
  const original = f.db.runTransaction.bind(f.db); let change = true;
  f.db.runTransaction = async worker => {
    if (change) { change = false; await original(async tx => { const target = f.db.doc('classroomTeacherAccounts/applicant'); await tx.get(target); tx.update(target, { status: 'revoked' }); }); }
    return original(worker);
  };
  await assert.rejects(f.act('applicant', 'saveAssignment', { title: '撤權後禁止', subject: '數學', questions: questions() }), e => e.status === 403);
  assert.equal((await f.act('teacher', 'classDetail')).assignments.length, 0);
});

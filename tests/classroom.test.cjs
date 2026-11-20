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
test('only approved teachers and administrators create classes; fake flags and pending applications cannot self-grant', async () => {
  const f = await fixture();
  const create = () => f.call('applicant', 'createClass', { name: '禁止建班', teacherName: '偽教師', isAdmin: true, role: 'admin', uid: 'teacher' });
  await assert.rejects(create(), e => e.status === 403);
  const pending = (await f.call('applicant', 'applyTeacher', { ...application, status: 'approved', reviewedByUid: 'teacher' })).account;
  assert.equal(pending.status, 'pending');
  await assert.rejects(create(), e => e.status === 403);
  assert.equal((await f.call('applicant', 'list')).access.isTeacher, false);
  await assert.rejects(f.call('applicant', 'teacherAccounts'), e => e.status === 403);
  await assert.rejects(f.call('applicant', 'reviewTeacher', { teacherUid: 'applicant', version: pending.version, decision: 'approve' }), e => e.status === 403);
  const approved = await approve(f);
  assert.equal((await f.call('applicant', 'list')).access.isTeacher, true);
  const created = await create();
  const owned = (await f.db.doc('classrooms/' + created.classroom.id).get()).data();
  assert.equal(owned.ownerUid, 'applicant');
  assert.equal(owned.teacherName, '林老師');
  assert.notEqual(owned.teacherName, '偽教師');
  await f.call('teacher', 'reviewTeacher', { teacherUid:'applicant', decision:'revoke',version:approved.version });
  await assert.rejects(create(), error => error.status === 403);
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

test('class notices are teacher-only writes, safely bounded and visible only to members', async () => {
  const f = await fixture(); await f.join();
  await assert.rejects(f.act('student', 'postNotice', { content: '冒充教師' }), e => e.status === 403);
  await assert.rejects(f.act('student', 'deleteNotice', { noticeId: 'anything' }), e => e.status === 403);
  const post = await f.act('teacher', 'postNotice', { content: '<script>提醒</script>' });
  assert.equal(post.notices.length, 1);
  assert.equal((await f.act('student', 'classDetail')).classroom.notices[0].content, '<script>提醒</script>');
  assert.ok(!(await f.call('outsider', 'list')).classes.length);
  await assert.rejects(f.act('outsider', 'classDetail'), e => e.status === 403);
  await assert.rejects(f.act('teacher', 'postNotice', { content: 'x'.repeat(1001) }));
  await f.act('teacher', 'archiveClass', { archived: true });
  await assert.rejects(f.act('teacher', 'postNotice', { content: '封存公告' }), e => e.status === 409);
  await f.act('teacher', 'deleteNotice', { noticeId: post.notices[0].id });
  assert.deepEqual((await f.act('student', 'classDetail')).classroom.notices, []);
});
test('teachers can extend deadlines and reopen closed assignments without rewriting first scores', async () => {
  const f = await fixture(); await f.join(); await f.join('late', '遲交生');
  const a = await f.publish(); const original = await submit(f, a);
  const later = { now: () => CLOCK + 60001 };
  await assert.rejects(submit(f, a, [1, 3], 0, 'late', later), e => e.status === 409);
  await assert.rejects(f.act('student', 'updateDeadline', { assignmentId: a.id, version: a.version, dueAtMs: CLOCK + 200000 }, later), e => e.status === 403);
  await assert.rejects(f.act('teacher', 'updateDeadline', { assignmentId: a.id, version: a.version, dueAtMs: CLOCK - 1 }, later));
  const updated = (await f.act('teacher', 'updateDeadline', { assignmentId: a.id, version: a.version, dueAtMs: CLOCK + 300000 }, later)).assignment;
  await assert.rejects(f.act('teacher', 'closeAssignment', { assignmentId: a.id, version: a.version }, later), e => e.status === 409);
  const closed = (await f.act('teacher', 'closeAssignment', { assignmentId: a.id, version: updated.version }, later)).assignment;
  await assert.rejects(submit(f, a, [1, 3], 0, 'late', later), e => e.status === 409);
  const reopened = (await f.act('teacher', 'reopenAssignment', { assignmentId: a.id, version: closed.version }, later)).assignment;
  assert.equal(reopened.status, 'published');
  assert.equal((await submit(f, a, [1, 3], 0, 'late', later)).submission.score, 100);
  assert.equal((await submit(f, a, [1, 3], 0, 'student', later)).submission.score, original.submission.score);
  await assert.rejects(f.act('teacher', 'reopenAssignment', { assignmentId: a.id, version: reopened.version }, later), e => e.status === 409);
});
test('teacher overview shows recent live-class progress without student access or counting missing grades as zero', async () => {
  const f = await fixture(); await f.join(); await f.join('other', '另一位');
  const a = await f.publish(); await submit(f, a, [1, 0]);
  await progress(f, a, [null, 0], 0, 'other');
  await f.draft();
  const overview = (await f.act('teacher', 'overview')).overview;
  assert.equal(overview.assignmentCount, 1);
  assert.equal(overview.studentCount, 2);
  assert.equal(overview.assignments[0].submitted, 1);
  assert.equal(overview.assignments[0].inProgress, 1);
  assert.equal(overview.assignments[0].average, 50);
  assert.equal(overview.students.find(s => s.uid === 'other').average, null);
  await assert.rejects(f.act('student', 'overview'), e => e.status === 403);
  await assert.rejects(f.act('outsider', 'overview'), e => e.status === 403);
});


test('teacher workspace summaries are scoped, bounded and contain no student submissions or answers', async () => {
  const f = await fixture();
  await f.join('student', '王同學');
  const draft = await f.draft();
  const dashboard = (await f.call('teacher', 'teacherDashboard')).dashboard;
  assert.equal(dashboard.classes.length, 1);
  assert.equal(dashboard.classes[0].studentCount, 1);
  assert.equal(dashboard.classes[0].assignments.length, 1);
  assert.equal(dashboard.classes[0].assignments[0].id, draft.id);
  assert.equal(dashboard.classes[0].assignments[0].status, 'draft');
  assert.equal(dashboard.classes[0].assignments[0].questions, undefined);
  assert.doesNotMatch(JSON.stringify(dashboard), /王同學|answerIndex|explanation|joinCode/);
  await assert.rejects(f.call('student', 'teacherDashboard'), error => error.status === 403);
  await assert.rejects(f.call('outsider', 'teacherDashboard'), error => error.status === 403);
});
test('teacher can load a single assignment submission overview on demand, student cannot', async () => {
  const f = await fixture();
  await f.join('student', '王同學');
  await f.join('late', '林同學');
  const published = await f.publish();
  await submit(f, published);
  const result = (await f.act('teacher', 'teacherAssignmentProgress', { assignmentId:published.id })).progress;
  assert.deepEqual([result.studentCount,result.submitted,result.inProgress,result.notStarted,result.pendingCount],[2,1,0,1,1]);
  assert.deepEqual(result.pendingStudents.map(s => s.name), ['林同學']);
  assert.equal(result.pendingStudents[0].status, 'not-started');
  assert.ok(result.pendingStudents.every(s => !Object.hasOwn(s, 'answers') && !Object.hasOwn(s, 'score')));
  await assert.rejects(f.act('student', 'teacherAssignmentProgress', { assignmentId:published.id }), e => e.status === 403);
  await assert.rejects(f.act('outsider', 'teacherAssignmentProgress', { assignmentId:published.id }), e => e.status === 403);
  const draft = await f.draft();
  await assert.rejects(f.act('teacher', 'teacherAssignmentProgress', { assignmentId:draft.id }), e => e.status === 404);
});
test('approved teachers only see assigned classes and lose dashboard and progress access when revoked', async () => {
  const f = await fixture();
  await f.db.doc('users/mentor').set({ isAdmin:false,displayName:'林老師' });
  await f.db.doc('classroomTeacherAccounts/mentor').set({ uid:'mentor',status:'approved',name:'林老師',school:'青雲中學',version:1 });
  const assignment = await f.publish();
  await f.act('teacher','assignTeacher',{ teacherUid:'mentor',expectedOwnerUid:'teacher' });
  const dashboard = (await f.call('mentor','teacherDashboard')).dashboard;
  assert.equal(dashboard.classes.length,1);
  assert.equal(dashboard.classes[0].id,f.classId);
  assert.equal(dashboard.classes[0].assignments[0].id,assignment.id);
  const progress = (await f.act('mentor','teacherAssignmentProgress',{assignmentId:assignment.id})).progress;
  assert.equal(progress.submitted,0);
  await f.db.doc('classroomTeacherAccounts/mentor').update({status:'revoked'});
  await assert.rejects(f.call('mentor','teacherDashboard'),e=>e.status===403);
  await assert.rejects(f.act('mentor','teacherAssignmentProgress',{assignmentId:assignment.id}),e=>e.status===403);
});
test('administrator teacher dashboard is paginated without counting unchecked classes as loaded', async () => {
  const f = await fixture();
  for (let i=0;i<24;i++) {
    const roomId = 'page-' + String(i).padStart(2,'0');
    await f.db.doc('classrooms/'+roomId).set({ id:roomId,name:'第'+i+'班',teacherName:'管理員',
      ownerUid:'teacher',status:'active',members:[],assignmentIds:[],createdAtMs:CLOCK });
  }
  const first = (await f.call('teacher','teacherDashboard')).dashboard;
  assert.equal(first.classes.length,20);
  assert.ok(first.nextCursor);
  const second = (await f.call('teacher','teacherDashboard',{cursor:first.nextCursor})).dashboard;
  assert.equal(second.classes.length,5);
  assert.equal(second.nextCursor,null);
  assert.equal(new Set([...first.classes,...second.classes].map(r=>r.id)).size,25);
});


test('copying an assignment creates an independent, unpublished draft without deadlines, submissions or mutable links', async () => {
  const f = await fixture();
  await f.join();
  const original = await f.publish();
  await submit(f, original);
  const destination = (await f.call('teacher', 'createClass',
    { name: '八年二班', teacherName: '陳老師' })).classroom;
  const copied = (await f.call('teacher', 'copyAssignment', {
    classId: destination.id, sourceClassId: f.classId, sourceAssignmentId: original.id
  })).assignment;
  assert.notEqual(copied.id, original.id);
  assert.equal(copied.status, 'draft');
  assert.equal(copied.title, '加法練習（副本）');
  assert.equal(copied.dueAtMs, null);
  assert.equal(copied.questions.length, 2);
  assert.deepEqual(copied.questions.map(q => q.answerIndex), [1, 3]);
  assert.equal(copied.version, 1);
  assert.equal((await f.call('teacher', 'classDetail', { classId:destination.id })).assignments.length, 1);
  assert.equal((await f.act('teacher', 'report', { assignmentId: original.id })).report.totals.average, 50);
  await f.call('teacher', 'publishAssignment', { classId:destination.id, assignmentId:copied.id,
    version:copied.version, reviewed:true });
  assert.equal((await f.call('teacher', 'getAssignment', { classId:destination.id,
    assignmentId:copied.id })).submission, null);
  assert.equal((await f.act('teacher', 'getAssignment', { assignmentId:original.id })).assignment.status, 'published');
  await assert.rejects(f.call('student', 'copyAssignment', { classId:destination.id,
    sourceClassId:f.classId, sourceAssignmentId:original.id }), err => err.status === 403);
  await assert.rejects(f.call('outsider', 'copyAssignment', { classId:destination.id,
    sourceClassId:f.classId, sourceAssignmentId:original.id }), err => err.status === 403);
});
test('teacher assignment copies require access to both the source class and destination class', async () => {
  const f = await fixture();
  const draft = await f.draft();
  const destination = (await f.call('teacher', 'createClass',
    { name:'另一間教室',teacherName:'管理員' })).classroom;
  await f.db.doc('users/mentor').set({ displayName:'林老師',isAdmin:false });
  await f.db.doc('classroomTeacherAccounts/mentor').set({
    uid:'mentor',name:'林老師',school:'中學',status:'approved',version:1
  });
  await f.act('teacher', 'assignTeacher', { teacherUid:'mentor',expectedOwnerUid:'teacher' });
  await assert.rejects(f.call('mentor','copyAssignment',{
    classId:destination.id,sourceClassId:f.classId,sourceAssignmentId:draft.id
  }),err=>err.status===403);
  const copied = (await f.call('mentor','copyAssignment',{
    classId:f.classId,sourceClassId:f.classId,sourceAssignmentId:draft.id,
    title:'本班複習'
  })).assignment;
  assert.equal(copied.title,'本班複習');
  assert.equal(copied.status,'draft');
  await f.db.doc('classroomTeacherAccounts/mentor').update({status:'revoked'});
  await assert.rejects(f.call('mentor','copyAssignment',{
    classId:f.classId,sourceClassId:f.classId,sourceAssignmentId:draft.id
  }),err=>err.status===403);
  const missing = await f.call('teacher','copyAssignment',{
    classId:destination.id,sourceClassId:destination.id,sourceAssignmentId:draft.id
  }).catch(error => error);
  assert.equal(missing.status,404);
});
test('copying is blocked for archived destinations and leaves published source unchanged', async () => {
  const f=await fixture();
  const original=await f.publish();
  await f.act('teacher','archiveClass',{archived:true});
  await assert.rejects(f.act('teacher','copyAssignment',{
    sourceClassId:f.classId,sourceAssignmentId:original.id
  }),err=>err.status===409);
  assert.equal((await f.act('teacher','getAssignment',{assignmentId:original.id})).assignment.status,'published');
});



test('teacher-owned classes respect the 20-class limit and spoofed identities never grant rights', async () => {
  const f = await fixture();
  await approve(f,'mentor');
  for (let i = 0; i < 20; i++) {
    const room = (await f.call('mentor','createClass',
      {name:'我建的班級 '+i,teacherName:'假管理員',uid:'teacher',isAdmin:true},
      {makeId:()=> 'mentor-room-'+i,
       makeCode:()=> 'TEACH'+String.fromCharCode(65+Math.floor(i/26))+String.fromCharCode(65+i%26)+'Z'})).classroom;
    assert.equal(room.role,'teacher');
    assert.equal((await f.db.doc('classrooms/'+room.id).get()).data().teacherName,'林老師');
  }
  await assert.rejects(f.call('mentor','createClass',{name:'超出上限'}),err=>err.status===409);
  assert.equal((await f.call('mentor','list')).classes.length,20);
  await assert.rejects(f.call('outsider','createClass',{name:'越權',isTeacher:true}),err=>err.status===403);
});
test('teacher single and bulk roster updates use immutable uid and preserve submitted grades and correction history', async () => {
  const f = await fixture();
  await f.join('student','王同學');
  await f.join('other','李同學');
  const a = await f.publish();
  await submit(f,a);
  const original = (await f.act('teacher','classDetail')).classroom;
  assert.equal(original.rosterVersion,2);
  const result = await f.act('teacher','updateStudents',{rosterVersion:original.rosterVersion,updates:[
    {uid:'student',name:'王小明',seat:'05'},
    {uid:'other',name:'李小芳',seat:'12'}
  ]});
  assert.equal(result.updated,2);
  assert.equal(result.rosterVersion,3);
  const renamed = (await f.act('teacher','classDetail')).classroom;
  assert.equal(renamed.members.find(x=>x.uid==='student').name,'王小明');
  assert.equal(renamed.members.find(x=>x.uid==='other').seat,'12');
  const report = (await f.act('teacher','report',{assignmentId:a.id})).report;
  assert.equal(report.totals.average,50);
  assert.equal(report.students.find(m=>m.uid==='student').name,'王小明');
  assert.equal(report.students.find(m=>m.uid==='student').seat,'05');
  assert.equal((await f.act('student','getAssignment',{assignmentId:a.id})).submission.score,50);
  // Rejoining with the original access code cannot overwrite teacher-managed data.
  await f.join('student','惡意修改姓名');
  const afterRejoin = (await f.act('teacher','classDetail')).classroom;
  assert.equal(afterRejoin.members.find(x=>x.uid==='student').name,'王小明');
  assert.equal(afterRejoin.rosterVersion,3);
  await assert.rejects(f.act('student','updateStudents',{rosterVersion:3,updates:[
    {uid:'student',name:'假冒修改',seat:'1'}]}),err=>err.status===403);
  await assert.rejects(f.act('outsider','updateStudents',{rosterVersion:3,updates:[
    {uid:'student',name:'假冒修改',seat:'1'}]}),err=>err.status===403);
});
test('roster version conflicts, invalid uid batches and archived classes reject all edits atomically', async () => {
  const f = await fixture();
  await f.join();
  await f.join('other','林同學');
  const before = (await f.act('teacher','classDetail')).classroom;
  const good = {rosterVersion:before.rosterVersion,updates:[{uid:'student',name:'改名',seat:'7'}]};
  await f.act('teacher','updateStudents',good);
  await assert.rejects(f.act('teacher','updateStudents',good),err=>err.status===409);
  await assert.rejects(f.act('teacher','updateStudents',{rosterVersion:before.rosterVersion+1,
    updates:[{uid:'student',name:'合法',seat:'1'},{uid:'ghost',name:'不在班上',seat:'2'}]}),err=>err.status===404);
  await assert.rejects(f.act('teacher','updateStudents',{rosterVersion:before.rosterVersion+1,
    updates:[{uid:'student',name:'甲',seat:'1'},{uid:'student',name:'乙',seat:'2'}]}),err=>err.status===400);
  const unchanged = (await f.act('teacher','classDetail')).classroom;
  assert.equal(unchanged.members.find(m=>m.uid==='student').name,'改名');
  assert.equal(unchanged.members.find(m=>m.uid==='other').name,'林同學');
  await f.act('teacher','archiveClass',{archived:true});
  await assert.rejects(f.act('teacher','updateStudents',{rosterVersion:unchanged.rosterVersion,
    updates:[{uid:'student',name:'不能改',seat:'1'}]}),err=>err.status===409);
  await assert.rejects(f.act('teacher','batchRemoveStudents',{rosterVersion:unchanged.rosterVersion,
    studentUids:['student']}),err=>err.status===409);
});
test('batch removal updates indexes atomically and preserves historic published-assignment results', async () => {
  const f = await fixture(); await f.join(); await f.join('other','林同學');
  const a = await f.publish(); await submit(f,a);
  const room = (await f.act('teacher','classDetail')).classroom;
  const removed = await f.act('teacher','batchRemoveStudents',{
    rosterVersion:room.rosterVersion,studentUids:['student','other']});
  assert.equal(removed.removed,2);
  const after = (await f.act('teacher','classDetail')).classroom;
  assert.equal(after.studentCount,0); assert.equal(after.rosterVersion,room.rosterVersion+1);
  assert.equal((await f.call('student','list')).classes.length,0);
  assert.equal((await f.call('other','list')).classes.length,0);
  const report = (await f.act('teacher','report',{assignmentId:a.id})).report;
  assert.equal(report.students.length,2);
  assert.equal(report.students.find(m=>m.uid==='student').score,50);
  await assert.rejects(f.act('student','classDetail'),err=>err.status===403);
  await assert.rejects(f.act('teacher','batchRemoveStudents',{rosterVersion:after.rosterVersion,
    studentUids:['student']}),err=>err.status===404);
});


test('long-term learning analysis pages four assignments at a time, survives later draft creation and never exposes answers', async () => {
  const f = await fixture();
  await f.join();
  await f.join('other', '陳同學');
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const draft = (await f.act('teacher', 'saveAssignment', {
      title: '長期評量 ' + i, subject: '數學', questions: questions()
    })).assignment;
    await f.act('teacher', 'publishAssignment', {
      assignmentId: draft.id, version: draft.version, reviewed: true
    });
    ids.push(draft.id);
    if (i % 2 === 0) await submit(f, draft, i < 4 ? [0,0] : [1,0]);
  }
  const first = (await f.act('teacher','learningAnalysisPage')).analysis;
  assert.equal(first.rows.length, 4);
  assert.equal(first.scanned, 4);
  assert.equal(first.totalAssigned, 10);
  assert.equal(first.rows[0].title,'長期評量 9');
  assert.equal(first.rows[1].title,'長期評量 8');
  assert.equal(first.studentCount,2);
  assert.equal(first.rows[0].average,null);
  assert.equal(first.rows[0].submitted,0);
  assert.equal(first.rows[0].notStarted,2);
  assert.equal(first.rows[1].average,50);
  assert.equal(first.rows[1].submitted,1);
  assert.equal(first.rows[1].knowledgePoints[0].correct,1);
  assert.equal(first.rows[1].knowledgePoints[0].total,1);
  assert.ok(first.nextCursor);
  assert.doesNotMatch(JSON.stringify(first), /"answers"|"answerIndex"|"correctOption"|"explanation"|"options"/);
  // Appending a new draft must not move the cursor or re-read the newest assignment.
  await f.draft();
  const second = (await f.act('teacher','learningAnalysisPage',{cursor:first.nextCursor})).analysis;
  assert.deepEqual(second.rows.map(x=>x.title),['長期評量 5','長期評量 4','長期評量 3','長期評量 2']);
  const last = (await f.act('teacher','learningAnalysisPage',{cursor:second.nextCursor})).analysis;
  assert.deepEqual(last.rows.map(x=>x.title),['長期評量 1','長期評量 0']);
  assert.equal(last.nextCursor,null);
  assert.equal(first.rows.length+second.rows.length+last.rows.length,10);
  await assert.rejects(f.act('teacher','learningAnalysisPage',{cursor:'unknown'}),e=>e.status===409);
});
test('individual student learning history is paginated, tracks corrections separately and isolates classmates', async () => {
  const f = await fixture();
  await f.join();
  await f.join('other','小陳');
  const a = await f.publish();
  await submit(f,a,[0,0]);
  await f.act('student','correct',{assignmentId:a.id,questionId:'q1',selectedIndex:1});
  const summary = (await f.act('teacher','studentLearningPage',{studentUid:'student'})).analysis;
  assert.equal(summary.student.name,'王同學');
  assert.equal(summary.rows.length,1);
  assert.equal(summary.rows[0].score,0);
  assert.equal(summary.rows[0].correctedCount,1);
  assert.equal(summary.rows[0].wrongCount,2);
  assert.equal(summary.rows[0].workStatus,'submitted');
  assert.equal(summary.rows[0].knowledgePoints[0].correct,0);
  assert.equal(summary.rows[0].knowledgePoints[0].total,1);
  assert.doesNotMatch(JSON.stringify(summary), /"answers"|"answerIndex"|"explanation"|"options"|小陳/);
  const absent = (await f.act('teacher','studentLearningPage',{studentUid:'other'})).analysis;
  assert.equal(absent.rows[0].workStatus,'not-started');
  assert.equal(absent.rows[0].score,null);
  assert.equal(absent.rows[0].correctedCount,0);
  for (const action of ['learningAnalysisPage','studentLearningPage']) {
    await assert.rejects(f.act('student',action,{studentUid:'other'}),e=>e.status===403);
    await assert.rejects(f.act('outsider',action,{studentUid:'student'}),e=>e.status===403);
  }
  await assert.rejects(f.act('teacher','studentLearningPage',{studentUid:'not-a-member'}),e=>e.status===404);
});
test('learning analysis uses only current roster and prevents revoked teachers and removed-student history', async () => {
  const f = await fixture();
  await f.join();
  await f.join('other','另一位');
  const a = await f.publish();
  await submit(f,a,[1,0]);
  const before = (await f.act('teacher','learningAnalysisPage')).analysis;
  assert.equal(before.rows[0].studentCount,2);
  assert.equal(before.rows[0].submitted,1);
  await f.act('teacher','removeStudent',{studentUid:'student'});
  const after = (await f.act('teacher','learningAnalysisPage')).analysis;
  assert.equal(after.rows[0].studentCount,1);
  assert.equal(after.rows[0].submitted,0);
  assert.equal(after.rows[0].average,null);
  await assert.rejects(f.act('teacher','studentLearningPage',{studentUid:'student'}),e=>e.status===404);
  const original = (await f.act('teacher','report',{assignmentId:a.id})).report;
  assert.equal(original.students.find(row=>row.uid==='student').score,50);
  await approve(f,'mentor');
  await f.act('teacher','assignTeacher',{teacherUid:'mentor',expectedOwnerUid:'teacher'});
  const approved = (await f.call('mentor','learningAnalysisPage',{classId:f.classId})).analysis;
  assert.equal(approved.rows.length,1);
  const mentor = (await f.db.doc('classroomTeacherAccounts/mentor').get()).data();
  await f.call('teacher','reviewTeacher',{teacherUid:'mentor',version:mentor.version,decision:'revoke'});
  await assert.rejects(f.call('mentor','learningAnalysisPage',{classId:f.classId}),e=>e.status===403);
});
test('learning analysis is explicit on-demand and skips drafts without inventing grades', async () => {
  const f = await fixture();
  await f.draft();
  const first = (await f.act('teacher','learningAnalysisPage')).analysis;
  assert.equal(first.rows.length,0);
  assert.equal(first.scanned,1);
  assert.equal(first.nextCursor,null);
  assert.equal(first.totalAssigned,1);
  assert.match(first.scope,/首次/);
});

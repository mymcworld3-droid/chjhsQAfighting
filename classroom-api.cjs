'use strict';

const { randomUUID, randomBytes } = require('node:crypto');
const { playerRepository } = require('./server-repositories.cjs');
const { verifyRequest } = require('./invitation-api.cjs');
const Knowledge = require('./public/cultivation/knowledge-points.js');
const LIMITS = Object.freeze({ classes: 20, students: 100, assignments: 100, questions: 30 });
const fail = (message, status = 400) => Object.assign(Error(message), { status });
const ref = (db, collection, id) => db.collection(collection).doc(id);
const id = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw fail('資料代碼格式錯誤');
  return value;
};
function text(value, max, label, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw fail(label + '格式錯誤');
  return value.trim();
}
function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(8)].map(n => alphabet[n % alphabet.length]).join('');
}
const member = (room, uid) => room.members.find(row => row.uid === uid);
function requireAccess(room, uid, teacher = false) {
  if (!room) throw fail('找不到班級', 404);
  if (room.ownerUid !== uid && (teacher || !member(room, uid))) throw fail('沒有此班級的權限', 403);
}
function summary(room, uid) {
  return { id: room.id, name: room.name, teacherName: room.teacherName, role: room.ownerUid === uid ? 'teacher' : 'student',
    status: room.status, studentCount: room.members.length, createdAtMs: room.createdAtMs,
    ...(room.ownerUid === uid ? { joinCode: room.joinCode } : {}) };
}
function questionsOf(values, subject) {
  if (!Array.isArray(values) || !values.length || values.length > LIMITS.questions) throw fail('題組需有 1–30 題');
  return values.map((q, i) => {
    if (!q || !Array.isArray(q.options) || q.options.length !== 4 || !Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex > 3) throw fail('第 ' + (i + 1) + ' 題需有四個選項與正確答案');
    const options = q.options.map(value => text(value, 1200, '選項'));
    if (new Set(options).size !== 4) throw fail('第 ' + (i + 1) + ' 題的選項不可重複');
    const labels = Knowledge.labels(q, subject);
    if (q.knowledge_points !== undefined && (!Array.isArray(q.knowledge_points) || labels.length !== q.knowledge_points.length)) throw fail('知識點標記無效');
    return { id: 'q' + (i + 1), question: text(q.question, 4000, '題幹'), options, answerIndex: q.answerIndex,
      explanation: text(q.explanation || '', 4000, '解析', false), knowledge_points: labels };
  });
}
const assignmentSummary = value => ({ id: value.id, title: value.title, subject: value.subject, status: value.status,
  version: value.version, questionCount: value.questions.length, dueAtMs: value.dueAtMs, publishedAtMs: value.publishedAtMs || null });
const progressView = value => value ? { status: value.status, answers: value.answers, version: value.version,
  ...(value.status === 'submitted' ? { correctCount: value.correctCount, total: value.total, score: value.score,
    submittedAtMs: value.submittedAtMs, corrections: value.corrections || [] } : {}) } : null;
function studentQuestions(assignment, submitted) {
  return assignment.questions.map(q => submitted ? q : { id: q.id, question: q.question, options: q.options, knowledge_points: q.knowledge_points });
}
function answersOf(values, length, complete) {
  if (!Array.isArray(values) || values.length !== length || values.some(n => !(Number.isInteger(n) && n >= 0 && n < 4) && (complete || n !== null))) throw fail(complete ? '請完成每一題後再繳交' : '作答格式錯誤');
  return [...values];
}
function csvCell(value) {
  let str = String(value ?? '');
  if (/^[\s\uFEFF]*[=+@-]/.test(str) || /^[\t\r\n]/.test(str)) str = "'" + str;
  return '"' + str.replace(/"/g, '""') + '"';
}
function reportCsv(report) {
  const rows = [['班級', '作業', '姓名', '座號', '狀態', '首次答對', '題數', '首次正確率(%)', '已訂正錯題', '錯題數', '繳交時間']];
  for (const row of report.students) rows.push([report.className, report.assignment.title, row.name, row.seat,
    row.status === 'submitted' ? '已繳交' : row.status === 'in-progress' ? '作答中' : '未開始',
    row.correctCount, report.assignment.questionCount, row.score, row.correctedCount, row.wrongCount,
    row.submittedAtMs ? new Date(row.submittedAtMs).toISOString() : '']);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

async function perform(db, uid, body, { now = Date.now, makeId = randomUUID, makeCode = newCode } = {}) {
  if (!uid || typeof uid !== 'string' || uid.includes('/')) throw fail('請先登入', 401);
  const clock = now();
  const profileRef = ref(db, 'classroomProfiles', uid);
  if (body.action === 'list') {
    const profile = await profileRef.get();
    const rooms = await Promise.all((profile.data()?.classIds || []).slice(0, LIMITS.classes).map(key => ref(db, 'classrooms', key).get()));
    return { classes: rooms.filter(s => s.exists).map(s => s.data()).filter(r => r.ownerUid === uid || member(r, uid)).map(r => summary(r, uid)) };
  }
  if (body.action === 'createClass') {
    const name = text(body.name, 60, '班級名稱'), teacherName = text(body.teacherName, 40, '教師名稱');
    const classId = id(makeId()), joinCode = makeCode();
    const roomRef = ref(db, 'classrooms', classId), codeRef = ref(db, 'classroomCodes', joinCode);
    return db.runTransaction(async tx => {
      const [profile, existing, code] = await Promise.all([tx.get(profileRef), tx.get(roomRef), tx.get(codeRef)]);
      const classIds = profile.data()?.classIds || [];
      if (classIds.length >= LIMITS.classes) throw fail('最多可加入或管理 20 個班級', 409);
      if (existing.exists || code.exists) throw fail('代碼正在使用，請重新建立班級', 409);
      const room = { id: classId, name, teacherName, ownerUid: uid, joinCode, status: 'active', members: [], assignmentIds: [], createdAtMs: clock };
      tx.create(roomRef, room); tx.create(codeRef, { classId }); tx.set(profileRef, { classIds: [...classIds, classId] });
      return { classroom: summary(room, uid) };
    });
  }
  if (body.action === 'joinClass') {
    const joinCode = text(body.joinCode, 8, '加入碼').toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(joinCode)) throw fail('請輸入八碼班級加入碼');
    const name = text(body.name, 40, '學生姓名'), seat = text(body.seat || '', 12, '座號', false);
    return db.runTransaction(async tx => {
      const [profile, code] = await Promise.all([tx.get(profileRef), tx.get(ref(db, 'classroomCodes', joinCode))]);
      if (!code.exists) throw fail('加入碼無效', 404);
      const roomRef = ref(db, 'classrooms', code.data().classId), snap = await tx.get(roomRef), room = snap.data();
      if (!room || room.joinCode !== joinCode || room.status !== 'active') throw fail('班級目前不開放加入', 409);
      if (room.ownerUid === uid) return { classroom: summary(room, uid) };
      const classIds = profile.data()?.classIds || [], enrolled = member(room, uid);
      if (!enrolled && room.members.length >= LIMITS.students) throw fail('班級已達 100 人上限', 409);
      if (!classIds.includes(room.id) && classIds.length >= LIMITS.classes) throw fail('最多可加入或管理 20 個班級', 409);
      const student = { uid, name, seat, joinedAtMs: enrolled?.joinedAtMs || clock };
      room.members = [...room.members.filter(m => m.uid !== uid), student];
      tx.set(roomRef, room); tx.set(profileRef, { classIds: [...new Set([...classIds, room.id])] });
      return { classroom: summary(room, uid) };
    });
  }
  const classId = id(body.classId), roomRef = ref(db, 'classrooms', classId);
  if (body.action === 'classDetail') {
    const snap = await roomRef.get(), room = snap.data(); requireAccess(room, uid);
    const teacher = room.ownerUid === uid;
    const values = await Promise.all(room.assignmentIds.map(key => ref(db, 'classroomAssignments', key).get()));
    const assignments = values.filter(s => s.exists).map(s => s.data()).filter(a => a.classId === classId && (teacher || a.status !== 'draft'));
    const submissions = teacher ? [] : await Promise.all(assignments.map(a => ref(db, 'classroomSubmissions', a.id + '_' + uid).get()));
    // Recheck membership after dependent reads; a removed student cannot retain access.
    requireAccess((await roomRef.get()).data(), uid);
    return { classroom: { ...summary(room, uid), ...(teacher ? { members: room.members } : { student: member(room, uid) }) },
      assignments: assignments.map((a, i) => ({ ...assignmentSummary(a), ...(!teacher ? { submission: progressView(submissions[i]?.data()) } : {}) })) };
  }
  if (['renameClass', 'rotateCode', 'archiveClass', 'removeStudent', 'leaveClass'].includes(body.action)) {
    const nextCode = body.action === 'rotateCode' ? makeCode() : null;
    return db.runTransaction(async tx => {
      const snap = await tx.get(roomRef), room = snap.data(); requireAccess(room, uid, body.action !== 'leaveClass');
      if (body.action === 'renameClass') room.name = text(body.name, 60, '班級名稱');
      if (body.action === 'archiveClass') {
        if (typeof body.archived !== 'boolean') throw fail('班級狀態格式錯誤');
        room.status = body.archived ? 'archived' : 'active';
      }
      if (nextCode) {
        const newRef = ref(db, 'classroomCodes', nextCode), code = await tx.get(newRef);
        if (code.exists) throw fail('代碼正在使用，請重試', 409);
        tx.delete(ref(db, 'classroomCodes', room.joinCode)); tx.create(newRef, { classId }); room.joinCode = nextCode;
      }
      if (['removeStudent', 'leaveClass'].includes(body.action)) {
        const target = body.action === 'leaveClass' ? uid : text(body.studentUid, 128, '學生代碼');
        if (target.includes('/') || target === room.ownerUid) throw fail('教師不能退出自己建立的班級');
        const targetRef = ref(db, 'classroomProfiles', target), profile = await tx.get(targetRef);
        room.members = room.members.filter(m => m.uid !== target);
        if (profile.exists) tx.set(targetRef, { classIds: (profile.data().classIds || []).filter(key => key !== classId) });
      }
      tx.set(roomRef, room); return { classroom: summary(room, uid) };
    });
  }
  const assignmentId = body.action === 'saveAssignment' && !body.assignmentId ? id(makeId()) : id(body.assignmentId);
  const assignmentRef = ref(db, 'classroomAssignments', assignmentId);
  if (body.action === 'saveAssignment') {
    const subject = text(body.subject || '綜合', 20, '科目'), title = text(body.title, 80, '作業名稱');
    if (!['綜合', ...Knowledge.SUBJECT_NAMES].includes(subject)) throw fail('請選擇支援的科目');
    const questions = questionsOf(body.questions, subject === '綜合' ? '' : subject);
    const dueAtMs = body.dueAtMs == null || body.dueAtMs === '' ? null : Number(body.dueAtMs);
    if (dueAtMs !== null && (!Number.isSafeInteger(dueAtMs) || dueAtMs <= clock || dueAtMs > clock + 366 * 86400000)) throw fail('截止時間需在未來一年內');
    return db.runTransaction(async tx => {
      const [r, a] = await Promise.all([tx.get(roomRef), tx.get(assignmentRef)]), room = r.data(), previous = a.data();
      requireAccess(room, uid, true);
      if (room.status !== 'active') throw fail('請先恢復班級再編輯作業', 409);
      if (previous && previous.classId !== classId) throw fail('作業不屬於此班級', 403);
      if (previous && (previous.status !== 'draft' || body.version !== previous.version)) throw fail('作業已發布或已被更新，請重新載入', 409);
      if (!previous && room.assignmentIds.length >= LIMITS.assignments) throw fail('每班最多保存 100 份作業', 409);
      const assignment = { id: assignmentId, classId, teacherUid: uid, title, subject, questions, dueAtMs,
        status: 'draft', version: (previous?.version || 0) + 1, createdAtMs: previous?.createdAtMs || clock, updatedAtMs: clock };
      tx.set(assignmentRef, assignment);
      if (!previous) tx.update(roomRef, { assignmentIds: [...room.assignmentIds, assignmentId] });
      return { assignment: { ...assignmentSummary(assignment), questions } };
    });
  }
  if (body.action === 'deleteDraft') {
    return db.runTransaction(async tx => {
      const [r, a] = await Promise.all([tx.get(roomRef), tx.get(assignmentRef)]), room = r.data(), assignment = a.data();
      requireAccess(room, uid, true);
      if (!assignment || assignment.classId !== classId) throw fail('找不到作業', 404);
      if (assignment.status !== 'draft') throw fail('已發布的作業不能刪除', 409);
      tx.delete(assignmentRef); tx.update(roomRef, { assignmentIds: room.assignmentIds.filter(key => key !== assignmentId) });
      return { deleted: true };
    });
  }
  if (['publishAssignment', 'closeAssignment'].includes(body.action)) {
    return db.runTransaction(async tx => {
      const [r, a] = await Promise.all([tx.get(roomRef), tx.get(assignmentRef)]), room = r.data(), assignment = a.data();
      requireAccess(room, uid, true);
      if (!assignment || assignment.classId !== classId) throw fail('找不到作業', 404);
      if (body.version !== assignment.version) throw fail('作業已更新，請重新載入', 409);
      if (body.action === 'publishAssignment') {
        if (room.status !== 'active' || assignment.status !== 'draft') throw fail('目前無法發布此作業', 409);
        if (body.reviewed !== true) throw fail('請先預覽並確認題目與答案');
        if (assignment.dueAtMs && assignment.dueAtMs <= clock) throw fail('截止時間已過，請先修改草稿');
        assignment.status = 'published'; assignment.publishedAtMs = clock; assignment.roster = room.members;
      } else {
        if (assignment.status !== 'published') throw fail('只有已發布的作業可以結束', 409);
        assignment.status = 'closed';
      }
      assignment.version++; tx.set(assignmentRef, assignment);
      return { assignment: assignmentSummary(assignment) };
    });
  }
  if (['report', 'exportReport'].includes(body.action)) {
    const [r, a] = await Promise.all([roomRef.get(), assignmentRef.get()]), room = r.data(), assignment = a.data();
    requireAccess(room, uid, true);
    if (!assignment || assignment.classId !== classId) throw fail('找不到作業', 404);
    const roster = [...new Map([...(assignment.roster || []), ...room.members].map(m => [m.uid, m])).values()];
    const records = await Promise.all(roster.map(m => ref(db, 'classroomSubmissions', assignmentId + '_' + m.uid).get()));
    const students = roster.map((m, i) => {
      const s = records[i].data(), submitted = s?.status === 'submitted';
      const wrongCount = submitted ? s.total - s.correctCount : null;
      return { ...m, active: !!member(room, m.uid), status: s?.status || 'not-started', correctCount: submitted ? s.correctCount : null,
        score: submitted ? s.score : null, submittedAtMs: submitted ? s.submittedAtMs : null, wrongCount,
        correctedCount: submitted ? (s.corrections || []).filter(c => c.correct && s.answers[assignment.questions.findIndex(q => q.id === c.questionId)] !== assignment.questions.find(q => q.id === c.questionId)?.answerIndex).length : 0 };
    }).sort((a, b) => a.seat.localeCompare(b.seat, 'zh-Hant', { numeric: true }) || a.name.localeCompare(b.name, 'zh-Hant'));
    const submitted = students.filter(s => s.status === 'submitted');
    const questions = assignment.questions.map((q, i) => ({ id: q.id, question: q.question, knowledge_points: q.knowledge_points,
      correct: records.filter(s => s.data()?.status === 'submitted' && s.data().answers[i] === q.answerIndex).length, total: submitted.length }));
    const pointMap = new Map();
    for (const question of questions) for (const point of question.knowledge_points) {
      const key = point.subject + '/' + point.id, previous = pointMap.get(key) || { ...point, correct: 0, total: 0 };
      pointMap.set(key, { ...previous, correct: previous.correct + question.correct, total: previous.total + question.total });
    }
    const report = { className: room.name, assignment: assignmentSummary(assignment), students, questions, knowledgePoints: [...pointMap.values()],
      totals: { students: roster.length, submitted: submitted.length, average: submitted.length ? Math.round(submitted.reduce((sum, s) => sum + s.score, 0) / submitted.length * 100) / 100 : null } };
    return body.action === 'exportReport' ? { csv: reportCsv(report) } : { report };
  }
  if (body.action === 'getAssignment') {
    const [r, a] = await Promise.all([roomRef.get(), assignmentRef.get()]), room = r.data(), assignment = a.data(); requireAccess(room, uid);
    const teacher = room.ownerUid === uid;
    if (!assignment || assignment.classId !== classId || (!teacher && assignment.status === 'draft')) throw fail('找不到作業', 404);
    const progress = teacher ? null : (await ref(db, 'classroomSubmissions', assignmentId + '_' + uid).get()).data();
    requireAccess((await roomRef.get()).data(), uid);
    return { assignment: { ...assignmentSummary(assignment), questions: teacher ? assignment.questions : studentQuestions(assignment, progress?.status === 'submitted') }, submission: progressView(progress) };
  }
  if (['saveProgress', 'submit', 'correct'].includes(body.action)) {
    const submissionRef = ref(db, 'classroomSubmissions', assignmentId + '_' + uid);
    return db.runTransaction(async tx => {
      const [r, a, s] = await Promise.all([tx.get(roomRef), tx.get(assignmentRef), tx.get(submissionRef)]);
      const room = r.data(), assignment = a.data(), previous = s.data(); requireAccess(room, uid);
      if (!member(room, uid)) throw fail('只有班級學生可以繳交作業', 403);
      if (!assignment || assignment.classId !== classId || assignment.status === 'draft') throw fail('找不到作業', 404);
      // A retry after the deadline returns the committed first score unchanged.
      if (previous?.status === 'submitted' && body.action !== 'correct') return { submission: progressView(previous), questions: studentQuestions(assignment, true) };
      if (body.action === 'correct') {
        if (previous?.status !== 'submitted') throw fail('請先繳交作業', 409);
        const question = assignment.questions.find(q => q.id === body.questionId);
        if (!question || !Number.isInteger(body.selectedIndex) || body.selectedIndex < 0 || body.selectedIndex > 3) throw fail('訂正格式錯誤');
        if (previous.corrections?.some(c => c.questionId === question.id && c.correct)) return { submission: progressView(previous), correct: true };
        const correct = body.selectedIndex === question.answerIndex;
        const corrections = [...(previous.corrections || []).filter(c => c.questionId !== question.id), { questionId: question.id, selectedIndex: body.selectedIndex, correct, atMs: clock }];
        const next = { ...previous, corrections, version: previous.version + 1 };
        tx.set(submissionRef, next); return { submission: progressView(next), correct };
      }
      if (room.status !== 'active' || assignment.status !== 'published' || assignment.dueAtMs && clock > assignment.dueAtMs) throw fail('作業已截止，仍可查看已繳交的結果', 409);
      if (body.version !== (previous?.version || 0)) throw fail('作答已在其他視窗更新，請重新載入', 409);
      const answers = answersOf(body.answers, assignment.questions.length, body.action === 'submit');
      const next = { uid, classId, assignmentId, answers, status: 'in-progress', version: (previous?.version || 0) + 1, updatedAtMs: clock };
      if (body.action === 'submit') {
        const correctCount = assignment.questions.filter((q, i) => answers[i] === q.answerIndex).length;
        Object.assign(next, { status: 'submitted', correctCount, total: answers.length, score: Math.round(correctCount / answers.length * 10000) / 100, submittedAtMs: clock, corrections: [] });
      }
      // Preserve work by late joiners even if they later leave the class.
      if (!(assignment.roster || []).some(m => m.uid === uid)) {
        if ((assignment.roster || []).length >= 1000) throw fail('此作業的歷史名單已滿，請聯絡教師另派作業', 409);
        tx.update(assignmentRef, { roster: [...(assignment.roster || []), member(room, uid)] });
      }
      tx.set(submissionRef, next);
      return { submission: progressView(next), ...(next.status === 'submitted' ? { questions: studentQuestions(assignment, true) } : {}) };
    });
  }
  throw fail('未知的班級操作');
}

function registerClassroomApi(app, { resolveA = () => playerRepository.resolve(), logger = console } = {}) {
  const allowed = new Set(['list', 'createClass', 'joinClass', 'classDetail', 'renameClass', 'rotateCode', 'archiveClass', 'removeStudent', 'leaveClass', 'saveAssignment', 'deleteDraft', 'publishAssignment', 'closeAssignment', 'report', 'exportReport', 'getAssignment', 'saveProgress', 'submit', 'correct']);
  app.post('/api/classrooms', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { uid, a } = await verifyRequest(req, resolveA);
      const body = req.body || {};
      if (!allowed.has(body.action)) throw fail('未知的班級操作');
      return res.json({ ok: true, ...await perform(a.db, uid, body) });
    } catch (error) {
      if (!error.status) logger.error('[Classrooms]', error.message);
      return res.status(error.status || 503).json({ ok: false, error: error.status ? error.message : '班級服務暫時無法使用，請稍後再試' });
    }
  });
}
module.exports = registerClassroomApi;
module.exports.perform = perform;
module.exports.reportCsv = reportCsv;
module.exports.LIMITS = LIMITS;

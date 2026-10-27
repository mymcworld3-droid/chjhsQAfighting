'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { playerRepository, dongtianRepository } = require('./server-repositories.cjs');
const { verifyRequest } = require('./invitation-api.cjs');
const { teacherAccess, assertEntry } = require('./dongtian-access.cjs');
const Classrooms = require('./classroom-api.cjs');
const Knowledge = require('./public/cultivation/knowledge-points.js');
const LEVELS = ['國小中年級', '國小高年級', '國中一年級', '國中二年級', '國中三年級', '高中職', '大學以上'];
const fail = (message, status = 400) => Object.assign(Error(message), { status });
function text(value, max, label, required = true) {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw fail(label + '格式錯誤');
  return value.trim();
}
function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw fail('洞天代碼格式錯誤'); return value; }
function integer(value, min, max, fallback, label) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw fail(label + '格式錯誤'); return n;
}
const summary = c => ({ id: c.id, name: c.name, subject: c.subject, level: c.level, difficulty: c.difficulty, questionCount: c.questions?.length || c.questionCount,
  status: c.status, visibility: c.visibility || 'public', version: c.version || 0, updatedAtMs: c.updatedAtMs || c.createdAtMs || 0 });
const fingerprint = q => createHash('sha256').update(JSON.stringify([q.q, q.correct, q.wrong, q.exp, q.subject, q.difficulty, q.knowledge_points, q.optionOrder || [q.correct, ...q.wrong]])).digest('hex');
function normalize(body, caveId, version, previous) {
  const subject = text(body.subject || '綜合', 24, '科目'), level = body.level || '國中一年級', difficulty = body.difficulty || 'medium';
  if (!LEVELS.includes(level) || !['easy', 'medium', 'hard'].includes(difficulty)) throw fail('程度或難度格式錯誤');
  if (!['public', 'unlisted', 'class', 'private'].includes(body.visibility || 'private')) throw fail('開放範圍格式錯誤');
  const timestamp = (v, label) => { if (v == null || v === '') return null; const n = Number(v); if (!Number.isSafeInteger(n) || n < 0 || n > 8640000000000000) throw fail(label + '格式錯誤'); return n; };
  const openAtMs = timestamp(body.openAtMs, '開始時間'), closeAtMs = timestamp(body.closeAtMs, '截止時間');
  if (openAtMs && closeAtMs && closeAtMs <= openAtMs) throw fail('截止時間須晚於開始時間');
  const settings = body.settings || {};
  if (settings.shuffleQuestions !== undefined && typeof settings.shuffleQuestions !== 'boolean' || settings.shuffleOptions !== undefined && typeof settings.shuffleOptions !== 'boolean') throw fail('題序設定格式錯誤');
  if (!['immediate', 'completion'].includes(settings.feedback || 'immediate')) throw fail('解析顯示設定格式錯誤');
  if (!Array.isArray(body.questions) || !body.questions.length || body.questions.length > 30) throw fail('洞天須有 1–30 題');
  const questions = body.questions.map((raw, i) => {
    if (!raw || !Array.isArray(raw.wrong) || raw.wrong.length !== 3) throw fail('第 ' + (i + 1) + ' 題須有一個正解與三個其他選項');
    const q = { q: text(raw.q, 4000, '題幹'), correct: text(raw.correct, 1200, '正確答案'), wrong: raw.wrong.map(v => text(v, 1200, '選項')),
      exp: text(raw.exp || '', 4000, '解析', false), subject, difficulty, knowledge_points: Knowledge.labels(raw, subject) };
    if (new Set([q.correct, ...q.wrong]).size !== 4) throw fail('第 ' + (i + 1) + ' 題選項不可重複');
    q.optionOrder = raw.optionOrder || [q.correct, ...q.wrong];
    if (!Array.isArray(q.optionOrder) || q.optionOrder.length !== 4 || new Set(q.optionOrder).size !== 4 || q.optionOrder.some(v => ![q.correct, ...q.wrong].includes(v))) throw fail('選項順序格式錯誤');
    if (raw.knowledge_points !== undefined && (!Array.isArray(raw.knowledge_points) || raw.knowledge_points.length !== q.knowledge_points.length)) throw fail('知識點標記無效');
    const old = previous?.questions?.find(v => v.id === raw.id);
    q.id = old && fingerprint({ ...old, knowledge_points: Knowledge.labels(old, subject) }) === fingerprint(q) ? old.id
      : 'tq_' + createHash('sha256').update(caveId + ':' + version + ':' + i + ':' + fingerprint(q)).digest('hex').slice(0, 24);
    return q;
  });
  if (new Set(questions.map(q => q.id)).size !== questions.length) throw fail('題目代碼重複');
  if (Array.isArray(body.tags) && (body.tags.length > 8 || body.tags.some(v => typeof v !== 'string'))) throw fail('標籤格式錯誤');
  const tags = text(Array.isArray(body.tags) ? body.tags.join(',') : body.tags || '', 160, '標籤', false).split(/[,，]/).map(v => v.trim()).filter(Boolean).slice(0, 8);
  return { name: text(body.name, 80, '洞天名稱'), description: text(body.description || '', 1200, '洞天介紹', false),
    instructions: text(body.instructions || '', 1600, '作答說明', false), subject, level, levelOrder: LEVELS.indexOf(level), difficulty,
    visibility: body.visibility || 'private', classId: body.visibility === 'class' ? id(body.classId) : null, openAtMs, closeAtMs, tags, questions, questionCount: questions.length,
    settings: { shuffleQuestions: settings.shuffleQuestions === true, shuffleOptions: settings.shuffleOptions !== false, feedback: settings.feedback || 'immediate',
      passPercent: integer(settings.passPercent, 0, 100, 60, '及格標準') } };
}
async function perform(a, bd, uid, body, { now = Date.now, makeId = randomUUID } = {}) {
  const access = await teacherAccess(a, uid);
  if (body.action === 'status') {
    const allowed = access.admin || access.teacher;
    const classes = allowed ? await Classrooms.perform(a, uid, { action: 'list' }) : { classes: [] };
    return { allowed, isAdmin: access.admin, classes: classes.classes.filter(c => c.role === 'teacher').map(c => ({ id: c.id, name: c.name })), classCursor: classes.nextCursor || null };
  }
  if (!access.admin && !access.teacher) throw fail('教師洞天功能須先經管理員核准', 403);
  const requireRole = async () => { const fresh = await teacherAccess(a, uid); if (!fresh.admin && !fresh.teacher) throw fail('教師資格已失效，請聯絡管理員', 403); return fresh; };
  if (body.action === 'classes') {
    const result = await Classrooms.perform(a, uid, { action: 'list', cursor: body.cursor });
    return { classes: result.classes.filter(c => c.role === 'teacher').map(c => ({ id: c.id, name: c.name })), classCursor: result.nextCursor || null };
  }
  if (body.action === 'list') {
    let query = bd.collection('dongtians').where('ownerUid', '==', uid).orderBy('__name__').limit(31);
    if (body.cursor) query = query.startAfter(id(body.cursor));
    const rows = await query.get(); await requireRole();
    return { caves: rows.docs.slice(0, 30).map(s => summary({ ...s.data(), id: s.id })), nextCursor: rows.docs.length > 30 ? rows.docs[29].id : null };
  }
  const creating = body.action === 'save' && !body.id;
  const caveId = creating || body.action === 'copy' ? id(makeId()) : id(body.id);
  const caveRef = bd.collection('dongtians').doc(caveId), indexRef = bd.collection('dongtianIndex').doc(caveId);
  async function owned(key) {
    const snap = await bd.collection('dongtians').doc(key).get(), cave = snap.data();
    if (!cave) throw fail('找不到洞天', 404);
    const fresh = await requireRole();
    if (cave.ownerUid !== uid && !fresh.admin) throw fail('只能管理自己的洞天', 403);
    return { ...cave, id: snap.id, version: cave.version || 0 };
  }
  if (body.action === 'get') return { cave: await owned(caveId) };
  if (body.action === 'reports') {
    await owned(caveId);
    let query = bd.collection('dongtianReports').where('dongtianId', '==', caveId).orderBy('__name__').limit(51);
    if (body.cursor) query = query.startAfter(id(body.cursor));
    const rows = await query.get(); await owned(caveId);
    return { reports: rows.docs.slice(0, 50).filter(s => s.data().teacherManaged).map(s => ({ id: s.id, ...s.data() })), nextCursor: rows.docs.length > 50 ? rows.docs[49].id : null };
  }
  if (body.action === 'resolveReport') {
    const reportRef = bd.collection('dongtianReports').doc(id(body.reportId));
    return bd.runTransaction(async tx => {
      const [c, r] = await Promise.all([tx.get(caveRef), tx.get(reportRef)]), cave = c.data(), report = r.data();
      const fresh = await requireRole();
      if (!cave || cave.ownerUid !== uid && !fresh.admin) throw fail('只能處理自己洞天的回報', 403);
      if (!report?.teacherManaged || report.dongtianId !== caveId) throw fail('找不到題目回報', 404);
      tx.update(reportRef, { status: 'teacher-resolved', resolution: text(body.resolution || '', 600, '處理說明', false), resolvedByUid: uid, resolvedAtMs: now() });
      return { resolved: true };
    });
  }
  if (body.action === 'assign') {
    const cave = await owned(caveId);
    if (body.version !== cave.version) throw fail('洞天已更新，請重新載入', 409);
    const questions = cave.questions.map(q => ({ question: q.q, options: [q.correct, ...q.wrong], answerIndex: 0, explanation: q.exp || '', knowledge_points: Knowledge.labels(q, cave.subject) }));
    // Class assignments remain fixed snapshots; later cave edits never rewrite grades.
    return Classrooms.perform(a, uid, { action: 'saveAssignment', classId: body.classId, title: cave.name,
      subject: Knowledge.SUBJECT_NAMES.includes(cave.subject) ? cave.subject : '綜合', questions, dueAtMs: body.dueAtMs || null });
  }
  const source = body.action === 'copy' ? await owned(id(body.sourceId)) : null;
  if (!['save', 'publish', 'unpublish', 'copy'].includes(body.action)) throw fail('未知的教師洞天操作');
  return bd.runTransaction(async tx => {
    const [snap, indexSnap] = await Promise.all([tx.get(caveRef), tx.get(indexRef)]), previous = snap.data();
    const fresh = await requireRole();
    if (creating || source) { if (previous) throw fail('洞天代碼已存在，請重試', 409); }
    else {
      if (!previous) throw fail('找不到洞天', 404);
      if (previous.ownerUid !== uid && !fresh.admin) throw fail('只能管理自己的洞天', 403);
      if (body.version !== (previous.version || 0)) throw fail('洞天已在其他視窗更新，請重新載入', 409);
    }
    const version = (previous?.version || 0) + 1;
    let next;
    if (body.action === 'save' || source) {
      const draft = source ? { ...source, name: source.name + '（副本）', visibility: 'private', tags: (source.tags || []).join(',') } : body;
      const values = normalize(draft, caveId, version, previous);
      if (values.visibility === 'class') {
        const room = (await a.collection('classrooms').doc(values.classId).get()).data();
        if (!room || room.status !== 'active' || !fresh.admin && room.ownerUid !== uid) throw fail('只能選擇獲指派的有效班級', 403);
      }
      next = { ...previous, ...values, id: caveId, ownerUid: source || creating ? uid : previous.ownerUid,
        ownerName: source || creating ? (await a.collection('users').doc(uid).get()).data()?.displayName || '教師' : previous.ownerName,
        teacherManaged: true, version, status: previous?.status || 'draft', createdAtMs: previous?.createdAtMs || now(), updatedAtMs: now(),
        playCount: previous?.playCount || 0, completionCount: previous?.completionCount || 0 };
    } else {
      if (body.action === 'publish' && body.reviewed !== true) throw fail('請先預覽並確認題目與設定');
      if (!previous.teacherManaged || !previous.questions?.length) throw fail('請先儲存教師洞天內容');
      if (body.action === 'publish' && previous.visibility === 'class') {
        const room = (await a.collection('classrooms').doc(previous.classId).get()).data();
        if (!room || room.status !== 'active' || !fresh.admin && room.ownerUid !== uid) throw fail('班級指派已變更，請重新設定開放範圍', 403);
      }
      next = { ...previous, version, status: body.action === 'publish' ? 'active' : 'draft', updatedAtMs: now() };
      if (body.action === 'publish') Object.assign(next, { moderationStatus: 'teacher-reviewed', activeReportId: null, flaggedQuestionId: null, flaggedQuestionIndex: null, flaggedReason: null });
    }
    next.playCount = Number(indexSnap.data()?.playCount ?? previous?.playCount) || 0;
    next.completionCount = Number(indexSnap.data()?.completionCount ?? previous?.completionCount) || 0;
    const { questions, ...index } = next;
    tx.set(caveRef, next); tx.set(indexRef, index);
    return { cave: next };
  });
}
function register(app, { resolveA = () => playerRepository.resolve(), resolveBD = () => dongtianRepository.resolve(), logger = console } = {}) {
  app.post('/api/dongtian/teacher-report', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { uid, a } = await verifyRequest(req, resolveA), bd = resolveBD().db;
      const caveId = id(req.body?.id), questionId = id(req.body?.questionId), reason = text(req.body?.reason, 1200, '回報原因');
      if (reason.length < 4) throw fail('請具體描述題目問題');
      const reportId = createHash('sha256').update(uid + ':' + caveId + ':' + questionId).digest('hex');
      const reportRef = bd.collection('dongtianReports').doc(reportId);
      const result = await bd.runTransaction(async tx => {
        const [c, old] = await Promise.all([tx.get(bd.collection('dongtians').doc(caveId)), tx.get(reportRef)]), cave = c.data();
        if (!cave?.teacherManaged || cave.status !== 'active') throw fail('此洞天目前無法回報', 409);
        await assertEntry(cave, uid, a.db);
        const questionIndex = cave.questions.findIndex(q => q.id === questionId);
        if (questionIndex < 0) throw fail('題目版本已變更，請重新進入', 409);
        if (!old.exists) tx.create(reportRef, { teacherManaged: true, dongtianId: caveId, ownerUid: cave.ownerUid, reporterUid: uid,
          questionId, questionIndex, questionSnapshot: cave.questions[questionIndex], reason, status: 'teacher-pending', createdAtMs: Date.now() });
        return { reportId, duplicate: old.exists };
      });
      return res.json({ ok: true, ...result });
    } catch (error) { if (!error.status) logger.error('[Teacher Dongtian report]', error.message); return res.status(error.status || 503).json({ ok: false, error: error.status ? error.message : '題目回報暫時無法送出' }); }
  });
  app.post('/api/teacher/dongtian', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const { uid, a } = await verifyRequest(req, resolveA); return res.json({ ok: true, ...await perform(a.db, ['status', 'classes'].includes(req.body?.action) ? null : resolveBD().db, uid, req.body || {}) }); }
    catch (error) { if (!error.status) logger.error('[Teacher Dongtian]', error.message); return res.status(error.status || 503).json({ ok: false, error: error.status ? error.message : '教師洞天服務暫時無法使用，請稍後再試' }); }
  });
}
module.exports = register;
module.exports.perform = perform;
module.exports.normalize = normalize;

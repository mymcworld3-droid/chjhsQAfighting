import { getMainUser, authenticatedMainFetch } from './data/project-repository.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import './knowledge-points.js';
import { buildClassroomView, tabsForClass } from './classroom-view.js';
import { renderRosterPanel, parseRosterCSV, exportRosterCSV } from './classroom-roster.js';
import { renderClassroomEditor, renderClassroomCopy, validateClassroomDraft, parseClassroomAIQuestion, MAX_CLASSROOM_QUESTIONS } from './classroom-editor.js';
import { buildTeacherWorkspace } from './teacher-workspace.js';
import { renderLearningAnalysis } from './classroom-analysis.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = ms => ms ? new Date(ms).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '不限時間';
const localDate = ms => { const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const labels = ['A', 'B', 'C', 'D'];
const status = value => ({ draft: '草稿', published: '進行中', closed: '已結束', submitted: '已繳交', 'in-progress': '作答中' }[value] || '未開始');
const button = (action, label, attrs = '') => `<button type="button" data-action="${action}" ${attrs}>${label}</button>`;
let owner = '', epoch = 0, busy = false;
let state = { view: 'home', classes: [] };
let editorTimer = null, editorSession = 0, editorRevision = 0, editorSavedRevision = 0;
let editorWrite = Promise.resolve();

function resetOwner() {
  const next = getMainUser()?.uid || '';
  if (next !== owner) {
    owner = next; epoch++; busy = false; editorSession++; clearTimeout(editorTimer);
    state = { view: 'home', classes: [] };
    const panel = $('section-classes');
    if (panel) { panel.inert = false; panel.replaceChildren(); render(); }
  }
  return owner;
}
async function request(body, endpoint = '/api/classrooms', timeout = 20000) {
  const uid = resetOwner(), currentEpoch = epoch;
  if (!uid) throw Error('請先登入');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await authenticatedMainFetch(endpoint, { method: 'POST', body: JSON.stringify(body), signal: controller.signal });
    const payload = await response.json();
    if (getMainUser()?.uid !== uid || epoch !== currentEpoch) throw Error('登入帳號已變更');
    if (!response.ok || payload.ok === false) throw Error(payload.error || '班級服務暫時無法使用');
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw Error('連線逾時，請重新整理班級後確認資料');
    throw error;
  } finally { clearTimeout(timer); }
}
function message(value, error = false) {
  const node = $('section-classes')?.querySelector('[data-message]');
  if (node) { node.textContent = value; node.setAttribute('role', error ? 'alert' : 'status'); }
}
async function run(work) {
  resetOwner();
  if (busy) return;
  busy = true; const currentEpoch = epoch;
  const panel = $('section-classes');
  if (panel) panel.inert = true;
  panel?.querySelector('.cc-shell')?.setAttribute('aria-busy', 'true');
  message('處理中…');
  try { await work(); }
  catch (error) { if (currentEpoch === epoch) message(error.message, true); }
  finally {
    if (currentEpoch === epoch) {
      busy = false;
      if (panel) panel.inert = false;
      panel?.querySelector('.cc-shell')?.setAttribute('aria-busy', 'false');
      const node = panel?.querySelector('[data-message]');
      if (node?.textContent === '處理中…') node.textContent = '';
    }
  }
}
function field(name, label, value = '', attrs = '') {
  return `<label>${label}<input name="${name}" value="${escape(value)}" ${attrs}></label>`;
}
function homeView() {
  const admin = state.access?.isAdmin, account = state.access?.account;

  if (state.access?.isTeacher) {
    const portal = buildTeacherWorkspace(state, { escape, date, status, button });
    const adminSetup = '<section class="cc-card cc-workspace-admin-create" id="cc-admin-create">' +
      '<h4>' + (admin ? '建立班級 · 管理員' : '建立我的教室') + '</h4>' +
      '<p class="cc-muted">' + (admin ? '管理員可建立班級，再將班級指派給核准教師。' :
        '教師資格已核准，可直接建立自己管理的班級；教師稱呼以審核資料為準。') + '</p>' +
      '<form class="cc-form" data-form="create">' +
      field('name', '班級名稱', '', 'required maxlength="60"') +
      (admin ? field('teacherName', '教師稱呼', '', 'required maxlength="40"') : '') +
      button('create', '建立教室', 'class="cc-primary"') + '</form></section>';
    const join = '<details class="cc-card cc-workspace-join"><summary>以加入碼加入其他班級</summary>' +
      '<form data-form="join" class="cc-form">' +
      field('joinCode', '八碼加入碼', '', 'required maxlength="8" autocomplete="off" style="text-transform:uppercase"') +
      field('name', '老師辨識用的姓名', '', 'required maxlength="40" autocomplete="name"') +
      field('seat', '座號（選填）', '', 'maxlength="12"') +
      button('join', '加入班級', 'class="cc-primary"') + '</form></details>';
    const existing = !state.dashboard && (state.classes || []).some(c => c.role === 'teacher')
      ? '<div class="cc-grid">' + state.classes.filter(c => c.role === 'teacher').map(c =>
        '<article class="cc-card"><h4>' + escape(c.name) + '</h4>' +
        button('class', '進入教室', 'data-id="' + escape(c.id) + '"') + '</article>').join('') + '</div>' : '';
    const enrolledClasses = (state.classes || []).filter(c => c.role === 'student');
    const enrolled = enrolledClasses.length ?
      '<section class="cc-workspace-section cc-workspace-enrolled"><h3>我加入的其他班級</h3><div class="cc-grid">' +
      enrolledClasses.map(c => '<article class="cc-card"><h4>' + escape(c.name) + '</h4><p class="cc-muted">' +
        escape(c.teacherName) + '</p>' + button('class', '前往學生教室', 'data-id="' + escape(c.id) + '"') +
        '</article>').join('') + '</div></section>' : '';
    return portal + existing + enrolled + adminSetup + join;
  }
  const rooms = state.classes.map(room => `<article class="cc-card"><h4>${escape(room.name)}</h4><p class="cc-muted">${room.role === 'teacher' ? '教師' : '學生'} · ${room.studentCount} 位學生${room.status === 'archived' ? ' · 已封存' : ''}</p><p>${escape(room.teacherName)}</p>${button('class', '進入班級', `data-id="${room.id}"`)}</article>`).join('');
  const application = admin ? `<section class="cc-card"><h4>管理員建班</h4><form class="cc-form" data-form="create">
      ${field('name', '班級名稱', '', 'required maxlength="60"')}${field('teacherName', '教師稱呼', '', 'required maxlength="40"')}
      ${button('create', '建立班級', 'class="cc-primary"')}</form><p class="cc-muted">建立後可在班級設定指派已核准的教師。</p></section>`
    : `<section class="cc-card"><h4>教師帳號申請</h4>${account ? `<p class="cc-status">${({ pending: '等待管理員審核', approved: '教師資格已核准，可自行建立班級', rejected: '申請已退回，可修改後重新申請', revoked: '教師資格已撤銷' })[account.status]}</p>${account.reviewNote ? `<p>${escape(account.reviewNote)}</p>` : ''}` : '<p class="cc-muted">教師功能須先向管理員申請，由管理員審核並分配班級。</p>'}
      ${!account || ['rejected', 'revoked'].includes(account.status) ? `<form data-form="apply" class="cc-form">${field('name', '教師稱呼', account?.name || '', 'required maxlength="40"')}${field('school', '學校／任教單位', account?.school || '', 'required maxlength="80"')}<label>申請說明<textarea name="reason" required maxlength="600">${escape(account?.reason || '')}</textarea></label>${button('apply-teacher', '送出教師申請', 'class="cc-primary"')}</form>` : ''}</section>`;
  return `<div class="cc-toolbar"><h3>${admin ? '班級管理' : '我的班級'}</h3><div class="cc-actions">${admin ? button('teacher-accounts', '教師帳號審核') : ''}${button('refresh', '重新整理')}</div></div>
    ${rooms ? `<div class="cc-grid">${rooms}</div>` : '<p class="cc-muted">目前沒有可管理或已加入的班級。</p>'}${state.nextCursor ? button('more-classes', '載入更多班級') : ''}
    <div class="cc-grid"><section class="cc-card"><h4>加入班級</h4><form class="cc-form" data-form="join">
      ${field('joinCode', '八碼加入碼', '', 'required maxlength="8" autocomplete="off" style="text-transform:uppercase"')}
      ${field('name', '老師辨識用的姓名', '', 'required maxlength="40" autocomplete="name"')}
      ${field('seat', '座號（選填）', '', 'maxlength="12"')}${button('join', '加入班級', 'class="cc-primary"')}</form></section>
    ${application}</div>`;
}
function accountsView() {
  const review = state.accountReview;
  return `<div class="cc-toolbar"><h3>教師帳號審核</h3><div class="cc-actions">${button('home', '返回班級')}${button('refresh', '重新整理')}</div></div><div class="cc-actions" style="margin-bottom:14px">${[['pending', '待審核'], ['approved', '已核准'], ['rejected', '已退回'], ['revoked', '已撤銷']].map(([value, title]) => button('account-filter', title, `data-status="${value}" aria-pressed="${review.status === value}"`)).join('')}</div>
    ${review.accounts.map(a => `<article class="cc-card"><h4>${escape(a.name)}</h4><p>${escape(a.school)}</p><p class="cc-muted">帳號：${escape(a.uid)} · 申請：${date(a.requestedAtMs)}</p><p style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(a.reason)}</p>${a.reviewNote ? `<p class="cc-muted">審核備註：${escape(a.reviewNote)}</p>` : ''}${['pending', 'approved'].includes(a.status) ? `<label>審核備註（選填）<input name="reviewNote" maxlength="300"></label><div class="cc-actions" style="margin-top:10px">${(a.status === 'pending' ? [['approve', '核准教師'], ['reject', '退回申請']] : [['revoke', '撤銷教師資格']]).map(([decision, title]) => button('review-teacher', title, `data-uid="${escape(a.uid)}" data-version="${a.version}" data-decision="${decision}"`)).join('')}</div>` : ''}</article>`).join('') || '<p class="cc-muted">目前沒有符合此狀態的教師帳號。</p>'}${review.nextCursor ? button('more-accounts', '載入更多帳號') : ''}`;
}
function classView() {
  return buildClassroomView(state, { escape, date, status, button, currentUid: getMainUser()?.uid || '',
    rosterPanel: (data, helpers) => renderRosterPanel(data, helpers) });
}

const blankQuestion = () => ({ question: '', options: ['', '', '', ''], answerIndex: 0, explanation: '', knowledge_points: [] });

function beginEditor(editor) {
  editorSession++;
  clearTimeout(editorTimer);
  state.editor = { ...editor, questions: editor.questions.map(q => ({
    ...q, options: [...q.options], knowledge_points: [...(q.knowledge_points || [])]
  })) };
  state.editorIndex = 0;
  state.editorSaveLabel = editor.id ? '已載入伺服器草稿' : '尚未建立草稿';
  editorRevision = 0;
  editorSavedRevision = editor.id ? 0 : -1;
  state.view = 'editor';
  render();
}
function captureEditor() {
  const form = $('cc-editor');
  if (!form || state.view !== 'editor') return;
  const values = new FormData(form);
  const index = state.editorIndex || 0;
  const old = state.editor.questions[index];
  if (!old) return;
  const pointId = values.get('point-' + index);
  const group = window.QAKnowledgePoints.SUBJECTS.find(s => s.points.some(p => p.id === pointId));
  const point = group?.points.find(p => p.id === pointId);
  const q = {
    ...old, question: String(values.get('question-' + index) ?? ''),
    options: labels.map((_, n) => String(values.get('option-' + index + '-' + n) ?? '')),
    answerIndex: Number(values.get('answer-' + index)),
    explanation: String(values.get('explanation-' + index) ?? ''),
    knowledge_points: point ? [{ subject: group.name, ...point }] : []
  };
  const questions = state.editor.questions.slice();
  questions[index] = q;
  state.editor = { ...state.editor,
    title: String(values.get('title') ?? ''), subject: String(values.get('subject') ?? ''),
    dueLocal: String(values.get('dueLocal') ?? ''), topic: String(values.get('topic') ?? ''),
    level: String(values.get('level') ?? ''), questions
  };
}
function editorView() {
  return renderClassroomEditor(state, { escape, button, field,
    subjectNames: window.QAKnowledgePoints.SUBJECT_NAMES,
    subjects: window.QAKnowledgePoints.SUBJECTS });
}
function copyView() { return renderClassroomCopy(state, { escape, button }); }

function questionView(q, i, extras = '') {
  return `<article class="cc-card"><h4>第 ${i + 1} 題</h4><div class="cc-question">${escape(q.question)}</div><div class="cc-options">${q.options.map((o, n) => `<div ${n === q.answerIndex ? 'class="cc-status"' : ''}>${labels[n]}. ${escape(o)}${n === q.answerIndex ? ' ✓' : ''}</div>`).join('')}</div>${extras}${q.explanation ? `<div class="cc-explanation">${escape(q.explanation)}</div>` : ''}</article>`;
}
function previewView() {
  const a = state.assignment;
  return `<div class="cc-toolbar"><div><h3>${escape(a.title)}</h3><span class="cc-muted">${status(a.status)} · 截止：${date(a.dueAtMs)}</span></div>${button('back', '返回班級')}</div>${a.questions.map((q, i) => questionView(q, i)).join('')}
    ${a.status === 'draft' ? `<div class="cc-card cc-form"><label class="cc-inline"><input id="cc-reviewed" type="checkbox">我已確認題目、答案與截止時間</label>${button('publish', '發布給全班', 'class="cc-primary"')}</div>` : ''}`;
}
function workView() {
  const a = state.assignment, s = state.submission, answers = s?.answers || a.questions.map(() => null);
  const submitted = s?.status === 'submitted';
  if (submitted) {
    const corrected = (s.corrections || []).filter(c => c.correct && answers[a.questions.findIndex(q => q.id === c.questionId)] !== a.questions.find(q => q.id === c.questionId)?.answerIndex).length;
    return `<div class="cc-toolbar"><h3>${escape(a.title)}</h3>${button('back', '返回班級')}</div><section class="cc-card"><span class="cc-muted">首次作答成績</span><div class="cc-stat">${s.score} 分</div><p>答對 ${s.correctCount} / ${s.total} 題 · 已訂正 ${corrected} / ${s.total - s.correctCount} 題</p><p class="cc-muted">首次成績保留，訂正進度另外記錄。</p></section>${a.questions.map((q, i) => {
      const wrong = answers[i] !== q.answerIndex, correction = s.corrections?.find(c => c.questionId === q.id);
      const extra = `<p class="cc-muted">首次選擇：${labels[answers[i]]} · 正確答案：${labels[q.answerIndex]}${wrong ? '' : ' · 答對'}</p>` + (wrong ? `<p class="cc-status">${correction?.correct ? '已完成訂正' : correction ? '再試一次，請依解析重新選擇。' : '請重新選擇答案，完成訂正。'}</p><div class="cc-options">${q.options.map((o, n) => button('correct', `${labels[n]}. ${escape(o)}`, `data-index="${i}" data-option="${n}" ${correction?.correct ? 'disabled' : ''}`)).join('')}</div>` : '');
      return questionView(q, i, extra);
    }).join('')}`;
  }
  const i = state.questionIndex || 0, q = a.questions[i], done = answers.filter(n => n !== null).length;
  const closed = state.classroom.status !== 'active' || a.status !== 'published' || a.dueAtMs && Date.now() > a.dueAtMs;
  return `<div class="cc-toolbar"><h3>${escape(a.title)}</h3>${button('back', '返回班級')}</div><p class="cc-muted">已完成 ${done} / ${a.questions.length} 題 · 截止：${date(a.dueAtMs)}</p><progress max="${a.questions.length}" value="${done}"></progress>${closed ? '<p role="status">作業已截止，目前只能查看已保存的作答。</p>' : ''}
    <section class="cc-card"><h4>第 ${i + 1} / ${a.questions.length} 題</h4><div class="cc-question">${escape(q.question)}</div><div class="cc-options">${q.options.map((o, n) => button('answer', `${labels[n]}. ${escape(o)}`, `data-option="${n}" aria-pressed="${answers[i] === n}" ${closed ? 'disabled' : ''}`)).join('')}</div><div class="cc-toolbar">${button('previous-question', '上一題', i === 0 ? 'disabled' : '')}${i < a.questions.length - 1 ? button('next-question', '下一題') : button('submit', '繳交作業', `class="cc-primary" ${done !== a.questions.length || closed ? 'disabled' : ''}`)}</div></section>`;
}
function learningView() {
  return renderLearningAnalysis(state, { escape, button, date, status });
}
function overviewView() {
  const o = state.overview;
  return `<div class="cc-toolbar"><div><h3>${escape(o.className)} · 學習總覽</h3><p class="cc-muted">${escape(o.scope)}</p></div><div class="cc-actions">${button('back', '返回班級')}${button('refresh', '重新整理')}</div></div>
    <div class="cc-grid"><section class="cc-card"><span class="cc-muted">目前學生</span><div class="cc-stat">${o.studentCount}</div></section><section class="cc-card"><span class="cc-muted">近期已發布作業</span><div class="cc-stat">${o.assignmentCount}</div></section></div>
    <section class="cc-card cc-table-wrap"><h4>近期作業狀態</h4><table><thead><tr><th>作業</th><th>已繳交</th><th>作答中</th><th>未開始</th><th>首次平均</th><th>操作</th></tr></thead><tbody>${o.assignments.map(a => `<tr><td>${escape(a.title)}<div class="cc-muted">截止：${date(a.dueAtMs)}</div></td><td>${a.submitted}</td><td>${a.inProgress}</td><td>${a.notStarted}</td><td>${a.average === null ? '—' : a.average + ' 分'}</td><td>${button('report', '成績', `data-id="${a.id}"`)}</td></tr>`).join('') || '<tr><td colspan="6">尚無已發布作業</td></tr>'}</tbody></table></section>
    <section class="cc-card cc-table-wrap"><h4>學生繳交概況</h4><table><thead><tr><th>座號</th><th>姓名</th><th>已繳交</th><th>作答中</th><th>未開始</th><th>首次平均</th></tr></thead><tbody>${o.students.map(s => `<tr><td>${escape(s.seat || '—')}</td><td>${escape(s.name)}</td><td>${s.submitted}</td><td>${s.inProgress}</td><td>${s.notStarted}</td><td>${s.average === null ? '—' : s.average + ' 分'}</td></tr>`).join('') || '<tr><td colspan="6">尚無學生</td></tr>'}</tbody></table><p class="cc-muted">未繳交不計零分；平均只計首次已繳交成績。</p></section>`;
}
function reportView() {
  const r = state.report;
  return `<div class="cc-toolbar"><div><h3>${escape(r.assignment.title)}</h3><span class="cc-muted">${status(r.assignment.status)} · 截止：${date(r.assignment.dueAtMs)}</span></div><div class="cc-actions">${button('back', '返回班級')}${button('refresh', '重新整理')}${button('export', '匯出成績')}${r.assignment.status === 'published' ? button('close-assignment', '結束收件') : ''}</div></div>
    <section class="cc-card cc-form"><h4>收件與截止管理</h4><p class="cc-muted">可延長截止時間或取消截止限制；已繳交學生的首次成績不變。已結束作業須明確重新開放。</p>
      <form class="cc-form" data-form="deadline">${field('dueAtMs', '截止時間（留空表示不限時間）', r.assignment.dueAtMs ? localDate(r.assignment.dueAtMs) : '', 'type="datetime-local"')}<div class="cc-actions">${button('update-deadline', '更新截止時間')}${r.assignment.status === 'closed' ? button('reopen-assignment', '重新開放收件', 'class="cc-primary"') : ''}</div></form></section>
    <div class="cc-grid"><section class="cc-card"><span class="cc-muted">繳交人數</span><div class="cc-stat">${r.totals.submitted} / ${r.totals.students}</div></section><section class="cc-card"><span class="cc-muted">已繳交學生的首次平均</span><div class="cc-stat">${r.totals.average === null ? '—' : r.totals.average + ' 分'}</div></section></div>
    <section class="cc-card cc-table-wrap"><table><thead><tr><th>座號</th><th>姓名</th><th>狀態</th><th>首次成績</th><th>錯題訂正</th></tr></thead><tbody>${r.students.map(s => `<tr><td>${escape(s.seat || '—')}</td><td>${escape(s.name)}${s.active ? '' : '（已退出）'}</td><td>${status(s.status)}</td><td>${s.score === null ? '—' : s.score}</td><td>${s.wrongCount === null ? '—' : s.correctedCount + ' / ' + s.wrongCount}</td></tr>`).join('') || '<tr><td colspan="5">尚無學生</td></tr>'}</tbody></table></section>
    <section class="cc-card"><h4>各題首次作答</h4>${r.questions.map((q, i) => `<details><summary>第 ${i + 1} 題 · ${q.total ? Math.round(q.correct / q.total * 100) + '%' : '尚無作答'}（${q.correct} / ${q.total}）</summary><div class="cc-question">${escape(q.question)}</div><p class="cc-muted">${q.knowledge_points.map(p => escape(p.name)).join('、') || '未標記知識點'}</p></details>`).join('')}</section>
    ${r.knowledgePoints?.length ? `<section class="cc-card"><h4>本次作業的知識點表現</h4>${r.knowledgePoints.map(p => `<p>${escape(p.subject)} · ${escape(p.name)}：${p.total ? Math.round(p.correct / p.total * 100) + '%' : '尚無作答'}（${p.correct} / ${p.total}）</p>`).join('')}<p class="cc-muted">依本次固定題組統計，樣本少時請搭配實際作答判讀。</p></section>` : ''}`;
}
function filterClassroomList(panel, type) {
  const input = panel?.querySelector('input[data-cc-search="' + type + '"]');
  const items = [...(panel?.querySelectorAll('[data-cc-item="' + type + '"]') || [])];
  if (!items.length) return;
  const query = (input?.value || '').trim().toLocaleLowerCase('zh-Hant');
  let visible = 0;
  for (const item of items) {
    const matches = (item.dataset.ccSearch || '').toLocaleLowerCase('zh-Hant').includes(query);
    const filter = state.assignmentFilter || 'all';
    const matchesStatus = type !== 'assignment' || filter === 'all' || item.dataset.ccFilter === filter;
    item.hidden = !(matches && matchesStatus);
    if (!item.hidden) visible++;
  }
  const empty = panel.querySelector('[data-cc-empty="' + type + '"]');
  if (empty) empty.hidden = visible > 0;
}
function filterWorkspaceTasks(panel) {
  const input = panel.querySelector('input[data-workspace-search-input]');
  const rows = [...panel.querySelectorAll('[data-workspace-task]')];
  if (!rows.length) return;
  const query = (input?.value || '').trim().toLocaleLowerCase('zh-Hant');
  const filter = state.workspaceFilter || 'all';
  let visible = 0;
  for (const row of rows) {
    const matches = (row.dataset.workspaceSearch || '').toLocaleLowerCase('zh-Hant').includes(query);
    const matchesStatus = filter === 'all' || (filter === 'published' ?
      row.dataset.workspaceStatus === 'published' : row.dataset.workspaceFilter === filter);
    row.hidden = !(matches && matchesStatus);
    if (!row.hidden) visible++;
  }
  const empty = panel.querySelector('[data-workspace-empty]');
  if (empty) empty.hidden = visible > 0;
}
function render() {
  const panel = $('section-classes'); if (!panel) return;
  const views = { home: homeView, accounts: accountsView, class: classView, overview: overviewView, learning: learningView, editor: editorView, copy: copyView, preview: previewView, work: workView, report: reportView };
  window.quizMathClear?.(panel);
  panel.innerHTML = `<div class="cc-shell"><div data-message role="status" aria-live="polite"></div>${views[state.view]()}</div>`;
  filterClassroomList(panel, 'assignment');
  filterClassroomList(panel, 'student');
  filterWorkspaceTasks(panel);
  void window.quizMathTypeset?.([panel]);
}
async function loadHome(more = false) {
  const data = await request({ action: 'list', ...(more ? { cursor: state.nextCursor } : {}) });
  state = { ...state, ...data, view: 'home',
    classes: more ? [...state.classes, ...data.classes] : data.classes,
    dashboard: null, workspaceProgress: {}, workspaceError: '', workspaceLoading: data.access?.isTeacher === true };
  render();
  window.dispatchEvent(new CustomEvent('xiuxian:teacher-access'));
  if (data.access?.isTeacher) {
    try {
      const result = await request({ action: 'teacherDashboard' });
      state.dashboard = result.dashboard;
    } catch (error) {
      state.workspaceError = error.message;
    } finally {
      state.workspaceLoading = false;
    }
    render();
  }
}
async function loadAccounts(status = state.accountReview?.status || 'pending', more = false) {
  const data = await request({ action: 'teacherAccounts', status, ...(more ? { cursor: state.accountReview.nextCursor } : {}) });
  state.accountReview = { ...data, status, accounts: more ? [...state.accountReview.accounts, ...data.accounts] : data.accounts }; state.view = 'accounts'; render();
}
async function loadClass(classId = state.classroom?.id) {
  const changedClass = state.classroom?.id !== classId;
  const data = await request({ action: 'classDetail', classId });
  const approved = data.access?.isAdmin ? await request({ action: 'teacherAccounts', status: 'approved' }) : null;
  state = { ...state, ...data, approvedTeachers: approved?.accounts || [], nextApprovedCursor: approved?.nextCursor,
    view: 'class', classTab: changedClass ? 'summary' : (state.classTab || 'summary'),
    assignmentFilter: changedClass ? 'all' : (state.assignmentFilter || 'all'),
    assignmentSearch: changedClass ? '' : (state.assignmentSearch || ''),
    studentSearch: changedClass ? '' : (state.studentSearch || ''),
    studentSort: changedClass ? 'seat' : (state.studentSort || 'seat'),
    rosterSelected: [], editStudentUid: null, rosterPreview: null, rosterCsvText: '',
    overview: changedClass ? null : state.overview,
    learning: changedClass ? null : state.learning };
  render();
}
async function loadAssignment(assignmentId, view) {
  const data = await request({ action: 'getAssignment', classId: state.classroom.id, assignmentId });
  state = { ...state, ...data, view, questionIndex: 0 }; render();
}
async function loadOverview() {
  const data = await request({ action: 'overview', classId: state.classroom.id });
  state.overview = data.overview; state.view = 'overview'; render();
}

async function loadLearningAnalysis({ studentUid = null, more = false, returnTab = null } = {}) {
  const classId = state.classroom.id;
  const old = more ? state.learning : null;
  if (more && !old?.nextCursor) return;
  const result = await request({
    action: studentUid ? 'studentLearningPage' : 'learningAnalysisPage',
    classId, ...(studentUid ? { studentUid } : {}),
    ...(more ? { cursor: old.nextCursor } : {})
  }, '/api/classrooms', 30000);
  const data = result.analysis;
  if (state.classroom?.id !== classId) return;
  const previous = more ? old.rows : [];
  const seen = new Set(previous.map(r => r.id));
  const rows = [...previous, ...data.rows.filter(row => !seen.has(row.id))];
  state.learning = { ...data, rows, scanned: (more ? old.scanned : 0) + data.scanned };
  state.learningStudentUid = studentUid;
  if (!more) {
    state.learningSubject = 'all';
    state.learningReturnTab = returnTab || state.classTab || 'grades';
  }
  state.view = 'learning';
  render();
}

async function loadReport(assignmentId = state.report?.assignment.id) {
  const data = await request({ action: 'report', classId: state.classroom.id, assignmentId }); state.report = data.report; state.view = 'report'; render();
}

function setEditorSaveLabel(label) {
  state.editorSaveLabel = label;
  const node = $('cc-editor-save-status');
  if (node) node.textContent = label;
}
function scheduleEditorAutosave() {
  clearTimeout(editorTimer);
  if (state.view !== 'editor') return;
  if (validateClassroomDraft(state.editor)) return;
  editorTimer = setTimeout(() => {
    if (state.view === 'editor') void persistEditorDraft(false, true).catch(() => {});
  }, 2600);
}
function touchEditor() {
  editorRevision++;
  setEditorSaveLabel('有修改尚未儲存');
  scheduleEditorAutosave();
}
async function persistEditorDraft(preview = false, silent = false) {
  clearTimeout(editorTimer);
  if (state.view !== 'editor') return;
  if (!silent && !$('cc-editor')?.reportValidity()) return;
  captureEditor();
  const session = editorSession;
  const save = editorWrite.then(async () => {
    if (session !== editorSession || state.view !== 'editor') return;
    captureEditor();
    const e = state.editor;
    const invalid = validateClassroomDraft(e);
    if (invalid) {
      if (silent) { setEditorSaveLabel('部分題目尚未填妥，完成後會自動儲存'); return; }
      throw Error(invalid);
    }
    const revision = editorRevision;
    setEditorSaveLabel(silent ? '正在自動儲存…' : '正在儲存草稿…');
    try {
      const data = await request({
        action: 'saveAssignment', classId: state.classroom.id, assignmentId: e.id,
        version: e.version, title: e.title, subject: e.subject,
        dueAtMs: e.dueLocal ? new Date(e.dueLocal).getTime() : null,
        questions: e.questions.map(q => ({
          question: q.question, options: [...q.options], answerIndex: q.answerIndex,
          explanation: q.explanation, knowledge_points: [...(q.knowledge_points || [])]
        }))
      });
      if (session !== editorSession || state.view !== 'editor') return;
      // Never replace in-memory questions: teacher may have continued typing during the request.
      state.editor = { ...state.editor, id: data.assignment.id, version: data.assignment.version };
      state.assignment = data.assignment;
      if (editorRevision === revision) {
        editorSavedRevision = revision;
        setEditorSaveLabel(silent ? '已自動儲存至伺服器' : '草稿已儲存');
      } else {
        setEditorSaveLabel('儲存期間有新修改，等待下一次儲存');
        scheduleEditorAutosave();
      }
      if (preview) {
        if (editorRevision !== revision) throw Error('請等待最新修改儲存完成後再預覽。');
        clearTimeout(editorTimer);
        state.view = 'preview';
        editorSession++;
        render();
      } else if (!silent) {
        message('草稿已儲存。');
      }
    } catch (error) {
      if (session === editorSession && state.view === 'editor') {
        setEditorSaveLabel('儲存未成功：' + error.message);
      }
      throw error;
    }
  });
  editorWrite = save.catch(() => {});
  return save;
}
async function generateQuestions(count = 1) {
  captureEditor();
  const e = state.editor;
  if (e.subject === '綜合' || !e.topic?.trim()) throw Error('請先選擇科目並填寫出題範圍。');
  const isBlank = q => !q.question?.trim() && q.options.every(o => !String(o || '').trim());
  const replacement = e.questions.length === 1 && isBlank(e.questions[0]);
  const slots = MAX_CLASSROOM_QUESTIONS - e.questions.length + (replacement ? 1 : 0);
  if (slots < 1) throw Error('每份作業最多 30 題。');
  const wanted = Math.min(Math.max(1, Number(count) || 1), 10, slots);
  const existing = new Set(e.questions.filter(q => q.question?.trim())
    .map(q => q.question.trim().replace(/\s+/g, '').toLowerCase()));
  let finished = 0, accepted = 0;
  const failures = [];
  const update = () => {
    const node = $('cc-ai-batch-status');
    if (node) node.textContent = '已完成 ' + finished + ' / ' + wanted + ' 次生成，新增 ' + accepted +
      ' 題，略過 ' + failures.length + ' 題。';
  };
  // One generation API request must produce exactly one question. Keep requests sequential
  // so each next request can avoid all previously accepted questions.
  while (finished < wanted) {
    const avoidQuestions = e.questions.filter(q => q.question?.trim())
      .map(q => q.question.trim().slice(0, 500)).slice(-20);
    try {
      const result = await request({ subject: e.subject, level: e.level, specificTopic: e.topic,
        difficulty: 'medium', quizMode: 'classroom-draft', questionCount: 1,
        avoidQuestions }, '/api/generate-quiz', 60000);
      const q = parseClassroomAIQuestion(result, e.subject, window.QAKnowledgePoints.labels);
      const key = q.question.replace(/\s+/g, '').toLowerCase();
      if (existing.has(key)) throw Error('題目重複');
      existing.add(key);
      if (replacement && accepted === 0) e.questions[0] = q;
      else e.questions.push(q);
      state.editorIndex = e.questions.length - 1;
      accepted++;
    } catch (error) { failures.push(error.message || '產生失敗'); }
    finally { finished++; update(); }
  }
  if (!accepted) throw Error('本次 AI 未產生可用的新題目。' + (failures[0] ? '原因：' + failures[0] : ''));
  touchEditor();
  render();
  message('已加入 ' + accepted + ' 題 AI 草稿' +
    (failures.length ? '；另有 ' + failures.length + ' 次產生失敗或重複，已略過。' : '。') +
    '請逐題核對題意、正解與解析。');
}


async function openAssignmentCopy(sourceClassId, sourceAssignmentId) {
  if (!state.classroom || state.classroom.id !== sourceClassId) await loadClass(sourceClassId);
  if (state.classroom.role !== 'teacher') throw Error('只能重用自己有管理權限的班級作業。');
  const [source, list] = await Promise.all([
    request({ action: 'getAssignment', classId: sourceClassId, assignmentId: sourceAssignmentId }),
    request({ action: 'teacherDashboard' })
  ]);
  const rooms = list.dashboard.classes;
  if (!rooms.some(room => room.id === state.classroom.id)) {
    rooms.push({ ...state.classroom, assignments: undefined });
  }
  clearTimeout(editorTimer);
  editorSession++;
  state.copySource = { ...source.assignment, classId: sourceClassId };
  state.copyTargets = rooms;
  state.copyCursor = list.dashboard.nextCursor;
  state.copyResults = null;
  state.copySelected = [];
  state.copyTitle = '';
  state.view = 'copy';
  render();
}
async function copyAssignmentToClasses() {
  const form = $('cc-copy');
  if (!form?.reportValidity()) return;
  const ids = [...form.querySelectorAll('input[name="targetClass"]:checked')].map(input => input.value);
  if (!ids.length) throw Error('請至少選擇一個要建立草稿的教室。');
  const title = String(new FormData(form).get('title') || '').trim();
  const copy = state.copySource;
  const success = [], failures = [];
  for (const classId of ids) {
    const room = state.copyTargets.find(r => r.id === classId);
    if (!room || room.status !== 'active') {
      failures.push({ classId, className: room?.name || classId, message: '教室已封存或不在可管理名單中' });
      continue;
    }
    try {
      const result = await request({ action: 'copyAssignment',
        classId, sourceClassId: copy.classId, sourceAssignmentId: copy.id, ...(title ? { title } : {}) });
      success.push({ classId, className: room.name, id: result.assignment.id });
    } catch (error) {
      failures.push({ classId, className: room.name, message: error.message });
    }
  }
  state.copyResults = { success, failures };
  render();
  message('成功建立 ' + success.length + ' 份草稿，失敗 ' + failures.length + ' 份。每份草稿都需要預覽確認後才會發布。', !!failures.length);
}

function validForm(name) {
  const form = $('section-classes').querySelector(`[data-form="${name}"]`);
  return form?.reportValidity() ? Object.fromEntries(new FormData(form)) : null;
}
async function act(target) {
  const action = target.dataset.action, classId = state.classroom?.id;
  if (action === 'workspace-copy') return openAssignmentCopy(target.dataset.classId, target.dataset.id);
  if (action === 'workspace-tab') {
    state.workspaceTab = target.dataset.tab;
    render();
    $('section-classes')?.querySelector('.cc-workspace-tabs [aria-selected="true"]')?.focus({ preventScroll: true });
    return;
  }
  if (action === 'workspace-refresh') return loadHome();
  if (action === 'workspace-more') {
    if (!state.dashboard?.nextCursor) return;
    const data = await request({ action: 'teacherDashboard', cursor: state.dashboard.nextCursor });
    const current = new Map(state.dashboard.classes.map(c => [c.id, c]));
    for (const room of data.dashboard.classes) current.set(room.id, room);
    state.dashboard = { ...data.dashboard, classes: [...current.values()] };
    render(); return;
  }
  if (action === 'workspace-filter') { state.workspaceFilter = target.dataset.filter; render(); return; }
  if (action === 'workspace-create') {
    if (!state.access?.isTeacher) return;
    const input = $('cc-admin-create')?.querySelector('input[name="name"]');
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' }); input?.focus({ preventScroll: true }); return;
  }
  if (action === 'workspace-cave') {
    if (!window.QATeacherDongtian?.open) throw Error('教師洞天尚未載入，請重新開啟遊戲後再試。');
    await window.QATeacherDongtian.open(); return;
  }
  if (['workspace-class', 'workspace-grades', 'workspace-analysis', 'workspace-new', 'workspace-edit', 'workspace-preview', 'workspace-report'].includes(action)) {
    const targetClassId = target.dataset.classId || target.dataset.id;
    await loadClass(targetClassId);
    if (state.classroom?.role !== 'teacher') throw Error('已失去此班級的管理權限');
    if (action === 'workspace-class') return;
    if (action === 'workspace-grades') { state.classTab = 'grades'; render(); return; }
    if (action === 'workspace-analysis') return loadLearningAnalysis({ returnTab: 'grades' });
    if (action === 'workspace-new') {
      if (state.classroom.status !== 'active') throw Error('此班級已封存，請先恢復');
      beginEditor({ title: '', subject: '數學', topic: '', level: '國中一年級', questions: [blankQuestion()] }); return;
    }
    if (action === 'workspace-report') return loadReport(target.dataset.id);
    if (action === 'workspace-preview') return loadAssignment(target.dataset.id, 'preview');
    if (action === 'workspace-edit') {
      const data = await request({ action: 'getAssignment', classId: state.classroom.id, assignmentId: target.dataset.id });
      if (data.assignment.status !== 'draft') throw Error('目前只能編輯草稿');
      beginEditor({ ...data.assignment, dueLocal: data.assignment.dueAtMs ? localDate(data.assignment.dueAtMs) : '' }); return;
    }
  }
  if (action === 'workspace-progress') {
    const classId = target.dataset.classId, assignmentId = target.dataset.id;
    const result = await request({ action: 'teacherAssignmentProgress', classId, assignmentId });
    state.workspaceProgress = { ...(state.workspaceProgress || {}),
      [classId + ':' + assignmentId]: result.progress };
    render(); return;
  }
  if (action === 'home') return loadHome();
  if (action === 'more-classes') return loadHome(true);
  if (action === 'teacher-accounts' || action === 'account-filter') return loadAccounts(target.dataset.status || 'pending');
  if (action === 'more-accounts') return loadAccounts(state.accountReview.status, true);
  if (action === 'apply-teacher') {
    const values = validForm('apply'); if (!values) return;
    await request({ action: 'applyTeacher', ...values }); await loadHome(); message('教師申請已送出，請等候管理員審核。'); return;
  }
  if (action === 'review-teacher') {
    if (!window.confirm('確定' + ({ approve: '核准此教師帳號', reject: '退回此申請', revoke: '撤銷此教師資格' })[target.dataset.decision] + '？')) return;
    await request({ action: 'reviewTeacher', teacherUid: target.dataset.uid, version: Number(target.dataset.version), decision: target.dataset.decision, reviewNote: target.closest('article').querySelector('[name=reviewNote]').value }); return loadAccounts();
  }
  if (action === 'more-approved') {
    const data = await request({ action: 'teacherAccounts', status: 'approved', cursor: state.nextApprovedCursor }); state.approvedTeachers.push(...data.accounts); state.nextApprovedCursor = data.nextCursor; return render();
  }
  if (action === 'assign-teacher') {
    const values = validForm('assign'); if (!values) return;
    if (!window.confirm('確定變更班級教師？原教師將失去此班級的管理權限。')) return;
    await request({ action: 'assignTeacher', classId, expectedOwnerUid: state.classroom.ownerUid, ...values }); return loadClass();
  }
  if (action === 'copy-assignment') return openAssignmentCopy(classId, target.dataset.id);
  if (action === 'copy-more-classes') {
    if (!state.copyCursor) return;
    const data = await request({ action: 'teacherDashboard', cursor: state.copyCursor });
    const merged = new Map(state.copyTargets.map(room => [room.id, room]));
    for (const room of data.dashboard.classes) merged.set(room.id, room);
    state.copyTargets = [...merged.values()];
    state.copyCursor = data.dashboard.nextCursor;
    render(); return;
  }
  if (action === 'copy-confirm') return copyAssignmentToClasses();
  if (action === 'copy-open') {
    await loadClass(target.dataset.classId);
    const data = await request({ action: 'getAssignment', classId: state.classroom.id, assignmentId: target.dataset.id });
    beginEditor({ ...data.assignment, dueLocal: data.assignment.dueAtMs ? localDate(data.assignment.dueAtMs) : '' });
    return;
  }
  if (action === 'class') return loadClass(target.dataset.id);
  if (action === 'class-tab') {
    if (!tabsForClass(state.classroom?.role === 'teacher').some(([id]) => id === target.dataset.tab)) return;
    state.classTab = target.dataset.tab;
    render();
    $('section-classes')?.querySelector('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
    if ($('section-classes')) $('section-classes').scrollTop = 0;
    return;
  }
  if (action === 'assignment-filter') { state.assignmentFilter = target.dataset.filter; render(); return; }

  if (action === 'learning-analysis') return loadLearningAnalysis({ returnTab: 'grades' });
  if (action === 'roster-history') {
    if (!state.classroom?.members?.some(m => m.uid === target.dataset.studentUid)) throw Error('學生已不在此班級。');
    return loadLearningAnalysis({ studentUid: target.dataset.studentUid, returnTab: 'students' });
  }
  if (action === 'learning-more') return loadLearningAnalysis({
    studentUid: state.learningStudentUid || null, more: true
  });
  if (action === 'learning-refresh') return loadLearningAnalysis({
    studentUid: state.learningStudentUid || null, returnTab: state.learningReturnTab || 'grades'
  });
  if (action === 'learning-back') {
    state.classTab = state.learningReturnTab || 'grades';
    state.view = 'class'; render(); return;
  }
  if (action === 'learning-students') {
    state.classTab = 'students';
    state.view = 'class'; render(); return;
  }
  if (action === 'learning-subject') {
    const subject = target.dataset.subject || 'all';
    const available = ['all', ...(state.learning?.rows || []).map(row => row.subject)];
    if (!available.includes(subject)) return;
    state.learningSubject = subject; render(); return;
  }
  if (action === 'learning-remediate') {
    if (state.classroom?.status !== 'active' || state.classroom?.role !== 'teacher') throw Error('此班級目前不可建立補強草稿。');
    const group = window.QAKnowledgePoints.SUBJECTS.find(s => s.name === target.dataset.subject);
    const point = group?.points.find(p => p.id === target.dataset.pointId);
    if (!point) throw Error('找不到對應知識點，請重新選擇。');
    const title = ('補強練習 · ' + point.name).slice(0, 80);
    beginEditor({ title, subject: group.name, topic: point.name, level: '國中一年級',
      questions: [{ ...blankQuestion(), knowledge_points: [{ subject: group.name, ...point }] }] });
    message('已建立「' + title + '」的編輯草稿，請依學生程度選擇年級、生成或編輯題目後再預覽發布。');
    return;
  }
  if (action === 'overview') return loadOverview();
  if (action === 'refresh') return state.view === 'home' ? loadHome() : state.view === 'accounts' ? loadAccounts() : state.view === 'report' ? loadReport() : state.view === 'learning' ? loadLearningAnalysis({ studentUid: state.learningStudentUid || null }) : state.view === 'overview' ? loadOverview() : loadClass();
  if (action === 'create' || action === 'join') {
    const values = validForm(action); if (!values) return;
    const data = await request({ action: action === 'create' ? 'createClass' : 'joinClass', ...values }); return loadClass(data.classroom.id);
  }
  if (action === 'back') {
    if (state.view === 'editor') {
      captureEditor();
      if (editorRevision !== editorSavedRevision &&
          !window.confirm('尚有未儲存變更，確定離開編輯畫面？')) return;
      editorSession++;
      clearTimeout(editorTimer);
    }
    return loadClass();
  }
  if (action === 'copy-code') {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(state.classroom.joinCode); message('加入碼已複製'); }
    else message('班級加入碼：' + state.classroom.joinCode);
    return;
  }
  if (action === 'post-notice') {
    const values = validForm('notice'); if (!values) return;
    await request({ action: 'postNotice', classId, content: values.content }); return loadClass();
  }
  if (action === 'delete-notice') {
    if (!window.confirm('確定刪除此公告？')) return;
    await request({ action: 'deleteNotice', classId, noticeId: target.dataset.id }); return loadClass();
  }
  if (action === 'rename') { const values = validForm('rename'); if (!values) return; await request({ action: 'renameClass', classId, ...values }); return loadClass(); }

  if (action === 'roster-sort') {
    state.studentSort = state.studentSort === 'name' ? 'seat' : 'name';
    render(); return;
  }
  if (action === 'roster-select-visible') {
    const selected = new Set(state.rosterSelected || []);
    for (const node of $('section-classes').querySelectorAll('.cc-roster-item:not([hidden]) input[data-roster-select]:not(:disabled)')) {
      selected.add(node.dataset.rosterSelect);
    }
    state.rosterSelected = [...selected];
    render(); return;
  }
  if (action === 'roster-edit') {
    state.editStudentUid = target.dataset.studentUid;
    render();
    $('section-classes')?.querySelector('form[data-form="student-edit"] input[name="name"]')?.focus();
    return;
  }
  if (action === 'roster-edit-cancel') { state.editStudentUid = null; render(); return; }
  if (action === 'roster-save') {
    const form = target.closest('form');
    if (!form?.reportValidity()) return;
    const uid = target.dataset.studentUid;
    const values = Object.fromEntries(new FormData(form));
    await request({ action: 'updateStudents', classId, rosterVersion: state.classroom.rosterVersion,
      updates: [{ uid, name: values.name, seat: values.seat }] });
    await loadClass();
    message('學生資料已更新，原始作答與成績保持不變。'); return;
  }
  if (action === 'roster-batch-remove') {
    const studentUids = [...(state.rosterSelected || [])];
    if (!studentUids.length || studentUids.length > 20) throw Error('每次只能移出 1 至 20 位學生。');
    if (!window.confirm('確定將選取的 ' + studentUids.length + ' 位學生移出班級？既有已發布作業的成績保留，但這些學生將無法繼續進入教室。')) return;
    const result = await request({ action: 'batchRemoveStudents', classId,
      rosterVersion: state.classroom.rosterVersion, studentUids });
    await loadClass();
    message('已移出 ' + result.removed + ' 位學生；歷史成績未刪除。'); return;
  }
  if (action === 'roster-export') {
    const content = exportRosterCSV(state.classroom.members || []);
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'classroom-roster.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  if (action === 'roster-import-preview') {
    const input = $('cc-roster-csv');
    const text = input?.value || '';
    const preview = parseRosterCSV(text, state.classroom.members || []);
    state.rosterCsvText = text;
    state.rosterPreview = preview;
    render();
    message(preview.errors.length ? 'CSV 有 ' + preview.errors.length + ' 個問題，修正後才能匯入。' :
      'CSV 已核對：' + preview.updates.length + ' 位學生的姓名或座號將更新。', !!preview.errors.length);
    return;
  }
  if (action === 'roster-import-apply') {
    const preview = state.rosterPreview;
    if (!preview || preview.errors.length || !preview.updates.length) throw Error('請先預覽有效且含有變更的 CSV。');
    if (!window.confirm('確認將 ' + preview.updates.length + ' 位學生的姓名或座號更新到本班？學生帳號與成績完全不變。')) return;
    const result = await request({ action: 'updateStudents', classId,
      rosterVersion: state.classroom.rosterVersion, updates: preview.updates });
    await loadClass();
    message('匯入完成：更新 ' + result.updated + ' 位學生。'); return;
  }
  if (action === 'rotate-code') {
    if (!window.confirm('更新後舊加入碼會失效，已加入的學生不受影響。')) return;
    await request({ action: 'rotateCode', classId }); return loadClass();
  }
  if (action === 'archive') {
    const archived = state.classroom.status === 'active';
    if (archived && !window.confirm('封存後停止加入與繳交，原有作業和成績會保留。')) return;
    await request({ action: 'archiveClass', classId, archived }); return loadClass();
  }
  if (action === 'leave' || action === 'remove-student') {
    if (!window.confirm(action === 'leave' ? '確定退出班級？' : `確定將 ${target.dataset.name} 移出班級？已發布作業的成績仍會保留。`)) return;
    await request({ action: action === 'leave' ? 'leaveClass' : 'removeStudent', classId, studentUid: target.dataset.id }); return action === 'leave' ? loadHome() : loadClass();
  }
  if (action === 'new-assignment') return beginEditor({ title: '', subject: '數學', topic: '', level: '國中一年級', questions: [blankQuestion()] });
  if (action === 'edit') {
    const data = await request({ action: 'getAssignment', classId, assignmentId: target.dataset.id });
    return beginEditor({ ...data.assignment, dueLocal: data.assignment.dueAtMs ? localDate(data.assignment.dueAtMs) : '' });
  }
  if (action === 'delete-draft') {
    if (!window.confirm('確定刪除這份尚未發布的草稿？')) return;
    await request({ action: 'deleteDraft', classId, assignmentId: target.dataset.id }); return loadClass();
  }
  if (action === 'preview' || action === 'work') return loadAssignment(target.dataset.id, action);
  if (action === 'report') return loadReport(target.dataset.id);
  if (action === 'editor-select') {
    captureEditor();
    const next = Number(target.dataset.index);
    if (!Number.isInteger(next) || next < 0 || next >= state.editor.questions.length) return;
    state.editorIndex = next;
    render();
    $('section-classes')?.querySelector('.cc-editor-question')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (['add-question', 'remove-question', 'editor-up', 'editor-down', 'editor-duplicate'].includes(action)) {
    captureEditor();
    const index = state.editorIndex || 0;
    const rows = state.editor.questions;
    if (action === 'add-question' && rows.length < MAX_CLASSROOM_QUESTIONS) {
      rows.splice(index + 1, 0, blankQuestion());
      state.editorIndex = index + 1;
    } else if (action === 'remove-question' && rows.length > 1) {
      rows.splice(index, 1);
      state.editorIndex = Math.min(index, rows.length - 1);
    } else if (action === 'editor-duplicate' && rows.length < MAX_CLASSROOM_QUESTIONS) {
      const q = rows[index];
      rows.splice(index + 1, 0, {
        ...q, options: [...q.options], knowledge_points: (q.knowledge_points || []).map(p => ({ ...p }))
      });
      state.editorIndex = index + 1;
    } else if (action === 'editor-up' && index > 0) {
      [rows[index], rows[index - 1]] = [rows[index - 1], rows[index]];
      state.editorIndex = index - 1;
    } else if (action === 'editor-down' && index < rows.length - 1) {
      [rows[index], rows[index + 1]] = [rows[index + 1], rows[index]];
      state.editorIndex = index + 1;
    } else return;
    touchEditor(); render(); return;
  }
  if (action === 'save-draft' || action === 'save-preview') return persistEditorDraft(action === 'save-preview');
  if (action === 'generate-question') return generateQuestions(target.dataset.count || 1);
  if (action === 'publish') {
    if (!$('cc-reviewed').checked) throw Error('請先核對題組並勾選確認');
    await request({ action: 'publishAssignment', classId, assignmentId: state.assignment.id, version: state.assignment.version, reviewed: true }); return loadClass();
  }
  if (action === 'previous-question' || action === 'next-question') { state.questionIndex += action === 'next-question' ? 1 : -1; return render(); }
  if (action === 'answer' || action === 'submit') {
    const answers = [...(state.submission?.answers || state.assignment.questions.map(() => null))];
    if (action === 'answer') answers[state.questionIndex] = Number(target.dataset.option);
    if (action === 'submit' && !window.confirm('繳交後首次成績將固定，仍可進行訂正。確定繳交？')) return;
    const data = await request({ action: action === 'answer' ? 'saveProgress' : 'submit', classId, assignmentId: state.assignment.id, version: state.submission?.version || 0, answers });
    state.submission = data.submission;
    if (data.questions) state.assignment.questions = data.questions;
    render(); if (action === 'answer') message('答案已保存'); return;
  }
  if (action === 'correct') {
    const q = state.assignment.questions[Number(target.dataset.index)];
    const data = await request({ action: 'correct', classId, assignmentId: state.assignment.id, questionId: q.id, selectedIndex: Number(target.dataset.option) });
    state.submission = data.submission; render(); message(data.correct ? '訂正已記錄' : '再看一次解析，重新選擇答案。'); return;
  }
  if (action === 'update-deadline') {
    const values = validForm('deadline'); if (!values) return;
    await request({ action: 'updateDeadline', classId, assignmentId: state.report.assignment.id,
      version: state.report.assignment.version, dueAtMs: values.dueAtMs ? new Date(values.dueAtMs).getTime() : null });
    await loadReport(); message('截止時間已更新；已繳交成績維持不變。'); return;
  }
  if (action === 'reopen-assignment') {
    if (!window.confirm('確定重新開放這份作業？未繳交的學生可以繼續作答，原有成績不變。')) return;
    await request({ action: 'reopenAssignment', classId, assignmentId: state.report.assignment.id, version: state.report.assignment.version });
    await loadReport(); message('作業已重新開放。'); return;
  }
  if (action === 'close-assignment') {
    if (!window.confirm('確定結束收件？學生之後仍可查看結果與訂正。')) return;
    await request({ action: 'closeAssignment', classId, assignmentId: state.report.assignment.id, version: state.report.assignment.version }); return loadReport();
  }
  if (action === 'export') {
    const data = await request({ action: 'exportReport', classId, assignmentId: state.report.assignment.id });
    const url = URL.createObjectURL(new Blob([data.csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'classroom-grades.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
function mount() {
  resetOwner();
  const panel = $('section-classes'); if (!panel || panel.dataset.classroomMounted) return;
  panel.dataset.classroomMounted = 'true';
  panel.addEventListener('submit', event => { event.preventDefault(); });
  panel.addEventListener('input', event => {
    if (event.target.matches('#cc-roster-csv')) {
      state.rosterCsvText = event.target.value;
      state.rosterPreview = null;
      return;
    }
    if (event.target.matches('#cc-copy input[name="title"]')) {
      state.copyTitle = event.target.value;
      return;
    }
    if (event.target.closest('#cc-editor')) {
      captureEditor();
      touchEditor();
      return;
    }
    const workspaceInput = event.target.closest('input[data-workspace-search-input]');
    if (workspaceInput) {
      state.workspaceSearch = workspaceInput.value;
      filterWorkspaceTasks(panel);
      return;
    }
    const input = event.target.closest('input[data-cc-search]');
    if (!input) return;
    const type = input.dataset.ccSearch;
    if (type === 'assignment') state.assignmentSearch = input.value;
    if (type === 'student') state.studentSearch = input.value;
    filterClassroomList(panel, type);
  });
  panel.addEventListener('change', event => {
    if (event.target.matches('#cc-roster-file')) {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 100000) { message('CSV 檔案過大，請使用本班名單範本。', true); return; }
      const currentRoom = state.classroom?.id;
      void file.text().then(csv => {
        if (state.classroom?.id !== currentRoom || state.view !== 'class') return;
        state.rosterCsvText = csv; state.rosterPreview = null;
        const textarea = $('cc-roster-csv');
        if (textarea) textarea.value = csv;
        message('CSV 已載入，請點「預覽變更」確認後再匯入。');
      }).catch(error => message(error.message, true));
      return;
    }
    if (event.target.matches('input[data-roster-select]')) {
      const selection = new Set(state.rosterSelected || []);
      if (event.target.checked) selection.add(event.target.dataset.rosterSelect);
      else selection.delete(event.target.dataset.rosterSelect);
      state.rosterSelected = [...selection];
      const label = $('cc-roster-selected-count');
      if (label) label.textContent = '已選取 ' + selection.size + ' 位';
      const remove = panel.querySelector('[data-action="roster-batch-remove"]');
      if (remove) remove.disabled = !selection.size || selection.size > 20;
      return;
    }
    if (event.target.matches('#cc-copy input[name="targetClass"]')) {
      state.copySelected = [...panel.querySelectorAll('#cc-copy input[name="targetClass"]:checked')].map(input => input.value);
      return;
    }
    if (event.target.closest('#cc-editor') && event.target.matches('select,input[type="datetime-local"]')) {
      captureEditor();
      touchEditor();
    }
  });
  panel.addEventListener('keydown', event => {
    const workspace = event.target.matches('.cc-workspace-tabs [role="tab"]');
    if (!workspace && !event.target.matches('.cc-class-tabs [role="tab"]')) return;
    const tabs = [...panel.querySelectorAll(workspace ? '.cc-workspace-tabs [role="tab"]' : '.cc-class-tabs [role="tab"]')];
    const current = tabs.indexOf(event.target);
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault(); tabs[next]?.click();
  });
  panel.addEventListener('click', event => {
    const target = event.target.closest('button[data-action]');
    if (!target || target.disabled) return;
    if (['create', 'join', 'rename', 'post-notice', 'apply-teacher', 'assign-teacher', 'save-draft', 'save-preview', 'roster-save'].includes(target.dataset.action) && !target.closest('form')?.reportValidity()) return;
    void run(() => act(target));
  });
  render();
}
async function open() { mount(); await run(loadHome); }
if (!document.getElementById('classroom-style')) {
  const link = document.createElement('link'); link.id = 'classroom-style'; link.rel = 'stylesheet'; link.href = new URL('../styles/classroom.css', import.meta.url).href; document.head.appendChild(link);
}
window.QAClassrooms = Object.freeze({ open, mount });
window.addEventListener('xiuxian:user-data-ready', () => { resetOwner(); mount(); });
try { onAuthStateChanged(getAuth(), () => { const before = owner; resetOwner(); if (before !== owner) mount(); }); } catch (_) { /* Core login can still be initializing. */ }
mount();
if ($('section-classes') && !$('section-classes').classList.contains('hidden')) void open();

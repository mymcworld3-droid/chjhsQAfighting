import { getMainUser, authenticatedMainFetch } from './data/project-repository.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import './knowledge-points.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = ms => ms ? new Date(ms).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '不限時間';
const localDate = ms => { const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const labels = ['A', 'B', 'C', 'D'];
const status = value => ({ draft: '草稿', published: '進行中', closed: '已結束', submitted: '已繳交', 'in-progress': '作答中' }[value] || '未開始');
const button = (action, label, attrs = '') => `<button type="button" data-action="${action}" ${attrs}>${label}</button>`;
let owner = '', epoch = 0, busy = false;
let state = { view: 'home', classes: [] };

function resetOwner() {
  const next = getMainUser()?.uid || '';
  if (next !== owner) {
    owner = next; epoch++; busy = false; state = { view: 'home', classes: [] };
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
  const rooms = state.classes.map(room => `<article class="cc-card"><h4>${escape(room.name)}</h4><p class="cc-muted">${room.role === 'teacher' ? '教師' : '學生'} · ${room.studentCount} 位學生${room.status === 'archived' ? ' · 已封存' : ''}</p><p>${escape(room.teacherName)}</p>${button('class', '進入班級', `data-id="${room.id}"`)}</article>`).join('');
  return `<div class="cc-toolbar"><h3>我的班級</h3>${button('refresh', '重新整理')}</div>
    ${rooms ? `<div class="cc-grid">${rooms}</div>` : '<p class="cc-muted">輸入老師提供的加入碼，或建立你要管理的班級。</p>'}
    <div class="cc-grid"><section class="cc-card"><h4>加入班級</h4><form class="cc-form" data-form="join">
      ${field('joinCode', '八碼加入碼', '', 'required maxlength="8" autocomplete="off" style="text-transform:uppercase"')}
      ${field('name', '老師辨識用的姓名', '', 'required maxlength="40" autocomplete="name"')}
      ${field('seat', '座號（選填）', '', 'maxlength="12"')}${button('join', '加入班級', 'class="cc-primary"')}</form></section>
    <section class="cc-card"><h4>教師建班</h4><p class="cc-muted">建立班級後，即可為自己的學生派題、查看成績。</p><form class="cc-form" data-form="create">
      ${field('name', '班級名稱', '', 'required maxlength="60"')}${field('teacherName', '教師稱呼', '', 'required maxlength="40"')}
      ${button('create', '建立班級', 'class="cc-primary"')}</form></section></div>`;
}
function classView() {
  const room = state.classroom, teacher = room.role === 'teacher';
  const list = [...state.assignments].reverse().map(a => `<article class="cc-card"><div class="cc-toolbar"><div><h4>${escape(a.title)}</h4><span class="cc-status">${status(a.status)}${!teacher ? ' · ' + status(a.submission?.status) : ''}</span></div><div class="cc-actions">
    ${teacher ? a.status === 'draft' ? button('edit', '編輯', `data-id="${a.id}"`) + button('preview', '預覽與發布', `data-id="${a.id}"`) + button('delete-draft', '刪除草稿', `data-id="${a.id}"`) : button('report', '查看成績', `data-id="${a.id}"`) + button('preview', '查看題組', `data-id="${a.id}"`) : button('work', a.submission?.status === 'submitted' ? '結果與訂正' : '開啟作業', `data-id="${a.id}"`)}
    </div></div><p class="cc-muted">${escape(a.subject)} · ${a.questionCount} 題 · 截止：${date(a.dueAtMs)}</p></article>`).join('');
  const members = teacher ? `<details class="cc-card"><summary>學生名單（${room.members.length} 人）</summary><div class="cc-table-wrap"><table><thead><tr><th>座號</th><th>姓名</th><th>管理</th></tr></thead><tbody>${room.members.map(m => `<tr><td>${escape(m.seat || '—')}</td><td>${escape(m.name)}</td><td>${button('remove-student', '移出班級', `data-id="${escape(m.uid)}" data-name="${escape(m.name)}"`)}</td></tr>`).join('') || '<tr><td colspan="3">尚無學生加入</td></tr>'}</tbody></table></div></details>` : '';
  return `<div class="cc-toolbar"><div><h3>${escape(room.name)}</h3><span class="cc-muted">${escape(room.teacherName)}${room.status === 'archived' ? ' · 已封存' : ''}</span></div><div class="cc-actions">${button('home', '所有班級')}${button('refresh', '重新整理')}</div></div>
    ${teacher ? `<section class="cc-card"><div class="cc-toolbar"><div><span class="cc-muted">班級加入碼</span><div class="cc-code">${escape(room.joinCode)}</div></div><div class="cc-actions">${button('copy-code', '複製加入碼')}${button('new-assignment', '新增作業', `class="cc-primary" ${room.status !== 'active' ? 'disabled' : ''}`)}</div></div><details><summary>班級設定</summary><form data-form="rename" class="cc-form">${field('name', '班級名稱', room.name, 'required maxlength="60"')}<div class="cc-actions">${button('rename', '儲存名稱')}${button('rotate-code', '更新加入碼')}${button('archive', room.status === 'active' ? '封存班級' : '恢復班級')}</div></form></details></section>` : `<div class="cc-actions" style="margin-bottom:14px">${button('leave', '退出班級')}</div>`}
    ${members}<div class="cc-toolbar"><h3>班級作業</h3></div>${list || '<p class="cc-muted">目前沒有作業。</p>'}`;
}
const blankQuestion = () => ({ question: '', options: ['', '', '', ''], answerIndex: 0, explanation: '', knowledge_points: [] });
function captureEditor() {
  const form = $('cc-editor'); if (!form) return;
  const values = new FormData(form);
  state.editor = { ...state.editor, title: values.get('title'), subject: values.get('subject'), dueLocal: values.get('dueLocal'), topic: values.get('topic'), level: values.get('level'),
    questions: state.editor.questions.map((q, i) => {
      const pointId = values.get(`point-${i}`), group = window.QAKnowledgePoints.SUBJECTS.find(s => s.points.some(p => p.id === pointId));
      const point = group?.points.find(p => p.id === pointId);
      return { question: values.get(`question-${i}`), options: labels.map((_, n) => values.get(`option-${i}-${n}`)), answerIndex: Number(values.get(`answer-${i}`)), explanation: values.get(`explanation-${i}`), knowledge_points: point ? [{ subject: group.name, ...point }] : [] };
    }) };
}
function editorView() {
  const e = state.editor;
  const points = selected => '<option value="">未標記</option>' + window.QAKnowledgePoints.SUBJECTS.map(s => `<optgroup label="${s.name}">${s.points.map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${p.name}</option>`).join('')}</optgroup>`).join('');
  return `<div class="cc-toolbar"><h3>${e.id ? '編輯作業' : '新增作業'}</h3>${button('back', '返回班級')}</div><p class="cc-muted">發布前請核對題目與答案；發布後題組固定，避免學生使用不同版本。</p>
    <form id="cc-editor" class="cc-form"><div class="cc-card cc-form">${field('title', '作業名稱', e.title, 'required maxlength="80"')}<div class="cc-fields"><label>科目<select name="subject">${['綜合', ...window.QAKnowledgePoints.SUBJECT_NAMES].map(s => `<option ${s === e.subject ? 'selected' : ''}>${s}</option>`).join('')}</select></label>${field('dueLocal', '截止時間（選填）', e.dueLocal || '', 'type="datetime-local"')}</div>
    <details><summary>協助出題</summary><div class="cc-form">${field('topic', '出題範圍', e.topic || '', 'maxlength="180"')}${field('level', '適用年級', e.level || '國中一年級', 'maxlength="32"')}${button('generate-question', 'AI 產生一題')}<span class="cc-muted">產生的內容會加入草稿，請編輯並審核後再發布。</span></div></details></div>
    ${e.questions.map((q, i) => `<section class="cc-card cc-form"><div class="cc-toolbar"><h4>第 ${i + 1} 題</h4>${button('remove-question', '移除此題', `data-index="${i}" ${e.questions.length < 2 ? 'disabled' : ''}`)}</div><label>題目<textarea name="question-${i}" required maxlength="4000">${escape(q.question)}</textarea></label><div class="cc-fields">${q.options.map((o, n) => field(`option-${i}-${n}`, `選項 ${labels[n]}`, o, 'required maxlength="1200"')).join('')}</div><div class="cc-fields"><label>正確答案<select name="answer-${i}">${labels.map((l, n) => `<option value="${n}" ${n === q.answerIndex ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label>知識點（選填）<select name="point-${i}">${points(q.knowledge_points?.[0]?.id)}</select></label></div><label>解析（選填）<textarea name="explanation-${i}" maxlength="4000">${escape(q.explanation)}</textarea></label></section>`).join('')}
    <div class="cc-actions">${button('add-question', '新增一題', e.questions.length >= 30 ? 'disabled' : '')}${button('save-draft', '儲存草稿')}${button('save-preview', '儲存並預覽', 'class="cc-primary"')}</div></form>`;
}
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
function reportView() {
  const r = state.report;
  return `<div class="cc-toolbar"><div><h3>${escape(r.assignment.title)}</h3><span class="cc-muted">${status(r.assignment.status)} · 截止：${date(r.assignment.dueAtMs)}</span></div><div class="cc-actions">${button('back', '返回班級')}${button('refresh', '重新整理')}${button('export', '匯出成績')}${r.assignment.status === 'published' ? button('close-assignment', '結束收件') : ''}</div></div>
    <div class="cc-grid"><section class="cc-card"><span class="cc-muted">繳交人數</span><div class="cc-stat">${r.totals.submitted} / ${r.totals.students}</div></section><section class="cc-card"><span class="cc-muted">已繳交學生的首次平均</span><div class="cc-stat">${r.totals.average === null ? '—' : r.totals.average + ' 分'}</div></section></div>
    <section class="cc-card cc-table-wrap"><table><thead><tr><th>座號</th><th>姓名</th><th>狀態</th><th>首次成績</th><th>錯題訂正</th></tr></thead><tbody>${r.students.map(s => `<tr><td>${escape(s.seat || '—')}</td><td>${escape(s.name)}${s.active ? '' : '（已退出）'}</td><td>${status(s.status)}</td><td>${s.score === null ? '—' : s.score}</td><td>${s.wrongCount === null ? '—' : s.correctedCount + ' / ' + s.wrongCount}</td></tr>`).join('') || '<tr><td colspan="5">尚無學生</td></tr>'}</tbody></table></section>
    <section class="cc-card"><h4>各題首次作答</h4>${r.questions.map((q, i) => `<details><summary>第 ${i + 1} 題 · ${q.total ? Math.round(q.correct / q.total * 100) + '%' : '尚無作答'}（${q.correct} / ${q.total}）</summary><div class="cc-question">${escape(q.question)}</div><p class="cc-muted">${q.knowledge_points.map(p => escape(p.name)).join('、') || '未標記知識點'}</p></details>`).join('')}</section>
    ${r.knowledgePoints?.length ? `<section class="cc-card"><h4>本次作業的知識點表現</h4>${r.knowledgePoints.map(p => `<p>${escape(p.subject)} · ${escape(p.name)}：${p.total ? Math.round(p.correct / p.total * 100) + '%' : '尚無作答'}（${p.correct} / ${p.total}）</p>`).join('')}<p class="cc-muted">依本次固定題組統計，樣本少時請搭配實際作答判讀。</p></section>` : ''}`;
}
function render() {
  const panel = $('section-classes'); if (!panel) return;
  const views = { home: homeView, class: classView, editor: editorView, preview: previewView, work: workView, report: reportView };
  window.quizMathClear?.(panel);
  panel.innerHTML = `<div class="cc-shell"><div data-message role="status" aria-live="polite"></div>${views[state.view]()}</div>`;
  void window.quizMathTypeset?.([panel]);
}
async function loadHome() { const data = await request({ action: 'list' }); state = { view: 'home', classes: data.classes }; render(); }
async function loadClass(classId = state.classroom?.id) { const data = await request({ action: 'classDetail', classId }); state = { ...state, ...data, view: 'class' }; render(); }
async function loadAssignment(assignmentId, view) {
  const data = await request({ action: 'getAssignment', classId: state.classroom.id, assignmentId });
  state = { ...state, ...data, view, questionIndex: 0 }; render();
}
async function loadReport(assignmentId = state.report?.assignment.id) {
  const data = await request({ action: 'report', classId: state.classroom.id, assignmentId }); state.report = data.report; state.view = 'report'; render();
}
async function saveDraft(preview) {
  const form = $('cc-editor'); if (!form.reportValidity()) return;
  captureEditor(); const e = state.editor;
  const data = await request({ action: 'saveAssignment', classId: state.classroom.id, assignmentId: e.id, version: e.version,
    title: e.title, subject: e.subject, dueAtMs: e.dueLocal ? new Date(e.dueLocal).getTime() : null, questions: e.questions });
  state.editor = { ...e, ...data.assignment }; state.assignment = data.assignment;
  if (preview) { state.view = 'preview'; render(); } else message('草稿已儲存');
}
async function generateQuestion() {
  captureEditor(); const e = state.editor;
  if (e.subject === '綜合' || !e.topic?.trim()) throw Error('請先選擇科目並填寫出題範圍');
  if (e.questions.length >= 30) throw Error('每份作業最多 30 題');
  const payload = await request({ subject: e.subject, level: e.level, specificTopic: e.topic, difficulty: 'medium', quizMode: 'classroom-draft', avoidQuestions: e.questions.map(q => q.question).filter(Boolean) }, '/api/generate-quiz', 60000);
  const raw = JSON.parse(String(payload.text || '').match(/\{[\s\S]*\}/)?.[0] || '{}');
  if (typeof raw.question !== 'string' || typeof raw.correct !== 'string' || !Array.isArray(raw.wrong) || raw.wrong.length !== 3 || raw.wrong.some(v => typeof v !== 'string')) throw Error('產生的題目格式不完整，請重試或自行編輯');
  const q = { question: raw.question, options: [raw.correct, ...raw.wrong], answerIndex: 0, explanation: String(raw.explanation || ''), knowledge_points: window.QAKnowledgePoints.labels(raw, e.subject) };
  if (e.questions.length === 1 && !e.questions[0].question && e.questions[0].options.every(o => !o)) e.questions = [q]; else e.questions.push(q);
  render(); message('題目已加入草稿，請核對內容與答案。');
}
function validForm(name) {
  const form = $('section-classes').querySelector(`[data-form="${name}"]`);
  return form?.reportValidity() ? Object.fromEntries(new FormData(form)) : null;
}
async function act(target) {
  const action = target.dataset.action, classId = state.classroom?.id;
  if (action === 'home') return loadHome();
  if (action === 'class') return loadClass(target.dataset.id);
  if (action === 'refresh') return state.view === 'home' ? loadHome() : state.view === 'report' ? loadReport() : loadClass();
  if (action === 'create' || action === 'join') {
    const values = validForm(action); if (!values) return;
    const data = await request({ action: action === 'create' ? 'createClass' : 'joinClass', ...values }); return loadClass(data.classroom.id);
  }
  if (action === 'back') {
    if (state.view === 'editor' && !window.confirm('離開編輯畫面？尚未儲存的修改將不會保留。')) return;
    return loadClass();
  }
  if (action === 'copy-code') {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(state.classroom.joinCode); message('加入碼已複製'); }
    else message('班級加入碼：' + state.classroom.joinCode);
    return;
  }
  if (action === 'rename') { const values = validForm('rename'); if (!values) return; await request({ action: 'renameClass', classId, ...values }); return loadClass(); }
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
  if (action === 'new-assignment') { state.editor = { title: '', subject: '數學', questions: [blankQuestion()] }; state.view = 'editor'; return render(); }
  if (action === 'edit') {
    const data = await request({ action: 'getAssignment', classId, assignmentId: target.dataset.id });
    state.editor = { ...data.assignment, dueLocal: data.assignment.dueAtMs ? localDate(data.assignment.dueAtMs) : '' }; state.view = 'editor'; return render();
  }
  if (action === 'delete-draft') {
    if (!window.confirm('確定刪除這份尚未發布的草稿？')) return;
    await request({ action: 'deleteDraft', classId, assignmentId: target.dataset.id }); return loadClass();
  }
  if (action === 'preview' || action === 'work') return loadAssignment(target.dataset.id, action);
  if (action === 'report') return loadReport(target.dataset.id);
  if (action === 'add-question' || action === 'remove-question') {
    captureEditor();
    if (action === 'add-question' && state.editor.questions.length < 30) state.editor.questions.push(blankQuestion());
    if (action === 'remove-question' && state.editor.questions.length > 1) state.editor.questions.splice(Number(target.dataset.index), 1);
    return render();
  }
  if (action === 'save-draft' || action === 'save-preview') return saveDraft(action === 'save-preview');
  if (action === 'generate-question') return generateQuestion();
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
  panel.addEventListener('click', event => {
    const target = event.target.closest('button[data-action]');
    if (!target || target.disabled) return;
    if (['create', 'join', 'rename', 'save-draft', 'save-preview'].includes(target.dataset.action) && !target.closest('form')?.reportValidity()) return;
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

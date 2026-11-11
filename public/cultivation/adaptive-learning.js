import './adaptive-learning-rules.js';
import { getFirestore, doc, runTransaction } from '../data-store.js';
import { getMainUser, authenticatedMainFetch } from './data/project-repository.js';

// Learning observations share the normal answer transaction. The small per-account
// outbox can replay only observations after a failed save, never gameplay rewards.
const Rules = globalThis.QAAdaptiveLearningRules;
const PREFIX = 'xiuxian:adaptive-observations:v1:';
const storageUnavailable = new Set();
const memory = new Map(), flushing = new Map(), lessons = new Map(), loadingLessons = new Set();
function read(uid) {
  if (storageUnavailable.has(uid)) return memory.get(uid) || [];
  try { const rows = JSON.parse(localStorage.getItem(PREFIX + uid) || '[]');
    if (Array.isArray(rows)) return rows.filter(x => x?.event?.id && x?.meta?.scopeId).slice(-64);
  } catch (_) {}
  return memory.get(uid) || [];
}
function write(uid, rows) {
  memory.set(uid, rows);
  try { localStorage.setItem(PREFIX + uid, JSON.stringify(rows)); storageUnavailable.delete(uid); } catch (_) { storageUnavailable.add(uid); }
}
function enqueue(uid, meta, event) {
  const rows = read(uid);
  if (!rows.some(x => x.event.id === event.id)) rows.push({ meta: {
    scopeId: meta.scopeId, conceptId: meta.conceptId, facetId: meta.facetId,
    questionId: meta.questionId, role: meta.role
  }, event });
  write(uid, rows.slice(-64));
}
function merge(raw, rows) { return rows.reduce((state, x) => Rules.record(state, x.meta, x.event), raw); }
function acknowledge(uid, rows) {
  const ids = new Set(rows.map(x => x.event.id));
  write(uid, read(uid).filter(x => !ids.has(x.event.id)));
}
async function flush(uid = getMainUser()?.uid) {
  if (!uid || getMainUser()?.uid !== uid) return;
  if (flushing.has(uid)) return flushing.get(uid);
  const rows = read(uid); if (!rows.length) return;
  const work = runTransaction(getFirestore(), async tx => {
    if (getMainUser()?.uid !== uid) throw Error('學習紀錄帳號已變更');
    const ref = doc(getFirestore(), 'users', uid), snap = await tx.get(ref);
    if (!snap.exists()) throw Error('玩家資料不存在');
    if (getMainUser()?.uid !== uid) throw Error('學習紀錄帳號已變更');
    const previous = snap.data().stats?.adaptiveLearningV1, next = merge(previous, rows);
    if (next !== previous) tx.update(ref, { 'stats.adaptiveLearningV1': next });
    return next;
  }).then(next => {
    acknowledge(uid, rows);
    if (getMainUser()?.uid === uid && window.getCurrentUserData?.()?.stats)
      window.getCurrentUserData().stats.adaptiveLearningV1 = next;
  }).catch(error => console.warn('[Adaptive observations]', error?.code || 'retry later'))
    .finally(() => flushing.delete(uid));
  flushing.set(uid, work); return work;
}
function request(scope, questions = []) {
  return { adaptiveScope: scope, adaptivePending: questions.filter(Boolean).map(q => q.adaptive).filter(Boolean)
    .slice(0, 8).map(x => ({ scopeId: x.scopeId, conceptId: x.conceptId, facetId: x.facetId })) };
}
async function fetchQuiz(input, init) {
  const uid = getMainUser()?.uid;
  // A temporary offline observation does not block the existing question flow.
  await Promise.race([flush(uid), new Promise(resolve => setTimeout(resolve, 1500))]);
  if (!uid || getMainUser()?.uid !== uid) throw Error('帳號已變更，請重新開啟問道試煉');
  return authenticatedMainFetch(input, init);
}
function hint(quiz) {
  if (!quiz?.adaptive || quiz.adaptiveAnswered) return;
  quiz.adaptiveHelp = Math.min(3, (Number(quiz.adaptiveHelp) || 0) + 1);
  window.persistAdaptiveActiveQuiz?.(quiz);
}
function answer(quiz, correct, skipped) {
  const uid = getMainUser()?.uid;
  if (!uid || !quiz?.adaptive) return [];
  quiz.adaptiveAnswered = true;
  quiz.adaptiveEvent ||= { id: quiz.adaptive.questionId, correct, skipped, help: quiz.adaptiveHelp || 0, at: Date.now() };
  enqueue(uid, quiz.adaptive, quiz.adaptiveEvent);
  return read(uid);
}
function scopeSelected(meta) {
  const settings = window.getCurrentUserData?.()?.gameSettings;
  const key = x => JSON.stringify([x?.path || '', x?.detail || '', [...(x?.sub_topics || [])].sort()]);
  return settings?.sourceMode === 'focused' && settings.focusedUnits?.some(x => key(x) === key(meta.scope));
}
function currentState(meta) {
  const uid = getMainUser()?.uid, raw = window.getCurrentUserData?.()?.stats?.adaptiveLearningV1;
  return Rules.scopeState(merge(raw, uid ? read(uid) : []), meta.scopeId);
}
function clearView() {
  for (const id of ['adaptive-scope-progress', 'adaptive-concept-lesson']) document.getElementById(id)?.remove();
}
function showLesson(quiz, lesson, { beforeAnswer = false } = {}) {
  const uid = getMainUser()?.uid, meta = quiz?.adaptive;
  if (!uid || window.currentActiveQuiz !== quiz || !meta || !scopeSelected(meta) || lesson.scopeId !== meta.scopeId || lesson.conceptId !== meta.conceptId) return;
  document.getElementById('adaptive-concept-lesson')?.remove();
  const host = document.getElementById(beforeAnswer ? 'question-text' : 'feedback-text'); if (!host) return;
  const panel = document.createElement('section'); panel.id = 'adaptive-concept-lesson'; panel.className = 'adaptive-concept-lesson';
  const heading = document.createElement('h3'); heading.textContent = '觀念補給 · ' + lesson.concept;
  panel.appendChild(heading);
  for (const [label, text] of [['概念講解', lesson.explanation], ['簡單示例', lesson.example]]) {
    const title = document.createElement('h4'); title.textContent = label; panel.appendChild(title);
    const body = document.createElement('div');
    if (window.quizMathRichText) body.innerHTML = window.quizMathRichText(text);
    else body.textContent = text;
    panel.appendChild(body);
  }
  host.insertAdjacentElement('afterend', panel);
  if (beforeAnswer && !quiz.adaptiveLessonHelp) { quiz.adaptiveLessonHelp = true; hint(quiz); }
  const through = Math.max(Number(lesson.through) || 0, Rules.row(currentState(meta).concepts[meta.conceptId]).n);
  enqueue(uid, meta, { id: 'lesson_' + meta.scopeId + '_' + meta.conceptId + '_' + through,
    kind: 'lesson', through, at: Date.now() });
  void flush(uid);
  void window.quizMathTypeset?.([panel]);
}
function render(quiz) {
  clearView();
  const meta = quiz?.adaptive; if (!meta?.outline || !scopeSelected(meta)) return;
  const state = currentState(meta), host = document.getElementById('question-text'); if (!host) return;
  const details = document.createElement('details'); details.id = 'adaptive-scope-progress'; details.className = 'adaptive-scope-progress';
  const summary = document.createElement('summary');
  const target = Math.min(Rules.POLICY.diagnosticMax, Math.max(Rules.POLICY.diagnosticMin, meta.outline.length));
  summary.textContent = '範圍學習足跡' + (state.answered < target ? ` · 診斷 ${Math.min(target, state.answered)}/${target}` : '') + ' · ' + meta.concept;
  details.appendChild(summary);
  const note = document.createElement('p'); note.textContent = meta.provisional ? '目前使用暫定細項，AI 分析完成後會再補齊。' : '依作答與提示使用逐步調整；未練習的觀念保持待診斷。'; details.appendChild(note);
  for (const concept of meta.outline) {
    const item = document.createElement('div'); item.className = 'adaptive-concept-row';
    const title = document.createElement('strong'); title.textContent = concept.name + ' · ' + Rules.status(state.concepts[concept.id]); item.appendChild(title);
    const methods = document.createElement('ul');
    for (const method of concept.methods) {
      const row = Rules.row(state.facets[method.id]), li = document.createElement('li');
      li.textContent = method.name + ' · ' + (row.n ? `${row.c}/${row.n} 完成答對，獨立 ${row.uc}/${row.u}，需協助 ${row.h} 次` : '待診斷') +
        (row.dueAt ? ' · ' + (row.dueAt <= Date.now() ? '待複習' : new Date(row.dueAt).toLocaleDateString('zh-TW') + ' 複習') : '');
      methods.appendChild(li);
    }
    item.appendChild(methods); details.appendChild(item);
  }
  host.insertAdjacentElement('beforebegin', details);
  const lesson = lessons.get(getMainUser()?.uid + ':' + meta.scopeId + ':' + meta.conceptId);
  if (lesson && Rules.row(state.concepts[meta.conceptId]).w >= 2) showLesson(quiz, lesson, { beforeAnswer: true });
  else if (Rules.needsLesson(state, meta.conceptId)) void afterSaved(quiz, { beforeAnswer: true });
}
async function afterSaved(quiz, { beforeAnswer = false } = {}) {
  const user = getMainUser(), meta = quiz?.adaptive;
  if (!user || !meta || !scopeSelected(meta) || !Rules.needsLesson(currentState(meta), meta.conceptId)) return;
  const key = user.uid + ':' + meta.scopeId + ':' + meta.conceptId;
  if (loadingLessons.has(key)) return;
  loadingLessons.add(key);
  try {
    await flush(user.uid);
    if (getMainUser()?.uid !== user.uid || !scopeSelected(meta)) return;
    const response = await authenticatedMainFetch('/api/adaptive-learning/lesson', { method: 'POST',
      body: JSON.stringify({ adaptiveScope: meta.scope, conceptId: meta.conceptId }) });
    if (!response.ok) return;
    const lesson = await response.json();
    if (getMainUser()?.uid !== user.uid || !scopeSelected(meta)) return;
    lessons.set(key, lesson); while (lessons.size > 64) lessons.delete(lessons.keys().next().value);
    const active = window.currentActiveQuiz;
    if (active?.adaptive?.scopeId === meta.scopeId && active.adaptive.conceptId === meta.conceptId)
      showLesson(active, lesson, { beforeAnswer: active !== quiz || beforeAnswer ? !active.adaptiveAnswered : false });
  } catch (error) { console.warn('[Adaptive lesson]', error?.code || 'unavailable'); }
  finally { loadingLessons.delete(key); }
}
window.QAAdaptiveLearning = { request, fetchQuiz, hint, answer, merge, acknowledge, flush, render, afterSaved };
window.addEventListener('online', () => void flush());
window.addEventListener('xiuxian:user-data-ready', () => void flush());

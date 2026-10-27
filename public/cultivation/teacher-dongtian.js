import { getMainUser, authenticatedMainFetch } from './data/project-repository.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import './knowledge-points.js';

const PAGE = 'page-teacher-dongtian', NAV = 'nav-teacher-dongtian';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const levels = ['國小中年級', '國小高年級', '國中一年級', '國中二年級', '國中三年級', '高中職', '大學以上'];
const visibilities = { private: '私人（僅自己）', public: '公開（可隨機遇見）', unlisted: '僅憑代碼進入', class: '限指定班級' };
const btn = (action, label, attrs = '') => `<button type="button" data-td-action="${action}" ${attrs}>${label}</button>`;
const input = (name, title, value = '', attrs = '') => `<label>${title}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;
const select = (name, title, choices, selected) => `<label>${title}<select name="${name}">${choices.map(([value, text]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
const localTime = ms => ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
let owner = '', epoch = 0, busy = false, statusLoading, statusAt = 0;
let state = { allowed: false, classes: [], caves: [], view: 'list' }, files = [];
function reset() {
  const next = getMainUser()?.uid || '';
  if (next !== owner) { owner = next; epoch++; busy = false; statusAt = 0; statusLoading = null; files = []; state = { allowed: false, classes: [], caves: [], view: 'list' }; $(NAV)?.remove(); if ($(PAGE)) { $(PAGE).inert = false; $(PAGE).replaceChildren(); } }
  return owner;
}
function notice(text, error = false) { const node = $(PAGE)?.querySelector('[data-td-message]'); if (node) { node.textContent = text; node.setAttribute('role', error ? 'alert' : 'status'); } }
async function api(body) {
  const uid = reset(), revision = epoch; if (!uid) throw Error('請先登入');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await authenticatedMainFetch('/api/teacher/dongtian', { method: 'POST', body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json();
    if (getMainUser()?.uid !== uid || revision !== epoch) throw Error('登入帳號已變更');
    if (!response.ok || !data.ok) throw Error(data.error || '教師洞天操作未完成'); return data;
  } catch (error) { if (error.name === 'AbortError') throw Error('連線逾時，請重新載入確認儲存結果'); throw error; }
  finally { clearTimeout(timer); }
}
function mount() {
  const main = document.querySelector('main'); if (!main || $(PAGE)) return;
  const page = document.createElement('section'); page.id = PAGE; page.className = 'page-section hidden teacher-dongtian-page'; page.setAttribute('aria-label', '教師洞天'); main.appendChild(page);
  page.addEventListener('submit', e => e.preventDefault());
  page.addEventListener('click', e => {
    const target = e.target.closest('[data-td-action]'); if (!target || target.disabled || busy) return;
    if (['save', 'save-preview', 'generate', 'assign'].includes(target.dataset.tdAction) && !target.closest('form')?.reportValidity()) return;
    void run(() => action(target));
  });
  page.addEventListener('change', e => {
    if (e.target.name === 'visibility') { capture(); render(); }
    if (e.target.name === 'images') { files = [...e.target.files]; const label = page.querySelector('[data-td-files]'); if (label) label.textContent = `已選擇 ${files.length} 張圖片`; }
  });
}
function navigation() {
  const grid = $('nav-grid'); if (!grid) return;
  if (!state.allowed) { $(NAV)?.remove(); return; }
  if (!$(NAV)) {
    const node = document.createElement('button'); node.id = NAV; node.type = 'button'; node.dataset.target = PAGE;
    node.className = 'nav-btn group w-full flex flex-col items-center justify-center h-full transition-all'; node.innerHTML = '<i class="fa-solid fa-mountain-sun mb-1 text-lg"></i><span class="text-[10px]">洞天</span>';
    node.onclick = () => void open(); grid.insertBefore(node, grid.querySelector('[data-target="page-settings"]') || null);
  }
}
async function refreshAccess(force = false) {
  reset(); if (!owner) return;
  if (statusLoading) return statusLoading;
  if (!force && Date.now() - statusAt < 30000) { mount(); navigation(); return; }
  const revision = epoch;
  const job = api({ action: 'status' }).then(data => {
    if (revision !== epoch) return;
    state = { ...state, ...data }; statusAt = Date.now(); mount(); navigation();
    if (!state.allowed) { state.cave = null; state.preview = null; files = []; if ($(PAGE)?.classList.contains('active-page')) render(); }
  }).finally(() => { if (statusLoading === job) statusLoading = null; });
  statusLoading = job; return job;
}
async function run(work) {
  reset(); if (busy) return; busy = true; const revision = epoch;
  if ($(PAGE)) $(PAGE).inert = true; notice('處理中…');
  try { await work(); } catch (error) { if (revision === epoch) notice(error.message, true); }
  finally { if (revision === epoch) { busy = false; if ($(PAGE)) $(PAGE).inert = false; const msg = $(PAGE)?.querySelector('[data-td-message]'); if (msg?.textContent === '處理中…') msg.textContent = ''; } }
}
async function loadList(more = false) {
  const result = await api({ action: 'list', ...(more ? { cursor: state.nextCursor } : {}) });
  state.caves = more ? [...state.caves, ...result.caves] : result.caves; state.nextCursor = result.nextCursor; state.view = 'list'; render();
}
async function open(id) {
  mount();
  await run(async () => { await refreshAccess(true); if (!state.allowed) { render(); return; } window.switchToPage?.(PAGE); if (id) await edit(id); else await loadList(); });
}
async function edit(id) { state.cave = (await api({ action: 'get', id })).cave; state.view = 'edit'; render(); }
const blank = () => ({ q: '', correct: '', wrong: ['', '', ''], exp: '', knowledge_points: [] });
function newCave() { state.cave = { name: '', subject: '數學', level: '國中一年級', difficulty: 'medium', visibility: 'private', questions: [blank()], settings: { passPercent: 60, feedback: 'immediate', shuffleQuestions: false, shuffleOptions: true } }; state.view = 'edit'; render(); }
function listView() {
  return `<div class="cc-toolbar"><h3>教師洞天</h3><div class="cc-actions">${btn('source', '從教材生成')}${btn('new', '自行編題', 'class="cc-primary"')}${btn('refresh', '重新整理')}</div></div><p class="cc-muted">生成後可直接修改題目，也能將洞天題組複製成班級作業。</p>
    <div class="cc-grid">${state.caves.map(c => `<article class="cc-card"><h4>${esc(c.name)}</h4><p class="cc-muted">${esc(c.subject)} · ${c.questionCount} 題 · ${c.status === 'active' ? '已發布' : c.status === 'draft' ? '草稿' : '已封印'} · ${visibilities[c.visibility]}</p><div class="cc-actions">${btn('edit', '編輯與設定', `data-id="${c.id}"`)}${btn('copy', '複製為新草稿', `data-id="${c.id}"`)}${btn('reports', '題目回報', `data-id="${c.id}"`)}</div></article>`).join('') || '<p class="cc-muted">尚無洞天。可從文字與圖片生成，或自行編輯題組。</p>'}</div>${state.nextCursor ? btn('more', '載入更多洞天') : ''}`;
}
async function loadReports(more = false) {
  const data = await api({ action: 'reports', id: state.cave.id, ...(more ? { cursor: state.reportCursor } : {}) });
  state.reports = more ? [...state.reports, ...data.reports] : data.reports; state.reportCursor = data.nextCursor; state.view = 'reports'; render();
}
function reportsView() {
  return `<div class="cc-toolbar"><h3>${esc(state.cave.name)} · 題目回報</h3><div class="cc-actions">${btn('return-edit', '編輯洞天')}${btn('refresh', '重新整理')}${btn('back', '返回列表')}</div></div>${state.reports.map(r => `<article class="cc-card"><h4>第 ${r.questionIndex + 1} 題 · ${r.status === 'teacher-resolved' ? '已處理' : '待處理'}</h4><div class="cc-question">${esc(r.questionSnapshot?.q)}</div><p style="white-space:pre-wrap">${esc(r.reason)}</p>${r.status === 'teacher-resolved' ? `<p class="cc-muted">處理說明：${esc(r.resolution || '已確認處理')}</p>` : `<label>處理說明（選填）<input name="resolution" maxlength="600"></label>${btn('resolve-report', '標示已處理', `data-id="${r.id}"`)}`}</article>`).join('') || '<p class="cc-muted">目前沒有教師洞天回報。</p>'}${state.reportCursor ? btn('more-reports', '載入更多回報') : ''}`;
}
function sourceView() {
  return `<div class="cc-toolbar"><h3>從教材生成洞天</h3>${btn('back', '返回列表')}</div><form id="td-source" class="cc-form cc-card"><label>教材文字<textarea name="text" maxlength="16000" rows="7" placeholder="貼上課文、教學筆記或出題重點"></textarea></label><label>教材圖片（最多八張，每張 2 MB）<input type="file" name="images" accept="image/png,image/jpeg,image/webp" multiple></label><span data-td-files class="cc-muted">${files.length ? `已選擇 ${files.length} 張圖片` : '文字與圖片至少提供一項'}</span><div class="cc-fields">${select('level', '適用程度', levels.map(v => [v, v]), '國中一年級')}${select('amount', '生成題數', [['low', '10–14 題'], ['medium', '15–20 題'], ['high', '21–30 題']], 'low')}</div>${btn('generate', '生成洞天草稿', 'class="cc-primary"')}<p class="cc-muted">生成完成後可直接編輯，儲存及確認發布前不會公開。</p></form>`;
}
function capture() {
  const form = $('td-editor'); if (!form) return;
  const f = new FormData(form), c = state.cave;
  state.cave = { ...c, name: f.get('name'), subject: f.get('subject'), level: f.get('level'), difficulty: f.get('difficulty'), visibility: f.get('visibility'), classId: f.get('classId'),
    description: f.get('description'), instructions: f.get('instructions'), tags: f.get('tags'), openAtMs: f.get('open') ? new Date(f.get('open')).getTime() : null, closeAtMs: f.get('close') ? new Date(f.get('close')).getTime() : null,
    settings: { passPercent: Number(f.get('pass')), feedback: f.get('feedback'), shuffleQuestions: f.get('shuffleQuestions') === 'on', shuffleOptions: f.get('shuffleOptions') === 'on' },
    questions: c.questions.map((q, i) => {
      const options = [0, 1, 2, 3].map(n => f.get(`option-${i}-${n}`)), correct = Number(f.get(`answer-${i}`)), pointId = f.get(`point-${i}`);
      const group = window.QAKnowledgePoints.SUBJECTS.find(s => s.points.some(p => p.id === pointId)), point = group?.points.find(p => p.id === pointId);
      return { id: q.id, q: f.get(`q-${i}`), correct: options[correct], wrong: options.filter((_, n) => n !== correct), optionOrder: options, exp: f.get(`exp-${i}`),
        knowledge_points: pointId === q.knowledge_points?.[0]?.id ? q.knowledge_points : point ? [{ subject: group.name, ...point }] : [] };
    }) };
}
function editorView() {
  const c = state.cave, choices = ['A', 'B', 'C', 'D'];
  const points = selected => '<option value="">未標記</option>' + window.QAKnowledgePoints.SUBJECTS.map(s => `<optgroup label="${s.name}">${s.points.map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${p.name}</option>`).join('')}</optgroup>`).join('');
  return `<div class="cc-toolbar"><h3>洞天編輯與設定</h3>${btn('back', '返回列表')}</div><p class="cc-muted">可直接更改題目，無需由 AI 代改。已發布洞天儲存後立即更新，正在作答者需重新進入。</p><form id="td-editor" class="cc-form"><section class="cc-card cc-form">${input('name', '洞天名稱', c.name, 'required maxlength="80"')}<div class="cc-fields">${select('subject', '科目', ['綜合', ...window.QAKnowledgePoints.SUBJECT_NAMES].map(v => [v, v]), c.subject)}${select('level', '適用程度', levels.map(v => [v, v]), c.level)}${select('difficulty', '難度', [['easy', '基礎'], ['medium', '標準'], ['hard', '進階']], c.difficulty)}${select('visibility', '開放範圍', Object.entries(visibilities), c.visibility || 'public')}</div>
    ${c.visibility === 'class' ? select('classId', '指定班級', state.classes.map(v => [v.id, v.name]), c.classId) + (state.classCursor ? btn('more-classes', '載入更多班級') : '') : ''}
    <details><summary>教學與作答設定</summary><div class="cc-form"><label>洞天介紹<textarea name="description" maxlength="1200">${esc(c.description)}</textarea></label><label>作答說明<textarea name="instructions" maxlength="1600">${esc(c.instructions)}</textarea></label>${input('tags', '標籤（以逗號分隔，最多八個）', Array.isArray(c.tags) ? c.tags.join(',') : c.tags, 'maxlength="160"')}<div class="cc-fields">${input('open', '開始時間（選填）', localTime(c.openAtMs), 'type="datetime-local"')}${input('close', '截止時間（選填）', localTime(c.closeAtMs), 'type="datetime-local"')}${input('pass', '及格標準（正確率 %）', c.settings?.passPercent ?? 60, 'type="number" min="0" max="100" required')}${select('feedback', '解析顯示時機', [['immediate', '每題作答後'], ['completion', '整份完成後']], c.settings?.feedback || 'immediate')}</div><label class="cc-inline"><input type="checkbox" name="shuffleQuestions" ${c.settings?.shuffleQuestions ? 'checked' : ''}>打亂題序</label><label class="cc-inline"><input type="checkbox" name="shuffleOptions" ${c.settings?.shuffleOptions !== false ? 'checked' : ''}>打亂選項</label></div></details></section>
    ${c.questions.map((q, i) => { const options = q.optionOrder || [q.correct, ...q.wrong]; return `<section class="cc-card cc-form"><div class="cc-toolbar"><h4>第 ${i + 1} 題</h4><div class="cc-actions">${btn('up', '上移', `data-index="${i}" ${i === 0 ? 'disabled' : ''}`)}${btn('down', '下移', `data-index="${i}" ${i === c.questions.length - 1 ? 'disabled' : ''}`)}${btn('remove', '移除', `data-index="${i}" ${c.questions.length < 2 ? 'disabled' : ''}`)}</div></div><label>題目<textarea name="q-${i}" maxlength="4000" required>${esc(q.q)}</textarea></label><div class="cc-fields">${options.map((v, n) => input(`option-${i}-${n}`, `選項 ${choices[n]}`, v, 'required maxlength="1200"')).join('')}${select(`answer-${i}`, '正確答案', choices.map((v, n) => [String(n), v]), String(Math.max(0, options.indexOf(q.correct))))}<label>知識點（選填）<select name="point-${i}">${points(q.knowledge_points?.[0]?.id)}</select></label></div><label>解析（選填）<textarea name="exp-${i}" maxlength="4000">${esc(q.exp)}</textarea></label></section>`; }).join('')}
    <div class="cc-actions">${btn('add', '新增一題', c.questions.length >= 30 ? 'disabled' : '')}${btn('save', '儲存修改')}${btn('save-preview', '儲存並預覽發布', 'class="cc-primary"')}</div></form>`;
}
function previewView() {
  const c = state.cave;
  return `<div class="cc-toolbar"><h3>${esc(c.name)}</h3><div class="cc-actions">${btn('return-edit', '繼續編輯')}${btn('back', '返回列表')}</div></div><section class="cc-card"><p>${visibilities[c.visibility]} · ${c.questionCount} 題 · 及格 ${c.settings?.passPercent ?? 60}%</p><p class="cc-muted">${esc(c.description)}</p><p style="white-space:pre-wrap">${esc(c.instructions)}</p><div class="cc-actions">${btn('copy-code', '複製洞天代碼', c.status !== 'active' || c.visibility === 'private' ? 'disabled' : '')}${c.status === 'active' ? btn('unpublish', '暫停開放') : ''}</div></section>
    ${c.questions.map((q, i) => `<article class="cc-card"><h4>第 ${i + 1} 題</h4><div class="cc-question">${esc(q.q)}</div><div class="cc-options">${(q.optionOrder || [q.correct, ...q.wrong]).map((v, n) => `<div>${'ABCD'[n]}. ${esc(v)}${v === q.correct ? ' ✓' : ''}</div>`).join('')}</div><div class="cc-explanation">${esc(q.exp)}</div></article>`).join('')}
    <section class="cc-card cc-form"><label class="cc-inline"><input id="td-reviewed" type="checkbox">已確認題目、答案與開放設定</label>${btn('publish', c.status === 'active' ? '確認發布設定' : '發布洞天', 'class="cc-primary"')}</section>
    ${state.classes.length ? `<form class="cc-card cc-form" id="td-assign"><h4>複製為班級作業</h4><p class="cc-muted">會建立固定題組草稿，請至班級預覽後發布。洞天後續改題不會改寫已派作業或成績。</p>${select('classId', '選擇班級', state.classes.map(v => [v.id, v.name]), c.classId)}${input('due', '作業截止時間（選填）', '', 'type="datetime-local"')}${btn('assign', '建立班級作業草稿')}</form>` : ''}`;
}
function render() {
  mount(); const panel = $(PAGE); if (!panel) return;
  window.quizMathClear?.(panel);
  panel.innerHTML = `<div class="cc-shell"><div data-td-message role="status" aria-live="polite"></div>${!state.allowed ? '<p>此功能僅供管理員與已核准教師使用，請至仙盟申請教師資格。</p>' : ({ list: listView, source: sourceView, edit: editorView, preview: previewView, reports: reportsView })[state.view]()}</div>`;
  void window.quizMathTypeset?.([panel]);
}
function changed(cave) { window.dispatchEvent(new CustomEvent('teacher-dongtian:changed', { detail: { id: cave.id } })); }
async function save(preview = false) {
  capture(); const c = state.cave;
  state.cave = (await api({ ...c, action: 'save', tags: Array.isArray(c.tags) ? c.tags.join(',') : c.tags || '' })).cave; changed(state.cave);
  if (preview) state.view = 'preview'; render(); notice('洞天修改已儲存');
}
async function generate() {
  const form = new FormData($('td-source')), source = String(form.get('text') || '').trim();
  if (!source && !files.length) throw Error('請提供文字或教材圖片');
  if (files.length > 8 || files.reduce((sum, file) => sum + file.size, 0) > 14000000 || files.some(file => file.size > 2000000 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) throw Error('請選擇最多八張 PNG、JPEG 或 WebP 圖片，每張不超過 2 MB，合計不超過 14 MB');
  await refreshAccess(true); if (!state.allowed) throw Error('教師資格尚未核准');
  const uid = owner, revision = epoch;
  const images = await Promise.all(files.map(file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(Error('圖片讀取失敗')); reader.onload = () => resolve({ mimeType: file.type, data: String(reader.result).split(',')[1] }); reader.readAsDataURL(file); })));
  if (getMainUser()?.uid !== uid || revision !== epoch) throw Error('登入帳號已變更');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 900000);
  try {
    const response = await authenticatedMainFetch('/api/generate-dongtian', { method: 'POST', headers: { Accept: 'application/x-ndjson' }, signal: controller.signal,
      body: JSON.stringify({ text: source, images, creatorLevel: form.get('level'), questionAmount: form.get('amount') }) });
    let generated, buffer = '';
    const consume = event => {
      if (getMainUser()?.uid !== uid || revision !== epoch) throw Error('登入帳號已變更');
      if (event.type === 'error' || event.error) throw Error(event.error || '生成未完成');
      if (event.completed !== undefined) notice(`已生成 ${event.completed} / ${event.total} 題`);
      if (event.dongtian) generated = event.dongtian;
    };
    if ((response.headers.get('content-type') || '').includes('application/x-ndjson') && response.body?.getReader) {
      const reader = response.body.getReader(), decoder = new TextDecoder();
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true }); if (buffer.length > 2000000) throw Error('生成回應過大'); const lines = buffer.split('\n'); buffer = lines.pop(); for (const line of lines) if (line.trim()) consume(JSON.parse(line)); }
      buffer += decoder.decode(); if (buffer.trim()) consume(JSON.parse(buffer));
    } else consume(await response.json());
    if (!response.ok || !generated?.questions?.length) throw Error('未收到完整題組，請重試');
    if (getMainUser()?.uid !== uid || revision !== epoch) throw Error('登入帳號已變更');
    state.cave = { ...generated, visibility: 'private', status: 'draft', settings: { passPercent: 60, feedback: 'immediate', shuffleOptions: true }, description: generated.coverageSummary || '' }; state.view = 'edit'; render(); notice('生成完成，可直接改題；尚未儲存或公開。');
  } catch (error) { if (error.name === 'AbortError') throw Error('生成逾時，請減少教材後重試'); throw error; }
  finally { controller.abort(); clearTimeout(timer); }
}
async function action(target) {
  const command = target.dataset.tdAction;
  if (command === 'refresh') { await refreshAccess(true); if (state.allowed) { if (state.view === 'reports') await loadReports(); else await loadList(); } else render(); return; }
  if (command === 'reports') { state.cave = (await api({ action: 'get', id: target.dataset.id })).cave; return loadReports(); }
  if (command === 'more-reports') return loadReports(true);
  if (command === 'resolve-report') { await api({ action: 'resolveReport', id: state.cave.id, reportId: target.dataset.id, resolution: target.closest('article').querySelector('[name=resolution]').value }); return loadReports(); }
  if (command === 'back') { if (state.view === 'edit' && !confirm('返回列表？尚未儲存的修改將不保留。')) return; return loadList(); }
  if (command === 'more') return loadList(true);
  if (command === 'new') return newCave();
  if (command === 'source') { files = []; state.view = 'source'; render(); return; }
  if (command === 'generate') return generate();
  if (command === 'edit') return edit(target.dataset.id);
  if (command === 'copy') { state.cave = (await api({ action: 'copy', sourceId: target.dataset.id })).cave; state.view = 'edit'; changed(state.cave); render(); return; }
  if (command === 'more-classes') { capture(); const data = await api({ action: 'classes', cursor: state.classCursor }); state.classes.push(...data.classes); state.classCursor = data.classCursor; render(); return; }
  if (['up', 'down', 'remove', 'add'].includes(command)) {
    capture(); const i = Number(target.dataset.index), rows = state.cave.questions;
    if (command === 'remove' && rows.length > 1) rows.splice(i, 1);
    if (command === 'add' && rows.length < 30) rows.push(blank());
    if (command === 'up' && i > 0) [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
    if (command === 'down' && i < rows.length - 1) [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]];
    render(); return;
  }
  if (command === 'save' || command === 'save-preview') return save(command === 'save-preview');
  if (command === 'return-edit') { state.view = 'edit'; render(); return; }
  if (command === 'publish' || command === 'unpublish') {
    if (command === 'publish' && !$('td-reviewed').checked) throw Error('請先核對題組並勾選確認');
    state.cave = (await api({ action: command, id: state.cave.id, version: state.cave.version, reviewed: true })).cave; changed(state.cave); render(); notice(command === 'publish' ? '洞天已發布' : '已停止對外開放'); return;
  }
  if (command === 'copy-code') { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(state.cave.id); notice('洞天代碼：' + state.cave.id); return; }
  if (command === 'assign') { const f = new FormData($('td-assign')); await api({ action: 'assign', id: state.cave.id, version: state.cave.version, classId: f.get('classId'), dueAtMs: f.get('due') ? new Date(f.get('due')).getTime() : null }); notice('已建立班級作業草稿，請至仙盟的班級內預覽並發布。'); }
}
for (const [name, href] of [['teacher-dongtian-shared-style', '../styles/classroom.css'], ['teacher-dongtian-style', '../styles/teacher-dongtian.css']]) {
  if ($(name)) continue; const link = document.createElement('link'); link.id = name; link.rel = 'stylesheet'; link.href = new URL(href, import.meta.url).href; document.head.appendChild(link);
}
window.QATeacherDongtian = Object.freeze({ open, get allowed() { return state.allowed; } });
for (const event of ['xiuxian:user-ready', 'xiuxian:user-data-ready', 'xiuxian:teacher-access']) window.addEventListener(event, () => void refreshAccess(event === 'xiuxian:teacher-access').catch(() => {}));
try { onAuthStateChanged(getAuth(), () => { reset(); void refreshAccess(true).catch(() => {}); }); } catch (_) {}
mount(); void refreshAccess().catch(() => {});

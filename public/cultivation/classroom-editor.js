
export const MAX_CLASSROOM_QUESTIONS = 30;
export const AI_BATCH_CHOICES = Object.freeze([1, 5, 10]);

export function validateClassroomDraft(editor) {
  if (!editor || !String(editor.title || '').trim()) return '請先填寫作業名稱。';
  if (String(editor.title).trim().length > 80) return '作業名稱不可超過 80 字。';
  if (!Array.isArray(editor.questions) || !editor.questions.length || editor.questions.length > MAX_CLASSROOM_QUESTIONS) {
    return '每份作業需要 1 至 30 題。';
  }
  for (let i = 0; i < editor.questions.length; i++) {
    const q = editor.questions[i];
    if (!String(q.question || '').trim()) return '第 ' + (i + 1) + ' 題的題幹尚未完成。';
    if (String(q.question).trim().length > 4000) return '第 ' + (i + 1) + ' 題的題幹過長。';
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some(v => !String(v || '').trim())) {
      return '第 ' + (i + 1) + ' 題需要四個選項。';
    }
    const options = q.options.map(v => String(v).trim());
    if (options.some(v => v.length > 1200) || new Set(options).size !== 4) {
      return '第 ' + (i + 1) + ' 題選項不可重複，且每項不得超過 1200 字。';
    }
    if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex > 3) {
      return '第 ' + (i + 1) + ' 題沒有有效的正確答案。';
    }
    if (String(q.explanation || '').length > 4000) return '第 ' + (i + 1) + ' 題的解析過長。';
  }
  return '';
}
export function parseClassroomAIQuestion(payload, subject, labelsOf) {
  const json = String(payload?.text || '').match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw Error('AI 回傳的題目不是有效 JSON。');
  let raw;
  try { raw = JSON.parse(json); } catch (_) { throw Error('AI 回傳的題目不是有效 JSON。'); }
  if (!raw || typeof raw.question !== 'string' || typeof raw.correct !== 'string' ||
      !Array.isArray(raw.wrong) || raw.wrong.length !== 3 || raw.wrong.some(v => typeof v !== 'string')) {
    throw Error('AI 題目缺少題幹、正解或三個干擾選項。');
  }
  const options = [raw.correct, ...raw.wrong].map(v => v.trim());
  if (!raw.question.trim() || options.some(v => !v || v.length > 1200) ||
      new Set(options).size !== 4 || raw.question.length > 4000) {
    throw Error('AI 題目為空、選項重複或文字超過上限。');
  }
  const explanation = typeof raw.explanation === 'string' ? raw.explanation : '';
  if (explanation.length > 4000) throw Error('AI 回傳的解析過長。');
  return { question: raw.question.trim(), options, answerIndex: 0,
    explanation, knowledge_points: labelsOf(raw, subject) };
}
export function renderClassroomEditor(state, helpers) {
  const { escape: e, button, subjectNames, subjects, field } = helpers;
  const editor = state.editor;
  const selected = Math.min(Math.max(0, Number(state.editorIndex) || 0), editor.questions.length - 1);
  const q = editor.questions[selected];
  const choices = ['A', 'B', 'C', 'D'];
  const pointId = q.knowledge_points?.[0]?.id || '';
  const points = '<option value="">未標記</option>' + subjects.map(s =>
    '<optgroup label="' + e(s.name) + '">' + s.points.map(p =>
      '<option value="' + e(p.id) + '" ' + (p.id === pointId ? 'selected' : '') + '>' + e(p.name) + '</option>'
    ).join('') + '</optgroup>').join('');
  const subjectOptions = ['綜合', ...subjectNames].map(s =>
    '<option value="' + e(s) + '" ' + (s === editor.subject ? 'selected' : '') + '>' + e(s) + '</option>').join('');
  const answerOptions = choices.map((v, i) =>
    '<option value="' + i + '" ' + (i === q.answerIndex ? 'selected' : '') + '>' + v + '</option>').join('');
  const nav = editor.questions.map((item, i) => {
    const ready = Boolean(item.question?.trim()) && item.options.every(v => String(v || '').trim());
    const preview = String(item.question || '尚未填寫題目').trim().slice(0, 38);
    return button('editor-select', '<span class="cc-editor-number">' + String(i + 1).padStart(2, '0') +
      '</span><span class="cc-editor-nav-text">' + e(preview) + '</span><span class="cc-editor-nav-status">' +
      (ready ? '✓' : '·') + '</span>',
      'data-index="' + i + '" aria-current="' + (i === selected ? 'true' : 'false') + '"' +
      ' aria-label="切換至第 ' + (i + 1) + ' 題"');
  }).join('');
  const generation = AI_BATCH_CHOICES.map(count => button('generate-question', 'AI 產生 ' + count + ' 題',
    'data-count="' + count + '" ' + (editor.questions.length >= MAX_CLASSROOM_QUESTIONS ? 'disabled' : ''))).join('');
  const question = '<section class="cc-card cc-editor-question cc-form"><div class="cc-editor-question-heading">' +
    '<div><h4>第 ' + (selected + 1) + ' 題</h4><p class="cc-muted">可直接修改題目、選項與正確答案</p></div>' +
    '<div class="cc-actions">' +
    button('editor-up', '上移', selected === 0 ? 'disabled' : '') +
    button('editor-down', '下移', selected === editor.questions.length - 1 ? 'disabled' : '') +
    button('editor-duplicate', '複製此題', editor.questions.length >= MAX_CLASSROOM_QUESTIONS ? 'disabled' : '') +
    button('remove-question', '刪除此題', editor.questions.length <= 1 ? 'disabled' : '') +
    '</div></div>' +
    '<label>題目<textarea name="question-' + selected + '" required maxlength="4000">' + e(q.question) + '</textarea></label>' +
    '<div class="cc-fields">' + q.options.map((value, i) =>
      field('option-' + selected + '-' + i, '選項 ' + choices[i], value, 'required maxlength="1200"')).join('') + '</div>' +
    '<div class="cc-fields"><label>正確答案<select name="answer-' + selected + '">' + answerOptions + '</select></label>' +
    '<label>知識點（選填）<select name="point-' + selected + '">' + points + '</select></label></div>' +
    '<label>解析（選填）<textarea name="explanation-' + selected + '" maxlength="4000">' +
    e(q.explanation || '') + '</textarea></label>' +
    '<div class="cc-editor-next">' +
    button('editor-select', '上一題', 'data-index="' + (selected - 1) + '" ' + (selected === 0 ? 'disabled' : '')) +
    '<span class="cc-muted">' + (selected + 1) + ' / ' + editor.questions.length + '</span>' +
    button('editor-select', '下一題', 'data-index="' + (selected + 1) + '" ' +
      (selected === editor.questions.length - 1 ? 'disabled' : '')) + '</div></section>';
  return '<div class="cc-editor-shell">' +
    '<div class="cc-toolbar"><div><h3>' + (editor.id ? '編輯作業草稿' : '新增班級作業') +
    '</h3><p class="cc-muted">發布前請確認所有題目；已發布作業不得修改題組。</p></div>' +
    button('back', '返回班級') + '</div>' +
    '<form id="cc-editor" class="cc-form">' +
    '<section class="cc-card cc-form cc-editor-settings"><h4>作業設定</h4>' +
    field('title', '作業名稱', editor.title || '', 'required maxlength="80"') +
    '<div class="cc-fields"><label>科目<select name="subject">' + subjectOptions + '</select></label>' +
    field('dueLocal', '截止時間（選填）', editor.dueLocal || '', 'type="datetime-local"') + '</div>' +
    '<details class="cc-editor-ai"><summary>AI 批次出題</summary><div class="cc-form">' +
    field('topic', '出題範圍', editor.topic || '', 'maxlength="180"') +
    field('level', '適用年級', editor.level || '國中一年級', 'maxlength="32"') +
    '<div class="cc-actions">' + generation + '</div>' +
    '<p class="cc-muted">每次最多三個請求同時產生；有重複或格式不完整的題目會略過，所有題目仍需教師核對。</p>' +
    '<span id="cc-ai-batch-status" class="cc-muted" role="status"></span></div></details></section>' +
    '<div class="cc-editor-layout"><aside class="cc-card cc-editor-side">' +
    '<div class="cc-editor-side-head"><h4>題目清單</h4><span class="cc-muted">' + editor.questions.length + ' / 30</span></div>' +
    '<nav class="cc-editor-question-nav" aria-label="切換編輯題目">' + nav + '</nav>' +
    '<div class="cc-editor-add">' + button('add-question', '＋ 新增一題',
      editor.questions.length >= MAX_CLASSROOM_QUESTIONS ? 'disabled' : '') + '</div></aside>' +
    question + '</div>' +
    '<footer class="cc-editor-footer"><div class="cc-editor-save-note">' +
    '<strong id="cc-editor-save-status" role="status">' + e(state.editorSaveLabel || '修改後會在題目完整時自動儲存') +
    '</strong><small>僅儲存草稿，不會自動發布</small></div>' +
    '<div class="cc-actions">' + button('save-draft', '儲存草稿') +
    button('save-preview', '儲存並預覽', 'class="cc-primary"') + '</div></footer>' +
    '</form></div>';
}
export function renderClassroomCopy(state, helpers) {
  const { escape: e, button } = helpers;
  const source = state.copySource;
  const rooms = state.copyTargets || [];
  const result = state.copyResults;
  const available = rooms.filter(r => r.status === 'active');
  const selected = new Set(state.copySelected || []);
  const targetList = rooms.map(room => '<label class="cc-copy-target"><input type="checkbox" name="targetClass" value="' +
    e(room.id) + '" ' + (room.status !== 'active' ? 'disabled' : selected.has(room.id) ? 'checked' : '') +
    '><span><strong>' + e(room.name) + '</strong><small>' + room.studentCount +
    ' 位學生' + (room.status === 'active' ? '' : ' · 已封存') + '</small></span></label>').join('');
  const details = result ? '<div class="cc-card cc-copy-result"><h4>複製結果</h4>' +
    '<p>成功建立 ' + result.success.length + ' 份草稿；失敗 ' + result.failures.length + ' 份。</p>' +
    '<div class="cc-form">' + result.success.map(row => '<div class="cc-copy-result-row">' + e(row.className) +
      ' · ' + button('copy-open', '編輯新草稿', 'data-class-id="' + e(row.classId) +
      '" data-id="' + e(row.id) + '"') + '</div>').join('') +
    result.failures.map(row => '<p class="cc-muted">' + e(row.className + '：' + row.message) + '</p>').join('') +
    '</div></div>' : '';
  return '<div class="cc-copy-shell"><div class="cc-toolbar"><div><h3>重用作業題組</h3>' +
    '<p class="cc-muted">會建立獨立的作業草稿，原作業和所有成績完全不受影響。</p></div>' +
    button('back', '返回教室') + '</div>' +
    '<section class="cc-card"><span class="cc-muted">來源作業</span><h4>' + e(source.title) + '</h4>' +
    '<p class="cc-muted">' + e(source.subject) + ' · ' + source.questionCount + ' 題</p></section>' +
    '<form id="cc-copy" class="cc-form"><section class="cc-card cc-form"><h4>選擇目標教室</h4>' +
    '<p class="cc-muted">可同時選多個教室，各自建立草稿；須逐份審核發布。預設不帶入舊截止時間。</p>' +
    '<div class="cc-copy-target-grid">' + targetList + '</div>' +
    (state.copyCursor ? button('copy-more-classes', '載入更多教室') : '') +
    '<label>新草稿名稱（選填，各教室使用同名）<input name="title" maxlength="80" value="' +
    e(state.copyTitle || '') + '" placeholder="預設：原作業名稱（副本）"></label>' +
    '<div class="cc-actions">' + button('copy-confirm', '建立所選教室草稿', 'class="cc-primary" ' + (!available.length ? 'disabled' : '')) + '</div>' +
    '</section></form>' + details + '</div>';
}

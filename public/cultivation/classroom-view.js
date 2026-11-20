
export const CLASSROOM_TABS = Object.freeze([
  ['summary', '總覽'], ['assignments', '作業'], ['students', '學生'],
  ['grades', '成績'], ['notices', '公告'], ['settings', '設定']
]);
export function tabsForClass(teacher) {
  return CLASSROOM_TABS.filter(([id]) => teacher || (id !== 'students' && id !== 'grades'));
}
export function buildClassroomView(state, helpers) {
  const { escape: e, date, status, button, currentUid } = helpers;
  const room = state.classroom;
  const teacher = room.role === 'teacher';
  const tabs = tabsForClass(teacher);
  const tab = tabs.some(([id]) => id === state.classTab) ? state.classTab : 'summary';
  const tasks = [...state.assignments].reverse();
  const active = tasks.filter(a => a.status === 'published' && (!a.dueAtMs || a.dueAtMs > Date.now()));
  const pending = active.filter(a => a.submission?.status !== 'submitted');
  const attr = id => 'data-id="' + e(id) + '"';
  const bar = (title, action = '') => `<div class="cc-section-title"><h3>${title}</h3>${action}</div>`;
  function assignment(a, compact = false) {
    let actions = '';
    if (teacher && a.status === 'draft') {
      actions = button('edit', '編輯', attr(a.id)) + button('preview', '預覽發布', attr(a.id));
      if (!compact) actions += button('delete-draft', '刪除草稿', attr(a.id) + ' class="cc-danger"');
    } else if (teacher) {
      actions = button('report', '查看成績', attr(a.id));
      if (!compact) actions += button('preview', '查看題組', attr(a.id));
    } else {
      actions = button('work', a.submission?.status === 'submitted' ? '結果與訂正' : '開啟作業', attr(a.id));
    }
    if (teacher && !compact) actions += button('copy-assignment', '複製為草稿', attr(a.id));
    const filter = teacher ? a.status : a.submission?.status === 'submitted' ? 'submitted' : 'pending';
    const extra = compact ? '' : 'data-cc-item="assignment" data-cc-filter="' + filter +
      '" data-cc-search="' + e(a.title + ' ' + a.subject) + '"';
    const late = a.status === 'published' && a.dueAtMs && a.dueAtMs < Date.now();
    return `<article class="cc-card cc-task" ${extra}>
      <div class="cc-task-header"><h4>${e(a.title)}</h4><span class="cc-tag">${status(teacher ? a.status : a.submission?.status)}</span></div>
      <p class="cc-muted">${e(a.subject)} · ${a.questionCount} 題 · ${late ? '已到截止時間' : '截止：' + date(a.dueAtMs)}</p>
      <div class="cc-actions cc-task-actions">${actions}</div></article>`;
  }
  function notices(limit = 20, editable = false) {
    const rows = (room.notices || []).slice(0, limit);
    if (!rows.length) return '<p class="cc-empty">目前沒有公告。</p>';
    return rows.map(n => `<div class="cc-notice-entry">
      <div class="cc-notice-top"><span class="cc-muted">${date(n.createdAtMs)}</span>
      ${editable ? button('delete-notice', '刪除', attr(n.id) + ' class="cc-danger"') : ''}</div>
      <div class="cc-notice-body">${e(n.content)}</div></div>`).join('');
  }
  const metrics = teacher
    ? [['學生人數', room.studentCount], ['進行中作業', active.length], ['草稿', tasks.filter(a => a.status === 'draft').length]]
    : [['班級作業', tasks.length], ['待完成', pending.length], ['已繳交', tasks.filter(a => a.submission?.status === 'submitted').length]];
  const metricsHtml = '<div class="cc-metrics">' + metrics.map(([name, value]) =>
    '<div class="cc-metric"><span>' + name + '</span><strong>' + value + '</strong></div>').join('') + '</div>';
  let panel = '';
  if (tab === 'summary') {
    const recent = teacher ? tasks.slice(0, 3) :
      [...pending, ...tasks.filter(a => !pending.includes(a))].slice(0, 3);
    const create = teacher && room.status === 'active' ?
      button('new-assignment', '＋ 新增作業', 'class="cc-primary"') : '';
    panel = metricsHtml + '<section class="cc-section">' +
      bar(teacher ? '最近作業' : '我的學習任務', create) +
      (recent.length ? '<div class="cc-task-grid">' + recent.map(a => assignment(a, true)).join('') + '</div>' :
        '<p class="cc-empty">目前沒有班級作業。</p>') +
      '<div class="cc-section-footer">' + button('class-tab', '查看全部作業', 'data-tab="assignments"') + '</div></section>' +
      '<section class="cc-section">' + bar('最新公告', button('class-tab', '全部公告', 'data-tab="notices"')) +
      '<div class="cc-card">' + notices(2) + '</div></section>';
  } else if (tab === 'assignments') {
    const choices = teacher ? [['all','全部'],['draft','草稿'],['published','已發布'],['closed','已結束']] :
      [['all','全部'],['pending','待完成'],['submitted','已繳交']];
    const create = teacher ? button('new-assignment', '＋ 新增作業',
      room.status === 'active' ? 'class="cc-primary"' : 'disabled') : '';
    const filters = choices.map(([id, label]) => button('assignment-filter', label,
      'data-filter="' + id + '" aria-pressed="' + ((state.assignmentFilter || 'all') === id) + '"')).join('');
    panel = bar('班級作業', create) +
      '<div class="cc-list-tools"><label class="cc-search">搜尋作業<input data-cc-search="assignment" type="search" autocomplete="off" ' +
      'placeholder="作業名稱或科目" value="' + e(state.assignmentSearch || '') + '"></label>' +
      '<div class="cc-filters" aria-label="作業篩選">' + filters + '</div></div>' +
      '<div class="cc-task-grid">' + tasks.map(a => assignment(a)).join('') + '</div>' +
      (tasks.length ? '<p class="cc-empty" data-cc-empty="assignment" hidden>沒有符合條件的作業。</p>' :
        '<p class="cc-empty">目前尚無作業。</p>');
  } else if (tab === 'students') {
    if (typeof helpers.rosterPanel === 'function') panel = helpers.rosterPanel(state, helpers);
    else {
    const members = (room.members || []).slice().sort((a, b) =>
      (a.seat || '').localeCompare(b.seat || '', 'zh-Hant', { numeric:true }));
    panel = bar('學生名單') + '<p class="cc-muted">共 ' + members.length + ' 位學生；可以搜尋姓名或座號。</p>' +
      '<div class="cc-list-tools"><label class="cc-search">尋找學生<input data-cc-search="student" type="search" ' +
      'placeholder="姓名或座號" value="' + e(state.studentSearch || '') + '"></label></div>' +
      '<div class="cc-student-grid">' + members.map(m =>
        `<div class="cc-card cc-student" data-cc-item="student" data-cc-search="${e((m.seat || '') + ' ' + m.name)}">
          <span class="cc-seat">${e(m.seat || '—')}</span><strong>${e(m.name)}</strong>
          ${button('remove-student', '移出班級', attr(m.uid) + ' data-name="' + e(m.name) + '" class="cc-danger"')}</div>`).join('') +
      '</div>' + (members.length ? '<p class="cc-empty" data-cc-empty="student" hidden>沒有符合條件的學生。</p>' :
        '<p class="cc-empty">尚無學生加入。可從設定頁複製加入碼。</p>');
    }
  } else if (tab === 'grades') {
    const graded = tasks.filter(a => a.status !== 'draft');
    panel = bar('成績與學習分析', button('overview', '學習總覽', 'class="cc-primary"')) +
      '<p class="cc-muted">查看各份作業的繳交、正確率與訂正狀況。學習總覽只在點擊後載入。</p>' +
      (graded.length ? '<div class="cc-task-grid">' + graded.map(a => assignment(a, true)).join('') + '</div>' :
        '<p class="cc-empty">尚無已發布作業。</p>');
  } else if (tab === 'notices') {
    const composer = teacher && room.status === 'active'
      ? '<section class="cc-card"><form data-form="notice" class="cc-form">' +
        '<label>新增公告<textarea name="content" maxlength="1000" required ' +
        'placeholder="例如：下週課程進度、作業提醒"></textarea></label><div class="cc-actions">' +
        button('post-notice', '發布公告', 'class="cc-primary"') + '</div></form></section>' : '';
    panel = bar('班級公告') + composer + '<section class="cc-card">' + notices(20, teacher) + '</section>';
  } else {
    const teacherAssign = teacher && state.access?.isAdmin ?
      '<section class="cc-card"><details><summary>指派班級教師</summary><form class="cc-form" data-form="assign">' +
      '<label>已核准教師<select name="teacherUid"><option value="' + e(currentUid) + '">由我（管理員）管理</option>' +
      (state.approvedTeachers || []).map(a =>
        '<option value="' + e(a.uid) + '" ' + (a.uid === room.ownerUid ? 'selected' : '') + '>' +
        e(a.name) + ' · ' + e(a.school) + '（' + e(a.uid) + '）</option>').join('') +
      '</select></label><div class="cc-actions">' + button('assign-teacher','指派教師') +
      (state.nextApprovedCursor ? button('more-approved','載入更多教師') : '') +
      '</div></form></details></section>' : '';
    panel = teacher ? bar('班級設定') +
      '<section class="cc-card"><h4>班級加入碼</h4><p class="cc-muted">分享給學生；更新後舊碼將失效。</p>' +
      '<div class="cc-code-row"><code class="cc-code">' + e(room.joinCode) + '</code>' +
      button('copy-code','複製加入碼') + button('rotate-code','更新加入碼') + '</div></section>' +
      '<section class="cc-card"><h4>班級名稱</h4><form class="cc-form cc-name-form" data-form="rename">' +
      '<label>名稱<input name="name" value="' + e(room.name) + '" required maxlength="60"></label>' +
      button('rename','儲存名稱') + '</form></section>' + teacherAssign +
      '<section class="cc-card cc-danger-zone"><h4>封存班級</h4>' +
      '<p class="cc-muted">封存後停止加入及繳交，名單與成績保留。</p>' +
      button('archive', room.status === 'active' ? '封存班級' : '恢復班級',
        room.status === 'active' ? 'class="cc-danger"' : '') + '</section>' :
      bar('班級資訊') + '<section class="cc-card"><h4>' + e(room.name) + '</h4><p>教師：' +
      e(room.teacherName) + '</p><p class="cc-muted">退出後無法存取此班級作業。</p>' +
      button('leave','退出班級','class="cc-danger"') + '</section>';
  }
  const nav = tabs.map(([id, label]) => button('class-tab', label,
    'role="tab" id="cc-tab-' + id + '" aria-controls="cc-class-panel" data-tab="' + id +
    '" aria-selected="' + (tab === id) + '" tabindex="' + (tab === id ? 0 : -1) + '"')).join('');
  return `<div class="cc-classroom"><header class="cc-class-header">
    <div class="cc-class-title"><span class="cc-eyebrow">青雲問道 · 班級教室</span>
      <h2>${e(room.name)}</h2><p>${e(room.teacherName)} · ${room.studentCount} 位學生
      ${room.status === 'archived' ? ' · 已封存' : ''}</p></div>
    <div class="cc-header-actions">${button('home','返回班級')}${button('refresh','重新整理')}</div></header>
    <nav class="cc-class-tabs" aria-label="教室功能" role="tablist">${nav}</nav>
    <section id="cc-class-panel" class="cc-class-panel" role="tabpanel" aria-labelledby="cc-tab-${tab}">${panel}</section>
  </div>`;
}

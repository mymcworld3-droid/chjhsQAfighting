
export function summarizeTeacherWorkspace(dashboard, now = Date.now()) {
  const classes = dashboard?.classes || [];
  const assignments = classes.flatMap(room => (room.assignments || []).map(a => ({
    ...a, classId: room.id, className: room.name, classStatus: room.status
  })));
  const drafts = assignments.filter(a => a.status === 'draft' && a.classStatus === 'active');
  const overdue = assignments.filter(a => a.classStatus === 'active' && a.status === 'published' && a.dueAtMs && a.dueAtMs <= now);
  const dueSoon = assignments.filter(a => a.classStatus === 'active' && a.status === 'published' && a.dueAtMs && a.dueAtMs > now && a.dueAtMs <= now + 3 * 86400000);
  const attention = [...overdue, ...dueSoon, ...drafts].sort((a,b) => {
    const priority = a => a.status === 'draft' ? 2 : a.dueAtMs <= now ? 0 : 1;
    return priority(a) - priority(b) || (a.dueAtMs || 0) - (b.dueAtMs || 0);
  });
  return { classes, assignments, drafts, overdue, dueSoon, attention,
    students: classes.reduce((sum, room) => sum + room.studentCount, 0),
    activeClasses: classes.filter(room => room.status === 'active').length };
}
export function buildTeacherWorkspace(state, helpers) {
  const { escape: esc, date, status, button } = helpers;
  const dashboard = state.dashboard;
  const tab = ['summary', 'classes', 'tasks'].includes(state.workspaceTab) ? state.workspaceTab : 'summary';
  const model = summarizeTeacherWorkspace(dashboard);
  const btn = (action, label, attrs = '') => button(action, label, attrs);
  const roomAttr = room => 'data-id="' + esc(room.id) + '"';
  const taskAttr = task => 'data-id="' + esc(task.id) + '" data-class-id="' + esc(task.classId) + '"';
  const notices = [];
  function title(label, detail = '', tools = '') {
    return '<div class="cc-workspace-section-title"><div><h3>' + label + '</h3>' + (detail ? '<p class="cc-muted">' + detail + '</p>' : '') + '</div>' + tools + '</div>';
  }
  function classCard(room) {
    const current = (room.assignments || []).filter(a => a.status === 'published' && (!a.dueAtMs || a.dueAtMs > Date.now())).length;
    const draft = (room.assignments || []).filter(a => a.status === 'draft').length;
    return '<article class="cc-card cc-workspace-room">' +
      '<div class="cc-workspace-room-head"><h4>' + esc(room.name) + '</h4>' +
      (room.status === 'archived' ? '<span class="cc-tag">已封存</span>' : '') + '</div>' +
      '<p class="cc-muted">' + room.studentCount + ' 位學生 · 近期 ' + current + ' 份進行中作業' +
        (draft ? ' · ' + draft + ' 份草稿' : '') + '</p>' +
      '<div class="cc-actions">' + btn('workspace-class', '進入教室', roomAttr(room)) +
      btn('workspace-new', '新增作業', roomAttr(room) + (room.status !== 'active' ? ' disabled' : ' class="cc-primary"')) +
      btn('workspace-grades', '查看成績', roomAttr(room)) + '</div></article>';
  }
  function actionTag(task) {
    if (task.status === 'draft') return '草稿待審核';
    if (task.dueAtMs && task.dueAtMs <= Date.now() && task.status === 'published') return '已過截止';
    if (task.dueAtMs && task.dueAtMs <= Date.now() + 3 * 86400000 && task.status === 'published') return '即將截止';
    return status(task.status);
  }
  function taskCard(task) {
    const attrs = taskAttr(task);
    const progress = state.workspaceProgress?.[task.classId + ':' + task.id];
    const filter = task.status === 'draft' ? 'draft' :
      task.status === 'published' && task.dueAtMs && task.dueAtMs <= Date.now() ? 'overdue' :
      task.status === 'published' && task.dueAtMs && task.dueAtMs <= Date.now() + 3 * 86400000 ? 'soon' : task.status;
    const info = task.dueAtMs ? '截止：' + date(task.dueAtMs) : '不限截止時間';
    const actions = task.status === 'draft'
      ? btn('workspace-edit', '編輯草稿', attrs) + btn('workspace-preview', '預覽發布', attrs)
      : btn('workspace-report', '成績報表', attrs) + btn('workspace-progress', '查看繳交', attrs);
    const details = progress ? '<div class="cc-workspace-progress"><strong>已繳交 ' +
      progress.submitted + ' / ' + progress.studentCount + '</strong><p class="cc-muted">' +
      '作答中 ' + progress.inProgress + ' · 未開始 ' + progress.notStarted + '</p>' +
      (progress.pendingCount ?
        '<p class="cc-muted">尚未繳交 ' + progress.pendingCount + ' 人' +
        (progress.pendingCount > progress.pendingStudents.length ? '（顯示前 ' + progress.pendingStudents.length + ' 位）' : '') + '</p>' +
        '<div class="cc-workspace-pending">' + progress.pendingStudents.map(p =>
          '<span>' + esc(p.seat || '—') + ' · ' + esc(p.name) + '</span>').join('') + '</div>' :
        '<p class="cc-muted">目前學生皆已繳交。</p>') + '</div>' : '';
    return '<article class="cc-card cc-workspace-task" data-workspace-task data-workspace-filter="' + filter +
      '" data-workspace-status="' + task.status + '" data-workspace-search="' +
      esc(task.title + ' ' + task.subject + ' ' + task.className) + '">' +
      '<div class="cc-workspace-task-head"><div><span class="cc-muted">' + esc(task.className) +
      '</span><h4>' + esc(task.title) + '</h4></div><span class="cc-tag">' + esc(actionTag(task)) + '</span></div>' +
      '<p class="cc-muted">' + esc(task.subject) + ' · ' + task.questionCount + ' 題 · ' + esc(info) + '</p>' +
      '<div class="cc-actions">' + actions + '</div>' + details + '</article>';
  }
  const hero = '<header class="cc-workspace-hero"><div><span class="cc-eyebrow">青雲問道 · 教學管理</span>' +
    '<h2>教師工作台</h2><p>從這裡管理所有教室、安排作業、追蹤學生學習。</p></div>' +
    '<div class="cc-actions">' +
    (state.access?.isAdmin ? btn('teacher-accounts', '教師帳號審核') : '') +
    btn('workspace-refresh', '更新工作台') + '</div></header>';
  const jump = '<section class="cc-workspace-section">' + title('快捷操作') +
    '<div class="cc-workspace-quick">' +
    btn('workspace-tab', '我的教室', 'data-tab="classes"') +
    btn('workspace-tab', '近期作業', 'data-tab="tasks"') +
    btn('workspace-cave', '教師洞天') +
    (state.access?.isAdmin ? btn('workspace-create', '管理員建班') : '') +
    '</div></section>';
  const navigation = '<nav class="cc-workspace-tabs" role="tablist" aria-label="教師工作台選單">' +
    [['summary','總覽'],['classes','我的教室'],['tasks','作業與待辦']].map(([id,label]) =>
      btn('workspace-tab', label, 'data-tab="' + id + '" role="tab" id="cc-workspace-tab-' + id +
        '" aria-controls="cc-workspace-panel" aria-selected="' + (tab === id) + '" tabindex="' + (tab === id ? 0 : -1) + '"')).join('') + '</nav>';
  if (!dashboard && state.workspaceLoading) return hero +
    '<section class="cc-card" role="status"><h3>正在整理教師工作台</h3><p class="cc-muted">讀取近期作業與班級資訊，不會批次查詢學生作答資料。</p></section>';
  if (!dashboard) return hero + '<section class="cc-card cc-workspace-unavailable"><h3>無法載入工作台總覽</h3>' +
    '<p>班級入口仍可使用。請重新整理，或稍後再試。</p>' +
    (state.workspaceError ? '<p class="cc-muted">' + esc(state.workspaceError) + '</p>' : '') +
    btn('workspace-refresh', '重新載入') + '</section>';
  const metrics = '<div class="cc-workspace-metrics">' +
    [['管理班級',model.classes.length],['班級學生',model.students],['近期草稿',model.drafts.length],
      ['三日內截止',model.dueSoon.length]].map(([label,value]) =>
      '<div class="cc-metric"><span>' + label + '</span><strong>' + value + '</strong></div>').join('') +
    '</div>';
  const note = '<p class="cc-muted cc-workspace-scope">統計範圍：每班最近六份作業；只有按下「查看繳交」才讀取學生作答紀錄。' +
    (dashboard.nextCursor ? ' 還有其他班級可載入。' : '') + '</p>';
  const loaded = dashboard.nextCursor ? '<div class="cc-workspace-more">' +
    btn('workspace-more', '載入更多班級') + '</div>' : '';
  let body;
  if (tab === 'summary') {
    const attention = model.attention.slice(0, 5);
    body = metrics + note + jump +
      '<section class="cc-workspace-section">' + title('需要留意', '近期截止、已過截止與待發布草稿，並非未繳交人數。',
        btn('workspace-tab', '所有近期作業', 'data-tab="tasks"')) +
      (attention.length ? '<div class="cc-workspace-task-grid">' + attention.map(taskCard).join('') + '</div>' :
        '<p class="cc-empty">最近六份作業內沒有需要立即留意的事項。</p>') + '</section>' +
      '<section class="cc-workspace-section">' + title('我的教室', '', btn('workspace-tab','全部教室','data-tab="classes"')) +
      (model.classes.length ? '<div class="cc-workspace-room-grid">' + model.classes.slice(0,4).map(classCard).join('') + '</div>' :
        '<p class="cc-empty">目前尚未有獲指派的班級；請管理員協助指派。教師洞天仍可使用。</p>') + '</section>' + loaded;
  } else if (tab === 'classes') {
    body = metrics + note +
      '<section class="cc-workspace-section">' + title('我的教室', '每個班級可直接新增作業、查看成績或進入教室。') +
      (model.classes.length ? '<div class="cc-workspace-room-grid">' + model.classes.map(classCard).join('') + '</div>' :
        '<p class="cc-empty">尚未有可管理的班級，請聯繫管理員指派。</p>') + '</section>' + loaded;
  } else {
    const filter = state.workspaceFilter || 'all';
    const buttons = [['all','全部'],['draft','草稿'],['soon','即將截止'],['overdue','已過截止'],['published','已發布'],['closed','已結束']];
    body = metrics + note + '<section class="cc-workspace-section">' +
      title('作業與待辦', '跨班級列出近期作業，可直接編輯草稿、查看成績或載入繳交概況。') +
      '<div class="cc-workspace-tools"><label class="cc-search">搜尋作業' +
      '<input type="search" data-workspace-search-input placeholder="作業、科目或班級名稱" autocomplete="off" value="' +
      esc(state.workspaceSearch || '') + '"></label><div class="cc-filters">' +
      buttons.map(([id,label]) => btn('workspace-filter',label,'data-filter="' + id + '" aria-pressed="' +
        (filter === id) + '"')).join('') + '</div></div>' +
      '<div class="cc-workspace-task-grid">' + model.assignments.map(taskCard).join('') + '</div>' +
      (model.assignments.length ? '<p class="cc-empty" data-workspace-empty hidden>沒有符合條件的作業。</p>' :
        '<p class="cc-empty">目前尚無近期作業。</p>') + '</section>' + loaded;
  }
  return '<div class="cc-teacher-workspace">' + hero + navigation +
    '<div class="cc-workspace-panel" role="tabpanel" id="cc-workspace-panel" aria-labelledby="cc-workspace-tab-' +
    tab + '">' + body + '</div></div>';
}

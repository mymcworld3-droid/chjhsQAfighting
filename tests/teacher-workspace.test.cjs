'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/teacher-workspace.js'));
const workspace = import('data:text/javascript;base64,' + source.toString('base64'));
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const helpers = {
  escape, date: value => value ? '2026/11/22' : '不限時間',
  status: value => ({ draft: '草稿', published: '進行中', closed: '已結束' }[value] || '未開始'),
  button: (action, label, attrs = '') => '<button data-action="' + action + '" ' + attrs + '>' + label + '</button>'
};
const NOW = Date.now();
function dashboard() {
  return { classes: [
    { id:'math', name:'七年一班', status:'active', studentCount:32, assignments: [
      { id:'a1', title:'<script>錯誤標題</script>', subject:'數學', status:'draft', questionCount:10, dueAtMs:null },
      { id:'a2', title:'代數練習', subject:'數學', status:'published', questionCount:20, dueAtMs:NOW + 86400000 }
    ] },
    { id:'science', name:'八年二班', status:'archived', studentCount:23, assignments: [
      { id:'a3', title:'物理複習', subject:'自然', status:'closed', questionCount:12, dueAtMs:NOW - 86400000 }
    ] }
  ], scope:'每班最近六份作業',nextCursor:null };
}
test('dashboard aggregates bounded cross-class data without inventing submissions', async () => {
  const { summarizeTeacherWorkspace } = await workspace;
  const model = summarizeTeacherWorkspace(dashboard(), NOW);
  assert.equal(model.students, 55);
  assert.equal(model.classes.length, 2);
  assert.equal(model.drafts.length, 1);
  assert.equal(model.dueSoon.length, 1);
  assert.equal(model.overdue.length, 0);
  assert.equal(model.assignments.length, 3);
  assert.equal(model.attention[0].id, 'a2');
  assert.equal(model.attention[1].id, 'a1');
  assert.ok(!JSON.stringify(model).includes('王同學'));
});
test('teacher workspace offers functional class, assignment, cave, and on-demand report actions', async () => {
  const { buildTeacherWorkspace } = await workspace;
  const state = { access:{isAdmin:false}, dashboard:dashboard(), workspaceTab:'summary' };
  const home = buildTeacherWorkspace(state, helpers);
  assert.match(home, /教師工作台/);
  assert.match(home, /data-action="workspace-cave"/);
  assert.match(home, /data-action="workspace-new"/);
  assert.match(home, /data-action="workspace-grades"/);
  assert.match(home, /data-action="workspace-progress"/);
  assert.doesNotMatch(home, /管理員建班|教師帳號審核|已繳交 0/);
  assert.ok(home.includes('&lt;script&gt;'));
  assert.ok(!home.includes('<script>'));
  state.workspaceTab = 'classes';
  assert.equal((buildTeacherWorkspace(state, helpers).match(/cc-workspace-room-head/g) || []).length, 2);
  state.workspaceTab = 'tasks';
  const tasks = buildTeacherWorkspace(state, helpers);
  assert.match(tasks, /data-workspace-search-input/);
  assert.match(tasks, /data-action="workspace-edit"/);
  assert.match(tasks, /data-workspace-filter="draft"/);
});
test('progress names appear only after explicit load and are escaped; admin gets existing create action', async () => {
  const { buildTeacherWorkspace } = await workspace;
  const state = { access:{isAdmin:true}, dashboard:dashboard(), workspaceTab:'tasks',
    workspaceProgress:{ 'math:a2': {
      classId:'math', assignmentId:'a2', studentCount:32, submitted:28, inProgress:2,
      notStarted:2, pendingCount:4, pendingStudents:[{name:'王<script>甲</script>',seat:'3'}]
    } }
  };
  const result = buildTeacherWorkspace(state, helpers);
  assert.match(result, /已繳交 28 \/ 32/);
  assert.match(result, /尚未繳交 4 人/);
  assert.match(result, /&lt;script&gt;/);
  state.workspaceTab = 'summary';
  const adminSummary = buildTeacherWorkspace(state, helpers);
  assert.match(adminSummary, /data-action="workspace-create"/);
  assert.match(result, /data-action="teacher-accounts"/);
  assert.doesNotMatch(result, /<script>/);
});
test('empty teacher dashboard displays guidance and never fabricates class data', async () => {
  const { buildTeacherWorkspace } = await workspace;
  const html = buildTeacherWorkspace({ access:{isAdmin:false}, dashboard:{ classes:[],nextCursor:null },workspaceTab:'summary' },helpers);
  assert.match(html, /尚未有獲指派的班級/);
  assert.doesNotMatch(html, /未繳交 0 人/);
});

test('teacher workspace distinguishes loading from errors and ignores archived-class deadlines', async () => {
  const { buildTeacherWorkspace, summarizeTeacherWorkspace } = await workspace;
  const loading = buildTeacherWorkspace({ access:{isAdmin:false}, workspaceLoading:true }, helpers);
  assert.match(loading, /正在整理教師工作台/);
  assert.doesNotMatch(loading, /無法載入/);
  const empty = buildTeacherWorkspace({ access:{isAdmin:false}, workspaceError:'暫時無法連線' }, helpers);
  assert.match(empty, /暫時無法連線/);
  const data = dashboard();
  data.classes[1].assignments[0].status = 'published';
  data.classes[1].assignments[0].dueAtMs = NOW + 86400000;
  assert.equal(summarizeTeacherWorkspace(data, NOW).dueSoon.length, 1);
});

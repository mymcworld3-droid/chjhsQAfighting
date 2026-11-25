'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

Object.assign(globalThis,require('./helpers/presentations.cjs'));
const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/classroom-view.js'));
const renderer = import('data:text/javascript;base64,' + Buffer.from(source.toString().replace(/^import .*;\n/gm,'')).toString('base64'));
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const helpers = {
  escape, date: value => value ? '2026/11/23' : '不限時間',
  status: value => ({ draft:'草稿', published:'進行中', closed:'已結束', submitted:'已繳交' }[value] || '未開始'),
  button: (action, label, attrs = '') => '<button data-action="' + action + '" ' + attrs + '>' + label + '</button>',
  currentUid:'admin'
};
function setup(role = 'teacher') {
  return {
    classTab: 'summary',
    access: { isAdmin: role === 'teacher' },
    classroom: {
      id: 'c1', name:'七年一班', teacherName:'陳老師', role, studentCount:2,
      ownerUid:'admin', status:'active', joinCode:'ABCDEFGH',
      notices:[{id:'n1',content:'公告 <script>alert(1)</script>',createdAtMs:1900000000000}],
      members:[{uid:'s1',name:'王同學',seat:'2'}, {uid:'s2',name:'李同學',seat:'1'}]
    },
    approvedTeachers:[],
    assignments: role === 'teacher' ? [
      {id:'a1',title:'待發布草稿',status:'draft',subject:'數學',questionCount:2,dueAtMs:null},
      {id:'a2',title:'代數練習',status:'published',subject:'數學',questionCount:2,dueAtMs:null}
    ] : [{id:'a2',title:'代數練習',status:'published',subject:'數學',questionCount:2,dueAtMs:null,submission:{status:'in-progress'}}]
  };
}
test('teacher classroom has exactly six accessible tabs and a compact summary', async () => {
  const { buildClassroomView } = await renderer;
  const html = buildClassroomView(setup(), helpers);
  assert.equal((html.match(/role="tab"/g) || []).length, 6);
  for (const tab of ['summary','assignments','students','grades','notices','settings']) assert.match(html, new RegExp('data-tab="' + tab + '"'));
  assert.match(html, /學生人數/);
  assert.match(html, /新增作業/);
  assert.doesNotMatch(html, /ABCDEFGH/);
  assert.doesNotMatch(html, /移出班級/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
test('student view cannot display classroom roster, grade tab, teacher controls, or join code', async () => {
  const { buildClassroomView, tabsForClass } = await renderer;
  const s = setup('student');
  assert.deepEqual(tabsForClass(false).map(([id]) => id), ['summary','assignments','notices','settings']);
  for (const tab of ['summary','assignments','notices','settings']) {
    s.classTab = tab;
    const html = buildClassroomView(s, helpers);
    assert.equal((html.match(/role="tab"/g) || []).length, 4);
    assert.doesNotMatch(html, /data-tab="grades"|data-tab="students"|ABCDEFGH|移出班級|更新加入碼|指派班級教師/);
  }
  s.classTab = 'grades';
  assert.match(buildClassroomView(s, helpers), /我的學習任務/);
});
test('teacher sees independently scoped student, grade, assignment, and settings sections', async () => {
  const { buildClassroomView } = await renderer;
  const s = setup();
  s.classTab = 'students';
  let html = buildClassroomView(s, helpers);
  assert.match(html, /王同學|李同學/);
  assert.match(html, /data-cc-search="student"/);
  assert.doesNotMatch(html, /ABCDEFGH/);
  s.classTab = 'assignments';
  html = buildClassroomView(s, helpers);
  assert.match(html, /data-cc-filter="draft"/);
  assert.match(html, /data-cc-search="assignment"/);
  s.classTab = 'grades';
  html = buildClassroomView(s, helpers);
  assert.match(html, /學習總覽/);
  assert.match(html, /查看成績/);
  s.classTab = 'settings';
  html = buildClassroomView(s, helpers);
  assert.match(html, /ABCDEFGH/);
  assert.match(html, /指派班級教師/);
  assert.doesNotMatch(html, /王同學/);
});

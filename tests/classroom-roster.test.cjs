'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bytes = fs.readFileSync(path.join(__dirname,'../public/cultivation/classroom-roster.js'));
const loaded = import('data:text/javascript;base64,'+bytes.toString('base64'));
const members = [
  {uid:'student-1',name:'王同學',seat:'2'},
  {uid:'student-2',name:'林,小華',seat:'5'},
  {uid:'student-3',name:'李"小英',seat:'12'}
];
const escape = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const helpers={escape,button:(action,label,attr='')=>'<button data-action="'+action+'" '+attr+'>'+label+'</button>'};
test('roster CSV export round trips names with commas and quotes, and always keys by uid',async()=>{
  const { exportRosterCSV,parseRosterCSV }=await loaded;
  const csv=exportRosterCSV(members);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"林,小華"'));
  assert.ok(csv.includes('"李""小英"'));
  const parsed=parseRosterCSV(csv,members);
  assert.equal(parsed.checked,3);
  assert.equal(parsed.unchanged,3);
  assert.deepEqual(parsed.updates,[]);
  assert.deepEqual(parsed.errors,[]);
  const updated=csv.replace('"王同學"','"王小明"').replace('"2"','"09"');
  const plan=parseRosterCSV(updated,members);
  assert.equal(plan.updates.length,1);
  assert.deepEqual(plan.updates[0],{uid:'student-1',name:'王小明',seat:'09'});
});
test('CSV matches only existing immutable student uid and rejects guessed names, duplicates or invalid columns',async()=>{
  const {parseRosterCSV}=await loaded;
  const badUid=parseRosterCSV('uid,name,seat\nunknown,王同學,1\n',members);
  assert.equal(badUid.errors.length,1); assert.equal(badUid.updates.length,0);
  assert.throws(()=>parseRosterCSV('name,seat\n王同學,1\n',members),/表頭/);
  assert.throws(()=>parseRosterCSV('uid,name,seat\n"student-1,王同學,1\n',members),/引號/);
  const duplicate=parseRosterCSV('uid,name,seat\nstudent-1,王,1\nstudent-1,王二,2\n',members);
  assert.equal(duplicate.updates.length,1);
  assert.equal(duplicate.errors.length,1);
  assert.throws(()=>parseRosterCSV('uid,name,seat\n',members),/1 至 100 筆/);
  assert.throws(()=>parseRosterCSV('uid,name,seat\n'+'x'.repeat(65000),members),/過大/);
});
test('CSV protects spreadsheet cells beginning with formulas but restores original values on import',async()=>{
  const { exportRosterCSV,parseRosterCSV }=await loaded;
  const roster=[{uid:'u1',name:'=HYPERLINK("example")',seat:'-4'}];
  const csv=exportRosterCSV(roster);
  assert.match(csv,/"'=HYPERLINK/);
  assert.match(csv,/"'-4"/);
  const plan=parseRosterCSV(csv,roster);
  assert.equal(plan.unchanged,1);
  assert.deepEqual(plan.updates,[]);
});
test('teacher roster panel renders searchable and editable cards, import and selection safely',async()=>{
  const { renderRosterPanel }=await loaded;
  const s={classroom:{id:'class',name:'七年一班',status:'active',members,rosterVersion:2},studentSearch:'王',
    editStudentUid:'student-1',rosterSelected:['student-1'],studentSort:'seat'};
  const html=renderRosterPanel(s,helpers);
  assert.match(html,/data-roster-select="student-1" checked/);
  assert.match(html,/data-action="roster-save"/);
  assert.match(html,/data-action="roster-batch-remove"/);
  assert.match(html,/data-action="roster-import-preview"/);
  assert.match(html,/data-action="roster-export"/);
  assert.match(html,/data-cc-search="student"/);
  assert.doesNotMatch(html,/classroomSubmissions|correctCount|answerIndex/);
  const escaped=renderRosterPanel({...s,classroom:{...s.classroom,members:[{uid:'s',name:'<img src=x onerror=alert(1)>',seat:'9'}]}},helpers);
  assert.match(escaped,/&lt;img src=x/);
  assert.doesNotMatch(escaped,/<img src=x/);
  const archived=renderRosterPanel({...s,classroom:{...s.classroom,status:'archived'}},helpers);
  assert.match(archived,/班級已封存/);
  assert.match(archived,/data-action="roster-edit"[^>]*disabled/);
});

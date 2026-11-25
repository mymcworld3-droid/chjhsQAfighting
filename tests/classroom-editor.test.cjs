'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
Object.assign(globalThis,require('./helpers/presentations.cjs'));
const moduleBytes = fs.readFileSync(path.join(__dirname,'../public/cultivation/classroom-editor.js'));
const code = import('data:text/javascript;base64,' + Buffer.from(moduleBytes.toString().replace(/^import .*;\n/gm,'')).toString('base64'));
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const helper = {
  escape, button:(action,label,attrs='')=>'<button data-action="'+action+'" '+attrs+'>'+label+'</button>',
  field:(name,label,value='',attrs='')=>'<label>'+escape(label)+'<input name="'+name+'" value="'+escape(value)+'" '+attrs+'></label>',
  subjectNames:['數學','自然'],
  subjects:[{name:'數學',points:[{id:'math-1',name:'整數'}]}]
};
const question = (text='1 + 1 = ?') => ({
  question:text,options:['1','2','3','4'],answerIndex:1,
  explanation:'一加一等於二。',knowledge_points:[{subject:'數學',id:'math-1',name:'整數'}]
});
test('draft validation catches every incomplete, duplicate or invalid answer even when hidden in the editor', async () => {
  const { validateClassroomDraft:check } = await code;
  const good={title:'代數練習',subject:'數學',questions:[question(),question('2 + 2 = ?')]};
  assert.equal(check(good),'');
  good.questions[1].options[2]='2';
  assert.match(check(good),/第 2 題選項不可重複/);
  good.questions[1].options[2]='3';
  good.questions[1].question='';
  assert.match(check(good),/第 2 題的題幹/);
  good.questions[1].question='2 + 2 = ?';
  good.questions[1].answerIndex=5;
  assert.match(check(good),/第 2 題沒有有效/);
  good.questions[1].answerIndex=3;
  good.questions=Array.from({length:31},()=>question());
  assert.match(check(good),/1 至 30 題/);
});
test('AI outputs are validated and converted into classroom question shape', async () => {
  const { parseClassroomAIQuestion:parse } = await code;
  const valid={question:'1 + 1 = ?',correct:'2',wrong:['1','3','4'],explanation:'整數加法',
    knowledge_points:[{subject:'數學',id:'math-1',name:'整數'}]};
  const q=parse({text:JSON.stringify(valid)},'數學',(source,subject)=>source.knowledge_points);
  assert.deepEqual(q.options,['2','1','3','4']);
  assert.equal(q.answerIndex,0);
  assert.equal(q.explanation,'整數加法');
  assert.throws(()=>parse({text:JSON.stringify({...valid,wrong:['1','1','4']})},'數學',()=>[]),/選項重複/);
  assert.throws(()=>parse({text:'invalid json'},'數學',()=>[]),/JSON/);
  assert.throws(()=>parse({text:JSON.stringify({...valid,question:''})},'數學',()=>[]),/題目為空/);
});
test('long assignments render just one editable question, with compact navigation and batch AI controls', async () => {
  const { renderClassroomEditor:render } = await code;
  const html=render({editorIndex:1,editor:{title:'測驗',subject:'數學',
    questions:[question('<img src=x>'),question('2 + 2 = ?'),question('3 + 3 = ?')] }},helper);
  assert.match(html, /name="question-1"/);
  assert.doesNotMatch(html, /name="question-0"/);
  assert.doesNotMatch(html, /name="question-2"/);
  assert.match(html, /data-action="editor-up"/);
  assert.match(html, /data-action="editor-duplicate"/);
  assert.match(html, /data-count="5"/);
  assert.match(html, /data-count="10"/);
  assert.match(html, /草稿，不會自動發布/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img src=x>/);
});
test('reuse view shows only available target choices and escapes user data', async () => {
  const { renderClassroomCopy:render } = await code;
  const html=render({
    copySource:{id:'a',title:'<script>標題</script>',subject:'數學',questionCount:4},
    copyTargets:[{id:'active',name:'七年一班',studentCount:4,status:'active'},
      {id:'archived',name:'封存班級',studentCount:3,status:'archived'}],
    copyCursor:'more', copySelected:['active'], copyTitle:'段考「複習」'
  },helper);
  assert.match(html,/value="archived" disabled/);
  assert.match(html,/value="active" checked/);
  assert.match(html,/value="段考「複習」"/);
  assert.match(html,/data-action="copy-confirm"/);
  assert.match(html,/data-action="copy-more-classes"/);
  assert.match(html,/&lt;script&gt;標題&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>/);
});

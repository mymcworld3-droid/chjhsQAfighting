'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = fs.readFileSync(path.join(__dirname,'../public/cultivation/classroom-analysis.js'));
const loaded = import('data:text/javascript;base64,'+file.toString('base64'));
const e = s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const helpers={
  escape:e, button:(action,label,attrs='')=>'<button data-action="'+action+'" '+attrs+'>'+label+'</button>',
  date:ms=>new Date(ms).toISOString(), status:s=>({'submitted':'已繳交','in-progress':'作答中'}[s]||'未開始')
};
const questionStat=(correct,total)=>({
  id:'math-1',name:'一次方程式',subject:'數學',correct,total,questionCount:1
});
const item=(id, correct, total, subject='數學')=>({
  id:'a'+id,title:'第 '+id+' 份作業',subject,status:'published',
  publishedAtMs:1900000000000+id*86400000,
  questionCount:2,markedQuestions:1,
  studentCount:10,submitted:total,average:total?correct/total*100:null,
  knowledgePoints:[questionStat(correct,total)]
});
test('long-term view aggregates only first submissions and never treats absent grades as zeros',async()=>{
  const {summarizeLearningAnalysis:summarize}=await loaded;
  const value=summarize([item(4,0,0),item(3,2,5),item(2,1,5),item(1,1,5)]);
  assert.equal(value.assignmentCount,4);
  assert.equal(value.submissions,15);
  assert.equal(value.topics[0].correct,4);
  assert.equal(value.topics[0].total,15);
  assert.equal(value.topics[0].assignmentCount,3);
  assert.equal(value.weak.length,1);
  assert.equal(value.weak[0].name,'一次方程式');
  assert.ok(value.firstAverage>0);
  assert.equal(summarize([item(0,0,0)]).firstAverage,null);
  assert.equal(summarize([item(0,0,0)]).weak.length,0);
});
test('rendering labels the partial paging scope, question counts and weak concepts explicitly',async()=>{
  const {renderLearningAnalysis:render}=await loaded;
  const a={classId:'r',className:'七年一班',studentCount:10,scanned:4,
    rows:[item(4,0,0),item(3,2,5),item(2,1,5),item(1,1,5)],nextCursor:'old'};
  const html=render({view:'learning',classroom:{status:'active',name:'七年一班'},learning:a,
    learningSubject:'all',learningReturnTab:'grades'},helpers);
  assert.match(html,/data-action="learning-more"/);
  assert.match(html,/尚有較早作業/);
  assert.match(html,/建議優先複習/);
  assert.match(html,/至少 2 份作業、5 次首次作答/);
  assert.match(html,/data-action="learning-remediate"/);
  assert.match(html,/前半已載入作業/);
  assert.match(html,/知識點標記/);
  assert.match(html,/無已繳交樣本/);
  assert.doesNotMatch(html,/data-action="answer"|data-action="correct"/);
  assert.doesNotMatch(html,/classroomSubmissions|answerIndex/);
});
test('subject filter is based only on loaded rows and avoids fabricated statistics',async()=>{
  const {renderLearningAnalysis:render}=await loaded;
  const a={classId:'r',className:'某班',studentCount:10,scanned:2,
    rows:[item(2,4,5,'自然'),item(1,1,5,'數學')],nextCursor:null};
  const html=render({learning:a,classroom:{name:'某班',status:'archived'},learningSubject:'自然'},helpers);
  assert.match(html,/全部科目/);
  assert.match(html,/自然/);
  assert.match(html,/已分析作業/);
  assert.match(html,/已檢查目前可用的全部歷史作業/);
  assert.doesNotMatch(html,/data-action="learning-remediate"/);
});
test('student history keeps first scores and correction counts separate without leaking answers',async()=>{
  const {renderLearningAnalysis:render}=await loaded;
  const data={student:{uid:'u',name:'<script>alert(1)</script>',seat:'9'},
    classId:'r',className:'七年一班',studentCount:3,scanned:2,
    rows:[{...item(2,0,0),workStatus:'not-started',score:null,correctedCount:0,wrongCount:null},
      {...item(1,0,1),workStatus:'submitted',score:0,correctedCount:1,wrongCount:2}],
    nextCursor:'x'};
  const html=render({learning:data,classroom:{status:'active'},learningReturnTab:'students'},helpers);
  assert.match(html,/個人學習檔案/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>alert/);
  assert.match(html,/已訂正 1／2 道錯題/);
  assert.match(html,/首次成績平均/);
  assert.match(html,/返回學生名單/);
  assert.match(html,/data-action="learning-more"/);
});

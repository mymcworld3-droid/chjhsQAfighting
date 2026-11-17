'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Daily=require('../daily-meditation-literacy.cjs');
const {quickQuizPrompt}=require('../fast-quiz-prompt.cjs');
const {__test:Opportunity}=require('../opportunity-api.cjs');
test('daily literacy requires curriculum application, not pure article reading',()=>{
 for(const domain of Daily.plan({profile:{educationLevel:'高中二年級'}})){
   const p=Daily.prompt({...domain,index:0});
   assert.match(p,/素養題的「新聞、時事、文章或資料」只能是情境/);
   assert.match(p,/只靠逐句搜尋或改寫材料/);
   assert.match(p,/literacy_concept/);
   assert.match(p,/不可當作事實/);
 }
 assert.match(quickQuizPrompt({mode:'meditation-literacy',subject:'社會',level:'高中二年級',topic:'公共議題'}),/不可視為素養題/);
});
test('opportunity passage is a case study; all five questions must use subject concepts',()=>{
 const p=Opportunity.generationPrompt({subject:'歷史',level:'高中二年級',detail:'啟蒙思想'},[]);
 assert.match(p,/真正考核的是運用所選學科課內概念/);
 assert.match(p,/不得僅問主旨、作者態度或摘錄原文/);
 const schema=JSON.parse(p.slice(p.lastIndexOf('\n')+1));
 assert.equal(schema.questions.length,5);
 assert.ok(schema.questions.every(q=>q.application.length>=12));
});

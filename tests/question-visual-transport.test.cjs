'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../public/cultivation/question-visual-engine.js');
const {questionQualityIssue}=require('../question-quality.cjs');
const enc=s=>'[[QYVISUAL:'+JSON.stringify(s)+':QYVISUAL]]';
const long=enc({type:'table',headers:['項目','值'],rows:Array.from({length:60},(_,i)=>['資料'+i+'x'.repeat(80),i])});
test('large visuals are preserved atomically through legacy transport limits',()=>{assert.ok(long.length>5000);for(const max of [280,300,400,500,800,1200,1400,1800,3000,4000])assert.equal(E.transportText(long,max),long);assert.equal(E.transportText('abcde',3),'abc');assert.equal(E.fieldFits(long,280),true);assert.equal(E.answerIssue('題幹'+long,['A','B','C','D']),'');assert.equal(questionQualityIssue({q:'依表格判斷數據'+long,correct:'甲',wrong:['乙','丙','丁'],exp:'依據資料，答案為甲。'}),'')});
test('unsafe size or damaged visual never silently truncates',()=>{assert.throws(()=>E.transportText(long.repeat(3),300));assert.ok(E.answerIssue('題幹'+long.slice(0,-4),['A']));assert.equal(E.fieldFits(long.slice(0,-4),4000),false);const bigger=enc({type:'table',headers:['項目','值'],rows:Array.from({length:70},(_,i)=>['資料'+i+'x'.repeat(90),i])});assert.ok(bigger.length*6>E.MAX_QUESTION);assert.ok(E.questionIssue({q:bigger,correct:bigger,wrong:[bigger,bigger,bigger],exp:bigger}))});
test('all subjects share the exact same safe graph language, no forced template',()=>{const subject=['數學','物理','化學','生物','地科','地理','歷史','公民','國文','英文'];const prompt=require('../question-visual-prompt.cjs');const quick=require('../fast-quiz-prompt.cjs');for(const s of subject){const p=quick.quickQuizPrompt({mode:'battle-fast',subject:s,topic:'示例',difficulty:'medium'});assert.ok(p.includes('[[QYVISUAL:'));assert.ok(p.includes('不強制'));}assert.ok(prompt.VISUAL_PROMPT.includes('不設比例'))});

test('long graph fields survive real history writer, including options and explanation',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const source=fs.readFileSync(require('node:path').join(__dirname,'../public/cultivation/data/player-repository.js'),'utf8');
 const code=source.replace(/^import\\s+[\\s\\S]*?;\\s*$/gm,'').replace('export const playerRepository','const playerRepository');
 let saved;const ctx={QAQuestionVisualEngine:E,QAKnowledgePoints:{label:()=>null,labels:()=>[]},getMainUser:()=>({uid:'u'}),getProjectServices:async()=>({db:{}}),doc:()=>({}),serverTimestamp:()=>0,runTransaction:async(db,fn)=>fn({get:async()=>({exists:()=>false}),set:(ref,row)=>{saved=row;}})};
 vm.runInNewContext(code+'\\n;globalThis.repo=playerRepository;',ctx);
 await ctx.repo.saveExamAnswer('graph-history-test',{question:long,options:[long,'B','C','D'],explanation:long,correctIdx:0,userIdx:0});
 assert.equal(saved.question,long);assert.equal(saved.options[0],long);assert.equal(saved.explanation,long);
 const History=require('../public/cultivation/quiz-history-view.js');const rendered=History.normalize(saved,'--',s=>E.renderInline(s)??s).html;
 assert.ok(rendered.includes('qy-visual'));assert.ok(!rendered.includes('[[QYVISUAL:'));
});
test('large signed correction receipt survives UTF-8 expansion and still rejects tampering',()=>{
 const Receipt=require('../solo-question-receipt.cjs');const key=Buffer.alloc(32,9);
 const visual=enc({type:'table',headers:['項目'],rows:Array.from({length:65},()=>['測'.repeat(120)])});
 const q={q:visual,correct:visual,wrong:['B','C','D'],exp:visual,subject:'數學'};
 const proof=Receipt.issue('u',q,{recoveryOrigin:visual},key);
 assert.ok(proof.length>40000);const record=Receipt.read('u',{proof,question:q.q,options:[q.correct,...q.wrong]},key);
 assert.equal(record.recoveryOrigin,visual);assert.equal(record.explanation,visual);assert.equal(Receipt.read('u',{proof,question:q.q+'改',options:[q.correct,...q.wrong]},key),null);
});

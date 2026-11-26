const test=require('node:test');const assert=require('node:assert/strict');
const C=require('../curriculum-catalog.cjs'),R=require('../public/cultivation/curriculum-range-rules.js');
const data=require('../public/curriculum-supplements/history.json');
function target(b,u,name){return {subject:b.subject,level:b.grade,scope:{path:[b.subject,b.grade,b.term,b.edition,b.subject].join('/'),detail:u.unit,sub_topics:[name],curriculum:{bookId:b.bookId,edition:b.edition,term:b.term,schoolYear:b.schoolYear,conceptIds:[]}}};}
test('all 16 approved-list required history books have selectable publisher sections and guidance',()=>{
 assert.equal(data.books.length,16);assert.equal(new Set(data.books.map(b=>b.bookId)).size,16);
 for(const [grade,count] of [['高中一年級',11],['高中二年級',5],['高中三年級',0]])assert.equal(C.catalog(grade,'歷史').books.filter(b=>b.scopeSelectionStatus==='social-crosswalk-transcription'&&R.selectableBook(b)).length,count);
 for(const b of data.books){assert.ok(R.selectableBook(b));assert.equal(b.releaseStatus,'blocked');for(const u of b.units)for(const name of u.details){
 const t=target(b,u,name);assert.equal(C.validateScope(t.scope,t.subject,t.level).bookId,b.bookId);assert.equal(C.sectionGuidance(t).length,1);assert.match(C.scopePrompt(t),/editorialSectionGuidance/);
 const shared=R.shareSelection([t.scope]);assert.ok(shared.ok);assert.deepEqual(R.readSharedSelection(shared.code).units,[t.scope]);assert.throws(()=>C.validateScope({...t.scope,sub_topics:['不存在的考點']},t.subject,t.level));
 }}
});
test('history source years, publisher pages, grade and section boundaries stay distinct',()=>{
 const b=data.books.find(b=>b.bookId==='chwa-114-history-1');assert.equal(b.units.length,7);
 for(const change of [{schoolYear:115},{term:'第二學期'},{grade:'高中二年級'},{sources:[]},{scopeEvidence:{...b.scopeEvidence,page:1}},{scopeEvidence:{...b.scopeEvidence,columnPolicy:'both-columns'}}])assert.ok(!R.selectableBook({...b,...change}));
 const n=data.books.find(b=>b.bookId==='nani-114-history-3');assert.equal(n.units[1].details[0],'2-1 理性與自由的力量');
 const x=data.books.find(b=>b.bookId==='sanmin-114-history-2');assert.match(x.units[3].concepts[0].excludedContent.join(' '),/未核對/);
});

const test=require('node:test');const assert=require('node:assert/strict');
const C=require('../curriculum-catalog.cjs'),R=require('../public/cultivation/curriculum-range-rules.js');
const data=require('../public/curriculum-supplements/elective-science.json');
function target(b,u,name){return {subject:b.subject,level:b.grade,scope:{path:[b.subject,b.grade,b.term,b.edition,b.subject].join('/'),detail:u.unit,sub_topics:[name],curriculum:{bookId:b.bookId,edition:b.edition,term:b.term,schoolYear:b.schoolYear,conceptIds:[]}}};}
test('24 elective biology books and two publisher chapter outlines are selectable in both grades',()=>{
 assert.equal(data.books.length,26);assert.equal(new Set(data.books.map(b=>b.bookId)).size,26);
 for(const grade of data.eligibleGrades){
  const bio=C.catalog(grade,'生物').books.filter(b=>b.scopeSelectionStatus==='elective-crosswalk-transcription');
  const earth=C.catalog(grade,'地球科學').books.filter(b=>b.scopeSelectionStatus==='publisher-chapter-outline');
  assert.equal(bio.length,24);assert.equal(earth.length,2);
  for(const p of ['龍騰','翰林','南一','泰宇','三民','全華'])assert.equal(bio.filter(b=>b.publisher===p).length,4);
  for(const b of [...bio,...earth]){assert.equal(b.grade,grade);assert.ok(R.selectableBook(b));assert.equal(b.releaseStatus,'blocked');
   for(const u of b.units)for(const name of u.details){const t=target(b,u,name);assert.equal(C.validateScope(t.scope,t.subject,t.level).bookId,b.bookId);assert.equal(C.sectionGuidance(t).length,1);assert.match(C.scopePrompt(t),/editorialSectionGuidance/);const shared=R.shareSelection([t.scope]);assert.ok(shared.ok);assert.deepEqual(R.readSharedSelection(shared.code).units,[t.scope]);assert.throws(()=>C.validateScope({...t.scope,sub_topics:['不存在的考點']},t.subject,t.level));}
  }
 }
 assert.equal(C.catalog('高中一年級','生物').books.filter(b=>b.courseType==='elective').length,0);
});
test('source years, publisher pages and editorial depth cannot be confused with official section verification',()=>{
 const b=data.books.find(b=>b.bookId==='nani-112-biology-iv');
 assert.equal(b.schoolYear,112);assert.ok(R.selectableBook(b));
 for(const change of [{schoolYear:114},{grade:'高中一年級'},{sources:[]},{scopeEvidence:{...b.scopeEvidence,page:2}},{scopeEvidence:{...b.scopeEvidence,columnPolicy:'both-columns'}}])assert.equal(R.selectableBook({...b,...change}),false);
 const e=data.books.find(b=>b.bookId==='taiyu-108-earth-9853');assert.equal(e.schoolYear,null);
 assert.ok(!R.selectableBook({...e,units:e.units.slice(1)}));
 assert.ok(!R.selectableBook({...e,scopeDetailLevel:'crosswalk-sections'}));
 const h=data.books.find(b=>b.bookId==='hanlin-114-biology-i');assert.ok(h.units.flatMap(u=>u.details).includes('5-1 聚合酶連鎖反應'));
 const n=data.books.find(b=>b.bookId==='nani-114-biology-iii');assert.ok(n.units.flatMap(u=>u.details).includes('1-4 結締組織'));
});

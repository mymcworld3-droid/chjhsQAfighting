const test=require('node:test');const assert=require('node:assert/strict');
const C=require('../curriculum-catalog.cjs');const R=require('../public/cultivation/curriculum-range-rules.js');
const data=require('../public/curriculum-supplements/grade10.json');
const grade='高中一年級';
const publishers=['翰林','龍騰','南一','泰宇','三民','全華'];
function target(b,u,name){return {subject:b.subject,level:b.grade,scope:{path:[b.subject,b.grade,b.term,b.edition,b.subject].join('/'),detail:u.unit,sub_topics:[name],curriculum:{bookId:b.bookId,edition:b.edition,term:b.term,schoolYear:b.schoolYear,conceptIds:[]}}};}
test('all 24 grade ten crosswalk books have source labels, section guidance and valid share round-trips',()=>{
 assert.equal(data.books.length,24);assert.equal(new Set(data.books.map(b=>b.bookId)).size,24);
 for(const s of ['數學','物理','化學'])for(const p of publishers){const books=C.catalog(grade,s).books.filter(b=>b.publisher===p);assert.equal(books.length,s==='數學'?2:1);assert.ok(books.every(R.selectableBook));}
 for(const b of data.books){assert.equal(b.releaseStatus,'blocked');assert.ok(!b.legacyVisible);assert.ok(R.selectableBook(b));for(const u of b.units)for(const name of u.details){const t=target(b,u,name);assert.equal(C.validateScope(t.scope,t.subject,t.level).bookId,b.bookId);assert.equal(C.sectionGuidance(t).length,1);assert.match(C.scopePrompt(t),/editorialSectionGuidance/);const shared=R.shareSelection([t.scope]);assert.ok(shared.ok);assert.deepEqual(R.readSharedSelection(shared.code).units,[t.scope]);assert.throws(()=>C.validateScope({...t.scope,sub_topics:['不存在的細項']},t.subject,t.level));}}
});
test('transcription is not an original or released book, and evidence and grade cannot be forged',()=>{
 const b=data.books.find(b=>b.bookId==='nani-114-math-1');assert.ok(R.selectableBook(b));for(const change of [{schoolYear:115},{grade:'高中二年級'},{sources:[]},{scopeEvidence:{...b.scopeEvidence,columnPolicy:'both-columns'}},{scopeEvidence:{...b.scopeEvidence,reviewMethod:'unknown'}},{sources:b.sources.map(s=>({...s,publisherTable:'翰林數學高一上'}))}])assert.equal(R.selectableBook({...b,...change}),false);
 const p=data.books.find(b=>b.bookId==='nani-114-physics-required');assert.match(p.units[2].details[0],/早期運動學/);
 const h=data.books.find(b=>b.bookId==='hanlin-114-math-1');assert.match(h.units[2].details[1],/3-2/);
 const c=data.books.find(b=>b.bookId==='chwa-114-math-2');assert.equal(c.units[3].details.length,3);
});

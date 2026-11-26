const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../curriculum-catalog.cjs'),R=require('../public/cultivation/curriculum-range-rules.js'),D=require('../public/curriculum-supplements/language.json');
test('six source-labelled language books can select original lesson names and unique editorial subtopics',()=>{
 assert.equal(D.books.length,6);
 for(const b of D.books){assert.ok(R.selectableBook(b),b.bookId);assert.equal(b.schoolYear,null);assert.ok(C.catalog(b.grade,b.subject).books.some(x=>x.bookId===b.bookId));
 assert.equal(new Set(b.units.flatMap(u=>u.details)).size,b.units.length*3);
 for(const u of b.units)for(const name of u.details){const s={path:[b.subject,b.grade,b.term,b.edition,b.subject].join('/'),detail:u.unit,sub_topics:[name],curriculum:{bookId:b.bookId,edition:b.edition,term:b.term,schoolYear:null,conceptIds:[]}},t={subject:b.subject,level:b.grade,scope:s};
 assert.equal(C.validateScope(s,b.subject,b.grade).bookId,b.bookId);assert.equal(C.sectionGuidance(t).length,1);assert.match(C.scopePrompt(t),/editorialSectionGuidance/);
 const share=R.shareSelection([s]);assert.ok(share.ok,share.message);assert.deepEqual(R.readSharedSelection(share.code).units,[s]);assert.throws(()=>C.validateScope({...s,sub_topics:['不存在的細項']},b.subject,b.grade));}
 }
});
test('publisher evidence and academic year cannot be silently substituted',()=>{const b=D.books[0];assert.ok(!R.selectableBook({...b,schoolYear:115}));assert.ok(!R.selectableBook({...b,sources:[]}));assert.ok(!R.selectableBook({...b,units:b.units.slice(1)}));const en=D.books.find(b=>b.subject==='英文');assert.equal(en.units.length,12);assert.equal(en.units.filter(u=>u.lessonType==='review').length,3);assert.match(en.units[0].concepts[0].allowedContent.join(' '),/未取得課文詞表/);});

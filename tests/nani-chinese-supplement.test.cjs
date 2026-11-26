const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../curriculum-catalog.cjs'),R=require('../public/cultivation/curriculum-range-rules.js'),D=require('../public/curriculum-supplements/nani-chinese.json');
test('five Nani outlines preserve known lesson order and editorial scope',()=>{
 assert.equal(D.books.length,5);assert.deepEqual(D.books.map(b=>b.units.length),[12,12,13,12,12]);assert.equal(D.books.flatMap(b=>b.units.flatMap(u=>u.details)).length,183);
 for(const b of D.books){
  assert.ok(R.selectableBook(b));assert.equal(b.schoolYear,null);assert.equal(b.releaseStatus,'blocked');
  assert.ok(!R.selectableBook({...b,sources:[]}));assert.ok(!R.selectableBook({...b,units:b.units.slice(1)}));assert.ok(!R.selectableBook({...b,schoolYear:115}));
  assert.ok(C.catalog(b.grade,b.subject).books.some(x=>x.bookId===b.bookId));
  for(const u of b.units)for(const name of u.details){
   const scope={path:[b.subject,b.grade,b.term,b.edition,b.subject].join('/'),detail:u.unit,sub_topics:[name],curriculum:{bookId:b.bookId,edition:b.edition,term:b.term,schoolYear:null,conceptIds:[]}},target={subject:b.subject,level:b.grade,scope};
   assert.equal(C.validateScope(scope,b.subject,b.grade).bookId,b.bookId);
   assert.equal(C.sectionGuidance(target).length,1);assert.match(C.scopePrompt(target),/editorialSectionGuidance/);
   assert.throws(()=>C.validateScope({...scope,sub_topics:['不屬於本冊的考點']},b.subject,b.grade));
   const share=R.shareSelection([scope]);assert.ok(share.ok);assert.deepEqual(R.readSharedSelection(share.code).units,[scope]);
  }
 }
 assert.equal(D.books[2].units.at(-1).unit,'自學 用奇謀孔明借箭');
 assert.ok(!R.selectableBook({...D.books[2],sources:D.books[2].sources.slice(0,1)}));
 const senior=D.books[4];assert.ok(C.catalog('高中三年級','國文').books.some(b=>b.bookId===senior.bookId));assert.equal(senior.units.at(-1).unit,'自學 劉姥姥進大觀園');assert.equal(senior.scopeSelectionStatus,'nani-filename-index');assert.ok(!R.selectableBook({...senior,sources:senior.sources.slice(0,1)}));
});

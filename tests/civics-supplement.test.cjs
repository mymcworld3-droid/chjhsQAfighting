const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../curriculum-catalog.cjs'),R=require('../public/cultivation/curriculum-range-rules.js'),D=require('../public/curriculum-supplements/civics.json');
function scope(b,u,name){return {path:[b.subject,b.grade,b.term,b.edition+' · '+b.schoolYear+'學年度',b.subject].join('/'),detail:u.unit,sub_topics:[name],curriculum:{bookId:b.bookId,edition:b.edition,term:b.term,schoolYear:b.schoolYear,conceptIds:[]}}}
test('16 source-labelled civics books distinguish edition and semester',()=>{
 assert.equal(D.books.length,18);assert.equal(new Set(D.books.map(b=>b.bookId)).size,18);
 for(const [grade,n] of [['高中一年級',10],['高中二年級',6],['高中三年級',0]])assert.equal(C.catalog(grade,'公民').books.filter(b=>b.scopeSelectionStatus==='civics-crosswalk-transcription'&&R.selectableBook(b)).length,n);
 for(const b of D.books.filter(b=>b.scopeSelectionStatus==='civics-crosswalk-transcription')){assert.ok(R.selectableBook(b));assert.equal(b.releaseStatus,'blocked');for(const u of b.units)for(const name of u.details){const s=scope(b,u,name),t={subject:b.subject,level:b.grade,scope:s};assert.equal(C.validateScope(s,b.subject,b.grade).bookId,b.bookId);assert.equal(C.sectionGuidance(t).length,1);assert.match(C.scopePrompt(t),/editorialSectionGuidance/);const share=R.shareSelection([s]);assert.ok(share.ok,share.message);assert.deepEqual(R.readSharedSelection(share.code).units,[s]);assert.throws(()=>C.validateScope({...s,sub_topics:['不存在的細項']},b.subject,b.grade));}}
});
test('edition variants and multi-page evidence cannot be conflated',()=>{
 const find=id=>D.books.find(b=>b.bookId===id);
 const a=find('longteng-114-civics-1'),b=find('longteng-114-civics-1-edition-b');assert.notEqual(a.edition,b.edition);assert.match(a.units[3].unit,/行政法/);assert.match(b.units[3].unit,/民主治理/);
 assert.ok(!R.selectableBook({...a,edition:b.edition}));assert.ok(!R.selectableBook({...a,sources:a.sources.map(s=>({...s,additionalPages:[]}))}));
 assert.equal(find('longteng-114-civics-2'),undefined);assert.ok(find('longteng-114-civics-2-edition-b'));
 const n=find('nani-114-civics-3');assert.match(n.units[2].concepts[1].allowedContent[0],/曲線移動/);
});

test('two historical non-B second volumes preserve early publisher scope and distinguish evidence',()=>{
 const books=D.books.filter(b=>b.scopeSelectionStatus==='historical-civics-crosswalk');assert.equal(books.length,2);assert.deepEqual(books.map(b=>b.units.length),[7,6]);assert.deepEqual(books.map(b=>b.units.flatMap(u=>u.details).length),[24,16]);
 for(const b of books){assert.ok(R.selectableBook(b));assert.equal(b.schoolYear,null);assert.ok(!R.selectableBook({...b,schoolYear:115}));assert.ok(!R.selectableBook({...b,edition:b.publisher+'版（乙版）'}));assert.ok(!R.selectableBook({...b,sources:[]}));assert.ok(!R.selectableBook({...b,units:b.units.slice(1)}));assert.ok(C.catalog(b.grade,b.subject).books.some(x=>x.bookId===b.bookId));
 for(const u of b.units)for(const name of u.details){const s={path:[b.subject,b.grade,b.term,b.edition,b.subject].join('/'),detail:u.unit,sub_topics:[name],curriculum:{bookId:b.bookId,edition:b.edition,term:b.term,schoolYear:null,conceptIds:[]}},t={subject:b.subject,level:b.grade,scope:s};assert.equal(C.validateScope(s,b.subject,b.grade).bookId,b.bookId);assert.equal(C.sectionGuidance(t).length,1);assert.match(C.scopePrompt(t),/editorialSectionGuidance/);const share=R.shareSelection([s]);assert.ok(share.ok);assert.deepEqual(R.readSharedSelection(share.code).units,[s]);assert.throws(()=>C.validateScope({...s,sub_topics:['不存在的細項']},b.subject,b.grade));}}
});

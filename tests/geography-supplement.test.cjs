const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../curriculum-catalog.cjs'),R=require('../public/cultivation/curriculum-range-rules.js'),D=require('../public/curriculum-supplements/geography.json');
function scope(b,u,name){return {path:'高中/'+b.grade+'/'+b.subject,detail:u.unit,sub_topics:[name],curriculum:{bookId:b.bookId,edition:b.edition,term:b.term,schoolYear:b.schoolYear,conceptIds:[]}}}
test('twelve required geography books retain publisher chapters and scoped sections',()=>{
 assert.equal(D.books.length,12);assert.equal(new Set(D.books.map(b=>b.bookId)).size,12);
 for(const [grade,n] of [['高中一年級',8],['高中二年級',4],['高中三年級',0]])assert.equal(C.catalog(grade,'地理').books.filter(b=>b.scopeSelectionStatus==='geography-crosswalk-transcription'&&R.selectableBook(b)).length,n);
 for(const b of D.books){assert.ok(R.selectableBook(b));assert.equal(b.releaseStatus,'blocked');for(const u of b.units)for(const name of u.details){const s=scope(b,u,name),t={subject:b.subject,level:b.grade,scope:s};assert.equal(C.validateScope(s,b.subject,b.grade).bookId,b.bookId);assert.equal(C.sectionGuidance(t).length,1);assert.match(C.scopePrompt(t),/editorialSectionGuidance/);const share=R.shareSelection([s]);assert.ok(share.ok);assert.deepEqual(R.readSharedSelection(share.code).units,[s]);assert.throws(()=>C.validateScope({...s,sub_topics:['不存在的細項']},b.subject,b.grade));}}
});
test('regional scope and source caveats are preserved',()=>{
 const find=id=>D.books.find(b=>b.bookId===id);
 const l=find('longteng-114-geography-2');assert.notEqual(l.units[5].unit,l.units[6].unit);
 const r=find('longteng-114-geography-3');assert.match(r.units[8].concepts[0].name,/^B-1 /);assert.match(r.units[8].concepts[0].allowedContent[0],/漠南非洲/);assert.doesNotMatch(r.units[8].concepts[0].allowedContent[0],/中南美洲/);
 const n=find('nani-114-geography-3');assert.deepEqual(n.sources[0].additionalPages,[4]);assert.ok(!R.selectableBook({...n,sources:n.sources.map(s=>({...s,additionalPages:[]}))}));
 const s=find('sanmin-114-geography-1');assert.ok(!s.units[6].details.some(x=>x.startsWith('7-1 ')));assert.match(s.limitations,/7-1/);
});

const test=require('node:test');const assert=require('node:assert/strict');
const C=require('../curriculum-catalog.cjs'),R=require('../public/cultivation/curriculum-range-rules.js');
const data=require('../public/curriculum-supplements/grade12-math.json');
function target(b,u,name){return {subject:b.subject,level:b.grade,scope:{path:[b.subject,b.grade,b.term,b.edition,b.subject].join('/'),detail:u.unit,sub_topics:[name],curriculum:{bookId:b.bookId,edition:b.edition,term:b.term,schoolYear:b.schoolYear,conceptIds:[]}}};}
test('grade 12 publisher supplement has 27 selectable books and one blocked candidate',()=>{
 assert.equal(data.books.length,28);assert.equal(new Set(data.books.map(b=>b.bookId)).size,28);
 assert.equal(data.books.filter(R.selectableBook).length,27);
 for(const s of ['數學甲','數學乙'])assert.equal(C.catalog('高中三年級',s).books.filter(b=>b.scopeSelectionStatus==='grade12-crosswalk-transcription'&&R.selectableBook(b)).length,s==='數學甲'?14:13);
 for(const b of data.books){assert.equal(b.releaseStatus,'blocked');if(!R.selectableBook(b))continue;for(const u of b.units)for(const name of u.details){const t=target(b,u,name);assert.equal(C.validateScope(t.scope,t.subject,t.level).bookId,b.bookId);assert.equal(C.sectionGuidance(t).length,1);assert.match(C.scopePrompt(t),/editorialSectionGuidance/);const shared=R.shareSelection([t.scope]);assert.ok(shared.ok);assert.deepEqual(R.readSharedSelection(shared.code).units,[t.scope]);assert.throws(()=>C.validateScope({...t.scope,sub_topics:['不存在的細項']},t.subject,t.level));}}
});
test('Nani original and second edition have distinct book IDs and actual semester ordering; ambiguous Chwa title stays blocked',()=>{
 const find=id=>data.books.find(b=>b.bookId===id);
 const n=find('nani-114-math-a-upper'),v=find('nani-114-math-a-upper-edition-b'),bad=find('chwa-114-math-b-upper');
 assert.equal(n.units[0].unit,'分布與統計');assert.equal(v.units[0].unit,'極限與函數');assert.notEqual(n.edition,v.edition);assert.ok(!R.selectableBook(bad));assert.ok(!R.selectableBook({...bad,scopeSelectionStatus:'grade12-crosswalk-transcription',verificationStatus:'grade12-crosswalk-transcription'}));
 for(const change of [{schoolYear:115},{grade:'高中二年級'},{edition:'南一版（乙版）'},{scopeEvidence:{...n.scopeEvidence,page:3}},{sources:[]}])assert.ok(!R.selectableBook({...n,...change}));
 const b=find('hanlin-114-math-b-lower');assert.ok(b.units[2].concepts[1].excludedContent.some(x=>x.includes('幾何分布')));
});

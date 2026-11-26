const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../curriculum-catalog.cjs'),R=require('../public/cultivation/curriculum-range-rules.js'),D=require('../public/curriculum-supplements/elective-social.json');
test('elective social publisher books and individual scope prompts round trip',()=>{
 assert.equal(D.books.length,22);assert.equal(new Set(D.books.map(b=>b.bookId)).size,22);
 for(const [subject,n] of [['歷史',8],['地理',6],['公民',8]])assert.equal(C.catalog('高中三年級',subject).books.filter(b=>b.scopeSelectionStatus==='elective-social-crosswalk-transcription'&&R.selectableBook(b)).length,n);
 for(const b of D.books){assert.ok(R.selectableBook(b),b.bookId);assert.equal(b.releaseStatus,'blocked');for(const u of b.units)for(const name of u.details){const s={path:[b.subject,b.grade,b.term,b.edition+' · '+b.schoolYear+'學年度',b.subject].join('/'),detail:u.unit,sub_topics:[name],curriculum:{bookId:b.bookId,edition:b.edition,term:b.term,schoolYear:b.schoolYear,conceptIds:[]}},t={subject:b.subject,level:b.grade,scope:s};assert.equal(C.validateScope(s,b.subject,b.grade).bookId,b.bookId);assert.equal(C.sectionGuidance(t).length,1);assert.match(C.scopePrompt(t),/editorialSectionGuidance/);const share=R.shareSelection([s]);assert.ok(share.ok,share.message);assert.deepEqual(R.readSharedSelection(share.code).units,[s]);assert.throws(()=>C.validateScope({...s,sub_topics:['不存在的細項']},b.subject,b.grade));}}
});
test('merged sections and cross-page source limits are preserved',()=>{
 const get=id=>D.books.find(b=>b.bookId===id);
 assert.ok(get('longteng-114-elective-history-2').units[5].details[1].startsWith('6-2～6-3'));
 assert.equal(get('longteng-114-elective-geography-2').units[2].details.length,1);
 const b=get('nani-114-elective-civics-1');assert.deepEqual(b.sources[0].additionalPages,[6]);assert.ok(!R.selectableBook({...b,sources:b.sources.map(s=>({...s,additionalPages:[]}))}));
 assert.match(get('hanlin-114-elective-geography-1').limitations,/4-2/);
});

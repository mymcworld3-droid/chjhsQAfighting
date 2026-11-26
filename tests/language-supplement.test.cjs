const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../curriculum-catalog.cjs'),R=require('../public/cultivation/curriculum-range-rules.js'),D=require('../public/curriculum-supplements/language.json');
test('publisher language lesson outline has five books per subject with editorial guidance',()=>{
 assert.equal(D.books.length,25);assert.equal(new Set(D.books.map(b=>b.bookId)).size,25);
 for(const subject of ['國文','英文'])for(const [grade,n] of [['高中一年級',2],['高中二年級',2],['高中三年級',1]])assert.equal(C.catalog(grade,subject).books.filter(b=>b.scopeSelectionStatus==='publisher-language-outline'&&R.selectableBook(b)).length,n);
 for(const b of D.books){assert.ok(R.selectableBook(b),b.bookId);assert.equal(b.schoolYear,null);assert.equal(b.releaseStatus,'blocked');assert.match(b.limitations,/不是官方節名/);const all=b.units.flatMap(u=>u.details);assert.equal(new Set(all).size,all.length);for(const u of b.units)for(const name of u.details){const s={path:[b.subject,b.grade,b.term,b.edition,b.subject].join('/'),detail:u.unit,sub_topics:[name],curriculum:{bookId:b.bookId,edition:b.edition,term:b.term,schoolYear:null,conceptIds:[]}},t={subject:b.subject,level:b.grade,scope:s};assert.equal(C.validateScope(s,b.subject,b.grade).bookId,b.bookId);assert.equal(C.sectionGuidance(t).length,1);assert.match(C.scopePrompt(t),/editorialSectionGuidance/);const share=R.shareSelection([s]);assert.ok(share.ok,share.message);assert.deepEqual(R.readSharedSelection(share.code).units,[s]);assert.throws(()=>C.validateScope({...s,sub_topics:['不存在的細項']},b.subject,b.grade));}}
});
test('language indexes distinguish source type and do not assert unretrieved school year or English vocabulary list',()=>{
 const get=id=>D.books.find(b=>b.bookId===id);
 const b=get('longteng-108-english-2');assert.match(b.units[0].unit,/The Heart of a Champion/);assert.equal(b.sources[0].type,'publisher-companion-index');assert.match(b.limitations,/矛盾頁/);assert.ok(!R.selectableBook({...b,schoolYear:114}));assert.ok(!R.selectableBook({...b,sources:b.sources.map(s=>({...s,type:'official-textbook-index'}))}));assert.ok(!R.selectableBook({...b,units:b.units.slice(1)}));
 assert.match(get('longteng-108-english-3').units.find(u=>u.unit.startsWith('L6 ')).unit,/My Life in Your Hands/);
 assert.match(get('longteng-108-chinese-3').units[7].unit,/詞選/);
 assert.equal(get('longteng-108-chinese-1').units.at(-1).details.length,24);
});

test('new publisher indexes preserve source type and exact title order',()=>{assert.equal(D.books.filter(b=>b.publisher==='奇異果').length,4);assert.equal(D.books.filter(b=>b.publisher==='三民').length,10);for(const b of D.books.filter(b=>b.scopeSelectionStatus==='language-index-v2')){assert.ok(!R.selectableBook({...b,sources:[]}));assert.ok(!R.selectableBook({...b,units:b.units.slice(1)}));assert.ok(!R.selectableBook({...b,schoolYear:115}));}});

test('Sanmin five Chinese and five English books are present; Kiwi fourth volume includes culture units',()=>{for(const subject of ['國文','英文'])assert.equal(D.books.filter(b=>b.publisher==='三民'&&b.subject===subject).length,5);const k=D.books.find(b=>b.bookId==='kiwi-108-chinese-4');assert.equal(k.units.length,12);assert.match(k.units.at(-1).unit,/通往自由與幸福/);assert.equal(k.sources[0].type,'official-textbook-index');assert.equal(D.books.find(b=>b.bookId==='hanlin-108-chinese-1').sources[0].type,'publisher-companion-index');});

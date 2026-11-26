const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../curriculum-catalog.cjs');
const data=require('../curriculum-data/grade11-section-guidance.json');
const norm=n=>String(n).normalize('NFKC').replace(/\s+/g,'');
const key=(s,t,n)=>JSON.stringify([s,t,norm(n)]);
function target(b,u,name){return {subject:b.subject.startsWith('數學')?'數學':b.subject,level:b.grade,scope:{path:[b.subject.startsWith('數學')?'數學':b.subject,b.grade,b.term,b.edition,b.subject].join('/'),detail:u.unit,sub_topics:[name],curriculum:{bookId:b.bookId,edition:b.edition,term:b.term,schoolYear:b.schoolYear,conceptIds:[]}}};}
test('editorial guidance is unique and only applied to exact validated publisher sections',()=>{
 const keys=new Set();for(const row of data.rows)for(const name of row.labels){const k=key(row.subject,row.term,name);assert.ok(!keys.has(k),k);keys.add(k);assert.ok(row.allowedContent.length);}
 const counts={};for(const s of ['數學A','數學B','物理','化學'])for(const b of C.catalog(data.grade,s).books.filter(b=>b.publisher))for(const u of b.units)for(const name of u.details){const t=target(b,u,name);const g=C.sectionGuidance(t);const k=key(s,b.term,C.sectionName(name));assert.equal(g.length,keys.has(k)?1:0,name);if(g.length){counts[s]=(counts[s]||0)+1;assert.match(C.scopePrompt(t),/editorialSectionGuidance/);assert.equal(g[0].section,name);}}
 assert.deepEqual(counts,{數學A:127,數學B:92,物理:454,化學:338});
});
test('plane-vector guidance stays two-dimensional and cannot be applied to a forged section',()=>{
 const b=C.catalog(data.grade,'數學A').books.find(b=>b.bookId==='nani-115-math-3a');const u=b.units.find(u=>u.details.some(n=>C.sectionName(n)==='平面向量的內積'));const n=u.details.find(n=>C.sectionName(n)==='平面向量的內積');const t=target(b,u,n);assert.ok(C.sectionGuidance(t)[0].excludedContent.includes('三維內積'));assert.throws(()=>C.sectionGuidance({...t,scope:{...t.scope,sub_topics:['空間向量的內積']}}));
});

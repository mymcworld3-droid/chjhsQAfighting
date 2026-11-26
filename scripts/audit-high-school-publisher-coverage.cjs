'use strict';
// 115 school-year first-semester approved-book list, NAER, updated 2026-05-28.
// This compares publisher/volume slots, NOT certified editions or textbook completeness.
const C=require('../curriculum-catalog.cjs'),R=require('../public/cultivation/curriculum-range-rules.js');
const index=require('../public/curriculum-data/index.json');
const source='https://textbooks.naer.edu.tw/DownLoadFile.aspx?ASParam=TUZIRSs3NSUyNjglMjQlN2QlMWR1JTBiJTdiJTBmJTYwbiUwNyU3ZWZ4JTEyJTA1bSUxY3dyJTA5JTFiZSUxZnYlMTElN2V6ZnUlMDUlMTglMDN2JTBjJTAzZyUxOCUwNQ%3D%3D';
const six=['三民','全華','南一','泰宇','翰林','龍騰'];
const four=['三民','南一','翰林','龍騰'];
const grades=['高中一年級','高中二年級','高中三年級'];
const semesters=['第一學期','第二學期'];
const required=[],key=(s,v,p)=>[s,v,p].join('|');
function add(subject,volumes,publishers){for(const v of volumes)for(const p of publishers)required.push({subject,volume:v,publisher:p,key:key(subject,v,p)});}
add('國文',[1,2,3,4,5],['三民','奇異果','南一','翰林','龍騰']);
add('英文',[1,2,3,4,5],['三民','三民(乙版)','翰林','龍騰']);
add('數學',[1,2,'3A','3B','4A','4B'],six);
for(const s of ['數學甲','數學乙'])add(s,['上','下'],[...six,'南一(乙版)']);
add('歷史',[1],six);add('歷史',[2,3],six.filter(p=>p!=='全華'));
add('歷史',['選修I','選修II'],four);
add('地理',[1,2,3],four);add('地理',['選修I','選修II'],four.filter(p=>p!=='三民'));
add('公民',[1,2,3],[...four,'翰林(乙版)','龍騰(乙版)']);add('公民',['選修I','選修II'],four);
for(const [s,n] of [['物理',5],['化學',5],['生物',4],['地球科學',0]])add(s,['必修',...['I','II','III','IV','V'].slice(0,n).map(x=>'選修'+x)],six);
const expected=new Map(required.map(r=>[r.key,r]));
function slot(b) {
 const p=b.publisher+(/乙版/.test(b.edition)?'(乙版)':''),s=b.subject,semester=semesters.indexOf(b.term),grade=grades.indexOf(b.grade),v=grade*2+semester+1;
 if(['物理','化學','生物','地球科學'].includes(s)){
  if(b.courseType==='required')return key(s,'必修',p);
  if(s==='地球科學')return null; // elective outlines not listed in this approved-book list
  const m=b.term.match(/([IV]+)$/);return m?key(s,'選修'+m[1],p):null;
 }
 if(s==='數學A'||s==='數學B')return key('數學',String(v)+s.slice(-1),p);
 if(s==='數學甲'||s==='數學乙')return key(s,semester===0?'上':'下',p);
 if(['歷史','地理','公民'].includes(s)&&b.courseType==='elective')return key(s,semester===0?'選修I':'選修II',p);
 return key(s,v,p);
}
function audit(){
 const books=new Map(),pending=new Map();
 for(const e of index.entries.filter(e=>grades.includes(e.grade))){
  for(const b of C.catalog(e.grade,e.subject).books){
   if(!b.publisher)continue;
   if(R.selectableBook(b)){if(!books.has(b.bookId))books.set(b.bookId,b);}
   else pending.set(b.bookId,b);
  }
 }
 const covered=new Map(),extra=[],duplicates=[],unguided=[],subjects={},statuses={};
 let items=0;
 for(const b of books.values()){
  const s=b.subject.replace(/^數學.*/,'數學'),r=subjects[s]??={books:0,items:0};r.books++;
  statuses[b.scopeSelectionStatus]=(statuses[b.scopeSelectionStatus]||0)+1;
  const k=slot(b);
  if(!expected.has(k))extra.push({bookId:b.bookId,slot:k});
  else if(covered.has(k))duplicates.push({slot:k,bookIds:[covered.get(k),b.bookId]});
  else covered.set(k,b.bookId);
  for(const u of b.units)for(const name of u.details){
   items++;r.items++;
   const scope={path:[b.subject,b.grade,b.term,b.edition,b.subject].join('/'),detail:u.unit,sub_topics:[name],curriculum:{bookId:b.bookId,edition:b.edition,term:b.term,schoolYear:b.schoolYear??null,conceptIds:[]}};
   const guidance=C.sectionGuidance({subject:b.subject,level:b.grade,scope});
   if(!guidance.some(g=>g.section===name&&g.allowedContent?.length&&Array.isArray(g.excludedContent)))unguided.push({bookId:b.bookId,section:name});
  }
 }
 return {source,sourceUpdated:'2026-05-28',metric:'publisher-volume slots, not current-edition verification',expected:expected.size,covered:covered.size,selectableBooks:books.size,items,subjects,statuses,missing:required.filter(r=>!covered.has(r.key)),pending:[...pending.values()].filter(b=>!books.has(b.bookId)).map(b=>({bookId:b.bookId,slot:slot(b),status:b.scopeSelectionStatus})),extra,duplicates,unguided};
}
if(require.main===module){const r=audit();console.log(JSON.stringify(r,null,2));if(r.duplicates.length||r.unguided.length)process.exitCode=1;}
module.exports={audit};

#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {buildInventory}=require('./audit-curriculum-inventory.cjs');
const {selectableBook}=require('../public/cultivation/curriculum-range-rules.js');
const ROOT=path.join(__dirname,'..');
const read=(root,file)=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const digest=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
function audit(root=ROOT) {
  const index=read(root,'public/curriculum-data/index.json'),ri=read(root,'concept-registry/index.json');
  const concepts=ri.files.flatMap(file=>read(root,'concept-registry/'+file).concepts),errors=[],ids=new Map(),aliases=new Map();
  const inv=buildInventory(root),groups=new Map(inv.referenceGroups.map(g=>[g.file,g]));
  // Reviews live outside question-references so legacy JSON group discovery stays compatible.
  const reviews=read(root,'curriculum-data/reference-reviews.json').reviews;
  for(const c of concepts) {
    if(ids.has(c.conceptId))errors.push('duplicate-concept-id:'+c.conceptId);
    ids.set(c.conceptId,c);
    if(!['scope-reviewed','legacy-candidate'].includes(c.status))errors.push('invalid-concept-status:'+c.conceptId);
    for(const file of c.references)if(!groups.has(file))errors.push('missing-reference-file:'+file);
    for(const grade of c.grades)for(const name of [c.name,...c.aliases]) {
      const key=JSON.stringify([c.subject,grade,name.normalize('NFKC').replace(/\s+/g,'')]);
      if(aliases.has(key)&&aliases.get(key)!==c.conceptId)errors.push('ambiguous-alias:'+key);
      aliases.set(key,c.conceptId);
    }
  }
  for(const c of concepts)for(const prerequisite of c.prerequisites)if(!ids.has(prerequisite))errors.push('missing-prerequisite:'+prerequisite);
  const visiting=new Set(),visited=new Set();
  const visit=id=>{if(visiting.has(id)){errors.push('cyclic-prerequisite:'+id);return;}if(visited.has(id))return;visiting.add(id);for(const p of ids.get(id)?.prerequisites||[])visit(p);visiting.delete(id);visited.add(id);};
  for(const id of ids.keys())visit(id);
  const reviewedCount=c=>c.references.reduce((n,file)=>{
    const group=read(root,file);
    return n+group.references.filter(r=>reviews.some(v=>v.referenceId===r.id&&v.status==='approved'&&
      v.method==='independent-content-review'&&typeof v.reviewer==='string'&&v.reviewer.trim()&&
      /^\d{4}-\d{2}-\d{2}$/.test(v.reviewedAt||'')&&v.questionHash===digest(JSON.stringify(r)))).length;
  },0);
  const rows=concepts.map(c=>({conceptId:c.conceptId,subject:c.subject,grades:c.grades,name:c.name,status:c.status,
    structuralCandidates:c.references.reduce((n,file)=>n+(groups.get(file)?.structuralCandidateCount||0),0),
    independentlyReviewed:reviewedCount(c),references:c.references}));
  const bookIds=new Set(),books=[];
  for(const e of index.entries) {
    if(e.subject==='資訊科技'||!e.path.startsWith('curriculum-data/')||e.path.includes('..')){errors.push('unsafe-catalog-index');continue;}
    const shard=read(root,'public/'+e.path);
    if(shard.grade!==e.grade||shard.subject!==e.subject)errors.push('wrong-shard:'+e.path);
    for(const b of shard.books) {
      if(bookIds.has(b.bookId))errors.push('duplicate-book-id:'+b.bookId);bookIds.add(b.bookId);
      const gaps=[];
      if(b.verificationStatus!=='verified-complete-toc')gaps.push('尚無完整正式目次');
      if(!Number.isInteger(b.schoolYear)||!b.verifiedAt||!b.sources.length)gaps.push('學年度或來源查證未完成');
      if(b.scopeReviewStatus!=='approved')gaps.push('細項與學習深度尚未核對');
      for(const u of b.units)for(const item of u.concepts) {
        const c=ids.get(item.conceptId);
        if(item.conceptId&&!c)errors.push('unknown-concept:'+b.bookId+':'+item.conceptId);
        if(!c||c.status!=='scope-reviewed')gaps.push('待確認觀念：'+item.name);
        else if(reviewedCount(c)<5)gaps.push('合格參考題不足五題：'+item.name);
      }
      if(!b.units.length||b.units.some(u=>!u.details.length))gaps.push('缺少章節細項');
      if(b.releaseStatus==='released'&&gaps.length)errors.push('ineligible-released-book:'+b.bookId);
      if(['verified-toc','verified-crosswalk'].includes(b.scopeSelectionStatus)&&!selectableBook(b))errors.push('ineligible-scope-book:'+b.bookId);
      for(const u of b.units){
        if(new Set(u.details).size!==u.details.length)errors.push('duplicate-book-section:'+b.bookId+':'+u.unit);
        if(JSON.stringify(u.concepts.map(c=>c.name))!==JSON.stringify(u.details))errors.push('section-map-mismatch:'+b.bookId+':'+u.unit);
      }
      books.push({bookId:b.bookId,grade:b.grade,subject:b.subject,edition:b.edition,publisher:b.publisher||null,term:b.term,schoolYear:b.schoolYear,
        bookLabel:b.bookLabel,scopeSelectionStatus:b.scopeSelectionStatus||'legacy',
        scopeSelectable:selectableBook(b),verificationStatus:b.verificationStatus,releaseStatus:b.releaseStatus,gaps});
    }
  }
  for(const problem of inv.problems)errors.push('reference-structure:'+JSON.stringify(problem));
  const expected=read(root,'curriculum-data/grade11-coverage-targets.json');
  const grade11Coverage=expected.publishers.flatMap(publisher=>expected.books.map(target=>{
    const matches=books.filter(b=>b.grade===expected.grade&&b.publisher===publisher&&b.subject===target.subject&&b.term===target.term&&b.scopeSelectable);
    return {publisher,...target,bookIds:matches.map(b=>b.bookId),covered:matches.length>0};
  }));
  const missingGrade11Books=grade11Coverage.filter(b=>!b.covered);
  for(const b of missingGrade11Books)errors.push('missing-grade11-scope:'+b.publisher+':'+b.subject+':'+b.term);
  return {schema:1,revision:index.revision,minimumReferences:5,summary:{
    registryConcepts:concepts.length,scopeReviewedConcepts:concepts.filter(c=>c.status==='scope-reviewed').length,
    legacyCandidates:concepts.filter(c=>c.status==='legacy-candidate').length,
    referenceQuestions:inv.summary.referenceQuestions,structuralCandidateQuestions:inv.summary.structuralCandidateQuestions,
    independentlyReviewedQuestions:rows.reduce((n,r)=>n+r.independentlyReviewed,0),
    verifiedCompleteTocs:books.filter(b=>b.verificationStatus==='verified-complete-toc').length,
    verifiedSelectableTocs:books.filter(b=>b.scopeSelectionStatus==='verified-toc').length,
    verifiedSelectableCrosswalks:books.filter(b=>b.scopeSelectionStatus==='verified-crosswalk').length,
    expectedGrade11Books:grade11Coverage.length,coveredGrade11Books:grade11Coverage.filter(b=>b.covered).length,
    missingGrade11Books:missingGrade11Books.length,
    releasedBooks:books.filter(b=>b.releaseStatus==='released').length,
    unmappedVisibleDetails:inv.summary.missingReferenceConcepts,
    minimumAdditionalStructuralQuestions:inv.summary.additionalQuestionsNeeded,
    errors:errors.length},concepts:rows,books,grade11Coverage,missingGrade11Books,missingDetails:inv.concepts.filter(c=>!c.referenceFile),errors};
}
function main(){
  const report=audit(),outputs={
    'docs/curriculum-coverage.json':JSON.stringify(report,null,2)+'\n',
    'docs/curriculum-coverage.md':['# 教材正式開放與觀念覆蓋率','',
      '由 `npm run audit:curriculum-coverage` 產生。結構候選、範圍審核與獨立內容審核分開計算。', '',
      '| 指標 | 數量 |','| --- | ---: |',...Object.entries(report.summary).map(([k,v])=>`| ${k} | ${v} |`),'',
      '可選的官方目次與課程對照分別以 verifiedSelectableTocs、verifiedSelectableCrosswalks 計數；對照資料不冒稱出版社原始目次。依使用者本輪指示，只補範圍，不補題或進行逐題審核。原整冊題庫內容資格另列缺漏，正式合格題覆蓋率目前不可計算。', '',
      '## 高二三科出版社與冊次覆蓋', '',
      '| 出版社 | 可選冊次 | 目標冊次 |', '| --- | ---: | ---: |',
      ...[...new Set(report.grade11Coverage.map(b=>b.publisher))].map(p=>`| ${p} | ${report.grade11Coverage.filter(b=>b.publisher===p&&b.covered).length} | ${report.grade11Coverage.filter(b=>b.publisher===p).length} |`),'',
      '## 原計畫題庫內容資格缺漏（本輪不補題）', '',...report.books.filter(b=>['verified-toc','verified-crosswalk'].includes(b.scopeSelectionStatus)).map(b=>
        `- ${b.grade}／${b.subject}／${b.edition}／${b.bookLabel}／${b.schoolYear??'學年度未標示'}：${b.gaps.join('；')}`),'',
      '逐年級、科目、出版社、冊次與逐觀念缺漏見同名 JSON。審核紀錄必須綁定題目內容雜湊；修改答案後，舊審核不再計數。',''].join('\n')};
  for(const [file,content] of Object.entries(outputs)) {
    if(process.argv.includes('--check')){if(!fs.existsSync(path.join(ROOT,file))||fs.readFileSync(path.join(ROOT,file),'utf8')!==content){console.error(file+' 已過期');process.exitCode=1;}}
    else fs.writeFileSync(path.join(ROOT,file),content);
  }
  if(report.errors.length){console.error(report.errors.join('\n'));process.exitCode=1;}
  console.log(JSON.stringify(report.summary,null,2));
}
if(require.main===module)main();
module.exports={audit};

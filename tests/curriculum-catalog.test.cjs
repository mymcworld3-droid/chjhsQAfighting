'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('../curriculum-catalog.cjs'),R=require('../public/cultivation/curriculum-range-rules.js');
const {quizReferences}=require('../quiz-references.cjs');
const {scopeFor}=require('../adaptive-learning-api.cjs').__test;
const E=require('../quiz-scope-exclusions.cjs');
const Tower=require('../trial-tower-scope.cjs');
const root=path.join(__dirname,'..');
const base={subject:'數學',level:'高中二年級'};
function unit(){
  const book=C.catalog('高中二年級','數學A').books.find(b=>b.legacyVisible&&b.units.some(u=>u.details.includes('向量內積')));
  assert.ok(book);
  return {path:'數學/高中二年級/第一學期/108課綱複習版/數學A',detail:'向量內積',sub_topics:['向量內積'],
    curriculum:{bookId:book.bookId,edition:book.edition,term:book.term,schoolYear:book.schoolYear,conceptIds:['math-plane-vector-dot-product']}};
}
test('standard aliases preserve plane/space distinction and grade boundaries',()=>{
  for(const name of ['平面向量內積','向量內積','內積的定義','平面向量的內積'])assert.equal(C.resolveConcept({...base,name}).conceptId,'math-plane-vector-dot-product');
  assert.equal(C.resolveConcept({...base,name:'空間向量內積'}).conceptId,'math-space-vector-dot-product');
  for(const name of ['投影','柯西不等式','內積'])assert.equal(C.resolveConcept({...base,name}),null);
  assert.equal(C.resolveConcept({...base,level:'國中二年級',name:'向量內積'}),null);
  assert.equal(C.resolveConcept({...base,legacyId:'h2-向量內積'}).conceptId,'math-plane-vector-dot-product');
});
test('official 115 math 3A and 3B retain distinct contents without certifying reference coverage',()=>{
  const a=C.catalog('高中二年級','數學A').books.find(b=>b.bookId==='hanlin-115-math-3a');
  const b=C.catalog('高中二年級','數學B').books.find(b=>b.bookId==='hanlin-115-math-3b');
  assert.equal(a.verificationStatus,'verified-complete-toc');assert.equal(a.units.length,3);
  assert.ok(a.units[0].details.includes('1-4 正餘弦函數的疊合'));
  assert.ok(b.units[0].details.includes('1-2 週期性數學模型'));
  assert.ok(!b.units[0].details.includes('1-4 正餘弦函數的疊合'));
  assert.ok([a,b].every(b=>b.releaseStatus==='blocked'&&!b.legacyVisible&&b.sources.length>=2));
  assert.ok([a,b].every(R.selectableBook));
});
test('catalog metadata is validated against the saved book, selected fine topics and grade',()=>{
  const u=unit();assert.equal(C.validateScope(u,'數學','高中二年級').bookId,u.curriculum.bookId);
  for(const change of [
    {curriculum:{...u.curriculum,bookId:'../../server.js'}},
    {curriculum:{...u.curriculum,edition:'其他版'}},
    {curriculum:{...u.curriculum,conceptIds:['math-space-vector-dot-product']}},
    {sub_topics:['空間向量內積']},
    {curriculum:{...u.curriculum,bookId:'hanlin-115-math-3a',edition:'翰林版',schoolYear:115}}
  ])assert.throws(()=>C.validateScope({...u,...change},'數學','高中二年級'));
  assert.throws(()=>C.validateScope(u,'數學','國中二年級'));
});
test('sharing preserves edition, year, book and standard IDs, including in chat shares',()=>{
  const u=unit(),other={...u,curriculum:{...u.curriculum,bookId:'other-book'}};
  const shared=R.shareSelection([u,other]);assert.equal(shared.ok,true);
  const restored=R.readSharedSelection(shared.text);assert.deepEqual(restored.units,[u,other]);
  const chat=R.createChatShare([u],'內積複習');assert.equal(chat.ok,true);assert.deepEqual(R.readChatShare(chat.message).units,[u]);
  assert.equal(R.shareSelection([{...u,curriculum:{...u.curriculum,schoolYear:'115'}}]).ok,false);
  assert.equal(R.shareSelection([{...u,curriculum:{...u.curriculum,conceptIds:['../x']}}]).ok,false);
});
test('legacy scope hashes and exclusions stay valid; changing a new book invalidates caches',()=>{
  const old={path:'數學/高中二年級/全學年/數學A',detail:'向量內積',sub_topics:[]};
  const clean={path:old.path,detail:old.detail,sub_topics:[]};
  const oldId=crypto.createHash('sha256').update(JSON.stringify(['數學','高中二年級',clean])).digest('hex').slice(0,24);
  assert.equal(scopeFor(old).scopeId,oldId);
  const user={profile:{educationLevel:'高中二年級'},gameSettings:{sourceMode:'focused',focusedUnits:[old]}};
  const before=E.scopeKey(user);user.questionScopeExclusions={scopeKey:before,rules:[{unitKey:E.unitKey(old),text:'不要再出三維向量內積'}]};
  assert.equal(E.activeRules(user,old).length,1);
  const fresh=unit();user.gameSettings.focusedUnits=[fresh];assert.notEqual(E.scopeKey(user),before);
  assert.deepEqual(Tower.snapshot(user).units[0].curriculum,fresh.curriculum);
});
test('precise fine-topic selection prevents a broad heading loading another concept',()=>{
  const scope={path:'數學/高中二年級/全學年/數學A',sub_topics:['向量加減與線性組合']};
  const refs=quizReferences({...base,topic:'向量內積',scope});assert.ok(refs.length);
  assert.ok(refs.every(r=>r.question.sub_topic==='向量加減與線性組合'));
  assert.deepEqual(quizReferences({...base,topic:'向量內積',scope:{...scope,sub_topics:['不存在的細項']}}),[]);
});
test('plane-only generation rejects spatial coordinates and keeps the original concept_id',()=>{
  const target={...base,topic:'平面向量內積'};
  const q={q:'已知向量 a=(1,2,3)、b=(2,3,4)，求內積',concept_id:'old-concept'};
  assert.match(C.questionIssue(q,target),/三維/);assert.equal(q.concept_id,'old-concept');
  assert.equal(C.questionIssue(q,{...target,topic:'空間向量內積'}),'');
  assert.match(C.scopePrompt(target),/math-plane-vector-dot-product/);
});
test('an exclusion retains same-concept alternatives and never borrows other concepts',()=>{
  const refs=quizReferences({...base,topic:'向量內積',exclusions:['不要出投影']});
  assert.ok(refs.length>0&&refs.length<=3);assert.ok(refs.every(r=>!/投影/.test(r.question.q+r.question.exp)));
  assert.deepEqual(quizReferences({...base,topic:'未知觀念',exclusions:['不要出投影']}),[]);
  assert.ok(quizReferences({...base,topic:'向量內積',exclusions:['不要再出三維向量內積的計算']}).length>0);
});
test('reference selection honors form/difficulty without mutating cached groups',()=>{
  const file=require('../question-references/數學/高中二年級/平面向量內積.json');
  const before=JSON.stringify(file);
  const refs=quizReferences({...base,topic:'平面向量內積',questionForm:'single-choice',difficulty:'medium'});
  assert.equal(refs[0].question.question_form,'single-choice');assert.equal(JSON.stringify(file),before);
});
test('all six grade eleven publishers round-trip every sourced section without falsely certifying original contents',()=>{
  const books=['數學A','數學B','物理','化學'].flatMap(subject=>C.catalog('高中二年級',subject).books).filter(b=>b.publisher);
  assert.equal(books.length,84);
  assert.equal(books.filter(R.selectableBook).length,84);
  for(const publisher of ['翰林','龍騰','南一','泰宇','三民','全華'])assert.equal(books.filter(b=>b.publisher===publisher).length,14,publisher);
  for(const book of books){
    if(!R.selectableBook(book)){
      assert.equal(book.verificationStatus,'verified-partial');assert.equal(book.units.length,0);continue;
    }
    for(const chapter of book.units)for(const topic of chapter.details){
      const scope={path:[book.subject.startsWith('數學')?'數學':book.subject,book.grade,book.term,book.edition,book.subject].join('/'),
        detail:chapter.unit,sub_topics:[topic],curriculum:{bookId:book.bookId,edition:book.edition,term:book.term,schoolYear:book.schoolYear,
          conceptIds:chapter.concepts.filter(c=>c.name===topic).map(c=>c.conceptId).filter(Boolean)}};
      assert.equal(C.validateScope(scope,book.subject.startsWith('數學')?'數學':book.subject,book.grade).bookId,book.bookId);
      const shared=R.shareSelection([scope]);assert.equal(shared.ok,true,book.bookId+':'+topic);
      assert.deepEqual(R.readSharedSelection(shared.text).units,[scope]);
      assert.throws(()=>C.validateScope({...scope,sub_topics:['不屬於本冊的考點']},book.subject,book.grade));
    }
  }
  for(const b of books.filter(b=>b.courseType==='elective')){
    assert.equal(b.schedulePolicy,'school-defined');assert.match(b.term,/^選修(?:物理|化學)[IV]+$/);
  }
  assert.ok(books.filter(b=>b.publisher==='龍騰'&&b.scopeSelectionStatus==='verified-toc').every(b=>b.schoolYear===null));
  assert.equal(books.find(b=>b.bookId==='hanlin-114-math-4a').schoolYear,114);
  assert.ok(!R.selectableBook({...books.find(R.selectableBook),verificationStatus:'verified-partial'}));
});
test('only validated numbered publisher sections use exact same-concept references',()=>{
  const book=C.catalog('高中二年級','數學A').books.find(b=>b.bookId==='hanlin-115-math-3a');
  const scope={path:'數學/高中二年級/第一學期/翰林版/數學A',detail:'平面向量',sub_topics:['3-2 平面向量的內積'],
    curriculum:{bookId:book.bookId,edition:book.edition,term:book.term,schoolYear:book.schoolYear,conceptIds:['math-plane-vector-dot-product']}};
  assert.equal(C.scopeConcepts({...base,scope})[0].conceptId,'math-plane-vector-dot-product');
  const refs=quizReferences({...base,topic:'平面向量',scope});assert.ok(refs.length);
  const allowed=new Set(require('../question-references/數學/高中二年級/平面向量內積.json').references.map(r=>r.id));
  assert.ok(refs.every(r=>allowed.has(r.id)));
  assert.match(C.questionIssue({q:'a=(1,2,3)、b=(4,5,6)'},{...base,scope}),/三維/);
  assert.equal(require('../adaptive-learning-api.cjs').__test.registryOutline(scopeFor(scope)).concepts[0].name,'平面向量內積');
  assert.deepEqual(quizReferences({...base,topic:'平面向量',scope:{...scope,curriculum:undefined}}),[]);
  assert.throws(()=>quizReferences({...base,scope:{...scope,sub_topics:['1-3 空間向量的內積']}}));
});
test('Nani has all fourteen books with the publishers own section numbering and A/B depth',()=>{
  const get=id=>['數學A','數學B','物理','化學'].flatMap(s=>C.catalog('高中二年級',s).books).find(b=>b.bookId===id);
  const a=get('nani-115-math-3a'),b=get('nani-115-math-3b');
  assert.deepEqual(a.units[0].details,['1-1 弧度量','1-2 三角函數的圖形','1-3 三角的和角與差角公式','1-4 正餘弦函數的疊合']);
  assert.deepEqual(b.units[1].details,['2-1 對數','2-2 指數與對數函數']);
  assert.ok(get('nani-114-math-4a').units[0].details.includes('1-3 空間向量的內積'));
  const b4=get('nani-114-math-4b');assert.match(b4.units[1].unit,/矩陣與資料表格/);
  assert.ok(!b4.units.flatMap(u=>u.details).some(n=>/空間向量的內積|圓錐截痕/.test(n)),'right-hand comparison cells must not become Nani sections');
  assert.ok(get('nani-115-physics-i').units[5].details.includes('6-3 行星與衛星運動'));
  assert.equal(get('nani-114-physics-ii').units[1].details[0],'2-1 質點系的質心運動');
  assert.ok(get('nani-115-chemistry-i').units[2].details.includes('3-2 物質的鑑定'));
  assert.deepEqual(get('nani-114-chemistry-ii').units[2].details,['3-1 碰撞學說','3-2 反應速率定律','3-3 影響反應速率的因素']);
});
test('crosswalk selection requires attributed left-column evidence and never becomes an original official TOC',()=>{
  const book=C.catalog('高中二年級','數學A').books.find(b=>b.bookId==='nani-115-math-3a');
  assert.equal(R.selectableBook(book),true);assert.equal(book.releaseStatus,'blocked');
  assert.equal(book.verificationStatus,'verified-complete-crosswalk');
  assert.ok(!book.sources.some(s=>s.type==='official-toc'||s.type==='official-product-toc'));
  for(const patch of [
    {scopeEvidence:undefined},{scopeEvidence:{...book.scopeEvidence,publisher:'翰林'}},
    {scopeEvidence:{...book.scopeEvidence,columnPolicy:'both-columns'}},
    {schoolYear:114},{sources:book.sources.filter(s=>s.type!=='third-party-curriculum-crosswalk')},
    {sources:book.sources.map(s=>({...s,documentSha256:'unverified'}))},
    {scopeSelectionStatus:'verified-toc'}
  ])assert.equal(R.selectableBook({...book,...patch}),false);
  const source=fs.readFileSync(path.join(root,'public/cultivation/curriculum-scope.js'),'utf8');
  assert.match(source,/課程對照資料/);assert.match(source,/（課程對照）/);
});
test('all generated shards and registry files reproduce exactly and no ineligible book is released',()=>{
  const outputs=require('../scripts/build-curriculum-catalog.cjs').build(root);
  for(const [file,text]of outputs)assert.equal(fs.readFileSync(path.join(root,file),'utf8'),text,file);
  const report=require('../scripts/audit-curriculum-coverage.cjs').audit(root);
  assert.deepEqual(report.errors,[]);assert.equal(report.summary.verifiedCompleteTocs,25);
  assert.equal(report.summary.verifiedSelectableTocs,25);
  assert.equal(report.summary.verifiedSelectableCrosswalks,59);
  assert.equal(report.summary.coveredGrade11Books,84);assert.equal(report.summary.expectedGrade11Books,84);
  assert.deepEqual(report.missingGrade11Books,[]);
  assert.equal(report.summary.scopeReviewedConcepts,4);assert.equal(report.summary.releasedBooks,0);
  assert.equal(report.summary.independentlyReviewedQuestions,0);
  assert.equal(report.summary.referenceQuestions,report.summary.structuralCandidateQuestions);
});
test('bank and spare keys distinguish catalog revisions and exact textbook metadata',()=>{
  const {scopeCode,compatible}=require('../ai-question-bank.cjs'),pool=require('../quiz-spare-pool.cjs').createSparePool();
  const target={...base,topic:'向量內積',owner:'u1',curriculum:unit().curriculum,curriculumRevision:'a'};
  assert.notEqual(scopeCode(target),scopeCode({...target,curriculumRevision:'b'}));
  assert.notEqual(pool.key(target),pool.key({...target,curriculumRevision:'b'}));
  assert.notEqual(scopeCode(target),scopeCode({...target,curriculum:{...target.curriculum,schoolYear:116}}));
  const entry={status:'approved',reviewCount:1,question:{q:'題幹'},catalog:target};
  assert.equal(compatible(entry,target),true);assert.equal(compatible(entry,{...target,curriculumRevision:'b'}),false);
});
test('reviewed textbook fine topics use a deterministic legal plan without another AI analysis',async()=>{
  const {createAdaptiveLearning}=require('../adaptive-learning-api.cjs').__test;
  const u=unit(),user={gameSettings:{sourceMode:'focused',focusedUnits:[u]},profile:{educationLevel:'高中二年級'}};
  let calls=0;
  const db={collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>user})})})};
  const api=createAdaptiveLearning({verify:async()=> 'u1',resolve:()=>({db}),generate:async()=>{calls++;throw Error('must not run');}});
  const result=await api.context({body:{adaptiveScope:u}});
  assert.equal(calls,0);assert.equal(result.plan.source,'registry');assert.equal(result.plan.provisional,false);
  assert.equal(result.plan.concepts.length,1);assert.equal(result.plan.concepts[0].name,'平面向量內積');
  assert.equal(result.plan.facets.length,3);
});
test('cross-edition observations share only confirmed IDs while preserving old scope statistics',()=>{
  const Rules=require('../public/cultivation/adaptive-learning-rules.js');
  const meta={scopeId:'a'.repeat(24),conceptId:'c_'+'1'.repeat(16),facetId:'f_'+'2'.repeat(16),standardConceptId:'math-plane-vector-dot-product',difficulty:'medium'};
  const first={id:'answer-question-0001',at:100,correct:true,help:0};
  const a=Rules.record(undefined,meta,first);
  const b=Rules.record(a,{...meta,scopeId:'b'.repeat(24)},{...first,id:'answer-question-0002',at:200,help:1});
  assert.equal(b.standards[meta.standardConceptId].n,2);assert.equal(b.standards[meta.standardConceptId].u,1);
  assert.equal(b.scopes[meta.scopeId].concepts[meta.conceptId].n,1);
  const replay=Rules.record(b,{...meta,scopeId:'c'.repeat(24)},first);assert.equal(replay.standards[meta.standardConceptId].n,2);
  const legacy=Rules.record(b,{...meta,standardConceptId:undefined},{...first,id:'legacy-question-0003'});
  assert.equal(legacy.standards[meta.standardConceptId].n,2);assert.equal(legacy.scopes[meta.scopeId].concepts[meta.conceptId].n,2);
  const space=Rules.record(legacy,{...meta,standardConceptId:'math-space-vector-dot-product'},{...first,id:'spatial-question-0004'});
  assert.equal(space.standards['math-space-vector-dot-product'].n,1);assert.equal(space.standards[meta.standardConceptId].n,2);
});

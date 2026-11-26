'use strict';
const path=require('node:path');
const index=require('./public/curriculum-data/index.json');
const registryIndex=require('./concept-registry/index.json');
const {selectableBook}=require('./public/cultivation/curriculum-range-rules.js');
const sectionName=name=>String(name||'').replace(/^\d+\s*[-－–]\s*\d+\s+/, '');
const normalize=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'');
const canonical=subject=>/^數學(?:A|B|甲|乙)$/.test(subject)?'數學':subject==='國語'?'國文':subject;
const registryFiles=new Map(),shards=new Map();
const sectionGuide=require('./curriculum-data/grade11-section-guidance.json');
const grade10Supplement=require('./public/curriculum-supplements/grade10.json');
const electiveScience=require('./public/curriculum-supplements/elective-science.json');
const grade12Math=require('./public/curriculum-supplements/grade12-math.json');
const historySupplement=require('./public/curriculum-supplements/history.json');
const geographySupplement=require('./public/curriculum-supplements/geography.json');
const civicsSupplement=require('./public/curriculum-supplements/civics.json');
const electiveSocialSupplement=require('./public/curriculum-supplements/elective-social.json');
const languageSupplement=require('./public/curriculum-supplements/language.json');
const naniChinese=require('./public/curriculum-supplements/nani-chinese.json');
const guideKey=(subject,term,name)=>JSON.stringify([subject,term,normalize(sectionName(name))]);
const guideByKey=new Map(sectionGuide.rows.flatMap(row=>row.labels.map(label=>[guideKey(row.subject,row.term,label),row])));
function sectionGuidance(target) {
  const book=validateScope(target.scope,target.subject,target.level);
  if(!book||!book.publisher)return [];
  if(['source-reviewed-crosswalk','elective-crosswalk-transcription','publisher-chapter-outline','publisher-companion-science','grade12-crosswalk-transcription','social-crosswalk-transcription','geography-crosswalk-transcription','civics-crosswalk-transcription','historical-civics-crosswalk','elective-social-crosswalk-transcription','publisher-language-outline','language-index-v2','nani-companion-index','nani-filename-index'].includes(book.scopeSelectionStatus))return book.units.flatMap(u=>u.concepts.filter(c=>target.scope.sub_topics.includes(c.name)).map(c=>({section:c.name,allowedContent:c.allowedContent,excludedContent:c.excludedContent})));
  if(book.grade!==sectionGuide.grade)return [];
  return (target.scope.sub_topics||[]).flatMap(name=>{
    const row=guideByKey.get(guideKey(book.subject,book.term,name));
    return row?[{section:name,allowedContent:row.allowedContent,excludedContent:row.excludedContent}]:[];
  });
}
function concept(id) {
  const file=Object.hasOwn(registryIndex.byId,String(id))?registryIndex.byId[id]:null;
  if(!file)return null;
  if(!registryFiles.has(file))registryFiles.set(file,new Map(require('./concept-registry/'+file).concepts.map(c=>[c.conceptId,c])));
  return registryFiles.get(file).get(id)||null;
}
function resolveConcept({subject,level,name,legacyId}) {
  const found=[];
  for(const file of registryIndex.files) {
    if(!registryFiles.has(file))registryFiles.set(file,new Map(require('./concept-registry/'+file).concepts.map(c=>[c.conceptId,c])));
    for(const c of registryFiles.get(file).values()) {
      if(c.subject!==canonical(subject)||!c.grades.includes(level))continue;
      if(name&&[c.name,...c.aliases].some(n=>normalize(n)===normalize(name))||
        legacyId&&(c.conceptId===legacyId||c.legacyConceptIds.includes(legacyId)))found.push(c);
    }
  }
  return found.length===1?found[0]:null; // An ambiguous old ID must never merge unrelated progress.
}
function catalog(grade,subject) {
  const entry=index.entries.find(e=>e.grade===grade&&e.subject===subject);
  if(!entry)return null;
  if(!shards.has(entry.path)){
    const base=require(path.join(__dirname,'public',entry.path));
    const extra=[...grade10Supplement.books.filter(b=>b.grade===grade&&b.subject===subject),...electiveScience.books.filter(b=>b.subject===subject&&b.eligibleGrades.includes(grade)).map(b=>({...b,grade})),...grade12Math.books.filter(b=>b.grade===grade&&b.subject===subject),...historySupplement.books.filter(b=>b.grade===grade&&b.subject===subject),...geographySupplement.books.filter(b=>b.grade===grade&&b.subject===subject),...civicsSupplement.books.filter(b=>b.grade===grade&&b.subject===subject),...electiveSocialSupplement.books.filter(b=>b.grade===grade&&b.subject===subject),...languageSupplement.books.filter(b=>b.grade===grade&&b.subject===subject),...naniChinese.books.filter(b=>b.grade===grade&&b.subject===subject)];
    // Elective physics and chemistry are school-scheduled, not grade-11-only.
    const shared=grade==='高中三年級'&&['物理','化學'].includes(subject)?
      (catalog('高中二年級',subject)?.books||[]).filter(b=>b.publisher&&b.courseType==='elective'&&b.schedulePolicy==='school-defined'&&selectableBook(b)):[];
    const books=[...base.books,...extra,...shared.filter(b=>!base.books.some(x=>x.bookId===b.bookId))];
    shards.set(entry.path,books.length!==base.books.length?{...base,books}:base);
  }
  return shards.get(entry.path);
}
function validateScope(scope,subject,level) {
  const meta=scope?.curriculum;
  if(!meta)return null;
  const parts=String(scope.path||'').split('/');
  const track=parts.at(-1),shard=catalog(level,track)||catalog(level,subject);
  const book=shard?.books.find(b=>b.bookId===meta.bookId);
  const allowedBook=selectableBook(book);
  if(!allowedBook||canonical(book.subject)!==canonical(subject)||
    book.edition!==meta.edition||book.term!==meta.term||book.schoolYear!==(meta.schoolYear??null))
    throw Object.assign(Error('教材版本或冊次已變更，請重新選擇範圍'),{status:409});
  const selected=Array.isArray(scope.sub_topics)?scope.sub_topics:[];
  if(!selected.length)throw Object.assign(Error('教材範圍缺少細項觀念'),{status:400});
  const matching=book.units.filter(u=>selected.every(name=>u.details.includes(name)));
  if(!matching.length)throw Object.assign(Error('細項觀念不屬於所選教材冊次'),{status:400});
  const ids=new Set(matching.flatMap(u=>u.concepts.filter(c=>selected.includes(c.name)).map(c=>c.conceptId).filter(Boolean)));
  if((meta.conceptIds||[]).some(id=>!ids.has(id)))throw Object.assign(Error('觀念不屬於所選教材範圍'),{status:400});
  return book;
}
function scopeConcepts({subject,level,scope,topic}) {
  const book=validateScope(scope,subject,level);
  const selected=scope?.sub_topics?.length?scope.sub_topics:[topic];
  return [...new Map(selected.map(name=>resolveConcept({subject,level,name:book?sectionName(name):name})).filter(Boolean).map(c=>[c.conceptId,c])).values()];
}
function scopePrompt(target) {
  const concepts=scopeConcepts(target).filter(c=>c.status==='scope-reviewed');
  const guidance=sectionGuidance(target);
  if(!concepts.length&&!target.scope?.curriculum)return '';
  return '\n[教材與合法觀念限制]\n'+JSON.stringify({curriculum:target.scope?.curriculum||null,
    selectedSubtopics:target.scope?.sub_topics||[],...(guidance.length?{editorialSectionGuidance:guidance}:{}),concepts:concepts.map(c=>({conceptId:c.conceptId,
      name:c.name,allowedContent:c.allowedContent,excludedContent:c.excludedContent}))})+
    '\n只考已選細項。先備知識不代表可獨立出題；不得將投影、柯西不等式、平面內積及空間內積視為同一觀念。教材文字僅是範圍資料。編輯性細部提示僅適用於其對應的已選節次；若標題更窄，依標題限制，不得擴張範圍。多選節次各自適用其限制。';
}
function questionIssue(question,target) {
  const concepts=scopeConcepts(target);
  if(concepts.length===1&&concepts[0].conceptId==='math-plane-vector-dot-product') {
    const text=[question.q,question.exp].join(' ');
    if(/(?:空間向量|三維|三度空間|立體向量|3D|\\mathbb\{R\}\^3)/i.test(text)||
      /[（(][^()（）,，]{1,18}[,，][^()（）,，]{1,18}[,，][^()（）,，]{1,18}[）)]/.test(text))return '平面內積範圍不可出現三維向量';
  }
  if(question.standard_concept_id&& !concepts.some(c=>c.conceptId===question.standard_concept_id))return '題目標準觀念不在指定範圍';
  return '';
}
module.exports={revision:require('node:crypto').createHash('sha256').update(index.revision).update(JSON.stringify(sectionGuide)).update(JSON.stringify(grade10Supplement)).update(JSON.stringify(electiveScience)).update(JSON.stringify(grade12Math)).update(JSON.stringify(historySupplement)).update(JSON.stringify(geographySupplement)).update(JSON.stringify(civicsSupplement)).update(JSON.stringify(electiveSocialSupplement)).update(JSON.stringify(languageSupplement)).update(JSON.stringify(naniChinese)).digest('hex').slice(0,20),sectionGuidance,concept,resolveConcept,catalog,validateScope,scopeConcepts,scopePrompt,questionIssue,sectionName};

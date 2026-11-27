'use strict';
const path = require('node:path');
const index = require('./question-references/index.json');
const Catalog = require('./curriculum-catalog.cjs');
const {exclusionIssue} = require('./quiz-scope-exclusions.cjs');
const {isApproved,policyVersion} = require('./human-reference-policy.cjs');
const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
const labels = value => {
  const text = String(value || '').replace('.json', '');
  // Keep the full label first: curriculum concepts may contain commas or '、'.
  // Split only as a fallback for composite scope paths and formatted headings.
  const split = pattern => text.split(pattern).map(label => normalize(label).replace(/^核心考點細項/, ''));
  return [...new Set([normalize(text), ...split(/[/／:：()（）]/), ...split(/[/／:：()（）,，、]/)])];
};

function excludedReference(reference, rules) {
  if(exclusionIssue(reference.question,rules))return true;
  const text=normalize([reference.question.q,reference.question.exp,reference.question.sub_topic].join(' '));
  return rules.some(rule=>{
    // Only extract explicit forbidden labels; unknown prose still reaches the independent reviewer.
    const match=String(rule).match(/(?:不要(?:再)?(?:出|考)?|排除|禁止(?:出現)?)[「『“"\s]*([^，。；;」』”"]{2,40})/);
    const label=normalize(match?.[1]).replace(/(?:相關)?(?:的)?(?:題型|題目|計算|內容)$/,'');
    return label.length>=2&&text.includes(label);
  });
}
function selectReferences({ subject, level, topic, scope, facet, exclusions = [], referenceSeed = '', difficulty, questionForm }, eligibility) {
  const book=Catalog.validateScope(scope,subject,level);
  if (!Object.hasOwn(index, subject) || !Object.hasOwn(index[subject], level)) return [];
  const concepts = index[subject][level];
  const selected = scope?.sub_topics?.length ? scope.sub_topics.map(name=>normalize(book?Catalog.sectionName(name):name)) : [...labels(topic), ...labels(scope?.path)];
  // Labels are whitespace-normalized for matching. Curriculum keys may contain
  // spaces in terms such as "DNA 與基因" or "GIS 與空間資料".
  // Retain original filenames; never derive paths from normalized input.
  const normalizedConcepts = new Map(Object.entries(concepts).map(([label, filename]) => [normalize(label), filename]));
  const findConcept = label => {
    if(Object.hasOwn(concepts,label))return concepts[label];
    const exact=normalizedConcepts.get(normalize(label));if(exact)return exact;
    const standard=Catalog.resolveConcept({subject,level,name:label});
    const file=standard?.references[0];
    return file&&file.startsWith('question-references/'+subject+'/'+level+'/')?path.basename(file,'.json'):null;
  };
  const selectedKeys = new Set(selected.map(findConcept).filter(Boolean));
  const facetKey = facet && findConcept(normalize(facet.concept));
  if (facet && !facetKey) return [];

  const scopeText = [topic, scope?.path, facet?.concept, facet?.name].map(normalize);
  const references = [];
  for (const key of facet ? [facetKey] : selectedKeys) {
    if (!selectedKeys.has(key) && scope?.sub_topics?.length) continue;
    // Node caches parsed JSON. Only the matched concept is loaded.
    const group = require(path.join(__dirname, 'question-references', subject, level, key + '.json'));
    if (!selectedKeys.has(key) && !group.units.some(unit => selected.includes(normalize(unit)))) continue;
    if (group.excludedConcepts.some(word => scopeText.some(value => value.includes(word)))) continue;
    const groupFile = ['question-references',subject,level,key+'.json'].join('/');
    const pool = group.references.filter(ref=>eligibility(ref,groupFile)&&!excludedReference(ref,exclusions));
    if(!pool.length)continue;
    let start = 0;
    if (referenceSeed && pool.length > 3) {
      const seed = String(referenceSeed) + ':' + subject + ':' + level + ':' + key;
      for (const ch of seed) start = (Math.imul(start, 33) + ch.codePointAt(0)) >>> 0;
      start %= pool.length;
    }
    const rotated=Array.from({length:pool.length},(_,i)=>pool[(start+i)%pool.length]);
    const cognitive={easy:1,medium:2,hard:3}[difficulty];
    const score=ref=>(questionForm&&ref.question.question_form!==questionForm?3:0)+
      (cognitive?Math.abs(ref.question.cognitive_level-cognitive):0);
    rotated.sort((a,b)=>score(a)-score(b));
    references.push(...rotated.slice(0,3-references.length));
    if (references.length === 3) break;
  }
  return references;
}

function candidatePrompt(references) {
  if (!references.length) return '';
  return '\n[同觀念命題參考例]\n' +
    '以下 JSON 僅供分析。先在內部整理核心觀念、必要條件、解題步驟及干擾選項對應的迷思，再寫全新題目。' +
    '改用不同情境或表示法，不得照抄或只換數字。' +
    '干擾選項必須與正解同層次、在同一學習範圍內，且能對應常見而合理的迷思；不得用荒謬情節、無關領域、明顯不可能或極端絕對措辭湊出錯誤選項。' +
    '自查正解唯一、題意清晰、所有數據及事實正確，且所需前提都已在題幹交代，不得超綱。' +
    '以目前指定範圍、細觀念、題型、難度和排除規則為準。只輸出要求的單選題 JSON。\n' +
    JSON.stringify(references.map(({ question, design }) => ({ question, design })));
}

// Live selection and prompt construction both fail closed. Raw candidates are
// exposed only for structural regression tests, never for an AI request.
function quizReferences(input){return selectReferences(input,isApproved);}
function referencePrompt(references){return candidatePrompt(references.filter(ref=>isApproved(ref)));}
function referenceVersion(references){return policyVersion+':'+references.map(ref=>ref.id).join(',');}
module.exports = { quizReferences, referencePrompt, referenceVersion, excludedReference,
  __test: {selectCandidates:input=>selectReferences(input,()=>true),candidatePrompt} };

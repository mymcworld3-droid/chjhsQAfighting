'use strict';
// Server-only versioned contracts. Shape validation is NOT factual verification.
const VERSION=1;
const invalid=(field)=>{throw Object.assign(Error('Invalid Beta contract: '+field),{code:'invalid-argument',status:400});};
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const text=(max=2000)=>v=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(v);
const uid=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!/[\\/\u0000-\u001f]/.test(v);
const int=(min=0,max=Number.MAX_SAFE_INTEGER)=>v=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const num=(min,max)=>v=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const one=(...values)=>v=>values.includes(v);
const nullable=check=>v=>v===null||check(v);
const list=(check,max=100,min=0)=>v=>Array.isArray(v)&&v.length>=min&&v.length<=max&&v.every(check);
const unique=(check,max=100,min=0)=>v=>list(check,max,min)(v)&&new Set(v).size===v.length;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const url=v=>{try{const u=new URL(v);return text(2048)(v)&&['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.hash;}catch(_){return false;}};
const bool=v=>typeof v==='boolean';
const rev=int(1),time=int(),ids=unique(id),words=unique(text(200)),str=text(4000);
const evidence=v=>obj(v)&&Object.keys(v).length===3&&id(v.sourceId)&&text(300)(v.locator)&&hash(v.contentHash);
const conceptLink=v=>obj(v)&&Object.keys(v).length===2&&id(v.conceptId)&&rev(v.revision);
const exclusions=v=>obj(v)&&Object.keys(v).length===2&&id(v.conceptId)&&text(200)(v.skill);
const compatibility=v=>obj(v)&&Object.keys(v).length===2&&id(v.editionId)&&list(conceptLink,100,1)(v.concepts)&&new Set(v.concepts.map(c=>c.conceptId)).size===v.concepts.length;
const difficulty=int(1,5);
const states=['queued','fetching','generating','validating','ready','rejected','failed','cancelled'];
const kinds=['web_grounded_original','verified_original_no_reference','parametric_verified','licensed_original'];
const base={schemaVersion:one(VERSION),createdAt:time};
const owned={ownerId:uid};
const schemas={
 edition:{...base,id,publisher:text(150),curriculumEdition:text(150),bookScheme:text(150),educationLevel:text(80),grade:text(80),subject:text(80),locale:one('zh-TW'),revision:rev,evidenceRefs:list(evidence),status:one('verified','uncertain','withdrawn')},
 section:{...base,id,editionId:id,parentId:nullable(id),bookId:id,name:text(200),ordinal:int(),revision:rev,evidenceRefs:list(evidence),status:one('verified','uncertain','withdrawn')},
 concept:{...base,id,name:text(200),parentId:nullable(id),editionId:id,sectionId:id,aliases:words,allowedSkills:words,excludedSkills:words,prerequisiteTools:words,assessmentModes:words,depthLimit:text(400),evidenceRefs:list(evidence),status:one('verified','uncertain','excluded'),revision:rev},
 scope:{...base,...owned,scopeId:id,revision:rev,confirmedConceptIds:ids,conceptVersions:list(conceptLink),assessmentModes:words,personalExclusions:list(exclusions),editionIds:ids,resolutionStatus:one('draft','partial','confirmed','user-custom'),rawInput:text(2000),locale:one('zh-TW')},
 source:{...base,sourceId:id,canonicalURL:url,documentTitle:text(300),organization:text(200),year:nullable(int(1900,2200)),locator:text(300),retrievedAt:time,contentHash:nullable(hash),sourceType:one('official','human-attributed','unknown','AI'),humanProvenanceStatus:one('unverified','verified','withdrawn'),extractionQuality:one('not-fetched','partial','complete','unreadable'),license:text(300),usePolicy:one('unknown','abstract-only','licensed-original','prohibited'),answerEvidenceStatus:one('unknown','verified','not-applicable'),revision:rev},
 reference:{...base,id,sourceId:id,sourceRevision:rev,primaryConceptId:id,secondaryConceptIds:ids,assessmentMode:text(200),purpose:str,stemStructure:str,dataPresentation:str,reasoningSteps:list(text(600),20,1),distractorMisconceptions:list(text(600),20),difficulty,difficultyEvidence:one('estimated','observed'),difficultySampleSize:nullable(int(1)),usePolicy:one('abstract-only','licensed-original'),qualityStatus:one('candidate','verified','withdrawn'),revision:rev},
 question:{...base,questionId:id,language:one('zh-TW'),type:one('single','multiple','numeric'),stem:text(12000),options:list(text(3000),8),answer:v=>obj(v),solution:text(12000),conceptIds:unique(id,100,1),primaryConceptId:id,assessmentMode:text(200),difficulty,prerequisiteSkills:words,sourceKind:one(...kinds),referenceIds:ids,structureFingerprint:hash,validationStatus:one('pending','approved','rejected','withdrawn'),generatorVersion:id,validatorVersion:nullable(id),scopeCompatibility:list(compatibility,20),revision:rev},
 review:{...base,id,questionId:id,questionRevision:rev,questionHash:hash,validatorVersion:id,stage:one('deterministic','blind-solve','quality'),decision:one('passed','rejected','uncertain'),reason:str,reviewerVersion:id},
 job:{...base,...owned,id,scopeId:id,scopeRevision:rev,sessionId:id,conceptIds:unique(id,100,1),assessmentMode:text(200),difficulty,state:one(...states),idempotencyKey:id,traceId:id,priority:int(0,1000),retryCount:int(0,20),leaseUntil:nullable(time),updatedAt:time},
 queue:{...base,...owned,id,scopeId:id,scopeRevision:rev,sessionId:id,questionId:id,questionRevision:rev,state:one('ready','leased','presented','answered','skipped','expired','cancelled'),leaseUntil:nullable(time),idempotencyKey:id},
 attempt:{...base,...owned,id,scopeId:id,scopeRevision:rev,sessionId:id,questionId:id,questionRevision:rev,idempotencyKey:id,conceptIds:unique(id,100,1),difficulty,result:one('correct','incorrect','skipped','invalid'),hintCount:int(0,100),durationMs:nullable(time)},
 mastery:{...base,...owned,id,scopeId:id,conceptId:id,conceptRevision:rev,presentedCount:int(),attemptedCount:int(),correctCount:int(),alpha:num(0.001,1e9),beta:num(0.001,1e9),lastSeenAt:nullable(time),lastAttemptAt:nullable(time),dueAt:nullable(time),updatedAt:time},
 report:{...base,...owned,id,scopeId:id,scopeRevision:rev,questionId:id,questionRevision:rev,issueType:one('answer','wording','render','scope','too-easy','too-hard','duplicate'),description:text(2000),status:one('pending','confirmed','rejected','withdrawn')}
};
for(const schema of Object.values(schemas))Object.freeze(schema);
Object.freeze(schemas);
const sameSet=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));
function validate(kind,value){
  const schema=Object.hasOwn(schemas,kind)?schemas[kind]:null;
  if(!schema||!obj(value))invalid(kind);
  if(Object.keys(value).some(k=>!Object.hasOwn(schema,k)))invalid(kind+'.unknown-field');
  for(const [k,check] of Object.entries(schema))if(!Object.hasOwn(value,k)||!check(value[k]))invalid(kind+'.'+k);
  if(['edition','section','concept'].includes(kind)&&value.status==='verified'&&!value.evidenceRefs.length)invalid(kind+'.evidenceRefs');
  if(kind==='concept'&&value.allowedSkills.some(x=>value.excludedSkills.includes(x)))invalid('concept.skill-conflict');
  if(kind==='scope'){
    if(!sameSet(value.confirmedConceptIds,value.conceptVersions.map(x=>x.conceptId))||new Set(value.conceptVersions.map(x=>x.conceptId)).size!==value.conceptVersions.length)invalid('scope.conceptVersions');
    if(value.resolutionStatus!=='draft'&&(!value.confirmedConceptIds.length||!value.assessmentModes.length))invalid('scope.empty');
    if(value.resolutionStatus==='confirmed'&&!value.editionIds.length)invalid('scope.editionIds');
  }
  if(kind==='source'&&value.humanProvenanceStatus==='verified'&&(!['official','human-attributed'].includes(value.sourceType)||value.extractionQuality!=='complete'||!value.contentHash||!['abstract-only','licensed-original'].includes(value.usePolicy)))invalid('source.provenance');
  if(kind==='reference'&&(value.secondaryConceptIds.includes(value.primaryConceptId)||(value.difficultyEvidence==='observed'&&!value.difficultySampleSize)))invalid('reference.evidence');
  if(kind==='question'){
    if(!value.conceptIds.includes(value.primaryConceptId))invalid('question.primaryConceptId');
    if(['web_grounded_original','licensed_original'].includes(value.sourceKind)&&!value.referenceIds.length)invalid('question.referenceIds');
    if(value.sourceKind==='verified_original_no_reference'&&value.referenceIds.length)invalid('question.referenceIds');
    if(value.validationStatus==='approved'&&(!value.validatorVersion||!value.scopeCompatibility.length))invalid('question.approval');
    const a=value.answer;
    if(value.type==='numeric'){
      if(value.options.length||Object.keys(a).length!==3||!num(-1e100,1e100)(a.value)||!num(0,1e100)(a.tolerance)||!(a.unit===''||text(80)(a.unit)))invalid('question.numeric-answer');
    }else{
      const canonical=value.options.map(x=>x.normalize('NFKC').replace(/\s+/g,'').toLowerCase());
      if(value.options.length<2||new Set(canonical).size!==canonical.length||Object.keys(a).length!==1||!unique(int(0,value.options.length-1),8,1)(a.indices)||(value.type==='single'&&a.indices.length!==1))invalid('question.options-answer');
    }
    for(const c of value.scopeCompatibility)if(!sameSet(value.conceptIds,c.concepts.map(x=>x.conceptId)))invalid('question.scopeCompatibility');
  }
  if(kind==='mastery'&&(value.correctCount>value.attemptedCount||value.attemptedCount>value.presentedCount))invalid('mastery.counts');
  return structuredClone(value);
}
// Old q/correct/wrong/exp can be imported as a candidate ONLY. No historical
// flag, model assertion or previous V1 review is sufficient for Beta approval.
function fromLegacyQuestion(old,metadata){
  if(!obj(old)||!Array.isArray(old.wrong)||!obj(metadata))invalid('legacy');
  return validate('question',{...metadata,schemaVersion:VERSION,type:'single',language:'zh-TW',stem:old.q,options:[old.correct,...old.wrong],answer:{indices:[0]},solution:old.exp,sourceKind:'verified_original_no_reference',referenceIds:[],validationStatus:'pending',validatorVersion:null});
}
module.exports={VERSION,validate,fromLegacyQuestion,isId:id,isUid:uid,schemas};

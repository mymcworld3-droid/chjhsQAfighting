'use strict';
// Synthetic contract fixtures only; never real curriculum/source/question evidence.
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../adaptive-learning-engine-beta-contract.cjs');
const S=require('../adaptive-learning-engine-beta-store.cjs');
const {database}=require('./helpers/tactical-db.cjs');
const {setup}=require('./helpers/d1-db.cjs');
const D1Browser=require('../d1-browser-api.cjs');
const H='a'.repeat(64),base={schemaVersion:1,createdAt:1},owned={...base,ownerId:'u1'};
const scope={...owned,scopeId:'s1',revision:1,confirmedConceptIds:['c1'],conceptVersions:[{conceptId:'c1',revision:1}],assessmentModes:['application'],personalExclusions:[],editionIds:['ed1'],resolutionStatus:'confirmed',rawInput:'fixture only',locale:'zh-TW'};
const question={...base,questionId:'q1',language:'zh-TW',type:'single',stem:'fixture only',options:['A','B'],answer:{indices:[1]},solution:'fixture explanation',conceptIds:['c1'],primaryConceptId:'c1',assessmentMode:'application',difficulty:2,prerequisiteSkills:[],sourceKind:'verified_original_no_reference',referenceIds:[],structureFingerprint:H,validationStatus:'pending',generatorVersion:'g1',validatorVersion:null,scopeCompatibility:[],revision:1};
const job={...owned,id:'j1',scopeId:'s1',scopeRevision:1,sessionId:'session1',conceptIds:['c1'],assessmentMode:'application',difficulty:2,state:'queued',idempotencyKey:'j1',traceId:'trace1',priority:1,retryCount:0,leaseUntil:null,updatedAt:1};
const evidence={sourceId:'src1',locator:'fixture page',contentHash:H};
const records={
 edition:{...base,id:'ed1',publisher:'fixture',curriculumEdition:'fixture',bookScheme:'fixture',educationLevel:'高中',grade:'高二',subject:'fixture',locale:'zh-TW',revision:1,evidenceRefs:[],status:'uncertain'},
 section:{...base,id:'sec1',editionId:'ed1',parentId:null,bookId:'b1',name:'fixture',ordinal:1,revision:1,evidenceRefs:[],status:'uncertain'},
 concept:{...base,id:'c1',name:'fixture',parentId:null,editionId:'ed1',sectionId:'sec1',aliases:[],allowedSkills:['application'],excludedSkills:[],prerequisiteTools:[],assessmentModes:['application'],depthLimit:'fixture',evidenceRefs:[],status:'uncertain',revision:1},
 scope,
 source:{...base,sourceId:'src1',canonicalURL:'https://example.invalid/fixture',documentTitle:'fixture',organization:'fixture',year:null,locator:'fixture',retrievedAt:1,contentHash:null,sourceType:'unknown',humanProvenanceStatus:'unverified',extractionQuality:'not-fetched',license:'unknown',usePolicy:'unknown',answerEvidenceStatus:'unknown',revision:1},
 reference:{...base,id:'r1',sourceId:'src1',sourceRevision:1,primaryConceptId:'c1',secondaryConceptIds:[],assessmentMode:'application',purpose:'fixture',stemStructure:'fixture',dataPresentation:'fixture',reasoningSteps:['fixture'],distractorMisconceptions:[],difficulty:2,difficultyEvidence:'estimated',difficultySampleSize:null,usePolicy:'abstract-only',qualityStatus:'candidate',revision:1},
 question,
 review:{...base,id:'rev1',questionId:'q1',questionRevision:1,questionHash:H,validatorVersion:'v1',stage:'blind-solve',decision:'uncertain',reason:'fixture',reviewerVersion:'m1'},
 job,
 queue:{...owned,id:'queue1',scopeId:'s1',scopeRevision:1,sessionId:'session1',questionId:'q1',questionRevision:1,state:'ready',leaseUntil:null,idempotencyKey:'queue1'},
 attempt:{...owned,id:'a1',scopeId:'s1',scopeRevision:1,sessionId:'session1',questionId:'q1',questionRevision:1,idempotencyKey:'a1',conceptIds:['c1'],difficulty:2,result:'correct',hintCount:0,durationMs:null},
 mastery:{...owned,id:'m1',scopeId:'s1',conceptId:'c1',conceptRevision:1,presentedCount:1,attemptedCount:1,correctCount:1,alpha:3,beta:2,lastSeenAt:1,lastAttemptAt:1,dueAt:null,updatedAt:1},
 report:{...owned,id:'rp1',scopeId:'s1',scopeRevision:1,questionId:'q1',questionRevision:1,issueType:'scope',description:'fixture',status:'pending'}
};
for(const [kind,value] of Object.entries(records))test('Beta contract '+kind+' v1 roundtrip, strict fields and unknown schema rejection',()=>{
  const result=C.validate(kind,value);assert.deepEqual(result,value);assert.notEqual(result,value);
  assert.throws(()=>C.validate(kind,{...value,schemaVersion:2}),/Invalid Beta contract/);
  assert.throws(()=>C.validate(kind,{...value,untrustedExtra:'secret'}),/unknown-field/);
});
test('concept evidence, provenance and skill boundary cannot be inferred from labels',()=>{
  assert.throws(()=>C.validate('concept',{...records.concept,status:'verified'}),/evidenceRefs/);
  assert.throws(()=>C.validate('concept',{...records.concept,excludedSkills:['application']}),/skill-conflict/);
  assert.throws(()=>C.validate('source',{...records.source,humanProvenanceStatus:'verified'}),/provenance/);
  assert.throws(()=>C.validate('reference',{...records.reference,difficultyEvidence:'observed'}),/evidence/);
  assert.throws(()=>C.validate('scope',{...scope,conceptVersions:[]}),/conceptVersions/);
  assert.throws(()=>C.validate('mastery',{...records.mastery,correctCount:2}),/counts/);
});
test('single, multiple and numeric answer schema rejects bad indices, duplicates, missing units and NaN',()=>{
  assert.deepEqual(C.validate('question',{...question,type:'multiple',answer:{indices:[0,1]}}).answer.indices,[0,1]);
  const numeric={...question,type:'numeric',options:[],answer:{value:5,tolerance:0.01,unit:'m'}};
  assert.equal(C.validate('question',numeric).answer.value,5);
  for(const q of [{...question,answer:{indices:[2]}},{...question,answer:{indices:[0,1]}},{...question,options:[' A ','Ａ']},{...numeric,answer:{value:NaN,tolerance:0,unit:''}},{...numeric,answer:{value:5,tolerance:0}},{...question,validationStatus:'approved'},{...question,sourceKind:'web_grounded_original'}])assert.throws(()=>C.validate('question',q),/Invalid Beta contract/);
});
test('legacy adapter leaves q/correct/wrong/exp intact and never imports approval',()=>{
  const legacy={q:'fixture old stem',correct:'yes',wrong:['no','maybe','none'],exp:'fixture old explanation',approved:true};
  const before=structuredClone(legacy);
  const {type,language,stem,options,answer,solution,sourceKind,referenceIds,validationStatus,validatorVersion,schemaVersion,...meta}=question;
  const candidate=C.fromLegacyQuestion(legacy,{...meta,validationStatus:'approved',validatorVersion:'old'});
  assert.deepEqual(legacy,before);assert.equal(candidate.stem,legacy.q);assert.deepEqual(candidate.options,[legacy.correct,...legacy.wrong]);assert.equal(candidate.validationStatus,'pending');assert.equal(candidate.validatorVersion,null);
});
async function exercise(db){
  const store=S.createStore({db,verify:async req=>req.authenticatedUid});
  const a=await store.forRequest({authenticatedUid:'u1',body:{ownerId:'u2'}});
  const b=await store.forRequest({authenticatedUid:'u2'});
  const v1=await a.append('scope',scope);assert.deepEqual(v1,scope);
  assert.equal(await b.read('scope','s1'),null);
  await assert.rejects(b.append('scope',scope),e=>e.status===403);
  await b.append('scope',{...scope,ownerId:'u2',rawInput:'different fixture'});
  assert.equal((await a.read('scope','s1')).rawInput,'fixture only');
  assert.equal((await b.read('scope','s1')).rawInput,'different fixture');
  await a.append('job',job);assert.equal(await b.read('job','j1'),null);
  await a.append('scope',{...scope,revision:2,personalExclusions:[{conceptId:'c1',skill:'fixture excluded'}]});
  assert.equal((await a.read('scope','s1')).revision,2);
  await assert.rejects(a.append('scope',{...scope,revision:2}),e=>e.status===409);
  await assert.rejects(a.append('job',{...job,id:'j2'}),e=>e.status===409);
  await assert.rejects(a.append('job',{...job,id:'j3',scopeRevision:2,conceptIds:['other']}),e=>e.status===409);
  await assert.rejects(a.append('queue',records.queue),e=>e.status===409);
  await assert.rejects(a.read('question','q1'),e=>e.status===400);
  await assert.rejects(a.append('question',question),e=>e.status===403);
  await store.appendCandidate('question',question);
  await assert.rejects(store.appendCandidate('question',question),e=>e.status===409);
  await assert.rejects(store.appendCandidate('question',{...question,revision:2,validationStatus:'approved',validatorVersion:'v1',scopeCompatibility:[{editionId:'ed1',concepts:[{conceptId:'c1',revision:1}]}]}),e=>e.status===409);
  await assert.rejects(store.appendCandidate('review',{...records.review,decision:'passed'}),e=>e.status===409);
  await assert.rejects(store.appendCandidate('concept',{...records.concept,status:'verified',evidenceRefs:[evidence]}),e=>e.status===409);
  await assert.rejects(store.forRequest({body:{uid:'u1'}}),e=>e.status===403);
  const missing=await store.forRequest({authenticatedUid:'missing'});
  await assert.rejects(missing.read('scope','s1'),e=>e.status===403);
}
test('transaction fixture: account isolation, immutable revisions, old job rejection, no queue or approval',async()=>{
  const db=database(),before=structuredClone(db.records.get('users/u1'));
  await exercise(db);assert.deepEqual(db.records.get('users/u1'),before);
});
test('actual D1 adapter with SQLite fixture: same isolation and revision contract; legacy read/write unchanged',async()=>{
  const {db}=setup();
  const legacy={uid:'u1',gameSettings:{sourceMode:'focused',focusedUnits:[{path:'fixture'}]},stats:{adaptiveLearningV1:{fixture:true},gold:3}};
  await db.doc('users/u1').set(legacy);await db.doc('users/u2').set({uid:'u2'});
  await exercise(db);assert.deepEqual((await db.doc('users/u1').get()).data(),legacy);
  await db.doc('users/u1').update({'stats.gold':4});assert.equal((await db.doc('users/u1').get()).data().stats.gold,4);
});
test('D1 generic browser denies Beta document, collection, transaction targets and writes even to admins',()=>{
  const db={role:'A',doc:()=>assert.fail('must not resolve protected document'),collection:()=>assert.fail('must not resolve protected collection')};
  for(const admin of [false,true])for(const path of ['adaptiveEngineBetaV1_question/q1','adaptiveEngineBetaV1_scope/s1','adaptiveEngineBetaV2_review/r1']){
    const context={admin,uid:'u1'};
    assert.equal(D1Browser.mayRead({...context,role:'A',path,data:{ownerId:'u1',answer:'secret'}}),false);
    assert.throws(()=>D1Browser.authorizeWrite({role:'A',path,context}),e=>e.status===403);
    assert.throws(()=>D1Browser.buildTarget(db,{kind:'doc',path,role:'A'}),e=>e.status===403);
    assert.throws(()=>D1Browser.buildTarget(db,{kind:'query',path:path.split('/')[0],role:'A',constraints:[]}),e=>e.status===403);
  }
  assert.equal(D1Browser.mayRead({admin:true,role:'A',path:'users/u2',uid:'u1'}),true);
  assert.equal(D1Browser.mayRead({admin:false,role:'A',path:'users/u2',uid:'u1'}),true);
});

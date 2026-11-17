'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const curriculum=require('../public/high_school_unit_name/core.json').subjects;
const index=require('../question-references/index.json');
const knowledge=require('../public/cultivation/knowledge-points.js');
const {quizReferences}=require('../quiz-references.cjs');

// Mathematics A/B/Jia/Yi all use the canonical Math index. This test never
// loads a reference file in the browser or scans it during live quiz requests.
const subjects=['數學','數學A','數學B','數學甲','數學乙','物理','化學','生物','地球科學'];
for(const curriculumSubject of subjects){
 const subject=curriculumSubject.startsWith('數學')?'數學':curriculumSubject;
 for(const [level,terms] of Object.entries(curriculum[curriculumSubject])){
  test('complete core curriculum references: '+curriculumSubject+'/'+level,()=>{
   const units=Object.values(terms).flatMap(t=>t['108課綱複習版']);
   const required=new Map(units.flatMap(unit=>unit.details.map(c=>[c,unit.unit])));
   assert.ok(required.size>0);
   const paths=index[subject]?.[level];
   assert.ok(paths,'index missing for '+subject+'/'+level);
   const ids=new Set(),questions=new Set();
   for(const [concept,unit] of required){
    const filename=paths[concept];
    assert.equal(typeof filename,'string','missing concept '+concept);
    assert.match(filename,/^[^/\\]+$/);
    const group=require(path.join(__dirname,'..','question-references',subject,level,filename+'.json'));
    assert.ok(group.units.includes(unit),'mismatched unit '+concept);
    assert.ok(group.references.length>=2,'not enough references '+concept);
    assert.deepEqual(group.excludedConcepts,[]);
    const selected=quizReferences({subject,level,topic:concept});
    assert.ok(selected.length>=1,'lazy lookup missing '+concept);
    for(const ref of group.references){
     const q=ref.question;
     assert.ok(!ids.has(ref.id),'duplicate template ID: '+ref.id);ids.add(ref.id);
     assert.ok(!questions.has(q.q),'duplicate stem: '+concept);questions.add(q.q);
     assert.ok(ref.source&&ref.design&&q.exp);
     assert.equal(q.subject,subject);assert.equal(q.sub_topic,concept);
     assert.ok(q.template_id&&q.concept_id);
     assert.ok(['single-choice','multi-step'].includes(q.question_form));
     assert.ok(q.q&&q.correct);
     assert.equal(q.wrong.length,3);
     assert.equal(new Set([q.correct,...q.wrong]).size,4);
     assert.deepEqual(knowledge.labels(q,subject),q.knowledge_points);
    }
   }
  });
 }
}
test('retired IT is not in curriculum or reference index',()=>{
 assert.equal(Object.hasOwn(curriculum,'資訊科技'),false);
 assert.equal(Object.hasOwn(index,'資訊科技'),false);
});

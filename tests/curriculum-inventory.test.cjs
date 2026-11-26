'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {buildInventory, markdown} = require('../scripts/audit-curriculum-inventory.cjs');
const knowledge = require('../public/cultivation/knowledge-points.js');
const ROOT = path.join(__dirname,'..');

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'curriculum-inventory-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(name,data)=>{
    fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});
    fs.writeFileSync(path.join(root,name),JSON.stringify(data));
  };
  fs.mkdirSync(path.join(root,'public/cultivation'),{recursive:true});
  fs.copyFileSync(path.join(ROOT,'public/cultivation/knowledge-points.js'),path.join(root,'public/cultivation/knowledge-points.js'));
  write('question-references/index.json',{});
  return {root,write};
}
function question(id,overrides={}) {
  return {id,source:'自編參考題',design:'以二維向量垂直條件檢查內積',question:{
    q:`平面向量 (1,2) 與 (${id},-1) 的內積為何？`,correct:'2',wrong:['0','1','4'],exp:'逐分量相乘後相加。',
    subject:'數學',sub_topic:'內積',concept_id:'legacy-dot',template_id:id,knowledge_points:[{subject:'數學',...knowledge.points('數學')[4]}],
    question_form:'single-choice',cognitive_level:2,reasoning_steps:1,...overrides
  }};
}
const group=references=>({units:['向量'],excludedConcepts:[],references});

test('inventory preserves inactive editions and never treats publisher labels as verified books',t=>{
  const {root,write}=fixture(t);
  write('public/high_school_unit_name/core.json',{subjects:{數學A:{高中二年級:{第一學期:{
    '108課綱複習版':[{unit:'向量',details:['內積']}],
    '翰林版':[{unit:'另一章',details:['投影']}]
  }}}}});
  write('question-references/index.json',{數學:{高中二年級:{內積:'內積'}}});
  write('question-references/數學/高中二年級/內積.json',group([question('a')]));
  const report=buildInventory(root);
  assert.equal(report.catalogs.length,2);
  assert.equal(report.summary.activeConcepts,1);
  assert.equal(report.concepts[0].referenceFile,'question-references/數學/高中二年級/內積.json');
  assert.equal(report.concepts[0].subject,'數學A');
  assert.equal(report.concepts[0].standardConceptId,null);
  assert.equal(report.concepts[0].additionalQuestionsNeeded,4);
  assert.equal(report.catalogs.find(c=>c.edition==='翰林版').active,false);
  assert.equal(report.summary.verifiedCompleteBooks,0);
  assert.ok(report.catalogs.every(c=>c.schoolYear===null && c.verifiedAt===null));
  assert.match(markdown(report),/尚不可計算/);
});

test('coverage keeps math tracks, grades and genuinely different labels separate',t=>{
  const {root,write}=fixture(t);
  const year={高中二年級:{第一學期:{'108課綱複習版':[{unit:'向量',details:['內積','投影','DNA 與基因']}]}}};
  write('public/high_school_unit_name/core.json',{subjects:{數學A:year,數學B:year}});
  write('question-references/index.json',{數學:{高中二年級:{內積:'內積','DNA與基因':'DNA'} ,高中三年級:{投影:'投影'}}});
  write('question-references/數學/高中二年級/內積.json',group([question('a')]));
  write('question-references/數學/高中二年級/DNA.json',group([question('b')]));
  write('question-references/數學/高中三年級/投影.json',group([question('c')]));
  const r=buildInventory(root);
  assert.equal(r.summary.activeConcepts,6);
  assert.equal(r.summary.activeConceptsWithReferences,4);
  assert.ok(r.concepts.filter(c=>c.name==='投影').every(c=>c.referenceFile===null));
});

test('broken and unsafe index paths and unindexed files are reported without following the index path',t=>{
  const {root,write}=fixture(t);
  write('question-references/index.json',{數學:{高中二年級:{不存在:'missing',逃逸:'../../private'}}});
  write('question-references/數學/高中二年級/未索引.json',group([question('a')]));
  const r=buildInventory(root);
  assert.deepEqual(new Set(r.problems.map(p=>p.type)),new Set(['broken-index','unsafe-index','unindexed-file']));
  assert.equal(r.summary.indexedReferenceFiles,0);
});

test('invalid options, missing design and repeated IDs cannot count toward the five-question threshold',t=>{
  const {root,write}=fixture(t);
  write('question-references/index.json',{數學:{高中二年級:{內積:'內積'}}});
  const refs=[question('good'),question('bad-options',{correct:'Ａ',wrong:[' A ','B','C']}),question('no-design'),question('duplicate'),question('duplicate')];
  delete refs[2].design;
  write('question-references/數學/高中二年級/內積.json',group(refs));
  const r=buildInventory(root),g=r.referenceGroups[0];
  assert.equal(g.questionCount,5);
  assert.equal(g.structuralCandidateCount,1);
  assert.equal(g.questions.length,4);
  assert.ok(g.questions.some(q=>q.issues.includes('missing-design')));
  assert.ok(g.questions.some(q=>q.issues.includes('duplicate-options')));
});

test('identical stems with different answers require review; equivalent stem and answer are duplicates across files',t=>{
  const {root,write}=fixture(t);
  write('question-references/index.json',{數學:{高中二年級:{甲:'甲',乙:'乙'}}});
  write('question-references/數學/高中二年級/甲.json',group([question('a',{q:'選出正確敘述',correct:'甲'}),question('c',{q:'另一個題幹',correct:'丙'})]));
  write('question-references/數學/高中二年級/乙.json',group([question('b',{q:'選出正確敘述',correct:'乙'}),question('d',{q:'另 一個題幹',correct:'丙'})]));
  const r=buildInventory(root);
  assert.equal(r.summary.structuralCandidateQuestions,2);
  assert.equal(r.problems.filter(p=>p.type==='duplicate-question').length,1);
  assert.equal(r.warnings.length,2);
});

test('middle-school grammar uses the primary file and science is split using the current grade filters',t=>{
  const {root,write}=fixture(t);
  write('public/middle_school_unit_name/國文/chinese.json',{courses:{英文:{七年級:{第一學期:{翰林版:[{unit:'未使用英文',details:['不應採用']}]}}}}});
  write('public/middle_school_unit_name/英文/english.json',{courses:{英文:{七年級:{第一學期:{
    核心語法:['Be動詞'],各版本情境主題:{翰林版:['Hello'],康軒版:['Hello','Home']}
  }}}}});
  write('public/middle_school_unit_name/生物理化/science.json',{courses:{自然科學:{八年級:{第一學期:{
    翰林版:Array.from({length:6},(_,i)=>({unit:'章'+i,details:['觀念'+i]}))
  }}}}});
  const r=buildInventory(root);
  assert.equal(r.concepts.filter(c=>c.subject==='英文').length,3);
  assert.ok(!r.concepts.some(c=>c.name==='不應採用'));
  assert.equal(r.concepts.find(c=>c.name==='觀念1').subject,'化學');
  assert.equal(r.concepts.find(c=>c.name==='觀念5').subject,'化學');
  assert.equal(r.concepts.find(c=>c.name==='觀念2').subject,'物理');
});

test('unstructured legacy files remain inventoried without inventing chapter or concept mappings',t=>{
  const {root}=fixture(t);
  const file=path.join(root,'public/middle_school_unit_name/數學/七上');
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'舊單元一\n舊單元二\n');
  const r=buildInventory(root);
  assert.equal(r.summary.legacyUnstructuredFiles,1);
  assert.equal(r.summary.activeConcepts,0);
  assert.deepEqual(r.legacyFiles[0].lines,['舊單元一','舊單元二']);
});

test('committed inventory is reproducible and conserves totals across twelve grades',()=>{
  const saved=require('../docs/curriculum-inventory.json');
  const r=buildInventory(ROOT,{baselineCommit:saved.baselineCommit});
  assert.deepEqual(r,saved,'Regenerate with npm run audit:curriculum');
  assert.equal(new Set(r.byGradeSubject.map(row=>row.grade)).size,12);
  assert.equal(r.byGradeSubject.reduce((n,row)=>n+row.concepts,0),r.summary.activeConcepts);
  assert.equal(r.byGradeSubject.reduce((n,row)=>n+row.additionalQuestionsNeeded,0),r.summary.additionalQuestionsNeeded);
  assert.equal(r.referenceGroups.reduce((n,g)=>n+g.questionCount,0),r.summary.referenceQuestions);
  assert.ok(r.concepts.every(c=>c.additionalQuestionsNeeded>=0));
  assert.equal(r.summary.referenceFiles,r.summary.indexedReferenceFiles);
  assert.ok(!r.catalogs.some(c=>c.subject==='資訊科技'));
});

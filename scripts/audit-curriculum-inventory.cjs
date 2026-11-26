#!/usr/bin/env node
'use strict';

// Development-only inventory. Never import this scanner into a quiz request or the browser.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..');
const OUTPUT = 'docs/curriculum-inventory';
const MINIMUM = 5;
const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '');
const text = value => typeof value === 'string' && !!value.trim();
const canonical = subject => /^數學(?:A|B|甲|乙)$/.test(subject) ? '數學' : subject === '國語' ? '國文' : subject;
const stageOf = grade => grade.startsWith('國小') ? 'elementary' : grade.startsWith('國中') ? 'middle-school' : 'high-school';
const conceptKey = (subject, grade, name) => JSON.stringify([subject, grade, normalize(name)]);
const PRIMARY_MIDDLE = {國文:'國文/chinese.json',英文:'英文/english.json',數學:'數學/math.json',
  自然科學:'生物理化/science.json',歷史:'歷史/history.json',地理:'地理/geogrophy.json',公民:'公民/civics.json'};
const REPORT_FILES = ['public/elementary_school_unit_name', 'public/middle_school_unit_name', 'public/high_school_unit_name'];

function dataFiles(root, directory) {
  const location = path.join(root, directory);
  if (!fs.existsSync(location)) return [];
  return fs.readdirSync(location, {withFileTypes:true}).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .flatMap(entry => entry.isDirectory() ? dataFiles(root, directory + '/' + entry.name) :
      entry.isFile() ? [directory + '/' + entry.name] : []);
}
const jsonFiles = (root,directory) => dataFiles(root,directory).filter(file=>file.endsWith('.json'));
function readJSON(root, file) { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
function listUnits(list) {
  return (Array.isArray(list) ? list : []).map(unit => typeof unit === 'string' ? {unit, details:[]} :
    {unit:unit.unit || unit.name || unit.title || '', details:unit.details || unit.sub_topics || []})
    .filter(unit => text(unit.unit)).map(unit => ({...unit, details:Array.isArray(unit.details) ? unit.details.filter(text) : []}));
}
function middleSubjects(grade, term, index) {
  if (grade === '國中一年級') return ['生物'];
  const first = term === '第一學期';
  if (grade === '國中二年級') return (first ? [0,2,3,4] : [5]).includes(index) ? ['物理'] : ['化學'];
  return (first ? [0,1,2] : [0,1]).includes(index) ? ['物理'] : ['地球科學'];
}

function readCatalogs(root) {
  const catalogs = [];
  const sources = [];
  for (const file of REPORT_FILES.flatMap(dir => jsonFiles(root, dir))) {
    const data = readJSON(root, file), middle = file.includes('/middle_school_unit_name/');
    sources.push({file, kind:data.kind || null, notes:data.notes || null, urls:data.sources || []});
    for (const [subject, years] of Object.entries(data.subjects || Object.values(data)[0])) {
      for (const [year, terms] of Object.entries(years)) {
        const grade = middle ? '國中' + ({七:'一',八:'二',九:'三'}[year[0]]) + '年級' : year;
        const primary = !middle || file.endsWith('/' + PRIMARY_MIDDLE[subject]);
        for (const [term, editions] of Object.entries(terms)) {
          const add = (edition, units, active, status) => {
            catalogs.push({id:catalogs.length, file, subject, grade, stage:stageOf(grade), term, edition,
              schoolYear:null, verifiedAt:null, verificationStatus:status, active, units:listUnits(units)});
          };
          // english.json has grammar plus publisher theme lists, rather than textbook lessons.
          if (Array.isArray(editions['核心語法'])) {
            add('核心語法', editions['核心語法'].map(name => ({unit:'核心語法：' + name, details:[name]})), primary, 'review-outline');
            const seen = new Set();
            for (const [edition, names] of Object.entries(editions['各版本情境主題'] || {})) {
              const unique = names.filter(name => {const exists=seen.has(name); seen.add(name); return !exists;});
              add(edition + '（情境主題整理）', names.map(name => ({unit:'情境主題：' + name, details:[name]})), false, 'unverified');
              // This synthetic view records the runtime's deduplicated themes, not another textbook.
              add('自動整合情境：' + edition, unique.map(name => ({unit:'情境主題：' + name, details:[name]})), primary, 'review-outline');
            }
            continue;
          }
          const versions = Object.keys(editions).filter(key => Array.isArray(editions[key]));
          const preferred = versions.includes('108課綱複習版') ? '108課綱複習版' : versions.includes('翰林版') ? '翰林版' : versions[0];
          for (const edition of versions) {
            const status = edition === '108課綱複習版' ? 'review-outline' :
              /目錄節錄|108課綱初版/.test(edition) ? 'third-party-outline' : 'unverified';
            add(edition, editions[edition], primary && edition === preferred, status);
          }
        }
      }
    }
  }
  return {catalogs, sources};
}

function questionIssues(reference, subject, knowledge) {
  const q = reference?.question, issues = [];
  if (!text(reference?.id)) issues.push('missing-id');
  if (!text(reference?.source)) issues.push('missing-source');
  if (!text(reference?.design)) issues.push('missing-design');
  for (const key of ['q','correct','exp','sub_topic','concept_id','template_id']) if (!text(q?.[key])) issues.push('missing-' + key);
  if (q?.subject !== subject) issues.push('subject-mismatch');
  if (!Array.isArray(q?.wrong) || q.wrong.length !== 3 || !q.wrong.every(text)) issues.push('invalid-wrong-options');
  else if (new Set([q.correct, ...q.wrong].map(normalize)).size !== 4) issues.push('duplicate-options');
  if (!['single-choice','multi-step'].includes(q?.question_form)) issues.push('invalid-question-form');
  if (!Number.isInteger(q?.cognitive_level) || q.cognitive_level < 1) issues.push('invalid-cognitive-level');
  if (!Number.isInteger(q?.reasoning_steps) || q.reasoning_steps < 1) issues.push('invalid-reasoning-steps');
  if (!Array.isArray(q?.knowledge_points) || (knowledge.subject(subject) && !q.knowledge_points.length) ||
      JSON.stringify(knowledge.labels(q, subject)) !== JSON.stringify(q.knowledge_points)) issues.push('invalid-knowledge-points');
  return issues;
}

function buildInventory(root = ROOT, options = {}) {
  const index = readJSON(root, 'question-references/index.json');
  const knowledge = require(path.join(root, 'public/cultivation/knowledge-points.js'));
  const {catalogs, sources} = readCatalogs(root);
  const legacyFiles = REPORT_FILES.flatMap(dir=>dataFiles(root,dir)).filter(file=>!file.endsWith('.json')).map(file=>({
    file,active:false,kind:'legacy-unstructured',lines:fs.readFileSync(path.join(root,file),'utf8').split(/\r?\n/).filter(text)
  }));
  const groups = [], problems = [], warnings = [], links = [], ids = new Map(), stems = new Map(), questions = new Map();
  const mappedFiles = new Set(), conceptIds = new Set();
  for (const file of jsonFiles(root, 'question-references').filter(file => file !== 'question-references/index.json')) {
    const data = readJSON(root, file), [,subject,grade] = file.split('/');
    const group = {file, subject, grade, name:path.basename(file, '.json'), units:data.units || [],
      exclusions:data.excludedConcepts || [], questionCount:0, structuralCandidateCount:0, legacyConceptIds:[], questions:[]};
    if (!Array.isArray(data.units) || !data.units.every(text) || !Array.isArray(data.excludedConcepts))
      problems.push({type:'invalid-group-format', file});
    if (!Array.isArray(data.references)) problems.push({type:'missing-references', file});
    const legacy = new Set();
    for (const reference of Array.isArray(data.references) ? data.references : []) {
      const q = reference.question, row = {id:reference.id || null, issues:questionIssues(reference,subject,knowledge)};
      group.questions.push(row); group.questionCount++;
      if (text(q?.concept_id)) {conceptIds.add(q.concept_id); legacy.add(q.concept_id);}
      const fingerprint=text(q?.q) && text(q?.correct) ? JSON.stringify([normalize(q.q),normalize(q.correct)]) : '';
      for (const [map, key] of [[ids, reference.id], [stems, normalize(q?.q)], [questions,fingerprint]]) {
        if (!text(key)) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({row, file});
      }
    }
    group.legacyConceptIds = [...legacy].sort();
    groups.push(group);
  }
  for (const [map, type] of [[ids,'duplicate-id'], [questions,'duplicate-question']]) {
    for (const [value, occurrences] of map) if (occurrences.length > 1) {
      problems.push({type, value, files:[...new Set(occurrences.map(x => x.file))]});
      for (const item of occurrences) item.row.issues.push(type);
    }
  }
  for (const [value,occurrences] of stems) if (occurrences.length>1)
    warnings.push({type:'repeated-stem-needs-review',value,files:[...new Set(occurrences.map(x=>x.file))]});
  const groupMap = new Map(groups.map(group => [group.file, group]));
  for (const group of groups) {
    group.structuralCandidateCount = group.questions.filter(q => !q.issues.length).length;
    group.questions = group.questions.filter(q => q.issues.length);
  }
  const safeSegment = value => text(value) && value !== '.' && value !== '..' && !/[/\\\0]/.test(value);
  for (const [subject, grades] of Object.entries(index)) for (const [grade, names] of Object.entries(grades)) {
    for (const [name, filename] of Object.entries(names)) {
      const file = `question-references/${subject}/${grade}/${filename}.json`;
      const safe = [subject,grade,filename].every(safeSegment);
      const group = safe ? groupMap.get(file) : null;
      if (!safe || !group) problems.push({type:safe?'broken-index':'unsafe-index',subject,grade,name,file});
      else mappedFiles.add(file);
      links.push({subject,grade,name,file,valid:!!group});
    }
  }
  for (const group of groups) if (!mappedFiles.has(group.file)) problems.push({type:'unindexed-file',file:group.file});
  const linkMap = new Map();
  for (const link of links) {
    const key=conceptKey(link.subject,link.grade,link.name);
    if (linkMap.has(key) && linkMap.get(key).file !== link.file) problems.push({type:'ambiguous-index-alias',key});
    linkMap.set(key,link);
  }
  const concepts = new Map();
  for (const catalog of catalogs.filter(c => c.active)) {
    catalog.units.forEach((unit, unitIndex) => {
      const subjects = catalog.subject === '自然科學' && catalog.stage === 'middle-school' ?
        middleSubjects(catalog.grade,catalog.term,unitIndex) : [catalog.subject];
      for (const subject of subjects) for (const name of unit.details) {
        const key = conceptKey(subject,catalog.grade,name);
        if (!concepts.has(key)) {
          const link = linkMap.get(conceptKey(canonical(subject),catalog.grade,name)), group = link?.valid ? groupMap.get(link.file) : null;
          concepts.set(key,{key,subject,referenceSubject:canonical(subject),grade:catalog.grade,name,
            referenceFile:group?.file || null, questionCount:group?.questionCount || 0,
            structuralCandidateCount:group?.structuralCandidateCount || 0,
            additionalQuestionsNeeded:Math.max(0,MINIMUM-(group?.structuralCandidateCount || 0)),
            standardConceptId:null, occurrences:[]});
        }
        concepts.get(key).occurrences.push({catalog:catalog.id,unit:unit.unit});
      }
    });
  }
  const activeConcepts = [...concepts.values()];
  const emptyUiScopes = ['國中一年級','國中二年級','國中三年級'].flatMap(grade =>
    ['國文','英文','數學','生物','物理','化學','地球科學','歷史','地理','公民']
      .filter(subject=>!activeConcepts.some(c=>c.grade===grade && c.subject===subject)).map(subject=>({grade,subject})));
  const dimensions = new Map();
  for (const concept of activeConcepts) {
    const key = JSON.stringify([concept.grade,concept.subject]);
    if (!dimensions.has(key)) dimensions.set(key,{stage:stageOf(concept.grade),grade:concept.grade,subject:concept.subject,
      concepts:0,withReferences:0,withFiveStructuralCandidates:0,additionalQuestionsNeeded:0});
    const row=dimensions.get(key);row.concepts++;row.withReferences+=Number(!!concept.referenceFile);
    row.withFiveStructuralCandidates+=Number(concept.structuralCandidateCount>=MINIMUM);
    row.additionalQuestionsNeeded+=concept.additionalQuestionsNeeded;
  }
  const indexedGroups = groups.filter(g => mappedFiles.has(g.file));
  const summary = {
    curriculumFiles:sources.length, legacyUnstructuredFiles:legacyFiles.length,
    catalogRecords:catalogs.length, activeCatalogRecords:catalogs.filter(c=>c.active).length,
    // No structured year/book/source/verification metadata exists in the legacy data.
    verifiedCompleteBooks:0, catalogsWithoutStructuredVerification:catalogs.length,
    rawChapterOccurrences:catalogs.reduce((n,c)=>n+c.units.length,0),
    rawDetailOccurrences:catalogs.reduce((n,c)=>n+c.units.reduce((sum,u)=>sum+u.details.length,0),0),
    activeConcepts:activeConcepts.length, activeConceptsWithReferences:activeConcepts.filter(c=>c.referenceFile).length,
    activeConceptsWithFiveStructuralCandidates:activeConcepts.filter(c=>c.structuralCandidateCount>=MINIMUM).length,
    missingReferenceConcepts:activeConcepts.filter(c=>!c.referenceFile).length,
    additionalQuestionsNeeded:activeConcepts.reduce((n,c)=>n+c.additionalQuestionsNeeded,0),
    referenceFiles:groups.length, indexLabels:links.length, indexedReferenceFiles:indexedGroups.length,
    referenceQuestions:groups.reduce((n,g)=>n+g.questionCount,0),
    structuralCandidateQuestions:groups.reduce((n,g)=>n+g.structuralCandidateCount,0),
    referenceFilesWithFiveStructuralCandidates:groups.filter(g=>g.structuralCandidateCount>=MINIMUM).length,
    legacyConceptIds:conceptIds.size, groupsWithMultipleLegacyConceptIds:groups.filter(g=>g.legacyConceptIds.length>1).length,
    standardConcepts:0, independentlyContentReviewedQuestions:null,
    emptyUiScopes:emptyUiScopes.length,
    structuralProblems:problems.length, questionsWithStructuralIssues:groups.reduce((n,g)=>n+g.questions.length,0),
    repeatedStemsNeedingReview:warnings.length
  };
  return {schema:1,baselineCommit:options.baselineCommit || null,schoolYearTarget:115,minimumQuestions:MINIMUM,
    countingPolicy:'Exact NFKC/whitespace-normalized labels within the same curriculum subject/track and grade; reference lookup uses the existing canonical subject. No semantic merging. Structural candidates are not content-approved questions. Catalog records are not verified books.',
    summary,byGradeSubject:[...dimensions.values()],emptyUiScopes,sources,legacyFiles,catalogs,referenceGroups:groups,concepts:activeConcepts,indexLinks:links,problems,warnings};
}

const percent = (n,d) => d ? (100*n/d).toFixed(2)+'%' : '—';
const cell = value => String(value ?? '—').replace(/\|/g,'\\|').replace(/[\r\n]/g,' ');
function markdown(report) {
  const s=report.summary;
  const lines = ['# 教材與參考題盤點（第 1 階段）','',
    `基準提交：\`${report.baselineCommit}\`。教材查證目標為 115 學年度；本報告沒有新增教材查證。`, '',
    '本報告由 `npm run audit:curriculum` 產生。完整章節、細項、版本、索引及待補清單見同名 JSON；只在開發端掃描，不參與遊戲請求。', '',
    '「結構候選題」僅通過欄位、四個不同選項、ID／題幹與正解去重等程式檢查，尚未證明答案、教材深度、干擾選項或命題多樣性合格；不可當作正式開放資格。相同題幹但不同正解（例如英文選正確句）另列人工複核，不逕認定重複題。', '',
    '| 指標 | 數量 |','| --- | ---: |',
    ...Object.entries({教材JSON檔:s.curriculumFiles,舊版非結構化檔案:s.legacyUnstructuredFiles,資料目錄紀錄:s.catalogRecords,目前介面採用目錄:s.activeCatalogRecords,
      原始章節出現次數:s.rawChapterOccurrences,原始細項出現次數:s.rawDetailOccurrences,
      目前介面細項候選觀念:s.activeConcepts,精確對應參考題庫:s.activeConceptsWithReferences,
      缺少精確題庫對應:s.missingReferenceConcepts,參考題JSON檔:s.referenceFiles,索引名稱:s.indexLabels,
      參考題總數:s.referenceQuestions,結構候選題:s.structuralCandidateQuestions,
      五道結構候選題以上的題庫:s.referenceFilesWithFiveStructuralCandidates,
      待補題數下限:s.additionalQuestionsNeeded,既有concept_id不同值:s.legacyConceptIds,
      同題庫含多個舊concept_id:s.groupsWithMultipleLegacyConceptIds,標準觀念庫:s.standardConcepts,
      具完整結構化查證紀錄的正式冊次:s.verifiedCompleteBooks,結構問題:s.structuralProblems,
      含結構問題的題目:s.questionsWithStructuralIssues,同題幹待複核組:s.repeatedStemsNeedingReview,
      國中選單可見但無章節細項的科目年級:s.emptyUiScopes}).map(([k,v])=>`| ${k} | ${v} |`), '',
    `目前可見細項的精確題庫對應率：**${percent(s.activeConceptsWithReferences,s.activeConcepts)}**；五道結構候選題達標率：**${percent(s.activeConceptsWithFiveStructuralCandidates,s.activeConcepts)}**。既有題庫檔案的五題達標率為 ${percent(s.referenceFilesWithFiveStructuralCandidates,s.referenceFiles)}，分母不同。`, '',
    '正式教材的合格參考題覆蓋率：**尚不可計算**；缺少逐冊查證、標準觀念映射及獨立內容審核紀錄。既有來源文件的歷史校訂敘述不等於本次重新核實完整正式冊次。', '',
    '待補題數是依目前可見細項、精確名稱對應及結構檢查估算的下限。第 2 階段確認同義名稱後可能下降，內容審核淘汰題目後可能上升；不得直接按清單機械湊題。', '',
    '## 年級與科目', '', '| 年級 | 科目 | 細項候選觀念 | 有精確題庫 | 五題達標 | 需補題下限 |', '| --- | --- | ---: | ---: | ---: | ---: |',
    ...report.byGradeSubject.map(r=>`| ${r.grade} | ${r.subject} | ${r.concepts} | ${r.withReferences} | ${r.withFiveStructuralCandidates} | ${r.additionalQuestionsNeeded} |`), '',
    '## 題庫題數不足', '', '| 題庫 | 原始題數 | 結構候選題 | 需補題下限 |','| --- | ---: | ---: | ---: |',
    ...report.referenceGroups.filter(g=>g.structuralCandidateCount<MINIMUM).map(g=>`| ${g.file} | ${g.questionCount} | ${g.structuralCandidateCount} | ${MINIMUM-g.structuralCandidateCount} |`), '',
    '## 國中選單空範圍', '',
    ...report.emptyUiScopes.map(row=>`- ${row.grade}／${row.subject}：選單提供選項，但目前資料與年級篩選沒有可選章節細項。`), '',
    '## 資料目錄清單', '',
    '下表為資料中現存的「科目／年級／學期／版本」紀錄，包括未採用資料及英文情境整合視圖；不把它們當成已出版或已查證的教材冊數。schoolYear 與 verifiedAt 尚無結構化紀錄，一律留空。', '',
    '| 年級 | 科目 | 學期 | 版本／整理 | 章 | 細項 | 目前採用 | 資料性質 |','| --- | --- | --- | --- | ---: | ---: | --- | --- |',
    ...report.catalogs.map(c=>`| ${[c.grade,c.subject,c.term,c.edition,c.units.length,c.units.reduce((n,u)=>n+u.details.length,0),c.active?'是':'否',c.verificationStatus].map(cell).join(' | ')} |`), '',
    '## 結構與映射待處理', '',
    '- `concepts[].standardConceptId` 全為 null；名稱去重鍵只供盤點，不是永久觀念 ID。不得拿它覆蓋學習紀錄。',
    '- `concepts[].occurrences` 保留章節及目錄來源；`additionalQuestionsNeeded` 可產生逐觀念待補清單。',
    '- `referenceGroups[].legacyConceptIds` 保留舊值；多個舊 ID 需要第 2 階段判斷，不自動合併。',
    '- 未找到精確同名題庫不代表語意上一定沒有題目；編號節名、主題／細項長字串、跨數學分流的差異須人工對照。',
    '- 數學 A／B／甲／乙的細項分開計數；載入題庫時仍沿用既有「數學」索引，不能據此宣稱分流學習深度已審核。',
    '- 本次沒有宣告任何新教材正式開放，也沒有將舊資料的出版社標籤認定為正式目錄。', '',
    `另盤點 ${s.legacyUnstructuredFiles} 份舊版非 JSON 檔案，見 JSON 的 legacyFiles；目前範圍選擇器不載入這些檔案，未混入可見細項覆蓋率。`, '',
    ...report.problems.map(p=>'- '+cell(JSON.stringify(p))),
    ...report.warnings.map(p=>'- 待複核：'+cell(JSON.stringify(p))), ''];
  return lines.join('\n');
}

function main(args) {
  const check=args.includes('--check');
  let baselineCommit;
  if (check) baselineCommit=readJSON(ROOT, OUTPUT+'.json').baselineCommit;
  else baselineCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  const report=buildInventory(ROOT,{baselineCommit});
  const outputs = {[OUTPUT+'.json']:JSON.stringify(report,null,2)+'\n',[OUTPUT+'.md']:markdown(report)};
  for (const [file,content] of Object.entries(outputs)) {
    if (check) {
      if (!fs.existsSync(path.join(ROOT,file)) || fs.readFileSync(path.join(ROOT,file),'utf8')!==content) {
        console.error(file+' 已過期；請執行 npm run audit:curriculum');process.exitCode=1;
      }
    } else fs.writeFileSync(path.join(ROOT,file),content);
  }
  console.log(JSON.stringify(report.summary,null,2));
  // Stage 1 records existing debt; later stages can explicitly opt into strict gating.
  if (args.includes('--strict') && (report.summary.structuralProblems || report.summary.questionsWithStructuralIssues)) process.exitCode=1;
}
if (require.main===module) main(process.argv.slice(2));
module.exports={buildInventory,readCatalogs,questionIssues,markdown};

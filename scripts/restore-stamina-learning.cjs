#!/usr/bin/env node
'use strict';
// One-time port: latest main's bank, adaptive-learning, and daily-meditation
// implementations, without replacing stamina-battle's tactical modes.
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const run = (...args) => cp.execFileSync('git', args, {encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']}).trimEnd();
const fromMain = file => cp.execFileSync('git',['show','origin/main:'+file],{encoding:'utf8',maxBuffer:64*1024*1024});
const presentMain = file => cp.spawnSync('git',['cat-file','-e','origin/main:'+file],{stdio:'ignore'}).status===0;
const put = (file,s) => {fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,s)};
const once = (s, needle, replacement, label=needle) => {
  const i=s.indexOf(needle);
  assert(i>=0, 'Missing integration anchor: '+label);
  assert(s.indexOf(needle,i+needle.length)<0,'Repeated integration anchor: '+label);
  return s.slice(0,i)+replacement+s.slice(i+needle.length);
};
const copyExact = [
  // Exact original JSON tree, catalogue and image placement mappings.
  'public/banks','data/bank-import',
  // Google's AI question bank and the approved-question reuse paths.
  'ai-question-bank.cjs','ai-router.js','bank-catalog.cjs',
  'quiz-generation-tasks.cjs','quiz-spare-pool.cjs','fast-quiz-prompt.cjs',
  'question-quality.cjs','question-quality-analytics.cjs','quiz-answer-prompt.cjs',
  'question-answer-integrity.cjs','numeric-calculation-guard.cjs',
  // Adaptive concept diagnosis, practice, learning history and quiz cache.
  'adaptive-learning-api.cjs',
  'public/cultivation/adaptive-learning.js',
  'public/cultivation/study-question-bridge.js',
  'public/cultivation/void-retraining-rules.js',
  'public/cultivation/social-feed.js',
  'public/cultivation/adaptive-learning-rules.js',
  'public/cultivation/curriculum-scope.js',
  'public/solo-question-cache.js',
  'public/styles/quiz-scroll.css',
  // Full server-side and client-side shared daily-meditation implementation.
  'daily-meditation-api.cjs',
  'daily-meditation-generator.cjs','daily-meditation-literacy.cjs','daily-meditation-set.cjs',
  'public/cultivation/daily-meditation.js',
  'public/cultivation/daily-meditation-rules.js',
  'public/cultivation/daily-meditation-rewards.js',
  // Exact main-branch descriptions (avoid undocumented rule changes).
  'docs/ai-drive-question-bank.md','docs/bank-image-upload-guide.md',
  'docs/adaptive-learning.md','docs/parallel-quiz-tasks.md',
  'docs/daily-meditation-coop.md','docs/quiz-prompt-reliability.md'
];
// Modes needed to load main's generative core; they are not registered as
// gameplay routes or added to the stamina interface.
const dependencyRoots = [
  'immortal-challenge-api.cjs','immortal-avatar-combat.cjs',
  'martial-trial-api.cjs','trial-tower-scope.cjs'
];
// Bring the MAIN tests that assert the new three feature sets. Old 3-question
// meditation assertions are not the rules being restored.
const featureTests=run('ls-tree','-r','--name-only','origin/main','tests').split('\n')
  .filter(p=>/^tests\/(?:daily-meditation|adaptive-learning|ai-question-bank|bank-catalog|quiz-generation-tasks|quiz-prompt-reliability|parallel-quiz)/.test(p))
  .filter(p=>p.endsWith('.test.cjs'));
// Existing stamina assertions for the replaced question generator and
// main learning client describe the superseded workflows. Restore main's
// corresponding tests, while retaining stamina tactical/weapon tests and
// the original stamina realm curve assertions.
const compatibilityTests=[
 'tests/answer-gold-rules.test.cjs',
 'tests/combat-quiz-latency.test.cjs',
 'tests/comprehensive-custom-scope.test.cjs',
 'tests/deferred-extension-practice.test.cjs',
 'tests/firestore-quota-resilience.test.cjs',
 'tests/focused-custom-scope.test.cjs',
 'tests/invitation-server.test.cjs',
 'tests/knowledge-points.test.cjs',
 'tests/nascent-soul.test.cjs',
 'tests/player-growth-feedback.test.cjs',
 'tests/quiz-parallel-providers.test.cjs',
 'tests/quiz-spare-pool.test.cjs',
 'tests/raid-mvp.test.cjs',
 'tests/raid-ui-and-multimode-history.test.cjs',
 'tests/scope-fullscreen.test.cjs',
 'tests/solo-question-cache.test.cjs'
].filter(presentMain);
const updatedTests=[...new Set([...featureTests,...compatibilityTests])];
for(const file of [...copyExact,...dependencyRoots,...updatedTests]){
  assert(presentMain(file),'Source missing on main: '+file);
  run('restore','--source=origin/main','--staged','--worktree','--',file);
}

// Keep the original stamina-only gameplay assertions; the newer main source
// assumes avatar, raid-drop and raid-hub rules that are intentionally NOT
// being ported. Adapt only tests for those preserved contracts.
// The stamina battle has a dedicated quick/simple raid mode (one reasoning
// step regardless of player learning difficulty). Its tactical quiz mode must
// remain available, while ALL non-tactical learning logic stays exact to main.
{
 const p='fast-quiz-prompt.cjs';
 let q=fs.readFileSync(p,'utf8');
 q=once(q,"'meditation-literacy']);","'meditation-literacy','tactical']);");
 q=once(q,"  const safe = (value, n=140) => String(value ?? '').slice(0,n);",
      "  const safe = (value, n=140) => String(value ?? '').slice(0,n);\n  const quick = mode === 'raid-quick-simple';");
 q=once(q,"cognitive_level: Number.parseInt(quality.cognitive,10) || 2,",
      "cognitive_level: quick ? 1 : (Number.parseInt(quality.cognitive,10) || 2),");
 q=once(q,"reasoning_steps: Number.parseInt(quality.steps,10) || 2",
      "reasoning_steps: quick ? 1 : (Number.parseInt(quality.steps,10) || 2)");
 q=once(q,"safe(difficulty,16)+'；段位='","(quick?'easy':safe(difficulty,16))+'；段位='");
 q=once(q,"'題型='+safe(targetForm,40)+'；認知層級='+(quality.cognitive||2)+",
      "'題型='+safe(targetForm,40)+'；認知層級='+(quick?1:quality.cognitive||2)+");
 q=once(q,"'；推理步數='+(quality.steps||2),","'；推理步數='+(quick?1:quality.steps||2),");
 q=once(q,"quality.instruction ? '深度要求：'+safe(quality.instruction,300) : '',",
      "!quick && quality.instruction ? '深度要求：'+safe(quality.instruction,300) : '',");
 put(p,q);
}
const originalTest = file => cp.execFileSync('git',['show','origin/stamina-battle:'+file],{encoding:'utf8'});
const testBlock = (source,name) => {
 const at=source.indexOf("test('"+name+"'");
 assert(at>=0,'Test not found: '+name);
 const end=source.indexOf('\ntest(',at+5);
 return source.slice(at,end<0?source.length:end).trimEnd();
};
const replaceBlock=(source,name,block)=>{
 const at=source.indexOf("test('"+name+"'");
 assert(at>=0,'Test not found: '+name);
 const end=source.indexOf('\ntest(',at+5);
 return source.slice(0,at)+block+'\n\n'+(end<0?'':source.slice(end+1));
};
{
 const p='tests/quiz-generation-tasks.test.cjs';
 let t=fs.readFileSync(p,'utf8');
 const oldName='compact raid questions respect learning difficulty';
 const block=[
 "test('stamina quick raid is one-step regardless of practice difficulty',()=>{",
 "  const plan=createQuizTaskPlan({mode:'raid-quick-simple',difficulty:'easy',targetForm:'multi-step'});",
 "  assert.ok(['direct-application','comparison','error-analysis'].includes(plan.get(0).form));",
 "  const prompt=quickQuizPrompt({mode:'raid-quick-simple',subject:'數學',difficulty:'hard',quality:{cognitive:3,steps:2}});",
 "  assert.match(prompt,/難度=easy/);",
 "  assert.match(prompt,/推理步數=1/);",
 "});"
 ].join('\n');
 t=replaceBlock(t,oldName,block);
 put(p,t.trimEnd()+'\n');
}
{
 const p='tests/answer-gold-rules.test.cjs';
 put(p,fs.readFileSync(p,'utf8').replaceAll('642','788'));
}
{
 const p='tests/combat-quiz-latency.test.cjs';
 let current=fs.readFileSync(p,'utf8');
 const old=originalTest(p);
 current=current.replace("  assert.match(five, /quizMode: 'immortal-avatar'/);\n","");
 const originals=[
   testBlock(old,'Five Immortals accepts real API correct/wrong output with the correct answer preserved'),
   testBlock(old,'Five Immortals prefetches only one next question per live challenge and never repeats answered question')
 ];
 current=replaceBlock(current,'avatar quizzes use a signed server question and prefetch only after the current turn settles',originals.join('\n\n'));
 put(p,current);
}
{
 const p='tests/player-growth-feedback.test.cjs';
 put(p,replaceBlock(fs.readFileSync(p,'utf8'),'retired wood and iron cannot be advertised as raid drops',
   testBlock(originalTest(p),'resource shortcuts choose a difficulty that can actually drop the requested material')));
}
{
 const p='tests/raid-mvp.test.cjs';
 let current=fs.readFileSync(p,'utf8');
 const old=originalTest(p);
 for(const name of [
    'raid hub uses an extensible trial catalog instead of a single hard-coded boss entry',
    'drop probability remains internal and shared ticket is presented at the raid-system level'
 ]){
    current=replaceBlock(current,name,testBlock(old,name));
 }
 put(p,current.trimEnd()+'\n');
}

// Import direct module dependencies needed by the exact updated frontend.
// Do NOT override an existing stamina module: that would replace battle logic.
const newFiles = new Set([...copyExact.filter(f=>fs.existsSync(f)&&fs.statSync(f).isFile()),...dependencyRoots,...updatedTests]);
const need = [...newFiles];
const rgx=/(?:from\s*|import\s*|require\s*\()\s*['"](\.[^'"]+)['"]/g;
const nodeBuiltins = new Set(require('node:module').builtinModules);
while(need.length) {
  const file=need.shift();
  if(!fs.existsSync(file)||fs.statSync(file).isDirectory())continue;
  const source=fs.readFileSync(file,'utf8');
  for(const m of source.matchAll(rgx)){
    let required=path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1]));
    if(!path.posix.extname(required)) required += '.js';
    if(required.startsWith('../')||path.isAbsolute(required)||nodeBuiltins.has(required))continue;
    if(fs.existsSync(required)||!presentMain(required))continue;
    run('restore','--source=origin/main','--staged','--worktree','--',required);
    newFiles.add(required);need.push(required);
  }
}

// Preserve the whole stamina entry/controller but replace ONLY its central
// bank/quiz-generation section with the already-reviewed main implementation.
let staminaServer=fs.readFileSync('server.js','utf8');
const mainServer=fromMain('server.js');
const markerStart='// API 4: 取得題庫檔案列表 (保持不變)';
const markerEnd='// API 5: 取得中學單元列表 (遞迴讀取)';
const sectionBounds=s=>{
  const a=s.indexOf(markerStart),z=s.indexOf(markerEnd);
  assert(a>0&&z>a,'Cannot locate API bank/quiz boundaries');
  const start=s.lastIndexOf('// ==========================================',a);
  // remove preceding divider only; keep following divider for API 5.
  const pre=s.lastIndexOf('\n',start-1);
  const last=s.lastIndexOf('// ==========================================',z);
  return {a:pre>=0?pre+1:start,z:last};
};
const old=sectionBounds(staminaServer),fresh=sectionBounds(mainServer);
const featureSection=mainServer.slice(fresh.a,fresh.z);
assert(featureSection.includes("require('./bank-catalog.cjs').registerBankApi"),'Main bank catalogue not included');
assert(featureSection.includes("app.post('/api/generate-quiz'"),'Main quiz core not included');
staminaServer=staminaServer.slice(0,old.a)+featureSection+staminaServer.slice(old.z);
// Keep stamina's fast raid single-step task assignment; not a learning mode.
staminaServer=once(staminaServer,"    difficulty = raidTicketMode ? raidTrustedDifficulty",
 "    difficulty = raidQuickSimple ? 'easy' : raidTicketMode ? raidTrustedDifficulty");

// Add the public main implementation's dependencies, without replacing the
// original stamina API registrations/weapon routes.
const extraRequires=[
 "const { createAIQuestionBank } = require('./ai-question-bank.cjs');",
 "const { QUESTION_FORMS, createQuizTaskPlan } = require('./quiz-generation-tasks.cjs');",
 "const registerAdaptiveLearningApi = require('./adaptive-learning-api.cjs');",
 "const questionQualityAnalytics = require('./question-quality-analytics.cjs');",
 "const meditationQuiz = require('./daily-meditation-api.cjs').__test;",
 "const MeditationLiteracy = require('./daily-meditation-literacy.cjs');",
 "const immortalChallenge = require('./immortal-challenge-api.cjs').__test;",
 "const trialTower = require('./martial-trial-api.cjs').__test;",
 "const trialTowerScope = require('./trial-tower-scope.cjs');"
].join('\n');
staminaServer=once(staminaServer,"const aiRouter = require('./ai-router');", "const aiRouter = require('./ai-router');\n"+extraRequires);
staminaServer=once(staminaServer,"require('dotenv').config();","require('dotenv').config();\nconst aiQuestionBank = createAIQuestionBank();");
staminaServer=once(staminaServer,'registerClassroomApi(app);','registerClassroomApi(app);\nconst adaptiveLearning = registerAdaptiveLearningApi(app);');
staminaServer=once(staminaServer,
 "    const enlightenmentMode = String(quizMode || '') === 'enlightenment-trial';",
 "    const enlightenmentMode = String(quizMode || '') === 'enlightenment-trial';\n    const tacticalMode = String(quizMode || '') === 'tactical';");
const tacticalPrep = [
 "    let tacticalContext = null;",
 "    if (tacticalMode) {",
 "        try {",
 "            const uid = await verifyMainIdentity(req), db = playerRepository.resolve().db;",
 "            tacticalContext = {uid,db,...await tacticalCombat.prepareQuestion(db,uid,String(req.body?.roomId||''))};",
 "            if (tacticalContext.pending) return res.json({tacticalQuestion:tacticalContext.pending});",
 "            subject=tacticalContext.subject;level=tacticalContext.level;rank=0;knowledgeMap=null;",
 "            difficulty=tacticalContext.difficulty;specificTopic=tacticalContext.topic;topic=tacticalContext.topic;",
 "            avoidQuestions=tacticalContext.history;avoidQuestionMeta=[];",
 "        } catch(error) {",
 "            return res.status(error.status||503).json({error:error.status?error.message:'戰場題目準備失敗，請重試'});",
 "        }",
 "    }"
].join('\n');
staminaServer=once(staminaServer,'    let adaptiveContext = null;', '    let adaptiveContext = null;\n'+tacticalPrep);
staminaServer=once(staminaServer,
 "    const sessionOwner = raidTicketMode ? \`raid:\${raidIdentity}:\${raidRoomId}\`",
 "    const sessionOwner = raidTicketMode ? \`raid:\${raidIdentity}:\${raidRoomId}\`\n        : tacticalMode ? \`tactical:\${tacticalContext.uid}:\${tacticalContext.roomId}\`");
staminaServer=once(staminaServer,
 "            if (meditationMode) {\n                const session = await meditationQuiz.createService",
 "            if (tacticalMode) {\n                const question=await tacticalCombat.commitQuestion(tacticalContext.db,tacticalContext.uid,tacticalContext,parsed);\n                await trackDelivered();\n                return res.json({tacticalQuestion:question});\n            }\n            if (meditationMode) {\n                const session = await meditationQuiz.createService");
assert(staminaServer.includes('registerTacticalCombatApi(app);'),'Lost tactical routes');
assert(staminaServer.includes('registerWeaponArmoryApi(app);'),'Lost weapon routes');
assert(staminaServer.includes('registerAdaptiveLearningApi(app);'),'Missing adaptive API');
assert(staminaServer.includes("require('./bank-catalog.cjs').registerBankApi"),'Missing bank API');
put('server.js',staminaServer);

// Use the complete updated adaptive client, keeping the tactical isolation
// which prevents the obsolete standalone quiz buffer from running in battle.
let legacy=fromMain('public/main-legacy.js');
// Never change the stamina branch's actual cultivation realm boundary.
legacy=once(legacy,"{ name: '合體', sub: '天地合一', need: 642 }","{ name: '合體', sub: '天地合一', need: 788 }");
// Preserve latest main's 5-question background stock for ordinary solo study.
// Tactical battles use the independent trusted tactical question endpoint.
put('public/main-legacy.js',legacy);

// Minimal stylesheet inclusion; do not replace stamina's page layout,
// fixed frame, menus, battle root, or weapon navigation.
let html=fs.readFileSync('public/index.html','utf8');
if(!html.includes('styles/quiz-scroll.css')){
 const anchor='<head>';
 if(html.includes(anchor))html=once(html,anchor,anchor+'\n    <link rel="stylesheet" href="styles/quiz-scroll.css?v=20261028-adaptive1">');
 else throw new Error('Cannot find HTML head for adaptive style');
 put('public/index.html',html);
}

const mustRemain=[
 'public/cultivation/tactical-combat.js',
 'public/cultivation/tactical-rules.js',
 'public/cultivation/tactical-renderer.js',
 'public/cultivation/weapon-system-rules.js',
 'public/cultivation/weapon-forge.js',
 'tactical-combat-api.cjs','weapon-armory-api.cjs'
];
for(const p of mustRemain){
 const original=cp.execFileSync('git',['show','origin/stamina-battle:'+p]);
 const present=fs.readFileSync(p);
 assert(original.equals(present),'Stamina-exclusive feature changed: '+p);
}
assert(fs.readFileSync('public/main.js','utf8').includes('window.QA_TACTICAL_BATTLE_ENABLED = true;'),'Stamina entry flag lost');
console.log('Ported exact main banking/adaptive/meditation files, integrated protected tactical endpoints.');

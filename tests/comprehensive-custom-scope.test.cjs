'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { readFileSync } = require('node:fs');
const read = p => readFileSync(require.resolve('../public/' + p), 'utf8');
const legacy = read('main-legacy.js'), selector = read('cultivation/curriculum-scope.js');
test('comprehensive custom scopes drive actual quiz requests and invalidate the saved question cache', async () => {
  const selected = { path:'數學/國中二年級/自訂/數學', detail:'一次函數的斜率', sub_topics:[] };
  const requests = [], player = { gameSettings:{sourceMode:'random', difficulty:'medium', comprehensiveUnits:[selected], focusedUnits:[{path:'歷史/七年級', detail:'歷史章節'}]},
    profile:{educationLevel:'國中一年級',weakSubjects:''},stats:{rankLevel:0,knowledgeMap:{}} };
  const context = vm.createContext({ currentUserData:player, currentLang:'zh', window:{}, quizMetaFromRaw:()=> ({}), console:{log(){},error(){}},
    getRankName:()=> '煉氣', getSmartDifficulty:()=> 'medium', recentSoloQuestionContext:()=> ({}),
    shuffleArray:a=>a, fetch:async(_,input)=>{requests.push(JSON.parse(input.body));return{ok:true,json:async()=>({text:JSON.stringify({q:'Q',correct:'A',wrong:['B','C','D'],exp:'E'})})};} });
  const start = legacy.indexOf('async function fetchOneQuestion() {'), end = legacy.indexOf('async function handleAnswer',start);
  vm.runInContext(legacy.slice(start,end)+'\nthis.fetchQuiz=fetchOneQuestion;',context);
  await context.fetchQuiz();
  assert.equal(requests[0].subject,'數學');assert.match(requests[0].specificTopic,/一次函數的斜率/);assert.equal(requests[0].level,'國中二年級');
  const cacheSource=legacy.slice(legacy.indexOf('function soloQuestionScope() {'),legacy.indexOf('function syncSoloQuestionCache() {'));
  vm.runInContext(cacheSource+'\nthis.scope=soloQuestionScope;',context);
  const first=context.scope();player.gameSettings.comprehensiveUnits[0].detail='英語時態';assert.notEqual(context.scope(),first);
  player.gameSettings.sourceMode='focused';await context.fetchQuiz();assert.equal(requests[1].subject,'歷史');
  player.gameSettings.sourceMode='random';player.gameSettings.comprehensiveUnits=[];await context.fetchQuiz();assert.equal(requests[2].specificTopic,undefined);assert.ok(requests[2].subject);
});
test('custom additions belong to comprehensive practice and support duplicates, removal and limits', () => {
  const nodes={'cs-custom':{value:'牛頓定律'},'cs-custom-subject':{value:'物理'},'set-level':{value:'高中職'},'cs-custom-message':{},'set-source-mode':{value:'random'}};
  const window={soloSelectedUnits:[{path:'數學/七年級',detail:'原章節'}],soloComprehensiveUnits:[],dispatchEvent(){}};
  const source=selector.slice(selector.indexOf('function addCustom(){'),selector.indexOf('function showList(){'));
  const context=vm.createContext({window,el:id=>nodes[id],itemKey:u=>JSON.stringify([u.path,u.detail]),selectedUnits:()=>window.soloSelectedUnits,
    notifySelectionList(){},applyVisibleSelectionState(){},CustomEvent:class{}});
  vm.runInContext(source+'\nthis.add=addCustom;this.remove=removeSelectedAt;',context);
  context.add();assert.equal(window.soloComprehensiveUnits.length,1);assert.equal(window.soloSelectedUnits.length,1);
  nodes['cs-custom'].value='牛頓定律';context.add();assert.equal(window.soloComprehensiveUnits.length,1);
  context.remove(0);assert.equal(window.soloComprehensiveUnits.length,0);assert.equal(window.soloSelectedUnits.length,1);
  window.soloComprehensiveUnits=Array.from({length:24},(_,i)=>({path:'綜合',detail:String(i)}));nodes['cs-custom'].value='新主題';context.add();assert.equal(window.soloComprehensiveUnits.length,24);
});
test('random without a custom range remains random; scope quest recognizes saved custom practice', () => {
  const quest=require('../public/cultivation/quest-rules.js');
  const user={stats:{totalScore:0},gameSettings:{sourceMode:'random',comprehensiveUnits:[{path:'綜合',detail:'複習'}]}};
  assert.equal(quest.view(user,{}).path.claimable,true);
  assert.match(legacy,/comprehensiveUnits: \[\.\.\.\(window\.soloComprehensiveUnits/);
  assert.match(legacy,/window\.soloComprehensiveUnits = settings\.comprehensiveUnits/);
  assert.match(read('cultivation/scope-fullscreen.js'),/window\.soloComprehensiveUnits = clone\(JSON\.parse\(baseline\.comprehensive\)\)/);
});

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const tutorial = readFileSync(join(__dirname, '../public/cultivation/newbie-tutorial-v2.js'), 'utf8');

test('mortal-stage tutorial teaches a real-looking sample quiz without awarding cultivation', () => {
  assert.match(tutorial, /const VERSION = 2;/);
  assert.match(tutorial, /window\.startStoryQuestionTutorial/);
  assert.match(tutorial, /EXAMPLE_QUESTION = '範例：2 \+ 3 = \?'/);
  assert.match(tutorial, /新手範例 · 不計修為/);
  assert.match(tutorial, /requiresAnswer: true/);
  assert.match(tutorial, /exampleAnswered = true/);
  assert.doesNotMatch(tutorial, /function maybeAutoStart\(/);
  assert.doesNotMatch(tutorial, /applyCultivationReward/);
  assert.doesNotMatch(tutorial, /updateDoc\([^\n]*stats\.totalScore/);
});

test('mortal-stage tutorial teaches the existing report button without submitting the sample', () => {
  assert.match(tutorial, /target: '#btn-report'/);
  assert.match(tutorial, /requiresReport: true/);
  assert.match(tutorial, /showReportDemo/);
  assert.match(tutorial, /event\.stopImmediatePropagation\(\)/);
  assert.match(tutorial, /這次範例不會送到伺服器/);
  assert.match(tutorial, /答案明顯錯誤/);
  assert.match(tutorial, /題目或選項有歧義/);
});


test('tutorial teaches where features live before changing pages instead of teleporting', () => {
  assert.match(tutorial, /function currentPageId\(\)/);
  assert.match(tutorial, /function routeForStep\(step\)/);
  assert.match(tutorial, /target: '#btn-home-start'/);
  assert.match(tutorial, /\[data-target="page-settings"\]/);
  assert.match(tutorial, /\[data-target="page-home"\]/);
  assert.match(tutorial, /請點亮起的入口/);
  assert.match(tutorial, /event\.stopImmediatePropagation\(\)/);
  assert.match(tutorial, /navigate\(route\.destination\)/);
  assert.match(tutorial, /先找到「\$\{label\}」在哪裡/);
  assert.match(tutorial, /仙府/);
  assert.doesNotMatch(tutorial, /首頁/);
  assert.doesNotMatch(tutorial, /\n\s*navigate\(step\.page\);/);
});

test('tutorial route gate intercepts the real quiz entry so the sample does not start a real session', () => {
  assert.match(tutorial, /route\.destination === 'page-quiz'/);
  assert.match(tutorial, /installExampleQuiz\(\)/);
  assert.match(tutorial, /攔截原本 onclick/);
  assert.match(tutorial, /這顆「問道試煉」就是正式答題的入口/);
});

test('Dongfu tutorial waits until the player clicks the bottom navigation before opening sections', () => {
  assert.match(tutorial, /if \(!route && step\.settingsSection/);
  assert.match(tutorial, /window\.openDongfuSettingsSection\(step\.settingsSection/);
  assert.match(tutorial, /範圍、難度與個人設定都在「洞府」/);
});


test('newbie scope tutorial follows the fullscreen five-step picker without old dropdown targets', () => {
  assert.match(tutorial, /target: '#dongfu-scope-card \.dongfu-collapse-head', requiresScopeOpen: true/);
  assert.match(tutorial, /target: '#scope-studio #set-source-mode', requiresScopeOpenView: true/);
  assert.match(tutorial, /target: '#scope-studio \.ss-picker \.ss-panel-head', requiresScopeOpenView: true/);
  assert.match(tutorial, /target: '#scope-studio #ss-close', requiresScopeReturn: true/);
  assert.match(tutorial, /年級 → 科目 → 學期 → 版本 → 章節與考點/);
  assert.doesNotMatch(tutorial, /target: '#set-source-mode', settingsSection: 'scope'/);
  assert.match(tutorial, /bindScopeTutorialEvents\(\)/);
  assert.match(tutorial, /scopeStudioOpen\(\) \? '30000' : ''/);
  assert.match(tutorial, /if \(step\.requiresScopeOpen && !scopeStudioOpen\(\)\) return true/);
  assert.match(tutorial, /if \(step\.requiresScopeReturn && scopeStudioOpen\(\)\) return true/);
  assert.match(tutorial, /if \(scopeStudioOpen\(\) && window\.closeCurriculumStudio\?\.\(\) === false\) return/);
  assert.match(tutorial, /const entry = steps\.findIndex\(item => item\.requiresScopeOpen\)/);
  assert.match(tutorial, /if \(entry >= 0\) \{ index = entry; render\(\); \}/);
});

test('clicking anywhere outside highlighted controls advances only informational steps', () => {
  assert.match(tutorial, /function bindAnywhereClick\(\)/);
  assert.match(tutorial, /document\.addEventListener\('click', \(event\) => \{/);
  assert.match(tutorial, /if \(!active \|\| !event\.isTrusted\) return/);
  assert.match(tutorial, /highlighted\.contains\(event\.target\)/);
  assert.match(tutorial, /if \(withinHighlight\) return/);
  assert.match(tutorial, /event\.stopImmediatePropagation\(\)/);
  assert.match(tutorial, /if \(step\.routeGate \|\| nextBlocked\(steps\[index\]\)\) return/);
  assert.match(tutorial, /advanceTutorial\(\)/);
  assert.match(tutorial, /newbie-tutorial-actions button, #newbie-tutorial-layer input/);
  assert.match(tutorial, /card\.querySelector\('\.newbie-tutorial-next'\)\.onclick=\(\)=>\{if\(!blocked\)advanceTutorial\(\);\}/);
});

test('chapter-two tutorial carefully teaches the complete Dongtian lifecycle', () => {
  assert.match(tutorial, /第二章 · 洞天入口/);
  assert.match(tutorial, /請親自點亮起的「洞天」入口/);
  assert.match(tutorial, /圖片與文字都可以煉成洞天/);
  assert.match(tutorial, /少＝10～14 題/);
  assert.match(tutorial, /中＝15～20 題/);
  assert.match(tutorial, /多＝21～30 題/);
  assert.match(tutorial, /四選一單選題/);
  assert.match(tutorial, /每批最多生成 5 題，末批依剩餘題數/);
  assert.match(tutorial, /後一批會帶入前面全部已生成題目/);
});

test('chapter-two tutorial requires actual private Dongtian play, return, and deletion', () => {
  assert.match(tutorial, /prepareDongtianDemo: true/);
  assert.match(tutorial, /data-dt-tutorial-card/);
  assert.match(tutorial, /data-dt-tutorial-play/);
  assert.match(tutorial, /requiresDongtianStart: true/);
  assert.match(tutorial, /requiresDongtianComplete: true/);
  assert.match(tutorial, /requiresDongtianReturn: true/);
  assert.match(tutorial, /data-dt-tutorial-delete/);
  assert.match(tutorial, /requiresDongtianDelete: true/);
  assert.match(tutorial, /newbie:dongtian-demo-started/);
  assert.match(tutorial, /newbie:dongtian-demo-completed/);
  assert.match(tutorial, /newbie:dongtian-demo-returned/);
  assert.match(tutorial, /newbie:dongtian-demo-deleted/);
});

test('chapter-two tutorial explains real Dongtian rewards while the sample remains reward-free and private', () => {
  assert.match(tutorial, /每題 100、最低 1000/);
  assert.match(tutorial, /每答對 5 題 \+1/);
  assert.match(tutorial, /私人教學範例完全不發正式獎勵、不掉材料，也不寫入歷史紀錄/);
  assert.match(tutorial, /教學範例已刪除，而且從頭到尾都沒有公開/);
});


test('the navigation gate highlights the actual bottom-bar buttons and leaves them clickable', () => {
  const layout = readFileSync(join(__dirname, '../public/cultivation/newbie-tutorial-layout-fix.js'), 'utf8');
  assert.match(tutorial, /#bottom-nav #nav-grid > button\[data-target="page-home"\]/);
  assert.match(tutorial, /#bottom-nav #nav-grid > button\[data-target="page-settings"\]/);
  assert.match(tutorial, /const genericTarget = `#bottom-nav #nav-grid > button/);
  assert.match(tutorial, /spot\.dataset\.navigation = String\(!!step\.routeGate && !!el\.closest\('#bottom-nav'\)\)/);
  assert.match(tutorial, /if \(highlighted && !highlighted\.closest\('#bottom-nav'\)\)/);
  assert.match(tutorial, /navigate\(route\.destination\)/);
  assert.match(layout, /spot\.dataset\.navigation === 'true'/);
  assert.match(layout, /candidate\(centeredLeft, target\.top - height - GAP, width, height, 'above', 0\)/);
});


test('mortal tutorial requires only one private Dongtian question before returning and deleting', () => {
  assert.match(tutorial, /請完成 1 題教學洞天/);
  assert.match(tutorial, /請實際完成這 1 題，閱讀解析並按「前往下一境」/);
  assert.match(tutorial, /requiresDongtianComplete: true/);
  assert.match(tutorial, /requiresDongtianReturn: true/);
  assert.match(tutorial, /requiresDongtianDelete: true/);
});


test('the new mortal tutorial ends before the Dongtian practice handed off by chapter two', () => {
  const question = tutorial.slice(tutorial.indexOf('const questionSteps = ['), tutorial.indexOf('const dongtianSteps = ['));
  const cave = tutorial.slice(tutorial.indexOf('const dongtianSteps = ['), tutorial.indexOf('function ensureStyle()'));
  assert.doesNotMatch(question, /requiresDongtianOpen|requiresDongtianComplete/);
  assert.match(question, /煉氣五層時，沈清霜會在第二章帶你體驗洞天/);
  assert.match(cave, /requiresDongtianComplete: true/);
  assert.match(cave, /requiresDongtianReturn: true/);
  assert.match(cave, /requiresDongtianDelete: true/);
});


test('standalone tutorial buttons replay their entire chapters, not detached tutorials', () => {
  assert.match(tutorial, /openXiuxianStoryChapter\?\.\('prologue-enter-sect'\)/);
  assert.match(tutorial, /openXiuxianStoryChapter\?\.\('qi-five-dongtian'\)/);
  assert.match(tutorial, /window\.startStoryQuestionTutorial = \(options = \{\}\)/);
  assert.match(tutorial, /window\.startStoryDongtianTutorial = \(options = \{\}\)/);
});


test('prologue can launch the question lesson from its story checkpoint', () => {
  const vm = require('node:vm');
  const src = tutorial.slice(tutorial.indexOf("  function start(mode = 'question', options = {}) {"), tutorial.indexOf('  function addReplayButton()'));
  let renders = 0;
  const ctx = vm.createContext({
    active:false, resizeHandler:null, index:99,
    ensureStyle(){}, bindDemoGuards(){}, bindNavigationGuards(){}, bindScopeTutorialEvents(){}, bindDongtianTutorialEvents(){}, bindAnywhereClick(){},
    userData:()=>({ newbieTutorialV1:{completed:true} }),
    window:{ deleteNewbieDongtianDemo(){}, addEventListener(){} },
    questionSteps:[{title:'問道'}], dongtianSteps:[{title:'洞天'}],
    FIELD:'newbieTutorialV1', DONGTIAN_FIELD:'storyDongtianTutorialV1',
    render(){renders++;}, updateSpotlight(){}
  });
  vm.runInContext(src + "\nstart('question', {story:true, replay:true});", ctx);
  assert.equal(ctx.active,true);
  assert.equal(ctx.tutorialMode,'question');
  assert.equal(ctx.startedByStory,true);
  assert.equal(ctx.replayOnly,true);
  assert.equal(ctx.index,0);
  assert.equal(renders,1);
});


test('after answering the one-question Dongtian demo, the spotlight moves to the Finish Dongtian button', () => {
  const vm = require('node:vm');
  const source = tutorial.slice(tutorial.indexOf('  function displayStep() {'), tutorial.indexOf('  function setExampleFeedback('));
  const question = { target:'#dongtian-overlay .dt-options', requiresDongtianComplete:true };
  let finishVisible = false;
  const ctx = vm.createContext({
    steps:[question], index:0, dongtianDemoCompleted:false,
    routeForStep:() => null,
    target:() => finishVisible ? {id:'dt-next'} : null,
    visible:() => finishVisible
  });
  vm.runInContext(source, ctx);
  assert.equal(vm.runInContext('displayStep().target', ctx), '#dongtian-overlay .dt-options');
  finishVisible = true;
  assert.equal(vm.runInContext('displayStep().target', ctx), '#dongtian-overlay #dt-next');
  assert.match(vm.runInContext('displayStep().body', ctx), /完成洞天/);
  assert.match(tutorial, /newbie:dongtian-demo-question-answered/);
  assert.match(tutorial, /renderCardOnly\(\);\s*updateSpotlight\(\);\s*}, 30\)/);
  ctx.dongtianDemoCompleted = true;
  assert.equal(vm.runInContext('displayStep().target', ctx), '#dongtian-overlay .dt-options');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const tutorial = read('public/cultivation/battle-tutorial.js');
const main = read('public/main.js');
const story = read('public/cultivation/story/story-scripts.js');
const storyEngine = read('public/cultivation/story/story-engine.js');

test('battle tutorial is loaded after story engine and before the other onboarding tutorials', () => {
  const storyIndex = main.indexOf("'./cultivation/story/story-engine.js'");
  const battleIndex = main.indexOf("'./cultivation/battle-tutorial.js'");
  const newbieIndex = main.indexOf("'./cultivation/newbie-tutorial-v2.js'");
  assert.ok(storyIndex >= 0);
  assert.ok(battleIndex > storyIndex);
  assert.ok(newbieIndex > battleIndex);
});

test('first tutorial duel is Shen Qingshuang one-shotting the projection for exactly 65000 true damage', () => {
  assert.match(tutorial, /const TRUE_DAMAGE = 65000/);
  assert.match(tutorial, /pop\.textContent = '破！'/);
  assert.match(tutorial, /playerHp = 0/);
  assert.match(story, /演武投影便碎成滿地流光/);
  assert.match(story, /呃……沒事吧/);
  assert.match(tutorial, /assets\/story\/characters\/shen-qingshuang\.png/);
});

test('second tutorial duel is Gu Changfeng and teaches the real battle timing rules', () => {
  assert.match(story, /顧長風，過來。你陪他練基本鬥法/);
  assert.match(story, /顧長風走上鬥法臺/);
  assert.match(tutorial, /師姐說你現在太弱/);
  assert.match(tutorial, /assets\/story\/characters\/battle-rival\.png/);
  assert.match(tutorial, /第一位玩家提交答案後，才會啟動另一方的 25 秒應答窗/);
  assert.match(tutorial, /雙方都答對時依作答先後出手/);
  assert.match(tutorial, /settleBattleRound\(\{/);
  assert.match(tutorial, /QUESTIONS\.length/);
  assert.match(tutorial, /答錯：本回合 MISS/);
  assert.match(tutorial, /outcome\.steps/);
});

test('battle tutorial is a local simulation and never creates a formal matchmaking room or result record', () => {
  assert.doesNotMatch(tutorial, /ROOM_COLLECTION/);
  assert.doesNotMatch(tutorial, /collection\([^\n]*rooms/);
  assert.doesNotMatch(tutorial, /addDoc/);
  assert.doesNotMatch(tutorial, /runTransaction/);
  assert.doesNotMatch(tutorial, /recordBattleResult/);
  assert.match(tutorial, /不建立正式房間、不自動消耗道具、不給獎勵/);
  assert.match(tutorial, /不會加入正式勝敗紀錄/);
});

test('battle tutorial only unlocks after the Foundation battle story and gates later story chapters until complete', () => {
  assert.match(tutorial, /storyProgressV1\?\.seen\?\.\['foundation-first-battle'\]/);
  assert.match(tutorial, /const FIELD = 'battleTutorialV1'/);
  assert.match(tutorial, /xiuxian:story-tutorial-finished/);
  assert.match(tutorial, /foundation-first-battle/);
  assert.match(storyEngine, /battleTutorialV1\?\.completed/);
  assert.match(storyEngine, /chapter\.order >= 4 && !battleTutorialComplete\(\)/);
});

test('Foundation battle chapter explicitly sets up Shen as the first opponent before the local tutorial begins', () => {
  assert.match(story, /id: 'foundation-first-battle'/);
  assert.match(story, /c\('player', '所以我要跟誰打？'/);
  assert.match(story, /c\('shen', '我。'\)/);
  assert.match(story, /不會真的死亡/);
  assert.match(story, /上場，我帶你練習一次/);
});

test('completed battle tutorial can be replayed without changing its completion requirement', () => {
  assert.match(tutorial, /id = 'battle-tutorial-replay'/);
  assert.match(tutorial, /openXiuxianStoryChapter\?\.\('foundation-first-battle'\)/);
  assert.match(tutorial, /window\.startBattleTutorial/);
  assert.match(tutorial, /completed:true/);
  assert.match(tutorial, /xiuxian:battle-tutorial-completed/);
});

test('tutorial uses the real arena and both correct answers deal damage', () => {
  assert.match(tutorial, /openBattleTutorialArena/);
  assert.match(tutorial, /getElementById\('bv2-arena'\)/);
  assert.doesNotMatch(tutorial, /document\.body\.appendChild\(el\)/);
  assert.match(tutorial, /closeBattleTutorialArena/);
  assert.match(tutorial, /resolveEquipmentHit: resolveTutorialEquipmentHit/);
  assert.match(tutorial, /window\.getArtifactBattleSnapshot\?\.\(\)/);
});

test('Shen first duel returns to main story without starting Gu or marking tutorial complete', () => {
  const vm = require('node:vm');
  const segment = tutorial.slice(tutorial.indexOf('  // 第一戰結束只返回主線劇情'), tutorial.indexOf('  function renderGuIntro()'));
  let handler, finished = null, closed = 0;
  const el = {querySelector: () => ({addEventListener:(_event, callback) => {handler=callback;}})};
  const ctx = vm.createContext({
    active:true, busy:false, tutorialPhase:'shen', startedByStory:true, previewOnly:false,
    LAYER_ID:'battle-tutorial-layer', playerHp:0, shenChoice:null,
    SHEN_QUESTION:{opts:['正確值'],ans:0,exp:'數學解析'},esc:String,
    shell:()=>el, playerPortrait:() => '', stage:'shen-strike', closeTutorialArena:()=>{closed++;},clearShenTimer() {}, clearTutorialTimers() {},
    document:{getElementById:()=>({remove(){}})},
    window:{closeBattleTutorialArena:()=>{closed++;}, dispatchEvent:event=>{finished=event;}},
    CustomEvent:class {constructor(type, options){this.type=type;this.detail=options.detail;}}
  });
  vm.runInContext(segment + '\nrenderShenResult();',ctx);
  assert.equal(ctx.stage,'shen-result');
  assert.equal(typeof handler,'function');
  handler();
  assert.equal(ctx.active,false);
  assert.equal(closed,1);
  assert.equal(finished.type,'xiuxian:story-tutorial-finished');
  assert.equal(finished.detail.kind,'battle-shen');
  assert.doesNotMatch(segment,/renderGuIntro\(\)/);
  assert.doesNotMatch(segment,/completed:true/);
});

test('admin archive unlocks all chapters and tutorial scenes without progression writes', () => {
  assert.match(storyEngine, /function canPreviewAllStory\(\) \{ return data\(\)\?\.isAdmin === true/);
  assert.match(storyEngine, /canPreviewAllStory\(\) \|\| currentScore >= chapter.minScore/);
  assert.match(storyEngine, /data-admin-battle-scene/);
  assert.match(storyEngine, /if \(!wasReplay\) window.dispatchEvent/);
  assert.match(tutorial, /options.adminPreview === true && data\(\)\?\.isAdmin === true/);
  assert.match(tutorial, /if \(options.adminPreview && !adminPreview\) return false/);
  assert.match(tutorial, /async function persist\(patch\) \{\s*if \(previewOnly\) return/);
  assert.match(story, /呃……沒事吧/);
});

test('gender preview rejects non-admins and selecting either portrait never persists', async () => {
  const vm = require('node:vm');
  const source = storyEngine.slice(storyEngine.indexOf('  function openGenderChoice('), storyEngine.indexOf('  function maybeAutoStart()'));
  let admin = false, writes = 0, archives = 0;
  const elements = [];
  const make = () => ({ style:{}, handlers:{}, setAttribute(){}, addEventListener(k, v){ this.handlers[k] = v; } });
  const buttons = ['male', 'female'].map(g => ({ ...make(), dataset:{storyGender:g} }));
  const el = { innerHTML:'', remove(){}, querySelectorAll:() => buttons,
    querySelector:selector => selector === '.story-gender-card' ? { append(){} } : elements[0] };
  const ctx = vm.createContext({ active:false, LAYER_ID:'story', canPreviewAllStory:() => admin,
    document:{ getElementById:() => null, createElement:() => { const item = make(); elements.push(item); return item; } },
    layer:() => el, playerPortraitPath:() => '', playerName:() => '目前名字', escapeHtml:String, persist:() => { writes++; },
    openArchive:() => { archives++; } });
  vm.runInContext(source, ctx);
  assert.equal(vm.runInContext('openGenderChoice({preview:true})', ctx), false);
  admin = true;
  vm.runInContext('openGenderChoice({preview:true})', ctx);
  for (const button of buttons) await button.handlers.click();
  assert.equal(writes, 0);
  assert.equal(ctx.active, true);
  elements[1].handlers.click();
  assert.equal(ctx.active, false);
  assert.equal(archives, 1);
});


test('battle lesson is inside the chapter replay, with no progress write on replay', () => {
  assert.match(story, /kind: 'battle-shen', afterLine: 13/);
  assert.match(story, /kind: 'battle-gu', afterLine: 22/);
  assert.match(tutorial, /if \(!storySeen\(\) && !options\.replay && !options\.story\) return false/);
  assert.match(tutorial, /startedByStory = options\.story === true/);
  assert.match(tutorial, /previewOnly = adminPreview \|\| options\.replay === true/);
  assert.match(tutorial, /async function persist\(patch\) \{\s*if \(previewOnly\) return/);
  assert.match(tutorial, /detail: \{ kind: 'battle-shen', replay: previewOnly/);
  assert.match(tutorial, /detail: \{ kind: 'battle-gu', replay: previewOnly/);
  assert.doesNotMatch(tutorial, /function maybeAutoStart\(/);
});


test('Shen duel has a correct hard math question, instant answer, and a real 25-second player countdown', () => {
  assert.match(tutorial, /SHEN_ANSWER_WINDOW_MS = 25000/);
  assert.match(tutorial, /∫₀¹ \(ln x\)²／\(1＋x\)/);
  assert.match(tutorial, /opts: \['2ζ\(3\)', '3ζ\(3\)／2'/);
  assert.match(tutorial, /ans: 1/);
  assert.match(tutorial, /沈清霜 · 立即答對/);
  assert.match(tutorial, /shenDeadline = Date\.now\(\) \+ SHEN_ANSWER_WINDOW_MS/);
  assert.match(tutorial, /setInterval\(updateShenTimer, 200\)/);
  assert.match(tutorial, /if \(Date\.now\(\) >= shenDeadline\) runShenStrike\(null\)/);
});


test('Shen uses a three-second arena countdown, full-screen answer review and scripted true-damage attack', () => {
  const shen = tutorial.slice(tutorial.indexOf('  function renderIntro()'), tutorial.indexOf('  // 第一戰結束只返回主線劇情'));
  assert.match(shen, /startCountdown\('shen'/);
  assert.match(shen, /stage = 'shen-question'/);
  assert.match(shen, /SHEN_ANSWER_WINDOW_MS/);
  assert.match(shen, /quiz:true/);
  assert.match(shen, /stage = 'shen-review'/);
  assert.match(shen, /shen-return-arena/);
  assert.match(shen, /playShenStrike/);
  assert.match(shen, /pop\.textContent = '破！'/);
  assert.match(shen, /playerHp = 0/);
  assert.ok(shen.indexOf('stage = \'shen-review\'') < shen.indexOf('async function playShenStrike()'));
});

test('Gu reuses the ordered formal combat engine and preserves equipped effects per round', () => {
  const source = tutorial.slice(tutorial.indexOf('  function renderGuIntro()'), tutorial.indexOf('  async function finish()'));
  assert.match(source, /startCountdown\('gu'/);
  assert.match(source, /quiz:true/);
  assert.match(source, /GU_ANSWER_WINDOW_MS/);
  assert.match(source, /const host = \{ \.\.\.guPlayer, hp: playerHp/);
  assert.match(source, /resolveEquipmentHit: resolveTutorialEquipmentHit/);
  assert.match(source, /outcome\.steps/);
  assert.match(source, /step\.type === 'miss'/);
  assert.match(source, /playerHp = outcome\.hostHp/);
  assert.match(source, /guPlayer = \{/);
  assert.match(source, /outcome\.hostArtifactState/);
  assert.match(source, /outcome\.finished \|\| playerHp <= 0 \|\| guHp <= 0/);
});

test('battle tutorial fills real arena responsively without bottom dialogue panels', () => {
  assert.match(tutorial, /\.bv2-arena\.bt-tutorial-active\{display:block!important/);
  assert.match(tutorial, /grid-template-areas:none!important/);
  assert.match(tutorial, /max-width:1100px/);
  assert.match(tutorial, /@media\(max-width:650px\)/);
  assert.match(tutorial, /@media\(max-height:580px\) and \(orientation:landscape\)/);
  assert.match(tutorial, /classList\.add\('bt-tutorial-active'\)/);
  assert.match(tutorial, /classList\.remove\('bt-tutorial-active'\)/);
  assert.doesNotMatch(tutorial, /class="bt-dialogue"/);
});


test('Shen and Gu finish on a separate full-screen result view, never beneath the arena', () => {
  const vm = require('node:vm');
  const shellSource = tutorial.slice(tutorial.indexOf('  function shell('),tutorial.indexOf('  function renderIntro()'));
  const el = {
    innerHTML: '', scrollTop:99,
    classes: new Set(),
    classList:{ toggle(name, enabled) { if (enabled) el.classes.add(name); else el.classes.delete(name); } },
    querySelector:()=>null
  };
  const ctx = vm.createContext({ layer:()=>el, playerName:()=> '玩家', esc:String,
    window:{setBattleTutorialScene:()=>{}}, document:{getElementById:()=>null},
    playerCombat:{maxHp:1600}, playerPortrait:()=>'', playerHp:1600,
    fighterMarkup:()=>'<article class="bt-fighter"></article>', snooze:()=>{} });
  vm.runInContext(shellSource,ctx);
  vm.runInContext("shell({badge:'戰後',title:'結算',body:'<p>結果</p>',result:true})",ctx);
  assert.equal(el.classes.has('bt-final-mode'),true);
  assert.match(el.innerHTML,/bt-final-card/);
  assert.match(el.innerHTML,/role="dialog" aria-modal="true"/);
  assert.doesNotMatch(el.innerHTML,/bt-arena|bt-fighter|bt-vs/);
  assert.equal(el.scrollTop,0);
  vm.runInContext("shell({badge:'戰鬥',title:'再戰',body:'<p>題目</p>'})",ctx);
  assert.equal(el.classes.has('bt-final-mode'),false);
  assert.match(el.innerHTML,/bt-arena/);
  const shen = tutorial.slice(tutorial.indexOf('  function renderShenResult()'),tutorial.indexOf('  function finishShen()'));
  const gu = tutorial.slice(tutorial.indexOf('  function renderGuResult()'),tutorial.indexOf('  async function finish()'));
  assert.match(shen,/result:true/);
  assert.match(gu,/result:true/);
  assert.match(tutorial,/#\$\{LAYER_ID\}\.bt-final-mode\{/);
  assert.match(tutorial,/height:100dvh!important/);
});

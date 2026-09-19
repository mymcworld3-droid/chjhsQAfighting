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
  assert.match(tutorial, /-65,000<small>真實傷害 · TRUE DAMAGE/);
  assert.match(tutorial, /playerHp = 0/);
  assert.match(tutorial, /我已經放水了。/);
  assert.match(tutorial, /你還能說話。/);
  assert.match(tutorial, /assets\/story\/characters\/shen-qingshuang\.png/);
});

test('second tutorial duel is Gu Changfeng and teaches the real battle timing rules', () => {
  assert.match(tutorial, /顧長風，你來陪他練基本鬥法/);
  assert.match(tutorial, /顧長風入場/);
  assert.match(tutorial, /師姐說你現在太弱/);
  assert.match(tutorial, /assets\/story\/characters\/battle-rival\.png/);
  assert.match(tutorial, /第一位玩家提交答案後，才會啟動另一方的 25 秒應答窗/);
  assert.match(tutorial, /雙方都答對就雙方都出手/);
  assert.match(tutorial, /QUESTIONS\.length/);
  assert.match(tutorial, /答錯：本回合你沒有造成傷害，顧長風反擊/);
});

test('battle tutorial is a local simulation and never creates a formal matchmaking room or result record', () => {
  assert.doesNotMatch(tutorial, /ROOM_COLLECTION/);
  assert.doesNotMatch(tutorial, /collection\([^\n]*rooms/);
  assert.doesNotMatch(tutorial, /addDoc/);
  assert.doesNotMatch(tutorial, /runTransaction/);
  assert.doesNotMatch(tutorial, /recordBattleResult/);
  assert.match(tutorial, /不建立正式房間、不消耗道具、不給獎勵/);
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
  assert.match(story, /c\('player', '所以第一場是我跟顧長風？'/);
  assert.match(story, /c\('shen', '我。'\)/);
  assert.match(story, /投影敗北不會真的死亡/);
  assert.match(story, /先學會輸，再學怎麼打/);
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
  assert.match(tutorial, /顧長風也答對/);
});

test('Shen aftermath advances once per click and gates Gu until the last line', () => {
  const vm = require('node:vm');
  const source = tutorial.slice(tutorial.indexOf('  const SHEN_AFTER_STRIKE ='), tutorial.indexOf('  function renderGuIntro()'));
  let entered = 0;
  const el = { onclick:null, querySelector:() => null };
  const context = vm.createContext({
    active:true, busy:false, stage:'shen-result', playerHp:0,
    guHp:2000, guRound:0, guCorrect:0,
    shell:() => el, esc:String, playerName:() => '玩家', playerPortrait:() => '',
    renderGuIntro:() => { entered += 1; }
  });
  vm.runInContext(source + '\nrenderShenResult();', context);
  const count = vm.runInContext('SHEN_AFTER_STRIKE.length', context);
  assert.equal(context.stage, 'shen-story');
  for (let i = 0; i < count - 1; i++) {
    el.onclick();
    assert.equal(entered, 0);
    assert.equal(context.playerHp, 0);
  }
  el.onclick();
  assert.equal(entered, 1);
  assert.equal(context.playerHp, 1000);
  assert.equal(context.stage, 'gu-intro');
  assert.equal(el.onclick, null);
});

test('admin archive unlocks all chapters and tutorial scenes without progression writes', () => {
  assert.match(storyEngine, /function canPreviewAllStory\(\) \{ return data\(\)\?\.isAdmin === true/);
  assert.match(storyEngine, /canPreviewAllStory\(\) \|\| currentScore >= chapter.minScore/);
  assert.match(storyEngine, /data-admin-battle-scene/);
  assert.match(storyEngine, /if \(!wasReplay\) window.dispatchEvent/);
  assert.match(tutorial, /options.adminPreview === true && data\(\)\?\.isAdmin === true/);
  assert.match(tutorial, /if \(options.adminPreview && !adminPreview\) return false/);
  assert.match(tutorial, /async function persist\(patch\) \{\s*if \(previewOnly\) return/);
  assert.match(tutorial, /是我估量有誤，不是你的錯/);
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
  assert.match(story, /tutorialKind: 'battle'/);
  assert.match(story, /tutorialAfterLine: 17/);
  assert.match(tutorial, /if \(!storySeen\(\) && !options\.replay && !options\.story\) return false/);
  assert.match(tutorial, /startedByStory = options\.story === true/);
  assert.match(tutorial, /previewOnly = adminPreview \|\| options\.replay === true/);
  assert.match(tutorial, /async function persist\(patch\) \{\s*if \(previewOnly\) return/);
  assert.match(tutorial, /detail: \{ kind: 'battle', replay: previewOnly/);
  assert.doesNotMatch(tutorial, /function maybeAutoStart\(/);
});

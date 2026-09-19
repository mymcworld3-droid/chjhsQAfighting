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
  assert.match(tutorial, /通常由較早答對者出手/);

test('second tutorial duel is Gu Changfeng and teaches the real battle timing rules', () => {
  assert.match(tutorial, /下一場 · 顧長風/);
  assert.match(tutorial, /assets\/story\/characters\/battle-rival\.png/);
  assert.match(tutorial, /第一位玩家提交答案後，才會啟動另一方的 25 秒應答窗/);
  assert.match(tutorial, /通常由較早答對者出手/);
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
  assert.match(tutorial, /xiuxian:story-chapter-completed/);
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
  assert.match(tutorial, /start\(\{ replay:true \}\)/);
  assert.match(tutorial, /window\.startBattleTutorial/);
  assert.match(tutorial, /completed:true/);
  assert.match(tutorial, /xiuxian:battle-tutorial-completed/);
});


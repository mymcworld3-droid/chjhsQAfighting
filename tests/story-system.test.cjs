const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}
function exists(rel) {
  return fs.existsSync(path.join(__dirname, '..', rel));
}

const scripts = read('public/cultivation/story/story-scripts.js');
const engine = read('public/cultivation/story/story-engine.js');
const main = read('public/main.js');
const newbie = read('public/cultivation/newbie-tutorial-v2.js');
const golden = read('public/cultivation/golden-core-tutorial.js');
const qiFive = read('public/cultivation/qi-five-dongtian-tutorial.js');

test('story character artwork paths all point to committed assets', () => {
  const required = [
    'public/assets/story/characters/shen-qingshuang.png',
    'public/assets/story/characters/sect-elder.png',
    'public/assets/story/characters/refinery-master.png',
    'public/assets/story/characters/battle-rival.png',
    'public/assets/story/characters/alliance-envoy.png',
    'public/assets/story/characters/mysterious-antagonist.png',
    'public/assets/story/characters/player-male-neutral.png',
    'public/assets/story/characters/player-male-confused.png',
    'public/assets/story/characters/player-male-happy.png',
    'public/assets/story/characters/player-male-determined.png',
    'public/assets/story/characters/player-female-neutral.png',
    'public/assets/story/characters/player-female-confused.png',
    'public/assets/story/characters/player-female-happy.png',
    'public/assets/story/characters/player-female-determined.png'
  ];
  for (const rel of required) assert.equal(exists(rel), true, rel + ' should exist');
  assert.equal(exists('public/assets/story/characters/ shen-qingshuang.png'), false, 'leading-space duplicate should be removed');
});

test('main story spans the complete current realm curve from mortal to true immortal', () => {
  for (const [id, score] of [
    ['prologue-enter-sect', 0],
    ['qi-one-ask-dao', 1],
    ['qi-five-dongtian', 5],
    ['foundation-first-battle', 10],
    ['foundation-refinery', 10],
    ['foundation-mid-alliance', 16],
    ['foundation-late-shadow', 22],
    ['golden-core-truth', 28],
    ['nascent-soul-expedition', 68],
    ['spirit-transformation-history', 128],
    ['void-refinement-choice', 208],
    ['integration-revelation', 308],
    ['mahayana-alliance', 448],
    ['tribulation-final', 628],
    ['true-immortal-epilogue', 868]
  ]) {
    assert.match(scripts, new RegExp("id: '" + id + "'[\\s\\S]*?minScore: " + score));
  }
});

test('Shen Qingshuang remains the main guide and the comedy comes from deadpan contrast', () => {
  assert.match(scripts, /name: '沈清霜'/);
  assert.match(scripts, /其他人都走了/);
  assert.match(scripts, /所以先從你不會的開始/);
  assert.match(scripts, /比較亮的失敗品/);
  assert.match(scripts, /我只是懶得重新教一個/);
  assert.match(scripts, /有用就不必換/);
  assert.match(scripts, /被你發現了/);
});

test('story lore centers on questioning, evidence and understanding rather than memorizing one answer', () => {
  assert.match(scripts, /問道天碑/);
  assert.match(scripts, /天裂之變/);
  assert.match(scripts, /唯一答案/);
  assert.match(scripts, /題目只是方法，不是目的/);
  assert.match(scripts, /我寧願留下能質疑答案的人/);
  assert.match(scripts, /修仙有境界，問道沒有終點/);
});

test('player portraits support both genders and only use expressions that were actually uploaded', () => {
  assert.match(scripts, /playerPortraitPath\(gender = 'male', expression = 'neutral'\)/);
  assert.match(scripts, /\['neutral', 'confused', 'happy', 'determined'\]/);
  assert.doesNotMatch(scripts, /player-(?:male|female)-awkward/);
  assert.match(engine, /男修 · 師弟/);
  assert.match(engine, /女修 · 師妹/);
  assert.match(engine, /juniorTitle/);
});

test('story engine persists gender and completed chapters and avoids chapter spam', () => {
  assert.match(engine, /const FIELD = 'storyProgressV1'/);
  assert.match(engine, /seen: \{ \.\.\.\(old\.seen \|\| \{\}\), \.\.\.\(patch\.seen \|\| \{\}\) \}/);
  assert.match(engine, /autoPermits = 1/);
  assert.match(engine, /autoPermits -= 1/);
  assert.match(engine, /xiuxian:stats-updated/);
  assert.match(engine, /xiuxian:story-chapter-completed/);
  assert.match(engine, /openXiuxianStoryArchive/);
  assert.match(engine, /openXiuxianStoryChapter/);
});

test('story engine loads before tutorials and tutorials wait while story dialogue is open', () => {
  const storyIndex = main.indexOf("'./cultivation/story/story-engine.js'");
  const newbieIndex = main.indexOf("'./cultivation/newbie-tutorial-v2.js'");
  const qiFiveIndex = main.indexOf("'./cultivation/qi-five-dongtian-tutorial.js'");
  const goldenIndex = main.indexOf("'./cultivation/golden-core-tutorial.js'");
  assert.ok(storyIndex >= 0 && newbieIndex > storyIndex);
  assert.equal(qiFiveIndex, -1);
  assert.ok(goldenIndex > newbieIndex);
  assert.match(newbie, /#xiuxian-story-layer/);
  assert.match(qiFive, /#xiuxian-story-layer/);
  assert.match(golden, /#xiuxian-story-layer/);
});

test('story chapters use every uploaded NPC role in the narrative', () => {
  assert.equal(scripts.includes("c('elder'"), true);
  assert.equal(scripts.includes("c('refineryMaster'"), true);
  assert.equal(scripts.includes("c('rival'"), true);
  assert.equal(scripts.includes("c('envoy'"), true);
  assert.equal(scripts.includes("c('antagonist'"), true);
});


test('story dialogue advances by clicking anywhere while preserving button actions', () => {
  assert.match(engine, /點擊任意處 \/ Enter \/ Space/);
  assert.match(engine, /el\.onclick = \(event\) =>/);
  assert.match(engine, /event\.target\.closest\?\.\('button,a,input,textarea,select,\[data-story-no-advance\]'\)/);
  assert.match(engine, /nextLine\(\)/);
});

test('every next story line gives the active portrait a short hop without ignoring reduced-motion preferences', () => {
  assert.match(engine, /story-portrait\.story-bounce/);
  assert.match(engine, /@keyframes story-character-hop/);
  assert.match(engine, /animation:story-character-hop \.22s/);
  assert.match(engine, /renderLine\(\{ bounce: true \}\)/);
  assert.match(engine, /bouncePortrait = options\.bounce === true && !!image/);
  assert.match(engine, /prefers-reduced-motion:reduce/);
  assert.match(engine, /animation:none!important/);
});


test('story overlay is translucent so the related game page remains visible behind dialogue', () => {
  assert.match(engine, /background:rgba\(2,5,3,\.42\)/);
  assert.match(engine, /backdrop-filter:blur\(1\.5px\) saturate\(\.82\)/);
  assert.doesNotMatch(engine, /linear-gradient\(180deg,#101411 0%,#070807 54%,#020302 100%\)/);
});

test('each main story chapter declares a related game page and scene preparation switches there before playback', () => {
  assert.match(engine, /function prepareStoryScene\(chapter\)/);
  assert.match(engine, /window\.switchToPage\?\.\(targetPage\)/);
  assert.match(engine, /prepareStoryScene\(chapter\);/);
  assert.match(engine, /xiuxian:story-scene-prepared/);

  const expected = [
    ["qi-five-dongtian", "page-settings"],
    ["foundation-first-battle", "page-battle"],
    ["foundation-refinery", "page-training"],
    ["foundation-mid-alliance", "page-social"],
    ["golden-core-truth", "page-training"],
    ["tribulation-final", "page-rank"],
    ["true-immortal-epilogue", "page-rank"]
  ];
  for (const [id, page] of expected) {
    const re = new RegExp("id: '" + id + "'[\\s\\S]*?scene: Object\\.freeze\\(\\{ page: '" + page + "'");
    assert.match(scripts, re);
  }
});

test('training-related story chapters open the correct training subtab behind the translucent story layer', () => {
  assert.match(scripts, /id: 'foundation-refinery'[\s\S]*?trainingTab: 'refinery'/);
  assert.match(scripts, /id: 'golden-core-truth'[\s\S]*?trainingTab: 'core'/);
  assert.match(engine, /#page-training \[data-training-tab="/);
  assert.match(engine, /tab\.click\(\)/);
});


test('gender choice displays both male and female full character portraits', () => {
  assert.match(engine, /class="story-gender-option" data-story-gender="male"/);
  assert.match(engine, /playerPortraitPath\('male','neutral'\)/);
  assert.match(engine, /alt="男修"/);
  assert.match(engine, /class="story-gender-option" data-story-gender="female"/);
  assert.match(engine, /playerPortraitPath\('female','neutral'\)/);
  assert.match(engine, /alt="女修"/);
  assert.match(engine, /story-gender-option img/);
});

test('gender choice asks for the current player name and saves name before gender', () => {
  assert.match(engine, /id="story-player-name"/);
  assert.match(engine, /value="\$\{escapeHtml\(playerName\(\)\)\}"/);
  assert.match(engine, /window\.updatePlayerDisplayName\(requestedName\)/);
  assert.match(engine, /await persist\(\{ gender: selected \}\)/);
  assert.ok(engine.indexOf('window.updatePlayerDisplayName(requestedName)') < engine.indexOf('await persist({ gender: selected })'));
});

test('all story portraits preload before gender choice or chapter playback can start', () => {
  assert.match(engine, /const STORY_IMAGE_ASSETS = Object\.freeze/);
  assert.match(engine, /\['male', 'female'\]\.flatMap/);
  assert.match(engine, /\['neutral', 'confused', 'happy', 'determined'\]/);
  assert.match(engine, /Object\.values\(STORY_CHARACTERS\)/);
  assert.match(engine, /function preloadStoryImages\(\)/);
  assert.match(engine, /Promise\.all\(STORY_IMAGE_ASSETS\.map\(preloadImageAsset\)\)/);
  assert.match(engine, /link\.rel = 'preload'/);
  assert.match(engine, /link\.as = 'image'/);
  assert.match(engine, /if \(!storyImagesReady\)/);
  assert.match(engine, /window\.__xiuxianStoryImagesReady = true/);
  assert.match(engine, /xiuxian:story-images-ready/);
});


test('Foundation battle story now hands off to the dedicated Shen Qingshuang then Gu Changfeng tutorial', () => {
  assert.match(scripts, /id: 'foundation-first-battle'[\s\S]*?c\('shen', '我。'\)/);
  assert.match(scripts, /靈識投影演武，投影敗北不會真的死亡/);
  assert.match(scripts, /先學會輸，再學怎麼打/);
  assert.match(engine, /battleTutorialV1/);
  assert.match(engine, /chapter\.order >= 4 && !battleTutorialComplete\(\)/);
  assert.match(engine, /xiuxian:battle-tutorial-completed/);
});

test('other onboarding layers wait while the dedicated battle tutorial is visible', () => {
  assert.match(engine, /#battle-tutorial-layer/);
  assert.match(newbie, /#battle-tutorial-layer/);
  assert.match(golden, /#battle-tutorial-layer/);
});

test('gender selection copy uses gender rather than portrait terminology', () => {
  assert.match(engine, /請選擇性別/);
  assert.doesNotMatch(engine, /立繪|PLAYER PORTRAIT/);
});


test('main story cannot auto-start until grade, strong subjects and weak subjects are complete', () => {
  assert.match(engine, /function onboardingReady\(\)/);
  assert.match(engine, /profile\.educationLevel/);
  assert.match(engine, /profile\.strongSubjects/);
  assert.match(engine, /profile\.weakSubjects/);
  assert.match(engine, /if \(!onboardingReady\(\)\) return;/);
  assert.match(engine, /xiuxian:onboarding-completed/);
});

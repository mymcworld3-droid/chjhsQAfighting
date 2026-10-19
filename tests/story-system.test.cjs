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
  assert.match(engine, /Promise\.all\(STORY_IMAGE_ASSETS\.map\(src => preloadImageAsset\(src\)\)\)/);
  assert.match(engine, /link\.rel = 'preload'/);
  assert.match(engine, /link\.as = 'image'/);
  assert.match(engine, /if \(!storyImagesReady\)/);
  assert.match(engine, /window\.__xiuxianStoryImagesReady = true/);
  assert.match(engine, /xiuxian:story-images-ready/);
});




test('gender selection copy uses gender rather than portrait terminology', () => {
  assert.match(engine, /請選擇性別/);
  assert.doesNotMatch(engine, /立繪|PLAYER PORTRAIT/);
});


test('manual story entry waits for arrival, without requiring a profile survey', () => {
  const vm = require('node:vm');
  const source = engine.slice(engine.indexOf('  function onboardingReady()'), engine.indexOf('  function user()'));
  const ctx = vm.createContext({ window: { isFirstVisitActive: () => true }, data: () => ({ stats: {}, profile: {} }), user: () => ({ uid: 'u' }) });
  vm.runInContext(source, ctx);
  assert.equal(ctx.onboardingReady(), false);
  ctx.window.isFirstVisitActive = () => false;
  assert.equal(ctx.onboardingReady(), true);
});

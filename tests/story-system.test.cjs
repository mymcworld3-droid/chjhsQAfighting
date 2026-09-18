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

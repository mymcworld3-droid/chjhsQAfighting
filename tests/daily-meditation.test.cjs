const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const rulesSource = readFileSync(join(__dirname, '../public/cultivation/daily-meditation-rules.js'), 'utf8');
const context = vm.createContext({ Date, Intl, Math, Number, Object, String });
vm.runInContext(rulesSource.replace(/^export /gm, '') +
  '\nglobalThis.rules = { meditationDateKey, nextMeditationStreak, meditationReward };', context);
const { meditationDateKey, nextMeditationStreak, meditationReward } = context.rules;

test('daily meditation always resets at midnight in Taiwan', () => {
  assert.equal(meditationDateKey(new Date('2026-09-21T15:59:59Z')), '2026-09-21');
  assert.equal(meditationDateKey(new Date('2026-09-21T16:00:00Z')), '2026-09-22');
});

test('streak advances across month boundaries, breaks after missed day', () => {
  assert.equal(nextMeditationStreak('', 0, '2026-09-22'), 1);
  assert.equal(nextMeditationStreak('2026-09-21', 6, '2026-09-22'), 7);
  assert.equal(nextMeditationStreak('2026-08-31', 29, '2026-09-01'), 30);
  assert.equal(nextMeditationStreak('2024-02-28', 2, '2024-02-29'), 3);
  assert.equal(nextMeditationStreak('2026-09-20', 27, '2026-09-22'), 1);
  assert.equal(nextMeditationStreak('2026-09-22', 7, '2026-09-22'), 7);
  assert.equal(nextMeditationStreak('2026-09-23', 7, '2026-09-22'), 1);
});

test('early streak rewards start on day two, cultivation bonus on day three', () => {
  assert.equal(meditationReward(28, 1, 3).cultivation, 3);
  assert.equal(meditationReward(28, 1, 3).gold, 30);
  assert.equal(meditationReward(28, 2, 3).gold, 40);
  assert.equal(meditationReward(28, 3, 3).cultivation, 4);
  assert.equal(meditationReward(28, 3, 3).gold, 45);
  assert.equal(meditationReward(28, 7, 3).cultivation, 5);
  assert.equal(meditationReward(28, 7, 3).gold, 70);
});

test('every realm uses its own reward threshold', () => {
  const expected = [
    [0, 1, 10], [9, 1, 10], [10, 2, 20], [27, 2, 20],
    [28, 3, 30], [68, 4, 45], [128, 5, 60], [208, 6, 80],
    [308, 7, 100], [448, 8, 130], [628, 9, 160], [868, 10, 200]
  ];
  for (const [score, cultivation, gold] of expected) {
    const reward = meditationReward(score, 1, 3);
    assert.equal(reward.cultivation, cultivation, 'cultivation at ' + score);
    assert.equal(reward.gold, gold, 'spirit stones at ' + score);
  }
});

test('two correct answers grant half base plus full streak; poor results grant only five stones', () => {
  const partial = meditationReward(28, 7, 2);
  assert.equal(partial.cultivation, 4);
  assert.equal(partial.gold, 55);
  for (const count of [0, 1]) {
    const reward = meditationReward(868, 90, count);
    assert.equal(reward.cultivation, 0);
    assert.equal(reward.gold, 5);
  }
});

test('streak bonus is capped from day ninety onwards', () => {
  assert.equal(meditationReward(868, 90, 3).cultivation, 16);
  assert.equal(meditationReward(868, 90, 3).gold, 400);
  assert.equal(meditationReward(868, 10000, 3).cultivation, 16);
  assert.equal(meditationReward(868, 10000, 3).gold, 400);
});

test('meditation challenge is registered and local check-in is no longer used', () => {
  const read = path => readFileSync(join(__dirname, '../public', path), 'utf8');
  const loader = read('main.js');
  const legacy = read('main-legacy.js');
  const theme = read('cultivation/cultivation-theme.js');
  const html = read('index.html');
  const meditation = read('cultivation/daily-meditation.js');
  assert.match(loader, /cultivation\/daily-meditation\.js/);
  assert.match(legacy, /window\.fetchDailyMeditationQuestion = fetchOneQuestion/);
  assert.match(theme, /window\.openDailyMeditation\?\.\(\)/);
  assert.doesNotMatch(theme, /localStorage\.setItem\(KEY/);
  assert.match(html, /id="xiuxian-meditation-streak"/);
  assert.match(meditation, /runTransaction/);
  assert.match(meditation, /'stats\.totalScore': increment\(reward\.cultivation\)/);
});

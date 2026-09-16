const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, '../public/cultivation/five-immortals.js'), 'utf8');

test('Five Immortals requires Tribulation realm at 3600 cultivation', () => {
  assert.match(source, /const TRIBULATION_SCORE = 3600/);
  assert.match(source, /currentScore\(\) >= TRIBULATION_SCORE/);
  assert.match(source, /latestUser\.stats\?\.totalScore[\s\S]*TRIBULATION_SCORE/);
});

test('Five Immortals challenge uses junior-high questions by subject', () => {
  assert.match(source, /const QUIZ_LEVEL = '國中三年級'/);
  assert.match(source, /subject: role\.subject/);
  assert.match(source, /level: QUIZ_LEVEL/);
  assert.match(source, /國中程度綜合題/);
});

test('challenge continues after correct answers and ends on first wrong answer', () => {
  assert.match(source, /challenge\.streak \+= 1/);
  assert.match(source, /setTimeout\(\(\) => nextQuestion\(serial\), 550\)/);
  assert.match(source, /challenge\.active = false;\s*await finishChallenge\(serial\)/);
});

test('challenger must strictly beat current record and ties do not replace owner', () => {
  assert.match(source, /if \(streak <= liveTarget\) return/);
  assert.match(source, /challengeScore: streak/);
  assert.match(source, /同分不換榜/);
});

test('Five Immortals challenge is unlimited and preserves one-seat-per-player rule', () => {
  assert.match(source, /沒有挑戰次數限制/);
  assert.match(source, /再次問鼎/);
  assert.match(source, /alreadyOwnsOther/);
  assert.match(source, /一名修士同時只能據有一席仙位/);
});

test('old Five Immortals records migrate safely as zero challenge score', () => {
  assert.match(source, /Number\(owners\[id\]\?\.challengeScore\) \|\| 0/);
  assert.match(source, /owner\.challengeScore = Math\.max\(0, Number\(owner\.challengeScore\) \|\| 0\)/);
});

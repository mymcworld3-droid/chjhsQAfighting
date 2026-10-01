const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const opening = fs.readFileSync(path.join(__dirname, '../public/cultivation/story/opening-cinematic.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../public/main.js'), 'utf8');
const story = fs.readFileSync(path.join(__dirname, '../public/cultivation/story/story-engine.js'), 'utf8');

test('opening cinematic uses all nine uploaded PNG panels in order', () => {
  for (let index = 1; index <= 9; index += 1) {
    assert.match(opening, new RegExp(`opening-${index}\\.png`));
  }
  assert.match(opening, /const SCENES = Object\.freeze\(\[/);
});

test('first unseen viewing is mandatory and only completes after final scene', () => {
  assert.match(opening, /openingCinematicSeen === true/);
  assert.match(opening, /FIRST_VIEW_MIN_MS = 2200/);
  assert.match(opening, /if \(!wasReplay\) await persistSeen\(\)/);
  assert.match(opening, /openingCinematicSeen: true/);
  assert.match(opening, /踏上仙途/);
  assert.doesNotMatch(opening, /略過/);
});

test('opening captions preserve the intended cultivation-world message', () => {
  for (const phrase of [
    '這是一個修仙的世界',
    '有人以鬥法',
    '有人以金丹',
    '有人以煉器',
    '有人闖蕩洞天秘境',
    '也有人與眾修士並肩而戰',
    '五大道果之一',
    '儒、法、算、玄、外',
    '便可登臨真仙之境',
    '而你，又會有什麼樣的故事呢？'
  ]) {
    assert.ok(opening.includes(phrase), `missing caption: ${phrase}`);
  }
});

test('opening cinematic loads before story and gates story auto-start', () => {
  const openingPos = main.indexOf("'./cultivation/story/opening-cinematic.js'");
  const storyPos = main.indexOf("'./cultivation/story/story-engine.js'");
  assert.ok(openingPos >= 0 && storyPos > openingPos);
  assert.match(story, /#xiuxian-opening-cinematic/);
  assert.match(story, /isXiuxianOpeningCinematicRequired/);
  assert.match(story, /data-story-opening-replay/);
  assert.match(story, /xiuxian:opening-cinematic-completed/);
});

test('opening respects reduced motion and waits for onboarding and startup cloud transition to finish', () => {
  assert.match(opening, /prefers-reduced-motion:reduce/);
  assert.match(opening, /#page-onboarding:not\(\.hidden\)/);
  assert.match(opening, /#startup-cloud-curtain/);
  assert.match(opening, /hasCompletedPlayerProfile/);
});

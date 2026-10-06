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

test('the world cinematic is optional and does not load images or start for a new player', () => {
  const vm = require('node:vm');
  let imageLoads = 0;
  let scheduled = 0;
  const events = [];
  const ctx = vm.createContext({
    window: {
      getCurrentUserData: () => ({ stats: { totalScore: 0 }, storyProgressV1: {} }),
      addEventListener: (name) => events.push(name)
    },
    document: {
      readyState: 'loading',
      getElementById: () => null,
      createElement: () => ({}),
      head: { appendChild() {} },
      addEventListener() {}
    },
    getApp: () => ({}),
    getAuth: () => ({ currentUser: { uid: 'new-player' } }),
    Image: function () { imageLoads += 1; },
    setTimeout: () => { scheduled += 1; },
    console
  });
  vm.runInContext(opening.replace(/^import .*;\n/gm, '') + '\nboot();', ctx);
  assert.equal(ctx.window.isXiuxianOpeningCinematicRequired(), false);
  assert.equal(ctx.window.isXiuxianOpeningCinematicActive(), false);
  assert.equal(ctx.window.openXiuxianOpeningCinematic(), false);
  assert.equal(imageLoads, 0, 'the optional film should not compete with chapter portraits');
  assert.equal(scheduled, 0, 'no automatic cinematic playback should be scheduled');
  assert.deepEqual(events, []);
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

test('world cinematic remains available for manual replay without gating the new first chapter', () => {
  const openingPos = main.indexOf("'./cultivation/story/opening-cinematic.js'");
  const storyPos = main.indexOf("'./cultivation/story/story-engine.js'");
  assert.ok(openingPos >= 0 && storyPos > openingPos);
  assert.match(story, /#xiuxian-opening-cinematic/);
  assert.match(story, /isXiuxianOpeningCinematicActive/);
  assert.doesNotMatch(story, /isXiuxianOpeningCinematicRequired/);
  assert.match(story, /data-story-opening-replay/);
  assert.match(story, /xiuxian:opening-cinematic-completed/);
  assert.match(story, /if \(event\.detail\?\.replay\) return/);
});

test('the replacement chapter waits for profile and startup clouds and the optional film respects reduced motion', () => {
  assert.match(opening, /prefers-reduced-motion:reduce/);
  assert.match(story, /#page-onboarding:not\(\.hidden\)/);
  assert.match(story, /#startup-cloud-curtain/);
  assert.match(story, /#game-startup-gate/);
  assert.match(story, /hasCompletedPlayerProfile/);
});

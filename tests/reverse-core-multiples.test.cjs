const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/cultivation/reverse-core-multiples.js', 'utf8');
const main = fs.readFileSync('public/main.js', 'utf8');

function bootReverseCore(grade) {
  const core = {
    type: 'reverse',
    name: '陰陽反轉丹',
    grade,
    effect: 'legacy effect',
    equipped: true,
    core: { type: 'reverse', grade }
  };

  const window = {
    getGoldenCoreState: () => ({ ...core }),
    getEquippedGoldenCoreState: () => ({ ...core }),
    resolveGoldenCoreCultivationReward: () => ({ bonusGain: 0, message: '' })
  };

  const sandbox = {
    window,
    document: {
      body: {},
      getElementById: () => null
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() {}
    },
    console
  };

  vm.runInNewContext(source, sandbox);
  return window;
}

function rewardAt(window, streak) {
  return window.resolveGoldenCoreCultivationReward({
    stats: { currentStreak: streak - 1 },
    isCorrect: true
  });
}

test('reverse core grade 1 repeats at 2, 4, 6 streaks', () => {
  const window = bootReverseCore(1);

  assert.equal(rewardAt(window, 1).bonusGain, 0);
  assert.equal(rewardAt(window, 2).bonusGain, 3);
  assert.equal(rewardAt(window, 3).bonusGain, 0);
  assert.equal(rewardAt(window, 4).bonusGain, 3);
  assert.equal(rewardAt(window, 5).bonusGain, 0);
  assert.equal(rewardAt(window, 6).bonusGain, 3);
});

test('reverse core grade 2 repeats at 3, 6, 9 streaks', () => {
  const window = bootReverseCore(2);

  assert.equal(rewardAt(window, 3).bonusGain, 3);
  assert.equal(rewardAt(window, 4).bonusGain, 0);
  assert.equal(rewardAt(window, 6).bonusGain, 3);
  assert.equal(rewardAt(window, 7).bonusGain, 0);
  assert.equal(rewardAt(window, 9).bonusGain, 3);
});

test('reverse core snapshot explains repeated multiple triggers', () => {
  const window = bootReverseCore(2);
  const state = window.getEquippedGoldenCoreState();

  assert.match(state.effect, /3 次的倍數/);
  assert.match(state.effect, /3、6、9/);
});

test('reverse core multiple module loads immediately after golden core training', () => {
  assert.match(
    main,
    /cultivation-training-v4\.js'[\s\S]*reverse-core-multiples\.js'[\s\S]*golden-core-battle-effects\.js'/
  );
});

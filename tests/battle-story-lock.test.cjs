const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const read = path => readFileSync(join(__dirname, '..', 'public', path), 'utf8');
const battle = read('cultivation/battle-mode-v2.js');
const story = read('cultivation/story/story-engine.js');

test('battle lock spans matchmaking, joined room, result screen, recovery and departure', () => {
  const code = battle.slice(battle.indexOf('  window.isXiuxianBattleBusy ='), battle.indexOf('\n', battle.indexOf('  window.isXiuxianBattleBusy =')));
  assert.match(code, /state\.starting \|\| state\.leaving \|\| state\.recovering \|\| state\.roomId/);
  const state = { starting: false, leaving: false, recovering: false, roomId: null };
  const context = { window: {}, state };
  vm.runInNewContext(code, context);
  assert.equal(context.window.isXiuxianBattleBusy(), false);
  for (const property of ['starting', 'leaving', 'recovering']) {
    state[property] = true;
    assert.equal(context.window.isXiuxianBattleBusy(), true, property);
    state[property] = false;
  }
  state.roomId = 'active-room';
  assert.equal(context.window.isXiuxianBattleBusy(), true, 'finished match remains locked until exit');
  state.roomId = null;
  assert.equal(context.window.isXiuxianBattleBusy(), false);
});

test('automatic story and replay cannot start during a PvP session', () => {
  const guard = story.slice(story.indexOf('  function blocking() {'), story.indexOf('  function layer() {'));
  const launch = story.slice(story.indexOf('  function startChapter('), story.indexOf('  function nextEligibleChapter()'));
  const ctx = {
    window: { isXiuxianBattleBusy: () => true },
    document: { querySelector() { throw new Error('battle busy must short-circuit DOM checks'); } },
    active: false,
    storyTutorialPaused: false
  };
  vm.runInNewContext(guard + '\n' + launch + '\nthis.blocking = blocking; this.startChapter = startChapter;', ctx);
  assert.equal(ctx.blocking(), true);
  assert.equal(ctx.startChapter({ id: 'late-unlock' }, { replay: true }), false);
  assert.match(story, /if \(typeof window !== 'undefined' && window\.isXiuxianBattleBusy\?\.\(\)\) return false/);
  assert.match(story, /if \(active \|\| blocking\(\)\)/);
  assert.match(story, /xiuxian:battle-session-ended/);
});

test('battle departure releases story after navigation, while login recovers first', () => {
  const exit = battle.slice(battle.indexOf('  async function exitBattle('), battle.indexOf('  async function joinSpecificRoom('));
  assert.match(exit, /resetRuntime\(\);\s*if \(navigate\) window\.switchToPage\?\.\('page-home'\);\s*window\.dispatchEvent\(new CustomEvent\('xiuxian:battle-session-ended'\)\)/);
  assert.match(battle, /window\.addEventListener\('xiuxian:user-ready', recoverBattleSession\)/);
  assert.match(battle, /state\.recovering = true/);
  assert.match(battle, /state\.recovering = false/);
});

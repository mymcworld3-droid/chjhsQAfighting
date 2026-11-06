'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../public/cultivation/quest-rules.js');

test('hidden story quests never block the path and retain already-claimed records', () => {
  const ids = ['path-story-prologue-enter-sect', 'path-story-qi-five-dongtian'];
  const initial = rules.view({}, {});
  assert.notEqual(initial.path.metric, 'story');
  assert.ok(rules.PATH.every(q => q.metric !== 'story'));
  const state = rules.normalizeState({pathClaimed: [ids[0], 'path-scope', ids[1]],
    pathTicketAmounts: {[ids[0]]: 1, [ids[1]]: 1, 'path-scope': 1}});
  assert.ok(ids.every(id => state.pathClaimed.includes(id)));
  assert.ok(ids.every(id => state.pathTicketAmounts[id] === 1));
  const view = rules.view({}, state);
  assert.notEqual(view.path?.metric, 'story');
  assert.equal(view.pathCompleted, 1);
  assert.ok(view.pathTicketRewards.every(q => q.metric !== 'story'));
});

test('old path indexes migrate using the original order without reopening completed work', () => {
  const oldCount = 5;
  const state = rules.normalizeState({ pathIndex: oldCount });
  for (const quest of rules.LEGACY_PATH.slice(0, oldCount)) assert.ok(state.pathClaimed.includes(quest.id));
  const view = rules.view({}, state);
  assert.equal(view.path.id, rules.LEGACY_PATH[oldCount].id);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const battle = read('public/cultivation/battle-mode-v2.js');
const css = read('public/styles/battle-mode-v2.css');

test('battle pre-generates the opening and next-round questions in the shared room', () => {
  assert.match(battle, /async function prefetchRoundQuestion\(room, targetRound\)/);
  assert.match(battle, /prefetchedQuestion/);
  assert.match(battle, /prefetchedRound/);
  assert.match(battle, /prefetchOwnerUid/);
  assert.match(battle, /room\.status === 'intro'[\s\S]*target === 1/);
  assert.match(battle, /room\.status === 'playing' \|\| room\.status === 'settled'/);
  assert.match(battle, /Number\(fresh\.prefetchedRound\) === nextRound \? fresh\.prefetchedQuestion : null/);
  assert.match(battle, /status: prefetched \? 'playing' : 'preparing'/);
  assert.match(battle, /void prefetchRoundQuestion\(room, Number\(room\.round\) \+ 1\)/);
});

test('battle prefetch avoids repeating the active question and retains preparing fallback', () => {
  assert.match(battle, /Number\(round\) > Number\(room\.round\)/);
  assert.match(battle, /historySource\.push\(\{/);
  assert.match(battle, /fresh\.status === 'preparing'[\s\S]*Number\(fresh\.round\) === round/);
  assert.match(battle, /question prefetch unavailable/);
  assert.match(battle, /cached \|\| await generateQuestion\(room, round\)/);
});

test('arena keeps ambient combat motion while portraits stand still outside strike frames', () => {
  assert.match(battle, /function updateArenaCombatState\(room, animating = false\)/);
  assert.match(battle, /arena\.dataset\.combatState/);
  assert.match(css, /Continuous combat presence/);
  assert.doesNotMatch(css, /bv2IdleMe|bv2IdleEnemy/);
  assert.match(css, /bv2MoteRise/);
  assert.match(css, /\[data-combat-state="charging"\]/);
  assert.match(css, /\[data-combat-state="aftermath"\]/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

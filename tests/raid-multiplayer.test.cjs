const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const read = path => readFileSync(join(__dirname, '..', path), 'utf8');
const apiSource = read('raid-api.cjs');
const modeSource = read('public/cultivation/raid-mode.js');
const materials = read('public/cultivation/material-catalog.js');
const drops = read('public/cultivation/material-drop-system.js');
const refinery = read('public/cultivation/refinery-ai-jobs.js');
const server = read('server.js');

test('raid v2 exposes 1-4 player room lifecycle through the trusted backend', () => {
  for (const route of ['create','join','state','heartbeat','ready','start','question','answer','tick','leave','claim']) {
    assert.match(apiSource, new RegExp("/api/raid/" + route));
  }
  assert.match(apiSource, /const MAX_MEMBERS = 4/);
  assert.match(apiSource, /ROOM_COLLECTION = 'raidRooms'/);
  assert.match(apiSource, /leaderUid/);
  assert.match(apiSource, /status: 'waiting'/);
  assert.match(apiSource, /status: 'active'/);
  assert.match(server, /registerRaidApi\(app\)/);
});

test('multiplayer raid shares boss state while player questions remain independent and untimed', () => {
  assert.match(modeSource, /1～4 人共鬥/);
  assert.match(modeSource, /共用 Boss HP/);
  assert.match(modeSource, /pickBattleKnowledge\(state\.scope, round\)/);
  assert.match(modeSource, /\/api\/raid\/question/);
  assert.match(modeSource, /noQuestionTimer:\s*true/);
  assert.doesNotMatch(modeSource, /questionDeadlineMs|answerWindowMs|raidQuestionDeadline/);
  assert.match(apiSource, /noQuestionTimer:\s*true/);
  assert.doesNotMatch(apiSource, /questionDeadline|answerWindow/);
});

test('raid boss has server-clock actions, party scaling, reconnect and one-use question settlement', () => {
  assert.match(apiSource, /BOSS_INTERVAL_MS = 18000/);
  assert.match(apiSource, /boss\.nextActionAtMs = now\(\) \+ BOSS_INTERVAL_MS/);
  assert.match(apiSource, /while \(status === 'active' && current >= finite\(boss\.nextActionAtMs\)/);
  assert.match(apiSource, /q\.resolved === true/);
  assert.match(apiSource, /activeQuestionId/);
  assert.match(modeSource, /ROOM_STORAGE_KEY/);
  assert.match(modeSource, /resumeRoom/);
  assert.match(modeSource, /heartbeat/);
});

test('raid refinement keys are raid-only and gate second and third refinement', () => {
  assert.match(materials, /id: 'raid-refine-key-2'[\s\S]*raidOnly: true/);
  assert.match(materials, /id: 'raid-refine-key-3'[\s\S]*raidOnly: true/);
  assert.match(drops, /if \(material\.raidOnly === true\) return \[\]/);
  assert.match(refinery, /SECOND_REFINEMENT_KEY = 'raid-refine-key-2'/);
  assert.match(refinery, /THIRD_REFINEMENT_KEY = 'raid-refine-key-3'/);
  assert.match(refinery, /refinementKeyRequirement\(depth, targetRealm/);
  assert.match(refinery, /consumeRecipe\(raw, plan\.recipe, trustedKey\)/);
  assert.match(apiSource, /\[SECOND_REFINEMENT_KEY\]: 1/);
  assert.match(apiSource, /deterministicThirdKey/);
});

test('refinement key quantity rises by artifact realm bands', () => {
  const { refinementKeyQuantity } = require('../raid-api.cjs');
  assert.equal(refinementKeyQuantity(1), 1);
  assert.equal(refinementKeyQuantity(3), 1);
  assert.equal(refinementKeyQuantity(4), 2);
  assert.equal(refinementKeyQuantity(7), 3);
  assert.equal(refinementKeyQuantity(10), 4);
});

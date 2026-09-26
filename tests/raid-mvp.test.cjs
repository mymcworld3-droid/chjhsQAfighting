const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const readPublic = path => readFileSync(join(__dirname, '../public', path), 'utf8');
const engineSource = readPublic('cultivation/raid-engine.js');
const raidSource = readPublic('cultivation/raid-mode.js');
const mainSource = readPublic('main.js');
const cssSource = readPublic('styles/raid-mode.css');

function loadEngine() {
  const context = vm.createContext({ console, Math, Number, String, Object, Array });
  const code = engineSource
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ') +
    '\nthis.__raid={RAID_MVP,createScaledShenBoss,shenPhaseForHp,shenIntentForRound,resolveSoloRaidRound,nextPersonalQuestionAt,bossClockState};';
  vm.runInContext(code, context);
  return context.__raid;
}

test('raid MVP has no question countdown and keeps an independent boss clock', () => {
  const e = loadEngine();
  assert.equal(Object.hasOwn(e.RAID_MVP, 'answerWindowMs'), false);
  assert.equal(e.RAID_MVP.minQuestionCycleMs, 6000);
  assert.equal(e.RAID_MVP.reviewLockMs, 1500);
  assert.equal(e.RAID_MVP.bossActionIntervalMs, 18000);
  assert.equal(e.RAID_MVP.bossTelegraphMs, 5000);
  assert.equal(e.RAID_MVP.maxBossActions, 12);

  const fast = e.nextPersonalQuestionAt({ issuedAtMs: 1000, resolvedAtMs: 2000 });
  assert.equal(fast, 7000, 'fast answer is capped by the six-second personal action cycle');
  const slow = e.nextPersonalQuestionAt({ issuedAtMs: 1000, resolvedAtMs: 12000 });
  assert.equal(slow, 13500, 'slow answer only keeps the short review lock');
  assert.doesNotMatch(engineSource, /raidQuestionDeadline|answerWindowMs/);

  const normal = e.bossClockState({ startedAtMs: 1000, nowMs: 12000, actionCount: 0 });
  assert.equal(normal.nextActionAtMs, 19000);
  assert.equal(normal.telegraphing, false);
  const warning = e.bossClockState({ startedAtMs: 1000, nowMs: 15000, actionCount: 0 });
  assert.equal(warning.telegraphing, true);
  assert.equal(warning.due, false);
  const due = e.bossClockState({ startedAtMs: 1000, nowMs: 19000, actionCount: 0 });
  assert.equal(due.due, true);
});

test('Shen boss scales to the challenger and has three HP phases', () => {
  const e = loadEngine();
  const boss = e.createScaledShenBoss({ playerAttack: 300, playerMaxHp: 1400 });
  assert.equal(boss.maxHp, 2400);
  assert.equal(boss.baseAttack, 147);
  assert.equal(e.shenPhaseForHp(1800, 2400), 1);
  assert.equal(e.shenPhaseForHp(1600, 2400), 2);
  assert.equal(e.shenPhaseForHp(600, 2400), 3);
});

test('raid mode keeps questions personal while the boss attacks on its own clock', () => {
  assert.match(raidSource, /asynchronousQuestions:\s*true/);
  assert.match(raidSource, /generateRaidQuestion/);
  assert.match(raidSource, /noQuestionTimer:\s*true/);
  assert.match(raidSource, /不限時/);
  assert.doesNotMatch(raidSource, /questionDeadlineMs|raidQuestionDeadline|answer\(null\)/);
  assert.match(raidSource, /setInterval\(updateLiveLabels, 100\)/);
  assert.match(raidSource, /\/api\/raid\/answer/);
  assert.match(raidSource, /\/api\/raid\/tick/);
  assert.doesNotMatch(raidSource, /allPlayersAnswered|bothReviewed|sharedQuestion/);
});

test('raid questions never time out and boss actions use a separate endpoint', () => {
  assert.doesNotMatch(raidSource, /時間到|answer\(null\)|questionDeadlineMs/);
  assert.match(raidSource, /\/api\/raid\/answer/);
  assert.match(raidSource, /\/api\/raid\/tick/);
  assert.match(raidSource, /題目本身不限時/);
});
test('raid entry is loaded as an optional cultivation feature and has responsive full-screen question UI', () => {
  assert.match(mainSource, /'\.\/cultivation\/raid-mode\.js'/);
  assert.match(cssSource, /\.raid-question-view\{position:fixed!important;inset:0!important/);
  assert.match(cssSource, /@media\(max-width:760px\)/);
  assert.match(cssSource, /\.raid-home-entry/);
});

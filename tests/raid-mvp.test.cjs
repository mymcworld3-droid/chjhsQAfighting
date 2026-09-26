const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const readPublic = path => readFileSync(join(__dirname, '../public', path), 'utf8');
const engineSource = readPublic('cultivation/raid-engine.js');
const raidSource = readPublic('cultivation/raid-mode.js');
const roomSource = readPublic('cultivation/raid-room.js');
const roomApiSource = readFileSync(join(__dirname, '../raid-room-api.cjs'), 'utf8');
const serverSource = readFileSync(join(__dirname, '../server.js'), 'utf8');
const mainSource = readPublic('main.js');
const cssSource = readPublic('styles/raid-mode.css');

function loadEngine() {
  const context = vm.createContext({ console, Math, Number, String, Object, Array });
  const code = engineSource
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ') +
    '\nthis.__raid={RAID_MVP,createScaledShenBoss,createTeamScaledShenBoss,shenPhaseForHp,shenIntentForRound,resolveSoloRaidRound,nextPersonalQuestionAt,bossClockState};';
  vm.runInContext(code, context);
  return context.__raid;
}

test('raid questions have no answer deadline while boss keeps its own clock', () => {
  const e = loadEngine();
  assert.equal('answerWindowMs' in e.RAID_MVP, false);
  assert.equal(e.RAID_MVP.minQuestionCycleMs, 6000);
  assert.equal(e.RAID_MVP.reviewLockMs, 1500);
  assert.equal(e.RAID_MVP.bossActionIntervalMs, 18000);
  assert.equal(e.RAID_MVP.bossTelegraphMs, 5000);
  assert.equal(e.RAID_MVP.maxBossActions, 12);

  const fast = e.nextPersonalQuestionAt({ issuedAtMs: 1000, resolvedAtMs: 2000 });
  assert.equal(fast, 7000);
  const slow = e.nextPersonalQuestionAt({ issuedAtMs: 1000, resolvedAtMs: 12000 });
  assert.equal(slow, 13500);

  const warning = e.bossClockState({ startedAtMs: 1000, nowMs: 15000, actionCount: 0 });
  assert.equal(warning.telegraphing, true);
  assert.equal(warning.due, false);
  const due = e.bossClockState({ startedAtMs: 1000, nowMs: 19000, actionCount: 0 });
  assert.equal(due.due, true);
});

test('Shen boss supports team scaling and three HP phases', () => {
  const e = loadEngine();
  const boss = e.createTeamScaledShenBoss([
    { atk: 300, maxHp: 1400 },
    { atk: 250, maxHp: 1200 }
  ]);
  assert.ok(boss.maxHp > 2400);
  assert.ok(boss.baseAttack >= 70);
  assert.equal(e.shenPhaseForHp(boss.maxHp * .8, boss.maxHp), 1);
  assert.equal(e.shenPhaseForHp(boss.maxHp * .5, boss.maxHp), 2);
  assert.equal(e.shenPhaseForHp(boss.maxHp * .2, boss.maxHp), 3);
});

test('raid mode is multiplayer and keeps every player question asynchronous', () => {
  assert.match(raidSource, /findOrCreateRaidRoom/);
  assert.match(raidSource, /joinRaidRoomByCode/);
  assert.match(raidSource, /subscribeRaidRoom/);
  assert.match(raidSource, /commitRaidPlayerAction/);
  assert.match(raidSource, /advanceRaidBossAction/);
  assert.match(raidSource, /asynchronousQuestions:\s*true/);
  assert.match(raidSource, /questionTimeLimit:\s*null/);
  assert.match(raidSource, /multiplayer:\s*true/);
  assert.match(raidSource, /不限時/);
  assert.doesNotMatch(raidSource, /raidQuestionDeadline/);
  assert.doesNotMatch(raidSource, /questionDeadlineMs/);
  assert.doesNotMatch(raidSource, /answer\(null\)/);
});

test('shared room layer supports party lifecycle, boss HP and reconnect', () => {
  assert.match(roomApiSource, /const MAX_MEMBERS = 4/);
  assert.match(roomSource, /createRaidRoom/);
  assert.match(roomSource, /findOrCreateRaidRoom/);
  assert.match(roomSource, /joinRaidRoomByCode/);
  assert.match(roomSource, /reconnectRaidRoom/);
  assert.match(roomSource, /setRaidReady/);
  assert.match(roomSource, /startRaidRoom/);
  assert.match(roomSource, /commitRaidPlayerAction/);
  assert.match(roomSource, /commitRaidBossDefense/);
  assert.match(roomSource, /advanceRaidBossAction/);
  assert.match(roomSource, /heartbeatRaidRoom/);
  assert.match(roomSource, /leaveRaidRoom/);
  assert.match(roomSource, /\/api\/raid\/room/);
  assert.match(roomSource, /const POLL_MS = 1000/);
  assert.doesNotMatch(roomSource, /ensureSecondaryFirebaseAuth/);
  assert.match(roomApiSource, /adminProject\('C'\)/);
  assert.match(roomApiSource, /where\('status', '==', 'waiting'\)/);
  assert.match(roomApiSource, /verifyIdToken/);
  assert.match(serverSource, /registerRaidRoomApi\(app\)/);
});

test('wrong answers only lose the player attack and never trigger an extra boss strike', () => {
  const answerStart = raidSource.indexOf('  async function answer(choice) {');
  const answerEnd = raidSource.indexOf('  async function applyRemoteBossAction', answerStart);
  const answerBody = raidSource.slice(answerStart, answerEnd);
  assert.match(answerBody, /resolveShenPlayerAction/);
  assert.doesNotMatch(answerBody, /resolveShenBossAction/);
  assert.match(raidSource, /答錯・本次失去攻擊/);
});

test('raid UI includes party lobby, join code, responsive fullscreen questions and optional feature loading', () => {
  assert.match(mainSource, /'\.\/cultivation\/raid-mode\.js'/);
  assert.match(cssSource, /\.raid-question-view\{position:fixed!important;inset:0!important/);
  assert.match(cssSource, /\.raid-party-list/);
  assert.match(cssSource, /\.raid-party-strip/);
  assert.match(cssSource, /\.raid-code-join/);
  assert.match(cssSource, /@media\(max-width:760px\)/);
});

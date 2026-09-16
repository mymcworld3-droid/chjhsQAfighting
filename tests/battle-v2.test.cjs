const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const readPublic = (path) => readFileSync(join(__dirname, '../public', path), 'utf8');
const engineSource = readPublic('cultivation/battle-engine-v2.js');
const battleSource = readPublic('cultivation/battle-mode-v2.js');
const mainSource = readPublic('main.js');
const cssSource = readPublic('styles/battle-mode-v2.css');

function loadEngine() {
  const context = vm.createContext({ console, Math, Number, String, Object, Array });
  const code = engineSource
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ') + `\nthis.__engine={BATTLE_V2,deterministicPercent,resolveDeterministicAttackCore,resolveDeterministicCounterCore,decideRoundAttackers,settleBattleRound};`;
  vm.runInContext(code, context);
  return context.__engine;
}

function player(uid, { hp = 1000, atk = 200, correct = false, atMs = 1000, core = null } = {}) {
  return { uid, name: uid, hp, maxHp: 1000, atk, goldenCore: core, answer: { correct, atMs } };
}

test('Battle v2 uses the unified cultivation combat scale', () => {
  const e = loadEngine();
  assert.equal(e.BATTLE_V2.modeVersion, 2);
  assert.equal(e.BATTLE_V2.maxRounds, 15);
  assert.equal(e.BATTLE_V2.disconnectTtlMs, 45000);
  assert.match(battleSource, /ANSWER_WINDOW_MS = 25000/);
  assert.match(battleSource, /window\.getCombatStats\?\.\(\)/);
  assert.match(battleSource, /attack:\s*200, hp:\s*1000, maxHp:\s*1000/);
  assert.doesNotMatch(battleSource, /hp:\s*100,\s*maxHp:\s*100,\s*atk:\s*20/);
});

test('one correct answer attacks and both wrong answers deal no damage', () => {
  const e = loadEngine();
  const winRound = e.settleBattleRound({ roomId: 'room-a', round: 1, host: player('h', { correct: true, atMs: 1000 }), guest: player('g', { correct: false, atMs: 1100 }) });
  assert.deepEqual(Array.from(winRound.attackers), ['host']);
  assert.equal(winRound.hostHp, 1000);
  assert.equal(winRound.guestHp, 800);

  const blankRound = e.settleBattleRound({ roomId: 'room-b', round: 1, host: player('h', { correct: false }), guest: player('g', { correct: false }) });
  assert.equal(blankRound.logs.length, 0);
  assert.equal(blankRound.hostHp, 1000);
  assert.equal(blankRound.guestHp, 1000);
});

test('server-time speed decides double-correct rounds and near ties are simultaneous', () => {
  const e = loadEngine();
  const fasterGuest = e.settleBattleRound({ roomId: 'speed', round: 2, host: player('h', { correct: true, atMs: 2000 }), guest: player('g', { correct: true, atMs: 1700 }) });
  assert.deepEqual(Array.from(fasterGuest.attackers), ['guest']);
  assert.equal(fasterGuest.hostHp, 800);
  assert.equal(fasterGuest.guestHp, 1000);

  const tie = e.settleBattleRound({ roomId: 'tie', round: 2, host: player('h', { correct: true, atMs: 2000 }), guest: player('g', { correct: true, atMs: 2100 }) });
  assert.deepEqual(Array.from(tie.attackers), ['host', 'guest']);
  assert.equal(tie.hostHp, 800);
  assert.equal(tie.guestHp, 800);
});

test('round limit always ends a stalled match by remaining HP or draw', () => {
  const e = loadEngine();
  const byHp = e.settleBattleRound({ roomId: 'limit-a', round: 15, host: player('h', { hp: 900, correct: false }), guest: player('g', { hp: 700, correct: false }) });
  assert.equal(byHp.finished, true);
  assert.equal(byHp.winnerUid, 'h');
  assert.equal(byHp.finishReason, 'round-limit');

  const draw = e.settleBattleRound({ roomId: 'limit-b', round: 15, host: player('h', { hp: 700, correct: false }), guest: player('g', { hp: 700, correct: false }) });
  assert.equal(draw.winnerUid, 'draw');
});

test('Golden Core battle rolls are deterministic and replay-safe', () => {
  const e = loadEngine();
  const sword = { type: 'sword', grade: 1, name: '破鋒劍心丹' };
  let triggeredSeed = null;
  for (let i = 0; i < 300; i += 1) {
    const seed = `seed-${i}`;
    if (e.resolveDeterministicAttackCore({ goldenCore: sword }, seed).extraDamage === 200) { triggeredSeed = seed; break; }
  }
  assert.ok(triggeredSeed);
  const first = e.resolveDeterministicAttackCore({ goldenCore: sword }, triggeredSeed);
  const second = e.resolveDeterministicAttackCore({ goldenCore: sword }, triggeredSeed);
  assert.equal(first.extraDamage, second.extraDamage);
  assert.equal(first.activation.skill, '破鋒劍心丹・萬劍追擊');

  const thunder = { type: 'thunder', grade: 1, name: '萬劫雷霆丹' };
  let reflected = null;
  for (let i = 0; i < 300; i += 1) {
    const result = e.resolveDeterministicCounterCore({ goldenCore: thunder }, 200, `counter-${i}`);
    if (result.reflectDamage) { reflected = result; break; }
  }
  assert.ok(reflected);
  assert.equal(reflected.reflectDamage, 200);
});

test('matchmaking is transactional, version isolated, self-match safe and cultivation-aware', () => {
  assert.match(battleSource, /where\('status', '==', 'waiting'\)/);
  assert.match(battleSource, /runTransaction\(db\(\)/);
  assert.match(battleSource, /Number\(room\.modeVersion\) !== BATTLE_V2\.modeVersion/);
  assert.match(battleSource, /room\.host\?\.uid === myData\.uid/);
  assert.match(battleSource, /isRoomStale\(room\)/);
  assert.match(battleSource, /aGap - bGap/);
  assert.match(battleSource, /reconcileOwnWaitingRoom/);
  assert.match(battleSource, /tx\.delete\(ownRef\)/);
});

test('matched players synchronously enter a cinematic intro before answering', () => {
  assert.match(battleSource, /INTRO_DURATION_MS = 4800/);
  assert.match(battleSource, /status: 'intro'/);
  assert.match(battleSource, /introUntilMs/);
  assert.match(battleSource, /function renderIntro/);
  assert.match(battleSource, /function advanceIntro/);
  assert.match(battleSource, /鬥法開始/);
  assert.match(cssSource, /\.bv2-intro/);
  assert.match(cssSource, /@keyframes bv2slash/);
  assert.match(cssSource, /@keyframes bv2enterLeft/);
});

test('25 second countdown starts only after the first player answers', () => {
  assert.match(battleSource, /answerWindowStartedAt/);
  assert.match(battleSource, /firstAnswerUid/);
  assert.match(battleSource, /題目本身不倒數；第一位玩家提交答案後/);
  assert.match(battleSource, /if \(!otherAnswered && !room\.answerWindowStartedAt && !room\.answerWindowStartedAtMs\)/);
  assert.match(battleSource, /timerEl\.textContent = '等待首答'/);
  assert.match(battleSource, /hostAnswer \|\| guestAnswer/);
  assert.match(battleSource, /timeoutMissingAnswer/);
  assert.match(battleSource, /你的 25 秒倒數已開始/);
});

test('answer speed uses Firestore server timestamps rather than client clocks', () => {
  assert.match(battleSource, /速度判定只採 Firestore serverTimestamp/);
  assert.match(battleSource, /const atMs = timestampMs\(player\.answerAt, 0\)/);
  assert.match(battleSource, /answerClientAt.*僅供除錯/);
});

test('round lifecycle is one-time, replay safe and question generation can fail over', () => {
  assert.match(battleSource, /Number\(fresh\.settledRound\) >= round/);
  assert.match(battleSource, /status: 'settled'/);
  assert.match(battleSource, /nextRoundAtMs/);
  assert.match(battleSource, /takeoverQuestionLease/);
  assert.match(battleSource, /PREPARE_LEASE_MS = 7000/);
  assert.match(battleSource, /fallbackQuestion\(\)/);
  assert.match(battleSource, /AI 出題暫時失敗/);
  assert.match(battleSource, /解析：/);
});

test('Battle v2 handles disconnects, page reload recovery and atomic forfeits', () => {
  assert.match(battleSource, /lastSeenAtMs/);
  assert.match(battleSource, /disconnectTtlMs/);
  assert.match(battleSource, /finishReason: 'disconnect'/);
  assert.match(battleSource, /recoverBattleSession/);
  assert.match(battleSource, /已恢復上次尚未結束的鬥法/);
  assert.match(battleSource, /fresh\.status === 'waiting'.*tx\.delete\(ref\)/s);
});

test('Battle v2 records win-loss-draw stats once without changing cultivation', () => {
  assert.match(battleSource, /stats\.battleMatches/);
  assert.match(battleSource, /stats\.battleWins/);
  assert.match(battleSource, /stats\.battleLosses/);
  assert.match(battleSource, /stats\.battleDraws/);
  assert.match(battleSource, /hostResultRecorded/);
  assert.match(battleSource, /guestResultRecorded/);
  assert.doesNotMatch(battleSource, /stats\.totalScore['"]?\s*:/);
});

test('arena has xianxia combat feedback, impact animation and responsive mobile layout', () => {
  assert.match(mainSource, /golden-core-battle-effects\.js'[\s\S]*cultivation-combat-stats\.js'[\s\S]*battle-mode-v2\.js'/);
  assert.match(battleSource, /animateSettlement/);
  assert.match(battleSource, /bv2-damage-pop/);
  assert.match(cssSource, /\.bv2-duel-rule/);
  assert.match(cssSource, /\.bv2-fighter\.hit/);
  assert.match(cssSource, /@keyframes bv2damage/);
  assert.match(cssSource, /@media\(max-width:620px\)/);
  assert.match(cssSource, /prefers-reduced-motion/);
});

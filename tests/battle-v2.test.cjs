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
    .replace(/export function /g, 'function ') + `\nthis.__engine={BATTLE_V2,deterministicPercent,resolveDeterministicAttackCore,resolveDeterministicCounterCore,resolveDeterministicCoreSupport,decideRoundAttackers,settleBattleRound};`;
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

test('battle health display is a current in-match number, not a permanent fraction', () => {
  assert.match(battleSource, /bv2-enemy-hp-text">1000</);
  assert.match(battleSource, /bv2-my-hp-text">1000</);
  assert.match(battleSource, /setText\(`bv2-\$\{prefix\}-hp-text`, Math\.round\(hp\)\)/);
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

test('both correct answers attack regardless of timing', () => {
  const e = loadEngine();
  const fasterGuest = e.settleBattleRound({ roomId: 'speed', round: 2, host: player('h', { correct: true, atMs: 2000 }), guest: player('g', { correct: true, atMs: 1700 }) });
  assert.deepEqual(Array.from(fasterGuest.attackers), ['host', 'guest']);
  assert.equal(fasterGuest.hostHp, 800);
  assert.equal(fasterGuest.guestHp, 800);

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
  assert.match(battleSource, /hostSubmitted \|\| guestSubmitted/);
  assert.match(battleSource, /timeoutMissingAnswer/);
  assert.match(battleSource, /你的 25 秒倒數已開始/);
});

test('answer speed uses Firestore server timestamps rather than client clocks', () => {
  assert.match(battleSource, /作答時間採 Firestore serverTimestamp/);
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


test('Battle v2 keeps reconciling simultaneous waiting rooms and scans a wider waiting-room window', () => {
  assert.match(battleSource, /MATCH_SCAN_LIMIT = 80/);
  assert.match(battleSource, /function scheduleReconcile/);
  assert.match(battleSource, /limit\(MATCH_SCAN_LIMIT\)/);
  assert.match(battleSource, /同時按配對/);
});

test('Battle v2 never leaves answer buttons locked after a no-op transaction', () => {
  assert.match(battleSource, /function hasSubmittedAnswer/);
  assert.match(battleSource, /const submitted = await runTransaction/);
  assert.match(battleSource, /if \(!submitted\)/);
  assert.match(battleSource, /state\.pendingAnswer = null/);
  assert.match(battleSource, /serverTimestamp 落地後/);
});


test('Battle v2 hidden phases cannot be overridden by phase display styles', () => {
  assert.match(cssSource, /\.battle-v2-page \.hidden\{display:none!important\}/);
  assert.match(battleSource, /classList\.toggle\('hidden', key !== name\)/);
});


test('formal battle uses Foundation realm only; incomplete tutorials never block pairing or recovery', async () => {
  const src = battleSource.slice(battleSource.indexOf('  function storyOrTutorialOpen() {'), battleSource.indexOf('  async function forfeitCurrentRoom() {'));
  const calls = [];
  let layerPresent = false;
  let currentScore = 9;
  const ctx = vm.createContext({
    document: { querySelector: () => layerPresent ? {} : null },
    window: { getBattleTutorialState: () => ({active:false}), switchToPage: () => calls.push('page'), ensureCombatStats: async () => {} },
    state: { starting:false, roomId:null, room:null, role:null },
    score: () => currentScore, FOUNDATION_SCORE:10, me: () => ({uid:'p'}),
    toast: () => calls.push('toast'), alert: () => calls.push('alert'),
    resetRuntime: () => calls.push('reset'), ensurePage: () => calls.push('ensurePage'),
    showSection: () => calls.push('lobby'), renderLobby: () => calls.push('renderLobby'),
    playerSnapshot: () => ({name:'p'}), setText:()=>{}, playerCoreLabel:()=> '',
    findAndClaimRoom: async () => 'oldRoom', subscribeRoom: () => calls.push('subscribe'),
    createWaitingRoom: async () => {calls.push('newRoom');return 'newRoom';},
    scheduleReconcile:()=>{}, console
  });
  vm.runInContext(src,ctx);
  await vm.runInContext('startMatchmaking()',ctx);
  assert.deepEqual(calls,['toast'],'not yet Foundation blocks');
  currentScore=10;
  calls.length=0;
  layerPresent=true;
  await vm.runInContext('startMatchmaking()',ctx);
  assert.deepEqual(calls,['toast'],'visible story or active tutorial must not overlap combat');
  calls.length=0;
  layerPresent=false;
  await vm.runInContext('startMatchmaking()',ctx);
  assert.ok(calls.includes('subscribe'), 'Foundation player can match without story or tutorial completion');
  assert.ok(!calls.includes('newRoom'), 'mock matched an existing room');
  assert.doesNotMatch(battleSource, /battleStoryReady/);
  assert.doesNotMatch(battleSource, /請先完成第三章劇情與鬥法教學/);
  const join = battleSource.slice(battleSource.indexOf('  async function joinSpecificRoom('),battleSource.indexOf('  // 法寶通用引擎'));
  assert.doesNotMatch(join, /storyProgressV1|battleTutorialV1/);
  assert.match(join, /score\(\) < FOUNDATION_SCORE/);
});

test('battle renders exactly one phase and does not inherit a static old arena', () => {
  const index = readPublic('index.html');
  const match = index.match(/<div id="page-battle"[^>]*><\/div>/g) || [];
  assert.equal(match.length,1);
  assert.doesNotMatch(index, /id="battle-lobby"|id="battle-arena"|id="battle-result"|id="battle-quiz-overlay"/);
  assert.match(battleSource, /page\.dataset\.bv2Phase = name/);
  assert.match(battleSource, /classList\.toggle\('hidden', key !== name\)/);
});


test('Gold Core shields block exactly one PvP hit and never erase off-field cultivation protection', () => {
  const e = loadEngine();
  const core = { type:'ningxin', name:'凝心靜音丹', grade:6 };
  const host = { ...player('h',{correct:false}), goldenCore:core, coreShield:true, coreCorrectStreak:0 };
  const guest = player('g',{correct:true});
  const one = e.settleBattleRound({roomId:'guard',round:1,host,guest});
  assert.equal(one.hostHp,1000);
  assert.equal(one.hostCoreShield,false);
  assert.ok(one.logs.some(x=>x.type==='guard' && x.actorRole==='host'));
  assert.equal(one.logs.find(x=>x.type==='attack').damage,0);
  assert.ok(one.activations.some(x=>x.ownerUid==='h' && x.skill==='金丹道心護體'));
  const two = e.settleBattleRound({roomId:'guard',round:2,host:{...host,coreShield:one.hostCoreShield,coreCorrectStreak:one.hostCoreStreak,hp:one.hostHp},guest});
  assert.equal(two.hostHp,800);
  assert.equal(two.hostCoreShield,false);
  assert.equal(host.coreShield,true, 'snapshot is not mutated and remains separate from persisted cultivation shield');
  assert.match(battleSource,/coreShield: !!window\.getEquippedGoldenCoreBattleSnapshot/);
  assert.match(battleSource,/'host\.coreShield': outcome\.hostCoreShield/);
  assert.match(battleSource,/'guest\.coreCorrectStreak': outcome\.guestCoreStreak/);
});

test('Ningxin correct streak generates protection that prevents the same round hit', () => {
  const e=loadEngine(), core={type:'ningxin',grade:6,name:'凝心靜音丹'};
  const h={...player('h',{correct:true}),goldenCore:core,coreShield:false,coreCorrectStreak:2};
  const g=player('g',{correct:true});
  const out=e.settleBattleRound({roomId:'focus',round:3,host:h,guest:g});
  assert.equal(out.hostCoreStreak,3);
  assert.equal(out.hostHp,1000);
  assert.equal(out.guestHp,800);
  assert.equal(out.hostCoreShield,false,'created and consumed during same round');
  assert.ok(out.activations.some(x=>x.skill==='凝心靜音丹・道心護體'));
});

test('Wugou shield trigger is deterministic and survives without incoming attacks', () => {
  const e=loadEngine(), core={type:'wugou',grade:1,name:'無垢清心丹'};
  const h={...player('h',{correct:false}),goldenCore:core,coreShield:false};
  const g=player('g',{correct:false});
  const first=e.settleBattleRound({roomId:'clean',round:1,host:h,guest:g});
  const again=e.settleBattleRound({roomId:'clean',round:1,host:h,guest:g});
  assert.equal(first.hostCoreShield,again.hostCoreShield);
  assert.equal(first.hostCoreShield,true, 'grade 1 always triggers 100%');
  assert.equal(first.hostHp,1000);
  const second=e.settleBattleRound({roomId:'clean',round:2,host:{...h,coreShield:first.hostCoreShield},guest:player('g',{correct:true})});
  assert.equal(second.hostHp,1000);
  assert.equal(second.hostCoreShield,false);
});

test('All Golden Core battle effects apply their own attack or healing rules', () => {
  const e=loadEngine();
  const support=(type,previous=0,score=40,correct=true,grade=1)=>e.resolveDeterministicCoreSupport({
    goldenCore:{type,grade,name:type},coreCorrectStreak:previous,totalScore:score,
    answer:{correct}
  },'fixed-seed');
  assert.equal(support('taichu',1).heal,100);
  assert.equal(support('pojing',0,67).bonusDamage,100);
  assert.equal(support('pojing',0,40).bonusDamage,0);
  assert.equal(support('xingchen',1).bonusDamage,80);
  assert.equal(support('reverse',1).bonusDamage,120);
  assert.equal(support('taichu',0).heal,0);
  assert.equal(support('reverse',0).bonusDamage,0);
  const taichu={...player('h',{hp:700,correct:true}),goldenCore:{type:'taichu',grade:1},coreCorrectStreak:1};
  const out=e.settleBattleRound({roomId:'heal',round:2,host:taichu,guest:player('g',{correct:false})});
  assert.equal(out.hostHp,800);
  assert.equal(out.guestHp,800);
  assert.ok(out.logs.some(x=>x.type==='heal' && x.amount===100));
});

test('Shielded hit deals zero actual damage and cannot trigger Thunder counter', () => {
  const e=loadEngine();
  const guest={...player('g',{correct:false}),goldenCore:{type:'thunder',grade:1},coreShield:true};
  const out=e.settleBattleRound({roomId:'no-reflect',round:1,host:player('h',{correct:true}),guest});
  assert.equal(out.hostHp,1000);
  assert.equal(out.guestHp,1000);
  assert.ok(!out.logs.some(x=>x.type==='counter'));
  assert.ok(out.logs.some(x=>x.type==='guard'));
});

test('Battle UI shows shield and healing without animating non-attacks', () => {
  assert.match(battleSource,/entry\.type === 'guard'/);
  assert.match(battleSource,/entry\.type === 'heal'/);
  assert.match(battleSource,/logs\.filter\(\(entry\) => entry\.type === 'attack' \|\| entry\.type === 'counter'\)/);
  assert.match(battleSource,/mine\.coreShield \? ' · 道心護體'/);
  assert.match(battleSource,/guest\.coreShield/);
  assert.match(battleSource,/battle-engine-v2\.js\?v=20260920-corebattle1/);
});

globalThis.QACombatCombo = require('../public/cultivation/combat-combo.js');
globalThis.QANascentGrowth = require('../public/cultivation/nascent-growth.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const feedbackSource = read('cultivation/battle-combat-feedback.js');
const battleSource = read('cultivation/battle-mode-v2.js');

function loadFeedback(document = {}) {
  const context = { document };
  vm.runInNewContext(feedbackSource.replace(/export function /g, 'function ') + '\nthis.api={battleStepFeedback,createBattleImpact};', context);
  return context.api;
}
function loadCombat() {
  const context = { window: {},QACombatCombo:globalThis.QACombatCombo };
  vm.runInNewContext(read('cultivation/artifact-battle-effects.js').replace(/^import \{\} from .*;\n/gm,''), context);
  vm.runInNewContext(read('cultivation/battle-engine-v2.js').replace(/^import \{\} from .*;\n/gm,'').replace(/export (const|function) /g, '$1 ') +
    '\nthis.settle=settleBattleRound;', context);
  return { ...context.window, settle: context.settle };
}
function player(uid, extra = {}) {
  return { uid, name: uid, atk: 200, hp: 2000, maxHp: 2000, totalScore: 100,
    answer: { correct: uid === 'h', atMs: uid === 'h' ? 1000 : 2000 }, ...extra };
}
function criticalPlayer(extra = {}) {
  return player('h', { artifactBattle: { version: 1, effects: [{ type: 'equip_crit_chance', value: .5 }] }, ...extra });
}
function criticalRoom(runtime, attacker, defender) {
  for (let index = 0; index < 1000; index++) {
    const room = 'crit-room-' + index;
    if (runtime.resolveArtifactBattleAttack({ attacker, defender, baseDamage: 200, seed: room + ':1:h:artifact' }).critical) return room;
  }
  throw Error('No deterministic critical seed found');
}

test('actual critical rolls survive the equipment bridge and serialized settlement without changing damage', () => {
  const runtime = loadCombat(), host = criticalPlayer(), guest = player('g');
  const roomId = criticalRoom(runtime, host, guest);
  const hit = runtime.resolveArtifactBattleHit({ attacker: host, defender: guest, baseDamage: 200, seed: roomId + ':1:h:artifact' });
  assert.equal(hit.critical, true);
  assert.equal(hit.damage, 300);
  const settle = () => runtime.settle({ roomId, round: 1, host: criticalPlayer(), guest: player('g'), resolveEquipmentHit: runtime.resolveArtifactBattleHit });
  const outcome = settle(), attack = JSON.parse(JSON.stringify(outcome.steps))[0];
  assert.equal(attack.critical, true);
  assert.equal(attack.damage, 300);
  assert.equal(outcome.guestHp, 1700);
  assert.equal(loadFeedback().battleStepFeedback(attack).label, '爆擊 -300');
  assert.equal(JSON.stringify(outcome.steps), JSON.stringify(settle().steps), 'transaction replay has identical flags and damage');
});

test('guarded critical openings never turn the noncritical combo or true-damage follow-up into a critical', () => {
  const runtime = loadCombat();
  const host = criticalPlayer({ artifactBattle: { version: 1, effects: [
    { type: 'equip_crit_chance', value: .5 }, { type: 'equip_true_damage_flat', value: 40 }
  ] } });
  const guest = player('g', { coreShield: true, goldenCore: { type: 'ningxin', grade: 9 } });
  const roomId = criticalRoom(runtime, host, guest);
  const outcome = runtime.settle({ roomId, round: 1, host, guest, resolveEquipmentHit: runtime.resolveArtifactBattleHit, resolveGuardedFollowup: runtime.resolveArtifactGuardedFollowup });
  const [blocked, followup] = outcome.steps;
  assert.equal(blocked.guarded, true);
  assert.equal(blocked.damage, 0);
  assert.equal(blocked.critical, false);
  assert.equal(followup.damage, 40);
  assert.equal(followup.critical, false);
  assert.equal(followup.coreEffect, null);
  assert.equal(loadFeedback().battleStepFeedback(followup, host).critical, false);
  assert.equal(outcome.guestHp, 1960);
});

test('core proc metadata follows the real ocean, sword and support skills', () => {
  const runtime = loadCombat();
  for (const type of ['ocean', 'sword', 'pojing', 'xingchen', 'reverse']) {
    let outcome;
    for (let index = 0; index < 1000; index++) {
      const host = player('h', { goldenCore: { type, grade: 1 }, coreCorrectStreak: type === 'reverse' ? 1 : 2, totalScore: type === 'pojing' ? 60 : 100 });
      const candidate = runtime.settle({ roomId: 'core-room-' + index, round: 1, host, guest: player('g') });
      if (candidate.steps[0].coreEffect) { outcome = candidate; break; }
    }
    assert.ok(outcome, type);
    const attack = outcome.steps[0];
    assert.equal(attack.coreEffect.type, type);
    assert.match(attack.skill, new RegExp(attack.coreEffect.skill));
    assert.ok(outcome.steps.filter(x=>x.actorUid==='h').reduce((sum,x)=>sum+x.damage,0) > 200);
    assert.equal(loadFeedback().battleStepFeedback(attack, { goldenCore: { type } }).enhanced, true);
  }
});

test('thunder counter visuals require actual thunder reflection, not an unrelated artifact counter', () => {
  const runtime = loadCombat();
  let counter;
  for (let index = 0; index < 1000; index++) {
    const outcome = runtime.settle({ roomId: 'counter-room-' + index, round: 1, host: player('h'), guest: player('g', { goldenCore: { type: 'thunder', grade: 1 } }) });
    counter = outcome.steps.find(step => step.type === 'counter');
    if (counter) break;
  }
  assert.equal(counter.coreEffect.type, 'thunder');
  assert.equal(counter.critical, false);
  const feedback = loadFeedback().battleStepFeedback(counter, { goldenCore: { type: 'thunder' } });
  assert.equal(feedback.core.type, 'thunder');
  assert.equal(feedback.enhanced, true);
  assert.equal(loadFeedback().battleStepFeedback({ type: 'counter', skill: '法寶反傷', damage: 50, coreEffect: null }, { goldenCore: { type: 'thunder' } }).core, null);
});

test('all nine equipped cores infuse attacks while ordinary hits never claim a skill proc', () => {
  const api = loadFeedback();
  const shapes = new Set();
  for (const type of ['ocean', 'sword', 'thunder', 'taichu', 'ningxin', 'pojing', 'xingchen', 'wugou', 'reverse']) {
    const feedback = api.battleStepFeedback({ type: 'attack', damage: 200, critical: false }, { goldenCore: { type } });
    assert.equal(feedback.core.type, type);
    assert.equal(feedback.label, '-200');
    assert.equal(feedback.enhanced, false);
    shapes.add(feedback.core.shape);
  }
  assert.equal(shapes.size, 9, 'each core has its own visual motif');
  assert.equal(api.battleStepFeedback({ type: 'attack', damage: 200 }, { goldenCore: { type: 'constructor' } }).core, null);
});

test('legacy critical labels work; explicit flags, misses, blocks and large ordinary damage are respected', () => {
  const { battleStepFeedback: feedback } = loadFeedback();
  assert.ok(feedback({ type: 'attack', damage: 320, skill: '法寶・暴擊' }).critical);
  assert.ok(feedback({ type: 'attack', damage: 320, skill: '爆擊' }).critical);
  for (const step of [
    { type: 'attack', damage: 9999 },
    { type: 'attack', critical: false, skill: '暴擊' },
    { type: 'attack', critical: true, guarded: true },
    { type: 'miss', critical: true, skill: '暴擊' },
    { type: 'counter', critical: true }
  ]) assert.equal(feedback(step).critical, false);
});

function node() {
  const classes = new Set();
  return {
    children: [], dataset: {}, attributes: {}, style: { setProperty(key, value) { this[key] = value; } },
    set className(value) { classes.clear(); value.split(/\s+/).filter(Boolean).forEach(name => classes.add(name)); },
    get className() { return [...classes].join(' '); },
    classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) },
    setAttribute(key, value) { this.attributes[key] = value; },
    appendChild(child) { child.parent = this; this.children.push(child); },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); },
    querySelectorAll(selector) { return this.children.filter(child => selector.split(',').some(part => child.classList.contains(part.trim().split('.').at(-1)))); }
  };
}

test('critical and core layers share direction, elapsed time, clipping parent and one cleanup handle', () => {
  const api = loadFeedback({ createElement: node }), stage = node();
  const effect = api.createBattleImpact(stage, { step: { type: 'attack', damage: 300, critical: true, coreEffect: { type: 'ocean', skill: '千尺巨浪' } }, player: { goldenCore: { type: 'ocean' } }, fromMe: false, elapsedMs: 140 });
  assert.ok(effect.classList.contains('critical'));
  assert.ok(effect.classList.contains('core-enhanced'));
  assert.equal(effect.dataset.core, 'ocean');
  assert.equal(effect.style['--impact-x'], '28%');
  assert.equal(effect.style.animationDelay, '-140ms');
  assert.equal(effect.attributes['aria-hidden'], 'true');
  const caption = effect.children.find(child => child.classList.contains('bv2-core-caption'));
  assert.equal(caption.textContent, '千尺巨浪');
  assert.equal(effect.children.find(child => child.classList.contains('bv2-critical-fx')).children.length, 8);
  assert.equal(stage.children.length, 1);
  effect.remove();
  assert.equal(stage.children.length, 0);
  for (const type of ['miss', 'heal']) assert.equal(api.createBattleImpact(stage, { step: { type } }), null);
  assert.equal(api.createBattleImpact(stage, { step: { type: 'attack', guarded: true } }), null);
});

function playback(step, role = 'host') {
  const stage = node(), mine = node(), enemy = node(), nodes = { 'bv2-my-fighter': mine, 'bv2-enemy-fighter': enemy };
  const document = { createElement: node, getElementById: id => nodes[id], querySelector: () => stage };
  const feedback = loadFeedback(document), hp = [], texts = new Map(), queue = [];
  const room = { round: 1, status: 'settled', battleLogId: 'log', host: player('h', { goldenCore: { type: 'sword' } }), guest: player('g'), lastSettlement: { round: 1, startHostHp: 2000, startGuestHp: 2000, steps: [step] } };
  const state = { roomId: 'r', room, role, reviewedRound: 1, animationTimers: [], seenSettlementKey: null };
  let now = 0;
  const context = { ...feedback, document, state,
    nowMs: () => now, clearTimeout() {}, settlementKey: () => 'r:log', updateArenaCombatState() {},
    setHp: (who, player) => hp.push({ who, hp: player.hp, at: now }), setText: (id, text) => texts.set(id, text),
    otherRole: role => role === 'host' ? 'guest' : 'host',
    scheduleBattleAt: (at, key, action) => queue.push({ at, key, action }),
    ATTACK_LEAD_MS: 280, ATTACK_IMPACT_MS: 650, ATTACK_VISIBLE_MS: 1450, ANIMATION_STEP_MS: 1850,
    battleAnimationDuration: count => 280 + count * 1850 + 400,
    playerForRole: (room, role) => room[role], bothReviewed: () => false, renderResult() {}
  };
  const start = battleSource.indexOf('  function animateSettlement(room) {');
  const end = battleSource.indexOf('  async function confirmReview() {', start);
  vm.runInNewContext(battleSource.slice(start, end) + '\nthis.animate=animateSettlement;', context);
  context.animate(room);
  return { stage, mine, enemy, hp, texts, state, queue, replay: () => context.animate(room),
    run(at, elapsed = 0) { now = at + elapsed; for (const timer of queue.filter(timer => timer.at === at)) timer.action(now); } };
}

test('formal playback shows the settled critical at impact and removes its effects before the next turn', () => {
  const h = playback({ type: 'attack', actorRole: 'host', damage: 300, critical: true, hostHp: 2000, guestHp: 1700 });
  h.run(280);
  assert.equal(h.stage.children.length, 0);
  assert.equal(h.texts.get('bv2-cue-count'), '爆擊');
  h.run(930);
  assert.equal(h.hp.at(-1).hp, 1700);
  assert.equal(h.enemy.children[0].textContent, '爆擊 -300');
  assert.ok(h.enemy.children[0].classList.contains('critical'));
  assert.ok(h.stage.children[0].classList.contains('from-me'));
  const count = h.queue.length; h.replay(); assert.equal(h.queue.length, count);
  h.run(1730);
  assert.equal(h.stage.children.length, 0);
  assert.equal(h.enemy.children.length, 0);
  assert.equal(h.mine.classList.contains('strike'), false);
  assert.equal(h.enemy.classList.contains('hit'), false);
});

test('guest perspective reverses effect direction; late callbacks still apply HP without replaying expired bursts', () => {
  const step = { type: 'attack', actorRole: 'host', damage: 300, critical: true, hostHp: 2000, guestHp: 1700 };
  const guest = playback(step, 'guest'); guest.run(930);
  assert.ok(guest.stage.children[0].classList.contains('from-enemy'));
  assert.equal(guest.mine.children[0].textContent, '爆擊 -300');
  const late = playback(step); late.run(930, 1200);
  assert.equal(late.hp.at(-1).hp, 1700);
  assert.equal(late.stage.children.length, 0);
  assert.equal(late.enemy.children.length, 0);
  const stale = playback(step); stale.state.room = { round: 2 }; stale.run(930);
  assert.equal(stale.hp.length, 2, 'a stale round cannot apply hit HP');
  assert.equal(stale.stage.children.length, 0);
});

test('portrait keyframes carry no movement and reduced motion retains readable critical/core feedback', () => {
  const css = read('styles/battle-mode-v2.css'), tutorial = read('cultivation/battle-tutorial.js');
  for (const name of ['bv2StageAttackMe', 'bv2StageAttackEnemy', 'bv2StageHitMe', 'bv2StageHitEnemy', 'bv2StageMiss', 'btStageAdvanceMe', 'btStageAdvanceEnemy', 'btStageRecoilMe', 'btStageRecoilEnemy']) {
    const text = name.startsWith('bt') ? tutorial : css;
    const start = text.indexOf('@keyframes ' + name);
    const end = text.indexOf('\n', start);
    assert.ok(start >= 0, name);
    assert.doesNotMatch(text.slice(start, end), /transform:|translate|rotate|scale\(/, name);
  }
  assert.doesNotMatch(css, /bv2IdleMe|bv2IdleEnemy/);
  assert.match(css, /bv2-critical-fx/);
  assert.match(css, /prefers-reduced-motion:reduce[\s\S]*bv2-core-caption[\s\S]*animation:none!important;opacity:1/);
  assert.match(tutorial, /battleStepFeedback\(step, attacker\)/);
  assert.match(tutorial, /impact\?\.remove\(\)/);
});

test('leaving combat clears pending impact layers, damage text and portrait animation classes', () => {
  const effects = [node(), node()], mine = node(), enemy = node();
  mine.classList.add('strike'); enemy.classList.add('hit'); mine.style.animationDelay = '-100ms';
  let removals = 0; effects.forEach(effect => { effect.remove = () => removals++; });
  const state = { animationTimers: [1, 2], tick: 3, heartbeat: 4, reconcile: 5 }, cleared = [];
  const context = { state, clearInterval: id => cleared.push(id), clearTimeout: id => cleared.push(id), document: {
    querySelectorAll: () => effects, getElementById: id => id === 'bv2-my-fighter' ? mine : enemy
  } };
  const start = battleSource.indexOf('  function stopTimers() {'), end = battleSource.indexOf('  function resetRuntime() {', start);
  vm.runInNewContext(battleSource.slice(start, end) + '\nthis.stop=stopTimers;', context);
  context.stop();
  assert.equal(removals, 2);
  assert.equal(mine.classList.contains('strike'), false);
  assert.equal(enemy.classList.contains('hit'), false);
  assert.equal(mine.style.animationDelay, '');
  assert.equal(state.animationTimers.length, 0);
  assert.equal(cleared.length, 5);
});

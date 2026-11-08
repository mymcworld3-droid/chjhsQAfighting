(function (root) {
  'use strict';

  const FOUNDATION = 6;
  const GOLDEN_CORE = 28;
  const MAX_TRAINING = 8;
  const MAX_POINTS = 12;
  const BREAKTHROUGH_ATTACK = 10;
  const BREAKTHROUGH_HP = 60;

  const ACTIONS = Object.freeze({
    strike: { name: '破勢', description: '消耗 2 靈息，擊碎 3 重劫印。' },
    guard: { name: '固守', description: '抵擋 3 點劫傷，回復 1 靈息。' },
    channel: { name: '引雷', description: '回復 2 靈息，借雷勢籌備下一擊。' }
  });

  const ROUTES = Object.freeze({
    sword: {
      name: '劍修', glyph: '劍', color: '#f1ca83',
      practice: '磨礪劍骨或演練疊鋒，在鬥法中打出連擊。',
      foundation: '磨礪劍骨', technique: '演練疊鋒', skill: '疊鋒劍意',
      attack: 12, attackStep: 4, hp: 0, hpStep: 0,
      growth: '每練成四重劍骨，再提高 8 點攻擊。',
      attackMilestone: foundation => Math.floor(foundation / 4) * 8,
      effect: 'equip_combo_chance', base: 0.02, step: 0.005, resonance: 0.015,
      effectText: value => `連擊機率 +${percent(value)}`,
      trial: '折劍雷關', rule: '看準劍氣空隙破勢，每次以破勢克制雷劫會返還 1 靈息。',
      waves: [['飛鋒露隙', 3, 'strike'], ['千刃齊鳴', 5, 'guard'], ['裂劍墜落', 3, 'strike'],
        ['回鋒藏勢', 4, 'channel'], ['天劍出鞘', 5, 'strike']]
    },
    body: {
      name: '體修', glyph: '體', color: '#e8a283',
      practice: '淬鍊筋骨或修習護體，以生命和護盾打持久戰。',
      foundation: '淬鍊筋骨', technique: '修習護體', skill: '磐石護身',
      attack: 0, attackStep: 0, hp: 100, hpStep: 25,
      growth: '每重筋骨也會強化護體，使護盾增加 2 點。',
      skillGrowth: foundation => foundation * 2,
      effect: 'equip_on_correct_shield_flat', base: 18, step: 5, resonance: 14,
      effectText: value => `答對後獲得 ${value} 護盾`,
      trial: '撼山罡劫', rule: '用固守承接沉重的山罡，克制時回復 2 點心神。',
      waves: [['山罡壓頂', 6, 'guard'], ['地脈轉息', 4, 'channel'], ['石心現形', 4, 'strike'],
        ['萬鈞墜地', 6, 'guard'], ['地鎖寸斷', 4, 'strike']]
    },
    spell: {
      name: '法修', glyph: '法', color: '#b9b5fb',
      practice: '精研法脈或推演雷訣，以無視普通減傷的真傷克敵。',
      foundation: '精研法脈', technique: '推演雷訣', skill: '九霄雷訣',
      attack: 6, attackStep: 3, hp: 0, hpStep: 0,
      growth: '雷訣每練成三重可凝一枚雷印，再增加 6 點真實傷害。',
      skillGrowth: (_foundation, technique) => Math.floor(technique / 3) * 6,
      effect: 'equip_true_damage_flat', base: 9, step: 3, resonance: 9,
      effectText: value => `命中追加 ${value} 真實傷害`,
      trial: '九霄引雷陣', rule: '以引雷克制陣眼時蓄存一道雷符，下一次破勢額外擊碎 2 重劫印。',
      waves: [['雷眼聚芒', 4, 'channel'], ['陣眼乍開', 4, 'strike'], ['陽雷倒捲', 6, 'guard'],
        ['陰雷回流', 5, 'channel'], ['雙雷合陣', 5, 'strike']]
    },
    insight: {
      name: '悟道修', glyph: '悟', color: '#9fdcc3',
      practice: '觀照心海或參悟歸元，在攻防往返中回復生命。',
      foundation: '觀照心海', technique: '參悟歸元', skill: '歸元心法',
      attack: 0, attackStep: 0, hp: 45, hpStep: 18,
      growth: '心海與歸元每同時精進一重，再增加 0.6 個百分點吸血。',
      skillGrowth: (foundation, technique) => Math.min(foundation, technique) * 0.006,
      effect: 'equip_lifesteal_percent', base: 0.04, step: 0.007, resonance: 0.03,
      effectText: value => `攻擊吸血 ${percent(value)}`,
      trial: '照心幻劫', rule: '連續兩輪以不同招式克制幻象時，額外擊碎 1 重劫印並回復 1 點心神。',
      waves: [['霧中問心', 4, 'channel'], ['心魔壓念', 5, 'guard'], ['幻身露真', 4, 'strike'],
        ['舊念重臨', 5, 'channel'], ['一念破妄', 5, 'strike']]
    }
  });

  const TRIAL = Object.freeze({ resolve: 9, energy: 3, maxEnergy: 5, seals: 15 });
  const number = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const percent = value => `${Math.round(value * 1000) / 10}%`;

  function availablePoints(state) {
    if (number(state?.peakScore) < FOUNDATION) return 0;
    const earned = Math.min(MAX_POINTS, 1 + Math.floor((state.peakScore - FOUNDATION) / 12));
    return Math.max(0, earned - number(state.training?.foundation) - number(state.training?.technique));
  }

  function realmScore(score, state) {
    if (state?.seal) return Math.max(GOLDEN_CORE, score);
    return !state || state.legacyAccess ? score : Math.min(GOLDEN_CORE - 1, score);
  }

  function canStart(playerScore, state) {
    return !!state?.route && !state.seal && (state.legacyAccess || number(playerScore) >= GOLDEN_CORE);
  }

  function waveFor(route, round) {
    const wave = ROUTES[route]?.waves[round];
    if (!wave) return null;
    const [name, damage, counter] = wave;
    return { name, damage, counter };
  }

  function newAttempt(id) {
    return { id, status: 'active', round: 0, resolve: TRIAL.resolve, energy: TRIAL.energy,
      seals: 0, talisman: false, lastCounter: '', last: null };
  }

  function playTurn(route, trial, action) {
    const wave = waveFor(route, trial.round);
    if (trial.status !== 'active' || !wave || typeof action !== 'string' || !Object.hasOwn(ACTIONS, action) ||
        (action === 'strike' && trial.energy < 2)) return null;
    const countered = wave.counter === action;
    const struck = action === 'strike';
    const guarded = action === 'guard';
    const next = { ...trial };
    const talismanDamage = route === 'spell' && struck && trial.talisman ? 2 : 0;
    const insight = route === 'insight' && countered && trial.lastCounter && trial.lastCounter !== action;
    const heal = route === 'body' && countered && guarded ? 2 : insight ? 1 : 0;
    const damage = Math.max(0, wave.damage - (guarded ? 3 : 0) - (countered ? 3 : 0));
    const broken = (struck ? 3 : 0) + (countered ? 2 : 0) + talismanDamage + (insight ? 1 : 0);
    next.energy = Math.min(TRIAL.maxEnergy, trial.energy + (struck ? -2 : guarded ? 1 : 2) +
      (route === 'sword' && countered && struck ? 1 : 0));
    next.resolve = Math.min(TRIAL.resolve, Math.max(0, trial.resolve + heal - damage));
    next.seals = Math.min(TRIAL.seals, trial.seals + broken);
    next.lastCounter = countered ? action : '';
    if (route === 'spell') next.talisman = struck ? false : trial.talisman || (countered && action === 'channel');
    next.last = { action, countered, damage, broken, heal };
    next.round += 1;
    if (!next.resolve) next.status = 'failed';
    else if (!waveFor(route, next.round)) next.status = next.seals >= TRIAL.seals ? 'passed' : 'failed';
    return next;
  }

  function bonuses(state, coreActive = false) {
    const route = ROUTES[state?.route];
    if (!route) return { attack: 0, maxHp: 0, effects: [], skillText: '', resonanceText: '' };
    const foundation = Math.min(MAX_TRAINING, number(state.training?.foundation));
    const technique = Math.min(MAX_TRAINING, number(state.training?.technique));
    const resonating = !!state.seal && !!coreActive;
    const skill = route.base + technique * route.step + (route.skillGrowth?.(foundation, technique) || 0) +
      (resonating ? route.resonance : 0);
    const masteryAttack = route.attackMilestone?.(foundation) || 0;
    return {
      attack: route.attack + foundation * route.attackStep + masteryAttack + (state.seal ? BREAKTHROUGH_ATTACK : 0),
      maxHp: route.hp + foundation * route.hpStep + (state.seal ? BREAKTHROUGH_HP : 0),
      effects: [{ type: route.effect, value: Number(skill.toFixed(4)), artifactId: 'cultivation-' + state.route,
        artifactName: route.skill, soulbound: false, effectIndex: 0 }],
      resonating, skillText: route.effectText(skill),
      resonanceText: route.effectText(route.resonance)
    };
  }

  function battleSnapshot(state, core) {
    return { version: 1, effects: bonuses(state, core).effects, openingShield: 0 };
  }

  const api = Object.freeze({ FOUNDATION, GOLDEN_CORE, MAX_TRAINING, BREAKTHROUGH_ATTACK, BREAKTHROUGH_HP,
    ROUTES, ACTIONS, TRIAL, number, availablePoints, realmScore, canStart, waveFor, newAttempt, playTurn,
    bonuses, battleSnapshot });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QACultivationRebootRules = api;
})(globalThis);

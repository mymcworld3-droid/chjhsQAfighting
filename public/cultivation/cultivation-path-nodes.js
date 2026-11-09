(function (root) {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const Access = isNode ? require('./training-access-rules.js') : root.QATrainingAccessRules;
  const RANKS = [
    ['foundation', '築基'], ['core', '金丹'], ['nascent', '元嬰'], ['spirit', '化神'],
    ['void', '煉虛'], ['union', '合體'], ['tribulation', '渡劫'], ['immortal', '半仙']
  ];
  // The final stage finishes at the existing 仙道精進 quest milestone.
  const IMMORTAL_MASTERY_SCORE = 2588;
  const CHAPTERS = Object.freeze(RANKS.map(([id, name], index) => Object.freeze({
    id, name, index, need: Access.REALMS[index + 1],
    full: index === RANKS.length - 1 ? IMMORTAL_MASTERY_SCORE : Access.REALMS[index + 2] - 1
  })));
  const NODES_PER_CHAPTER = 7;

  const DESIGNS = {
    sword: {
      lanes: ['劍骨', '疊鋒'],
      marks: ['初鋒', '凝芒', '聽劍', '御霄', '歸虛', '合鋒', '斷雷', '仙鋒'],
      seals: ['一線開鋒', '劍丹同鳴', '飛劍成陣', '一念千鋒', '無形劍意', '人劍合一', '劍斷天雷', '一劍照天'],
      a: [['淬刃', { attack: 4 }], ['飛星', { equip_crit_chance: 0.005 }], ['礪骨', { attack: 5 }]],
      b: [['分影', { equip_combo_damage_percent: 0.01 }], ['追鋒', { equip_crit_damage_percent: 0.01 }],
        ['疊刃', { equip_combo_damage_percent: 0.015 }]],
      seal: { attack: 8, equip_combo_damage_percent: 0.02, equip_combo_chance: 0.003 },
      traits: [
        { equip_crit_chance: 0.012 },
        { equip_crit_damage_percent: 0.06 },
        { equip_combo_damage_percent: 0.05 },
        { equip_combo_chance: 0.004 },
        { equip_low_hp_damage_percent: 0.055 },
        { equip_damage_percent: 0.035 },
        { equip_streak_damage_percent: 0.09 },
        { equip_crit_chance: 0.025, equip_crit_damage_percent: 0.09 }
      ]
    },
    body: {
      lanes: ['體魄', '護體'],
      marks: ['鍛筋', '鳴骨', '鎮脈', '立嶽', '虛身', '磐軀', '承雷', '仙骨'],
      seals: ['鐵骨初成', '血氣成輪', '山息入脈', '肉身鎮嶽', '虛境不動', '金剛法身', '千雷不摧', '萬山歸身'],
      a: [['煉骨', { maxHp: 12 }], ['伏甲', { equip_damage_reduction_flat: 1 }], ['通脈', { maxHp: 18 }]],
      b: [['生甲', { equip_on_correct_shield_flat: 2 }], ['厚甲', { equip_first_hit_reduction_percent: 0.01 }],
        ['磐息', { equip_on_correct_shield_flat: 3 }]],
      seal: { maxHp: 22, equip_on_correct_shield_flat: 4, equip_damage_reduction_flat: 1 },
      traits: [
        { equip_first_hit_reduction_percent: 0.08 },
        { equip_on_correct_shield_flat: 6 },
        { equip_damage_reduction_flat: 3 },
        { equip_shield_flat: 45 },
        { equip_low_hp_reduction_percent: 0.10 },
        { equip_damage_reduction_percent: 0.045 },
        { equip_reflect_percent: 0.10 },
        { equip_damage_cap_percent: 0.40 }
      ]
    },
    spell: {
      lanes: ['法脈', '雷訣'],
      marks: ['引電', '照符', '定陣', '御雷', '虛引', '合篆', '劫印', '天符'],
      seals: ['雷符入門', '丹火凝篆', '雷紋開脈', '御雷成陣', '雷入虛空', '五雷合印', '九霄劫法', '天雷正印'],
      a: [['引弧', { equip_true_damage_flat: 3 }], ['銘篆', { attack: 4 }], ['刻雷', { equip_true_damage_flat: 4 }]],
      b: [['布陣', { equip_damage_percent: 0.0075 }], ['聚符', { equip_streak_damage_percent: 0.01 }],
        ['天罡', { equip_damage_percent: 0.0075 }]],
      seal: { equip_true_damage_flat: 7, equip_damage_percent: 0.0125 },
      traits: [
        { equip_true_damage_flat: 5 },
        { equip_true_damage_flat: 3, equip_streak_damage_percent: 0.04 },
        { equip_damage_percent: 0.025, equip_crit_chance: 0.02 },
        { equip_streak_damage_percent: 0.07, equip_crit_damage_percent: 0.04 },
        { equip_low_hp_damage_percent: 0.05, equip_true_damage_flat: 5 },
        { equip_damage_percent: 0.035, equip_streak_damage_percent: 0.07 },
        { equip_crit_chance: 0.02, equip_true_damage_flat: 7 },
        { equip_true_damage_flat: 10, equip_damage_percent: 0.04 }
      ]
    },
    insight: {
      lanes: ['心海', '歸元'],
      marks: ['澄念', '觀心', '返照', '明性', '虛懷', '合道', '破妄', '仙念'],
      seals: ['明心立本', '一念丹明', '心照元海', '萬念歸一', '虛室生白', '道心合真', '雷中見性', '一心照世'],
      a: [['澄心', { maxHp: 12 }], ['守念', { equip_damage_reduction_percent: 0.005 }], ['養元', { maxHp: 14 }]],
      b: [['回息', { equip_lifesteal_percent: 0.005 }], ['省身', { equip_low_hp_damage_percent: 0.0125 }],
        ['歸流', { equip_lifesteal_percent: 0.0075 }]],
      seal: { maxHp: 20, equip_lifesteal_percent: 0.01, equip_low_hp_reduction_percent: 0.01 },
      traits: [
        { equip_lifesteal_percent: 0.02 },
        { equip_lifesteal_percent: 0.012, equip_on_correct_shield_flat: 5 },
        { equip_low_hp_damage_percent: 0.05, equip_lifesteal_percent: 0.015 },
        { equip_first_hit_reduction_percent: 0.075, equip_lifesteal_percent: 0.02 },
        { equip_low_hp_reduction_percent: 0.08, equip_lifesteal_percent: 0.02 },
        { equip_reflect_percent: 0.09, equip_lifesteal_percent: 0.02 },
        { equip_damage_reduction_percent: 0.04, equip_lifesteal_percent: 0.025 },
        { equip_cheat_death: 1 }
      ]
    }
  };

  const FLAT = {
    attack: '攻擊', maxHp: '生命上限', equip_true_damage_flat: '命中真實傷害',
    equip_on_correct_shield_flat: '答對護盾', equip_damage_reduction_flat: '固定減傷',
    equip_shield_flat: '開場護盾'
  };
  const PERCENT = {
    equip_crit_chance: '暴擊率', equip_crit_damage_percent: '暴擊傷害', equip_combo_chance: '連擊率',
    equip_combo_damage_percent: '連擊傷害', equip_first_hit_reduction_percent: '首次受傷減免',
    equip_damage_percent: '普通傷害', equip_streak_damage_percent: '三連答額外傷害',
    equip_damage_reduction_percent: '普通傷害減免', equip_lifesteal_percent: '吸血率',
    equip_low_hp_damage_percent: '低血量增傷', equip_low_hp_reduction_percent: '低血量減傷',
    equip_reflect_percent: '反傷比例'
  };

  function stageBonuses(bonuses, index) {
    const strength = 1 + Math.floor(index / 2) * 0.15;
    return Object.freeze(Object.fromEntries(Object.entries(bonuses).map(([key, value]) =>
      [key, Object.hasOwn(FLAT, key) ? Math.round(value * strength) : value])));
  }

  function buildTree(design) {
    return Object.freeze(CHAPTERS.map(chapter => {
      const { id, index } = chapter;
      const lane = key => design[key].map(([title, bonuses], step) => Object.freeze({
        id: `${id}-${key}${step + 1}`, slot: `${key}${step + 1}`, name: `${design.marks[index]}・${title}`,
        bonuses: stageBonuses({ attack: 1, ...bonuses }, index)
      }));
      const baseBonuses = stageBonuses({ attack: 6, ...design.seal }, index);
      const trait = stageBonuses(design.traits[index], index);
      const combined = { ...baseBonuses };
      for (const [attribute, value] of Object.entries(trait)) combined[attribute] = (combined[attribute] || 0) + value;
      return Object.freeze({ ...chapter, lanes: Object.freeze(design.lanes), nodes: Object.freeze([
        ...lane('a'), ...lane('b'),
        Object.freeze({ id: `${id}-seal`, slot: 'seal', name: design.seals[index],
          baseBonuses, trait, bonuses: Object.freeze(combined) })
      ]) });
    }));
  }

  const trees = Object.fromEntries(Object.entries(DESIGNS).map(([id, design]) => [id, buildTree(design)]));
  const tree = route => Object.hasOwn(trees, route) ? trees[route] : [];
  const learnedSet = state => new Set(Array.isArray(state?.pathNodes) ? state.pathNodes : []);

  function chapterProgress(chapter, score, learned) {
    const earned = score < chapter.need ? 0 : 1 + Math.floor(
      Math.min(1, (score - chapter.need) / (chapter.full - chapter.need)) * (NODES_PER_CHAPTER - 1));
    const spent = chapter.nodes.filter(node => learned.has(node.id)).length;
    const nextAt = earned === 0 ? chapter.need : earned < NODES_PER_CHAPTER
      ? chapter.need + Math.ceil(earned * (chapter.full - chapter.need) / (NODES_PER_CHAPTER - 1)) : null;
    return { earned, spent, available: Math.max(0, earned - spent), nextAt };
  }

  function nodeState(chapter, node, score, learned, progress = chapterProgress(chapter, score, learned)) {
    if (learned.has(node.id)) return 'learned';
    if (score < chapter.need) return 'realm';
    if (node.slot === 'seal') {
      if (!learned.has(`${chapter.id}-a3`) && !learned.has(`${chapter.id}-b3`)) return 'lane';
    } else {
      const [lane, step] = node.slot;
      const required = step !== '1' ? `${chapter.id}-${lane}${Number(step) - 1}`
        : chapter.index ? `${CHAPTERS[chapter.index - 1].id}-seal` : null;
      if (required && !learned.has(required)) return 'prerequisite';
    }
    return progress.available ? 'ready' : 'points';
  }

  function findNode(route, id) {
    if (typeof id !== 'string') return null;
    for (const chapter of tree(route)) {
      const node = chapter.nodes.find(entry => entry.id === id);
      if (node) return { chapter, node };
    }
    return null;
  }

  function totals(state) {
    const learned = learnedSet(state);
    const result = {};
    for (const chapter of tree(state?.route)) {
      for (const node of chapter.nodes) {
        if (!learned.has(node.id)) continue;
        for (const [key, value] of Object.entries(node.bonuses)) result[key] = (result[key] || 0) + value;
      }
    }
    return result;
  }

  function describe(bonuses) {
    return Object.entries(bonuses).map(([key, value]) => {
      if (Object.hasOwn(FLAT, key)) return `${FLAT[key]} +${value}`;
      const percent = Math.round(value * 10000) / 100;
      if (key === 'equip_damage_cap_percent') return `單次承傷上限為生命上限的 ${percent}%`;
      if (key === 'equip_cheat_death') return '每場戰鬥首次遭受致命一擊時保留 1 點生命';
      return `${PERCENT[key]} +${percent}%`;
    });
  }

  const api = Object.freeze({ CHAPTERS, NODES_PER_CHAPTER, tree, learnedSet, chapterProgress, nodeState,
    findNode, totals, describe });
  if (isNode) module.exports = api;
  else root.QACultivationPathNodes = api;
})(globalThis);

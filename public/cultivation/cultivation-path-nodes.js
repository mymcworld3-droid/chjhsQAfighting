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

  // Preserve saved node IDs and each realm's seven-point budget.
  // Every learnable node has ONE attribute; the capstone bonus is its one unique trait.
  const DESIGNS = {
  "sword": {
    "lanes": [
      "破鋒",
      "迴劍"
    ],
    "marks": [
      "初鋒",
      "劍丹",
      "劍魄",
      "御霄",
      "虛刃",
      "合劍",
      "斬劫",
      "問仙"
    ],
    "a": [
      [
        "淬刃",
        {
          "attack": 5
        }
      ],
      [
        "識隙",
        {
          "equip_crit_chance": 0.005
        }
      ],
      [
        "穿鋒",
        {
          "equip_crit_damage_percent": 0.02
        }
      ]
    ],
    "b": [
      [
        "起劍",
        {
          "attack": 5
        }
      ],
      [
        "疊影",
        {
          "equip_combo_chance": 0.004
        }
      ],
      [
        "追斬",
        {
          "equip_combo_damage_percent": 0.018
        }
      ]
    ],
    "seals": [
      [
        "劍心初鳴",
        "暴擊更容易觸發。",
        {
          "equip_crit_chance": 0.014
        }
      ],
      [
        "丹鋒同響",
        "連擊更容易觸發。",
        {
          "equip_combo_chance": 0.014
        }
      ],
      [
        "劍魄破空",
        "暴擊時造成更高傷害。",
        {
          "equip_crit_damage_percent": 0.075
        }
      ],
      [
        "千鋒御霄",
        "連擊的追加傷害提高。",
        {
          "equip_combo_damage_percent": 0.085
        }
      ],
      [
        "虛刃逆命",
        "生命降至 30% 以下時，提高輸出。",
        {
          "equip_low_hp_damage_percent": 0.07
        }
      ],
      [
        "萬劍歸一",
        "普通攻擊傷害全面提高。",
        {
          "equip_damage_percent": 0.04
        }
      ],
      [
        "斬雷九式",
        "每次連續答對第三題時，提高該次傷害。",
        {
          "equip_streak_damage_percent": 0.1
        }
      ],
      [
        "飛仙一劍",
        "命中時額外造成無視普通減傷的真實傷害。",
        {
          "equip_true_damage_flat": 16
        }
      ]
    ]
  },
  "body": {
    "lanes": [
      "鎮嶽",
      "回震"
    ],
    "marks": [
      "鍛骨",
      "血丹",
      "元軀",
      "岳身",
      "虛體",
      "合岳",
      "承雷",
      "仙骨"
    ],
    "a": [
      [
        "煉骨",
        {
          "maxHp": 12
        }
      ],
      [
        "沉息",
        {
          "equip_damage_reduction_flat": 1
        }
      ],
      [
        "鎮山",
        {
          "attack": 4
        }
      ]
    ],
    "b": [
      [
        "振臂",
        {
          "attack": 4
        }
      ],
      [
        "凝甲",
        {
          "equip_on_correct_shield_flat": 3
        }
      ],
      [
        "反震",
        {
          "equip_reflect_percent": 0.012
        }
      ]
    ],
    "seals": [
      [
        "鐵脈初成",
        "受到攻擊時，抵銷一部分固定傷害。",
        {
          "equip_damage_reduction_flat": 3
        }
      ],
      [
        "血氣護元",
        "每場戰鬥第一次受傷時，額外減免傷害。",
        {
          "equip_first_hit_reduction_percent": 0.1
        }
      ],
      [
        "元軀生甲",
        "答對後立即獲得額外護盾。",
        {
          "equip_on_correct_shield_flat": 7
        }
      ],
      [
        "山岳法身",
        "進入戰鬥時帶有額外護盾。",
        {
          "equip_shield_flat": 60
        }
      ],
      [
        "虛身不墜",
        "生命低於 30% 時提高減傷。",
        {
          "equip_low_hp_reduction_percent": 0.12
        }
      ],
      [
        "金剛不動",
        "降低受到的普通傷害。",
        {
          "equip_damage_reduction_percent": 0.065
        }
      ],
      [
        "雷震返天",
        "受擊時反彈一部分傷害。",
        {
          "equip_reflect_percent": 0.13
        }
      ],
      [
        "仙骨不滅",
        "單次承受的傷害不超過生命上限的一定比例。",
        {
          "equip_damage_cap_percent": 0.42
        }
      ]
    ]
  },
  "spell": {
    "lanes": [
      "雷殛",
      "符陣"
    ],
    "marks": [
      "引電",
      "丹篆",
      "元雷",
      "天符",
      "虛引",
      "合印",
      "劫雷",
      "道篆"
    ],
    "a": [
      [
        "聚雷",
        {
          "attack": 5
        }
      ],
      [
        "破罡",
        {
          "equip_true_damage_flat": 4
        }
      ],
      [
        "雷目",
        {
          "equip_crit_chance": 0.006
        }
      ]
    ],
    "b": [
      [
        "啟篆",
        {
          "attack": 5
        }
      ],
      [
        "連符",
        {
          "equip_streak_damage_percent": 0.015
        }
      ],
      [
        "開陣",
        {
          "equip_damage_percent": 0.012
        }
      ]
    ],
    "seals": [
      [
        "雷符入脈",
        "命中時附加無視普通減傷的雷傷。",
        {
          "equip_true_damage_flat": 5
        }
      ],
      [
        "紫電照丹",
        "雷擊更容易暴擊。",
        {
          "equip_crit_chance": 0.018
        }
      ],
      [
        "元雷連誦",
        "每次連續答對第三題時，追加雷法傷害。",
        {
          "equip_streak_damage_percent": 0.06
        }
      ],
      [
        "諸符共振",
        "提高普通攻擊造成的總傷害。",
        {
          "equip_damage_percent": 0.04
        }
      ],
      [
        "虛雷噬命",
        "生命低於 30% 時，雷術威力提高。",
        {
          "equip_low_hp_damage_percent": 0.07
        }
      ],
      [
        "五雷合印",
        "暴擊時，法術傷害進一步提高。",
        {
          "equip_crit_damage_percent": 0.08
        }
      ],
      [
        "萬劫引電",
        "雷法命中更容易接續連擊。",
        {
          "equip_combo_chance": 0.01
        }
      ],
      [
        "天符歸一",
        "連擊造成更高追加傷害。",
        {
          "equip_combo_damage_percent": 0.1
        }
      ]
    ]
  },
  "insight": {
    "lanes": [
      "觀心",
      "歸元"
    ],
    "marks": [
      "澄念",
      "丹心",
      "元識",
      "明性",
      "虛懷",
      "合道",
      "破妄",
      "仙念"
    ],
    "a": [
      [
        "明志",
        {
          "attack": 4
        }
      ],
      [
        "回息",
        {
          "equip_lifesteal_percent": 0.006
        }
      ],
      [
        "養元",
        {
          "maxHp": 15
        }
      ]
    ],
    "b": [
      [
        "照心",
        {
          "attack": 4
        }
      ],
      [
        "凝神",
        {
          "equip_damage_reduction_percent": 0.008
        }
      ],
      [
        "返照",
        {
          "equip_reflect_percent": 0.012
        }
      ]
    ],
    "seals": [
      [
        "明心立本",
        "攻擊命中時，回復更多生命。",
        {
          "equip_lifesteal_percent": 0.023
        }
      ],
      [
        "心海起波",
        "答對後獲得護心之盾。",
        {
          "equip_on_correct_shield_flat": 5
        }
      ],
      [
        "元神照隙",
        "生命低於 30% 時，額外提高反擊輸出。",
        {
          "equip_low_hp_damage_percent": 0.06
        }
      ],
      [
        "一念守真",
        "第一次遭受攻擊時，顯著減少傷害。",
        {
          "equip_first_hit_reduction_percent": 0.09
        }
      ],
      [
        "虛室生白",
        "生命低於 30% 時，提高生存能力。",
        {
          "equip_low_hp_reduction_percent": 0.1
        }
      ],
      [
        "道心返照",
        "被攻擊時，反彈一部分傷害。",
        {
          "equip_reflect_percent": 0.1
        }
      ],
      [
        "劫中無我",
        "降低受到的普通傷害。",
        {
          "equip_damage_reduction_percent": 0.05
        }
      ],
      [
        "一念長生",
        "每場戰鬥第一次遭受致命一擊時，保留 1 點生命。",
        {
          "equip_cheat_death": 1
        }
      ]
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
        bonuses: stageBonuses(bonuses, index)
      }));
      const [traitName, traitText, effect] = design.seals[index];
      const trait = stageBonuses(effect, index);
      return Object.freeze({ ...chapter, lanes: Object.freeze(design.lanes), nodes: Object.freeze([
        ...lane('a'), ...lane('b'),
        Object.freeze({ id: `${id}-seal`, slot: 'seal', name: traitName,
          traitName, traitText, trait, bonuses: trait })
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

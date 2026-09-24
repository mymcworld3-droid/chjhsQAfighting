// 元嬰規則純函式：九種丹性皆有唯一對應元嬰；神識與原修為分開儲存。
export const NASCENT_SOUL_THRESHOLD = 68;
export const NASCENT_SOUL_TYPES = Object.freeze({
  ocean: Object.freeze({ name: '滄海元嬰', trait: '滄海鎮岳', description: '以水勢護身，感悟滄海之力。', tone: 'ocean', icon: '≈' }),
  taichu: Object.freeze({ name: '太初元嬰', trait: '太初還神', description: '調息回元，溫養神魂。', tone: 'gold', icon: '☀' }),
  ningxin: Object.freeze({ name: '凝心元嬰', trait: '凝神守一', description: '凝聚道心，抵禦神識干擾。', tone: 'ivory', icon: '◈' }),
  pojing: Object.freeze({ name: '破境元嬰', trait: '破境衝霄', description: '聚神破障，領悟突破之機。', tone: 'amber', icon: '✦' }),
  xingchen: Object.freeze({ name: '星辰元嬰', trait: '引星入神', description: '牽引星輝，積蓄神識。', tone: 'pale', icon: '✧' }),
  wugou: Object.freeze({ name: '無垢元嬰', trait: '無垢明心', description: '滌淨雜念，保持神魂澄明。', tone: 'silver', icon: '◇' }),
  thunder: Object.freeze({ name: '雷霆元嬰', trait: '九霄雷劫', description: '以雷鍛魂，修習雷霆之道。', tone: 'thunder', icon: 'ϟ' }),
  reverse: Object.freeze({ name: '陰陽元嬰', trait: '陰陽歸一', description: '陰陽流轉，調和神魂。', tone: 'violet', icon: '↺' }),
  sword: Object.freeze({ name: '劍心元嬰', trait: '劍心追魂', description: '以神御劍，凝煉劍意。', tone: 'silver', icon: '⚔' })
});
export const NASCENT_SOUL_STAGES = Object.freeze([
  Object.freeze({ min: 0, name: '初生' }),
  Object.freeze({ min: 30, name: '凝神' }),
  Object.freeze({ min: 80, name: '通靈' }),
  Object.freeze({ min: 150, name: '化形' }),
  Object.freeze({ min: 250, name: '圓滿' })
]);

export function normalizeSpirit(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
export function nascentSoulForCore(coreType) {
  return NASCENT_SOUL_TYPES[coreType] || NASCENT_SOUL_TYPES.taichu;
}
export function nascentSoulStage(spirit) {
  const amount = normalizeSpirit(spirit);
  const index = NASCENT_SOUL_STAGES.findLastIndex(stage => amount >= stage.min);
  const current = NASCENT_SOUL_STAGES[Math.max(0, index)];
  return { ...current, next: NASCENT_SOUL_STAGES[index + 1] || null };
}
export function nascentSoulSpiritReward({ source, score, isCorrect = false, correct = 0, total = 0 } = {}) {
  if (normalizeSpirit(score) < NASCENT_SOUL_THRESHOLD) return 0;
  if (source === 'solo') return isCorrect === true ? 1 : 0;
  if (source === 'daily-meditation') return Number(correct) === 3 && Number(total) === 3 ? 3 : 0;
  if (source === 'dongtian') {
    const amount = normalizeSpirit(correct);
    return Math.min(amount, normalizeSpirit(total));
  }
  return 0;
}


// 點亮消耗累計神識中的「可用神識」，原有神識總量仍用於元嬰修煉階段。
// 九丹相各自保存技能樹；任何丹相已消耗的神識均從共同餘額扣除。
export const NASCENT_SOUL_ATTRIBUTES = Object.freeze([
  Object.freeze({ id: 'attack', name: '神魄', icon: 'fa-khanda', max: 5, value: 12, stat: 'attackFlat', desc: '每級增加 12 攻擊' }),
  Object.freeze({ id: 'vitality', name: '靈體', icon: 'fa-heart-pulse', max: 5, value: 70, stat: 'maxHpFlat', desc: '每級增加 70 生命上限' }),
  Object.freeze({ id: 'focus', name: '神念', icon: 'fa-eye', max: 5, value: 8, stat: 'bonusDamage', desc: '每級增加 8 點鬥法答對攻擊傷害' })
]);

// 每條元嬰支脈：靈胎(30)、顯化(80)、法域(150)；必須順序點亮。
// bonusDamage 僅計入鬥法正確作答所發動的攻擊，與金丹技能分開結算。
const SKILL_CONFIG = Object.freeze({
  ocean: [
    ['滄潮護體', '借海潮淬鍊元嬰之軀。', 0, 140, 0],
    ['潮生萬象', '凝潮為刃，借勢追擊。', 16, 0, 36],
    ['萬海歸墟', '百川歸海，元嬰氣脈更盛。', 0, 280, 30]
  ],
  taichu: [
    ['太初養元', '太初元氣溫養靈體。', 0, 110, 0],
    ['一氣化生', '運轉元氣，增厚攻勢。', 20, 0, 14],
    ['元始歸真', '歸元守一，攻守俱進。', 25, 160, 20]
  ],
  ningxin: [
    ['凝念入定', '以寧靜養心神。', 0, 120, 0],
    ['萬念歸一', '神念凝聚，攻勢更為專注。', 12, 0, 34],
    ['無聲心域', '道心守一，凝成護身心域。', 12, 220, 12]
  ],
  pojing: [
    ['衝霄靈勢', '聚勢以求破境。', 22, 0, 0],
    ['破障一念', '神念破障，出手更有鋒芒。', 20, 0, 25],
    ['九霄破界', '以元嬰之力衝破重重桎梏。', 34, 90, 22]
  ],
  xingchen: [
    ['星輝養神', '星輝流轉，滋養本命元嬰。', 0, 90, 12],
    ['吞月引星', '借星月之勢增強一擊。', 8, 0, 44],
    ['周天星域', '周天群星交匯，攻守相應。', 14, 180, 32]
  ],
  wugou: [
    ['明心無垢', '清氣洗滌元嬰靈體。', 0, 150, 0],
    ['清光映照', '無垢靈光映照攻勢。', 11, 70, 20],
    ['琉璃心境', '靈臺澄明，護佑元嬰。', 10, 270, 10]
  ],
  thunder: [
    ['引雷鍛魄', '以雷霆淬鍊神魄。', 24, 0, 0],
    ['劫光裂空', '雷光交織，落下一記重擊。', 12, 0, 48],
    ['九霄雷域', '雷域既成，神魄更強。', 28, 100, 30]
  ],
  reverse: [
    ['陰陽化氣', '陰陽二氣調和經脈。', 8, 75, 0],
    ['兩儀轉輪', '兩儀輪轉，攻守互濟。', 15, 80, 20],
    ['太極神域', '陰陽歸一，神魂自成周天。', 20, 150, 24]
  ],
  sword: [
    ['劍魄初凝', '以劍意凝成元嬰之魄。', 25, 0, 0],
    ['萬劍同心', '萬劍隨神識而動。', 16, 0, 44],
    ['一念劍域', '以心御劍，劍域既成。', 31, 75, 34]
  ]
});
export const NASCENT_SOUL_SKILL_TIERS = Object.freeze([
  Object.freeze({ id: 'seed', rank: 1, minSpirit: 30, cost: 20, name: '靈胎' }),
  Object.freeze({ id: 'form', rank: 2, minSpirit: 80, cost: 35, name: '顯化' }),
  Object.freeze({ id: 'realm', rank: 3, minSpirit: 150, cost: 55, name: '法域' })
]);

export function soulSkills(type) {
  const config = SKILL_CONFIG[type] || SKILL_CONFIG.taichu;
  return NASCENT_SOUL_SKILL_TIERS.map((tier, index) => {
    const [name, description, attackFlat, maxHpFlat, bonusDamage] = config[index];
    return { ...tier, name, description, attackFlat, maxHpFlat, bonusDamage };
  });
}
function attrCost(level) {
  return 5 + (level - 1) * 5; // 由第 1 級 5 神識開始，每級 +5
}
function soulNodeCap(nodeId) {
  return NASCENT_SOUL_ATTRIBUTES.find(item => item.id === nodeId)?.max
    || (NASCENT_SOUL_SKILL_TIERS.some(item => item.id === nodeId) ? 1 : 0);
}
function cleanLevels(levels) {
  const result = {};
  for (const item of [...NASCENT_SOUL_ATTRIBUTES, ...NASCENT_SOUL_SKILL_TIERS]) {
    const level = Math.min(item.max || 1, normalizeSpirit(levels?.[item.id]));
    if (level) result[item.id] = level;
  }
  // 被修正過的資料不能出現未點前置卻已有後繼技能。
  if (!result.seed) { delete result.form; delete result.realm; }
  else if (!result.form) delete result.realm;
  return result;
}
export function normalizeSoulTree(raw) {
  const paths = {};
  for (const type of Object.keys(NASCENT_SOUL_TYPES)) {
    const nodes = cleanLevels(raw?.paths?.[type]?.nodes);
    if (Object.keys(nodes).length) paths[type] = { nodes };
  }
  return { version: 1, paths };
}
function pathLevels(tree, type) {
  return normalizeSoulTree(tree).paths[type]?.nodes || {};
}
export function soulSpentSpirit(tree) {
  const safe = normalizeSoulTree(tree);
  let spent = 0;
  for (const path of Object.values(safe.paths)) {
    for (const attr of NASCENT_SOUL_ATTRIBUTES) {
      const rank = path.nodes[attr.id] || 0;
      for (let level = 1; level <= rank; level++) spent += attrCost(level);
    }
    for (const tier of NASCENT_SOUL_SKILL_TIERS) {
      if (path.nodes[tier.id]) spent += tier.cost;
    }
  }
  return spent;
}
export function soulAvailableSpirit(tree, earned) {
  return Math.max(0, normalizeSpirit(earned) - soulSpentSpirit(tree));
}
export function soulNodeStatus(tree, type, nodeId, earned) {
  const levels = pathLevels(tree, type);
  const cap = soulNodeCap(nodeId);
  const level = levels[nodeId] || 0;
  const remaining = soulAvailableSpirit(tree, earned);
  if (!NASCENT_SOUL_TYPES[type] || !cap) return { ok: false, reason: '未知元嬰節點', level, remaining };
  if (level >= cap) return { ok: false, reason: '已點亮至上限', level, remaining, cost: 0 };
  const attr = NASCENT_SOUL_ATTRIBUTES.find(item => item.id === nodeId);
  const tierIndex = NASCENT_SOUL_SKILL_TIERS.findIndex(item => item.id === nodeId);
  const tier = NASCENT_SOUL_SKILL_TIERS[tierIndex];
  const cost = attr ? attrCost(level + 1) : tier.cost;
  if (tier && normalizeSpirit(earned) < tier.minSpirit) {
    return { ok: false, reason: '累計神識需達 ' + tier.minSpirit, level, cost, remaining };
  }
  if (tierIndex > 0 && !levels[NASCENT_SOUL_SKILL_TIERS[tierIndex - 1].id]) {
    return { ok: false, reason: '請先點亮上一階神通', level, cost, remaining };
  }
  if (tierIndex === 0 && !Object.keys(levels).some(key =>
    NASCENT_SOUL_ATTRIBUTES.some(item => item.id === key))) {
    return { ok: false, reason: '請先點亮一項基礎屬性', level, cost, remaining };
  }
  if (remaining < cost) return { ok: false, reason: '可用神識不足', level, cost, remaining };
  return { ok: true, reason: '', level, cost, remaining };
}
export function allocateSoulNode(tree, type, nodeId, earned) {
  const status = soulNodeStatus(tree, type, nodeId, earned);
  if (!status.ok) return { ok: false, ...status, tree: normalizeSoulTree(tree) };
  const next = normalizeSoulTree(tree);
  const nodes = { ...(next.paths[type]?.nodes || {}) };
  nodes[nodeId] = status.level + 1;
  next.paths[type] = { nodes };
  return { ok: true, cost: status.cost, tree: next, remaining: soulAvailableSpirit(next, earned) };
}
export function soulCombatBonuses(tree, type) {
  const levels = pathLevels(tree, type);
  const result = { attackFlat: 0, maxHpFlat: 0, bonusDamage: 0 };
  for (const attr of NASCENT_SOUL_ATTRIBUTES) result[attr.stat] += attr.value * (levels[attr.id] || 0);
  for (const skill of soulSkills(type)) {
    if (!levels[skill.id]) continue;
    result.attackFlat += skill.attackFlat;
    result.maxHpFlat += skill.maxHpFlat;
    result.bonusDamage += skill.bonusDamage;
  }
  return result;
}

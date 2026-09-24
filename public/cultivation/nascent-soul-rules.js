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


// 元嬰雙脈：左鬥法、右修為；靠近中心的主節點每級 1 神識，外側分支每級 3 神識。
// 九種元嬰各有自己的節點名稱、進度及效果；共用同一筆可用神識。
export const NASCENT_SOUL_NODE_CAP = 10;
export const NASCENT_SOUL_BRANCH_UNLOCK = 5;
export const NASCENT_SOUL_NODE_ORDER = Object.freeze([
  'leftTop','leftMain','leftBottom','rightMain','rightTop','rightBottom'
]);
const NODE_CONFIG = Object.freeze([
  { id: 'leftMain', name: '神魄', icon: 'fa-khanda', parent: null, attackFlat: 12, maxHpFlat: 0, bonusDamage: 0, desc: '淬鍊神魄，每級增加攻擊。' },
  { id: 'leftTop', name: '凌霄', icon: 'fa-bolt', parent: 'leftMain', attackFlat: 0, maxHpFlat: 0, bonusDamage: 8, desc: '神識化鋒，每級增加答對攻擊傷害。' },
  { id: 'leftBottom', name: '破陣', icon: 'fa-khanda', parent: 'leftMain', attackFlat: 7, maxHpFlat: 0, bonusDamage: 0, desc: '凝神聚勢，每級增加攻擊。' },
  { id: 'rightMain', name: '悟道', icon: 'fa-book-open', parent: null, attackFlat: 0, maxHpFlat: 0, bonusDamage: 0, cultivationSolo: 1, desc: '每級使問道答對時額外獲得 1 修為。' },
  { id: 'rightTop', name: '閉關', icon: 'fa-mountain-sun', parent: 'rightMain', attackFlat: 0, maxHpFlat: 0, bonusDamage: 0, cultivationDaily: 1, desc: '每級使每日閉關全對時額外獲得 1 修為。' },
  { id: 'rightBottom', name: '洞天', icon: 'fa-dungeon', parent: 'rightMain', attackFlat: 0, maxHpFlat: 0, bonusDamage: 0, cultivationCave: 1, desc: '每級使洞天首次通關時額外獲得 1 修為。' }
]);
const BRANCH_NAMES = Object.freeze({
  ocean: ['滄潮化刃','千浪破軍','潮汐悟道','萬海問天'],
  taichu: ['一氣化生','元始開天','太初悟道','元始問天'],
  ningxin: ['心念如鋒','靜意破妄','寧神悟道','明心問天'],
  pojing: ['破界鋒芒','衝霄一念','破境悟道','九霄問天'],
  xingchen: ['引星化刃','星月追擊','星輝悟道','周天問星'],
  wugou: ['清光破邪','明鏡映心','無垢悟道','琉璃問天'],
  thunder: ['劫光裂空','萬雷追擊','九霄悟道','雷域問天'],
  reverse: ['兩儀化刃','陰陽逆轉','陰陽悟道','太極問天'],
  sword: ['劍魄凌霄','萬劍歸宗','劍心悟道','萬劍問天']
});
export const NASCENT_SOUL_ATTRIBUTES = Object.freeze(NODE_CONFIG.filter(item => !item.parent).map(item =>
  Object.freeze({ ...item, max: NASCENT_SOUL_NODE_CAP, stat: item.attackFlat ? 'attackFlat' : 'cultivationSolo', value: item.attackFlat || item.cultivationSolo })
));
export const NASCENT_SOUL_SKILL_TIERS = Object.freeze(NODE_CONFIG.filter(item => !!item.parent).map(item =>
  Object.freeze({ id: item.id, parent: item.parent, max: NASCENT_SOUL_NODE_CAP, cost: 3 })
));
export function soulSkills(type) {
  const names = BRANCH_NAMES[type] || BRANCH_NAMES.taichu;
  return NODE_CONFIG.filter(item => item.parent).map((item, index) => ({
    ...item, name: names[index], max: NASCENT_SOUL_NODE_CAP, cost: 3
  }));
}
export function soulNodeCost(nodeId) {
  if (!NASCENT_SOUL_NODE_ORDER.includes(nodeId)) return 0;
  return NODE_CONFIG.find(item => item.id === nodeId)?.parent ? 3 : 1;
}
export function soulNodes(type) {
  const skillMap = Object.fromEntries(soulSkills(type).map(item => [item.id, item]));
  return NASCENT_SOUL_NODE_ORDER.map(id => skillMap[id] || NODE_CONFIG.find(item => item.id === id));
}
const LEGACY_ATTRS = Object.freeze([
  { id: 'attack', max: 5 }, { id: 'vitality', max: 5 }, { id: 'focus', max: 5 }
]);
const LEGACY_TIERS = Object.freeze([{ id:'seed', cost:20 },{ id:'form', cost:35 },{ id:'realm', cost:55 }]);
function legacyLevels(raw) {
  const nodes = {};
  for (const item of LEGACY_ATTRS) {
    const rank = Math.min(item.max, normalizeSpirit(raw?.[item.id]));
    if (rank) nodes[item.id] = rank;
  }
  for (const item of LEGACY_TIERS) {
    if (normalizeSpirit(raw?.[item.id])) nodes[item.id] = 1;
  }
  if (!nodes.seed) { delete nodes.form; delete nodes.realm; }
  else if (!nodes.form) delete nodes.realm;
  return nodes;
}
function oldSpent(nodes) {
  let spent = 0;
  for (const item of LEGACY_ATTRS) {
    const rank = nodes[item.id] || 0;
    for (let i = 1; i <= rank; i++) spent += 5 * i;
  }
  for (const tier of LEGACY_TIERS) if (nodes[tier.id]) spent += tier.cost;
  return spent;
}
function cleanLevels(raw) {
  const nodes = {};
  for (const id of NASCENT_SOUL_NODE_ORDER) {
    const level = Math.min(NASCENT_SOUL_NODE_CAP, normalizeSpirit(raw?.[id]));
    if (level) nodes[id] = level;
  }
  // 允許舊版遷移保有後繼節點：自動補齊原本已付費的前置節點。
  for (const id of NASCENT_SOUL_NODE_ORDER) {
    const node = NODE_CONFIG.find(item => item.id === id);
    if (nodes[id] && node.parent && (nodes[node.parent] || 0) < NASCENT_SOUL_BRANCH_UNLOCK) {
      nodes[node.parent] = NASCENT_SOUL_BRANCH_UNLOCK;
    }
  }
  return nodes;
}
function migrateLegacyPath(raw) {
  const old = legacyLevels(raw);
  const migrated = cleanLevels({
    leftMain: (old.attack || 0) * 2,
    rightMain: (old.vitality || 0) * 2,
    leftBottom: (old.focus || 0) * 2,
    leftTop: old.seed || 0,
    rightTop: old.form || 0,
    rightBottom: old.realm || 0
  });
  return { nodes: migrated, baselineNodes: { ...migrated }, legacySpent: oldSpent(old) };
}
export function normalizeSoulTree(raw) {
  const paths = {};
  for (const type of Object.keys(NASCENT_SOUL_TYPES)) {
    const path = raw?.paths?.[type];
    if (!path || typeof path !== 'object') continue;
    const isOld = Number(raw?.version) !== 2;
    const fixed = isOld ? migrateLegacyPath(path.nodes) : {
      nodes: cleanLevels(path.nodes),
      baselineNodes: {}, legacySpent: normalizeSpirit(path.legacySpent)
    };
    if (!isOld) {
      const baselines = cleanLevels(path.baselineNodes);
      for (const id of NASCENT_SOUL_NODE_ORDER) {
        if (baselines[id]) fixed.baselineNodes[id] = Math.min(baselines[id], fixed.nodes[id] || 0);
      }
    }
    if (Object.keys(fixed.nodes).length || fixed.legacySpent) paths[type] = fixed;
  }
  return { version: 2, paths };
}
export function soulSpentSpirit(tree) {
  const safe = normalizeSoulTree(tree);
  let spent = 0;
  for (const path of Object.values(safe.paths)) {
    spent += path.legacySpent || 0;
    for (const id of NASCENT_SOUL_NODE_ORDER) {
      spent += Math.max(0, (path.nodes[id] || 0) - (path.baselineNodes[id] || 0)) * soulNodeCost(id);
    }
  }
  return spent;
}
export function soulAvailableSpirit(tree, earned) {
  return Math.max(0, normalizeSpirit(earned) - soulSpentSpirit(tree));
}
export function soulNodeStatus(tree, type, nodeId, earned) {
  const levels = normalizeSoulTree(tree).paths[type]?.nodes || {};
  const level = levels[nodeId] || 0;
  const remaining = soulAvailableSpirit(tree, earned);
  const node = NODE_CONFIG.find(item => item.id === nodeId);
  const cost = soulNodeCost(nodeId);
  if (!NASCENT_SOUL_TYPES[type] || !node) return { ok:false, reason:'未知元嬰節點', level, remaining, cost:0 };
  if (level >= NASCENT_SOUL_NODE_CAP) return { ok:false, reason:'已點滿', level, remaining, cost:0 };
  if (node.parent && (levels[node.parent] || 0) < NASCENT_SOUL_BRANCH_UNLOCK) {
    return { ok:false, reason:'前置需達 5 / 10', level, remaining, cost };
  }
  if (remaining < cost) return { ok:false, reason:'神識不足', level, remaining, cost };
  return { ok:true, reason:'', level, remaining, cost };
}
export function allocateSoulNode(tree, type, nodeId, earned) {
  const status = soulNodeStatus(tree, type, nodeId, earned);
  if (!status.ok) return { ok:false, ...status, tree:normalizeSoulTree(tree) };
  const next = normalizeSoulTree(tree);
  const prior = next.paths[type] || { nodes:{}, baselineNodes:{}, legacySpent:0 };
  next.paths[type] = { ...prior, nodes: { ...prior.nodes, [nodeId]: status.level + 1 } };
  return { ok:true, cost:status.cost, tree:next, remaining:soulAvailableSpirit(next, earned) };
}
export function soulCombatBonuses(tree, type) {
  const nodes = normalizeSoulTree(tree).paths[type]?.nodes || {};
  const result = { attackFlat:0, maxHpFlat:0, bonusDamage:0 };
  for (const node of soulNodes(type)) {
    for (const key of Object.keys(result)) result[key] += (node[key] || 0) * (nodes[node.id] || 0);
  }
  return result;
}

// 修為分支只在相應結算渠道生效，避免把重玩洞天或閉關部分答對誤算為加成。
export function soulCultivationBonuses(tree, type) {
  const nodes = normalizeSoulTree(tree).paths[type]?.nodes || {};
  return {
    solo: nodes.rightMain || 0,
    daily: nodes.rightTop || 0,
    cave: nodes.rightBottom || 0
  };
}
// 使用遠端玩家資料計算每日閉關／洞天交易內的數值；停用金丹時不套用元嬰。
export function soulCultivationBonusForPlayer(player, source) {
  if (normalizeSpirit(player?.stats?.totalScore) < NASCENT_SOUL_THRESHOLD) return 0;
  const training = player?.cultivationTraining;
  if (training?.coreEnabled === false || !training?.equippedCore?.type) return 0;
  const bonuses = soulCultivationBonuses(player?.nascentSoulTree, training.equippedCore.type);
  return normalizeSpirit(bonuses[source]);
}

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


// 元嬰雙脈：左右各六節點，內層 1、中層 3、遠層 5、終極 8 神識／級。
// 左脈攻擊，右脈生存；少量途中節點用於學習修為，終極節點呼應調御金丹的丹性與品級。
export const NASCENT_SOUL_NODE_CAP = 10;
export const NASCENT_SOUL_BRANCH_UNLOCK = 5;
export const NASCENT_SOUL_NODE_ORDER = Object.freeze([
  'leftFinal','leftFarTop','leftTop','leftMain','leftBottom','leftFarBottom',
  'rightMain','rightTop','rightFarTop','rightFinal','rightFarBottom','rightBottom'
]);
const NODE_CONFIG = Object.freeze([
  { id:'leftMain', name:'神魄', icon:'fa-khanda', parent:null, depth:1, attackFlat:12, desc:'淬鍊神魄，每級增加 12 攻擊。' },
  { id:'leftTop', name:'凌霄', icon:'fa-bolt', parent:'leftMain', depth:2, bonusDamage:8, desc:'每級增加 8 點答對攻擊傷害。' },
  { id:'leftBottom', name:'悟道', icon:'fa-book-open', parent:'leftMain', depth:2, cultivationSolo:1, desc:'修行分支：問道答對時，每級額外獲得 1 修為。' },
  { id:'leftFarTop', name:'破陣', icon:'fa-khanda', parent:'leftTop', depth:3, attackFlat:7, desc:'每級增加 7 攻擊。' },
  { id:'leftFarBottom', name:'追擊', icon:'fa-crosshairs', parent:'leftBottom', depth:3, bonusDamage:6, desc:'每級增加 6 點答對攻擊傷害。' },
  { id:'leftFinal', name:'本命殺招', icon:'fa-fire-flame-curved', parent:['leftFarTop','leftFarBottom'], depth:4, coreAttack:1, desc:'依調御的金丹丹性與品級，強化每次答對的攻擊傷害。' },
  { id:'rightMain', name:'靈體', icon:'fa-heart-pulse', parent:null, depth:1, maxHpFlat:70, desc:'每級增加 70 生命上限。' },
  { id:'rightTop', name:'守元', icon:'fa-shield-halved', parent:'rightMain', depth:2, reductionFlat:5, desc:'每級使鬥法受到的每次傷害減少 5。' },
  { id:'rightBottom', name:'閉關', icon:'fa-mountain-sun', parent:'rightMain', depth:2, cultivationDaily:1, desc:'修行分支：每日閉關全對時，每級額外獲得 1 修為。' },
  { id:'rightFarTop', name:'護命', icon:'fa-heart', parent:'rightTop', depth:3, maxHpFlat:55, desc:'每級增加 55 生命上限。' },
  { id:'rightFarBottom', name:'洞天', icon:'fa-dungeon', parent:'rightBottom', depth:3, cultivationCave:1, desc:'修行分支：洞天首次通關且至少答對一題，每級額外獲得 1 修為。' },
  { id:'rightFinal', name:'本命護元', icon:'fa-sun-plant-wilt', parent:['rightFarTop','rightFarBottom'], depth:4, coreHeal:1, desc:'依調御的金丹丹性與品級，答對時恢復生命。' }
]);
const BRANCH_NAMES = Object.freeze({
  ocean:['滄潮化刃','千浪破軍','萬海殺招','潮汐護元'],
  taichu:['一氣化生','元始開天','太初殺招','太初護元'],
  ningxin:['心念如鋒','靜意破妄','寧心殺招','凝神護元'],
  pojing:['破界鋒芒','衝霄一念','破境殺招','九霄護元'],
  xingchen:['引星化刃','星月追擊','星辰殺招','周天護元'],
  wugou:['清光破邪','明鏡映心','無垢殺招','琉璃護元'],
  thunder:['劫光裂空','萬雷追擊','雷霆殺招','雷域護元'],
  reverse:['兩儀化刃','陰陽逆轉','陰陽殺招','太極護元'],
  sword:['劍魄凌霄','萬劍歸宗','劍心殺招','劍魄護元']
});
// 九種金丹的終極增益依丹性分化；品級越高（數字越小），單級效果越強。
const CORE_FINALE = Object.freeze({
  ocean: { attack:18, heal:11 }, taichu:{attack:12,heal:20}, ningxin:{attack:13,heal:18},
  pojing:{attack:22,heal:9}, xingchen:{attack:19,heal:12}, wugou:{attack:11,heal:21},
  thunder:{attack:23,heal:10}, reverse:{attack:16,heal:16}, sword:{attack:24,heal:9}
});
export function soulFinalePerLevel(type, grade = 9) {
  const core = CORE_FINALE[type] || CORE_FINALE.taichu;
  const quality = 9 - Math.min(9, Math.max(1, Math.floor(Number(grade) || 9)));
  return { coreAttack:core.attack + quality * 2, coreHeal:core.heal + quality };
}
export const NASCENT_SOUL_ATTRIBUTES = Object.freeze(NODE_CONFIG.filter(item => !item.parent).map(item =>
  Object.freeze({ ...item, max: NASCENT_SOUL_NODE_CAP })
));
export const NASCENT_SOUL_SKILL_TIERS = Object.freeze(NODE_CONFIG.filter(item => !!item.parent).map(item =>
  Object.freeze({ id:item.id, parent:item.parent, max:NASCENT_SOUL_NODE_CAP, cost: item.depth === 2 ? 3 : item.depth === 3 ? 5 : 8 })
));
export function soulSkills(type) {
  const names = BRANCH_NAMES[type] || BRANCH_NAMES.taichu;
  const ids = ['leftTop','leftFarTop','leftFinal','rightFinal'];
  return NODE_CONFIG.filter(item => !!item.parent).map(item => {
    const index = ids.indexOf(item.id);
    return { ...item, name:index < 0 ? item.name : names[index], max:NASCENT_SOUL_NODE_CAP, cost:soulNodeCost(item.id) };
  });
}
export function soulNodeCost(nodeId) {
  const node = NODE_CONFIG.find(item => item.id === nodeId);
  return node ? [0,1,3,5,8][node.depth] : 0;
}
export function soulNodes(type, grade = 9) {
  const names = Object.fromEntries(soulSkills(type).map(item => [item.id, item]));
  const finale = soulFinalePerLevel(type, grade);
  return NASCENT_SOUL_NODE_ORDER.map(id => {
    const base = names[id] || NODE_CONFIG.find(item => item.id === id);
    return { ...base, ...(id === 'leftFinal' ? {coreAttack:finale.coreAttack} : {}),
      ...(id === 'rightFinal' ? {coreHeal:finale.coreHeal} : {}) };
  });
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
  // 已持有的老節點仍保留；後續升級需要新前置，遷移不額外贈送神識。
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
  // 老版已解鎖的分支補足原主節點級數，維持舊進度，計入免費基線。
  if ((migrated.leftTop || migrated.leftBottom) && (migrated.leftMain || 0) < 5) migrated.leftMain = 5;
  if ((migrated.rightTop || migrated.rightBottom) && (migrated.rightMain || 0) < 5) migrated.rightMain = 5;
  return { nodes: migrated, baselineNodes: { ...migrated }, legacySpent: oldSpent(old) };
}
export function normalizeSoulTree(raw) {
  const paths = {};
  const version = Number(raw?.version);
  for (const type of Object.keys(NASCENT_SOUL_TYPES)) {
    const path = raw?.paths?.[type];
    if (!path || typeof path !== 'object') continue;
    let fixed;
    if (version >= 4) {
      fixed = {nodes:cleanLevels(path.nodes), baselineNodes:cleanLevels(path.baselineNodes),
        legacySpent:normalizeSpirit(path.legacySpent)};
    } else if (version === 3) {
      const nodes = cleanLevels(path.nodes);
      const oldBaseline = cleanLevels(path.baselineNodes);
      let spent = normalizeSpirit(path.legacySpent);
      // v3 按原價 1／3 計算，再凍結成已付費基線；升級才使用新 1／3／5／8 費率。
      for (const id of ['leftTop','leftMain','leftBottom','rightMain','rightTop','rightBottom']) {
        spent += Math.max(0,(nodes[id] || 0) - (oldBaseline[id] || 0)) *
          (id === 'leftMain' || id === 'rightMain' ? 1 : 3);
      }
      fixed = {nodes, baselineNodes:{...nodes}, legacySpent:spent};
    } else if (version === 2) {
      const nodes = cleanLevels(path.nodes), originalBaseline = cleanLevels(path.baselineNodes);
      let spent = normalizeSpirit(path.legacySpent);
      for (const id of ['leftTop','leftMain','leftBottom','rightMain','rightTop','rightBottom']) {
        spent += Math.max(0,(nodes[id] || 0) - (originalBaseline[id] || 0));
      }
      fixed = {nodes, baselineNodes:{...nodes}, legacySpent:spent};
    } else fixed = migrateLegacyPath(path.nodes);
    for (const id of NASCENT_SOUL_NODE_ORDER) {
      if (fixed.baselineNodes[id]) {
        fixed.baselineNodes[id] = Math.min(fixed.baselineNodes[id], fixed.nodes[id] || 0);
        if (!fixed.baselineNodes[id]) delete fixed.baselineNodes[id];
      }
    }
    if (Object.keys(fixed.nodes).length || fixed.legacySpent) paths[type] = fixed;
  }
  return {version:4, paths};
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
  const parents = Array.isArray(node.parent) ? node.parent : node.parent ? [node.parent] : [];
  if (parents.some(parent => (levels[parent] || 0) < NASCENT_SOUL_BRANCH_UNLOCK)) {
    return { ok:false, reason:parents.length > 1 ? '兩條前置支脈皆須達 5 / 10' : '前置需達 5 / 10', level, remaining, cost };
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
export function soulCombatBonuses(tree, type, grade = 9) {
  const nodes = normalizeSoulTree(tree).paths[type]?.nodes || {};
  const result = {attackFlat:0,maxHpFlat:0,bonusDamage:0,reductionFlat:0,coreHeal:0};
  for (const node of soulNodes(type, grade)) {
    for (const key of Object.keys(result)) {
      const effect = key === 'bonusDamage' ? (node.bonusDamage || 0) + (node.coreAttack || 0) : (node[key] || 0);
      result[key] += effect * (nodes[node.id] || 0);
    }
  }
  return result;
}
export function soulCultivationBonuses(tree, type) {
  const nodes = normalizeSoulTree(tree).paths[type]?.nodes || {};
  return {solo:nodes.leftBottom || 0, daily:nodes.rightBottom || 0, cave:nodes.rightFarBottom || 0};
}
export function soulCultivationBonusForPlayer(player, source) {
  if (normalizeSpirit(player?.stats?.totalScore) < NASCENT_SOUL_THRESHOLD) return 0;
  const training = player?.cultivationTraining;
  if (training?.coreEnabled === false || !training?.equippedCore?.type) return 0;
  return normalizeSpirit(soulCultivationBonuses(player?.nascentSoulTree,training.equippedCore.type)[source]);
}

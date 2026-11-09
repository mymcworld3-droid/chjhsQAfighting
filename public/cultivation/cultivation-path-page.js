import { cultivationRequest, cultivationView } from './cultivation-reboot-client.js';

const Rules = globalThis.QACultivationRebootRules;
const Nodes = globalThis.QACultivationPathNodes;
const TAB = '#page-training [data-training-tab="path"]';
const ORIGIN = { id: 'origin', slot: 'origin', name: '起點' };
const NODE_ICONS = {
  sword: 'M3 21l5-5m-3-3 6 6m-4-4L17 3h4v4L9 17',
  heart: 'M12 21 4 13a5 5 0 0 1 8-6 5 5 0 0 1 8 6Z',
  barrier: 'M12 3 20 6v5c0 5-4 8-8 10-4-2-8-5-8-10V6Zm-3 9h6m-3-3v6',
  guard: 'M12 3 20 6v5c0 5-4 8-8 10-4-2-8-5-8-10V6Zm-3 9h6',
  lightning: 'M13 2 4 14h7l-1 8 10-12h-7Z',
  target: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 2v4m0 12v4M2 12h4m12 0h4',
  burst: 'M12 2l2.5 6.5L21 6l-2.5 6.5L22 17l-7-1-3 6-3-6-7 1 3.5-4.5L3 6l6.5 2.5Z',
  combo: 'M3 21 17 7m-7 1 4 4m-9 2 4 4M9 21 21 9m-8-1 6-5h2v2',
  streak: 'M3 18l5-7 4 4 8-10m-6 0h6v6M3 11l3-4',
  lifesteal: 'M12 2c2 5 7 8 7 13a7 7 0 1 1-14 0c0-5 5-8 7-13Zm-3 13h6m-3-3v6',
  lowHealth: 'M12 21 4 13a5 5 0 0 1 8-6 5 5 0 0 1 8 6ZM9 12h6',
  reflect: 'M4 17h11a5 5 0 0 0 0-10h-5m4-4-4 4 4 4',
  limit: 'M12 3 20 6v5c0 5-4 8-8 10-4-2-8-5-8-10V6Zm-4 7h8m-4 0v6',
  survive: 'M12 21 4 13a5 5 0 0 1 8-6 5 5 0 0 1 8 6Zm-3-9h6m-3-3v6'
};
const ATTRIBUTE_ICONS = {
  attack: 'sword',
  maxHp: 'heart',
  equip_true_damage_flat: 'lightning',
  equip_on_correct_shield_flat: 'barrier',
  equip_shield_flat: 'barrier',
  equip_damage_reduction_flat: 'guard',
  equip_first_hit_reduction_percent: 'guard',
  equip_damage_reduction_percent: 'guard',
  equip_low_hp_reduction_percent: 'guard',
  equip_crit_chance: 'target',
  equip_crit_damage_percent: 'burst',
  equip_combo_chance: 'combo',
  equip_combo_damage_percent: 'combo',
  equip_damage_percent: 'sword',
  equip_streak_damage_percent: 'streak',
  equip_lifesteal_percent: 'lifesteal',
  equip_low_hp_damage_percent: 'lowHealth',
  equip_reflect_percent: 'reflect',
  equip_damage_cap_percent: 'limit',
  equip_cheat_death: 'survive'
};
const detail = document.getElementById('cultivation-node-panel-template').content.firstElementChild;
const nodeTitle = detail.querySelector('#cultivation-node-title');
const nodeRank = detail.querySelector('[data-node-rank]');
const nodeBody = detail.querySelector('[data-node-detail]');
const nodeFooter = detail.querySelector('.ns-detail-footer');
const nodePoints = detail.querySelector('[data-node-points]');
const message = detail.querySelector('[data-node-message]');
const learnButton = detail.querySelector('[data-learn-path-node]');
const closeButton = detail.querySelector('[data-close-path-node]');
const sheetLayout = matchMedia('(orientation: portrait), (max-height: 600px)');
const landscapeLayout = matchMedia('(orientation: landscape)');
const linkObserver = new ResizeObserver(([{ target }]) => {
  if (target.isConnected) drawLinks(target);
  else linkObserver.disconnect();
});
let selectedNode = '';
let learning = false;
let syncing = false;
let syncError = false;

const STATUS_TEXT = {
  learned: '已研修', ready: '可研修', realm: '境界未達', prerequisite: '前置未修',
  lane: '需修成一脈', points: '研修點不足'
};
const amount = value => Rules.number(value).toLocaleString('zh-TW');

function activeTab() {
  const tab = document.querySelector(TAB);
  const page = tab?.closest('#page-training');
  return tab?.classList.contains('active') && !tab.disabled && page.classList.contains('active-page') &&
    page.dataset.trainingPlace === 'meditation';
}

const detailNavigation = new MutationObserver(() => {
  if (!activeTab() || !document.querySelector('#training-tab-content .path-tree-workspace')) closeNode(false);
});

function selectedButton() {
  return document.querySelector(`#training-tab-content [data-cultivation-node="${CSS.escape(selectedNode)}"]`);
}

function positionNodeDetail() {
  if (!selectedNode || !activeTab()) return;
  const workspace = document.querySelector('#training-tab-content .path-tree-workspace');
  if (!workspace) return;
  const sheet = sheetLayout.matches;
  workspace.classList.toggle('has-detail', !sheet);
  detail.toggleAttribute('data-ns-portrait-sheet', sheet);
  const parent = sheet ? document.body : workspace;
  if (detail.parentElement !== parent) {
    const focused = detail.contains(document.activeElement) ? document.activeElement : null;
    parent.append(detail);
    focused?.focus({ preventScroll: true });
  }
}

function attributeIcons(bonuses) {
  const icons = new Set(Object.entries(bonuses).filter(([, value]) => value > 0)
    .map(([attribute]) => ATTRIBUTE_ICONS[attribute]).filter(Boolean));
  return [...icons].map(icon => `<svg class="path-tree-icon" viewBox="0 0 24 24"><path d="${NODE_ICONS[icon]}"/></svg>`).join('');
}

function nodeMarkup(node, status, caption = STATUS_TEXT[status]) {
  const isSeal = node.slot === 'seal';
  return `<button type="button" class="path-tree-node" data-cultivation-node="${node.id}" data-slot="${node.slot}"
      data-node-state="${status}" aria-haspopup="dialog" aria-controls="cultivation-node-dialog" aria-expanded="${node.id === selectedNode}">
        <span class="path-tree-orb" aria-hidden="true">
          <svg class="ns-orb-ring" viewBox="0 0 100 100">
            <circle class="ns-orb-track" cx="50" cy="50" r="45"/>
            <circle class="ns-orb-progress" cx="50" cy="50" r="45"/>
          </svg>
          <span class="ns-orb-surface">${attributeIcons(node.bonuses)}</span>
        </span>
        <span class="path-tree-node-name">${node.name}</span>
        <span class="path-tree-node-state">${isSeal ? '大節點 · ' : ''}${caption}</span>
      </button>`;
}

function chapterMarkup(chapter, score, learned, route) {
  const progress = Nodes.chapterProgress(chapter, score, learned);
  const origin = chapter.index === 0 ? nodeMarkup({ ...ORIGIN,
    bonuses: { [route.effect]: route.base }
  }, 'learned', '已啟用') : '';
  const nodes = chapter.nodes.map(node => nodeMarkup(node, Nodes.nodeState(chapter, node, score, learned, progress))).join('');
  return `<section class="path-tree-chapter" data-cultivation-chapter="${chapter.id}" aria-label="${chapter.name}">
    <div class="path-tree-grid">${origin}${nodes}</div>
  </section>`;
}

function linkMarkup(chapters, learned) {
  let entry = ORIGIN.id;
  return chapters.map(({ nodes }) => {
    const [a1, a2, a3, b1, b2, b3, seal] = nodes.map(node => node.id);
    const links = [[entry, a1], [a1, a2], [a2, a3], [a3, seal],
      [entry, b1], [b1, b2], [b2, b3], [b3, seal]];
    entry = seal;
    return links.map(([from, to]) => {
      const completed = learned.has(to) && (from === ORIGIN.id || learned.has(from));
      return `<path data-from="${from}" data-to="${to}"${completed ? ' class="is-learned"' : ''}/>`;
    }).join('');
  }).join('');
}

function drawLinks(board) {
  const bounds = board.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const points = new Map([...board.querySelectorAll('[data-cultivation-node]')].map(button => {
    const orb = button.querySelector('.path-tree-orb').getBoundingClientRect();
    return [button.dataset.cultivationNode, { x: orb.left - bounds.left + orb.width / 2, y: orb.top - bounds.top + orb.height / 2 }];
  }));
  const horizontal = landscapeLayout.matches;
  for (const path of board.querySelectorAll('.path-tree-links path')) {
    const from = points.get(path.dataset.from), to = points.get(path.dataset.to);
    const middle = horizontal ? (from.x + to.x) / 2 : (from.y + to.y) / 2;
    const controls = horizontal ? `${middle} ${from.y} ${middle} ${to.y}` : `${from.x} ${middle} ${to.x} ${middle}`;
    path.setAttribute('d', `M ${from.x} ${from.y} C ${controls} ${to.x} ${to.y}`);
  }
}

function treeMarkup(state) {
  const route = Rules.ROUTES[state.route];
  const score = Rules.realmScore(state.peakScore, state);
  const learned = Nodes.learnedSet(state);
  const bonus = Rules.bonuses(state, window.getEquippedGoldenCoreState?.());
  const chapters = Nodes.tree(state.route);
  return `<section class="path-tree-page" style="--path-tone:${route.color}" aria-label="${route.name}研修">
    <header class="path-tree-heading">
      <p class="path-tree-perks"><span>攻擊 <strong>+${bonus.attack}</strong></span><span>生命上限 <strong>+${bonus.maxHp}</strong></span>
        <span>${bonus.skillText}</span></p>
      <button class="path-training-link" type="button" data-open-cultivation-path aria-haspopup="dialog"
        aria-controls="cultivation-path-dialog">${state.trial?.status === 'active' ? '接續天劫' : '金丹天劫'}</button>
    </header>
    ${syncError ? '<p class="path-tree-notice">研修紀錄暫時無法同步。<button type="button" data-path-tree-refresh>重新同步</button></p>' : ''}
    <div class="path-tree-workspace">
      <div class="path-tree-scroll" tabindex="0" role="region" aria-label="流派節點圖">
        <div class="path-tree-board">
          <svg class="path-tree-links" aria-hidden="true">${linkMarkup(chapters, learned)}</svg>
          ${chapters.map(chapter => chapterMarkup(chapter, score, learned, route)).join('')}
        </div>
      </div>
    </div>
  </section>`;
}

function render() {
  if (!activeTab()) return;
  const container = document.getElementById('training-tab-content');
  const { state } = cultivationView() || {};
  const oldScroll = container.querySelector('.path-tree-scroll');
  const offset = { left: oldScroll?.scrollLeft || 0, top: oldScroll?.scrollTop || 0 };
  const focused = detail.contains(document.activeElement) ? document.activeElement : null;
  linkObserver.disconnect();
  container.innerHTML = state?.route ? treeMarkup(state) : `<section class="path-tree-page path-tree-empty" aria-labelledby="path-choice-title">
    <h2 id="path-choice-title">選擇流派</h2>
    <p>劍修、體修、法修、悟道修</p>
    <button type="button" class="path-training-link" data-open-cultivation-path data-path-choose-on-page
      aria-haspopup="dialog" aria-controls="cultivation-path-dialog">查看流派</button>
  </section>`;
  if (selectedNode) {
    renderNode();
    positionNodeDetail();
    focused?.focus({ preventScroll: true });
  }
  container.querySelector('.path-tree-scroll')?.scrollTo(offset);
  const board = container.querySelector('.path-tree-board');
  if (board) {
    drawLinks(board);
    linkObserver.observe(board);
  }
}

async function sync() {
  if (syncing) return;
  syncing = true;
  const hadError = syncError;
  try {
    await cultivationRequest('sync');
    syncError = false;
  } catch (_) {
    syncError = true;
  } finally {
    syncing = false;
    if (syncError !== hadError) render();
  }
}

function selectTab(tab) {
  const page = tab.closest('#page-training');
  const content = document.getElementById('training-tab-content');
  const wasSelected = tab.classList.contains('active');
  const finish = !wasSelected ? window.beginSceneTransition?.(content, content, 'cloud', 'training-tab', true, -1) : null;
  page.querySelectorAll('[data-training-tab], #training-status-tab').forEach(button => {
    const selected = button === tab;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  render();
  finish?.();
  void sync();
}

function nodeMessage(status, chapter, node, progress) {
  if (status === 'learned') return '此節點的效果已永久生效。';
  if (status === 'realm') return chapter.id === 'core'
    ? '金丹境解鎖。待渡劫的角色可在本頁開啟金丹天劫。' : `達到 ${amount(chapter.need)} 修為可進入${chapter.name}階段。`;
  if (status === 'lane') return '請先修完本階段任一條路徑的三個小節點。';
  if (status === 'prerequisite') return node.slot.endsWith('1')
    ? '請先點亮前一境界的大節點。' : '請先研修同一脈的上一個節點。';
  if (status === 'points') return `下一點研修於 ${amount(progress.nextAt)} 修為取得。`;
  return '點亮此節點需 1 點研修。';
}

function bonusMarkup(lines) {
  return `<ul class="path-node-bonuses">${lines.map(line => `<li>${line}</li>`).join('')}</ul>`;
}

function renderNode() {
  const state = cultivationView()?.state;
  const route = Rules.ROUTES[state?.route];
  if (route && selectedNode === ORIGIN.id) {
    nodeTitle.textContent = ORIGIN.name;
    nodeRank.textContent = route.name;
    nodeBody.innerHTML = `${bonusMarkup([route.effectText(route.base)])}
      <p class="ns-detail-preview">此為流派的起始天賦；其餘基礎攻擊與生命加成已直接計入角色能力。</p>`;
    nodeFooter.hidden = true;
    return;
  }
  const target = Nodes.findNode(state?.route, selectedNode);
  if (!target) {
    if (selectedNode) closeNode(false);
    return;
  }
  const { chapter, node } = target;
  const score = Rules.realmScore(state.peakScore, state);
  const learned = Nodes.learnedSet(state);
  const progress = Nodes.chapterProgress(chapter, score, learned);
  const status = Nodes.nodeState(chapter, node, score, learned, progress);
  nodeTitle.textContent = node.name;
  nodeRank.textContent = `${route.name} · ${chapter.name}${node.slot === 'seal' ? ' · 大節點' : ''}`;
  const trait = node.trait ? '<p class="ns-detail-preview">專屬特性</p>' : '';
  const traitText = node.traitText ? `<p class="ns-detail-preview">${node.traitText}</p>` : '';
  nodeBody.innerHTML = `${trait}${bonusMarkup(Nodes.describe(node.bonuses))}${traitText}
    <p class="ns-detail-preview">${nodeMessage(status, chapter, node, progress)}</p>`;
  nodeFooter.hidden = false;
  nodePoints.textContent = `可用 ${progress.available} 點研修`;
  learnButton.disabled = learning || status !== 'ready';
  learnButton.textContent = learning ? '正在研修…' : status === 'ready' ? '研修此節點' : STATUS_TEXT[status];
}

function openNode(button) {
  if (!activeTab()) return;
  selectedButton()?.setAttribute('aria-expanded', 'false');
  selectedNode = button.dataset.cultivationNode;
  button.setAttribute('aria-expanded', 'true');
  message.textContent = '';
  renderNode();
  if (!selectedNode) return;
  positionNodeDetail();
  detailNavigation.observe(button.closest('#page-training'), { attributes: true, attributeFilter: ['class', 'data-training-place'] });
  detailNavigation.observe(document.querySelector(TAB), { attributes: true, attributeFilter: ['class', 'disabled'] });
  detailNavigation.observe(button.closest('#training-tab-content'), { childList: true });
  closeButton.focus({ preventScroll: true });
}

function closeNode(restoreFocus = true) {
  const button = selectedButton();
  selectedNode = '';
  detailNavigation.disconnect();
  document.querySelector('#training-tab-content .path-tree-workspace')?.classList.remove('has-detail');
  detail.remove();
  button?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) button?.focus({ preventScroll: true });
}

async function learnNode() {
  if (learning || !selectedNode || selectedNode === ORIGIN.id) return;
  const nodeId = selectedNode;
  learning = true;
  renderNode();
  message.textContent = '';
  try {
    await cultivationRequest('learn', { node: nodeId });
  } catch (error) {
    if (selectedNode === nodeId) message.textContent = error.status ? error.message : '研修暫時無法保存，請重試。';
    if (error.status === 409) await sync();
  } finally {
    learning = false;
    renderNode();
  }
}

document.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target || target.disabled) return;
  if (target.matches(TAB)) selectTab(target);
  else if (target.hasAttribute('data-open-cultivation-tree')) window.openTrainingPlace?.('meditation');
  else if (target.dataset.cultivationNode) openNode(target);
  else if (target.hasAttribute('data-path-tree-refresh')) void sync();
});
closeButton.addEventListener('click', () => closeNode());
learnButton.addEventListener('click', () => void learnNode());
sheetLayout.addEventListener('change', positionNodeDetail);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !selectedNode || event.defaultPrevented || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  closeNode();
});
window.addEventListener('xiuxian:cultivation-path-updated', () => {
  if (selectedNode && !cultivationView()) closeNode(false);
  render();
});
window.addEventListener('golden-core-equipped-changed', render);

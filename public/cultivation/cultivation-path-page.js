import { cultivationRequest, cultivationView } from './cultivation-reboot-client.js';

const Rules = globalThis.QACultivationRebootRules;
const Nodes = globalThis.QACultivationPathNodes;
const TAB = '#page-training [data-training-tab="path"]';
const detail = document.getElementById('cultivation-node-panel-template').content.firstElementChild;
const nodeTitle = detail.querySelector('#cultivation-node-title');
const nodeRank = detail.querySelector('[data-node-rank]');
const nodeBody = detail.querySelector('[data-node-detail]');
const nodePoints = detail.querySelector('[data-node-points]');
const message = detail.querySelector('[data-node-message]');
const learnButton = detail.querySelector('[data-learn-path-node]');
const closeButton = detail.querySelector('[data-close-path-node]');
const sheetLayout = matchMedia('(orientation: portrait), (max-height: 600px)');
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

function chapterMarkup(chapter, score, learned) {
  const progress = Nodes.chapterProgress(chapter, score, learned);
  const nodes = chapter.nodes.map(node => {
    const status = Nodes.nodeState(chapter, node, score, learned, progress);
    const isSeal = node.slot === 'seal';
    return `<button type="button" class="path-tree-node" data-cultivation-node="${node.id}" data-slot="${node.slot}"
      data-node-state="${status}" aria-haspopup="dialog" aria-controls="cultivation-node-dialog" aria-expanded="${node.id === selectedNode}">
        <span class="path-tree-orb" aria-hidden="true">
          <svg class="ns-orb-ring" viewBox="0 0 100 100">
            <circle class="ns-orb-track" cx="50" cy="50" r="45"/>
            <circle class="ns-orb-progress" cx="50" cy="50" r="45"/>
          </svg>
          <span class="ns-orb-surface"><i class="fa-solid ${isSeal ? 'fa-gem' : 'fa-circle-dot'}"></i></span>
        </span>
        <span class="path-tree-node-name">${node.name}</span>
        <span class="path-tree-node-state">${isSeal ? '大節點 · ' : ''}${STATUS_TEXT[status]}</span>
      </button>`;
  }).join('');
  return `<section class="path-tree-chapter" data-cultivation-chapter="${chapter.id}" aria-label="${chapter.name}">
    <div class="path-tree-grid">
      <span class="path-tree-lane" data-lane="a">${chapter.lanes[0]}</span>
      <span class="path-tree-lane" data-lane="b">${chapter.lanes[1]}</span>${nodes}
    </div>
  </section>`;
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
        <div class="path-tree-board">${chapters.map(chapter => chapterMarkup(chapter, score, learned)).join('')}</div>
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

function renderNode() {
  const state = cultivationView()?.state;
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
  const route = Rules.ROUTES[state.route];
  const track = node.slot === 'seal' ? '大節點' : chapter.lanes[node.slot.startsWith('a') ? 0 : 1];
  nodeTitle.textContent = node.name;
  nodeRank.textContent = `${route.name} · ${chapter.name} · ${track}`;
  nodeBody.innerHTML = `<ul class="path-node-bonuses">${Nodes.describe(node.bonuses).map(line => `<li>${line}</li>`).join('')}</ul>
    <p class="ns-detail-preview">${nodeMessage(status, chapter, node, progress)}</p>`;
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
  if (learning || !selectedNode) return;
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

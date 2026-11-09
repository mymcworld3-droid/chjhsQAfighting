import { cultivationRequest, cultivationView } from './cultivation-reboot-client.js';

const Rules = globalThis.QACultivationRebootRules;
const Nodes = globalThis.QACultivationPathNodes;
const TAB = '#page-training [data-training-tab="path"]';
const dialog = document.getElementById('cultivation-node-dialog');
const nodeDetail = dialog.querySelector('[data-node-detail]');
const message = dialog.querySelector('[data-node-message]');
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
  return tab?.classList.contains('active') && page.classList.contains('active-page') &&
    page.dataset.trainingPlace === 'meditation';
}

function chapterMarkup(chapter, score, learned) {
  const progress = Nodes.chapterProgress(chapter, score, learned);
  const nodes = chapter.nodes.map(node => {
    const status = Nodes.nodeState(chapter, node, score, learned, progress);
    return `<button type="button" class="path-tree-node" data-cultivation-node="${node.id}" data-slot="${node.slot}"
      data-node-state="${status}" aria-haspopup="dialog" aria-controls="cultivation-node-dialog">
        <span class="path-tree-node-name">${node.name}</span>
        <span class="path-tree-node-state">${node.slot === 'seal' ? '大節點 · ' : ''}${STATUS_TEXT[status]}</span>
      </button>`;
  }).join('');
  return `<section class="path-tree-chapter" data-cultivation-chapter="${chapter.id}" aria-label="${chapter.name}">
    <header><div><small>第 ${chapter.index + 1} 階</small><h3>${chapter.name}</h3></div>
      <div class="path-tree-progress"><b>${progress.spent}／${Nodes.NODES_PER_CHAPTER} 節點</b>
        <small>${score < chapter.need ? `需 ${amount(chapter.need)} 修為` : `可用 ${progress.available} 點研修`}</small></div>
    </header>
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
      <span class="path-seal" aria-hidden="true">${route.glyph}</span>
      <div class="path-tree-name"><small>流派研修</small><h2>${route.name}</h2></div>
      <p class="path-tree-perks"><span>攻擊 +${bonus.attack}</span><span>生命上限 +${bonus.maxHp}</span>
        <span>${bonus.skillText}</span></p>
      <button class="path-training-link" type="button" data-open-cultivation-path aria-haspopup="dialog"
        aria-controls="cultivation-path-dialog">${state.trial?.status === 'active' ? '接續天劫' : '金丹天劫'}</button>
    </header>
    <p class="path-tree-note">每個境界各有 7 點研修。修滿任一脈並點亮大節點，便可在境界達標後接續下一階。</p>
    ${syncError ? '<p class="path-tree-notice">研修紀錄暫時無法同步。<button type="button" data-path-tree-refresh>重新同步</button></p>' : ''}
    <nav class="path-tree-jumps" aria-label="前往境界節點">
      ${chapters.map(chapter => `<button type="button" data-path-tree-jump="${chapter.id}"
        class="${score >= chapter.need ? 'is-attained' : ''}">${chapter.name}</button>`).join('')}
    </nav>
    <div class="path-tree-scroll" tabindex="0" role="region" aria-label="流派節點圖">
      <div class="path-tree-board">${chapters.map(chapter => chapterMarkup(chapter, score, learned)).join('')}</div>
    </div>
  </section>`;
}

function render() {
  if (!activeTab()) return;
  const container = document.getElementById('training-tab-content');
  const { state } = cultivationView() || {};
  const oldScroll = container.querySelector('.path-tree-scroll');
  const offset = { left: oldScroll?.scrollLeft || 0, top: oldScroll?.scrollTop || 0 };
  container.innerHTML = state?.route ? treeMarkup(state) : `<section class="path-tree-page path-tree-empty">
    <div class="path-card"><small>問道宗 · 四脈傳承</small><h2>立下你的修行流派</h2>
      <p>劍修、體修、法修與悟道修各有一條從築基通往半仙的研修路。</p>
      <button type="button" class="path-training-link" data-open-cultivation-path data-path-choose-on-page
        aria-haspopup="dialog" aria-controls="cultivation-path-dialog">選擇流派</button></div>
  </section>`;
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
  return `本階段尚有 ${progress.available} 點研修。點亮此節點需 1 點。`;
}

function renderNode() {
  const state = cultivationView()?.state;
  const target = Nodes.findNode(state?.route, selectedNode);
  if (!target) return;
  const { chapter, node } = target;
  const score = Rules.realmScore(state.peakScore, state);
  const learned = Nodes.learnedSet(state);
  const progress = Nodes.chapterProgress(chapter, score, learned);
  const status = Nodes.nodeState(chapter, node, score, learned, progress);
  const route = Rules.ROUTES[state.route];
  const track = node.slot === 'seal' ? '大節點' : chapter.lanes[node.slot.startsWith('a') ? 0 : 1];
  dialog.style.setProperty('--path-tone', route.color);
  nodeDetail.innerHTML = `<section class="path-card path-node-card">
    <small>${route.name} · ${chapter.name} · ${track}</small><h3>${node.name}</h3>
    <ul>${Nodes.describe(node.bonuses).map(line => `<li>${line}</li>`).join('')}</ul>
    <p>${nodeMessage(status, chapter, node, progress)}</p>
    <button type="button" class="path-primary" data-learn-path-node ${learning || status !== 'ready' ? 'disabled' : ''}>
      ${learning ? '正在研修…' : status === 'ready' ? '研修此節點' : STATUS_TEXT[status]}</button>
  </section>`;
}

function openNode(id) {
  selectedNode = id;
  message.textContent = '';
  renderNode();
  if (!dialog.open) dialog.showModal();
}

async function learnNode() {
  if (learning || !selectedNode) return;
  learning = true;
  renderNode();
  message.textContent = '';
  try {
    await cultivationRequest('learn', { node: selectedNode });
  } catch (error) {
    message.textContent = error.status ? error.message : '研修暫時無法保存，請重試。';
    if (error.status === 409) await sync();
  } finally {
    learning = false;
    renderNode();
  }
}

function jumpToChapter(id) {
  const scroller = document.querySelector('#training-tab-content .path-tree-scroll');
  const chapter = [...scroller.querySelectorAll('[data-cultivation-chapter]')]
    .find(item => item.dataset.cultivationChapter === id);
  if (!chapter) return;
  const start = scroller.getBoundingClientRect(), end = chapter.getBoundingClientRect();
  const horizontal = matchMedia('(orientation: landscape)').matches;
  scroller.scrollTo(horizontal ? { left: scroller.scrollLeft + end.left - start.left } :
    { top: scroller.scrollTop + end.top - start.top });
}

document.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target || target.disabled) return;
  if (target.matches(TAB)) selectTab(target);
  else if (target.hasAttribute('data-open-cultivation-tree')) window.openTrainingPlace?.('meditation');
  else if (target.dataset.cultivationNode) openNode(target.dataset.cultivationNode);
  else if (target.dataset.pathTreeJump) jumpToChapter(target.dataset.pathTreeJump);
  else if (target.hasAttribute('data-path-tree-refresh')) void sync();
});
dialog.querySelector('[data-close-path-node]').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  if (event.target.closest('[data-learn-path-node]')) void learnNode();
});
dialog.addEventListener('close', () => {
  const node = [...document.querySelectorAll('[data-cultivation-node]')]
    .find(button => button.dataset.cultivationNode === selectedNode);
  node?.focus({ preventScroll: true });
});
window.addEventListener('xiuxian:cultivation-path-updated', () => {
  if (!cultivationView() && dialog.open) dialog.close();
  render();
  if (dialog.open) renderNode();
});
window.addEventListener('golden-core-equipped-changed', render);

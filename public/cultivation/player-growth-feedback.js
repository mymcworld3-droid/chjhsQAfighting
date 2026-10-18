import './player-growth-rules.js';
import './nascent-growth.js';
import './raid-difficulty.js';
import './combat-power.js';
import { ARTIFACT_CATALOG, getArtifactById } from './artifact-catalog.js';
import { getArtifactRecipe, getMaterialById } from './material-catalog.js';
import { getMainUser } from './data/project-repository.js';

const Rules = globalThis.QAPlayerGrowth, Growth = globalThis.QANascentGrowth;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => new Intl.NumberFormat('zh-TW', { maximumFractionDigits:2 }).format(value);
const preferences = new Map();
let owner = '', queued = false, popupTimer = null, goalTimer = null, dialog = null, dialogOpener = null;
let observedUid = '', observedStats = null;
const player = () => window.getCurrentUserData?.() || {};
const score = () => globalThis.QATrainingAccessRules?.score(player()) || 0;
const storageKey = uid => 'qa-player-goal-v1:' + uid;
function preference(uid) {
  if (!preferences.has(uid)) {
    let value = null;
    try { value = JSON.parse(localStorage.getItem(storageKey(uid)) || 'null'); } catch (_) {}
    preferences.set(uid, value);
  }
  return preferences.get(uid);
}
function recipes() {
  const uid = getMainUser()?.uid;
  return ARTIFACT_CATALOG.filter(item => Rules.canReadRecipe(player(), item, uid) && getArtifactRecipe(item.id).length);
}
function closeDialog() {
  dialog?.remove(); dialog = null;
  if (dialogOpener?.isConnected) dialogOpener.focus({ preventScroll:true });
  dialogOpener = null;
}
function track(goal) {
  const uid = getMainUser()?.uid;
  if (!uid || !goal || !['nascent','recipe'].includes(goal.type)) return;
  if (goal.type === 'recipe' && !recipes().some(item => item.id === goal.id)) return;
  if (goal.type === 'nascent' && (!Growth.branches(player().cultivationTraining?.equippedCore).some(branch => branch.id === goal.id) || score() < Growth.THRESHOLD)) return;
  const value = { type:goal.type, id:String(goal.id).slice(0,160) };
  if (goal.type === 'recipe') value.target = Rules.count(player().artifactSystem?.inventory?.[value.id]) + 1;
  preferences.set(uid, value);
  try { localStorage.setItem(storageKey(uid), JSON.stringify(value)); } catch (_) {}
  closeDialog(); render();
  window.showToast?.('已追蹤修行目標，宗門首頁可查看進度。');
}
window.trackCultivationGoal = track;

async function openTrainingTab(tab) {
  const uid = getMainUser()?.uid;
  await window.switchToPage?.('page-training');
  if (!uid || uid !== getMainUser()?.uid || !document.getElementById('page-training')?.classList.contains('active-page')) return false;
  const button = document.querySelector(`#page-training [data-training-tab="${tab}"]`);
  if (!button || button.disabled) return false;
  button.click(); return true;
}
async function openRecipe(id) {
  if (await openTrainingTab('refinery')) window.openCultivationRecipe?.(id);
}
function acquire(row) {
  if (row.type === 'artifact') {
    const item = getArtifactById(row.id);
    if (Rules.canReadRecipe(player(), item, getMainUser()?.uid) && getArtifactRecipe(row.id).length) void openRecipe(row.id);
    else window.openPlayerMarketplace?.('all');
  } else if (row.id === 'forge-fragments') window.openInventoryDismantle?.();
  else {
    const source = Rules.materialSource(row.id, globalThis.QARaidDifficulty.TIERS, score());
    window.openRaidHub?.({ difficulty:source.difficulty });
  }
}
function goalModel() {
  const data = player(), core = data.cultivationTraining?.equippedCore;
  const selected = preference(getMainUser()?.uid);
  const branches = core && score() >= Growth.THRESHOLD ? Growth.branches(core) : [];
  const branch = selected?.type === 'nascent' ? branches.find(item => item.id === selected.id)
    : !selected ? branches.find(item => Growth.status(data,item.id).level < Growth.CAP) : null;
  if (branch) {
    const state = Growth.status(data, branch.id), missing = Math.max(0,state.cost - state.fragments);
    return { type:'nascent', id:branch.id, title:'元嬰 · ' + branch.name,
      detail:state.level >= Growth.CAP ? '此分支已圓滿，可選擇下一個目標' : `第 ${state.level} 級 → 第 ${state.level + 1} 級`,
      progress:state.level >= Growth.CAP ? '已圓滿' : `元嬰碎精 ${number(state.fragments)} / ${state.cost} · ${missing ? '還差 ' + missing : '已足夠'}`,
      action:state.level >= Growth.CAP ? '更換目標' : missing ? '獲取碎精' : '前往升級',
      run:() => state.level >= Growth.CAP ? chooseGoal() : missing ? window.openRaidHub?.() : openTrainingTab('nascent-soul') };
  }
  const item = selected?.type === 'recipe' ? recipes().find(entry => entry.id === selected.id) : null;
  if (item) {
    const owned = Rules.count(data.artifactSystem?.inventory?.[item.id]);
    if (Number.isFinite(selected.target) && owned >= selected.target) return {type:'recipe',id:item.id,title:'已取得 · ' + item.name,
      detail:'想要的法器已收入背包，這個目標完成了。',progress:'目標完成',action:'選擇下一個目標',run:chooseGoal};
    const currentJob = window.getCultivationRefineryJob?.();
    if (currentJob?.knownArtifactId === item.id) {
      const ready = Date.now() >= Number(currentJob.readyAtMs);
      return {type:'recipe',id:item.id,title:'煉製 · ' + item.name,detail:ready ? '法器已煉成，前往開爐收入背包。' : '材料已投入八方陣，正在煉製。',
        progress:ready ? '可以開爐' : '煉製進行中',action:ready ? '前往開爐' : '查看煉製',run:() => openRecipe(item.id),timerAt:ready ? 0 : Number(currentJob.readyAtMs)};
    }
    const rows = Rules.ingredients(data, getArtifactRecipe(item.id), {getMaterial:getMaterialById,getArtifact:getArtifactById});
    const tokens = rows.flatMap(row => Array(Math.min(8,row.need)).fill(row.token));
    const plan = tokens.length <= 8 ? window.getCultivationRefineryPlan?.(tokens, item.id, item.forgeMethod || '自由發揮') : null;
    if (plan?.keyRequirement?.quantity) {
      const key = plan.keyRequirement;
      rows.push(...Rules.ingredients(data, [{materialId:key.materialId,quantity:key.quantity}], {getMaterial:getMaterialById}));
    }
    if (Number(plan?.fragments) > 0) {
      const need = Rules.count(plan.fragments), have = Rules.count(data.forgeFragments);
      rows.push({type:'material',id:'forge-fragments',name:'煉器碎片',need,have,missing:Math.max(0,need-have)});
    }
    const missing = rows.filter(row => row.missing), job = window.getCultivationRefineryJob?.();
    return { type:'recipe', id:item.id, title:'煉製 · ' + item.name, rows,
      detail:job ? '目前有法寶正在煉製，仍可繼續收集材料' : '已學會配方 · 追蹤可投入的材料',
      progress:plan?.valid === false ? plan.reason : missing.length ? `還缺 ${missing.length} 種資源` : '資源齊備 · 前往確認煉製',
      action:plan?.valid === false ? '查看配方' : missing.length ? '前往取得' : '前往煉製',
      run:() => plan?.valid === false ? openRecipe(item.id) : missing.length ? acquire(missing[0]) : openRecipe(item.id) };
  }
  return { title:selected ? '目標目前無法使用' : '下一步，想讓自己如何成長？',
    detail:selected ? '配方權限或金丹已變更，請重新選擇目標。' : '追蹤元嬰分支或已學會的法器配方',
    progress:'選一個想完成的目標', action:'選擇目標', run:chooseGoal };
}
function learningMarkup() {
  const concepts = Object.values(player().stats?.soloLearningV1?.concepts || {}).filter(item => item?.corrected > 0).slice(-5).reverse();
  if (!concepts.length) return '';
  return `<details class="growth-learning"><summary>我的訂正進步 <span>${concepts.length} 個近期概念</span></summary><ul>${concepts.map(item =>
    `<li><span>${esc(item.subject)} · ${esc(item.topic)}</span><b>訂正成功 ${Rules.count(item.corrected)} 次</b></li>`).join('')}</ul><button type="button" data-growth-trial>挑戰悟道試煉</button></details>`;
}
function render() {
  const home = document.getElementById('page-home');
  if (!home) return;
  const uid = getMainUser()?.uid || '';
  if (owner !== uid) {
    owner = uid; closeDialog(); document.getElementById('growth-comparison')?.remove();
    document.getElementById('correction-growth-feedback')?.remove();
    const old = document.getElementById('player-growth-goal');
    if (old) delete old.dataset.markup;
  }
  let slot = document.getElementById('player-growth-goal');
  if (!slot) {
    slot = document.createElement('section'); slot.id = 'player-growth-goal'; slot.className = 'growth-goal';
    slot.setAttribute('aria-label','我的修行目標');
    const anchor = document.getElementById('quest-spotlight-slot');
    if (anchor) anchor.before(slot); else home.appendChild(slot);
  }
  slot.hidden = !uid || (!!player().uid && player().uid !== uid);
  if (slot.hidden) { slot.replaceChildren(); return; }
  const openLearning = slot.querySelector('.growth-learning')?.open;
  const goal = goalModel();
  clearTimeout(goalTimer);
  if (Number.isFinite(goal.timerAt) && goal.timerAt > Date.now()) goalTimer = setTimeout(schedule,Math.min(2147483647,goal.timerAt - Date.now() + 50));
  const markup = `<div class="growth-goal-heading"><small>我的修行目標</small><button type="button" data-growth-choose>更換目標</button></div>
    <h3>${esc(goal.title)}</h3><p>${esc(goal.detail)}</p>
    ${goal.rows ? `<ul class="growth-resources">${goal.rows.map((row,index) => `<li><span>${esc(row.name)}</span><b>${number(row.have)} / ${row.need}</b>${row.missing ? `<button type="button" data-growth-resource="${index}">缺 ${row.missing} · 取得</button>` : '<small>已備齊</small>'}</li>`).join('')}</ul>` : ''}
    <div class="growth-goal-footer"><strong>${esc(goal.progress)}</strong><button type="button" data-growth-go>${esc(goal.action)} →</button></div>${learningMarkup()}`;
  // Keep focus and open learning details when repeated balance events carry no changes.
  if (slot.dataset.markup === markup) return;
  slot.dataset.markup = markup; slot.innerHTML = markup;
  if (openLearning && slot.querySelector('.growth-learning')) slot.querySelector('.growth-learning').open = true;
  slot.querySelector('[data-growth-choose]').onclick = chooseGoal;
  slot.querySelector('[data-growth-go]').onclick = () => void goal.run();
  slot.querySelectorAll('[data-growth-resource]').forEach(button => button.onclick = () => acquire(goal.rows[Number(button.dataset.growthResource)]));
  slot.querySelector('[data-growth-trial]')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('xiuxian:enlightenment-open')));
}
function chooseGoal() {
  closeDialog(); dialogOpener = document.activeElement;
  const core = player().cultivationTraining?.equippedCore;
  const branches = core && score() >= Growth.THRESHOLD ? Growth.branches(core) : [];
  dialog = document.createElement('dialog'); dialog.className = 'growth-picker';
  dialog.setAttribute('aria-labelledby','growth-picker-title');
  dialog.innerHTML = `<header><h2 id="growth-picker-title">想完成哪個目標？</h2><button type="button" data-close aria-label="關閉目標選擇">×</button></header>
    <div class="growth-picker-body"><h3>元嬰分支</h3>${branches.length ? branches.map(branch => {
      const state = Growth.status(player(),branch.id);
      return `<button type="button" data-goal-type="nascent" data-goal-id="${esc(branch.id)}"><span>${esc(branch.name)}</span><small>${state.level} / ${Growth.CAP} 級${state.level < Growth.CAP ? ' · 下級需 ' + state.cost + ' 碎精' : ' · 已圓滿'}</small></button>`;
    }).join('') : '<p>凝成元嬰並調御金丹後，可追蹤分支。</p>'}
    <h3>已學會的法器配方</h3>${score() < 10 ? '<p>築基後開啟煉器目標。</p>' : recipes().map(item => `<button type="button" data-goal-type="recipe" data-goal-id="${esc(item.id)}"><span>${esc(item.name)}</span><small>${esc(item.realm)}</small></button>`).join('') || '<p>取得製作指南後，可追蹤配方材料。</p>'}</div>`;
  dialog.querySelector('[data-close]').onclick = closeDialog;
  dialog.querySelectorAll('[data-goal-type]').forEach(button => button.onclick = () => track({type:button.dataset.goalType,id:button.dataset.goalId}));
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
  document.body.appendChild(dialog); dialog.showModal();
}
function capture() {
  const live = window.getCombatStats?.() || {}, battle = window.getArtifactBattleSnapshot?.() || {effects:[]};
  const stats = { attack:{label:'攻擊力',value:live.attack || 0,unit:''}, maxHp:{label:'生命上限',value:live.maxHp || 0,unit:''} };
  const power = window.getCombatPower?.()?.total;
  if (Number.isFinite(power)) stats.combatPower = {label:'戰力',value:power,unit:''};
  for (const stat of window.getCultivationStatusStats?.({...live,nascentSoul:window.getNascentSoulBattleSnapshot?.()},battle) || []) {
    if (['hp','attack'].includes(stat.key)) continue;
    stats[stat.key] = {label:stat.label,value:stat.sortValue,unit:stat.value.endsWith('%') ? '%' : '',note:stat.note || ''};
  }
  for (const [type,label] of [['equip_cheat_death','每場免死'],['equip_copy_enemy_artifact','複製敵方法寶']]) {
    stats[type] = {label,value:battle.effects.some(effect => effect.type === type) ? 1 : 0,unit:'次'};
  }
  return stats;
}
window.captureGrowthSnapshot = capture;
function animateComparison(popup, changes) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const values = [...popup.querySelectorAll('[data-growth-value]')];
  if (!values.length) return;
  const startedAt = performance.now(), duration = 900;
  function tick(now) {
    if (!popup.isConnected) return;
    const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
    const eased = 1 - Math.pow(1 - progress, 3);
    for (const node of values) {
      const row = changes[Number(node.dataset.growthValue)];
      const from = row.before.value, to = row.after.value;
      const current = progress === 1 ? to : from + (to - from) * eased;
      node.textContent = number(Number.isInteger(from) && Number.isInteger(to) ? Math.round(current) : Math.round(current * 100) / 100) + (row.after.unit || '');
    }
    if (progress < 1) requestAnimationFrame(tick);
  }
  tick(startedAt);
}
window.showGrowthComparison = ({uid,before,after,extra=[]}) => {
  if (!uid || uid !== getMainUser()?.uid) return;
  observedUid = uid; observedStats = after;
  const changes = [...Rules.statChanges(before,after), ...extra.filter(row => row.before?.value !== row.after?.value)];
  changes.sort((a,b) => Number(b.key === 'combatPower') - Number(a.key === 'combatPower'));
  if (!changes.length) return;
  document.getElementById('growth-comparison')?.remove(); clearTimeout(popupTimer);
  const popup = document.createElement('aside'); popup.id = 'growth-comparison'; popup.className = 'growth-comparison';
  popup.setAttribute('role','status'); popup.setAttribute('aria-live','polite');
  const value = stat => stat ? number(stat.value) + (stat.unit || '') : '未生效';
  popup.innerHTML = `<button class="growth-comparison-close" type="button" aria-label="關閉能力比較">×</button><div class="growth-change-list">${changes.map((row,index) => {
    const delta = Number.isFinite(row.before?.value) && Number.isFinite(row.after?.value) ? Math.round((row.after.value - row.before.value)*100)/100 : null;
    const deltaText = delta === null ? '' : (delta > 0 ? '+' : '') + number(delta) + (row.after?.unit || row.before?.unit || '');
    return `<div class="growth-change${row.key === 'combatPower' ? ' growth-power-change' : ''}"><span>${esc(row.label)}</span><b aria-label="${esc(value(row.before) + ' → ' + value(row.after) + (deltaText ? '（' + deltaText + '）' : ''))}"><span aria-hidden="true">${esc(value(row.before))} <i class="growth-change-arrow">→</i> <span class="growth-animated-value"${delta !== null ? ` data-growth-value="${index}"` : ''}>${esc(value(row.after))}</span>${delta !== null ? `<small class="growth-delta ${delta < 0 ? 'growth-decrease' : 'growth-increase'}">${esc(deltaText)}</small>` : ''}</span></b></div>`;
  }).join('')}</div>`;
  popup.querySelector('button').onclick = () => popup.remove(); document.body.appendChild(popup);
  animateComparison(popup,changes);
  popupTimer = setTimeout(() => { if (!popup.contains(document.activeElement) && !popup.matches(':hover')) popup.remove(); }, 15000);
};
function showCorrection(event) {
  const detail = event.detail;
  if (!detail || detail.uid !== getMainUser()?.uid) return;
  const host = document.getElementById('feedback-section');
  if (!host || host.classList.contains('hidden')) return;
  document.getElementById('correction-growth-feedback')?.remove();
  const card = document.createElement('section'); card.id = 'correction-growth-feedback'; card.className = 'growth-correction';
  card.setAttribute('role','status');
  card.innerHTML = `<small>從不會，到解開</small><h3>同概念訂正成功</h3><p>${esc(detail.subject)} · ${esc(detail.topic)}</p>
    <strong>這個概念已成功訂正 ${Rules.count(detail.corrected)} 次</strong><p>這次已解開同概念的新情境，接著可用五題試煉檢驗理解。</p><button type="button">挑戰悟道試煉</button>`;
  card.querySelector('button').onclick = () => window.dispatchEvent(new CustomEvent('xiuxian:enlightenment-open',{detail:{subject:detail.subject,topic:detail.topic}}));
  host.appendChild(card); schedule();
}
function observePower() {
  const uid = getMainUser()?.uid || '';
  if (!uid || (player().uid && player().uid !== uid)) { observedUid = ''; observedStats = null; return; }
  const after = capture(), before = observedUid === uid ? observedStats : null;
  observedUid = uid; observedStats = after;
  if (before?.combatPower && after.combatPower && before.combatPower.value !== after.combatPower.value) {
    window.showGrowthComparison({uid,before,after});
  }
}
function resetObservation() { observedUid = ''; observedStats = null; schedule(); }
function schedule() { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; render(); observePower(); }); } }
function boot() {
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = 'styles/player-growth.css'; document.head.appendChild(style);
  for (const name of ['xiuxian:user-data-ready','xiuxian:user-ready','xiuxian:stats-updated','material-system-updated','artifact-system-updated','artifact-catalog-updated','artifact-recipes-updated','xiuxian:recipe-license-updated','golden-core-equipped-changed','xiuxian:refinery-job-updated','xiuxian:enlightenment-updated']) window.addEventListener(name,schedule);
  // Login and runtime hydration establish a baseline, rather than an upgrade.
  for (const name of ['xiuxian:user-data-ready','xiuxian:user-ready','golden-core-runtime-ready']) window.addEventListener(name,resetObservation);
  window.addEventListener('xiuxian:learning-progress',showCorrection); render(); observePower();
  const home = document.getElementById('page-home');
  if (home) new MutationObserver(schedule).observe(home,{attributes:true,attributeFilter:['class']});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();

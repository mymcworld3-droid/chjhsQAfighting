import './player-growth-rules.js';
import './combat-power.js';
import { getMainUser } from './data/project-repository.js';

const Rules = globalThis.QAPlayerGrowth;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => new Intl.NumberFormat('zh-TW', { maximumFractionDigits:2 }).format(value);
let owner = '', queued = false, popupTimer = null;
let observedUid = '', observedStats = null;
const player = () => window.getCurrentUserData?.() || {};
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
    owner = uid;
    document.getElementById('growth-comparison')?.remove();
    document.getElementById('correction-growth-feedback')?.remove();
    document.getElementById('player-learning-progress')?.remove();
  }
  const markup = uid && (!player().uid || player().uid === uid) ? learningMarkup() : '';
  let slot = document.getElementById('player-learning-progress');
  if (!markup) { slot?.remove(); return; }
  if (!slot) {
    slot = document.createElement('section'); slot.id = 'player-learning-progress'; slot.className = 'growth-learning-card';
    slot.setAttribute('aria-label','我的訂正進步');
    const anchor = document.getElementById('quest-spotlight-slot');
    if (anchor) anchor.after(slot); else home.appendChild(slot);
  }
  if (slot.dataset.markup === markup) return;
  const openLearning = slot.querySelector('.growth-learning')?.open;
  slot.dataset.markup = markup; slot.innerHTML = markup;
  if (openLearning) slot.querySelector('.growth-learning').open = true;
  slot.querySelector('[data-growth-trial]')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('xiuxian:enlightenment-open')));
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
  for (const name of ['xiuxian:user-data-ready','xiuxian:user-ready','xiuxian:stats-updated','artifact-system-updated','artifact-catalog-updated','golden-core-equipped-changed','xiuxian:enlightenment-updated']) window.addEventListener(name,schedule);
  // Login and runtime hydration establish a baseline, rather than an upgrade.
  for (const name of ['xiuxian:user-data-ready','xiuxian:user-ready','golden-core-runtime-ready']) window.addEventListener(name,resetObservation);
  window.addEventListener('xiuxian:learning-progress',showCorrection); render(); observePower();
  const home = document.getElementById('page-home');
  if (home) new MutationObserver(schedule).observe(home,{attributes:true,attributeFilter:['class']});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();

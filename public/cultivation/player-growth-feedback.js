import './player-growth-rules.js';
import { getMainUser } from './data/project-repository.js';

const Rules = globalThis.QAPlayerGrowth;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => new Intl.NumberFormat('zh-TW', { maximumFractionDigits:2 }).format(value);
let owner = '', queued = false;
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
// Legacy battle-stat change cards were removed. Keep the API inert so
// older, already-open flows cannot recreate the retired comparison popup.
function capture() {
  const live = window.getCombatStats?.() || {};
  return {
    attack: {label:'攻擊力',value:Number(live.attack)||0,unit:''},
    maxHp: {label:'生命上限',value:Number(live.maxHp)||0,unit:''}
  };
}
window.captureGrowthSnapshot = capture;
window.showGrowthComparison = () => { document.getElementById('growth-comparison')?.remove(); };
function animateComparison() {}
function observePower() { document.getElementById('growth-comparison')?.remove(); }
function resetObservation() { document.getElementById('growth-comparison')?.remove(); }
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
function schedule() { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; render(); }); } }
function boot() {
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = 'styles/player-growth.css'; document.head.appendChild(style);
  for (const name of ['xiuxian:user-data-ready','xiuxian:user-ready','xiuxian:stats-updated','xiuxian:enlightenment-updated']) window.addEventListener(name,schedule);
  window.addEventListener('xiuxian:learning-progress',showCorrection); render();
  // Clear any comparison card left behind by an older cached client.
  document.getElementById('growth-comparison')?.remove();
  const home = document.getElementById('page-home');
  if (home) new MutationObserver(schedule).observe(home,{attributes:true,attributeFilter:['class']});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();

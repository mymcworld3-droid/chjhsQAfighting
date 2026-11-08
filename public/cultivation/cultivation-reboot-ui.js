import { cultivationRequest, cultivationView } from './cultivation-reboot-client.js';

const Rules = globalThis.QACultivationRebootRules;
const { ROUTES, ACTIONS, TRIAL, GOLDEN_CORE, FOUNDATION, MAX_TRAINING } = Rules;
const dialog = document.getElementById('cultivation-path-dialog');
const content = dialog.querySelector('[data-path-content]');
const feedback = dialog.querySelector('[data-path-feedback]');
const homeEntry = document.getElementById('sect-cultivation-entry');
let selected = '';
let pending = false;
let session = 0;

const label = value => Rules.number(value).toLocaleString('zh-TW');
const disabled = value => value ? ' disabled' : '';

function chosenRoute(state) {
  const route = ROUTES[state.route];
  const core = window.getEquippedGoldenCoreState?.();
  const bonus = Rules.bonuses(state, core);
  const points = Rules.availablePoints(state);
  const tracks = ['foundation', 'technique'];
  const entries = tracks.map(track => {
    const rank = state.training[track];
    const next = Rules.bonuses({ ...state, training: { ...state.training, [track]: rank + 1 } }, core);
    const changes = [
      next.attack > bonus.attack ? `+${next.attack - bonus.attack} 攻擊` : '',
      next.maxHp > bonus.maxHp ? `+${next.maxHp - bonus.maxHp} 生命上限` : '',
      next.skillText !== bonus.skillText ? next.skillText : ''
    ].filter(Boolean);
    const preview = rank >= MAX_TRAINING ? '此方向已圓滿' : `下一重 · ${changes.join(' · ')}`;
    return `<button type="button" class="path-track" data-path-action="train" data-track="${track}"${disabled(!points || rank >= MAX_TRAINING)}>
      <span><strong>${route[track]}</strong><b>${rank}／${MAX_TRAINING} 重</b></span>
      <small>${preview}</small></button>`;
  }).join('');
  return `<section class="path-card path-practice" style="--path-tone:${route.color}" aria-label="流派養成">
    <div class="path-card-heading"><span class="path-seal" aria-hidden="true">${route.glyph}</span>
      <div><small>已立流派</small><h3>${route.name}</h3></div><span class="path-chip">${points} 點研修</span></div>
    <p>${route.practice}</p>
    <p class="path-note">${route.growth}</p>
    <dl class="path-bonuses">
      <div><dt>攻擊</dt><dd>+${bonus.attack}</dd></div>
      <div><dt>生命上限</dt><dd>+${bonus.maxHp}</dd></div>
      <div><dt>${route.skill}</dt><dd>${bonus.skillText}</dd></div>
    </dl>
    <div class="path-tracks">${entries}</div>
    <p class="path-note">築基獲得 1 點研修。歷史最高修為每再增加 12 點，再獲得 1 點，最多 12 點。兩條路線共用研修點。</p>
    <p class="path-note">渡劫後調御金丹，可共鳴並額外獲得「${bonus.resonanceText}」。</p>
  </section>`;
}

function selection(state) {
  const canChoose = state.peakScore >= FOUNDATION;
  const cards = Object.entries(ROUTES).map(([id, route]) => `
    <button type="button" class="path-route" data-path-action="pick" data-route="${id}"
      style="--path-tone:${route.color}" aria-pressed="${id === selected}">
      <span class="path-seal" aria-hidden="true">${route.glyph}</span>
      <span><strong>${route.name}</strong><small>${route.practice}</small></span>
    </button>`).join('');
  return `<section class="path-card" aria-label="選擇修行流派">
    <div class="path-card-heading"><div><small>四脈傳承</small><h3>擇一道而修</h3></div>
      <span class="path-chip">${canChoose ? '築基已成' : '築基初期開放'}</span></div>
    <div class="path-routes">${cards}</div>
    <p class="path-note">${canChoose ? '一經立誓，流派永久生效。' : `達到 ${FOUNDATION} 修為即可立誓。`}</p>
    <button type="button" class="path-primary" data-path-action="choose"${disabled(!canChoose || !selected)}>
      ${selected ? `立誓成為${ROUTES[selected].name}` : '先選擇流派'}</button>
  </section>`;
}

function activeTrial(state, route) {
  const trial = state.trial;
  const wave = Rules.waveFor(state.route, trial.round);
  const next = Rules.waveFor(state.route, trial.round + 1);
  const moves = Object.entries(ACTIONS).map(([key, action]) => {
    const outcome = Rules.playTurn(state.route, trial, key);
    const detail = outcome ? `破印 ${outcome.last.broken} · 心神 ${outcome.resolve} · 靈息 ${outcome.energy}` : '靈息不足';
    return `<button type="button" class="path-move" data-path-action="turn" data-move="${key}"${disabled(!outcome)}>
      <strong>${action.name}</strong><small>${action.description}</small><span>${detail}</span></button>`;
  }).join('');
  const last = trial.last;
  return `<section class="path-card path-trial" style="--path-tone:${route.color}" aria-label="天劫戰場">
    <div class="path-card-heading"><div><small>金丹天劫 · 第 ${trial.round + 1}／${route.waves.length} 重</small><h3>${route.trial}</h3></div></div>
    <dl class="path-bonuses path-resources">
      <div><dt>心神</dt><dd>${trial.resolve}／${TRIAL.resolve}</dd></div>
      <div><dt>靈息</dt><dd>${trial.energy}／${TRIAL.maxEnergy}</dd></div>
      <div><dt>劫印已破</dt><dd>${trial.seals}／${TRIAL.seals}</dd></div>
    </dl>
    <div class="path-omen"><span aria-hidden="true">雷</span><div><small>當前雷勢</small><strong>${wave.name}</strong>
      <p>劫傷 ${wave.damage} · 可用「${ACTIONS[wave.counter].name}」克制</p></div></div>
    <p class="path-note">${next ? `下一重「${next.name}」，可用「${ACTIONS[next.counter].name}」克制。` : '最後一重。'} ${route.rule}</p>
    ${last ? `<p class="path-note">上回合以「${ACTIONS[last.action].name}」${last.countered ? '克制雷勢，' : '應劫，'}擊碎 ${last.broken} 重劫印。</p>` : ''}
    <div class="path-moves">${moves}</div>
  </section>`;
}

function trialMarkup(state, score) {
  const route = ROUTES[state.route];
  const trial = state.trial;
  if (trial?.status === 'active') return activeTrial(state, route);
  const ready = Rules.canStart(score, state);
  const completed = !!state.seal;
  const status = completed ? '天劫已渡 · 丹成道印' :
    ready ? (state.legacyAccess ? '舊有境界已承認 · 可補渡天劫' : '修為已滿 · 待渡天劫') :
    score >= GOLDEN_CORE ? '立下流派即可引劫' : `尚需 ${label(GOLDEN_CORE - score)} 修為`;
  return `<section class="path-card path-trial ${completed ? 'path-trial-passed' : ''}" aria-label="境界突破">
    <div class="path-card-heading"><div><small>境界突破 · ${label(score)} 修為</small><h3>${route?.trial || '金丹天劫'}</h3></div>
      <span class="path-chip">${status}</span></div>
    ${completed
      ? `<p>道印已成，永久獲得 +${Rules.BREAKTHROUGH_ATTACK} 攻擊、+${Rules.BREAKTHROUGH_HP} 生命上限，調御金丹時可觸發流派共鳴。</p>`
      : `<p>保住心神並在五重雷勢中破除 ${TRIAL.seals} 重劫印。雷勢與下一重預兆都會在出招前顯示。</p>
        <p class="path-note">達到 ${GOLDEN_CORE} 修為可引劫。引劫、失敗或突破都會保留修為，滿溢修為可繼續累積。</p>
        ${trial?.status === 'failed' ? `<p class="path-result">此次劫關未破。已破 ${trial.seals}／${TRIAL.seals} 重劫印，可再試一次。</p>` : ''}
        <button type="button" class="path-primary" data-path-action="start"${disabled(!ready)}>${trial ? '再次引劫' : '引動天劫'}</button>`}
  </section>`;
}

function render() {
  const view = cultivationView();
  if (!view) return;
  const { state, score } = view;
  const playerScore = Rules.number(window.getCurrentUserData?.()?.stats?.totalScore);
  homeEntry.querySelector('.sect-action-dot').hidden = state.trial?.status !== 'active' &&
    !Rules.canStart(playerScore, state) &&
    !(playerScore >= GOLDEN_CORE && !state.legacyAccess && !state.route);
  if (!dialog.open) return;
  const active = document.activeElement;
  const focus = active?.dataset.pathAction;
  const key = active?.dataset.track || active?.dataset.route || active?.dataset.move;
  content.innerHTML = state.trial?.status === 'active' ? trialMarkup(state, score)
    : `${state.route ? chosenRoute(state) : selection(state)}${trialMarkup(state, score)}`;
  if (pending) content.querySelectorAll('button').forEach(button => { button.disabled = true; });
  if (focus) {
    const matching = [...content.querySelectorAll('button:not(:disabled)')].find(button =>
      button.dataset.pathAction === focus && (button.dataset.track || button.dataset.route || button.dataset.move) === key);
    (matching || dialog.querySelector('[data-path-close]')).focus({ preventScroll: true });
  }
}

async function run(action, body) {
  if (pending) return;
  const current = session;
  pending = true;
  feedback.textContent = '正在同步修行紀錄…';
  render();
  let error = '';
  try {
    await cultivationRequest(action, body);
  } catch (failure) {
    error = failure.status ? failure.message : '修行資料暫時無法同步，請重試。';
    if (action !== 'sync') {
      try { await cultivationRequest('sync'); } catch (_) {}
    }
  } finally {
    if (current === session) {
      pending = false;
      feedback.textContent = error;
      render();
    }
  }
}

function open() {
  if (dialog.open || !cultivationView()) return;
  selected = '';
  session += 1;
  pending = false;
  dialog.showModal();
  dialog.scrollTop = 0;
  void run('sync');
}

document.addEventListener('click', event => {
  if (event.target.closest('[data-open-cultivation-path]')) open();
});
dialog.querySelector('[data-path-close]').addEventListener('click', () => dialog.close());
content.addEventListener('click', event => {
  const button = event.target.closest('[data-path-action]');
  if (!button || pending || button.disabled) return;
  const action = button.dataset.pathAction;
  const trial = cultivationView()?.state.trial;
  if (action === 'pick') {
    selected = button.dataset.route;
    render();
  } else if (action === 'choose') void run('choose', { route: selected });
  else if (action === 'train') void run('train', { track: button.dataset.track });
  else if (action === 'turn') void run('turn', { attemptId: trial.id, round: trial.round, move: button.dataset.move });
  else void run(action);
});
window.addEventListener('xiuxian:cultivation-path-updated', () => {
  if (!cultivationView() && dialog.open) dialog.close();
  render();
});
window.addEventListener('xiuxian:stats-updated', () => {
  if (!dialog.open) render();
});
render();

// 悟道收益只做視覺呈現；實際修為仍由答題交易結算一次。
const SVG_NS = 'http://www.w3.org/2000/svg';
let activeFeedback = null;

const scoreValue = value => Math.max(0, Number(value) || 0);
const numberText = value => Number(value.toFixed(2)).toLocaleString('zh-TW');

export function cultivationOrbProfile(gain) {
  const strength = Math.log2(1 + scoreValue(gain));
  return {
    count: Math.max(1, Math.min(12, Math.ceil(scoreValue(gain)))),
    radius: 4.5 + Math.min(4, strength * .8),
    tail: .16 + Math.min(.16, strength * .025)
  };
}

export function cultivationProgress(score, realms, fixedIndex) {
  const value = scoreValue(score);
  let index = 0;
  realms.forEach((realm, i) => { if (value >= realm.need) index = i; });
  if (typeof window.limitImmortalRank === 'function') index = window.limitImmortalRank(index, value, realms);
  if (fixedIndex !== undefined) index = fixedIndex;
  const realm = realms[index] || { name: '修行', sub: '', need: 0 };
  // 半仙／真仙同門檻，不能把仙榜資格當成下一段數值進度。
  const next = realms.slice(index + 1).find(item => item.need > realm.need);
  const required = next ? next.need - realm.need : 0;
  const earned = next ? Math.min(required, Math.max(0, value - realm.need)) : Math.max(0, value - realm.need);
  return { index, realm, next, earned, required, ratio: next ? earned / required : 1 };
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function curvePoint(start, control, end, t) {
  const s = 1 - t;
  return { x: s * s * start.x + 2 * s * t * control.x + t * t * end.x,
    y: s * s * start.y + 2 * s * t * control.y + t * t * end.y };
}

window.isSoloCultivationFeedbackActive = () => !!activeFeedback;
window.waitForSoloCultivationFeedback = () => activeFeedback?.finished || Promise.resolve();

export function beginSoloCultivationFeedback({ scoreBefore, source, realms }) {
  activeFeedback?.cancel();
  const realmList = realms.map(realm => ({ ...realm }));
  const sourceRect = source?.getBoundingClientRect();
  const root = document.createElement('div');
  root.id = 'solo-cultivation-feedback';
  root.innerHTML = `
    <section class="solo-cultivation-panel" role="status" aria-live="polite" aria-atomic="true">
      <div class="solo-cultivation-heading"><span>悟道 · 修為入體</span><strong class="solo-cultivation-gain">靈氣匯聚…</strong></div>
      <div class="solo-cultivation-meta"><span class="solo-cultivation-realm"></span><span class="solo-cultivation-total"></span></div>
      <div class="solo-cultivation-track" role="progressbar" aria-label="境界修為進度" aria-valuemin="0" aria-valuemax="100">
        <div class="solo-cultivation-fill"></div><i class="solo-cultivation-receiver"></i>
      </div>
      <div class="solo-cultivation-caption"><span class="solo-cultivation-progress"></span><span class="solo-cultivation-next"></span></div>
    </section>`;
  const sky = svgElement('svg', { class: 'solo-cultivation-sky', 'aria-hidden': 'true' });
  root.appendChild(sky);
  document.body.appendChild(root);
  const panel = root.querySelector('.solo-cultivation-panel');
  const track = root.querySelector('.solo-cultivation-track');
  const fill = root.querySelector('.solo-cultivation-fill');
  const receiver = root.querySelector('.solo-cultivation-receiver');
  const gainLabel = root.querySelector('.solo-cultivation-gain');
  const nextButton = document.getElementById('btn-next-step');
  const wasDisabled = nextButton?.disabled;
  if (nextButton) nextButton.disabled = true;
  const quizPage = document.getElementById('page-quiz');
  const pageObserver = quizPage ? new MutationObserver(pageChanged) : null;
  pageObserver?.observe(quizPage, { attributes: true, attributeFilter: ['class'] });

  let resolveFinished, frame = 0, safetyTimer, playing = false, done = false;
  const waiting = new Set();
  const finished = new Promise(resolve => { resolveFinished = resolve; });

  function render(value, fixedIndex) {
    const progress = cultivationProgress(value, realmList, fixedIndex);
    root.querySelector('.solo-cultivation-realm').textContent = `${progress.realm.name} ${progress.realm.sub || ''}`;
    root.querySelector('.solo-cultivation-total').textContent = `修為 ${numberText(value)}`;
    root.querySelector('.solo-cultivation-progress').textContent = progress.next
      ? `${numberText(progress.earned)} / ${numberText(progress.required)}` : '修為持續累積';
    root.querySelector('.solo-cultivation-next').textContent = progress.next
      ? `下一境 · ${progress.next.name} ${progress.next.sub || ''}` : '仙途無盡';
    fill.style.width = `${progress.ratio * 100}%`;
    receiver.style.left = `${progress.ratio * 100}%`;
    track.setAttribute('aria-valuenow', Math.round(progress.ratio * 100));
    track.setAttribute('aria-valuetext', root.querySelector('.solo-cultivation-progress').textContent);
    return progress;
  }

  function finish() {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    clearTimeout(safetyTimer);
    pageObserver?.disconnect();
    waiting.forEach(resolve => resolve());
    waiting.clear();
    window.removeEventListener('xiuxian:page-changed', pageChanged);
    window.removeEventListener('xiuxian:user-data-ready', finish);
    document.removeEventListener('visibilitychange', visibilityChanged);
    root.remove();
    if (nextButton?.isConnected) nextButton.disabled = wasDisabled;
    if (activeFeedback === session) activeFeedback = null;
    resolveFinished();
    window.dispatchEvent(new CustomEvent('xiuxian:solo-cultivation-feedback-end'));
  }

  function wait(ms) {
    if (done) return Promise.resolve();
    return new Promise(resolve => {
      const release = () => { clearTimeout(timer); waiting.delete(release); resolve(); };
      const timer = setTimeout(release, ms);
      waiting.add(release);
    });
  }

  function pageChanged() {
    if (!document.getElementById('page-quiz')?.classList.contains('active-page')) finish();
  }
  function visibilityChanged() { if (document.visibilityState === 'hidden') finish(); }

  function fly(gain, fromScore, initialIndex) {
    const profile = cultivationOrbProfile(gain);
    const width = window.innerWidth, height = window.innerHeight;
    sky.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const start = { x: Math.max(20, Math.min(width - 20, sourceRect ? sourceRect.left + sourceRect.width * .7 : width * .5)),
      y: Math.max(20, Math.min(height - 24, sourceRect ? sourceRect.top + sourceRect.height / 2 : height * .55)) };
    const receiverRect = receiver.getBoundingClientRect();
    const destinationY = receiverRect.top + receiverRect.height / 2;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const defs = svgElement('defs');
    sky.appendChild(defs);
    const orbs = Array.from({ length: reduced ? 1 : profile.count }, (_, i) => {
      const gradient = svgElement('linearGradient', { id: `solo-comet-${i}`, gradientUnits: 'userSpaceOnUse' });
      gradient.append(svgElement('stop', { offset: '0%', 'stop-color': '#cc8e25', 'stop-opacity': '0' }),
        svgElement('stop', { offset: '100%', 'stop-color': '#ffe18a', 'stop-opacity': '.8' }));
      defs.appendChild(gradient);
      const trail = svgElement('polygon', { class: 'solo-cultivation-tail', fill: `url(#solo-comet-${i})` });
      const core = svgElement('polyline', { class: 'solo-cultivation-tail-core', 'stroke-width': profile.radius * .34 });
      const head = svgElement('circle', { class: 'solo-cultivation-orb', r: profile.radius });
      sky.append(trail, core, head);
      return { trail, core, head, gradient, absorbed: false, delay: reduced ? 0 : i * 48,
        control: { x: Math.max(16, Math.min(width - 16, start.x + (i % 2 ? 1 : -1) * (65 + i * 9))),
          y: start.y + (destinationY - start.y) * .45 } };
    });
    return new Promise(resolve => {
      let started;
      let absorbed = 0;
      const release = () => { waiting.delete(release); resolve(); };
      waiting.add(release);
      function tick(now) {
        if (done) return release();
        started ??= now;
        // 目的地以吸收點的當下位置計算，手機轉向／調整視窗時仍命中進度條。
        const target = receiver.getBoundingClientRect();
        const end = { x: target.left + target.width / 2, y: target.top + target.height / 2 };
        for (const orb of orbs) {
          if (orb.absorbed) continue;
          const elapsed = now - started - orb.delay - 110;
          if (elapsed < 0) { orb.head.style.opacity = '0'; continue; }
          const t = Math.min(1, elapsed / (reduced ? 160 : 680));
          const eased = 1 - (1 - t) ** 2;
          const point = curvePoint(start, orb.control, end, eased);
          orb.head.style.opacity = String(Math.min(1, t * 8));
          orb.head.setAttribute('cx', point.x); orb.head.setAttribute('cy', point.y);
          const points = Array.from({ length: 13 }, (_, i) =>
            curvePoint(start, orb.control, end, Math.max(0, eased - profile.tail * (1 - i / 12))));
          const sides = points.map((p, i) => {
            const neighbor = points[Math.min(i + 1, 12)];
            const previous = points[Math.max(0, i - 1)];
            const dx = neighbor.x - previous.x, dy = neighbor.y - previous.y;
            const length = Math.hypot(dx, dy) || 1;
            const size = profile.radius * (i / 12) ** 1.2;
            return [{ x: p.x - dy / length * size, y: p.y + dx / length * size },
              { x: p.x + dy / length * size, y: p.y - dx / length * size }];
          });
          const pointText = p => `${p.x},${p.y}`;
          orb.trail.setAttribute('points', [...sides.map(pair => pair[0]), ...sides.map(pair => pair[1]).reverse()].map(pointText).join(' '));
          orb.core.setAttribute('points', points.map(pointText).join(' '));
          for (const [key, value] of Object.entries({ x1: points[0].x, y1: points[0].y, x2: point.x, y2: point.y }))
            orb.gradient.setAttribute(key, value);
          if (reduced) { orb.trail.style.opacity = '0'; orb.core.style.opacity = '0'; }
          if (t === 1) {
            orb.absorbed = true; absorbed += 1;
            orb.head.remove(); orb.trail.remove(); orb.core.remove();
            const received = gain * absorbed / orbs.length;
            render(fromScore + received, initialIndex);
            gainLabel.textContent = `+${numberText(received)} 修為`;
            panel.classList.add('absorbing');
          }
        }
        if (absorbed === orbs.length) release();
        else frame = requestAnimationFrame(tick);
      }
      frame = requestAnimationFrame(tick);
    });
  }

  const session = { finished, cancel: finish, async play({ gain, totalScore }) {
    if (playing || done) return finished;
    playing = true;
    try {
      const amount = scoreValue(gain), finalScore = scoreValue(totalScore);
      if (!amount) return;
      const fromScore = Math.max(0, finalScore - amount);
      const initial = render(fromScore);
      gainLabel.textContent = `+${numberText(amount)} 修為`;
      await fly(amount, fromScore, initial.index);
      if (done) return;
      // 先完整呈現滿條，再顯示突破後帶入下一境的剩餘修為。
      await wait(260);
      if (done) return;
      const final = cultivationProgress(finalScore, realmList);
      if (final.index !== initial.index) { render(finalScore); await wait(280); }
      root.classList.add('leaving');
      await wait(180);
    } catch (error) {
      console.warn('[Solo cultivation feedback]', error);
    } finally { finish(); }
  } };
  activeFeedback = session;
  render(scoreValue(scoreBefore));
  root.classList.add('show');
  window.addEventListener('xiuxian:page-changed', pageChanged);
  window.addEventListener('xiuxian:user-data-ready', finish);
  document.addEventListener('visibilitychange', visibilityChanged);
  // 儲存服務若無回應，也不能永久鎖住下一題與突破提示。
  safetyTimer = setTimeout(finish, 12000);
  return session;
}

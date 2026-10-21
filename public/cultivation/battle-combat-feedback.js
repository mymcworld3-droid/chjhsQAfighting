// Visual feedback reads the settled hit; it never rolls probabilities or changes damage.
const CORE_VISUALS = Object.freeze({
  ocean: { name: '大海無垠丹', color: '#72ddff', shape: '<path d="M-65,-18 Q-42,-44 -20,-18 T25,-18 T70,-18 M-65,5 Q-42,-21 -20,5 T25,5 T70,5 M-65,28 Q-42,2 -20,28 T25,28 T70,28"/>' },
  sword: { name: '破鋒劍心丹', color: '#ffedb2', shape: '<path d="M0,57 V-62 L-7,-47 H7 L0,-62 M-18,32 H18 M-35,51 V-39 L-40,-28 H-30 L-35,-39 M35,51 V-39 L30,-28 H40 L35,-39 M-48,26 H-22 M22,26 H48"/>' },
  thunder: { name: '萬劫雷霆丹', color: '#c4a1ff', shape: '<path d="M20,-67 L-23,-9 H8 L-21,67 L39,-17 H7 Z M-42,-53 L-63,-16 H-43 L-58,30 M49,19 L66,45 H50 L62,66"/>' },
  taichu: { name: '太初回元丹', color: '#b6f2ac', shape: '<circle r="29"/><circle r="50"/><path d="M0,-68 V-38 M0,38 V68 M-68,0 H-38 M38,0 H68 M-48,-48 L-28,-28 M28,28 L48,48 M48,-48 L28,-28 M-28,28 L-48,48"/>' },
  ningxin: { name: '凝心靜音丹', color: '#b0e7e5', shape: '<path d="M0,-65 L48,-30 L38,33 L0,65 L-38,33 L-48,-30 Z M0,-38 L25,0 L0,38 L-25,0 Z"/><circle r="53"/>' },
  pojing: { name: '破境衝仙丹', color: '#ffb354', shape: '<path d="M-13,-53 A55,55 0 0 0 -53,14 M-44,34 A55,55 0 0 0 16,52 M36,43 A55,55 0 0 0 52,-17 M43,-35 A55,55 0 0 0 8,-54 M-20,-20 L-62,-62 M20,-20 L62,-62 M20,20 L62,62 M-20,20 L-62,62"/><path d="M0,-35 L27,0 L0,35 L-27,0 Z"/>' },
  xingchen: { name: '星辰吞月丹', color: '#c6b6ff', shape: '<path d="M0,-50 L12,-13 L50,0 L12,13 L0,50 L-12,13 L-50,0 L-12,-13 Z M-48,-63 L-43,-48 L-28,-43 L-43,-38 L-48,-23 L-53,-38 L-68,-43 L-53,-48 Z M48,30 L52,42 L64,46 L52,50 L48,62 L44,50 L32,46 L44,42 Z"/><ellipse rx="70" ry="24" transform="rotate(-30)"/>' },
  wugou: { name: '無垢清心丹', color: '#d5f4ff', shape: '<path d="M0,48 C-42,22 -38,-12 0,-59 C38,-12 42,22 0,48 Z M0,48 C-64,48 -65,5 -48,-22 C-17,-12 0,8 0,48 Z M0,48 C64,48 65,5 48,-22 C17,-12 0,8 0,48 Z"/><path d="M-62,57 Q0,74 62,57"/>' },
  reverse: { name: '陰陽反轉丹', color: '#e0ccff', shape: '<circle r="61"/><path d="M0,-61 C68,-61 68,0 0,0 C-68,0 -68,61 0,61"/><circle cy="-30" r="8"/><circle cy="30" r="8"/>' }
});

export function battleStepFeedback(step = {}, player = {}) {
  const missed = step.type === 'miss';
  const guarded = step.guarded === true;
  const counter = step.type === 'counter';
  const landed = (step.type === 'attack' || counter) && !guarded;
  // Compatibility for existing rooms; an explicit false wins over a legacy label.
  const critical = landed && !counter && (typeof step.critical === 'boolean'
    ? step.critical : /暴擊|爆擊/.test(String(step.skill || '')));
  const effectType = step.coreEffect?.type;
  const type = counter ? (effectType || (/雷光反擊/.test(step.skill || '') ? 'thunder' : ''))
    : player.goldenCore?.type;
  const core = landed && Object.hasOwn(CORE_VISUALS, type) ? { type, ...CORE_VISUALS[type] } : null;
  const enhanced = !!core && effectType === core.type;
  const damage = Math.max(0, Math.round(Number(step.damage) || 0));
  const label = missed ? '未命中' : guarded ? '護體' :
    (critical ? '爆擊 -' : counter ? '反擊 -' : step.combo ? '連擊 '+(step.comboIndex || 1)+' -' : '-') + damage;
  return { missed, guarded, counter, landed, critical, core, enhanced, damage, label };
}

export function createBattleImpact(stage, { step, player, fromMe, elapsedMs = 0 } = {}) {
  if (step?.starfallCount > 0) return createStarfallImpact(stage, {
    count: step.starfallCount, x: fromMe ? '72%' : '28%',
    y: fromMe ? '34%' : '65%', elapsedMs
  });
  const feedback = battleStepFeedback(step, player);
  if (!stage || !feedback.landed) return null;
  const impact = document.createElement('i');
  impact.className = 'bv2-stage-impact bv2-combat-impact ' + (fromMe ? 'from-me' : 'from-enemy') +
    (feedback.critical ? ' critical' : '') + (feedback.enhanced ? ' core-enhanced' : '');
  impact.setAttribute('aria-hidden', 'true');
  impact.style.animationDelay = '-' + Math.max(0, Number(elapsedMs) || 0) + 'ms';
  impact.style.setProperty('--impact-x', fromMe ? '72%' : '28%');
  impact.style.setProperty('--impact-y', fromMe ? '34%' : '65%');
  if (feedback.core) {
    impact.dataset.core = feedback.core.type;
    impact.style.setProperty('--core-color', feedback.core.color);
    const fx = document.createElement('span');
    fx.className = 'bv2-core-fx';
    // All markup comes from the fixed visual catalogue, never player input.
    fx.innerHTML = '<svg viewBox="-80 -80 160 160" focusable="false" aria-hidden="true">' + feedback.core.shape + '</svg>';
    const title = document.createElement('b');
    title.className = 'bv2-core-caption';
    title.textContent = feedback.enhanced ? (step.coreEffect.skill || feedback.core.name) : '丹氣 · ' + feedback.core.name;
    impact.appendChild(fx);
    impact.appendChild(title);
  }
  if (feedback.critical) {
    const burst = document.createElement('span');
    burst.className = 'bv2-critical-fx';
    for (let index = 0; index < 8; index++) {
      const ray = document.createElement('i');
      ray.style.setProperty('--ray-angle', index * 45 + 'deg');
      burst.appendChild(ray);
    }
    impact.appendChild(burst);
  }
  stage.appendChild(impact);
  return impact;
}

// One visual per settled correct answer. All delays use elapsed milliseconds;
// removing the parent cancels the entire effect when combat ends.
export function createStarfallImpact(stage, { count = 0, x = '50%', y = '40%', elapsedMs = 0 } = {}) {
  const total = Math.min(3, Math.max(0, Math.floor(Number(count) || 0)));
  if (!stage || !total) return null;
  const layer = document.createElement('div');
  layer.className = 'bv2-stage-impact qa-starfall-impact';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:absolute;inset:0;z-index:12;pointer-events:none;overflow:hidden;';
  const style = document.createElement('style');
  style.textContent = `
    .qa-starfall-meteor{position:absolute;width:100px;height:150px;margin:-130px 0 0 -65px;opacity:0;animation:qaStarfallDrop 400ms ease-in both}
    .qa-starfall-meteor svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 9px #c1a1ff)}
    .qa-starfall-ring{position:absolute;width:82px;height:36px;margin:-18px 0 0 -41px;border:3px solid #e1caff;border-radius:50%;opacity:0;box-shadow:0 0 18px #9a75ff;animation:qaStarfallRing 220ms ease-out both}
    .qa-starfall-caption{position:absolute;left:50%;top:10%;transform:translateX(-50%);color:#eee1ff;font:bold 18px sans-serif;text-shadow:0 0 12px #9762ef;white-space:nowrap}
    @keyframes qaStarfallDrop{0%{opacity:0;transform:translate(-110px,-190px) scale(.65)}20%{opacity:1}85%{opacity:1;transform:translate(0,0) scale(1)}100%{opacity:0;transform:translate(5px,8px) scale(1.15)}}
    @keyframes qaStarfallRing{0%{opacity:1;transform:scale(.3)}100%{opacity:0;transform:scale(1.7)}}
    @media(prefers-reduced-motion:reduce){.qa-starfall-meteor{animation-name:qaStarfallStill}.qa-starfall-ring{animation-name:qaStarfallStill}@keyframes qaStarfallStill{0%,80%{opacity:1}100%{opacity:0}}}
  `;
  layer.appendChild(style);
  for (let index = 0; index < total; index++) {
    const offset = (index - (total - 1) / 2) * 24;
    const meteor = document.createElement('span');
    meteor.className = 'qa-starfall-meteor';
    meteor.style.left = `calc(${x} + ${offset}px)`;
    meteor.style.top = y;
    meteor.style.animationDelay = (index * 110 - Math.max(0, Number(elapsedMs) || 0)) + 'ms';
    meteor.innerHTML = '<svg viewBox="0 0 100 150" focusable="false" aria-hidden="true"><path d="M5 0 L79 110 L60 123 Z" fill="#9870ed" opacity=".7"/><path d="M20 15 L88 118 L70 128 Z" fill="#e6caff"/><path d="M66 106 L85 109 L96 125 L84 142 L65 137 L57 121 Z" fill="#b997ff" stroke="#f3e5ff" stroke-width="3"/><path d="M71 113 L82 119 L77 132 L65 126 Z" fill="#fff4d9"/></svg>';
    layer.appendChild(meteor);
    const ring = document.createElement('span');
    ring.className = 'qa-starfall-ring';
    ring.style.left = meteor.style.left;
    ring.style.top = y;
    ring.style.animationDelay = (index * 110 + 320 - Math.max(0, Number(elapsedMs) || 0)) + 'ms';
    layer.appendChild(ring);
  }
  const caption = document.createElement('b');
  caption.className = 'qa-starfall-caption';
  caption.textContent = '元嬰・星隕 ×' + total;
  layer.appendChild(caption);
  stage.appendChild(layer);
  return layer;
}

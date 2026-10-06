import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const FIELD = 'storyProgressV1';
const LAYER_ID = 'xiuxian-opening-cinematic';
const STYLE_ID = 'xiuxian-opening-cinematic-style';
const ASSET_ROOT = 'assets/story/opening';
const FIRST_VIEW_MIN_MS = 2200;

const SCENES = Object.freeze([
  Object.freeze({
    image: `${ASSET_ROOT}/opening-1.png`,
    kicker: '天地 · 仙途',
    title: '這是一個修仙的世界',
    lines: [
      '在這片天地之中，凡人可修行，修行可問道，',
      '問道可證仙途。'
    ],
    duration: 7200,
    motion: 'push'
  }),
  Object.freeze({
    image: `${ASSET_ROOT}/opening-2.png`,
    kicker: '鬥法',
    title: '有人以鬥法',
    lines: ['證明自己的實力。'],
    duration: 5200,
    motion: 'drift-left'
  }),
  Object.freeze({
    image: `${ASSET_ROOT}/opening-3.png`,
    kicker: '金丹',
    title: '有人以金丹',
    lines: ['奠定大道根基。'],
    duration: 5200,
    motion: 'drift-right'
  }),
  Object.freeze({
    image: `${ASSET_ROOT}/opening-4.png`,
    kicker: '煉器',
    title: '有人以煉器',
    lines: ['鑄就神兵法寶。'],
    duration: 5200,
    motion: 'push'
  }),
  Object.freeze({
    image: `${ASSET_ROOT}/opening-5.png`,
    kicker: '洞天',
    title: '有人闖蕩洞天秘境',
    lines: ['尋求機緣造化。'],
    duration: 5600,
    motion: 'drift-left'
  }),
  Object.freeze({
    image: `${ASSET_ROOT}/opening-6.png`,
    kicker: '共伐強敵',
    title: '也有人與眾修士並肩而戰',
    lines: ['共伐強敵。'],
    duration: 5800,
    motion: 'drift-right'
  }),
  Object.freeze({
    image: `${ASSET_ROOT}/opening-7.png`,
    kicker: '仙途至高',
    title: '而修仙之路的至高點',
    lines: ['便是取得——', '五大道果之一。'],
    duration: 6500,
    motion: 'rise'
  }),
  Object.freeze({
    image: `${ASSET_ROOT}/opening-8.png`,
    kicker: '五大道果 · 真仙',
    title: '儒、法、算、玄、外',
    lines: [
      '五大道果，分別對應五大仙途。',
      '證得其中一道果，便可登臨真仙之境。'
    ],
    duration: 7600,
    motion: 'push'
  }),
  Object.freeze({
    image: `${ASSET_ROOT}/opening-9.png`,
    kicker: '你的仙途',
    title: '現在，屬於你的修仙之路',
    lines: ['才正要開始。', '而你，又會有什麼樣的故事呢？'],
    duration: 0,
    motion: 'rise',
    final: true
  })
]);

let active = false;
let replayMode = false;
let sceneIndex = 0;
let sceneStartedAt = 0;
let autoTimer = null;
let imagePreloadPromise = null;
let finishBusy = false;

function userData() {
  try { return window.getCurrentUserData?.() || null; } catch (_) { return null; }
}

function currentUser() {
  try { return getAuth(getApp()).currentUser; } catch (_) { return null; }
}

function required() {
  // 自動開場已由第一章「問道靈根」接手；九幕影片僅供玩家自行重播。
  return false;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function preloadImage(src, priority = 'auto') {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = priority;
    image.onload = () => resolve({ src, ok: true });
    image.onerror = () => resolve({ src, ok: false });
    image.src = src;
    if (image.complete && image.naturalWidth > 0) resolve({ src, ok: true });
  });
}

const warmedImages = new Set();
const warmFailures = new Set();

function warmImage(src, priority = 'auto') {
  if (!src || warmedImages.has(src)) return Promise.resolve({ src, ok: true, cached: true });
  warmedImages.add(src);
  return preloadImage(src, priority).then((result) => {
    if (!result.ok) warmFailures.add(src);
    window.__xiuxianOpeningImagePreloadFailures = [...warmFailures];
    if (!result.ok) console.warn('[Opening cinematic] image preload failed:', src);
    return result;
  });
}

function warmFollowingScenes(fromIndex) {
  const next = SCENES[fromIndex + 1];
  const afterNext = SCENES[fromIndex + 2];
  if (next) void warmImage(next.image, 'high');
  if (afterNext) {
    const run = () => void warmImage(afterNext.image, 'auto');
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 1800 });
    else setTimeout(run, 650);
  }
}

function preloadImages() {
  if (imagePreloadPromise) return imagePreloadPromise;
  SCENES.slice(0, 2).forEach((scene) => {
    if (document.head.querySelector(`link[rel="preload"][as="image"][href="${scene.image}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = scene.image;
    link.fetchPriority = 'high';
    document.head.appendChild(link);
  });
  imagePreloadPromise = Promise.all(
    SCENES.slice(0, 2).map((scene) => warmImage(scene.image, 'high'))
  ).then((results) => {
    // Remaining panels are warmed progressively while the player reads each scene.
    warmFollowingScenes(0);
    return results;
  });
  return imagePreloadPromise;
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    html.xiuxian-opening-lock,body.xiuxian-opening-lock{overflow:hidden!important;overscroll-behavior:none!important}
    #${LAYER_ID}{position:fixed;inset:0;z-index:30000;overflow:hidden;background:#020302;color:#f6edda;font-family:var(--xq-serif,'Noto Sans TC',sans-serif);isolation:isolate;touch-action:manipulation}
    #${LAYER_ID} .xoc-scene{position:absolute;inset:0;overflow:hidden;background:radial-gradient(circle at 50% 40%,#202017 0,#090b09 56%,#020302 100%)}
    #${LAYER_ID} .xoc-image{position:absolute;inset:-3%;width:106%;height:106%;object-fit:cover;object-position:center;will-change:transform,opacity;filter:saturate(.94) contrast(1.04) brightness(.84);opacity:0;animation:xoc-image-in .85s ease forwards,xoc-kenburns var(--xoc-duration,7s) cubic-bezier(.18,.58,.24,1) forwards}
    #${LAYER_ID} .xoc-image.xoc-missing{display:none}
    #${LAYER_ID} .xoc-scene[data-motion="drift-left"] .xoc-image{--xoc-from:scale(1.08) translate3d(2.5%,0,0);--xoc-to:scale(1.15) translate3d(-2%,0,0)}
    #${LAYER_ID} .xoc-scene[data-motion="drift-right"] .xoc-image{--xoc-from:scale(1.08) translate3d(-2.5%,0,0);--xoc-to:scale(1.15) translate3d(2%,0,0)}
    #${LAYER_ID} .xoc-scene[data-motion="rise"] .xoc-image{--xoc-from:scale(1.10) translate3d(0,2%,0);--xoc-to:scale(1.16) translate3d(0,-2.5%,0)}
    #${LAYER_ID} .xoc-scene[data-motion="push"] .xoc-image{--xoc-from:scale(1.03);--xoc-to:scale(1.13)}
    @keyframes xoc-image-in{from{opacity:0}to{opacity:1}}
    @keyframes xoc-kenburns{from{transform:var(--xoc-from,scale(1.04))}to{transform:var(--xoc-to,scale(1.13))}}
    #${LAYER_ID} .xoc-vignette{position:absolute;inset:0;z-index:2;pointer-events:none;background:linear-gradient(180deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,.05) 38%,rgba(0,0,0,.54) 78%,rgba(0,0,0,.86) 100%),linear-gradient(90deg,rgba(0,0,0,.24),transparent 24%,transparent 76%,rgba(0,0,0,.24))}
    #${LAYER_ID} .xoc-glow{position:absolute;z-index:2;width:52vw;height:52vw;left:50%;top:18%;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,rgba(242,205,122,.13),rgba(242,205,122,0) 68%);mix-blend-mode:screen;pointer-events:none;animation:xoc-breathe 4s ease-in-out infinite alternate}
    @keyframes xoc-breathe{from{opacity:.45;transform:translate(-50%,-50%) scale(.9)}to{opacity:.9;transform:translate(-50%,-50%) scale(1.08)}}
    #${LAYER_ID} .xoc-particles{position:absolute;inset:0;z-index:3;overflow:hidden;pointer-events:none}
    #${LAYER_ID} .xoc-particle{position:absolute;left:var(--x);bottom:-24px;width:var(--s);height:var(--s);border-radius:50%;background:rgba(249,220,151,var(--a));box-shadow:0 0 12px rgba(249,220,151,.38);animation:xoc-float var(--d) linear infinite;animation-delay:var(--delay)}
    @keyframes xoc-float{0%{transform:translate3d(0,0,0);opacity:0}12%{opacity:1}82%{opacity:.8}100%{transform:translate3d(var(--drift),-112vh,0);opacity:0}}
    #${LAYER_ID} .xoc-top{position:absolute;z-index:6;left:0;right:0;top:0;padding:max(14px,env(safe-area-inset-top)) clamp(16px,3vw,44px) 0;display:flex;align-items:center;justify-content:space-between;gap:16px;pointer-events:none}
    #${LAYER_ID} .xoc-counter{font-size:11px;font-weight:900;letter-spacing:.22em;color:rgba(244,224,181,.72);text-shadow:0 2px 12px #000}
    #${LAYER_ID} .xoc-replay-close{pointer-events:auto;border:1px solid rgba(239,213,155,.28);background:rgba(3,4,3,.48);color:#ead9b5;border-radius:999px;min-height:36px;padding:0 14px;font-size:11px;font-weight:900;backdrop-filter:blur(8px);cursor:pointer}
    #${LAYER_ID} .xoc-caption{position:absolute;z-index:5;left:50%;bottom:max(8.5vh,54px);transform:translateX(-50%);width:min(92vw,1040px);text-align:center;padding:0 clamp(12px,3vw,28px);text-shadow:0 4px 24px rgba(0,0,0,.94)}
    #${LAYER_ID} .xoc-kicker{display:block;margin-bottom:10px;color:#e6bd65;font-size:clamp(9px,1.2vw,13px);font-weight:900;letter-spacing:.3em;opacity:0;animation:xoc-caption-in .75s .18s ease forwards}
    #${LAYER_ID} .xoc-title{margin:0;color:#fff7e6;font-size:clamp(27px,4.6vw,62px);font-weight:950;line-height:1.2;letter-spacing:.06em;opacity:0;transform:translateY(18px);animation:xoc-caption-in .9s .45s cubic-bezier(.2,.75,.25,1) forwards}
    #${LAYER_ID} .xoc-lines{margin:clamp(12px,2vh,20px) auto 0;max-width:900px}
    #${LAYER_ID} .xoc-line{display:block;margin-top:5px;color:#f2e7cf;font-size:clamp(15px,2.1vw,25px);font-weight:700;line-height:1.65;letter-spacing:.04em;opacity:0;transform:translateY(14px);animation:xoc-caption-in .8s ease forwards}
    #${LAYER_ID} .xoc-line:nth-child(1){animation-delay:.95s}#${LAYER_ID} .xoc-line:nth-child(2){animation-delay:1.38s}#${LAYER_ID} .xoc-line:nth-child(3){animation-delay:1.8s}
    #${LAYER_ID} .xoc-scene[data-index="7"] .xoc-title,#${LAYER_ID} .xoc-scene[data-index="8"] .xoc-title{color:#ffe9ab;text-shadow:0 0 28px rgba(230,181,78,.35),0 4px 26px rgba(0,0,0,.95)}
    #${LAYER_ID} .xoc-scene[data-index="8"] .xoc-line:last-child,#${LAYER_ID} .xoc-scene[data-index="9"] .xoc-line:last-child{color:#ffe7a4;font-weight:900}
    @keyframes xoc-caption-in{to{opacity:1;transform:translateY(0)}}
    #${LAYER_ID} .xoc-bottom{position:absolute;z-index:7;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(92vw,720px);display:grid;gap:10px;place-items:center}
    #${LAYER_ID} .xoc-dots{display:flex;gap:7px;align-items:center;justify-content:center}
    #${LAYER_ID} .xoc-dot{width:20px;height:3px;border-radius:99px;background:rgba(255,255,255,.20);overflow:hidden;transition:.2s}
    #${LAYER_ID} .xoc-dot.done{background:rgba(235,199,112,.62)}#${LAYER_ID} .xoc-dot.current{width:38px;background:rgba(255,239,194,.38)}
    #${LAYER_ID} .xoc-dot.current:after{content:"";display:block;height:100%;width:100%;background:#f0c96f;transform-origin:left;animation:xoc-progress var(--xoc-progress,6s) linear forwards}
    #${LAYER_ID} .xoc-hint{min-height:18px;color:rgba(239,227,201,.65);font-size:10px;letter-spacing:.08em;text-shadow:0 2px 10px #000}
    #${LAYER_ID} .xoc-enter{border:1px solid rgba(245,211,131,.72);border-radius:999px;min-width:min(78vw,260px);min-height:48px;padding:0 26px;background:linear-gradient(135deg,rgba(176,126,42,.96),rgba(93,57,12,.96));color:#fff4d2;font:900 14px var(--xq-serif,'Noto Sans TC',sans-serif);letter-spacing:.14em;box-shadow:0 12px 38px rgba(0,0,0,.38),0 0 28px rgba(220,173,72,.16);cursor:pointer;animation:xoc-enter-in .75s 1.2s both}
    @keyframes xoc-enter-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
    #${LAYER_ID}.xoc-transition .xoc-scene{animation:xoc-scene-out .28s ease forwards}
    @keyframes xoc-scene-out{to{opacity:0;transform:scale(1.015)}}
    @media(max-width:640px){
      #${LAYER_ID} .xoc-caption{bottom:max(10vh,76px)}
      #${LAYER_ID} .xoc-title{font-size:clamp(25px,8vw,38px)}
      #${LAYER_ID} .xoc-line{font-size:clamp(14px,4.3vw,19px)}
      #${LAYER_ID} .xoc-dot{width:14px}
      #${LAYER_ID} .xoc-dot.current{width:28px}
    }
    @media(prefers-reduced-motion:reduce){
      #${LAYER_ID} *,#${LAYER_ID} *:before,#${LAYER_ID} *:after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
      #${LAYER_ID} .xoc-image{transform:none!important}
    }
  `;
  document.head.appendChild(style);
}

function particleMarkup() {
  return Array.from({ length: 18 }, (_, index) => {
    const x = (index * 37 + 11) % 100;
    const size = 2 + (index % 4);
    const opacity = (0.22 + (index % 5) * 0.08).toFixed(2);
    const duration = 9 + (index % 7) * 1.7;
    const delay = -((index * 1.3) % duration);
    const drift = ((index % 2 ? 1 : -1) * (18 + (index % 5) * 9));
    return `<i class="xoc-particle" style="--x:${x}%;--s:${size}px;--a:${opacity};--d:${duration}s;--delay:${delay}s;--drift:${drift}px"></i>`;
  }).join('');
}

function layer() {
  ensureStyle();
  let el = document.getElementById(LAYER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = LAYER_ID;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', '修仙世界觀影片');
    document.body.appendChild(el);
  }
  return el;
}

function clearTimer() {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = null;
}

function setScrollLock(locked) {
  document.documentElement.classList.toggle('xiuxian-opening-lock', locked);
  document.body?.classList.toggle('xiuxian-opening-lock', locked);
}

function renderScene() {
  if (!active) return;
  clearTimer();
  const scene = SCENES[sceneIndex];
  const el = layer();
  const duration = Math.max(1, scene.duration || 6500);
  sceneStartedAt = Date.now();
  warmFollowingScenes(sceneIndex);

  const dots = SCENES.map((_, index) => {
    const state = index < sceneIndex ? 'done' : index === sceneIndex ? 'current' : '';
    return `<i class="xoc-dot ${state}" aria-hidden="true"></i>`;
  }).join('');

  const close = replayMode
    ? '<button type="button" class="xoc-replay-close">關閉重播</button>'
    : '';

  const finalControl = scene.final
    ? '<button type="button" class="xoc-enter">踏上仙途</button>'
    : `<div class="xoc-hint">${replayMode ? '點擊畫面、Enter 或 Space 可前進' : '首次觀看 · 點擊畫面、Enter 或 Space 可加速前進'}</div>`;

  el.classList.remove('xoc-transition');
  el.innerHTML = `
    <section class="xoc-scene" data-index="${sceneIndex + 1}" data-motion="${escapeHtml(scene.motion)}" style="--xoc-duration:${duration + 900}ms">
      <img class="xoc-image" src="${escapeHtml(scene.image)}" alt="" draggable="false">
      <div class="xoc-glow"></div>
      <div class="xoc-vignette"></div>
      <div class="xoc-particles">${particleMarkup()}</div>
      <div class="xoc-top">
        <div class="xoc-counter">世界觀 · ${String(sceneIndex + 1).padStart(2, '0')} / 09</div>
        ${close}
      </div>
      <div class="xoc-caption">
        <span class="xoc-kicker">${escapeHtml(scene.kicker)}</span>
        <h1 class="xoc-title">${escapeHtml(scene.title)}</h1>
        <div class="xoc-lines">${scene.lines.map((line) => `<span class="xoc-line">${escapeHtml(line)}</span>`).join('')}</div>
      </div>
      <div class="xoc-bottom">
        <div class="xoc-dots" style="--xoc-progress:${duration}ms">${dots}</div>
        ${finalControl}
      </div>
    </section>
  `;

  el.querySelector('.xoc-image')?.addEventListener('error', (event) => {
    event.currentTarget.classList.add('xoc-missing');
  }, { once: true });

  el.querySelector('.xoc-replay-close')?.addEventListener('click', (event) => {
    event.stopPropagation();
    close(false);
  });

  el.querySelector('.xoc-enter')?.addEventListener('click', (event) => {
    event.stopPropagation();
    void finish();
  });

  el.onclick = (event) => {
    if (event.target.closest('button')) return;
    if (!scene.final) advance(true);
  };

  if (!scene.final && scene.duration > 0) {
    autoTimer = setTimeout(() => advance(false), scene.duration);
  }
}

function advance(manual = false) {
  if (!active || finishBusy) return;
  const scene = SCENES[sceneIndex];
  if (scene?.final) return;

  if (!replayMode && manual) {
    const elapsed = Date.now() - sceneStartedAt;
    if (elapsed < FIRST_VIEW_MIN_MS) {
      clearTimer();
      autoTimer = setTimeout(() => advance(true), FIRST_VIEW_MIN_MS - elapsed);
      return;
    }
  }

  if (sceneIndex >= SCENES.length - 1) return;
  clearTimer();
  const el = document.getElementById(LAYER_ID);
  el?.classList.add('xoc-transition');
  setTimeout(() => {
    if (!active) return;
    sceneIndex += 1;
    renderScene();
  }, 260);
}

async function persistSeen() {
  const data = userData();
  const user = currentUser();
  if (!data || !user) return false;
  const old = data[FIELD] || {};
  const next = {
    version: Math.max(1, Number(old.version) || 1),
    ...old,
    openingCinematicSeen: true,
    openingCinematicSeenAtMs: Date.now(),
    updatedAtMs: Date.now()
  };
  data[FIELD] = next;
  try {
    await updateDoc(doc(getFirestore(getApp()), 'users', user.uid), { [FIELD]: next });
    return true;
  } catch (error) {
    console.warn('[Opening cinematic] progress save deferred:', error);
    return false;
  }
}

function close(dispatch = true) {
  clearTimer();
  active = false;
  finishBusy = false;
  document.getElementById(LAYER_ID)?.remove();
  setScrollLock(false);
  if (dispatch) {
    window.dispatchEvent(new CustomEvent('xiuxian:opening-cinematic-closed', {
      detail: { replay: replayMode }
    }));
  }
  replayMode = false;
}

async function finish() {
  if (!active || finishBusy) return;
  finishBusy = true;
  const wasReplay = replayMode;
  if (!wasReplay) await persistSeen();
  close(false);
  window.dispatchEvent(new CustomEvent('xiuxian:opening-cinematic-completed', {
    detail: { replay: wasReplay, seen: true }
  }));
}

function open(options = {}) {
  if (active || document.getElementById(LAYER_ID)) return false;
  if (window.isXiuxianBattleBusy?.()) return false;

  const replay = options.replay === true;
  if (!replay && !required()) return false;

  replayMode = replay;
  sceneIndex = Math.max(0, Math.min(SCENES.length - 1, Number(options.scene) || 0));
  finishBusy = false;
  active = true;
  setScrollLock(true);
  ensureStyle();
  void preloadImages();
  renderScene();
  return true;
}

function onKeydown(event) {
  if (!active) return;
  if (event.target?.matches?.('input,textarea,select,button')) return;
  if (event.key === 'Escape' && replayMode) {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  if (SCENES[sceneIndex]?.final) void finish();
  else advance(true);
}

window.isXiuxianOpeningCinematicRequired = required;
window.isXiuxianOpeningCinematicActive = () => active;
window.openXiuxianOpeningCinematic = open;
window.preloadXiuxianOpeningImages = preloadImages;
window.getXiuxianOpeningCinematicScenes = () => SCENES.map((scene, index) => ({
  index: index + 1,
  image: scene.image,
  kicker: scene.kicker,
  title: scene.title,
  lines: scene.lines.slice()
}));

function boot() {
  ensureStyle();
  document.addEventListener('keydown', onKeydown);
  // 影片圖片在 open() 時才預載，讓新玩家先進入主線與入門教學。
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();

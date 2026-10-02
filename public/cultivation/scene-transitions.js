// Visual transitions only: navigation and combat state remain synchronous.
const running = new Map();
const themes = {
  cloud: { duration: 380, color: 'rgba(176,213,216,.22)' },
  scroll: { duration: 340, color: 'rgba(230,190,102,.22)' },
  sword: { duration: 300, color: 'rgba(123,204,255,.30)' },
  raid: { duration: 460, color: 'rgba(155,128,218,.30)' },
  battleResult: { duration: 440, color: 'rgba(239,189,91,.25)' },
  raidResult: { duration: 500, color: 'rgba(226,177,96,.28)' },
  meditation: { duration: 440, color: 'rgba(192,184,130,.20)' },
  alchemy: { duration: 360, color: 'rgba(225,156,83,.24)' }
};

export function sceneTheme(pageId) {
  if (/raid/.test(pageId)) return 'raid';
  if (/battle/.test(pageId)) return 'sword';
  if (/quiz|curriculum|scope|history/.test(pageId)) return 'scroll';
  if (/training|store/.test(pageId)) return 'alchemy';
  return 'cloud';
}

// Follow the navigation's visible order; fullscreen returns travel back.
export function sceneDirection(from, to, scope = 'page') {
  if (scope.endsWith('-close') || to?.id === 'page-home') return -1;
  const groups = [
    ['page-home', 'page-training', 'page-store', 'page-rank', 'page-social', 'page-settings'],
    ['cs-stage-0', 'cs-stage-1', 'cs-stage-2'],
    ['section-friends', 'section-chat'],
    ['ss-picker', 'ss-cart'],
    ['bv2-lobby', 'bv2-intro', 'bv2-arena', 'bv2-quiz', 'bv2-result'],
    ['raid-hub', 'raid-lobby', 'raid-arena', 'raid-question', 'raid-result']
  ];
  for (const order of groups) {
    const start = order.indexOf(from?.id), end = order.indexOf(to?.id);
    if (start >= 0 && end >= 0 && start !== end) return end > start ? 1 : -1;
  }
  return 1;
}

// Reuse parsed styles across both snapshots and subsequent transitions.
const snapshotSheets = new WeakMap();
function installSnapshotStyles(shadow) {
  const sheets = [];
  document.querySelectorAll('style,link[rel="stylesheet"]').forEach(owner => {
    try {
      if (!('adoptedStyleSheets' in shadow) || typeof CSSStyleSheet.prototype.replaceSync !== 'function' || !owner.sheet) throw new Error('fallback');
      const signature = owner.tagName === 'STYLE' ? owner.textContent : owner.href;
      let cached = snapshotSheets.get(owner);
      if (!cached || cached.signature !== signature) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync([...owner.sheet.cssRules].map(rule => rule.cssText).join('\n'));
        cached = { signature, sheet };
        snapshotSheets.set(owner, cached);
      }
      sheets.push(cached.sheet);
    } catch (_) {
      // Cross-origin font styles and older browsers keep their normal link path.
      shadow.appendChild(owner.cloneNode(true));
    }
  });
  if (sheets.length) shadow.adoptedStyleSheets = sheets;
}

function navigationTop() {
  const nav = document.querySelector('#bottom-nav .glass-capsule') || document.getElementById('nav-grid');
  const rect = nav?.getBoundingClientRect();
  return rect?.width && rect?.height ? rect.top : innerHeight;
}

function clipAboveNavigation(clip, top) {
  const values = /^inset\(([-.\d]+)px ([-.\d]+)px ([-.\d]+)px ([-.\d]+)px\)$/.exec(clip || '');
  const bottom = Math.max(values ? Number(values[3]) : 0, innerHeight - top, 0);
  return `inset(${values ? values[1] : 0}px ${values ? values[2] : 0}px ${bottom}px ${values ? values[4] : 0}px)`;
}

// Keep IDs inside a shadow root, so the frozen old scene never interferes with
// getElementById, event listeners, forms, or the live game's state.
function snapshotScene(element, layer, scope) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const shadow = layer.attachShadow({ mode: 'closed' });
  installSnapshotStyles(shadow);
  const html = document.documentElement.cloneNode(false);
  const body = document.body.cloneNode(false);
  html.removeAttribute('id');
  body.removeAttribute('id');
  html.style.cssText = body.style.cssText = 'display:contents!important';
  shadow.appendChild(html);
  html.appendChild(body);
  let parent = body;
  const ancestors = [];
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) ancestors.unshift(node);
  ancestors.forEach(node => {
    const clone = node.cloneNode(false);
    clone.style.cssText = 'display:contents!important';
    parent.appendChild(clone);
    parent = clone;
  });
  const clone = element.cloneNode(true);
  clone.style.cssText += `;position:absolute!important;left:${rect.left}px!important;top:${rect.top}px!important;width:${rect.width}px!important;height:${rect.height}px!important;margin:0!important;max-width:none!important;transform:none!important`;
  const originals = [element, ...element.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  // Read scroll offsets together BEFORE mounting the copies. Interleaved
  // scroll reads/writes on attached trees force a layout for every element.
  const scrollPositions = [];
  originals.forEach((node, i) => {
    const copy = copies[i];
    if (!copy || copy.tagName !== node.tagName) return;
    const top = node.scrollTop, left = node.scrollLeft;
    if (top || left) scrollPositions.push({ copy, top, left });
    if ('value' in node && node.tagName !== 'LI') copy.value = node.value;
    if ('checked' in node) copy.checked = node.checked;
    if (node.tagName === 'CANVAS') {
      try { copy.getContext('2d')?.drawImage(node, 0, 0); } catch (_) {}
    }
  });
  parent.appendChild(clone);
  scrollPositions.forEach(({ copy, top, left }) => {
    copy.scrollTop = top;
    copy.scrollLeft = left;
  });
  clone.querySelectorAll('script,iframe').forEach(node => node.remove());
  const freeze = document.createElement('style');
  freeze.textContent = '*{animation:none!important;transition:none!important;caret-color:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}';
  shadow.appendChild(freeze);
  shadow.appendChild(document.createElement('slot'));
  const inherited = getComputedStyle(element);
  layer.style.color = inherited.color;
  layer.style.font = inherited.font;
  for (const property of inherited) {
    if (property.startsWith('--')) layer.style.setProperty(property, inherited.getPropertyValue(property));
  }
  // Preserve clipping by scroll containers; the snapshot must not cover navigation.
  layer.style.background = getComputedStyle(document.body).background;
  let top = scope === 'page' ? 0 : Math.max(0, rect.top);
  let left = scope === 'page' ? 0 : Math.max(0, rect.left);
  let right = scope === 'page' ? innerWidth : Math.min(innerWidth, rect.right);
  let bottom = scope === 'page' ? innerHeight : Math.min(innerHeight, rect.bottom);
  ancestors.forEach(node => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
    if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
  });
  layer.style.clipPath = `inset(${Math.max(0, top)}px ${Math.max(0, innerWidth - right)}px ${Math.max(0, innerHeight - bottom)}px ${Math.max(0, left)}px)`;
}

export function beginSceneTransition(from, to, theme = 'cloud', scope = 'page', force = false, direction = sceneDirection(from, to, scope)) {
  const noop = () => {};
  if ((!force && from === to) || !to && !from) return noop;
  running.get(scope)?.();
  // A page transition already covers its internal initial phase.
  if (scope !== 'page' && (running.has('page') || [...running.keys()].some(key => key !== scope && key.endsWith('-open')))) return noop;
  // Keep a departing fullscreen overlay above its destination page.
  if (scope === 'page' && [...running.keys()].some(key => key.endsWith('-close'))) return noop;
  if (scope === 'page') [...running.values()].forEach(cleanup => cleanup());
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !Element.prototype.animate || document.hidden) return noop;
  if (!from?.getClientRects().length && !to?.getClientRects().length) return noop;
  const config = themes[theme] || themes.cloud;
  const layer = document.createElement('div');
  layer.dataset.sceneTransition = theme;
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  layer.style.cssText = 'position:fixed;inset:0;z-index:29000;pointer-events:none;overflow:hidden;contain:layout paint';
  const outgoing = document.createElement('div');
  const incoming = document.createElement('div');
  outgoing.style.cssText = incoming.style.cssText = 'position:fixed;inset:0;pointer-events:none;will-change:transform;backface-visibility:hidden';
  layer.appendChild(outgoing);
  layer.appendChild(incoming);
  const animations = [];
  const pageSlide = scope === 'page';
  if (pageSlide) document.body.classList.add('scene-page-sliding');
  const navTop = navigationTop();
  let timer;
  let disposed = false;
  let started = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    animations.forEach(animation => animation.cancel());
    layer.remove();
    if (pageSlide) document.body.classList.remove('scene-page-sliding');
    if (running.get(scope) === cleanup) running.delete(scope);
  };
  try {
    layer.style.clipPath = clipAboveNavigation('', navTop);
    document.body.appendChild(layer);
    if (from?.getClientRects().length) snapshotScene(from, outgoing, scope);
    // Clip the moving copies to the scene's viewport, keeping fixed navigation visible.
    layer.style.clipPath = clipAboveNavigation(outgoing.style.clipPath, navTop);
    running.set(scope, cleanup);
    // Also clean up if the caller fails before completing its render.
    timer = setTimeout(cleanup, Math.max(420, config.duration) + 150);
  } catch (_) { cleanup(); return noop; }
  return () => {
    if (disposed || started) return;
    started = true;
    try {
      if (to?.getClientRects().length) snapshotScene(to, incoming, scope);
      layer.style.clipPath ||= incoming.style.clipPath || '';
      // Clip the outer container, never the navigation, for pages and subviews.
      layer.style.clipPath = clipAboveNavigation(layer.style.clipPath, Math.min(navTop, navigationTop()));
      const distance = Math.max(1, from?.getBoundingClientRect().width || 0, to?.getBoundingClientRect().width || 0, scope === 'page' ? innerWidth : 0);
      const sign = direction < 0 ? -1 : 1;
      layer.dataset.sceneDirection = sign > 0 ? 'forward' : 'back';
      const duration = scope === 'page' ? 300 : Math.min(380, Math.max(260, config.duration));
      clearTimeout(timer);
      timer = setTimeout(cleanup, duration + 150);
      const glow = document.createElement('div');
      const diagonal = theme === 'sword';
      const background = diagonal
        ? `linear-gradient(125deg,transparent 38%,${config.color} 49%,rgba(235,249,255,.45) 50%,transparent 62%)`
        : theme === 'scroll'
          ? `linear-gradient(90deg,transparent 15%,${config.color} 50%,transparent 85%)`
          : theme === 'alchemy'
            ? `radial-gradient(circle at 50% 60%,transparent 15%,${config.color} 35%,transparent 52%)`
            : `radial-gradient(ellipse at 50% 55%,${config.color},transparent 72%)`;
      glow.style.cssText = `position:fixed;inset:0;pointer-events:none;background:${background}`;
      layer.appendChild(glow);
      const options = { duration, easing: 'cubic-bezier(.22,.7,.24,1)', fill: 'both' };
      animations.push(outgoing.animate([
        { transform: 'translate3d(0,0,0)' },
        { transform: `translate3d(${-sign * distance}px,0,0)` }
      ], options));
      animations.push(incoming.animate([
        { transform: `translate3d(${sign * distance}px,0,0)` },
        { transform: 'translate3d(0,0,0)' }
      ], options));
      animations.push(glow.animate([
        { opacity: 0, transform: diagonal ? 'translateX(-25%)' : 'scale(.96)' },
        { opacity: 1, offset: .35 },
        { opacity: 0, transform: diagonal ? 'translateX(25%)' : 'scale(1.05)' }
      ], { duration, fill: 'both' }));
      // Animate visual copies only. Transforming live pages would change the
      // containing block of fixed battle controls and bottom navigation.
      animations[0].finished.then(cleanup, cleanup);
    } catch (_) { cleanup(); }
  };
}

window.beginSceneTransition = beginSceneTransition;

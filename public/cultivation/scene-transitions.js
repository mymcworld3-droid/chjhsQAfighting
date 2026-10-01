// Visual transitions only: navigation and combat state remain synchronous.
const running = new Map();
const themes = {
  cloud: { duration: 380, color: 'rgba(176,213,216,.22)', exit: [0, -5] },
  scroll: { duration: 340, color: 'rgba(230,190,102,.22)', exit: [-10, 0] },
  sword: { duration: 300, color: 'rgba(123,204,255,.30)', exit: [-22, 0] },
  raid: { duration: 460, color: 'rgba(155,128,218,.30)', exit: [0, -8] },
  battleResult: { duration: 440, color: 'rgba(239,189,91,.25)', exit: [0, -5] },
  raidResult: { duration: 500, color: 'rgba(226,177,96,.28)', exit: [0, -8] },
  meditation: { duration: 440, color: 'rgba(192,184,130,.20)', exit: [0, -4] },
  alchemy: { duration: 360, color: 'rgba(225,156,83,.24)', exit: [0, -6] }
};

export function sceneTheme(pageId) {
  if (/raid/.test(pageId)) return 'raid';
  if (/battle/.test(pageId)) return 'sword';
  if (/quiz|curriculum|scope|history/.test(pageId)) return 'scroll';
  if (/training|store/.test(pageId)) return 'alchemy';
  return 'cloud';
}

// Keep IDs inside a shadow root, so the frozen old scene never interferes with
// getElementById, event listeners, forms, or the live game's state.
function snapshotScene(element, layer, scope) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const shadow = layer.attachShadow({ mode: 'closed' });
  document.querySelectorAll('style,link[rel="stylesheet"]').forEach(style => {
    shadow.appendChild(style.cloneNode(true));
  });
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
  parent.appendChild(clone);
  const originals = [element, ...element.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  // Match by traversal before any removed embedded content; ordinary pages have none.
  originals.forEach((node, i) => {
    const copy = copies[i];
    if (!copy || copy.tagName !== node.tagName) return;
    copy.scrollTop = node.scrollTop;
    copy.scrollLeft = node.scrollLeft;
    if ('value' in node && node.tagName !== 'LI') copy.value = node.value;
    if ('checked' in node) copy.checked = node.checked;
    if (node.tagName === 'CANVAS') {
      try { copy.getContext('2d')?.drawImage(node, 0, 0); } catch (_) {}
    }
  });
  clone.querySelectorAll('script,iframe').forEach(node => node.remove());
  const freeze = document.createElement('style');
  freeze.textContent = '*{animation:none!important;transition:none!important;caret-color:transparent!important}';
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

export function beginSceneTransition(from, to, theme = 'cloud', scope = 'page', force = false) {
  const noop = () => {};
  if ((!force && from === to) || !to && !from) return noop;
  running.get(scope)?.();
  // A page transition already covers its internal initial phase.
  if (scope !== 'page' && running.has('page')) return noop;
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
  const animations = [];
  let timer;
  let disposed = false;
  let started = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    animations.forEach(animation => animation.cancel());
    layer.remove();
    if (running.get(scope) === cleanup) running.delete(scope);
  };
  try {
    document.body.appendChild(layer);
    if (from?.getClientRects().length) snapshotScene(from, layer, scope);
    running.set(scope, cleanup);
    // Also clean up if the caller fails before completing its render.
    timer = setTimeout(cleanup, config.duration + 150);
  } catch (_) { cleanup(); return noop; }
  return () => {
    if (disposed || started) return;
    started = true;
    try {
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
      const [x, y] = config.exit;
      animations.push(layer.animate([
        { opacity: 1, transform: 'translate3d(0,0,0)', filter: 'blur(0px)' },
        { opacity: 0, transform: `translate3d(${x}px,${y}px,0)`, filter: `blur(${theme === 'raid' ? 10 : theme === 'cloud' ? 5 : 0}px)` }
      ], { duration: config.duration, easing: 'cubic-bezier(.22,.7,.24,1)', fill: 'both' }));
      animations.push(glow.animate([
        { opacity: 0, transform: diagonal ? 'translateX(-25%)' : 'scale(.96)' },
        { opacity: 1, offset: .35 },
        { opacity: 0, transform: diagonal ? 'translateX(25%)' : 'scale(1.05)' }
      ], { duration: config.duration, fill: 'both' }));
      // Animate a visual copy only. Transforming live pages would change the
      // containing block of fixed battle controls and bottom navigation.
      animations[0].finished.then(cleanup, cleanup);
    } catch (_) { cleanup(); }
  };
}

window.beginSceneTransition = beginSceneTransition;

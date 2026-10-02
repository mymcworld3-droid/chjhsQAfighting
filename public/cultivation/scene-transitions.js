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

// Animate the real content. Never clone trees or stylesheets during navigation.
export function beginSceneTransition(from, to, theme = 'cloud', scope = 'page', force = false, direction = sceneDirection(from, to, scope)) {
  const noop = () => {};
  if ((!force && from === to) || (!from && !to)) return noop;
  running.get(scope)?.();
  if (scope !== 'page' && (running.has('page') || [...running.keys()].some(key => key !== scope && key.endsWith('-open')))) return noop;
  if (scope === 'page' && [...running.keys()].some(key => key.endsWith('-close'))) return noop;
  if (scope === 'page') [...running.values()].forEach(cleanup => cleanup());
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !Element.prototype.animate || document.hidden) return noop;

  const pageSlide = scope === 'page';
  const animations = [];
  let timer, target, glow, oldWillChange, hadMotionClass;
  let disposed = false, started = false, motionStarted = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    animations.forEach(animation => animation.cancel());
    if (motionStarted && target.style.willChange === 'transform') target.style.willChange = oldWillChange;
    if (motionStarted && !hadMotionClass) target.classList.remove('scene-content-moving');
    glow?.remove();
    if (pageSlide) document.body.classList.remove('scene-page-sliding');
    if (running.get(scope) === cleanup) running.delete(scope);
    if (!running.size) document.body.classList.remove('scene-motion-active');
  };
  if (pageSlide) document.body.classList.add('scene-page-sliding');
  running.set(scope, cleanup);
  document.body.classList.add('scene-motion-active');
  timer = setTimeout(cleanup, 1000);

  return () => {
    if (disposed || started) return;
    started = true;
    target = to;
    // Content may have been removed by a cancelled modal or a newer navigation.
    if (!target?.getClientRects().length) { cleanup(); return; }
    const nav = document.getElementById('bottom-nav');
    if (target === nav || target.contains?.(nav)) { cleanup(); return; }
    try {
      const rect = target.getBoundingClientRect();
      const sign = direction < 0 ? -1 : 1;
      const distance = Math.max(1, Math.min(innerWidth, rect.width || innerWidth));
      const duration = pageSlide ? 480 : 400;
      const base = getComputedStyle(target).transform;
      const originalTransform = base && base !== 'none' ? base : '';
      oldWillChange = target.style.willChange;
      motionStarted = true;
      target.style.willChange = 'transform';
      hadMotionClass = target.classList.contains('scene-content-moving');
      target.classList.add('scene-content-moving');
      // Ease out across the full width: a clear initial slide and a gradual stop.
      animations.push(target.animate([
        { transform: `translate3d(${sign * distance}px,0,0) ${originalTransform}`.trim() },
        { transform: `translate3d(0,0,0) ${originalTransform}`.trim() }
      ], { duration, easing: 'cubic-bezier(.215,.61,.355,1)', fill: 'both' }));

      // Only this small, empty accent layer is created; no page DOM is copied.
      glow = document.createElement('div');
      glow.dataset.sceneTransition = theme;
      glow.dataset.sceneDirection = sign > 0 ? 'forward' : 'back';
      glow.setAttribute('aria-hidden', 'true');
      const capsule = document.querySelector('#bottom-nav .glass-capsule');
      const navRect = capsule?.getBoundingClientRect();
      const bottom = navRect?.height ? Math.max(0, innerHeight - navRect.top) : 0;
      const color = (themes[theme] || themes.cloud).color;
      const angle = theme === 'sword' ? '125deg' : '90deg';
      glow.style.cssText = `position:fixed;top:${Math.max(0, rect.top)}px;left:0;right:0;bottom:${bottom}px;z-index:29000;pointer-events:none;contain:strict;background:linear-gradient(${angle},transparent 42%,${color} 50%,transparent 58%)`;
      document.body.appendChild(glow);
      animations.push(glow.animate([{ opacity: 0 }, { opacity: .3, offset: .4 }, { opacity: 0 }], { duration, fill: 'both' }));
      clearTimeout(timer);
      timer = setTimeout(cleanup, duration + 100);
      animations[0].finished.then(cleanup, cleanup);
    } catch (_) { cleanup(); }
  };
}

window.beginSceneTransition = beginSceneTransition;

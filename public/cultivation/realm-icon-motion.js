// One appearance per visible realm/asset in a stable UI slot. Supports the
// current crests and future AI images without changing their layout boxes.
(function () {
  'use strict';
  let slots = new WeakMap();
  const records = new WeakMap();
  const active = new Set();
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let observer, viewport, phaseObserver, stylePromise;

  function covered() {
    return !!document.getElementById('game-startup-gate') || !!document.getElementById('startup-cloud-curtain') ||
      !!document.getElementById('xiuxian-opening-cinematic') || document.body.classList.contains('scene-motion-active');
  }

  function assetOf(icon) { return icon.querySelector(':scope > svg, :scope > img'); }
  function signatureOf(icon) {
    const image = icon.querySelector(':scope > img');
    return `${icon.dataset.realm}|${image ? image.getAttribute('src') : 'svg'}`;
  }
  function slotOf(icon) {
    const special = icon.closest('.xiuxian-realm-atlas-item,.realm-breakthrough-icon,[data-realm-animation-slot]');
    const primary = icon.closest('#xiuxian-realm,#display-rank,#match-me-rank,#match-opp-rank');
    const host = special || primary || icon.parentElement?.closest('[id]') || icon.parentElement;
    let key = primary ? 'primary' : icon.dataset.realmOwner;
    if (!key) {
      const path = [];
      for (let node = icon; node && node !== host; node = node.parentElement) {
        path.unshift([...node.parentElement.children].indexOf(node));
      }
      key = path.join('.') || 'crest';
    }
    if (!slots.has(host)) slots.set(host, new Map());
    return { cache: slots.get(host), key };
  }
  function remember(record) {
    const { cache, key, signature } = record;
    cache.set(key, signature);
    if (cache.size > 512) cache.delete(cache.keys().next().value);
  }
  function settle(icon, record) {
    if (records.get(icon) !== record) return;
    clearTimeout(record.timer);
    if (record.onEnd) icon.removeEventListener('animationend', record.onEnd);
    icon.classList.remove('realm-motion-pending', 'realm-appearing');
    icon.dataset.realmMotion = 'settled';
    active.delete(icon);
    record.done = true;
  }
  function stylesheetReady() {
    if (stylePromise) return stylePromise;
    const link = document.querySelector('link[href^="realm-icons.css"]');
    if (!link || link.sheet) return Promise.resolve();
    stylePromise = new Promise(resolve => {
      const finish = () => { clearTimeout(timer); link.removeEventListener('load', finish); link.removeEventListener('error', finish); resolve(); };
      const timer = setTimeout(finish, 1800);
      link.addEventListener('load', finish, { once: true });
      link.addEventListener('error', finish, { once: true });
    });
    return stylePromise;
  }
  async function enter(icon) {
    const record = records.get(icon);
    if (!record || record.done || record.starting || covered()) return;
    record.starting = true;
    const loading = assetOf(icon);
    const decode = loading?.tagName === 'IMG' && loading.decode ? loading.decode().catch(() => {}) : Promise.resolve();
    await Promise.all([stylesheetReady(), decode]);
    if (!icon.isConnected || records.get(icon) !== record || signatureOf(icon) !== record.signature) return;
    if (record.done) return;
    if (covered() || (viewport && !record.inView)) { record.starting = false; return; }
    viewport?.unobserve(icon);
    const asset = assetOf(icon);
    if (motion.matches || (!record.force && record.cache.get(record.key) === record.signature)) {
      remember(record);
      settle(icon, record);
      return;
    }
    remember(record);
    icon.classList.remove('realm-motion-pending');
    // Replays explicitly requested by previews restart the current keyframes.
    if (record.force) void icon.offsetWidth;
    icon.classList.add('realm-appearing');
    icon.dataset.realmMotion = 'playing';
    const css = getComputedStyle(asset);
    const duration = (parseFloat(css.animationDuration) || 1.4) * 1000;
    const delay = (parseFloat(css.animationDelay) || 0) * 1000;
    record.onEnd = event => { if (event.target === asset) settle(icon, record); };
    icon.addEventListener('animationend', record.onEnd);
    record.timer = setTimeout(() => settle(icon, record), duration + delay + 250);
  }
  function register(icon, force = false) {
    if (!icon.isConnected || !assetOf(icon)) return;
    const signature = signatureOf(icon), old = records.get(icon), slot = slotOf(icon);
    if (!force && old?.signature === signature && old.cache === slot.cache && old.key === slot.key) return;
    if (old) settle(icon, old);
    const record = { ...slot, signature, force, done: false };
    records.set(icon, record);
    if (motion.matches || (!force && record.cache.get(record.key) === signature)) {
      remember(record);
      settle(icon, record);
      return;
    }
    const item = icon.closest('.xiuxian-realm-atlas-item');
    const ordinal = item ? [...item.parentElement.children].indexOf(item) : 0;
    icon.style.setProperty('--realm-entry-delay', `${Math.min(5, ordinal) * 55}ms`);
    icon.classList.add('realm-motion-pending');
    icon.dataset.realmMotion = 'waiting';
    active.add(icon);
    if (viewport) viewport.observe(icon);
    else checkVisible();
  }
  function eachIcon(node, visit) {
    if (node.nodeType !== 1) return;
    if (node.matches('.realm-icon')) visit(node);
    node.querySelectorAll('.realm-icon').forEach(icon => visit(icon));
  }
  function remove(icon) {
    viewport?.unobserve(icon);
    const record = records.get(icon);
    if (record) settle(icon, record);
    records.delete(icon);
  }
  function checkVisible() {
    if (covered()) return;
    for (const icon of active) {
      const record = records.get(icon);
      if (viewport) { if (record?.inView) void enter(icon); continue; }
      const rect = icon.getBoundingClientRect();
      if (rect.width && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth) void enter(icon);
    }
  }
  function boot() {
    if (typeof window.IntersectionObserver === 'function') {
      viewport = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const record = records.get(entry.target);
          if (record) record.inView = entry.isIntersecting && entry.intersectionRatio >= .35;
          if (record?.inView) void enter(entry.target);
        }
      }, { threshold: [0, .35] });
    }
    observer = new MutationObserver(changes => {
      for (const change of changes) {
        if (change.type === 'attributes') {
          if (change.attributeName === 'class') { checkVisible(); continue; }
          const icon = change.target.closest('.realm-icon');
          if (icon) register(icon);
          continue;
        }
        change.removedNodes.forEach(node => eachIcon(node, remove));
        change.addedNodes.forEach(node => {
          eachIcon(node, register);
          const icon = node.parentElement?.closest('.realm-icon');
          if (icon) register(icon);
        });
      }
      checkVisible();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: viewport ? ['data-realm', 'data-realm-owner', 'src'] : ['data-realm', 'data-realm-owner', 'src', 'class'] });
    document.querySelectorAll('.realm-icon').forEach(icon => register(icon));
    phaseObserver = new MutationObserver(checkVisible);
    phaseObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    if (!viewport) {
      window.addEventListener('resize', checkVisible, { passive: true });
      document.addEventListener('scroll', checkVisible, { passive: true, capture: true });
    }
    motion.addEventListener('change', () => {
      if (!motion.matches) return;
      for (const icon of active) {
        const record = records.get(icon);
        if (record) { remember(record); settle(icon, record); }
        viewport?.unobserve(icon);
      }
    });
    window.addEventListener('xiuxian:user-ready', () => {
      slots = new WeakMap();
      document.querySelectorAll('.realm-icon').forEach(icon => { remove(icon); register(icon); });
    });
  }
  window.playRealmIconAppearance = icon => { if (icon?.matches?.('.realm-icon')) register(icon, true); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

import './training-access-rules.js';
import './training-scene-layouts.js';
import { getMainUser } from './data/project-repository.js';

const Rules = globalThis.QATrainingAccessRules;
const Layouts = globalThis.QATrainingSceneLayouts;
const SVG = 'http://www.w3.org/2000/svg';
const PAGE = 'page-training';
const tabPlace = { core: 'meditation', 'nascent-soul': 'meditation', refinery: 'forge', bag: 'vault', equipment: 'vault', status: 'status' };
let page, map, plane, bar, background, resizeObserver, pageObserver;
let orientation = '', scheduled = false, running = false, navigation = null;
let navigationRevision = 0;
const unlocked = place => !!window.getCurrentUserData?.()?.stats &&
  (window.getTrainingAccessScore?.() ?? Rules.score(window.getCurrentUserData?.())) >= place.threshold;
const visible = () => !!page?.classList.contains('active-page') && !page.classList.contains('hidden');
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function svgNode(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}
function loadStyle() {
  if (document.getElementById('training-scene-map-style')) return;
  const link = document.createElement('link');
  link.id = 'training-scene-map-style';
  link.rel = 'stylesheet';
  link.href = 'styles/training-scene-map.css';
  document.head.appendChild(link);
}
function setDetail(placeId) {
  if (!page) return;
  const place = Rules.PLACES.find(place => place.id === placeId);
  if (!place) return;
  page.classList.remove('training-scene-map-active');
  map.hidden = true;
  bar.hidden = false;
  page.dataset.trainingPlace = place.id;
  bar.querySelector('strong').textContent = place.name;
}
function showMap({ focus = false } = {}) {
  navigationRevision++;
  ensure();
  if (!page) return;
  delete page.dataset.trainingPlace;
  page.classList.add('training-scene-map-active');
  map.hidden = false;
  bar.hidden = true;
  document.body.classList.remove('ns-map-active');
  sync();
  window.resetTrainingScroll?.();
  if (focus) map.querySelector('.training-place:not(:disabled)')?.focus({ preventScroll: true });
}
function openPlace(place) {
  if (place.page) {
    window.openRaidHub?.();
    return;
  }
  const tab = place.tab === 'status' ? page.querySelector('#training-status-tab')
    : page.querySelector(`[data-training-tab="${place.tab}"]`);
  if (!tab) return;
  setDetail(place.id);
  tab.click();
  window.resetTrainingScroll?.();
  bar.querySelector('button').focus({ preventScroll: true });
}
async function animate(node, frames, duration) {
  if (!node.animate) return;
  const animation = node.animate(frames, { duration, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'forwards' });
  try { await animation.finished; } catch (_) {}
  animation.cancel();
}
async function enter(place, button) {
  if (running || !visible() || !unlocked(place)) return;
  const uid = getMainUser()?.uid;
  if (!uid) return;
  const revision = navigationRevision;
  const stillCurrent = () => revision === navigationRevision && visible() && unlocked(place) && uid === getMainUser()?.uid;
  running = true;
  map.setAttribute('aria-busy', 'true');
  let curtain;
  try {
    if (!reducedMotion()) {
      await animate(button, [{ transform: 'scale(1)' }, { transform: 'scale(1.065)', offset: .42 },
        { transform: 'scale(.985)', offset: .82 }, { transform: 'scale(1)' }], 230);
    }
    if (!stillCurrent()) return;
    if (reducedMotion()) { openPlace(place); return; }
    curtain = document.createElement('div');
    curtain.className = 'training-cloud-transition';
    curtain.setAttribute('aria-hidden', 'true');
    const mist = document.createElement('div');
    mist.className = 'training-cloud-mist';
    const clouds = ['left', 'right'].map(side => {
      const image = document.createElement('img');
      image.src = `assets/cloud-${side}.png`;
      image.alt = '';
      image.draggable = false;
      return image;
    });
    curtain.append(mist, ...clouds);
    document.body.appendChild(curtain);
    await Promise.all([
      animate(mist, [{ opacity: 0 }, { opacity: 1 }], 300),
      ...clouds.map((cloud, index) => animate(cloud, [
        { transform: `translateX(${index ? 102 : -102}%) scale(1.08)` },
        { transform: 'translateX(0) scale(1)' }
      ], 300))
    ]);
    if (!stillCurrent()) return;
    // Mount the destination while covered, then contract the clouds into its centre.
    openPlace(place);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await animate(curtain, [{ clipPath: 'circle(150% at 50% 50%)', opacity: 1, transform: 'scale(1)' },
      { clipPath: 'circle(0% at 50% 50%)', opacity: 0, transform: 'scale(.82)' }], 420);
  } finally {
    curtain?.remove();
    running = false;
    map?.removeAttribute('aria-busy');
  }
}
function makeButton(place, layout) {
  const region = layout.places[place.id];
  const [x, y, width, height] = region.bounds;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'training-place';
  button.dataset.trainingLocation = place.id;
  button.style.cssText = `left:${x / layout.width * 100}%;top:${y / layout.height * 100}%;width:${width / layout.width * 100}%;height:${height / layout.height * 100}%`;
  const svg = svgNode('svg', { viewBox: `${x} ${y} ${width} ${height}`, 'aria-hidden': 'true', focusable: 'false' });
  const id = `training-cutout-${orientation}-${place.id}`;
  const defs = svgNode('defs'), clip = svgNode('clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
  clip.appendChild(svgNode('path', { d: region.outline }));
  defs.appendChild(clip);
  const art = svgNode('g', { class: 'training-place-art' });
  art.appendChild(svgNode('image', { class: 'training-place-cutout', href: layout.image, x: 0, y: 0,
    width: layout.width, height: layout.height, 'clip-path': `url(#${id})`, preserveAspectRatio: 'none' }));
  art.appendChild(svgNode('path', { class: 'training-place-edge', d: region.outline }));
  svg.append(defs, art);
  const label = document.createElement('span');
  label.className = 'training-place-label';
  label.style.cssText = `left:${(region.label[0] - x) / width * 100}%;top:${(region.label[1] - y) / height * 100}%`;
  const name = document.createElement('span');
  name.textContent = place.name;
  const realm = document.createElement('small');
  realm.className = 'training-place-realm';
  realm.textContent = `${place.realm}解鎖`;
  label.append(name, realm);
  const lock = document.createElement('span');
  lock.className = 'training-place-lock';
  lock.setAttribute('aria-hidden', 'true');
  lock.style.cssText = `left:${(region.lock[0] - x) / width * 100}%;top:${(region.lock[1] - y) / height * 100}%`;
  lock.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="10" width="16" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3M12 15v3"/></svg>';
  button.append(svg, label, lock);
  button.addEventListener('click', () => void enter(place, button));
  return button;
}
function renderScene(next) {
  const focused = map.contains(document.activeElement) ? document.activeElement.dataset.trainingLocation : null;
  orientation = next;
  const layout = Layouts[next];
  map.dataset.orientation = next;
  plane.style.setProperty('--training-map-font', `${layout.font}px`);
  background = document.createElement('img');
  background.className = 'training-map-background';
  background.src = layout.image;
  background.alt = '';
  background.draggable = false;
  background.decoding = 'async';
  plane.replaceChildren(background, ...Rules.PLACES.map(place => makeButton(place, layout)));
  updateLocks();
  if (focused) plane.querySelector(`[data-training-location="${focused}"]:not(:disabled)`)?.focus({ preventScroll: true });
}
function updateLocks() {
  if (!plane) return;
  for (const place of Rules.PLACES) {
    const button = plane.querySelector(`[data-training-location="${place.id}"]`);
    if (!button) continue;
    const locked = !unlocked(place);
    button.disabled = locked;
    button.classList.toggle('is-locked', locked);
    button.setAttribute('aria-label', locked ? `${place.name}，${place.realm}解鎖` : `進入${place.name}`);
    button.querySelector('.training-place-realm').hidden = !locked;
    button.querySelector('.training-place-lock').hidden = !locked;
  }
}
function fit() {
  if (!map || map.hidden || !visible()) return;
  const header = document.querySelector('body > header');
  const nav = document.querySelector('#bottom-nav .glass-capsule');
  const top = Math.max(0, header?.getBoundingClientRect().bottom || 0);
  const navTop = nav?.getBoundingClientRect().top;
  const bottom = Number.isFinite(navTop) && navTop > top && navTop < innerHeight ? innerHeight - navTop + 4 : 0;
  page.style.setProperty('--training-scene-top', `${top}px`);
  page.style.setProperty('--training-scene-bottom', `${bottom}px`);
  const next = innerWidth >= innerHeight ? 'landscape' : 'portrait';
  if (orientation !== next) renderScene(next);
  const layout = Layouts[next], rect = map.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const scale = Math.max(rect.width / layout.width, rect.height / layout.height);
  const left = (rect.width - layout.width * scale) / 2, offset = (rect.height - layout.height * scale) / 2;
  plane.style.width = `${layout.width}px`;
  plane.style.height = `${layout.height}px`;
  plane.style.left = `${left}px`;
  plane.style.top = `${offset}px`;
  plane.style.transform = `scale(${scale})`;
}
function scheduleFit() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; fit(); });
}
function ensure() {
  const target = document.getElementById(PAGE);
  if (!target || target === page) return;
  resizeObserver?.disconnect();
  pageObserver?.disconnect();
  page = target;
  orientation = '';
  map = document.createElement('section');
  map.className = 'training-map';
  map.setAttribute('aria-label', '修煉場景');
  map.hidden = true;
  plane = document.createElement('div');
  plane.className = 'training-map-plane';
  map.appendChild(plane);
  bar = document.createElement('div');
  bar.className = 'training-scene-detailbar';
  bar.hidden = true;
  bar.innerHTML = '<button type="button" class="training-scene-back" aria-label="返回修煉場景"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>修煉</span></button><strong></strong>';
  bar.querySelector('button').addEventListener('click', () => showMap({ focus: true }));
  page.prepend(map, bar);
  resizeObserver = new ResizeObserver(scheduleFit);
  resizeObserver.observe(map);
  const header = document.querySelector('body > header'), nav = document.querySelector('#bottom-nav .glass-capsule');
  if (header) resizeObserver.observe(header);
  if (nav) resizeObserver.observe(nav);
  pageObserver = new MutationObserver(scheduleFit);
  pageObserver.observe(page, { attributes: true, attributeFilter: ['class'] });
}
function wrapNavigation() {
  const base = window.switchToPage;
  if (typeof base !== 'function' || base === navigation) return;
  navigation = function (id, ...args) {
    const wasVisible = visible();
    if (id !== PAGE) navigationRevision++;
    const result = base.call(this, id, ...args);
    if (id === PAGE && visible() && !wasVisible) showMap();
    return result;
  };
  window.switchToPage = navigation;
}
function sync() {
  ensure();
  wrapNavigation();
  updateLocks();
  scheduleFit();
}
function boot() {
  loadStyle();
  ensure();
  if (visible()) showMap();
  document.addEventListener('click', event => {
    const target = event.target.closest?.('#nav-training,[data-target="page-training"],[data-training-tab],#training-status-tab');
    if (!target) return;
    if (target.id === 'nav-training' || target.dataset.target === PAGE) showMap();
    else if (target.closest(`#${PAGE}`)) setDetail(tabPlace[target.dataset.trainingTab || 'status']);
  }, true);
  ['xiuxian:user-ready', 'xiuxian:stats-updated', 'xiuxian:features-ready', 'xiuxian:training-access-updated',
    'foundation-training-stage-changed', 'golden-core-access-changed'].forEach(name => window.addEventListener(name, sync));
  window.addEventListener('resize', scheduleFit, { passive: true });
  sync();
}
window.openTrainingSceneMap = showMap;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();

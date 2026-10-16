import './training-access-rules.js';
import './nascent-growth.js';
import './training-scene-layer-art.js';
import './training-scene-layouts.js';
import { getMainUser } from './data/project-repository.js';

const Rules = globalThis.QATrainingAccessRules;
const Layouts = globalThis.QATrainingSceneLayouts;
const SVG = 'http://www.w3.org/2000/svg';
const PAGE = 'page-training';
const tabPlace = { core: 'meditation', 'nascent-soul': 'meditation', refinery: 'forge', bag: 'vault', equipment: 'vault', contract: 'contract', status: 'status' };
const DETAIL_TABS = [
  { id: 'core', name: '金丹', icon: 'fa-circle-dot', threshold: 28, unlock: '金丹境解鎖' },
  { id: 'nascent-soul', name: '元嬰', icon: 'fa-child-reaching', threshold: 68, unlock: '元嬰境解鎖' },
  { id: 'refinery', name: '煉器', icon: 'fa-hammer', threshold: 10, unlock: '築基期解鎖' },
  { id: 'contract', name: '契器', icon: 'fa-dharmachakra', threshold: 28, unlock: '金丹境解鎖' },
  { id: 'equipment', name: '裝備', icon: 'fa-shield-halved', threshold: 10, unlock: '築基期解鎖' },
  { id: 'bag', name: '背包', icon: 'fa-box-open', threshold: 10, unlock: '築基期解鎖' }
];
let page, map, scenery, plane, bar, background, resizeObserver, pageObserver;
let orientation = '', scheduled = false, running = false, navigation = null;
let navigationRevision = 0;
let pageNavigation = null;
let committingPageNavigation = false;
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
  link.href = 'styles/training-scene-map.css?v=20261016-forge-ready';
  document.head.appendChild(link);
}
function setDetail(placeId) {
  if (!page) return;
  const place = placeId === 'contract' ? { id: 'contract', name: '契器台' } : Rules.PLACES.find(place => place.id === placeId);
  if (!place) return;
  // Tutorials may select their tab immediately after requesting this page.
  // Preserve that selection when the deferred page change is committed.
  if (pageNavigation?.isCurrent()) pageNavigation.place = place.id;
  page.classList.remove('training-scene-map-active');
  map.hidden = true;
  bar.hidden = false;
  page.dataset.trainingPlace = place.id;
  bar.querySelector('strong').textContent = place.name;
  updateDetailTabs();
}
function updateDetailTabs() {
  if (!page) return;
  const list = page.querySelector('.training-subtabs-v3');
  if (!list) return;
  const score = window.getTrainingAccessScore?.() ?? Rules.score(window.getCurrentUserData?.());
  const buttons = DETAIL_TABS.map(def => {
    let button = list.querySelector(`[data-training-tab="${def.id}"]`);
    if (!button) {
      // Early accounts have only a Status shell. Reserve the same native tabs
      // now; Foundation/Golden Core bind their usual handlers when unlocked.
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'training-subtab-v3';
      button.dataset.trainingTab = def.id;
      button.setAttribute('aria-selected', 'false');
      button.innerHTML = `<i class="fa-solid ${def.icon}" aria-hidden="true"></i><span>${def.name}</span>`;
    }
    const locked = score < def.threshold || (def.id === 'core' && window.isGoldenCoreUnlocked?.() === false);
    button.hidden = false;
    button.classList.remove('hidden');
    button.disabled = locked;
    button.classList.toggle('is-locked', locked);
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-disabled', String(locked));
    button.setAttribute('aria-label', locked ? `${def.name}，${def.unlock}` : def.name);
    button.title = locked ? def.unlock : '';
    return button;
  });
  const status = list.querySelector('#training-status-tab');
  if (status) buttons.push(status);
  // Avoid moving unchanged nodes and disturbing focus or observer-driven UI.
  if (buttons.some((button, i) => list.children[i] !== button)) list.append(...buttons);
  page.classList.remove('training-single-tab');
}
function showMap({ focus = false } = {}) {
  navigationRevision++;
  ensure();
  if (!page) return;
  delete page.dataset.trainingPlace;
  page.classList.remove('training-single-tab');
  page.classList.add('training-scene-map-active');
  map.hidden = false;
  bar.hidden = true;
  document.body.classList.remove('ns-map-active');
  sync();
  window.resetTrainingScroll?.();
  if (focus) map.querySelector('.training-place:not(:disabled)')?.focus({ preventScroll: true });
}
function openPlace(place, selectedTab = place.tab) {
  if (place.page) {
    window.openRaidHub?.();
    return;
  }
  const tab = selectedTab === 'status' ? page.querySelector('#training-status-tab')
    : page.querySelector(`[data-training-tab="${selectedTab}"]`);
  if (!tab) return;
  setDetail(place.id);
  tab.click();
  window.resetTrainingScroll?.();
  bar.querySelector('button').focus({ preventScroll: true });
}
async function animate(node, frames, duration) {
  if (!node.animate) return;
  const animation = node.animate(frames, { duration, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'both' });
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
  try {
    if (!reducedMotion()) {
      await animate(button, [{ transform: 'scale(1)' }, { transform: 'scale(1.065)', offset: .42 },
        { transform: 'scale(.985)', offset: .82 }, { transform: 'scale(1)' }], 230);
      if (!stillCurrent()) return;
      await window.playStartupCloudCurtain(() => openPlace(place), { isCurrent: stillCurrent, blockInput: true });
    } else if (stillCurrent()) openPlace(place);
  } finally {
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
  // AI-derived alpha retains roof curls, railings and fine details. The same
  // sprite is shared by both maps, with no hand-drawn polygon or stroke.
  const art = document.createElement('span');
  art.className = 'training-place-art';
  art.style.height = `${(region.label[1] - y - layout.font * 1.06) / height * 100}%`;
  const sprite = region.sprite;
  for (const layer of ['aura', 'cutout']) {
    const svg = svgNode('svg', { viewBox: sprite.crop.join(' '), 'aria-hidden': 'true',
      focusable: 'false', preserveAspectRatio: 'xMidYMax meet', class: `training-place-${layer}` });
    svg.appendChild(svgNode('image', { href: sprite.image, x: 0, y: 0,
      width: sprite.width, height: sprite.height }));
    art.appendChild(svg);
  }
  const label = document.createElement('span');
  label.className = 'training-place-label';
  // Anchor the name below the artwork. Adding an unlock line extends the
  // plaque downward instead of moving the name up over the building.
  label.style.cssText = `left:${(region.label[0] - x) / width * 100}%;top:${(region.label[1] - y - layout.font * .84) / height * 100}%`;
  const name = document.createElement('span');
  name.className = 'training-place-name';
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
  button.append(art, label, lock);
  button.addEventListener('click', () => void enter(place, button));
  return button;
}
function makeMotes() {
  const motes = document.createElement('div');
  motes.className = 'training-map-motes';
  motes.setAttribute('aria-hidden', 'true');
  // Fixed, sparse positions make the atmosphere consistent after every visit.
  const positions = [[12,35], [23,57], [32,43], [42,24], [51,48], [58,69],
    [65,31], [73,54], [82,38], [89,72], [38,77], [16,81]];
  for (const [index, [x, y]] of positions.entries()) {
    const mote = document.createElement('span');
    mote.className = 'training-map-mote';
    mote.style.cssText = `left:${x}%;top:${y}%;--mote-size:${index % 3 === 0 ? 5 : 3}px;--mote-drift:${index % 2 ? -15 : 18}px;--mote-duration:${12 + index % 5 * 2}s;--mote-delay:${-index * 1.7}s`;
    motes.appendChild(mote);
  }
  return motes;
}
function makeSceneryLayers(layout) {
  return layout.layers.map(layer => {
    const image = document.createElement('img');
    image.className = `training-map-layer training-map-${layer.id}`;
    image.src = layer.image;
    image.alt = '';
    image.draggable = false;
    image.decoding = 'async';
    image.dataset.sceneLayer = layer.id;
    const [x, y, width, height] = layer.bounds;
    image.style.cssText = `left:${x / layout.width * 100}%;top:${y / layout.height * 100}%;width:${width / layout.width * 100}%;height:${height / layout.height * 100}%`;
    if (layer.kind !== 'cloud') return image;
    // Animate the transparent bank rather than its mountain occlusion layer.
    // Overscan lets it drift without exposing a hard edge on either side.
    const bank = document.createElement('div');
    bank.className = `training-map-cloud training-map-cloud-${layer.motion}`;
    bank.dataset.cloudDepth = layer.id;
    image.className = 'training-map-layer';
    bank.appendChild(image);
    const band = document.createElement('div');
    band.className = `training-map-cloud-band training-map-band-${layer.band || 'full'}`;
    band.appendChild(bank);
    return band;
  });
}
function renderScene(next) {
  const focused = map.contains(document.activeElement) ? document.activeElement.dataset.trainingLocation : null;
  orientation = next;
  const layout = Layouts[next];
  map.dataset.orientation = next;
  plane.style.setProperty('--training-map-font', `${layout.font}px`);
  scenery.style.backgroundImage = `url("${layout.image}")`;
  scenery.replaceChildren(...makeSceneryLayers(layout));
  background = document.createElement('img');
  background.className = 'training-map-background';
  background.src = layout.image;
  background.alt = '';
  background.draggable = false;
  background.decoding = 'async';
  plane.replaceChildren(background, makeMotes(), ...Rules.PLACES.map(place => makeButton(place, layout)));
  updateLocks();
  if (focused) plane.querySelector(`[data-training-location="${focused}"]:not(:disabled)`)?.focus({ preventScroll: true });
}
function updateLocks() {
  if (!plane) { updateTicketIndicators(); return; }
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
  updateTicketIndicators();
}
function updateTicketIndicators() {
  const player = window.getCurrentUserData?.(), uid = getMainUser()?.uid;
  const secret = Rules.PLACES.find(place => place.id === 'secret');
  const accountReady = !!uid && !!player?.stats && (!player.uid || player.uid === uid);
  const ready = accountReady && unlocked(secret) && Number(player.raidTickets?.count) >= 1;
  const forgeJob = accountReady ? player.refineryJobV1 : null;
  const forgeReady = !!(forgeJob?.id && Number(forgeJob.readyAtMs || 0) <= Date.now());
  const growth = globalThis.QANascentGrowth;
  const canUpgrade = !!(accountReady && growth?.branches(player.cultivationTraining?.equippedCore)
    .some(branch => growth.status(player, branch.id).ok));
  const building = plane?.querySelector('[data-training-location="secret"]');
  const nav = document.getElementById('nav-training');
  const home = document.getElementById('sect-raid-entry');
  for (const [button, host] of [[nav, nav?.querySelector('.training-nav-orb')],
    [building, building?.querySelector('.training-place-label')], [home, home]]) {
    if (!button || !host) continue;
    let dot = host.querySelector('.raid-ticket-dot');
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'raid-ticket-dot';
      dot.setAttribute('aria-hidden', 'true');
      host.appendChild(dot);
    }
    const pending = button === nav ? ready || canUpgrade || forgeReady : ready;
    dot.hidden = !pending;
    const description = [ready ? '尚有團本入場券，可挑戰秘境試煉' : '', button === nav && canUpgrade ? '元嬰有分支可升級' : '', button === nav && forgeReady ? '煉器已完成，可立即開爐' : ''].filter(Boolean).join('；');
    if (pending) button.setAttribute('aria-description', description);
    else button.removeAttribute('aria-description');
  }
  // Forge completion is distinct from raid tickets and nascent upgrades.
  // Keep a dot on the forge building and on the refinery detail tab.
  const forgeCandidate = plane?.querySelector('[data-training-location="forge"]');
  const forge = forgeCandidate?.dataset?.trainingLocation === 'forge' ? forgeCandidate : null;
  const forgeTab = document.querySelector?.('#page-training [data-training-tab="refinery"]');
  for (const [button, host] of [[forge, forge?.querySelector('.training-place-label')], [forgeTab, forgeTab]]) {
    if (!button || !host) continue;
    let dot = host.querySelector('.refinery-ready-dot');
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'refinery-ready-dot';
      dot.setAttribute('aria-hidden', 'true');
      host.appendChild(dot);
    }
    dot.hidden = !forgeReady;
    if (forgeReady) button.setAttribute('aria-description', '煉器完成，請前往八方煉器陣開爐');
    else button.removeAttribute('aria-description');
  }
  if (growth) {
    const room = plane?.querySelector('[data-training-location="meditation"]');
    const soulTab = document.querySelector?.('#page-training [data-training-tab="nascent-soul"]');
    for (const [button, host] of [[room, room?.querySelector('.training-place-label')], [soulTab, soulTab]]) {
      if (!button || !host) continue;
      let dot = host.querySelector('.nascent-upgrade-dot');
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'nascent-upgrade-dot';
        dot.setAttribute('aria-hidden', 'true');
        host.appendChild(dot);
      }
      dot.hidden = !canUpgrade;
      if (canUpgrade) button.setAttribute('aria-description', '元嬰有分支可升級');
      else button.removeAttribute('aria-description');
    }
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
  const next = innerWidth >= innerHeight ? 'landscape' : 'portrait';
  if (orientation !== next) renderScene(next);
  const layout = Layouts[next], rect = map.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  // The plate continues beneath navigation; targets keep the same safe area.
  const availableHeight = Math.max(1, rect.height - bottom);
  const scale = Math.max(rect.width / layout.width, availableHeight / layout.height);
  const left = (rect.width - layout.width * scale) / 2, offset = (availableHeight - layout.height * scale) / 2;
  plane.style.width = `${layout.width}px`;
  plane.style.height = `${layout.height}px`;
  plane.style.left = `${left}px`;
  plane.style.top = `${offset}px`;
  plane.style.transform = `scale(${scale})`;
  // Extend the plate's lower edge just enough to reach the canvas bottom,
  // without scaling or moving the buildings, labels, or their hit areas.
  scenery.style.width = `${layout.width}px`;
  scenery.style.height = `${Math.max(layout.height, (rect.height - offset + 1) / scale)}px`;
  scenery.style.left = `${left}px`;
  scenery.style.top = `${offset}px`;
  scenery.style.transform = `scale(${scale})`;
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
  scenery = document.createElement('div');
  scenery.className = 'training-map-scenery';
  scenery.setAttribute('aria-hidden', 'true');
  const atmosphere = document.createElement('div');
  atmosphere.className = 'training-map-atmosphere';
  atmosphere.setAttribute('aria-hidden', 'true');
  for (const layer of ['light', 'mist-far', 'mist-near']) {
    const node = document.createElement('span');
    node.className = `training-map-${layer}`;
    atmosphere.appendChild(node);
  }
  plane = document.createElement('div');
  plane.className = 'training-map-plane';
  map.append(scenery, atmosphere, plane);
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
    // Another navigation wrapper may call an older copy of this wrapper.
    // Committing behind the curtain must reach the original synchronous route.
    if (id === PAGE && committingPageNavigation) return base.call(this, id, ...args);
    const wasVisible = visible();
    if (id !== PAGE) navigationRevision++;
    const uid = getMainUser()?.uid;
    if (id === PAGE && pageNavigation?.isCurrent()) return pageNavigation.promise;
    const alreadyCovered = document.getElementById('startup-cloud-curtain')?.classList.contains('is-closed');
    if (id === PAGE && page?.isConnected && !wasVisible && uid &&
        !alreadyCovered && !document.hidden && !reducedMotion() &&
        typeof window.playStartupCloudCurtain === 'function') {
      const origin = document.querySelector('.page-section.active-page');
      const revision = ++navigationRevision;
      const pending = { isCurrent: () => revision === navigationRevision &&
        uid === getMainUser()?.uid && document.querySelector('.page-section.active-page') === origin };
      // Keep the source visible until both startup cloud banks are closed.
      // Repeated clicks share this request; another page/account cancels it.
      pending.promise = window.playStartupCloudCurtain(() => {
        committingPageNavigation = true;
        try {
          const result = base.call(this, id, ...args);
          if (visible()) {
            showMap();
            const destination = Rules.PLACES.find(place => place.id === pending.place);
            if (destination && unlocked(destination)) openPlace(destination, pending.tab);
          }
          return result;
        } finally { committingPageNavigation = false; }
      }, { isCurrent: pending.isCurrent, blockInput: true }).catch(error => {
        console.warn('[Training navigation]', error);
        return false;
      }).finally(() => {
        if (pageNavigation === pending) pageNavigation = null;
      });
      pageNavigation = pending;
      return pending.promise;
    }
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
  updateDetailTabs();
  scheduleFit();
}
function boot() {
  loadStyle();
  ensure();
  if (visible()) showMap();
  document.addEventListener('click', event => {
    const target = event.target.closest?.('#nav-training,[data-target="page-training"],[data-training-tab],#training-status-tab');
    if (!target) return;
    if (target.disabled) return;
    // Navigation resets the map behind the closed curtain, not on pointerdown.
    if (target.id === 'nav-training' || target.dataset.target === PAGE) {
      if (visible()) showMap();
      return;
    }
    if (pageNavigation?.isCurrent()) pageNavigation.tab = target.dataset.trainingTab || 'status';
    if (target.closest(`#${PAGE}`)) setDetail(tabPlace[target.dataset.trainingTab || 'status']);
  }, true);
  ['xiuxian:user-data-ready', 'xiuxian:user-ready', 'xiuxian:stats-updated', 'xiuxian:features-ready', 'xiuxian:training-access-updated',
    'foundation-training-stage-changed', 'golden-core-access-changed'].forEach(name => window.addEventListener(name, sync));
  window.addEventListener('xiuxian:raid-tickets-updated', updateTicketIndicators);
  window.addEventListener('material-system-updated', updateTicketIndicators);
  window.addEventListener('golden-core-equipped-changed', updateTicketIndicators);
  window.addEventListener('xiuxian:refinery-job-updated', updateTicketIndicators);
  // Readiness changes with wall-clock time even if the player never opens the forge.
  setInterval(updateTicketIndicators, 10000);
  const navGrid = document.getElementById('nav-grid');
  if (navGrid) new MutationObserver(updateTicketIndicators).observe(navGrid, { childList:true });
  window.addEventListener('resize', scheduleFit, { passive: true });
  sync();
}
window.openTrainingSceneMap = showMap;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();

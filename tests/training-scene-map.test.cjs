'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Rules = require('../public/cultivation/training-access-rules.js');
const Layouts = require('../public/cultivation/training-scene-layouts.js');
const Growth = require('../public/cultivation/nascent-growth.js');
const Authority = require('../raid-authority.cjs');

test('reduced-motion training navigation stays synchronous and inside the document', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/training-scene-map.js'), 'utf8');
  const from = source.indexOf('function wrapNavigation() {');
  const to = source.indexOf('\nfunction sync() {', from);
  let current = 'page-home', mapVisits = 0, calls = 0;
  const page = { isConnected: true };
  const window = {
    switchToPage(id) { calls++; current = id; return id; },
    playStartupCloudCurtain() { throw new Error('Tab navigation must never reuse startup'); }
  };
  Object.defineProperty(window, 'location', { get() { throw new Error('Navigation must not reload the document'); } });
  const context = { window, PAGE: 'page-training', page, navigation: null, navigationRevision: 0, entryCheck: 0,
    pageNavigation: null, committingPageNavigation: false,
    getMainUser: () => ({ uid: 'u1' }), document: { getElementById: () => null, hidden: false }, reducedMotion: () => true,
    markTrainingEntry() {}, markTrainingStable() {}, markTrainingExit() {}, setTimeout() {}, clearTimeout() {},
    visible: () => current === 'page-training', showMap: () => mapVisits++ };
  vm.createContext(context);
  vm.runInContext(source.slice(from, to) + '\nwrapNavigation();', context);
  const wrapped = window.switchToPage;
  for (let i = 0; i < 25; i++) {
    assert.equal(window.switchToPage('page-training'), 'page-training');
    assert.equal(current, 'page-training', 'the destination commits synchronously');
    vm.runInContext('wrapNavigation();', context);
    assert.equal(window.switchToPage, wrapped, 'sync cannot stack navigation wrappers');
    window.switchToPage('page-home');
  }
  assert.equal(mapVisits, 25);
  assert.equal(calls, 50);
});

test('new accounts see Status; existing Foundation and Golden Core gates are at 6 and 28', () => {
  const player = { stats: { totalScore: 0 } };
  assert.deepEqual(Rules.PLACES.filter(place => Rules.allows(player, place.threshold)).map(place => place.id), ['status', 'rank']);
  player.stats.totalScore = 6;
  assert.deepEqual(Rules.PLACES.filter(place => Rules.allows(player, place.threshold)).map(place => place.id), ['forge', 'contract', 'vault', 'secret', 'status', 'rank']);
  player.stats.totalScore = 28;
  assert.equal(Rules.PLACES.every(place => Rules.allows(player, place.threshold)), true);
});

test('compact contract entrance sits beside the forge and opens its existing tab', () => {
  const contract = Rules.PLACES.find(place => place.id === 'contract');
  assert.equal(contract.name, '尋器');
  assert.equal(contract.threshold, 6);
  for (const layout of Object.values(Layouts)) {
    const forge = layout.places.forge.bounds, altar = layout.places.contract.bounds;
    assert.ok(altar[2] < forge[2]);
    assert.ok(altar[0] >= forge[0] + forge[2]);
    assert.ok(altar[0] - forge[0] - forge[2] < layout.width * .03);
  }
  const calls = [], source = fs.readFileSync(path.join(__dirname, '../public/cultivation/training-scene-map.js'), 'utf8');
  const context = { window: { resetTrainingScroll() {} },
    page: { querySelector(selector) { assert.equal(selector, '[data-training-tab="contract"]'); return { click: () => calls.push('contract') }; } },
    setDetail: id => calls.push(id), bar: { querySelector: () => ({ focus() {} }) } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function openPlace('), source.indexOf('\nasync function animate')) + '\nthis.openPlace = openPlace;', context);
  context.openPlace(contract);
  assert.deepEqual(calls, ['contract', 'contract']);
});

test('entrance unlocks are monotonic through deductions and remote account restores', () => {
  const player = { stats: { totalScore: 68, gold: 500 } };
  player.trainingAccess = Rules.record(player);
  player.stats.totalScore = 0;
  const restored = JSON.parse(JSON.stringify(player));
  assert.equal(Rules.score(restored), 68);
  assert.equal(Rules.PLACES.every(place => Rules.allows(restored, place.threshold)), true);
  assert.equal(restored.stats.totalScore, 0);
  assert.equal(restored.stats.gold, 500);
  assert.deepEqual(Rules.record(restored, 10), { version: 1, highestRealmScore: 68 });
});

test('legacy access requires an announced saved core, not a generated default preview', () => {
  const player = { stats: { totalScore: 0 }, cultivationTraining: { core: { type: 'taichu' }, equippedCore: { type: 'taichu' } } };
  assert.equal(Rules.score(player), 0);
  player.cultivationTraining.announced = true;
  assert.equal(Rules.score(player), 28);
  player.nascentSoulGrowth = { version: 1, branches: { attack: 1 } };
  assert.equal(Rules.score(player), 68);
  assert.equal(Rules.realmScore(Infinity), 0);
  assert.equal(Rules.savedScore({ trainingAccess: { version: 9, highestRealmScore: 68 } }), 0);
});

test('previously unlocked soul upgrades and trusted combat core remain usable after a deduction', () => {
  const player = { stats: { totalScore: 0, attack: 200, maxHp: 1000 },
    trainingAccess: { version: 1, highestRealmScore: 68 },
    cultivationTraining: { equippedCore: { type: 'sword', grade: 5 } },
    nascentSoulGrowth: { version: 1, branches: { attack: 1 } },
    materialSystem: { inventory: { [Growth.ITEM_ID]: 5 } } };
  assert.equal(Growth.status(player, 'attack').ok, true);
  assert.equal(Growth.upgrade(player, 'attack').growth.branches.attack, 2);
  const combat = Authority.trustedRaidPlayerSnapshot(player, 'u1');
  assert.equal(combat.goldenCore.type, 'sword');
  assert.equal(combat.totalScore, 0);
  assert.equal(combat.atk, 204);
  delete player.trainingAccess;
  assert.equal(Growth.status(player, 'attack').ok, false);
  assert.equal(Authority.trustedRaidPlayerSnapshot(player, 'u1').goldenCore, null);
});

test('both clean scene plates match their assets and contain non-overlapping targets', () => {
  for (const [name, layout] of Object.entries(Layouts)) {
    const file = fs.readFileSync(path.join(__dirname, '../public', layout.image.replace(/\.webp$/, '.png')));
    assert.equal(file.readUInt32BE(16), layout.width, `${name} image width`);
    assert.equal(file.readUInt32BE(20), layout.height, `${name} image height`);
    assert.ok(Math.abs(layout.width / layout.height - (name === 'portrait' ? 9 / 16 : 16 / 9)) < .001);
    assert.deepEqual(Object.keys(layout.places).sort(), Rules.PLACES.map(place => place.id).sort());
    const regions = Object.values(layout.places);
    for (const region of regions) {
      const sprite = region.sprite;
      const pngPath = path.join(__dirname, '../public', sprite.image.replace(/\.webp$/, '.png'));
      if (fs.existsSync(pngPath)) {
        const png = fs.readFileSync(pngPath);
        assert.equal(png.readUInt32BE(16), sprite.width);
        assert.equal(png.readUInt32BE(20), sprite.height);
        assert.equal(png[25], 6, 'each AI building asset must have a real RGBA alpha channel');
      } else {
        const webp = fs.readFileSync(path.join(__dirname, '../public', sprite.image));
        assert.equal(webp.toString('ascii', 12, 16), 'VP8X');
        assert.equal(webp.readUIntLE(24, 3) + 1, sprite.width);
        assert.equal(webp.readUIntLE(27, 3) + 1, sprite.height);
        assert.ok(webp[20] & 0x10, 'generated WebP must retain transparency');
      }
      const [sx, sy, sw, sh] = sprite.crop;
      assert.ok(sx >= 0 && sy >= 0 && sw > 0 && sh > 0 && sx + sw <= sprite.width && sy + sh <= sprite.height);
      const [x, y, width, height] = region.bounds;
      assert.ok(x >= 0 && y >= 0 && x + width <= layout.width && y + height <= layout.height);
      for (const point of [region.label, region.lock]) {
        assert.ok(point[0] > x && point[0] < x + width && point[1] > y && point[1] < y + height);
      }
    }
    for (let a = 0; a < regions.length; a++) for (let b = a + 1; b < regions.length; b++) {
      const [ax, ay, aw, ah] = regions[a].bounds, [bx, by, bw, bh] = regions[b].bounds;
      const overlapWidth = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
      const overlapHeight = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
      assert.ok(overlapWidth * overlapHeight < Math.min(aw * ah, bw * bh) * .02, `${name} targets overlap`);
    }
  }
  for (const id of Rules.PLACES.map(place => place.id)) {
    assert.equal(Layouts.landscape.places[id].sprite, Layouts.portrait.places[id].sprite,
      'both orientations share the same extracted building and its aspect ratio');
  }
});

test('the actual scene reaches the stage bottom while names and locks avoid header and navigation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/training-scene-map.js'), 'utf8');
  const fit = source.slice(source.indexOf('function fit() {'), source.indexOf('\nfunction scheduleFit()'));
  const cases = [[320,568,64,64],[360,640,64,72],[390,844,72,80],[430,932,72,80],
    [360,640,0,96],[1280,720,72,96],[1888,1062,106,140],
    [768,1024,72,80],[844,390,56,64],[1024,768,72,80],[1366,768,72,80],[1920,1080,80,88]];
  for (const [width,height,header,nav] of cases) {
    const orientation = width >= height ? 'landscape' : 'portrait', layout = Layouts[orientation];
    const properties = {}, style = { setProperty() {} };
    const labels = Rules.PLACES.map(place => {
      const region=layout.places[place.id],font=layout.font*1.08;
      const w=Math.max(place.name.length*font*1.08,(place.realm+'解鎖').length*font*.6*1.02)+font*1.5+2;
      const h=font*(1.25+.33+.6*1.25+.07)+2;
      let lift=0;
      return { place, style:{setProperty(_name,value){lift=parseFloat(value);}},
        getBoundingClientRect(){
          const scale=Number(properties.transform.match(/scale\(([^)]+)\)/)[1]);
          const left=parseFloat(properties.left)+(region.label[0]-w/2)*scale;
          const top=parseFloat(properties.top)+(region.label[1]-layout.font*.84+lift)*scale;
          return {left,top,right:left+w*scale,bottom:top+h*scale};
        }};
    });
    const context = { map: { hidden:false, getBoundingClientRect:()=>({width,height}) },
      page: { style }, plane: { style:properties,querySelectorAll:()=>labels }, scenery: { style:{} },
      document: { querySelector: selector => ({ getBoundingClientRect: () => selector.includes('header') ? {bottom:header} : {top:height-nav} }) },
      visible:()=>true, innerWidth:width, innerHeight:height, orientation, Layouts,
      renderScene:()=>assert.fail('unchanged orientation must not rebuild the map') };
    vm.createContext(context);vm.runInContext(fit+'\nfit();',context);
    assert.equal(context.scenery.style.height, `${layout.height}px`, 'terrain must not stretch away from the buttons');
    assert.equal(context.scenery.style.transform, properties.transform);
    const scale = Number(properties.transform.match(/scale\(([^)]+)\)/)[1]);
    const left = parseFloat(properties.left), top = parseFloat(properties.top);
    assert.ok(Math.abs(top+layout.height*scale-height)<.01,'the island/cloud canvas itself must end at the stage bottom, behind navigation');
    assert.equal(scale,Math.min(width/layout.width,height/layout.height),'navigation cannot shrink the artwork');
    const check = (r,label) => {
      assert.ok(left+r[0]*scale >= -.01 && top+r[1]*scale >= -.01, `${width}×${height} ${label} clipped at top/left`);
      assert.ok(left+(r[0]+r[2])*scale <= width+.01 && top+(r[1]+r[3])*scale <= height+.01, `${width}×${height} ${label} clipped at bottom/right`);
    };
    const plaques = [];
    for (const place of Rules.PLACES) {
      const region = layout.places[place.id];check(region.bounds,place.name);
      const actual=labels.find(label=>label.place.id===place.id).getBoundingClientRect();
      assert.ok(actual.top>=header+4-.01 && actual.bottom<=height-nav-4+.01,place.name+'名稱及解鎖提示必須避開導覽與頁首');
      assert.ok(actual.left>=-.01 && actual.right<=width+.01);
      plaques.push([actual.left,actual.top,actual.right-actual.left,actual.bottom-actual.top]);
    }
    for (let a=0;a<plaques.length;a++)for(let b=a+1;b<plaques.length;b++){
      const [x,y,w,h]=plaques[a],[xx,yy,ww,hh]=plaques[b];
      assert.ok(x+w<=xx||xx+ww<=x||y+h<=yy||yy+hh<=y,`${width}×${height} name plaques overlap`);
    }
  }
});

function accessRuntime() {
  const remote = new Map(), cache = new Map(), events = new Map();
  let uid = 'u1', player = { uid, stats: { totalScore: 0 } }, operations = 0;
  remote.set(uid, structuredClone(player));
  const patch = (source, changes) => ({ ...source, ...structuredClone(changes) });
  const context = {
    QATrainingAccessRules: Rules, Map, Math, Number, console: { warn() {} },
    getMainUser: () => uid ? { uid } : null,
    getProjectServices: async () => ({ db: {} }),
    doc: (_db, _collection, id) => id,
    runTransaction: async (_db, worker) => {
      operations++;
      return worker({ get: async id => ({ exists: () => remote.has(id), data: () => structuredClone(remote.get(id)) }),
        update(id, changes) { remote.set(id, patch(remote.get(id), changes)); } });
    },
    localStorage: { getItem: key => cache.get(key), setItem: (key, value) => cache.set(key, value) },
    setTimeout, clearTimeout, CustomEvent: class { constructor(type) { this.type = type; } },
    getCurrentUserData: () => player,
    addEventListener: (name, fn) => { const list = events.get(name) || []; list.push(fn); events.set(name, list); },
    dispatchEvent: event => { for (const fn of events.get(event.type) || []) fn(event); }
  };
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/training-access.js'), 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInContext(source, context);
  return { context, remote, cache,
    async flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); },
    current() { return player; }, operations: () => operations,
    switchAccount(next, value) { uid = next; player = value; if (value && !remote.has(next)) remote.set(next, structuredClone(value)); },
    emit() { context.dispatchEvent(new context.CustomEvent('xiuxian:stats-updated')); }
  };
}

test('live unlocks persist observed realms even if cultivation drops before the transaction reads', async () => {
  const runtime = accessRuntime();
  await runtime.flush();
  runtime.current().stats.totalScore = 68;
  runtime.emit();
  runtime.current().stats.totalScore = 0;
  await runtime.flush();
  assert.equal(runtime.remote.get('u1').trainingAccess.highestRealmScore, 68);
  assert.equal(runtime.context.getTrainingAccessScore(), 68);
  const count = runtime.operations();
  runtime.emit();
  await runtime.flush();
  assert.equal(runtime.operations(), count, 'ordinary updates cannot repeatedly write the unlock record');
});

test('a new device merges a higher remote unlock and account switching never borrows its cache', async () => {
  const runtime = accessRuntime();
  runtime.remote.get('u1').trainingAccess = { version: 1, highestRealmScore: 188 };
  await runtime.flush();
  assert.equal(runtime.context.getTrainingAccessScore(), 188);
  runtime.switchAccount('u2', { uid: 'u2', stats: { totalScore: 0 } });
  runtime.emit();
  await runtime.flush();
  assert.equal(runtime.context.getTrainingAccessScore(), 0);
  assert.equal(runtime.context.isTrainingPlaceUnlocked('meditation'), false);
  runtime.switchAccount('u3', { uid: 'u1', stats: { totalScore: 188 } });
  assert.equal(runtime.context.getTrainingAccessScore(), 0, 'stale profile during auth change is not an unlock');
});

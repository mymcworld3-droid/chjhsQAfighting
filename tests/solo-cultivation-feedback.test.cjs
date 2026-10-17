const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '../public/cultivation', file), 'utf8');
const rules = vm.runInNewContext(read('solo-cultivation-feedback.js').replace(/^export /gm, '') +
  '\n({cultivationOrbProfile,cultivationProgress})', { window: {} });
const realms = [{name:'凡人',need:0},{name:'煉氣',need:1},{name:'築基',need:10},
  {name:'金丹',need:28},{name:'半仙',need:1868},{name:'真仙',need:1868}];

test('larger verified gains grow comet count, radius and tail while bounding particle cost', () => {
  const small = rules.cultivationOrbProfile(1), large = rules.cultivationOrbProfile(10);
  for (const key of ['count','radius','tail']) assert.ok(large[key] > small[key]);
  assert.equal(rules.cultivationOrbProfile(100000).count, 12);
});

test('progress fills the previous realm before carrying excess cultivation into the new realm', () => {
  const initial = rules.cultivationProgress(26, realms);
  const full = rules.cultivationProgress(31, realms, initial.index);
  assert.equal(full.ratio, 1);
  assert.equal(full.realm.name, '築基');
  const carried = rules.cultivationProgress(31, realms);
  assert.equal(carried.realm.name, '金丹');
  assert.equal(carried.earned, 3);
  const top = rules.cultivationProgress(2000, realms);
  assert.equal(top.ratio, 1);
  assert.equal(top.next, undefined);
  assert.ok(Number.isFinite(top.ratio));
});

test('realm observers defer breakthroughs until absorption ends, including the explicit first-answer path', async () => {
  const listeners = new Map(), events = [], overlays = new Map();
  let score = 27, active = false, resolveAbsorption;
  const window = {
    getCurrentUserData: () => ({stats:{totalScore:score}}), limitImmortalRank: i => i,
    isSoloCultivationFeedbackActive: () => active,
    waitForSoloCultivationFeedback: () => new Promise(resolve => { resolveAbsorption = resolve; }),
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener() {},
    dispatchEvent: event => events.push(event)
  };
  const node = () => ({ classList:{add(){}},setAttribute(){},remove(){} });
  vm.runInNewContext(read('realm-breakthrough-feedback.js'), {
    window, performance:{now:()=>0}, navigator:{}, CustomEvent: class { constructor(type, options) { this.type=type;this.detail=options.detail; } },
    document:{readyState:'complete',querySelector:()=>true, getElementById:id=>overlays.get(id),createElement:node,
      addEventListener(){},removeEventListener(){},body:{appendChild:el=>overlays.set(el.id,el)}},
    setTimeout(){},clearTimeout(){},setInterval(){},requestAnimationFrame:fn=>fn()
  });
  active = true; score = 31;
  listeners.get('xiuxian:stats-updated')();
  assert.equal(events.length, 0);
  active = false;
  listeners.get('xiuxian:solo-cultivation-feedback-end')();
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.from.name, '築基');
  assert.equal(events[0].detail.to.name, '金丹');
  listeners.get('xiuxian:stats-updated')();
  assert.equal(events.length, 1, 'polling and mutation events do not replay the same breakthrough');
  void window.showFirstQiBreakthrough();
  assert.equal(events.length, 1);
  resolveAbsorption();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, 2);
});

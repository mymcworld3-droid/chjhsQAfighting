const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const foundation = read('public/cultivation/foundation-training-page.js');
const training = read('public/cultivation/cultivation-training-v4.js');
const guard = read('public/cultivation/golden-core-access-guard.js');
const scrollFix = read('public/cultivation/training-scroll-fix.js');

test('training stage modules are event-driven instead of repaint polling', () => {
  assert.doesNotMatch(foundation, /setInterval\(sync,\s*450\)/);
  assert.doesNotMatch(training, /setInterval\(syncUnlock,\s*900\)/);
  assert.doesNotMatch(guard, /setInterval\(enforce,\s*250\)/);

  assert.match(foundation, /xiuxian:stats-updated/);
  assert.match(foundation, /xiuxian:user-ready/);
  assert.match(training, /golden-core-access-changed/);
  assert.match(guard, /golden-core-runtime-ready/);
});

test('Foundation cleanup cannot repeatedly clear Golden Core unlocked layout', () => {
  assert.match(foundation, /if \(!page && !nav\) \{[\s\S]*foundation-training-only[\s\S]*return;/);
  assert.match(foundation, /if \(!window\.isGoldenCoreUnlocked\?\.\(\)\) \{[\s\S]*cultivation-training-unlocked/);
  assert.match(foundation, /if \(lastStage === active\) return;/);
  assert.match(foundation, /else if \(lastStage === true\) removeFoundationUI\(\)/);
});

test('Golden Core unlock UI runs only on an actual unlock transition', () => {
  assert.match(training, /if \(lastUnlocked === unlocked\) \{[\s\S]*?return;[\s\S]*?\}/);
  assert.match(training, /if \(unlocked\) ensureUnlockedUI\(\)/);
  assert.match(training, /else if \(lastUnlocked === true\) removeLockedUI\(\)/);
});

test('scroll reset only fires on hidden-to-visible transition', () => {
  assert.match(scrollFix, /let wasVisible = !!page && !page\.classList\.contains\('hidden'\)/);
  assert.match(scrollFix, /const visible = !target\.classList\.contains\('hidden'\)/);
  assert.match(scrollFix, /if \(visible && !wasVisible\) resetTrainingScrollSoon\(\)/);
  assert.match(scrollFix, /wasVisible = visible/);
  assert.doesNotMatch(scrollFix, /if \(!target\.classList\.contains\('hidden'\)\) resetTrainingScrollSoon\(\)/);
});

test('access guard no longer watches every body mutation', () => {
  assert.doesNotMatch(guard, /new MutationObserver/);
  assert.match(guard, /xiuxian:features-ready/);
});

function trainingRenderRuntime() {
  let markup = '';
  const content = {
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; },
    querySelector: selector => selector === '.ns-growth-panel' && markup.includes('ns-growth-panel') ? {} : null
  };
  const main = {scrollTop:200}, page = {scrollTop:80};
  const context = {
    soulView:{selected:'attack',choosing:false},
    Innate:require('../public/cultivation/innate-ability.js'),window:{getCurrentUserData:()=>({}),dispatchEvent(){}},CustomEvent:class {},
    activeTab:'nascent-soul', NASCENT_SOUL_THRESHOLD:68, currentScore:() => 68,
    document:{
      getElementById:id => id === 'training-tab-content' ? content : page,
      querySelector:() => main,
      body:{classList:{remove(){}}}
    },
    nascentSoulTabMarkup:() => '<section class="ns-growth-panel"></section>',
    coreTabMarkup:() => '<section class="core-minimal-card"></section>',
    bagTabMarkup:() => '<section class="uib-bag-loading"></section>',
    bindCoreActions(){}, bindSoulActions(){}
  };
  const start = training.indexOf('  function renderTrainingPage()');
  const end = training.indexOf('  function createNavButton()',start);
  vm.createContext(context);
  vm.runInContext(training.slice(start,end),context);
  return {context,main,page,render:() => context.renderTrainingPage()};
}

test('redrawing existing nascent branches preserves both scroll containers', () => {
  const runtime = trainingRenderRuntime();
  runtime.render();
  assert.equal(runtime.main.scrollTop,0);
  assert.equal(runtime.page.scrollTop,0);
  runtime.main.scrollTop = 230;
  runtime.page.scrollTop = 90;
  runtime.render();
  assert.equal(runtime.main.scrollTop,230);
  assert.equal(runtime.page.scrollTop,90);
});

test('switching into nascent branches still starts at the top after another tab', () => {
  const runtime = trainingRenderRuntime();
  runtime.render();
  runtime.context.activeTab = 'bag';
  runtime.render();
  assert.equal(runtime.context.soulView.selected,null);
  runtime.main.scrollTop = 310;
  runtime.page.scrollTop = 120;
  runtime.context.activeTab = 'nascent-soul';
  runtime.render();
  assert.equal(runtime.main.scrollTop,0);
  assert.equal(runtime.page.scrollTop,0);
});

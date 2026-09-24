const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const read = path => readFileSync(join(__dirname, '..', path), 'utf8');
const source = read('public/cultivation/golden-core-wash-animation.js');
const training = read('public/cultivation/cultivation-training-v4.js');
const css = read('public/cultivation-golden-core-wash.css');

function fixture() {
  const classSet = initial => ({
    values: new Set(initial),
    add(...items) { items.forEach(item => this.values.add(item)); },
    remove(...items) { items.forEach(item => this.values.delete(item)); },
    contains(item) { return this.values.has(item); },
    [Symbol.iterator]() { return this.values[Symbol.iterator](); }
  });
  const node = (initial = []) => ({
    classList: classSet(initial), style: { setProperty() {} }, dataset: {},
    textContent: '', children: [], attrs: {}, isConnected: true,
    appendChild(child) { this.children.push(child); },
    remove() { this.isConnected = false; },
    setAttribute(key, value) { this.attrs[key] = value; },
    focus() {}
  });
  const sphereIcon = node();
  sphereIcon.textContent = '☀';
  const sphere = node(['golden-core-sphere-v3', 'core-tone-gold']);
  sphere.querySelector = selector => selector === 'span' ? sphereIcon : null;
  sphere.getBoundingClientRect = () => ({left:190,top:100,width:120,height:120});
  const button = node();
  button.getBoundingClientRect = () => ({left:100,top:460,width:300,height:52});
  const name = node();
  name.textContent = '太初回元丹';
  const grade = node();
  grade.textContent = '9 品';
  const card = node(['core-minimal-card']);
  card.getBoundingClientRect = () => ({left:0,top:0,width:500,height:650});
  card.querySelector = selector => ({
    '#wash-golden-core': button, '.golden-core-sphere-v3':sphere,
    '.core-minimal-name':name, '.core-minimal-grade':grade
  })[selector] || null;
  const document = {
    head: node(),
    querySelector(selector) { return selector === '.core-minimal-card' ? card : null; },
    createElement() { return node(); }

  };
  const window = {
    matchMedia: () => ({matches:true}),
    addEventListener() {}, removeEventListener() {}
  };
  const context = { document, window, setTimeout: fn => fn() };
  vm.runInNewContext(source.replace(/^export /gm, '') +
    '\nthis.createGoldenCoreWashAnimation = createGoldenCoreWashAnimation;', context);
  return { animate: context.createGoldenCoreWashAnimation, card, sphere, sphereIcon, name, grade, document };
}

test('wash brightens the existing core without creating rays or a modal', async () => {
  const {animate,card,document} = fixture();
  const effect = animate();
  assert.equal(document.head.children.length, 1);
  assert.equal(card.children.length, 0);
  assert.equal(card.classList.contains('is-core-washing'), true);
  assert.doesNotMatch(source, /createElementNS|gc-wash-beam|gc-wash-lightfield/);
  await effect.minimumDuration;
  effect.cleanup();
  assert.equal(card.classList.contains('is-core-washing'), false);
});

test('core changes only on successful reveal; failed wash keeps original appearance', async () => {
  const {animate,sphere,sphereIcon,name,grade,card} = fixture();
  const first = animate();
  assert.equal(name.textContent, '太初回元丹');
  assert.equal(grade.textContent, '9 品');
  await first.fail();
  assert.equal(sphereIcon.textContent, '☀');
  assert.equal(name.textContent, '太初回元丹');
  first.cleanup();
  const second = animate();
  await second.reveal({grade:1}, {tone:'silver',icon:'⚔',name:'破鋒劍心丹'});
  assert.equal(sphere.classList.contains('core-tone-silver'), true);
  assert.equal(sphere.classList.contains('core-tone-gold'), false);
  assert.equal(sphereIcon.textContent, '⚔');
  assert.equal(name.textContent, '破鋒劍心丹');
  assert.equal(grade.textContent, '1 品');
  assert.equal(card.classList.contains('is-core-wash-revealed'), true);
  second.cleanup();
});

test('wash keeps saving before revealing and CSS retains glow without rays or modal', () => {
  assert.match(training, /await persistRemote\(\{ 'stats\.gold': stones - WASH_COST \}\);[\s\S]*await animation\.minimumDuration;[\s\S]*await animation\.reveal/);
  assert.match(training, /state\.equipped = false;/);
  assert.doesNotMatch(css, /position\s*:\s*fixed|golden-core-wash-overlay|gc-wash-(?:beam|ray|lightfield|impact)/);
  assert.match(css, /gcWashSphere/);
  assert.match(css, /gcWashReborn/);
  assert.match(css, /prefers-reduced-motion/);
});

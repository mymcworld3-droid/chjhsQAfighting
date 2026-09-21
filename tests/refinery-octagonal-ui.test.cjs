const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const refinery = read('public/cultivation/cultivation-refinery-v2.js');
const training = read('public/cultivation/cultivation-training-v4.js');
const foundation = read('public/cultivation/foundation-training-page.js');
const trainingCss = read('public/cultivation-training-v3.css');
const index = read('public/index.html');

test('refinery uses eight directional slots around an octagonal array', () => {
  assert.match(refinery, /const directions = \['乾','坎','艮','震','巽','離','坤','兌'\]/);
  for (let i = 0; i < 8; i += 1) {
    assert.match(refinery, new RegExp('\\.refinery-slot\\[data-refinery-slot="' + i + '"\\]'));
  }
  assert.match(refinery, /clip-path:polygon\(29\.3% 0,70\.7% 0,100% 29\.3%,100% 70\.7%,70\.7% 100%,29\.3% 100%,0 70\.7%,0 29\.3%\)/);
  assert.match(refinery, /refinery-array-lines/);
  assert.match(refinery, /refinery-array-ring/);
});

test('craft action lives in the center of the array and lights when recipe matches', () => {
  const center = refinery.indexOf('class="refinery-array-center"');
  const craft = refinery.indexOf('data-refinery-craft', center);
  const slotsEnd = refinery.indexOf('refinery-array-caption', center);
  assert.ok(center >= 0 && craft > center && craft < slotsEnd);
  assert.match(refinery, /craftButton\.classList\.toggle\('ready', ready\)/);
  assert.match(refinery, /\.refinery-craft\.ready:not\(:disabled\)/);
  assert.match(refinery, /refinery-craft-pulse/);
});

test('octagonal forge keeps existing functional hooks', () => {
  assert.match(refinery, /data-refinery-ingredient=/);
  assert.match(refinery, /data-refinery-slot=/);
  assert.match(refinery, /data-refinery-clear/);
  assert.match(refinery, /data-refinery-craft/);
  assert.match(refinery, /data-refinery-summary-text/);
  assert.match(refinery, /data-refinery-match-text/);
  assert.match(refinery, /querySelector\('\[data-refinery-craft\]'\)\?\.addEventListener\('click', craft\)/);
});

test('Golden Core and Foundation preload the same octagonal forge shell', () => {
  assert.match(training,/training-shared-shells\.js/);
  assert.match(foundation,/training-shared-shells\.js/);
  for (const source of [read('public/cultivation/training-shared-shells.js')]) {
    assert.match(source, /refinery-array-wrap/);
    assert.match(source, /refinery-slots refinery-shell-array/);
    assert.match(source, /refinery-array-center/);
    assert.match(source, /fa-fire-flame-curved/);
    assert.match(source, /八方聚靈 · 一器成形/);
    assert.doesNotMatch(source, /refinery-shell-slots/);
  }
});

test('preloaded index contains octagonal refinery CSS before hydration', () => {
  const start = index.indexOf('<style id="cultivation-refinery-v2-preload-style" data-refinery-preload="true">');
  const end = index.indexOf('</style>', start);
  const css = index.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(css, /\.refinery-array-center/);
  assert.match(css, /\.refinery-slot\[data-refinery-slot="7"\]/);
  assert.match(css, /\.refinery-craft\.ready:not\(:disabled\)/);
  assert.match(index, /cultivation-training-v3\.css\?v=20260918-array1/);
  assert.match(index, /main\.js\?v=20260921-battle-stage3/);
});

test('preload shell styling no longer describes the old four-column forge', () => {
  assert.doesNotMatch(trainingCss, /\.refinery-shell-slots\{display:grid;grid-template-columns:repeat\(4/);
  assert.match(trainingCss, /\.refinery-shell-array \.refinery-slot/);
});

test('normal and secondary refinery shelves are equally tall on mobile and independently scrollable', () => {
  // Both preload and runtime CSS need matching geometry, or mobile users see
  // a short lower panel before hydration or after an app rerender.
  for (const css of [index, refinery]) {
    assert.match(css, /grid-template-rows:repeat\(2,minmax\(0,1fr\)\)/);
    assert.doesNotMatch(css, /calc\(50% \+ 96px - 32px\)/);
    assert.doesNotMatch(css, /calc\(50% - 96px \+ 32px\)/);
    assert.match(css, /\.refinery-material-roll-body\{[^}]*overflow:auto/);
    assert.match(css, /\.refinery-material-roll\+\.refinery-material-roll\{[^}]*padding-bottom:8px/);
    assert.match(css, /refinery-material-panel\{height:clamp\(520px,70dvh,680px\)/);
  }
  assert.match(refinery, /data-refinery-material-roll="materials"/);
  assert.match(refinery, /data-refinery-material-roll="artifacts"/);
  const content = index.slice(index.indexOf('<style id="content-capacity-layout-style">'));
  assert.match(content, /\.refinery-panel\.refinery-material-panel\{[^}]*display:grid!important/);
  assert.match(content, /\.refinery-material-panel \.refinery-material-list\{[^}]*grid-template-rows:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(content, /\.refinery-panel\.refinery-material-panel\{height:clamp\(520px,70dvh,680px\)!important;min-height:520px!important/);
  assert.doesNotMatch(content, /refinery-panel\.refinery-material-panel\{height:(?:424|294)px!important/);
  assert.doesNotMatch(content, /refinery-material-list\{max-height:294px!important/);
  assert.doesNotMatch(content, /refinery-material-list\{[^}]*max-height:min\(42dvh,360px\)!important/);
});

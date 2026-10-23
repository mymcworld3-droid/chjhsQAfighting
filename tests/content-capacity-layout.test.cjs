const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const layout = read('public/cultivation/content-capacity-layout.js');
const main = read('public/main.js');

test('training content measures the real space above bottom navigation', () => {
  assert.match(layout, /NAV_ID = 'bottom-nav'/);
  assert.match(layout, /function updateTrainingFillHeight\(\)/);
  assert.match(layout, /nav\.getBoundingClientRect\(\)/);
  assert.match(layout, /page\.getBoundingClientRect\(\)/);
  assert.match(layout, /--training-fill-height/);
  assert.match(layout, /--training-content-height/);
  assert.match(layout, /navTop - pageRect\.top - safeGap/);
  assert.match(layout, /navTop - contentTop - safeGap/);
  assert.match(layout, /document\.documentElement\.clientHeight \|\| window\.innerHeight/);
  assert.doesNotMatch(layout, /window\.visualViewport/);
});

test('training content is not clipped and golden core can use the available height', () => {
  assert.match(layout, /#page-training #training-tab-content/);
  assert.match(layout, /overflow:visible!important/);
  assert.match(layout, /min-height:var\(--training-content-height/);
  assert.match(layout, /golden-core-stage-v3/);
  assert.match(layout, /height:clamp\(240px,44dvh,430px\)!important/);
});

test('large golden core rules target the core page, not the nascent radial center', () => {
  const index = read('public/index.html');
  const fluid = read('public/cultivation/training-fluid-layout.js');
  for (const source of [layout, fluid, index]) {
    assert.doesNotMatch(source, /#page-training \.golden-core-stage-v3\s*\{/);
    assert.match(source, /#page-training \.core-minimal-card \.golden-core-stage-v3\s*\{/);
  }
  // Keep the initial inline CSS and later injected CSS identical at every breakpoint.
  for (const [id, source] of [['content-capacity-layout-style', layout], ['training-fluid-layout-style', fluid]]) {
    const inline = index.match(new RegExp('<style id="'+id+'">([\\s\\S]*?)<\\/style>'))[1];
    const injected = source.match(/style\.textContent = `([\s\S]*?)`;/)[1];
    const selectors = text => [...text.matchAll(/body\.xianxia-theme #page-training[^\n]*golden-core-stage-v3\{/g)].map(match => match[0]);
    assert.deepEqual(selectors(inline), selectors(injected));
  }
});

test('refinery fills available content height and shifts the material divider down 96px', () => {
  assert.match(layout, /#page-training \.cultivation-refinery/);
  assert.match(layout, /min-height:var\(--training-content-height/);
  assert.match(layout, /#page-training \.refinery-material-list/);
  assert.match(layout, /grid-template-rows:minmax\(0,calc\(50% \+ 96px - 32px\)\) minmax\(0,calc\(50% - 96px \+ 32px\)\)!important/);
  assert.match(layout, /overflow:hidden!important/);
  assert.match(layout, /refinery-material-roll-body/);
  assert.match(layout, /overflow:auto!important/);
  assert.match(layout, /overscroll-behavior:contain!important/);
});

test('bag and inventory can contain many items safely', () => {
  assert.match(layout, /training-v3-bag-grid/);
  assert.match(layout, /cultivation-inventory-grid/);
  assert.match(layout, /max-height:var\(--training-content-height/);
  assert.match(layout, /scrollbar-gutter:stable/);
});

test('admin long sections are full width, scrollable and responsive', () => {
  assert.match(layout, /#page-admin/);
  assert.match(layout, /admin-collapse-body/);
  assert.match(layout, /max-height:min\(72dvh,760px\)/);
  assert.match(layout, /\.amm-list,\.aam-list/);
  assert.match(layout, /repeat\(auto-fit,minmax\(320px,1fr\)\)/);
  assert.match(layout, /@media\(max-width:640px\)/);
});

test('capacity layout loads after the existing training and market layout layers', () => {
  const training = main.indexOf("'./cultivation/training-fluid-layout.js'");
  const market = main.indexOf("'./cultivation/market-fluid-layout.js'");
  const capacity = main.indexOf("'./cultivation/content-capacity-layout.js'");
  assert.ok(training >= 0 && capacity > training);
  assert.ok(market >= 0 && capacity > market);
});


test('material lower edge extends 64px while the existing divider stays visually fixed', () => {
  assert.match(layout, /align-items:start!important/);
  assert.match(layout, /padding-bottom:64px!important/);
  assert.match(layout, /min-height:calc\(var\(--training-content-height,calc\(100dvh - 270px\)\) \+ 60px\)!important/);
  assert.match(layout, /height:calc\(min\(42dvh,360px\) \+ 64px\)!important/);
  assert.match(layout, /height:294px!important;min-height:294px!important/);
});


test('training height uses the page bottom when navigation is hidden, independent of keyboard visibility', () => {
  const props=new Map(),root={clientHeight:720};
  const page={classList:{contains:()=>false},getBoundingClientRect:()=>({top:100,height:500}),
    querySelector:()=>({getBoundingClientRect:()=>({bottom:140})}),style:{setProperty:(key,value)=>props.set(key,value)}};
  const context={PAGE_ID:'page-training',NAV_ID:'bottom-nav',window:{innerHeight:900,visualViewport:{height:200}},
    document:{documentElement:root,getElementById:id=>id==='page-training'?page:{classList:{contains:()=>true}}}};
  const start=layout.indexOf('  function updateTrainingFillHeight()'),end=layout.indexOf('  function scheduleMeasure()',start);
  vm.runInNewContext(layout.slice(start,end)+'\nthis.sync=updateTrainingFillHeight;',context);
  context.sync();assert.equal(props.get('--training-fill-height'),'612px');assert.equal(props.get('--training-content-height'),'568px');
  context.window.visualViewport.height=100;context.sync();assert.equal(props.get('--training-fill-height'),'612px');
  root.clientHeight=640;context.sync();assert.equal(props.get('--training-fill-height'),'532px');
});

test('training content height reserves the detail bar between tabs and the node workspace', () => {
  const props=new Map();
  const page={classList:{contains:()=>false},getBoundingClientRect:()=>({top:72,height:500}),
    querySelector:selector=>({getBoundingClientRect:()=>selector==='#training-tab-content'?{top:214}:{bottom:132}}),
    style:{setProperty:(key,value)=>props.set(key,value)}};
  const context={PAGE_ID:'page-training',NAV_ID:'bottom-nav',window:{innerHeight:640},
    document:{documentElement:{clientHeight:640},getElementById:id=>id==='page-training'?page:
      {classList:{contains:()=>false},getBoundingClientRect:()=>({top:580})}}};
  const start=layout.indexOf('  function updateTrainingFillHeight()'),end=layout.indexOf('  function scheduleMeasure()',start);
  vm.runInNewContext(layout.slice(start,end)+'\nthis.sync=updateTrainingFillHeight;',context);
  context.sync();
  assert.equal(props.get('--training-content-height'),'358px');
  assert.equal(props.get('--training-fill-height'),'500px');
});

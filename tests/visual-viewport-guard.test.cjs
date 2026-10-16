const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'public');
const guard = fs.readFileSync(path.join(root, 'visual-viewport-guard.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles', 'visual-viewport-guard.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('global page layout guard loads before the main app', () => {
  assert.match(index, /styles\/visual-viewport-guard\.css\?v=[\w-]+/);
  assert.match(index, /visual-viewport-guard\.js\?v=20261013-page-layout1/);
  assert.ok(index.indexOf('visual-viewport-guard.js?v=20261013-page-layout1') <
    index.indexOf('main.js?v=20261013-arrival1'));
});

test('page bounds ignore keyboard height and visual panning, while real document resize updates them', () => {
  const props=new Map(), handlers={}, frames=[], events=[];
  const root={clientWidth:1280,clientHeight:720,style:{setProperty:(key,value)=>props.set(key,value)},classList:{add(){}}};
  let observed, observerCallback, visualListeners=0;
  class ResizeObserver { constructor(callback){observerCallback=callback;} observe(node){observed=node;} }
  const window={innerWidth:1440,innerHeight:900,visualViewport:{width:700,height:300,offsetLeft:30,offsetTop:90,addEventListener(){visualListeners++;}},
    ResizeObserver,addEventListener:(type,callback)=>handlers[type]=callback,dispatchEvent:event=>events.push(event)};
  vm.runInNewContext(guard,{window,document:{documentElement:root,addEventListener(){}},ResizeObserver,
    CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},
    requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},cancelAnimationFrame(){},setTimeout(){}});
  const flush=()=>{while(frames.length)frames.shift()();};
  assert.equal(props.get('--app-vv-width'),'1280.00px');
  assert.equal(props.get('--app-vv-height'),'720.00px');
  for(const side of ['top','left','bottom','right'])assert.equal(props.get('--app-vv-'+side),'0.00px');
  assert.equal(events.at(-1).type,'app:layout-viewport');
  assert.equal(visualListeners,0);assert.equal(observed,root);
  const original=[...props];
  Object.assign(window.visualViewport,{width:320,height:180,offsetTop:200,offsetLeft:70});
  handlers.resize();flush();assert.deepEqual([...props],original);
  root.clientWidth=360;root.clientHeight=640;observerCallback();flush();
  assert.equal(props.get('--app-vv-width'),'360.00px');assert.equal(props.get('--app-vv-height'),'640.00px');
  root.clientWidth=0;root.clientHeight=0;handlers.resize();flush();
  assert.equal(props.get('--app-vv-width'),'1440.00px');assert.equal(props.get('--app-vv-height'),'900.00px');
});

test('fullscreen gameplay roots use the document bounds', () => {
  for (const selector of [
    '#dongtian-overlay.dt-overlay',
    '#page-battle.battle-v2-page',
    '#scope-studio',
    '.dm-overlay',
    '#admin-product-editor.admin-product-editor-fullscreen',
    '#xiuxian-story-layer',
    '#newbie-tutorial-layer',
    '#golden-core-tutorial-layer',
    '#battle-tutorial-layer.bt-final-mode'
  ]) assert.ok(css.includes(selector), selector);
  assert.match(css, /height:var\(--app-vv-height\)!important/);
  assert.match(css, /top:var\(--app-vv-top\)!important/);
});

test('navigation docks to the canvas edge while tutorial cards and modals keep safe-area offsets', () => {
  assert.match(css, /body\.xianxia-theme #bottom-nav/);
  assert.match(css, /#bottom-nav\s*\{\s*bottom:var\(--app-vv-bottom\)!important/);
  assert.match(css, /var\(--app-vv-bottom\)/);
  assert.match(css, /\.newbie-tutorial-card/);
  assert.match(css, /\.golden-core-tutorial-card/);
  assert.match(css, /#qi-five-dongtian-tutorial-layer \.qfd-card/);
  assert.match(css, /#custom-confirm-modal:not\(\.hidden\)/);
  assert.match(css, /\.training-v3-modal-backdrop/);
  assert.match(css, /#five-immortal-challenge\.fi-backdrop/);
});


test('raid question delegates sizing to the corrected raid parent', () => {
  assert.doesNotMatch(css, /#raid-question\.raid-question-view/);
});

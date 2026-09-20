const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const index = read('public/index.html');
const legacy = read('public/main-legacy.js');
const battle = read('public/cultivation/battle-v3-stability-ui.js');
const inventory = read('public/cultivation/unified-inventory-grid.js');

test('debug button is permanently reserved as the top-most app layer', () => {
  assert.match(index, /id="debug-top-layer-style"/);
  assert.match(index, /#btn-show-debug\{[\s\S]*position:fixed!important;[\s\S]*z-index:2147483647!important;[\s\S]*pointer-events:auto!important/);
  assert.match(index, /#admin-debug-console\{[\s\S]*z-index:2147483646!important/);
});

test('runtime debug initialization reasserts the top layer with important priority', () => {
  const start = legacy.indexOf('window.setupAdminDebug');
  const block = legacy.slice(start, start + 2500);
  assert.ok(start >= 0);
  assert.match(block, /showBtn\.style\.setProperty\('z-index', '2147483647', 'important'\)/);
  assert.match(block, /consoleDiv\.style\.setProperty\('z-index', '2147483646', 'important'\)/);
  assert.match(block, /showBtn\.style\.setProperty\('pointer-events', 'auto', 'important'\)/);
});

test('debug layer remains above known fullscreen and modal layers', () => {
  const battleZ = Number((battle.match(/z-index:(\d+)!important/) || [])[1] || 0);
  const inventoryZ = Number((inventory.match(/\.uib-modal-backdrop\{[^}]*z-index:(\d+)/) || [])[1] || 0);
  assert.ok(battleZ > 0);
  assert.ok(inventoryZ > 0);
  assert.ok(2147483647 > battleZ);
  assert.ok(2147483647 > inventoryZ);
  assert.ok(2147483646 > battleZ);
  assert.ok(2147483646 > inventoryZ);
});

test('old low debug z-index utility classes are removed from static markup', () => {
  const buttonStart = index.indexOf('<button id="btn-show-debug"');
  const buttonEnd = index.indexOf('</button>', buttonStart);
  const consoleStart = index.indexOf('<div id="admin-debug-console"');
  const consoleEnd = index.indexOf('>', consoleStart);
  assert.doesNotMatch(index.slice(buttonStart, buttonEnd), /z-\[9998\]/);
  assert.doesNotMatch(index.slice(consoleStart, consoleEnd), /z-\[9999\]/);
});

test('all runtime console faults are buffered and exposed only after admin identity is confirmed', () => {
  const vm = require('node:vm');
  const start = legacy.indexOf('const xiuxianDebugBuffer =');
  const end = legacy.indexOf('// ==========================================\n// 1. 定義修仙境界',start);
  assert.ok(start>=0 && end>start);
  const code = legacy.slice(start,end);
  const handlers = {};
  let admin = false;
  const logs = [], visible = new Set();
  const createClassList = () => ({
    add(value){visible.delete(value);},
    remove(value){visible.add(value);}
  });
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const e = {
        id, children:[], textContent: id === 'debug-count' ? '0' : '',
        style:{setProperty(){}}, classList:createClassList(),
        replaceChildren(){this.children=[];}, prepend(child){this.children.unshift(child);},
        get lastElementChild(){return this.children[this.children.length-1];},
        remove() {}
      };
      elements.set(id,e);
    }
    return elements.get(id);
  }
  const ctx = vm.createContext({
    currentUserData:null,
    window:{isDebugInit:false,addEventListener:(key,fn)=>{handlers[key]=fn;}},
    document:{getElementById:element,createElement:()=>({className:'',textContent:''})},
    console:{error:(...args)=>logs.push(['error',...args]),warn:(...args)=>logs.push(['warn',...args]),log:(...args)=>logs.push(['log',...args])},
    Date, String
  });
  vm.runInContext(code,ctx);
  vm.runInContext("console.error('early fail'); window.reportXiuxianBug('craft', new Error('failed'));",ctx);
  vm.runInContext("window.setupAdminDebug()",ctx);
  assert.equal(element('debug-logs').children.length,0, 'non-admin must not see any diagnostics');
  ctx.currentUserData={isAdmin:true};
  vm.runInContext("window.setupAdminDebug()",ctx);
  assert.equal(element('debug-logs').children.length,2, 'admin sees pre-login errors');
  assert.match(element('debug-logs').children[0].textContent,/craft/);
  assert.match(element('debug-logs').children[1].textContent,/early fail/);
  assert.equal(element('debug-count').textContent,'2');
  handlers.error({message:'runtime exception',filename:'game.js',lineno:5,colno:3,error:new Error('boom')});
  assert.match(element('debug-logs').children[0].textContent,/runtime exception/);
  ctx.currentUserData={isAdmin:false};
  vm.runInContext("console.warn('player-only warning')",ctx);
  assert.doesNotMatch(element('debug-logs').children[0].textContent,/player-only warning/);
});

test('refinery shows ordinary players only a neutral retry and routes errors into the admin debugger', () => {
  const refinery = read('public/cultivation/cultivation-refinery-v2.js');
  assert.match(refinery, /console.error\('\[Cultivation refinery\] open failed:', error\)/);
  assert.match(refinery, /data-refinery-retry/);
  assert.doesNotMatch(refinery, /<h3>煉器介面載入失敗<\/h3>/);
  assert.doesNotMatch(refinery, /toast\(error.message \|\| '煉器失敗/);
  assert.match(legacy, /checkAdminRole\(currentUserData.isAdmin === true\)/);
  assert.match(legacy, /xiuxianDebugBuffer\.forEach\(xiuxianDebugWriter\)/);
  assert.match(legacy, /div\.textContent =/);
});

test('safe action errors preserve gameplay validation but never expose raw technical exceptions to players', () => {
  const vm = require('node:vm');
  const start = legacy.indexOf('window.xiuxianSafeActionError =');
  const end = legacy.indexOf('console.error = function', start);
  assert.ok(start > 0 && end > start);
  const sent = [];
  const ctx = vm.createContext({ window:{reportXiuxianBug:(...args)=>sent.push(args)},String,Error });
  vm.runInContext(legacy.slice(start,end),ctx);
  assert.equal(vm.runInContext("window.xiuxianSafeActionError('煉器', new Error('FirebaseError: permission-denied'), '操作未完成')",ctx),'操作未完成');
  assert.equal(vm.runInContext("window.xiuxianSafeActionError('煉器', new Error('金幣不足，需要 150'), '操作未完成')",ctx),'金幣不足，需要 150');
  assert.equal(vm.runInContext("window.xiuxianSafeActionError('煉器', new Error('金幣不足<svg onload=alert(1)>'), '操作未完成')",ctx),'操作未完成');
  assert.equal(sent.length,3,'even actionable failures must reach admin debugger');
  assert.match(legacy,/if \(typeof message === 'string' &&[\s\S]*Legacy alert/);
  const dongtian = read('public/cultivation/dongtian.js');
  const entry = read('public/cultivation/dongtian-entry.js');
  const material = read('public/cultivation/material-system.js');
  const artifact = read('public/cultivation/artifact-system.js');
  const identity = read('public/cultivation/identity-system.js');
  for (const [moduleName,src] of Object.entries({dongtian,material,artifact,identity})) {
    assert.match(src,/xiuxianSafeActionError/,moduleName+' must route error text through common guard');
  }
  assert.doesNotMatch(entry,/洞天啟動失敗：\$\{error\?\.message/);
});

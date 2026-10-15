'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Pool = require('../public/cultivation/soulbound-pool.js');
const Access = require('../public/cultivation/training-access-rules.js');
const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/soulbound-draw.js'), 'utf8')
  .replace(/^import .*;\n/gm, '');

function pageRuntime() {
  const nodes = new Map(), documentEvents = new Map(), events = new Map(), requests = [], stored = new Map();
  const player = { uid: 'u1', stats: { totalScore: 28, gold: 10000 }, artifactSystem: { inventory: {}, equipped: {} } };
  const classes = () => {
    const values = new Set();
    return { contains: value => values.has(value), remove: value => values.delete(value),
      toggle: (value, enabled) => enabled ? values.add(value) : values.delete(value) };
  };
  function node(id = '') {
    const callbacks = new Map();
    const element = { id, innerHTML: '', textContent: '', disabled: false, classList: classes(),
      setAttribute() {}, focus() {}, scrollTo() {}, remove() { nodes.delete(this.id); },
      addEventListener(name, callback) { callbacks.set(name, callback); },
      fire(name, event = {}) { callbacks.get(name)?.(event); },
      querySelector(selector) { return selector.startsWith('#') ? nodes.get(selector.slice(1)) : null; },
      querySelectorAll() { return [tab]; },
      replaceChildren(child) {
        nodes.set(child.id, child);
        for (const [, childId] of child.innerHTML.matchAll(/id="([^"]+)"/g)) nodes.set(childId, node(childId));
      }
    };
    return element;
  }
  const tab = node(); tab.dataset = { trainingTab: 'contract' };
  const page = node('page-training'); page.classList.toggle('active-page', true);
  page.querySelector = selector => selector.includes('data-training-tab') ? tab : nodes.get('training-tab-content');
  nodes.set(page.id, page); nodes.set('training-tab-content', node('training-tab-content'));
  const window = { getCurrentUserData: () => player,
    addEventListener(name, callback) { const list = events.get(name) || []; list.push(callback); events.set(name, list); },
    dispatchEvent(event) { events.get(event.type)?.forEach(callback => callback(event)); }
  };
  const context = { window, QASoulboundPool: Pool, QATrainingAccessRules: Access,
    document: { getElementById: id => nodes.get(id), createElement: () => node(),
      querySelector: selector => selector.includes('data-training-tab') ? tab : null,
      head: { append() {} }, body: { classList: classes() },
      addEventListener(name, callback) { documentEvents.set(name, callback); }
    },
    getArtifactById: Pool.get, artifactRealmColor: () => '#f5cf83',
    getMainUser: () => ({ uid: player.uid }),
    localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    authenticatedMainFetch(url, init) {
      return new Promise(resolve => requests.push({ url, init,
        reply(payload, status = 200) { resolve({ ok: status < 400, status, json: async () => payload }); }
      }));
    },
    AbortController, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  };
  vm.runInNewContext(source, context);
  return { window, requests, nodes, player,
    open() { documentEvents.get('click')({ target: { closest: () => tab } }); },
    leave() { for (const id of [...nodes.keys()]) if (id.startsWith('soulbound-')) nodes.delete(id); tab.classList.remove('active'); },
    preview(id) {
      const button = { disabled: false, dataset: { sbPreview: id }, hasAttribute: name => name === 'data-sb-preview' };
      nodes.get('soulbound-content').fire('click', { target: { closest: () => button } });
    },
    refresh() { nodes.get('soulbound-refresh').fire('click'); },
    html: () => nodes.get('soulbound-content').innerHTML
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const snapshot = (rank = 0) => ({ ok: true, rank, balance: 10000, poolVersion: Pool.VERSION,
  draws: 0, misses:0, fragments:0, untilPity: 50, prices: { single: 250, five: Pool.cost(rank, 0, 5) }, inventory: {}, pending: null, recovery: [] });
function assertGallery(html, rank = 0) {
  assert.equal((html.match(/data-sb-preview=/g) || []).length, 8);
  for (const item of Pool.candidates(rank)) assert.ok(html.includes(item.imageUrl), item.name);
}

test('pool previews remain usable during a slow or failed first sync, with draws gated until retry succeeds', async () => {
  const runtime = pageRuntime();
  runtime.open();
  assertGallery(runtime.html());
  assert.equal(runtime.html().includes('data-sb-draw='), false);
  runtime.preview('soul-axe-golden-core');
  assert.match(runtime.html(), /aria-label="破障玄斧展示"/);
  runtime.requests[0].reply({ ok: false, error: '契器暫時離線' }, 503);
  await settle();
  assertGallery(runtime.html());
  assert.equal(runtime.html().includes('正在同步契印'), false);
  assert.match(runtime.html(), /重新同步/);
  assert.equal(runtime.nodes.get('soulbound-status').textContent, '契器暫時離線');
  assert.equal(runtime.nodes.get('soulbound-refresh').disabled, false);
  runtime.refresh();
  runtime.preview('soul-pearl-golden-core');
  runtime.requests[1].reply(snapshot(1));
  await settle();
  assertGallery(runtime.html(), 1);
  assert.match(runtime.html(), /class="sb-lobby"/);
  assert.match(runtime.html(), /aria-label="太初靈珠展示"/);
  assert.equal((runtime.html().match(/data-sb-draw=/g) || []).length, 2);
  assert.match(runtime.html(), /五連抽 · 2650 靈石/);
  assert.equal(runtime.requests.length, 2, 'previewing never sends a purchase request');
});

test('reentering while sync is pending shares the request and renders its result on the new page', async () => {
  const runtime = pageRuntime();
  runtime.open();
  runtime.leave();
  runtime.open();
  assertGallery(runtime.html());
  assert.equal(runtime.requests.length, 1);
  runtime.requests[0].reply(snapshot());
  await settle();
  assert.equal((runtime.html().match(/data-sb-draw=/g) || []).length, 2);
  assert.equal(runtime.nodes.get('soulbound-refresh').disabled, false);
  assert.equal(runtime.requests.length, 1);
});

test('fragment-only pending results can be viewed and acknowledged without equipping a weapon', async () => {
  const runtime=pageRuntime();runtime.open();
  const batch={requestId:'fragment-request-0001',cost:250,results:[{kind:'fragments',fragments:30,ordinal:1}]};
  runtime.requests[0].reply({...snapshot(),fragments:30,pending:batch,misses:1,untilPity:49});await settle();
  assert.match(runtime.html(),/煉器碎片 ×30/);assert.match(runtime.html(),/data-sb-vault/);assert.doesNotMatch(runtime.html(),/data-sb-equip=/);
  const button={disabled:false,dataset:{},hasAttribute:name=>name==='data-sb-vault'};
  runtime.nodes.get('soulbound-content').fire('click',{target:{closest:()=>button}});
  assert.equal(runtime.requests[1].url,'/api/soulbound/ack');assert.equal(JSON.parse(runtime.requests[1].init.body).requestId,batch.requestId);
  runtime.requests[1].reply({...snapshot(),fragments:30,misses:1,untilPity:49});await settle();assert.doesNotMatch(runtime.html(),/data-sb-vault/);
});

test('mixed batches retain weapon comparison and older weapon-only receipts remain readable', async () => {
  for(const legacy of [false,true]){
    const runtime=pageRuntime();runtime.open();const item=Pool.ITEMS[0];
    const weapon={itemId:item.id,realm:item.realm,...(legacy?{}:{kind:'weapon',pity:true})};
    runtime.requests[0].reply({...snapshot(),inventory:{[item.id]:1},pending:{requestId:'weapon-request-00001',cost:500,results:legacy?[weapon]:[weapon,{kind:'fragments',fragments:25}]}});await settle();
    assert.match(runtime.html(),/調御比較/);assert.ok(runtime.html().includes(`data-sb-equip="${item.id}"`));
    assert.equal((runtime.html().match(/data-sb-select=/g)||[]).length,legacy?1:2);
  }
});

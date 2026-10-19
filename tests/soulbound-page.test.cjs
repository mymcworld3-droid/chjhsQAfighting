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

function pageRuntime(options = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map();
  const nodes = new Map(), documentEvents = new Map(), events = new Map(), requests = [], stored = new Map();
  const player = { uid: 'u1', stats: { totalScore: 28, gold: 10000 }, artifactSystem: { inventory: {}, equipped: {} } };
  const classes = () => {
    const values = new Set();
    return { add: value => values.add(value), contains: value => values.has(value), remove: value => values.delete(value),
      toggle: (value, enabled) => enabled ? values.add(value) : values.delete(value) };
  };
  function node(id = '') {
    const callbacks = new Map();
    const element = { id, innerHTML: '', textContent: '', disabled: false, classList: classes(),
      setAttribute() {}, focus() {}, scrollTo() {}, remove() { nodes.delete(this.id); },
      addEventListener(name, callback) { callbacks.set(name, callback); },
      appendChild(child) { nodes.set(child.id, child); return child; },
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
      head: { append() {} }, body: node('body'),
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
    AbortController,
    Date: options.fakeTime ? { now: () => now } : Date,
    setTimeout: options.fakeTime ? (callback, delay) => { const id = ++nextTimer; timers.set(id, {callback, at: now + delay}); return id; } : setTimeout,
    clearTimeout: options.fakeTime ? id => timers.delete(id) : clearTimeout,
    crypto: { randomUUID: () => 'ui-draw-request-000001' },
    matchMedia: () => ({ matches: true }),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  };
  vm.runInNewContext(source, context);
  return { window, requests, nodes, player,
    advance(ms) {
      const target = now + ms;
      for (let count = 0; count < 100; count++) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a,b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].callback();
      }
      now = target;
    },
    pendingTimers: () => timers.size,
    open() { documentEvents.get('click')({ target: { closest: () => tab } }); },
    leave() { for (const id of [...nodes.keys()]) if (id.startsWith('soulbound-')) nodes.delete(id); tab.classList.remove('active'); },
    draw(count, payment = 'gold') {
      const button = { disabled: false, dataset: { sbDraw: String(count), sbPayment: payment }, hasAttribute: name => name === 'data-sb-draw' };
      nodes.get('soulbound-content').fire('click', { target: { closest: () => button } });
    },
    refresh() { nodes.get('soulbound-refresh').fire('click'); },
    preview(id) {
      const button = { disabled: false, dataset: { sbPreview: id }, hasAttribute: name => name === 'data-sb-preview' };
      nodes.get('soulbound-content').fire('click', { target: { closest: () => button } });
    },
    closePreview() {
      const overlay = nodes.get('soulbound-preview');
      if (overlay) overlay.fire('click', { target: overlay });
    },
    revealAction(attribute, dataset = {}) {
      const button = { disabled: false, dataset, hasAttribute: name => name === attribute };
      nodes.get('soulbound-animation')?.fire('click', { target: { closest: () => button } });
    },
    revealHtml: () => nodes.get('soulbound-animation')?.innerHTML || '',
    html: () => nodes.get('soulbound-content').innerHTML
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const snapshot = (rank = 0) => ({ ok: true, rank, balance: 10000, poolVersion: Pool.VERSION,
  draws: 0, misses:0, fragments:0, untilPity: 20, prices: { single: 250, five: Pool.cost(rank, 0, 5) }, inventory: {}, pending: null, recovery: [] });
function assertShowcase(html, rank = 0) {
  assert.match(html, /<h3>常駐法器<\/h3>/);
  assert.equal((html.match(/data-sb-preview=/g) || []).length, 4,
    'three visible weapons and one offscreen incoming weapon');
  assert.equal((html.match(/class="sb-carousel-card is-center"/g) || []).length, 1);
  assert.equal((html.match(/aria-hidden="true" tabindex="-1"/g) || []).length, 1);
  assert.match(html, /每次展示三件法器/);
  assert.doesNotMatch(html, /池內法器一覽|sb-gallery|寶庫 · 調御與精煉|八器同池|常駐共用池 · /);
  assert.doesNotMatch(html, /data-sb-refine/);
  for (const item of Pool.candidates(rank).slice(0, 4)) assert.ok(html.includes(item.imageUrl), item.name);
}


test('three common-pool weapons remain visible during slow or failed sync, with draws gated until retry succeeds', async () => {
  const runtime = pageRuntime();
  runtime.open();
  assertShowcase(runtime.html());
  assert.equal(runtime.html().includes('data-sb-draw='), false);
  assert.match(runtime.html(), /aria-label="常駐本命法器共用池"/);
  runtime.requests[0].reply({ ok: false, error: '契器暫時離線' }, 503);
  await settle();
  assertShowcase(runtime.html());
  assert.equal(runtime.html().includes('正在同步契印'), false);
  assert.match(runtime.html(), /重新同步/);
  assert.equal(runtime.nodes.get('soulbound-status').textContent, '契器暫時離線');
  assert.equal(runtime.nodes.get('soulbound-refresh').disabled, false);
  runtime.refresh();
  runtime.requests[1].reply(snapshot(1));
  await settle();
  assertShowcase(runtime.html(), 1);
  assert.match(runtime.html(), /class="sb-lobby"/);
  assert.match(runtime.html(), /aria-label="常駐本命法器共用池"/);
  assert.equal((runtime.html().match(/data-sb-draw=/g) || []).length, 4);
  assert.match(runtime.html(), /五連抽 · 2650 靈石/);
  assert.equal(runtime.requests.length, 2, 'displaying the common pool never sends a purchase request');
});

test('single and five draw buttons send one common-pool request without a target weapon', async () => {
  for (const count of [1, 5]) {
    const runtime = pageRuntime(); runtime.open();
    runtime.requests[0].reply(snapshot()); await settle();
    runtime.draw(count);
    const request = runtime.requests[1];
    assert.equal(request.url, '/api/soulbound/draw');
    const body = JSON.parse(request.init.body);
    assert.equal(body.count, count);
    assert.equal(body.poolVersion, Pool.VERSION);
    assert.deepEqual(Object.keys(body).sort(), ['count', 'expectedCost', 'payment', 'poolVersion', 'requestId']);
    const batch = { requestId: body.requestId, cost: body.expectedCost,
      results: Array.from({ length: count }, () => ({ kind: 'fragments', fragments: 30 })) };
    runtime.requests[1].reply({ ...snapshot(), result: batch, pending: batch, fragments: count * 30 });
    await settle();
    assert.equal(runtime.requests.length, 2);
    assert.match(runtime.html(), /抽結果已保存/);
  }
});

test('the contract page explains twenty-pull pity and displays the retained miss counter', async () => {
  const runtime = pageRuntime(); runtime.open();
  runtime.requests[0].reply({ ...snapshot(), draws: 17, misses: 17, untilPity: 3 }); await settle();
  assert.match(runtime.html(), /<progress value="17" max="20"/);
  assert.match(runtime.html(), /連續 19 抽未出武器，第 20 抽必出/);
  assert.match(runtime.html(), /至多 20 抽必得/);
  assert.match(runtime.html(), /<b>3 抽<\/b>/);
  assert.doesNotMatch(runtime.html(), /50 抽|第 50 抽|max="50"/);
});

test('reentering while sync is pending shares the request and renders its result on the new page', async () => {
  const runtime = pageRuntime();
  runtime.open();
  runtime.leave();
  runtime.open();
  assertShowcase(runtime.html());
  assert.equal(runtime.requests.length, 1);
  runtime.requests[0].reply(snapshot());
  await settle();
  assert.equal((runtime.html().match(/data-sb-draw=/g) || []).length, 4);
  assert.equal(runtime.nodes.get('soulbound-refresh').disabled, false);
  assert.equal(runtime.requests.length, 1);
});

test('fragment-only pending results can be viewed and acknowledged without equipping a weapon', async () => {
  const runtime=pageRuntime();runtime.open();
  const batch={requestId:'fragment-request-0001',cost:250,results:[{kind:'fragments',fragments:30,ordinal:1}]};
  runtime.requests[0].reply({...snapshot(),fragments:30,pending:batch,misses:1,untilPity:19});await settle();
  assert.doesNotMatch(runtime.html(),/煉器碎片 ×30|sb-results|sb-featured/);
  assert.match(runtime.revealHtml(),/data-sb-flip/);
  assert.doesNotMatch(runtime.revealHtml(),/煉器碎片 ×30/);
  runtime.revealAction('data-sb-keep');
  assert.equal(runtime.requests.length,1,'unflipped results cannot be acknowledged');
  runtime.revealAction('data-sb-flip');
  assert.match(runtime.revealHtml(),/煉器碎片 ×30/);
  assert.match(runtime.revealHtml(),/data-sb-keep/);
  runtime.revealAction('data-sb-keep');
  assert.equal(runtime.requests[1].url,'/api/soulbound/ack');assert.equal(JSON.parse(runtime.requests[1].init.body).requestId,batch.requestId);
  runtime.requests[1].reply({...snapshot(),fragments:30,misses:1,untilPity:19});await settle();assert.equal(runtime.nodes.has('soulbound-animation'),false);
});

test('mixed and legacy batches reveal each result only after flipping its card', async () => {
  for(const legacy of [false,true]){
    const runtime=pageRuntime();runtime.open();const item=Pool.ITEMS[0];
    const weapon={itemId:item.id,realm:item.realm,...(legacy?{}:{kind:'weapon',pity:true})};
    runtime.requests[0].reply({...snapshot(),inventory:{[item.id]:1},pending:{requestId:'weapon-request-00001',cost:500,results:legacy?[weapon]:[weapon,{kind:'fragments',fragments:25}]}});await settle();
    assert.doesNotMatch(runtime.html(),/sb-results|sb-featured|data-sb-select/);
    assert.doesNotMatch(runtime.revealHtml(),new RegExp(item.name));
    runtime.revealAction('data-sb-flip');
    assert.ok(runtime.revealHtml().includes(item.name));
    assert.ok(runtime.revealHtml().includes(`data-sb-reveal-equip="${item.id}"`));
    if(!legacy){
      assert.doesNotMatch(runtime.revealHtml(),/data-sb-keep/);
      runtime.revealAction('data-sb-next');
      assert.doesNotMatch(runtime.revealHtml(),/煉器碎片 ×25/);
      runtime.revealAction('data-sb-flip');
      assert.match(runtime.revealHtml(),/煉器碎片 ×25/);
      assert.match(runtime.revealHtml(),/data-sb-keep/);
    }
  }
});


test('clicking a showcase weapon opens details without changing draw target or making a purchase', async () => {
  const runtime = pageRuntime();
  runtime.open();
  runtime.requests[0].reply(snapshot(5)); await settle();
  const item = Pool.candidates(5)[1];
  runtime.preview(item.id);
  const modal = runtime.nodes.get('soulbound-preview');
  assert.ok(modal, 'detail overlay is mounted');
  assert.match(modal.innerHTML, /role="dialog" aria-modal="true"/);
  assert.ok(modal.innerHTML.includes(item.name));
  assert.ok(modal.innerHTML.includes(item.description));
  assert.match(modal.innerHTML, /攻擊 \+100/);
  assert.match(modal.innerHTML, /生命 \+305/);
  assert.equal(runtime.requests.length, 1, 'preview must not issue a draw');
  runtime.closePreview();
  assert.equal(runtime.nodes.has('soulbound-preview'), false);
  assertShowcase(runtime.html(), 5);
});

test('showcase motion and coloring remain responsive without exposing all eight items simultaneously', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/styles/soulbound-draw.css'), 'utf8');
  assert.match(css, /\.sb-carousel-track\.is-shifting/);
  assert.match(css, /nth-child\(3\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /--sb-carousel-gap:8px/);
  assert.match(css, /#training-tab-content:has\(> #soulbound-page\)/);
  assert.doesNotMatch(css, /#0b1018/);
  assert.doesNotMatch(css, /#090c16f5/);
});


test('voucher buttons display balance and send explicit ticket payment with zero gold cost', async () => {
  const runtime=pageRuntime();runtime.open();runtime.requests[0].reply({...snapshot(),drawTickets:5});await settle();
  assert.match(runtime.html(),/本命法器抽獎券：5 張/);
  assert.match(runtime.html(),/data-sb-payment="ticket"/);
  runtime.draw(5,'ticket');
  const body=JSON.parse(runtime.requests[1].init.body);assert.equal(body.payment,'ticket');assert.equal(body.count,5);assert.equal(body.expectedCost,0);
  const batch={requestId:body.requestId,payment:'ticket',ticketsSpent:5,cost:0,results:Array.from({length:5},()=>({kind:'fragments',fragments:30}))};
  runtime.requests[1].reply({...snapshot(),result:batch,pending:batch,drawTickets:0});await settle();
  runtime.revealAction('data-sb-skip');assert.match(runtime.revealHtml(),/本批 5 張抽獎券/);assert.equal(runtime.player.soulboundDrawTickets,0);
});

test('showcase preview redeems its selected weapon with the displayed fragment cost', async () => {
  const runtime=pageRuntime(); runtime.open();
  const cost=Pool.redemptionCost(0),item=Pool.candidates(0)[2];
  runtime.requests[0].reply({...snapshot(),fragments:cost+10,redemptionCost:cost}); await settle();
  runtime.preview(item.id);
  const dialog=runtime.nodes.get('soulbound-preview');
  assert.match(dialog.innerHTML,new RegExp('data-sb-redeem="'+item.id+'"'));
  assert.match(dialog.innerHTML,/600 碎片兌換此器/);
  const button={disabled:false,dataset:{sbRedeem:item.id}};
  dialog.fire('click',{target:{closest:selector=>selector==='[data-sb-redeem]'?button:null}});
  assert.equal(runtime.requests[1].url,'/api/soulbound/redeem');
  const body=JSON.parse(runtime.requests[1].init.body);
  assert.deepEqual(Object.keys(body).sort(),['expectedFragments','itemId','poolVersion','requestId']);
  assert.equal(body.itemId,item.id);
  assert.equal(body.expectedFragments,cost);
  const result={requestId:body.requestId,kind:'redemption',itemId:item.id,name:item.name,costFragments:cost};
  runtime.requests[1].reply({...snapshot(),fragments:10,inventory:{[item.id]:1},result,redemptionCost:cost});
  await settle();
  assert.equal(runtime.player.forgeFragments,10);
  assert.equal(runtime.player.artifactSystem.inventory[item.id],1);
  assert.match(runtime.nodes.get('soulbound-status').textContent,/已兌換/);
});

test('fragment redemption is not offered when short on fragments or a draw batch is pending', async () => {
  for (const pending of [null,{requestId:'waiting-batch-0001',results:[{kind:'fragments',fragments:30}] }]) {
    const runtime=pageRuntime();runtime.open();
    runtime.requests[0].reply({...snapshot(),fragments:pending?900:200,redemptionCost:600,pending});
    await settle();runtime.preview(Pool.candidates(0)[0].id);
    assert.match(runtime.nodes.get('soulbound-preview').innerHTML,/data-sb-redeem="[^"]+" disabled/);
  }
});


test('closing the fullscreen ceremony leaves the saved batch available without another draw', async () => {
  const runtime=pageRuntime();runtime.open();
  const batch={requestId:'saved-batch-000001',cost:250,results:[{kind:'fragments',fragments:35}]};
  runtime.requests[0].reply({...snapshot(),fragments:35,pending:batch});await settle();
  runtime.revealAction('data-sb-dismiss');
  assert.equal(runtime.nodes.has('soulbound-animation'),false);
  assert.match(runtime.html(),/data-sb-resume/);
  const button={disabled:false,dataset:{},hasAttribute:name=>name==='data-sb-resume'};
  runtime.nodes.get('soulbound-content').fire('click',{target:{closest:()=>button}});
  assert.match(runtime.revealHtml(),/data-sb-flip/);
  runtime.revealAction('data-sb-flip');
  assert.match(runtime.revealHtml(),/煉器碎片 ×35/);
  assert.equal(runtime.requests.length,1,'resuming cannot charge or roll again');
});

test('failed acknowledgement keeps the revealed batch available for the same receipt retry', async () => {
  const runtime=pageRuntime();runtime.open();
  const batch={requestId:'ack-retry-batch-001',cost:250,results:[{kind:'fragments',fragments:30}]};
  runtime.requests[0].reply({...snapshot(),pending:batch});await settle();
  runtime.revealAction('data-sb-flip');runtime.revealAction('data-sb-keep');
  runtime.requests[1].reply({ok:false,error:'同步失敗'},503);await settle();
  assert.match(runtime.revealHtml(),/同步失敗/);
  assert.match(runtime.revealHtml(),/煉器碎片 ×30/);
  runtime.revealAction('data-sb-keep');
  assert.equal(JSON.parse(runtime.requests[2].init.body).requestId,batch.requestId);
  runtime.requests[2].reply(snapshot());await settle();
  assert.equal(runtime.nodes.has('soulbound-animation'),false);
});


test('five rewards appear together at regular pentagon vertices and flip automatically in order', async () => {
  const runtime=pageRuntime({fakeTime:true});runtime.open();
  const item=Pool.ITEMS[0];
  const batch={requestId:'pentagon-batch-0001',cost:2250,results:[{kind:'fragments',fragments:20},{kind:'weapon',itemId:item.id,realm:item.realm},...Array.from({length:3},(_,i)=>({kind:'fragments',fragments:25+i}))]};
  runtime.requests[0].reply({...snapshot(),pending:batch,inventory:{[item.id]:1}});await settle();
  let html=runtime.revealHtml();
  assert.equal((html.match(/data-sb-card-index=/g)||[]).length,5);
  assert.doesNotMatch(html,/data-sb-next|data-sb-previous|data-sb-flip|煉器碎片 ×20/);
  const positions=[...html.matchAll(/--sb-x:([\d.]+)%;--sb-y:([\d.]+)%/g)].map(m=>[Number(m[1]),Number(m[2])]);
  assert.equal(positions.length,5);
  const distances=positions.map((p,i)=>Math.hypot(p[0]-positions[(i+1)%5][0],p[1]-positions[(i+1)%5][1]));
  assert.ok(Math.max(...distances)-Math.min(...distances)<.00001);
  runtime.advance(149);assert.doesNotMatch(runtime.revealHtml(),/煉器碎片 ×20/);
  runtime.advance(1);assert.match(runtime.revealHtml(),/煉器碎片 ×20/);
  assert.doesNotMatch(runtime.revealHtml(),new RegExp(item.name));
  runtime.advance(250);assert.ok(runtime.revealHtml().includes(item.name));
  assert.doesNotMatch(runtime.revealHtml(),/煉器碎片 ×25/);
  runtime.advance(750);html=runtime.revealHtml();
  assert.equal((html.match(/class="sb-reveal-card is-revealed/g)||[]).length,5);
  assert.match(html,/data-sb-keep/);
  runtime.revealAction('data-sb-inspect',{sbInspect:'4'});assert.match(runtime.revealHtml(),/煉器碎片 ×27/);
  assert.equal(runtime.requests.length,1,'automatic flips never perform purchases or acknowledge receipts');
  runtime.revealAction('data-sb-keep');
  assert.equal(runtime.requests[1].url,'/api/soulbound/ack');
  runtime.requests[1].reply(snapshot());await settle();
  assert.equal(runtime.nodes.has('soulbound-animation'),false);
});

test('dismissed pentagon timers cannot reveal or acknowledge a different presentation', async () => {
  const runtime=pageRuntime({fakeTime:true});runtime.open();
  const batch={requestId:'pentagon-cancel-001',cost:2250,results:Array.from({length:5},()=>({kind:'fragments',fragments:30}))};
  runtime.requests[0].reply({...snapshot(),pending:batch});await settle();
  assert.ok(runtime.pendingTimers()>0);
  runtime.revealAction('data-sb-dismiss');runtime.advance(10000);
  assert.equal(runtime.nodes.has('soulbound-animation'),false);
  assert.equal(runtime.pendingTimers(),0);
  assert.equal(runtime.requests.length,1);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const pool = require('../public/cultivation/soulbound-pool.js');
const { transaction, createHandler } = require('../soulbound-draw-api.cjs').__test;
const { PROJECT_IDS } = require('../firebase-admin-projects.cjs');
const generation = require('../artifact-generation-api.js');
function fakeDb(user, state) {
  const docs = new Map([['users/u1', structuredClone(user)]]);
  if (state) docs.set('soulboundDrawStates/u1', structuredClone(state));
  let queue = Promise.resolve(), failCreate = false;
  const snap = key => ({ exists: docs.has(key), data: () => structuredClone(docs.get(key)) });
  return { docs, failNextCreate() { failCreate = true; },
    collection(name) { return { doc(id) { return { key: name + '/' + id }; } }; },
    runTransaction(worker) {
      const promise = queue.then(async () => {
        let writing = false; const writes = new Map();
        const tx = {
          get: async ref => { assert.equal(writing, false, 'reads must precede writes'); return snap(ref.key); },
          set(ref, value) { writing = true; writes.set(ref.key, structuredClone(value)); },
          create(ref, value) { writing = true; if (failCreate) { failCreate = false; throw new Error('database unavailable'); }
            assert.ok(!docs.has(ref.key)); writes.set(ref.key, structuredClone(value)); },
          update(ref, patch) {
            writing = true; assert.ok(docs.has(ref.key)); const value = structuredClone(docs.get(ref.key));
            for (const [path, v] of Object.entries(patch)) {
              const parts = path.split('.'), last = parts.pop(); let target = value;
              for (const part of parts) target = target[part] ||= {};
              target[last] = structuredClone(v);
            }
            writes.set(ref.key, value);
          }
        };
        const result = await worker(tx);
        for (const [key, value] of writes) docs.set(key, value);
        return result;
      });
      queue = promise.catch(() => {}); return promise;
    }
  };
}
const sample = () => ({ uid: 'u1', stats: { gold: 10000, totalScore: 28 },
  artifactSystem: { inventory: { 'void-sword': 1 }, equipped: { '本命法寶': 'void-sword' }, buffs: {} } });
const request = (index, count = 1) => ({ requestId: `draw-request-${String(index).padStart(6, '0')}`, count });
const low = () => .5;
const ack = (db, r) => transaction(db, 'u1', 'ack', { requestId: r.result.requestId });

test('permanent pool has 64 unique items, eight archetypes per tier and distinct AI artwork', () => {
  assert.equal(pool.ITEMS.length, 64); assert.equal(new Set(pool.ITEMS.map(a => a.id)).size, 64);
  for (let rank = 0; rank < 8; rank++) {
    assert.equal(pool.candidates(rank).length, 8);
    for (const item of pool.candidates(rank)) {
      assert.equal(item.equipSlot, '本命法寶'); assert.equal(item.effects.length, 3);
      assert.equal(item.effects[0].type, item.coreEffect);
      const artwork = fs.readFileSync('public' + item.imageUrl);
      assert.equal(artwork.toString('ascii', 0, 4), 'RIFF');
      assert.equal(artwork.toString('ascii', 8, 12), 'WEBP');
      assert.equal(item.imageModel, 'imagegen');
    }
  }
});
test('remote catalog replacement cannot remove or override the permanent pool', () => {
  const context = { QASoulboundPool: pool };
  const source = fs.readFileSync('public/cultivation/artifact-catalog.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.runInNewContext(source + '\nthis.api={replaceArtifactCatalog,getArtifactById,validateArtifactCatalog};', context);
  context.api.replaceArtifactCatalog([{ ...pool.ITEMS[0], name: '改名', effects: [{ type: 'equip_attack_flat', value: 999999 }] }]);
  assert.equal(context.api.getArtifactById(pool.ITEMS[0].id).name, pool.ITEMS[0].name);
  assert.equal(context.api.getArtifactById(pool.ITEMS[0].id).effects[0].type, pool.ITEMS[0].coreEffect);
  assert.equal(context.api.validateArtifactCatalog(pool.ITEMS).length, 64);
});
test('first five-pull costs 2250, grants all five and preserves legacy equipment', async () => {
  assert.equal(pool.cost(0, 0, 1), 250); assert.equal(pool.cost(0, 0, 5), 2250);
  assert.equal(pool.cost(0, 1, 5), 2500); assert.equal(pool.cost(7, 1, 1), 1200);
  const db = fakeDb(sample()), r = await transaction(db, 'u1', 'draw', request(1, 5), low);
  assert.equal(r.balance, 7750); assert.equal(r.draws, 5); assert.equal(r.untilPity, 5);
  assert.deepEqual(r.result.results.map(r => r.paid), [250, 500, 500, 500, 500]);
  assert.equal(r.result.results[4].pity, true); assert.equal(r.result.results[4].realm, '元嬰');
  assert.equal(Object.values(r.inventory).reduce((sum, n) => sum + n, 0), 6);
  assert.equal(db.docs.get('users/u1').artifactSystem.equipped['本命法寶'], 'void-sword');
});
test('concurrent same-ID retries charge and roll only once, and reject changed intent', async () => {
  const db = fakeDb(sample()); let rolls = 0;
  const results = await Promise.all(Array.from({ length: 6 }, () => transaction(db, 'u1', 'draw', request(1, 5), () => { rolls++; return .5; })));
  assert.equal(rolls, 9);
  for (const r of results) assert.deepEqual(r.result, results[0].result);
  assert.equal(db.docs.get('users/u1').stats.gold, 7750); assert.equal(db.docs.get('soulboundDrawStates/u1').draws, 5);
  await assert.rejects(transaction(db, 'u1', 'draw', request(1, 1)), /其他操作/);
  await assert.rejects(transaction(db, 'u1', 'recover', { ...request(1), itemId: pool.ITEMS[0].id }), /其他操作/);
});
test('different simultaneous IDs cannot replace an unseen batch', async () => {
  const db = fakeDb(sample());
  const r = await Promise.allSettled([transaction(db, 'u1', 'draw', request(1), low), transaction(db, 'u1', 'draw', request(2), low)]);
  assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
  assert.match(r.find(x => x.status === 'rejected').reason.message, /上一批/);
  assert.equal(db.docs.get('users/u1').stats.gold, 9750);
});
test('single and five pulls share pity, including a crossing batch; early high tiers never reset it', async () => {
  const db = fakeDb(sample()), first = await transaction(db, 'u1', 'draw', request(1), () => 0);
  assert.equal(first.result.results[0].higher, true); assert.equal(first.untilPity, 4); await ack(db, first);
  const r = await transaction(db, 'u1', 'draw', request(2, 5), low);
  assert.deepEqual(r.result.results.map(r => r.ordinal), [2, 3, 4, 5, 6]);
  assert.deepEqual(r.result.results.map(r => r.pity), [false, false, false, true, false]);
  assert.equal(r.result.results[3].realm, '元嬰'); assert.equal(r.untilPity, 4);
});
test('20% normal roll boundary and maximal featured pool contain only actual realms', () => {
  const random = chance => { const values = [chance, .999999]; return () => values.shift(); };
  assert.equal(pool.roll(0, 1, random(.19999)).higher, true); assert.equal(pool.roll(0, 1, random(.2)).higher, false);
  for (let i = 0; i < 4; i++) {
    const r = pool.roll(7, 5, () => i / 4);
    assert.equal(r.realm, '真仙'); assert.equal(r.higher, false); assert.equal(r.featured, true);
    assert.ok(pool.FEATURED.includes(pool.get(r.itemId).archetype));
  }
});
test('highest unlocked realm keeps pity through promotion, and server verifies cohort seats for immortal pool', async () => {
  const user = sample(); user.stats.totalScore = 1; user.trainingAccess = { version: 1, highestRealmScore: 68 };
  const r = await transaction(fakeDb(user, { draws: 4, lots: {} }), 'u1', 'draw', request(1), low);
  assert.equal(r.realm, '元嬰'); assert.equal(r.result.results[0].realm, '化神'); assert.equal(r.draws, 5);
  const high = sample(); high.stats.totalScore = 1868; high.profile = { educationLevel: '國中' };
  const db = fakeDb(high, { draws: 4, lots: {} });
  assert.equal((await transaction(db, 'u1')).realm, '半仙');
  db.docs.set('worldImmortals/elementary__ru-xian', { uid: 'u1', cohort: 'elementary' });
  assert.equal((await transaction(db, 'u1')).realm, '半仙');
  db.docs.set('worldImmortals/junior__ru-xian', { uid: 'u1', cohort: 'junior' });
  const top = await transaction(db, 'u1', 'draw', request(1), low);
  assert.equal(top.realm, '真仙'); assert.equal(top.result.results[0].featured, true);
});
test('invalid sizes, malformed request IDs, insufficient funds and locked access cannot mint', async () => {
  for (const count of [0, 2, 4, 6, '5']) await assert.rejects(transaction(fakeDb(sample()), 'u1', 'draw', request(1, count)), /單抽或五連/);
  const poor = sample(); poor.stats.gold = 2249; const db = fakeDb(poor);
  await assert.rejects(transaction(db, 'u1', 'draw', request(1, 5)), /靈石不足/);
  assert.deepEqual(db.docs.get('users/u1'), poor); assert.equal(db.docs.size, 1);
  const lowUser = sample(); lowUser.stats.totalScore = 10;
  await assert.rejects(transaction(fakeDb(lowUser), 'u1', 'draw', request(1)), /金丹/);
  await assert.rejects(transaction(db, 'u1', 'draw', { requestId: '../bad', count: 1 }), /編號/);
});
test('database failure rolls back balance, inventory, pity and receipt as a unit', async () => {
  const user = sample(), db = fakeDb(user); db.failNextCreate();
  await assert.rejects(transaction(db, 'u1', 'draw', request(1, 5), low), /unavailable/);
  assert.deepEqual(db.docs.get('users/u1'), user); assert.equal(db.docs.size, 1);
  const retry = await transaction(db, 'u1', 'draw', request(1, 5), low); assert.equal(retry.balance, 7750); assert.equal(retry.draws, 5);
});
test('reload returns saved results and stale acknowledgement cannot clear a newer batch', async () => {
  const db = fakeDb(sample()), first = await transaction(db, 'u1', 'draw', request(1, 5), low);
  assert.deepEqual((await transaction(db, 'u1')).pending, first.result);
  await transaction(db, 'u1', 'ack', { requestId: request(2).requestId }); assert.ok((await transaction(db, 'u1')).pending);
  await ack(db, first); const next = await transaction(db, 'u1', 'draw', request(2), low); await ack(db, first);
  assert.deepEqual((await transaction(db, 'u1')).pending, next.result);
  const retry = await transaction(db, 'u1', 'draw', request(1, 5), () => { throw new Error('must not roll'); });
  assert.deepEqual(retry.result, first.result); assert.deepEqual(retry.pending, next.result);
});
test('recovery refunds actual paid prices, preserves equipped copy, and cannot pay twice', async () => {
  const db = fakeDb(sample()), batch = await transaction(db, 'u1', 'draw', request(1, 5), low); await ack(db, batch);
  const id = batch.result.results[0].itemId; db.docs.get('users/u1').artifactSystem.equipped['本命法寶'] = id;
  const sell = { requestId: 'recover-request-000001', itemId: id, refund: 99999, paid: 99999 };
  const sales = await Promise.all([transaction(db, 'u1', 'recover', sell), transaction(db, 'u1', 'recover', sell)]);
  assert.equal(sales[0].result.refund, 75); assert.deepEqual(sales[0].result, sales[1].result);
  assert.equal(sales[0].inventory[id], 3); assert.equal(db.docs.get('users/u1').stats.gold, 7825);
  const sale2 = await transaction(db, 'u1', 'recover', { ...sell, requestId: 'recover-request-000002' });
  assert.equal(sale2.result.refund, 150); assert.equal(sale2.inventory[id], 2);
  await transaction(db, 'u1', 'recover', { ...sell, requestId: 'recover-request-000003' });
  await assert.rejects(transaction(db, 'u1', 'recover', { ...sell, requestId: 'recover-request-000004' }), /至少保留一件/);
  assert.equal(db.docs.get('users/u1').artifactSystem.equipped['本命法寶'], id);
});
test('legacy and refined items, or copies already consumed by refinement, cannot be recovered', async () => {
  const user = sample(), id = pool.ITEMS[0].id; user.artifactSystem.inventory[id] = 1; user.artifactSystem.inventory['refined-item'] = 3;
  const db = fakeDb(user, { draws: 4, lots: { [id]: { 500: 4 }, 'refined-item': { 500: 4 } } });
  for (const itemId of [id, 'refined-item', 'void-sword']) await assert.rejects(transaction(db, 'u1', 'recover', { requestId: 'recover-request-000001', itemId }), /重複原器/);
  assert.equal(db.docs.get('users/u1').stats.gold, 10000);
});
test('all eight archetypes inherit their explicit core even when reordered during refinement', () => {
  for (const item of pool.candidates(0)) for (const stage of [2, 3]) {
    const original = { ...item, effects: [...item.effects].reverse() };
    const r = generation.sanitizeGeneratedArtifact({ name: '精煉器', equipSlot: '護身法寶', effects: [{ type: 'equip_attack_flat', value: 99 }] }, '元嬰', stage, {}, {}, 3, { primaryArtifacts: [original] });
    assert.equal(r.equipSlot, '本命法寶'); assert.equal(r.coreEffect, item.coreEffect); assert.ok(r.effects.some(e => e.type === item.coreEffect));
  }
});
test('API checks revocation and rejects missing or secondary-project identities before assets', async () => {
  const response = () => ({ statusCode: 200, set() {}, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } });
  for (const identity of [null, { uid: 'u1', aud: PROJECT_IDS.C, iss: 'https://securetoken.google.com/' + PROJECT_IDS.C }]) {
    const res = response(); let revoked;
    const handler = createHandler({ resolveA: () => ({ auth: { async verifyIdToken(token, r) { revoked = r; if (!identity) throw new Error('revoked'); return identity; } } }) });
    await handler({ get: () => 'Bearer token', body: {} }, res); assert.equal(res.statusCode, 401); assert.equal(revoked, true);
  }
  const res = response(); await createHandler({ resolveA: () => { throw new Error('must not resolve'); } })({ get: () => '' }, res); assert.equal(res.statusCode, 401);
});
test('star burst deterministically boosts only every third correct hit, through battle and raid paths', () => {
  const context = { window: {}, QACombatCombo: require('../public/cultivation/combat-combo.js') };
  vm.runInNewContext(fs.readFileSync('public/cultivation/artifact-battle-effects.js', 'utf8').replace(/^import .*;\n/gm, ''), context);
  const attacker = { uid: 'a', hp: 1000, maxHp: 1000, artifactBattle: { effects: [{ type: 'equip_streak_damage_percent', value: .15 }] } };
  const hit = streak => context.window.resolveArtifactBattleAttack({ attacker: { ...attacker, coreCorrectStreak: streak }, defender: {}, baseDamage: 200, seed: 'fixed' });
  for (const streak of [0, 1, 2, 4, 5]) assert.equal(hit(streak).normalDamage, 200);
  for (const streak of [3, 6]) { assert.equal(hit(streak).normalDamage, 230); assert.match(hit(streak).skill, /連答爆發/); }
  assert.match(fs.readFileSync('public/cultivation/battle-engine-v2.js', 'utf8'), /player.coreCorrectStreak = support.streak/);
  assert.match(fs.readFileSync('public/cultivation/raid-combat.js', 'utf8'), /p.coreCorrectStreak = support.streak/);
});

test('refining raw copies removes low-price lots before a later actual-price recovery', async () => {
  const user = sample(), id = pool.ITEMS[0].id;
  user.artifactSystem.inventory[id] = 2;
  const db = fakeDb(user, { draws: 4, lots: { [id]: { 250: 1, 500: 3 } } });
  const view = await transaction(db, 'u1');
  assert.equal(view.recovery[0].refund, 150);
  assert.equal(db.docs.get('soulboundDrawStates/u1').lots[id][250], 0);
  assert.equal(db.docs.get('soulboundDrawStates/u1').lots[id][500], 2);
});

test('administrator deletion cannot remove permanent pool originals or player copies', async () => {
  const create = require('../admin-artifact-delete-api.cjs').__test.createAdminArtifactDeleteHandler;
  const resolve = () => ({auth:{verifyIdToken:async()=>({uid:'admin',aud:PROJECT_IDS.A,iss:'https://securetoken.google.com/'+PROJECT_IDS.A})},db:{collection(name){assert.equal(name,'users');return{doc(){return{get:async()=>({exists:true,data:()=>({isAdmin:true})})}}}}}});
  const res={set(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
  await create({resolve})({get:()=> 'Bearer token',body:{itemId:pool.ITEMS[0].id,action:'delete'}},res);
  assert.equal(res.code,409);assert.match(res.body.error,/常駐本命/);
});

test('server raid snapshots always include fixed soulbound items and star burst affects actual raid damage', () => {
  const authority = require('../raid-authority.cjs'), item = pool.get('soul-star-golden-core');
  const user = sample(); user.artifactSystem.inventory[item.id] = 1; user.artifactSystem.equipped['本命法寶'] = item.id;
  const snapshot = authority.trustedRaidPlayerSnapshot(user, 'u1', { artifactCatalogSchemaVersion: 2, items: [{ ...item, effects: [{ type: 'equip_attack_flat', value: 999999 }] }] });
  assert.equal(snapshot.atk, 225); assert.equal(snapshot.maxHp, 1080);
  assert.ok(snapshot.artifactBattle.effects.some(e=>e.type===item.coreEffect));
  let member = snapshot;
  for (let i=1;i<=3;i++) {
    const r=authority.resolvePlayerAction(member,{roomId:'soul-raid',actionId:i,correct:true,bossHp:100000,bossMaxHp:100000});
    assert.equal(r.damage,i===3?259:225);member=r.member;
  }
  const miss=authority.resolvePlayerAction(member,{roomId:'soul-raid',actionId:4,correct:false});
  assert.equal(miss.member.coreCorrectStreak,0);
});
test('a stale displayed quote cannot charge a higher amount after a realm promotion', async () => {
  const user = sample();user.stats.totalScore=68;
  const db=fakeDb(user,{draws:1,lots:{}});
  await assert.rejects(transaction(db,'u1','draw',{...request(1),expectedCost:500}),/價格已更新/);
  assert.deepEqual(db.docs.get('users/u1'),user);
});

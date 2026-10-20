'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const pool = require('../public/cultivation/soulbound-pool.js');
const { transaction, createHandler } = require('../soulbound-draw-api.cjs').__test;
const { PROJECT_IDS } = require('../firebase-admin-projects.cjs');
const generation = require('../artifact-generation-api.js');
const { fakeDb } = require('./helpers/inventory-db.cjs');
const sample = () => ({ uid: 'u1', stats: { gold: 10000, totalScore: 28 },
  artifactSystem: { inventory: { 'void-sword': 1 }, equipped: { '本命法寶': 'void-sword' }, buffs: {} } });
const request = (index, count = 1) => ({ requestId: `draw-request-${String(index).padStart(6, '0')}`, count, poolVersion:pool.VERSION });
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
test('first five-pull costs 2250 and grants fragments without changing legacy equipment', async () => {
  assert.equal(pool.cost(0,0,1),250);assert.equal(pool.cost(0,0,5),2250);assert.equal(pool.cost(0,1,5),2500);
  const db=fakeDb(sample()),r=await transaction(db,'u1','draw',request(1,5),low);
  assert.equal(r.balance,7750);assert.equal(r.fragments,150);assert.equal(r.untilPity,15);
  assert.deepEqual(r.result.results.map(x=>x.kind),Array(5).fill('fragments'));
  assert.equal(r.inventory['void-sword'],1);assert.equal(Object.hasOwn(r.inventory,'undefined'),false);
  assert.equal(db.docs.get('users/u1').artifactSystem.equipped['本命法寶'],'void-sword');
});

test('concurrent same-ID retries charge and roll only once, and reject changed intent', async () => {
  const db = fakeDb(sample()); let rolls = 0;
  const results = await Promise.all(Array.from({ length: 6 }, () => transaction(db, 'u1', 'draw', request(1, 5), () => { rolls++; return .5; })));
  assert.equal(rolls, 10);
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
test('single and five pulls share 20-pull pity and a weapon resets the counter within a batch', async () => {
 const db=fakeDb(sample(),{draws:100,misses:18,lots:{},poolVersion:pool.VERSION});
 const r=await transaction(db,'u1','draw',request(1,5),low);
 assert.deepEqual(r.result.results.map(x=>x.kind),['fragments','weapon','fragments','fragments','fragments']);
 assert.equal(r.result.results[1].pity,true);assert.equal(r.misses,3);assert.equal(r.untilPity,17);assert.equal(r.draws,105);
 const earlyDb=fakeDb(sample(),{draws:100,misses:10,poolVersion:pool.VERSION});
 const early=await transaction(earlyDb,'u1','draw',request(2),()=>0);assert.equal(early.result.results[0].kind,'weapon');assert.equal(early.untilPity,20);
});

test('2% weapon boundary, fragment bounds and guarantee include all eight common weapons', () => {
 const sequence=(...values)=>()=>values.shift();
 assert.equal(pool.roll(0,0,sequence(.019999,.5,.5)).kind,'weapon');
 assert.equal(pool.roll(0,0,sequence(.02,0)).fragments,20);
 assert.equal(pool.roll(0,0,sequence(.5,.999999)).fragments,40);
 for(let i=0;i<8;i++){
  const row=pool.roll(7,19,()=>i/8);assert.equal(row.kind,'weapon');assert.equal(row.pity,true);assert.equal(row.realm,'真仙');
  assert.equal(pool.get(row.itemId).archetype,pool.TYPES[i].id);
 }
});

test('twenty consecutive non-weapon rolls cannot pass without awarding a common-pool weapon', async () => {
  const player=sample();player.stats.gold=100000;const db=fakeDb(player);
  for(let i=1;i<=20;i++){
    const result=await transaction(db,'u1','draw',request(i),low);
    assert.equal(result.result.results[0].kind,i===20?'weapon':'fragments');
    if(i<20)assert.equal(result.untilPity,20-i);else{assert.equal(result.untilPity,20);assert.equal(result.result.results[0].pity,true);}
    await ack(db,result);
  }
  assert.equal(db.docs.get('users/u1').forgeFragments,19*30);
});

test('normal and guaranteed draws use all eight weapons regardless of a requested target', async () => {
  for (const misses of [0, 19]) for (let i = 0; i < pool.TYPES.length; i++) {
    const db = fakeDb(sample(), { draws: 100, misses, lots: {}, poolVersion: pool.VERSION });
    const values = [...(misses === 0 ? [0] : []), .9, (i + .5) / pool.TYPES.length];
    const result = await transaction(db, 'u1', 'draw', {
      ...request(1), itemId: pool.candidates(0)[0].id, targetArchetype: 'sword'
    }, () => { assert.ok(values.length, 'unexpected random call'); return values.shift(); });
    const row = result.result.results[0];
    assert.equal(pool.get(row.itemId).archetype, pool.TYPES[i].id);
    assert.equal(row.pity, misses === 19);
    assert.equal(result.untilPity, 20);
    assert.equal(db.docs.get('users/u1').artifactSystem.inventory[row.itemId], 1);
  }
});

test('common-pool presentation rotates three visible weapons without selecting a draw target', () => {
  const source = fs.readFileSync('public/cultivation/soulbound-draw.js', 'utf8');
  const markup = source.slice(source.indexOf('  function showcaseMarkup('), source.indexOf('  function probabilityMarkup('));
  const context = {
    pool, carouselStart: 0, esc: value => String(value ?? ''),
    image: item => '<img src="' + item.imageUrl + '">',
    artifactRealmColor: () => '#c7a35e'
  };
  vm.runInNewContext(markup + '\nthis.showcaseMarkup = showcaseMarkup;', context);
  for (let rank = 0; rank < pool.REALMS.length; rank++) {
    const candidates = pool.candidates(rank);
    const first = context.showcaseMarkup(candidates);
    assert.match(first, /<h3>常駐法器<\/h3>/);
    assert.equal((first.match(/data-sb-preview=/g) || []).length, 4);
    assert.equal((first.match(/aria-hidden="true"/g) || []).length, 1);
    assert.equal((first.match(/is-center/g) || []).length, 1);
    for (const item of candidates.slice(0, 4)) assert.ok(first.includes(item.imageUrl), item.name);
    context.carouselStart = 1;
    const second = context.showcaseMarkup(candidates);
    assert.ok(!second.includes(candidates[0].imageUrl));
    assert.ok(second.includes(candidates[4].imageUrl), 'new weapon enters from right');
    context.carouselStart = 0;
  }
  assert.doesNotMatch(source, /galleryMarkup|池內法器一覽|寶庫 · 調御與精煉|data-sb-refine/);
  assert.match(source, /data-sb-preview/);
  assert.doesNotMatch(source, /previewArchetype|targetArchetype/);
});


test('promotion preserves the consecutive counter and server verifies immortal cohort seats', async () => {
 const user=sample();user.stats.totalScore=1;user.trainingAccess={version:1,highestRealmScore:68};
 const r=await transaction(fakeDb(user,{draws:19,misses:19,poolVersion:pool.VERSION}),'u1','draw',request(1),()=>0);
 assert.equal(r.realm,'元嬰');assert.equal(r.result.results[0].realm,'化神');assert.equal(r.untilPity,20);
 const high=sample();high.stats.totalScore=1868;high.profile={educationLevel:'國中'};
 const db=fakeDb(high);assert.equal((await transaction(db,'u1')).realm,'半仙');
 db.docs.set('worldImmortals/elementary__ru-xian',{uid:'u1',cohort:'elementary'});assert.equal((await transaction(db,'u1')).realm,'半仙');
 db.docs.set('worldImmortals/junior__ru-xian',{uid:'u1',cohort:'junior'});assert.equal((await transaction(db,'u1')).realm,'真仙');
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
test('new gold recovery requests are disabled in favor of confirmed fragment dismantling', async () => {
 const db=fakeDb(sample());await assert.rejects(transaction(db,'u1','recover',{requestId:'recover-request-000001',itemId:pool.ITEMS[0].id}),/碎片分解/);
 assert.equal(db.docs.get('users/u1').stats.gold,10000);
});

test('legacy draw history and unfinished weapon receipts survive migration without counting old weapon draws as misses', async () => {
 const result={requestId:'old-draw-request-000001',poolVersion:'soulbound-v1',cost:500,results:[{itemId:pool.ITEMS[0].id,realm:'金丹',paid:500,ordinal:125}]};
 const db=fakeDb(sample(),{draws:125,pending:'old-receipt',lots:{}});
 db.docs.set('soulboundDrawReceipts/old-receipt',{uid:'u1',action:'draw',count:1,result});
 const view=await transaction(db,'u1');assert.deepEqual(view.pending,result);assert.equal(view.draws,125);assert.equal(view.misses,0);assert.equal(view.untilPity,20);
 await assert.rejects(transaction(db,'u1','draw',request(1)),/上一批/);
 await transaction(db,'u1','ack',{requestId:result.requestId});const next=await transaction(db,'u1','draw',request(1),low);assert.equal(next.misses,1);
});

test('the former fifty-pull pool retains miss progress and guarantees the next draw once nineteen are reached', async () => {
 assert.equal(pool.PITY,20);
 for(const misses of [0,5,18,19,20,35,49]) {
  for(const payment of ['gold','ticket']) {
   const user=sample();user.soulboundDrawTickets=1;
   const db=fakeDb(user,{draws:100,misses,poolVersion:'soulbound-v2-fragments50'});
   const view=await transaction(db,'u1');
   assert.equal(view.draws,100);assert.equal(view.misses,Math.min(19,misses));
   assert.equal(view.untilPity,Math.max(1,20-misses));
   assert.equal(db.docs.get('soulboundDrawStates/u1').poolVersion,pool.VERSION);
   const result=await transaction(db,'u1','draw',{...request(950),payment},low);
   assert.equal(result.result.results[0].kind,misses>=19?'weapon':'fragments');
   assert.equal(result.result.results[0].pity,misses>=19);
   assert.equal(result.untilPity,misses>=19?20:19-misses);
   assert.equal(result.draws,101);
   assert.equal(result.balance,payment==='ticket'?10000:9500);
  }
 }
});

test('old fragment receipts replay unchanged and pending batches must be acknowledged before the new guarantee', async () => {
 const {requestKey}=require('../soulbound-draw-api.cjs').__test;
 const body={...request(951),poolVersion:'soulbound-v2-fragments50'};
 const key=requestKey('u1',body.requestId),saved={requestId:body.requestId,poolVersion:body.poolVersion,cost:500,
  payment:'gold',ticketsSpent:0,results:[{kind:'fragments',fragments:30,pity:false,paid:500,ordinal:36}]};
 const user=sample();user.stats.gold=9500;user.forgeFragments=30;
 const db=fakeDb(user,{draws:36,misses:36,pending:key,poolVersion:body.poolVersion});
 db.docs.set('soulboundDrawReceipts/'+key,{uid:'u1',action:'draw',count:1,result:saved});
 const repeat=await transaction(db,'u1','draw',body,()=>assert.fail('saved receipts must not reroll'));
 assert.deepEqual(repeat.result,saved);assert.deepEqual(repeat.pending,saved);
 assert.equal(repeat.balance,9500);assert.equal(repeat.fragments,30);assert.equal(repeat.untilPity,1);
 await assert.rejects(transaction(db,'u1','draw',request(952),low),/上一批/);
 await transaction(db,'u1','ack',{requestId:body.requestId});
 await assert.rejects(transaction(db,'u1','draw',{...request(952),poolVersion:body.poolVersion}),/獎池已更新/);
 const next=await transaction(db,'u1','draw',request(952),low);
 assert.equal(next.result.results[0].pity,true);assert.equal(next.untilPity,20);
 assert.equal(next.balance,9000);assert.equal(next.fragments,30);
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
  assert.match(fs.readFileSync('raid-authority.cjs', 'utf8'), /next.coreCorrectStreak=support.streak/);
});

test('a stale pool version cannot spend currency, and database transaction retries commit only one fragment award', async () => {
 const db=fakeDb(sample());await assert.rejects(transaction(db,'u1','draw',{...request(1),poolVersion:'soulbound-v1'}),/獎池已更新/);
 db.retryNextTransaction();const result=await transaction(db,'u1','draw',request(1),low);assert.equal(result.fragments,30);assert.equal(result.draws,1);assert.equal(result.balance,9750);
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


test('ticket draws share pity, consume the requested vouchers atomically and never spend gold',async()=>{
  const p=sample();p.soulboundDrawTickets=5;p.stats.gold=0;
  const db=fakeDb(p,{draws:10,misses:18,poolVersion:pool.VERSION});
  const body={...request(900,5),payment:'ticket',expectedCost:0};
  const result=await transaction(db,'u1','draw',body,low);
  assert.equal(result.result.ticketsSpent,5);assert.equal(result.drawTickets,0);assert.equal(result.balance,0);
  assert.equal(result.result.results[1].pity,true);assert.ok(result.result.results.every(row=>row.paid===0));
  await transaction(db,'u1','draw',body,low);assert.equal(db.docs.get('users/u1').soulboundDrawTickets,0);
  await assert.rejects(transaction(db,'u1','draw',{...body,payment:'gold'}),/其他操作/);
});
test('insufficient tickets never fall back to gold and failures do not consume tickets or pity',async()=>{
  const p=sample();p.soulboundDrawTickets=1;const db=fakeDb(p);
  await assert.rejects(transaction(db,'u1','draw',{...request(901,5),payment:'ticket'}),/抽獎券不足/);
  assert.equal(db.docs.get('users/u1').stats.gold,10000);assert.equal(db.docs.get('users/u1').soulboundDrawTickets,1);
  db.failNextCreate();await assert.rejects(transaction(db,'u1','draw',{...request(902),payment:'ticket'},low),/database unavailable/);
  assert.equal(db.docs.get('users/u1').soulboundDrawTickets,1);assert.equal(db.docs.has('soulboundDrawStates/u1'),false);
});
test('pre-Golden players keep their vouchers, and unrecognized payment types are rejected',async()=>{
  const p=sample();p.stats.totalScore=27;p.soulboundDrawTickets=3;const db=fakeDb(p);
  await assert.rejects(transaction(db,'u1','draw',{...request(903),payment:'ticket'}),/金丹境/);
  await assert.rejects(transaction(db,'u1','draw',{...request(904),payment:'free'}),/抽取方式/);
  assert.equal(db.docs.get('users/u1').soulboundDrawTickets,3);
});

test('fragments redeem a selected permanent weapon exactly once without touching draw pity', async () => {
  const user = sample();
  const cost = pool.redemptionCost(0);
  user.forgeFragments = cost + 25;
  const db = fakeDb(user);
  const itemId = pool.candidates(0)[3].id;
  const body = { requestId:'redeem-request-000001', itemId, expectedFragments:cost, poolVersion:pool.VERSION };
  const first = await transaction(db,'u1','redeem',body);
  assert.equal(first.result.kind,'redemption');
  assert.equal(first.result.itemId,itemId);
  assert.equal(first.fragments,25);
  assert.equal(first.inventory[itemId],1);
  assert.equal(first.draws,0);
  assert.equal(first.untilPity,20);
  assert.equal(first.balance,10000);
  const replay = await transaction(db,'u1','redeem',body);
  assert.deepEqual(replay.result,first.result);
  assert.equal(replay.fragments,25);
  assert.equal(replay.inventory[itemId],1);
  await assert.rejects(transaction(db,'u1','redeem',{...body,itemId:pool.candidates(0)[4].id}),/其他操作/);
});

test('fragment redemption checks tier, price, sufficient funds and a pending draw', async () => {
  const cost = pool.redemptionCost(0);
  const user = sample(); user.forgeFragments = cost - 1;
  const db = fakeDb(user);
  const id = pool.candidates(0)[0].id;
  const base = {requestId:'redeem-request-000002',itemId:id,expectedFragments:cost,poolVersion:pool.VERSION};
  await assert.rejects(transaction(db,'u1','redeem',base),/碎片不足/);
  await assert.rejects(transaction(db,'u1','redeem',{...base,expectedFragments:cost-1}),/價格已更新/);
  await assert.rejects(transaction(db,'u1','redeem',{...base,itemId:pool.candidates(1)[0].id}),/目前境界/);
  await assert.rejects(transaction(db,'u1','redeem',{...base,itemId:'forged-id'}),/目前境界/);
  assert.deepEqual(db.docs.get('users/u1'),user);
  db.docs.get('users/u1').forgeFragments = cost;
  const drawn = await transaction(db,'u1','draw',request(3),low);
  await assert.rejects(transaction(db,'u1','redeem',base),/上一批/);
  await ack(db,drawn);
  const purchased = await transaction(db,'u1','redeem',base);
  assert.equal(purchased.fragments,30); // drawn fragment reward is still available
  assert.equal(purchased.untilPity,19);
});

test('failed and concurrent fragment redemptions never duplicate an item or overspend', async () => {
  const cost = pool.redemptionCost(0), user = sample();
  user.forgeFragments=cost;
  const db=fakeDb(user), a=pool.candidates(0)[0].id,b=pool.candidates(0)[1].id;
  const body=(itemId,n)=>({requestId:'redeem-request-'+String(n).padStart(6,'0'),itemId,expectedFragments:cost,poolVersion:pool.VERSION});
  db.failNextCreate();
  await assert.rejects(transaction(db,'u1','redeem',body(a,10)),/unavailable/);
  assert.deepEqual(db.docs.get('users/u1'),user);
  const pair=await Promise.allSettled([transaction(db,'u1','redeem',body(a,10)),transaction(db,'u1','redeem',body(b,11))]);
  assert.equal(pair.filter(row=>row.status==='fulfilled').length,1);
  assert.equal(db.docs.get('users/u1').forgeFragments,0);
  assert.equal(Object.values(db.docs.get('users/u1').artifactSystem.inventory).reduce((a,b)=>a+b,0),2);
});

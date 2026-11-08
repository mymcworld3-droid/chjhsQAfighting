'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Rules=require('../martial-trial-api.cjs').__test;
const fs=require('node:fs');
const NOW=1800000000000;
function user(extra={}){return {displayName:'演武修士',stats:{totalScore:1868,attack:200,maxHp:1000},...extra};}
function database(player=user()){
 const records=new Map([['users/u',structuredClone(player)]]);let queue=Promise.resolve();
 const snap=key=>({exists:records.has(key),data:()=>structuredClone(records.get(key))});
 return {records,collection:name=>({doc:id=>({key:name+'/'+id,get:async()=>snap(name+'/'+id)})}),runTransaction(worker){
  const work=queue.then(async()=>{const writes=new Map();const result=await worker({get:async ref=>{assert.equal(writes.size,0);return snap(ref.key);},set:(ref,value)=>writes.set(ref.key,structuredClone(value)),update:(ref,patch)=>{const value=structuredClone(writes.get(ref.key)||records.get(ref.key));for(const [key,next]of Object.entries(patch)){const parts=key.split('.');let cursor=value;for(const part of parts.slice(0,-1)){cursor[part]||={};cursor=cursor[part];}cursor[parts.at(-1)]=structuredClone(next);}writes.set(ref.key,value);}});for(const [key,value]of writes)records.set(key,value);return result;});queue=work.catch(()=>{});return work;
 }};
}
const saved=db=>db.records.get(Rules.COLLECTION+'/u');
let requests=0;
const body=(state,extra={})=>({requestId:'request-'+String(++requests).padStart(8,'0'),runId:state.runId,floor:state.floor,round:state.round,...extra});
async function answerBody(db,state,correct=true,now=NOW){
 const expected=await Rules.prepareQuestion(db,'u',now);
 const q=await Rules.commitQuestion(db,'u',expected,{q:`第 ${expected.floor} 層第 ${expected.index} 回合：何者正確？`,correct:'正確',wrong:['錯一','錯二','錯三'],exp:'正確選項符合題目條件。'},now);
 const index=saved(db).run.pendingQuestion.correctIndex;
 return body(state,{questionId:q.id,choice:correct?index:(index+1)%4});
}
async function fight(db,state,now=NOW){for(let i=0;i<24&&state.status==='active';i++)state=await Rules.act(db,'u','turn',await answerBody(db,state,true,now+1000*i),now+1000*i);return state;}
test('start uses saved owned equipment and ignores fabricated statistics; no resources or permanent HP change',async()=>{
 const player=user({artifactSystem:{inventory:{'soul-sword-immortal':1},equipped:{本命法寶:'soul-sword-immortal',護身法寶:'fake'}}});
 const db=database(player),before=structuredClone(player);
 const state=await Rules.start(db,'u',{requestId:'start-run-1',atk:999999,maxHp:999999,floor:1},NOW);
 assert.equal(state.status,'active');assert.equal(state.floor,1);assert.equal(state.challenger.atk,344);
 assert.ok(state.challenger.maxHp<999999);assert.ok(state.challenger.equipment.includes('逐風飛劍'));
 assert.deepEqual(db.records.get('users/u'),before);
 assert.equal((await Rules.start(db,'u',{requestId:'resume-run-1',floor:96},NOW)).runId,state.runId);
});
test('eligibility, request IDs, checkpoint skips and tactics are validated',async()=>{
 await assert.rejects(Rules.start(database(user({stats:{totalScore:27}})),'u',{requestId:'valid-request'},NOW),e=>e.status===403);
 await assert.rejects(Rules.start(database(),'u',{requestId:'x'},NOW),e=>e.status===400);
 await assert.rejects(Rules.start(database(),'u',{requestId:'valid-request',floor:11},NOW),e=>e.status===400);
 const db=database(),state=await Rules.start(db,'u',{requestId:'valid-request'},NOW);
 await assert.rejects(Rules.act(db,'u','turn',body(state,{tactic:'instant-win'}),NOW),e=>e.status===400);
 await assert.rejects(Rules.act(db,'u','turn',{...await answerBody(db,state),runId:'other'},NOW),e=>e.status===409);
});
test('turns are authoritative, idempotent, serialized and paced; stale or changed requests cannot act twice',async()=>{
 const db=database(),state=await Rules.start(db,'u',{requestId:'start-the-run'},NOW),request=await answerBody(db,state);
 const [a,b]=await Promise.all([Rules.act(db,'u','turn',request,NOW),Rules.act(db,'u','turn',request,NOW)]);
 assert.deepEqual(a,b);assert.equal(a.round,1);
 await assert.rejects(Rules.act(db,'u','turn',{...request,choice:(request.choice+1)%4},NOW),e=>e.status===409);
 await assert.rejects(Rules.act(db,'u','turn',await answerBody(db,a),NOW+1),e=>e.status===429);
 await assert.rejects(Rules.act(db,'u','turn',await answerBody(db,state),NOW+1000),e=>e.status===409);
});
test('correct answers attack first, wrong answers cannot attack, and surviving opponents attack every round',async()=>{
 for(const correct of [true,false]){
  const db=database(),start=await Rules.start(db,'u',{requestId:'answer-gate-start'},NOW);
  const next=await Rules.act(db,'u','turn',await answerBody(db,start,correct),NOW);
  assert.equal(next.lastTurn.correct,correct);assert.equal(next.charge,undefined);assert.equal(next.intent,undefined);
  const attacks=next.lastTurn.steps.filter(s=>s.type==='attack');
  assert.ok(attacks.some(s=>s.actorRole==='guest'));assert.equal(attacks.some(s=>s.actorRole==='host'),correct);
  if(correct)assert.deepEqual(attacks.map(s=>s.actorRole),['host','guest']);
  else assert.equal(next.defender.hp,start.defender.hp);
  assert.ok(next.challenger.hp<start.challenger.hp);
  assert.equal([...db.records.keys()].filter(k=>k.startsWith('exam_logs/')).length,1);
 }
 const stronger=database(user({artifactSystem:{inventory:{'soul-axe-immortal':1},equipped:{本命法寶:'soul-axe-immortal'}}}));
 const start=await Rules.start(stronger,'u',{requestId:'stronger-run'},NOW);
 const upgraded=await Rules.act(stronger,'u','turn',await answerBody(stronger,start),NOW);
 assert.ok(upgraded.defender.hp<start.defender.hp-200);
});
test('clearing saves best progress once, next stage resets combat without refreshing the locked build',async()=>{
 const db=database(user({stats:{totalScore:1868,attack:900,maxHp:1000}})),before=structuredClone(db.records.get('users/u'));
 let state=await Rules.start(db,'u',{requestId:'start-run-wins'},NOW);state=await fight(db,state);
 assert.equal(state.status,'cleared');assert.equal(state.bestFloor,1);assert.equal(state.totalWins,1);
 db.records.get('users/u').stats.attack=10;
 const nextBody=body(state),next=await Rules.act(db,'u','next',nextBody,NOW+30000);
 assert.equal(next.floor,2);assert.equal(next.round,0);assert.equal(next.challenger.hp,next.challenger.maxHp);assert.equal(next.challenger.atk,900);
 assert.deepEqual(await Rules.act(db,'u','next',nextBody,NOW+30000),next);
 assert.equal(db.records.get('users/u').stats.maxHp,before.stats.maxHp);assert.equal(saved(db).totalWins,1);
});
test('failed fights and voluntary exits preserve best scores; expired fights restart at the next uncleared floor',async()=>{
 const db=database(user({stats:{totalScore:28,attack:1,maxHp:1}}));
 let state=await Rules.start(db,'u',{requestId:'losing-start'},NOW);state=await fight(db,state);
 assert.equal(state.status,'defeated');assert.equal(state.bestFloor,0);
 saved(db).bestFloor=12;
 state=await Rules.start(db,'u',{requestId:'checkpoint-start'},NOW+30000);assert.equal(state.floor,13);
 const abandoned=await Rules.act(db,'u','abandon',body(state),NOW+31000);assert.equal(abandoned.bestFloor,12);assert.equal(abandoned.status,'abandoned');
 state=await Rules.start(db,'u',{requestId:'expiry-start'},NOW+32000);
 assert.equal(Rules.view(saved(db),NOW+Rules.TTL+40000).status,'expired');
 const expiredRequest=await answerBody(db,state,true,NOW+32000);
 await assert.rejects(Rules.act(db,'u','turn',expiredRequest,NOW+Rules.TTL+40000),e=>e.status===410);
 const restarted=await Rules.start(db,'u',{requestId:'restarted-after-expiry'},NOW+Rules.TTL+40000);assert.equal(restarted.floor,13);assert.notEqual(restarted.runId,state.runId);
});
test('enemy progression increases through 100 floors and realms advance every ten floors',()=>{
 let previous={atk:0,maxHp:0};for(let floor=1;floor<=100;floor++){const e=Rules.enemy(floor);assert.ok(e.atk>previous.atk&&e.maxHp>previous.maxHp);assert.equal(!!e.goldenCore,floor>=21);if(floor>1)assert.ok(e.totalScore>=previous.totalScore);previous=e;}
 assert.equal(Rules.enemy(1).realm,'煉氣期');assert.equal(Rules.enemy(11).realm,'築基期');assert.equal(Rules.enemy(81).realm,'真仙');assert.equal(Rules.enemy(91).realm,'超脫');assert.equal(Rules.enemy(51).realm,'合體期');
 assert.equal(Rules.checkpoint(0),1);assert.equal(Rules.checkpoint(5),6);assert.equal(Rules.checkpoint(16),17);assert.equal(Rules.checkpoint(99),100);assert.equal(Rules.checkpoint(100),100);
});
test('clearing floor 16 permanently unlocks floor 17, including after leaving, losing or expiring, without replaying old floors',async()=>{
 const db=database(user({stats:{totalScore:1868,attack:9000,maxHp:1000}}));
 const floors=Array.from({length:15},(_,i)=>i+1);
 db.records.set(Rules.COLLECTION+'/u',{version:1,uid:'u',bestFloor:15,totalWins:15,rewardClaims:floors,floorTicketClaims:floors});
 let state=await Rules.start(db,'u',{requestId:'floor-16-start'},NOW);assert.equal(state.floor,16);
 state=await fight(db,state);assert.equal(state.status,'cleared');assert.equal(state.bestFloor,16);assert.equal(state.checkpoint,17);assert.equal(state.economy.drawTickets,1);
 state=await Rules.act(db,'u','abandon',body(state),NOW+1000);
 assert.equal((await Rules.status(db,'u',NOW+2000)).checkpoint,17);
 await assert.rejects(Rules.start(db,'u',{requestId:'no-skipping-floor-17',floor:18},NOW+2000),e=>e.status===400);
 state=await Rules.start(db,'u',{requestId:'continue-floor-17',floor:17},NOW+2000);assert.equal(state.floor,17);assert.equal(state.round,0);
 assert.equal(state.economy.drawTickets,1);saved(db).run.challenger.hp=1;
 state=await Rules.act(db,'u','turn',await answerBody(db,state,false,NOW+3000),NOW+3000);assert.equal(state.status,'defeated');assert.equal(state.bestFloor,16);
 state=await Rules.start(db,'u',{requestId:'retry-floor-17'},NOW+4000);assert.equal(state.floor,17);
 state=await Rules.start(db,'u',{requestId:'expired-floor-17'},NOW+Rules.TTL+5000);assert.equal(state.floor,17);
 state=await fight(db,state,NOW+Rules.TTL+6000);assert.equal(state.status,'cleared');assert.equal(state.bestFloor,17);assert.equal(state.checkpoint,18);assert.equal(state.economy.drawTickets,2);
});
test('last floor completion is bounded and no further floor can be started',async()=>{
 const db=database(user({stats:{totalScore:1868,attack:99999,maxHp:99999}}));
 let state=await Rules.start(db,'u',{requestId:'start-final-test'},NOW);
 const record=saved(db);record.bestFloor=99;record.run.floor=100;record.run.defender=Rules.enemy(100);
 state=Rules.view(record,NOW);state=await fight(db,state);
 assert.equal(state.status,'complete');assert.equal(state.bestFloor,100);assert.equal(state.title,'萬象破陣者');
 assert.equal(state.economy.gold,1730);assert.equal(state.economy.drawTickets,12);assert.equal(state.economy.materials['raid-refine-key-iii'],2);assert.deepEqual(state.claimedFloors,[100]);
 await assert.rejects(Rules.act(db,'u','next',body(state),NOW+30000),e=>e.status===409);
 await assert.rejects(Rules.start(db,'u',{requestId:'no-floor-101',floor:101},NOW+30000),e=>e.status===400);
 const replay=await Rules.start(db,'u',{requestId:'restart-last-floor'},NOW+31000);assert.equal(replay.floor,100);assert.equal(replay.economy.drawTickets,12);
});
test('routes require verified main-project identity and register only domain endpoints',async()=>{
 const routes=[];require('../martial-trial-api.cjs')({get:(p,h)=>routes.push([p,h]),post:(p,h)=>routes.push([p,h])});
 assert.equal(routes.length,10);assert.ok(routes.some(([p])=>p==='/api/martial-trial/turn'));
 const res={set(){},status(s){this.code=s;return this;},json(v){this.value=v;}};
 await Rules.handler('status',{resolveA:()=>{throw Error('should not resolve without bearer');},logger:{error(){}}})({get:()=>''},res);
 assert.equal(res.code,401);
 assert.match(fs.readFileSync('server.js','utf8'),/registerMartialTrialApi\(app, \{ reboot: true \}\)/);
});


test('delayed retries from earlier turns or a completed start return current progress without replaying combat',async()=>{
  const db=database(user({stats:{totalScore:1868,attack:900,maxHp:2000}}));
  const startBody={requestId:'original-start-request'};
  let state=await Rules.start(db,'u',startBody,NOW);
  const first=await answerBody(db,state);state=await Rules.act(db,'u','turn',first,NOW);
  state=await Rules.act(db,'u','next',body(state),NOW+1000);
  assert.equal(state.floor,2);
  assert.deepEqual(await Rules.act(db,'u','turn',first,NOW+2000),state);
  assert.deepEqual(await Rules.start(db,'u',startBody,NOW+2000),state);
  assert.equal(saved(db).totalWins,1);
});

test('ignored client fields never enter saved receipts or inflate the session document',async()=>{
 const db=database();const ignored='x'.repeat(200000);
 const state=await Rules.start(db,'u',{requestId:'bounded-session-start',runId:ignored,tactic:ignored,clientStats:ignored},NOW);
 assert.equal(state.floor,1);assert.ok(JSON.stringify(saved(db)).length<20000);
 await Rules.act(db,'u','abandon',body(state,{tactic:ignored}),NOW+1000);
 assert.ok(JSON.stringify(saved(db)).length<20000);
});

test('first clear deposits the exact floor reward atomically and retries or re-clears never pay twice',async()=>{
 const db=database(user({stats:{totalScore:1868,attack:900,maxHp:1000,gold:7},forgeFragments:11,soulboundDrawTickets:2,
  materialSystem:{inventory:{'unrelated-item':123}}}));
 let state=await Rules.start(db,'u',{requestId:'first-reward-start'},NOW),request=await answerBody(db,state);
 state=await Rules.act(db,'u','turn',request,NOW);
 assert.equal(state.status,'cleared');assert.deepEqual(state.claimedFloors,[1]);
 assert.equal(state.economy.gold,57);assert.equal(state.economy.forgeFragments,16);assert.equal(state.economy.drawTickets,3);
 assert.equal(db.records.get('users/u').materialSystem.inventory['unrelated-item'],123);
 await Rules.act(db,'u','turn',request,NOW+1000);
 assert.equal(db.records.get('users/u').stats.gold,57);
 state=await Rules.act(db,'u','abandon',body(state),NOW+2000);
 state=await Rules.start(db,'u',{requestId:'re-clear-first-floor',floor:1},NOW+3000);state=await fight(db,state,NOW+4000);
 assert.equal(state.awarded,undefined);assert.equal(state.economy.gold,57);assert.equal(state.economy.drawTickets,3);assert.deepEqual(saved(db).rewardClaims,[1]);assert.deepEqual(state.unclaimedTicketFloors,[]);assert.deepEqual(state.unclaimedBonusFloors,[]);
});
test('old best progress can backfill once, in parallel or after expiration, without touching cultivation or unrelated materials',async()=>{
 const db=database(user({stats:{totalScore:1868,attack:200,maxHp:1000,gold:9},materialSystem:{inventory:{'nascent-soul-essence':2,wood:77}}}));
 await Rules.start(db,'u',{requestId:'old-progress-start'},NOW);saved(db).bestFloor=20;
 const before=structuredClone(db.records.get('users/u'));
 const [a,b]=await Promise.all([Rules.act(db,'u','claim',{requestId:'backfill-first-request',gold:999999,floor:100},NOW+Rules.TTL+1),Rules.act(db,'u','claim',{requestId:'backfill-second-request'},NOW+Rules.TTL+1)]);
 const expected=require('../public/cultivation/trial-tower-rewards.js').total(Array.from({length:20},(_,i)=>i+1));
 assert.equal(a.claimedFloors.length,20);assert.equal(b.claimedFloors.length,20);
 const player=db.records.get('users/u');assert.equal(player.stats.gold,9+expected.gold);assert.equal(player.forgeFragments,expected.forgeFragments);
 assert.equal(player.soulboundDrawTickets,expected.drawTickets);assert.equal(player.materialSystem.inventory['nascent-soul-essence'],2+expected.materials['nascent-soul-essence']);
 assert.equal(player.materialSystem.inventory['raid-refine-key-ii'],2);assert.equal(player.materialSystem.inventory.wood,77);
 assert.equal(player.stats.totalScore,before.stats.totalScore);assert.equal(player.stats.maxHp,before.stats.maxHp);
 const retry=await Rules.act(db,'u','claim',{requestId:'backfill-first-request'},NOW+Rules.TTL+2);
 assert.equal(retry.awarded,undefined);assert.equal(retry.economy.gold,player.stats.gold);
});
test('locked floors cannot be claimed, rejected writes roll back both resources and claim receipts',async()=>{
 const db=database(user({stats:{totalScore:1868,attack:900,maxHp:1000,gold:5}}));
 let state=await Rules.start(db,'u',{requestId:'atomic-reward-start'},NOW);
 const empty=await Rules.act(db,'u','claim',{requestId:'cannot-claim-future',floors:[100],amount:999999},NOW);
 assert.equal(empty.awarded,undefined);assert.equal(empty.economy.gold,5);
 const request=await answerBody(db,state);
 const original=db.runTransaction.bind(db);db.runTransaction=worker=>original(tx=>worker({...tx,set(ref,value){if(ref.key.startsWith(Rules.COLLECTION+'/'))throw Error('simulated persistence failure');return tx.set(ref,value);}}));
 await assert.rejects(Rules.act(db,'u','turn',request,NOW+1000),/persistence failure/);
 assert.equal(db.records.get('users/u').stats.gold,5);assert.equal(saved(db).bestFloor,0);assert.equal(saved(db).rewardClaims,undefined);
 assert.equal(db.records.get('users/u').soulboundDrawTickets,undefined);assert.equal(saved(db).floorTicketClaims,undefined);assert.equal(saved(db).floorRewardVersions,undefined);
 db.runTransaction=original;state=await Rules.act(db,'u','turn',request,NOW+2000);assert.equal(state.bestFloor,1);assert.equal(state.economy.gold,55);assert.equal(state.economy.drawTickets,1);assert.deepEqual(saved(db).floorTicketClaims,[1]);
});

test('legacy missing tickets and reward increases survive a newer floor clear and pay once during parallel backfill',async()=>{
 const player=user({stats:{totalScore:1868,attack:900,maxHp:1000,gold:777},forgeFragments:33,soulboundDrawTickets:5,materialSystem:{inventory:{wood:9}}});
 const db=database(player);let state=await Rules.start(db,'u',{requestId:'legacy-tickets-start'},NOW);
 Object.assign(saved(db),{bestFloor:10,rewardVersion:1,rewardClaims:Array.from({length:10},(_,i)=>i+1)});
 // A new normal reward must not mark older missing tickets as already issued.
 saved(db).run.floor=11;saved(db).run.defender=Rules.enemy(11);state=Rules.view(saved(db),NOW);
 state=await fight(db,state,NOW+1000);assert.equal(state.status,'cleared');assert.equal(state.economy.drawTickets,6);
 assert.deepEqual(state.unclaimedTicketFloors,[1,2,3,4,5,6,7,8,9]);assert.equal(state.unclaimedFloors.length,0);
 assert.deepEqual(state.unclaimedBonusFloors,Array.from({length:10},(_,i)=>i+1));assert.deepEqual(saved(db).floorRewardVersions,{11:3});
 const before=structuredClone(db.records.get('users/u'));
 const [a,b]=await Promise.all(['old-ticket-claim-a','old-ticket-claim-b'].map(requestId=>Rules.act(db,'u','claim',{requestId,ticketFloors:[100],drawTickets:999999},NOW+Rules.TTL+1000)));
 assert.deepEqual(a.awarded.floors,[]);assert.equal(a.awarded.ticketFloors.length,9);assert.equal(a.awarded.bonusFloors.length,10);assert.equal(a.awarded.reward.drawTickets,10);
 assert.equal(a.economy.drawTickets,16);assert.equal(b.awarded,undefined);assert.equal(b.economy.drawTickets,16);
 assert.deepEqual(a.unclaimedTicketFloors,[]);assert.deepEqual(a.claimedFloors,Array.from({length:11},(_,i)=>i+1));
 const after=db.records.get('users/u');assert.equal(after.stats.gold,before.stats.gold+300);assert.equal(after.forgeFragments,before.forgeFragments+30);
 assert.equal(after.stats.totalScore,before.stats.totalScore);assert.equal(after.materialSystem.inventory.wood,9);assert.equal(after.materialSystem.inventory['nascent-soul-essence'],2);
 assert.equal(saved(db).rewardVersion,3);assert.equal(saved(db).floorTicketClaims.length,10);assert.deepEqual(a.unclaimedBonusFloors,[]);
 const retry=await Rules.act(db,'u','claim',{requestId:'old-ticket-claim-a'},NOW+Rules.TTL+2000);assert.equal(retry.awarded,undefined);assert.equal(retry.economy.drawTickets,16);
});
test('mixed legacy rewards and tickets backfill together, without duplicating milestones or any other reward',async()=>{
 const db=database();await Rules.start(db,'u',{requestId:'mixed-tickets-start'},NOW);
 Object.assign(saved(db),{bestFloor:20,rewardVersion:1,rewardClaims:[1,5,10]});
 const result=await Rules.act(db,'u','claim',{requestId:'mixed-tickets-claim'},NOW);
 const Rewards=require('../public/cultivation/trial-tower-rewards.js'),expected=Rewards.payout(Array.from({length:20},(_,i)=>i+1).filter(f=>![1,5,10].includes(f)),[1,5],[1,5,10]);
 assert.deepEqual(result.awarded.ticketFloors,[1,5]);assert.deepEqual(result.awarded.bonusFloors,[1,5,10]);assert.equal(result.economy.drawTickets,expected.drawTickets);
 assert.equal(result.economy.gold,expected.gold);assert.equal(result.economy.forgeFragments,expected.forgeFragments);
 assert.deepEqual(result.economy.materials,{...Object.fromEntries(Object.keys(Rewards.ITEMS).map(id=>[id,0])),...expected.materials});
 assert.deepEqual(result.unclaimedTicketFloors,[]);assert.deepEqual(result.unclaimedFloors,[]);assert.deepEqual(result.unclaimedBonusFloors,[]);
});

test('reward upgrades roll back wallets and per-floor receipts together, then preserve concurrent and delayed retry safety',async()=>{
 const db=database(user({stats:{totalScore:1868,attack:200,maxHp:1000,gold:9},soulboundDrawTickets:3,materialSystem:{inventory:{wood:7}}}));
 await Rules.start(db,'u',{requestId:'upgrade-rollback-start'},NOW);
 const floors=Array.from({length:20},(_,i)=>i+1);Object.assign(saved(db),{bestFloor:20,rewardVersion:2,rewardClaims:floors,floorTicketClaims:floors});
 const before=structuredClone(db.records.get('users/u')),original=db.runTransaction.bind(db);
 db.runTransaction=worker=>original(tx=>worker({...tx,set(ref,value){if(ref.key.startsWith(Rules.COLLECTION+'/'))throw Error('upgrade write failed');return tx.set(ref,value);}}));
 await assert.rejects(Rules.act(db,'u','claim',{requestId:'upgrade-failed-claim'},NOW),/upgrade write failed/);
 assert.deepEqual(db.records.get('users/u'),before);assert.equal(saved(db).floorRewardVersions,undefined);assert.equal(saved(db).rewardVersion,2);
 db.runTransaction=original;
 const [a,b]=await Promise.all(['upgrade-retry-claim','upgrade-parallel-claim'].map(requestId=>Rules.act(db,'u','claim',{requestId,bonusFloors:[100],gold:999999},NOW)));
 assert.deepEqual(a.awarded.reward,{gold:700,forgeFragments:60,drawTickets:2,materials:{'nascent-soul-essence':4,'raid-refine-key-ii':1}});
 assert.equal(a.awarded.bonusFloors.length,20);assert.equal(a.economy.gold,709);assert.equal(a.economy.drawTickets,5);assert.equal(b.awarded,undefined);
 assert.equal(Object.keys(saved(db).floorRewardVersions).length,20);assert.ok(Object.values(saved(db).floorRewardVersions).every(v=>v===3));
 const retry=await Rules.act(db,'u','claim',{requestId:'upgrade-retry-claim'},NOW+1000);assert.equal(retry.awarded,undefined);assert.equal(retry.economy.gold,709);
 assert.equal(db.records.get('users/u').materialSystem.inventory.wood,7);assert.equal(db.records.get('users/u').stats.totalScore,1868);
});

test('questions bind to saved grade/scope, keep answers private and serialize simultaneous generation',async()=>{
 const db=database(user({profile:{educationLevel:'國中二年級'},gameSettings:{sourceMode:'focused',difficulty:'hard',focusedUnits:[{path:'數學/八上',detail:'一元一次方程式'}]}}));
 let state=await Rules.start(db,'u',{requestId:'trusted-scope-start'},NOW);
 const expected=await Rules.prepareQuestion(db,'u',NOW);
 assert.equal(expected.level,'國中二年級');assert.equal(expected.subject,'數學');assert.equal(expected.difficulty,'easy');assert.match(expected.specificTopic,/一元一次/);
 const parsed={q:'方程式 x + 3 = 5 的解為何？',correct:'2',wrong:['1','3','4'],exp:'兩側同減三，可得 x = 2。'};
 const [a,b]=await Promise.all([Rules.commitQuestion(db,'u',expected,parsed,NOW),Rules.commitQuestion(db,'u',expected,parsed,NOW)]);
 assert.deepEqual(a,b);assert.equal(a.correctIndex,undefined);assert.equal(a.exp,undefined);assert.equal(a.correct,undefined);
 assert.deepEqual((await Rules.status(db,'u',NOW)).question,a);
 const before=structuredClone(saved(db).run);
 await assert.rejects(Rules.act(db,'u','turn',body(state,{choice:0,correct:true}),NOW),e=>e.status===409);
 await assert.rejects(Rules.act(db,'u','turn',body(state,{questionId:'fake',choice:0}),NOW),e=>e.status===409);
 for(const tactic of ['assault','guard','charge'])await assert.rejects(Rules.act(db,'u','turn',body(state,{questionId:a.id,choice:0,tactic}),NOW),e=>e.status===400);
 assert.deepEqual(saved(db).run,before);
 // Time spent reading has no deadline, damage, or automatic turn.
 const waiting=await Rules.status(db,'u',NOW+40*60*1000);assert.equal(waiting.round,0);assert.equal(waiting.challenger.hp,state.challenger.hp);assert.equal(waiting.question.id,a.id);
 const choice=before.pendingQuestion.correctIndex;
 state=await Rules.act(db,'u','turn',body(state,{questionId:a.id,choice}),NOW+40*60*1000);
 assert.equal(state.lastTurn.correct,true);assert.equal(state.lastTurn.correctIndex,choice);assert.equal(state.round,1);
 await assert.rejects(Rules.commitQuestion(db,'u',expected,parsed,NOW+40*60*1000),e=>e.status===409);
});
test('expired, abandoned and legacy tactical sessions cannot generate or answer; records and rewards survive migration',async()=>{
 const db=database();let state=await Rules.start(db,'u',{requestId:'question-migration-start'},NOW);
 const expected=await Rules.prepareQuestion(db,'u',NOW);
 await Rules.act(db,'u','abandon',body(state),NOW+1000);
 await assert.rejects(Rules.prepareQuestion(db,'u',NOW+1000));
 await assert.rejects(Rules.commitQuestion(db,'u',expected,{q:'本題已作廢，是否正確？',correct:'是',wrong:['否','其他','不確定']},NOW+1000));
 const record=saved(db);record.bestFloor=20;record.rewardClaims=[1,2,3];delete record.run.version;record.run.status='active';
 assert.equal(Rules.view(record,NOW).rulesUpdated,true);assert.equal(Rules.view(record,NOW).status,'idle');
 state=await Rules.start(db,'u',{requestId:'updated-question-start'},NOW+2000);
 assert.equal(state.floor,21);assert.equal(state.defender.realm,'金丹期');assert.deepEqual(state.claimedFloors,[1,2,3]);assert.equal(state.bestFloor,20);
 await assert.rejects(Rules.prepareQuestion(db,'u',NOW+Rules.TTL+3000),e=>e.status===409);
});
test('reports use the private question and only independently approved errors grant an unanswered combat turn once',async()=>{
 const db=database();const state=await Rules.start(db,'u',{requestId:'report-tower-start'},NOW);
 const request=await answerBody(db,state),privateQuestion=saved(db).run.pendingQuestion;
 const reportBody={towerRunId:state.runId,towerQuestionId:request.questionId,userReason:'題目給定條件可能不完整',question:'偽造題目',options:['甲','乙'],correctIndex:0};
 const input=await Rules.reportInput(db,'u',reportBody,NOW);
 assert.equal(input.question,privateQuestion.q);assert.equal(input.correctIndex,privateQuestion.correctIndex);assert.deepEqual(input.options,privateQuestion.opts);
 await assert.rejects(Rules.reportInput(db,'other',reportBody,NOW),e=>e.status===409);
 const replace=body(state,{questionId:request.questionId});
 await assert.rejects(Rules.act(db,'u','replace',replace,NOW),e=>e.status===403);
 const key=require('../question-report-api.cjs').__test.reportKey('u',privateQuestion.q);
 db.records.set('questionErrorCompensations/'+key,{uid:'u',question:privateQuestion.q});
 const after=await Rules.act(db,'u','replace',replace,NOW);
 assert.equal(after.round,1);assert.equal(after.question,null);assert.ok(after.challenger.hp<state.challenger.hp);assert.ok(after.defender.hp<state.defender.hp);assert.equal(after.bestFloor,0);assert.equal(after.economy.gold,0);
 assert.equal(after.lastTurn.verifiedError,true);assert.equal(after.lastTurn.correct,null);assert.equal(after.lastTurn.selectedChoice,null);
 assert.deepEqual(after.lastTurn.steps.filter(s=>s.type==='attack').map(s=>s.actorRole),['host','guest']);
 assert.deepEqual(await Rules.act(db,'u','replace',replace,NOW),after);
 assert.deepEqual(await Rules.act(db,'u','replace',body(after,{questionId:request.questionId}),NOW+1000),after);
 const logs=[...db.records.entries()].filter(([k])=>k.startsWith('exam_logs/'));assert.equal(logs.length,1);assert.equal(logs[0][1].questionInvalid,true);assert.equal(logs[0][1].isCorrect,null);
 assert.ok(saved(db).run.history.includes(privateQuestion.q));
 await assert.rejects(Rules.act(db,'u','turn',request,NOW),e=>e.status===409);
});
test('approved wrong answers replay the original round including equipment counters and retain a prefetched correction',async()=>{
 const player=user({artifactSystem:{inventory:{'soul-sword-immortal':1},equipped:{本命法寶:'soul-sword-immortal'}}});
 const db=database(player);const state=await Rules.start(db,'u',{requestId:'report-replay-start'},NOW);
 const request=await answerBody(db,state,false),q=structuredClone(saved(db).run.pendingQuestion),before=structuredClone(saved(db).run);
 let after=await Rules.act(db,'u','turn',request,NOW);
 const expected=require('../immortal-avatar-combat.cjs').settleTrial(before,true);
 const nextQuestion=await answerBody(db,after,true,NOW+1000),queued=structuredClone(saved(db).run.pendingQuestion);
 const key=require('../question-report-api.cjs').__test.reportKey('u',q.q);db.records.set('questionErrorCompensations/'+key,{uid:'u',question:q.q});
 const repair=body(after,{questionId:q.id});after=await Rules.act(db,'u','replace',repair,NOW+1000);
 assert.equal(after.round,1);assert.equal(after.lastTurn.correct,false);assert.equal(after.lastTurn.verifiedError,true);
 assert.deepEqual(saved(db).run.challenger,expected.challenger);assert.deepEqual(saved(db).run.defender,expected.defender);
 assert.deepEqual(saved(db).run.pendingQuestion,queued);assert.equal(after.question.id,nextQuestion.questionId);
 assert.deepEqual(after.lastTurn.steps,expected.steps);assert.equal([...db.records.keys()].filter(k=>k.startsWith('exam_logs/')).length,1);
 assert.deepEqual(await Rules.act(db,'u','replace',repair,NOW+2000),after);
 const beforeRepeat=structuredClone(saved(db));await Rules.act(db,'u','replace',body(after,{questionId:q.id}),NOW+2000);
 assert.deepEqual(saved(db).run,beforeRepeat.run);assert.equal(saved(db).totalWins,0);
});
test('an approved wrong answer can undo a fatal enemy hit and clear the same round, with first-clear rewards exactly once',async()=>{
 const db=database(user({stats:{totalScore:1868,attack:900,maxHp:1}}));
 let state=await Rules.start(db,'u',{requestId:'report-fatal-start'},NOW);saved(db).run.challenger.hp=1;state=Rules.view(saved(db),NOW);
 const request=await answerBody(db,state,false);
 const q=structuredClone(saved(db).run.pendingQuestion);let after=await Rules.act(db,'u','turn',request,NOW);
 assert.equal(after.status,'defeated');assert.equal(after.challenger.hp,0);
 const key=require('../question-report-api.cjs').__test.reportKey('u',q.q);db.records.set('questionErrorCompensations/'+key,{uid:'u',question:q.q});
 const repair=body(after,{questionId:q.id});after=await Rules.act(db,'u','replace',repair,NOW+1000);
 assert.equal(after.round,1);assert.equal(after.status,'cleared');assert.ok(after.challenger.hp>0);assert.equal(after.defender.hp,0);
 assert.equal(after.bestFloor,1);assert.equal(after.totalWins,1);assert.equal(after.economy.gold,50);assert.deepEqual(after.claimedFloors,[1]);
 assert.equal(after.lastTurn.steps.filter(s=>s.type==='attack'&&s.actorRole==='guest').length,0);
 const repeated=await Rules.act(db,'u','replace',repair,NOW+2000);assert.equal(repeated.economy.gold,50);assert.equal(repeated.totalWins,1);assert.equal(repeated.awarded,undefined);
 const again=await Rules.act(db,'u','replace',body(after,{questionId:q.id}),NOW+2000);assert.equal(again.economy.gold,50);assert.equal(again.totalWins,1);
 const next=await Rules.act(db,'u','next',body(after),NOW+3000);
 await assert.rejects(Rules.act(db,'u','replace',body(next,{questionId:q.id}),NOW+4000),e=>e.status===409);
});
test('approved reports never add another attack to a correct turn or allow rejected, stale, or abandoned rounds to attack',async()=>{
 const db=database(),state=await Rules.start(db,'u',{requestId:'report-correct-start'},NOW),request=await answerBody(db,state);
 const q=structuredClone(saved(db).run.pendingQuestion);let after=await Rules.act(db,'u','turn',request,NOW);
 const before=structuredClone(saved(db).run),key=require('../question-report-api.cjs').__test.reportKey('u',q.q);
 await assert.rejects(Rules.act(db,'u','replace',body(after,{questionId:q.id}),NOW+1000),e=>e.status===403);
 db.records.set('questionErrorCompensations/'+key,{uid:'someone-else'});
 await assert.rejects(Rules.act(db,'u','replace',body(after,{questionId:q.id}),NOW+1000),e=>e.status===403);
 db.records.set('questionErrorCompensations/'+key,{uid:'u',question:q.q});
 after=await Rules.act(db,'u','replace',body(after,{questionId:q.id}),NOW+1000);
 assert.equal(after.round,1);assert.deepEqual(saved(db).run.challenger,before.challenger);assert.deepEqual(saved(db).run.defender,before.defender);assert.equal(after.lastTurn.verifiedError,true);
 await assert.rejects(Rules.act(db,'u','replace',body(state,{questionId:q.id}),NOW+1000),e=>e.status===409);
 after=await Rules.act(db,'u','abandon',body(after),NOW+2000);
 await assert.rejects(Rules.act(db,'u','replace',body(after,{questionId:q.id}),NOW+3000),e=>e.status===409);
});
test('report endpoint authenticates before resolving tower evidence and ignores a forged client answer',async()=>{
 const db=database();const state=await Rules.start(db,'u',{requestId:'report-handler-start'},NOW);const answer=await answerBody(db,state);
 const {createHandler}=require('../question-report-api.cjs').__test;let reviewed;
 const handler=createHandler({resolve:()=>({db,auth:{verifyIdToken:async()=>({uid:'u',aud:'question-learning',iss:'https://securetoken.google.com/question-learning'})}}),review:async input=>{reviewed=input;return {status:'rejected',reason:'未確認錯誤'};},logger:{error(){},warn(){}}});
 const res={set(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
 await handler({get:()=> 'Bearer test',body:{towerRunId:state.runId,towerQuestionId:answer.questionId,userReason:'請確認題目是否缺少條件',correctIndex:999}},res);
 assert.equal(res.data.status,'rejected');assert.equal(reviewed.correctIndex,saved(db).run.pendingQuestion.correctIndex);
 assert.equal(reviewed.question,saved(db).run.pendingQuestion.q);
});

test('changing saved scope during an active floor invalidates old questions and late generation without changing combat, build or rewards',async()=>{
 const player=user({profile:{educationLevel:'國中一年級'},gameSettings:{sourceMode:'focused',difficulty:'hard',focusedUnits:[{path:'數學/八上',detail:'一次函數',sub_topics:['斜率']}]}});
 const db=database(player);let state=await Rules.start(db,'u',{requestId:'scope-change-start'},NOW);
 const oldContext=await Rules.prepareQuestion(db,'u',NOW),oldRequest=await answerBody(db,state);
 const before=structuredClone(saved(db));
 db.records.get('users/u').gameSettings.focusedUnits=[{path:'物理/高中二年級/自訂/物理',detail:'鉛直圓周運動',sub_topics:['最高點張力']}];
 await assert.rejects(Rules.act(db,'u','turn',oldRequest,NOW+1000),/出題範圍已變更/);
 await assert.rejects(Rules.commitQuestion(db,'u',oldContext,{q:'這是舊範圍的題目',correct:'A',wrong:['B','C','D'],exp:'舊解析'},NOW+1000),/出題範圍已變更/);
 state=await Rules.status(db,'u',NOW+1000);assert.equal(state.question,null);assert.equal(state.round,0);assert.equal(state.bestFloor,0);assert.equal(state.economy.gold,0);
 const context=await Rules.prepareQuestion(db,'u',NOW+1000);
 assert.equal(context.subject,'物理');assert.equal(context.level,'高中二年級');assert.match(context.specificTopic,/鉛直圓周運動/);assert.match(context.specificTopic,/最高點張力/);
 assert.deepEqual(saved(db).run.challenger,before.run.challenger);assert.deepEqual(saved(db).run.defender,before.run.defender);assert.deepEqual(saved(db).run.formation,before.run.formation);
 const q=await Rules.commitQuestion(db,'u',context,{q:'新範圍題目條件完整嗎？',correct:'A',wrong:['B','C','D'],exp:'新範圍解析'},NOW+1000);
 assert.equal(q.correctIndex,undefined);assert.match(q.topic,/鉛直圓周運動/);
 assert.equal((await Rules.prepareQuestion(db,'u',NOW+2000)).pending.id,q.id);
});
test('old mutual-grade scope snapshots refresh automatically and bank questions stay private while allowing a finite bank to cycle',async()=>{
 const db=database(user({profile:{educationLevel:'國小一年級'},gameSettings:{sourceMode:'focused',difficulty:'medium',focusedUnits:[{path:'地球科學/高中三年級/第二學期/地球科學',detail:'大氣與海洋'}]}}));
 let state=await Rules.start(db,'u',{requestId:'legacy-scope-start'},NOW);delete saved(db).scopeKey;
 saved(db).knowledgeScope={grade:1,subjects:['數學'],units:[]};saved(db).run.pendingQuestion={id:'legacy-wrong-scope',q:'不在範圍內的舊題'};
 const expected=await Rules.prepareQuestion(db,'u',NOW);assert.equal(expected.pending,null);assert.equal(expected.subject,'地球科學');assert.equal(expected.level,'高中三年級');
 db.records.get('users/u').gameSettings={sourceMode:'bank',source:'高中/學測/國文',difficulty:'easy'};
 const Scope=require('../trial-tower-scope.cjs'),context=await Rules.prepareQuestion(db,'u',NOW);
 assert.equal(context.bankSource,'高中/學測/國文');assert.equal(context.subject,'國文');
 const parsed=await Scope.bankQuestion(context,{random:()=>0}),q=await Rules.commitQuestion(db,'u',context,parsed,NOW);
 assert.equal(q.q,parsed.q);assert.equal(q.correctIndex,undefined);assert.equal(q.exp,undefined);
 const request=body(state,{questionId:q.id,choice:saved(db).run.pendingQuestion.correctIndex});
 state=await Rules.act(db,'u','turn',request,NOW+1000);assert.equal(state.lastTurn.correct,true);
 const next=await Rules.prepareQuestion(db,'u',NOW+2000);const repeated=await Rules.commitQuestion(db,'u',next,parsed,NOW+2000);assert.equal(repeated.q,parsed.q);assert.notEqual(repeated.id,q.id);
});

test('tower study keeps adaptive metadata and hints, and queues a same-concept correction without advancing combat',async()=>{
 const unit={path:'物理/高中二年級/自訂/物理',detail:'鉛直圓周運動',sub_topics:['最高點速率']};
 const db=database(user({profile:{educationLevel:'國中一年級'},gameSettings:{sourceMode:'focused',difficulty:'medium',focusedUnits:[unit,{path:'數學/八上',detail:'一次函數'}]}}));
 let state=await Rules.start(db,'u',{requestId:'adaptive-practice-start'},NOW),expected=await Rules.prepareQuestion(db,'u',NOW);
 const adaptive={questionId:'adaptive-question-one',scopeId:'scope-one',conceptId:'concept-one',facetId:'facet-one',scope:unit,concept:'最高點速率',outline:[{id:'concept-one',name:'最高點速率',methods:[]}]};
 const q=await Rules.commitQuestion(db,'u',expected,{q:'圓周最高點的速率如何求出？',correct:'A',wrong:['B','C','D'],exp:'依最高點的受力條件計算。',adaptive},NOW);
 assert.deepEqual(q.adaptive,adaptive);assert.equal(q.recoveryOrigin,'');assert.equal(q.correctIndex,undefined);
 await assert.rejects(Rules.act(db,'u','practice',body(state,{questionId:q.id,point:'最高點速率',correction:true}),NOW),/答錯後/);
 const hint=body(state,{questionId:q.id,help:2});state=await Rules.act(db,'u','hint',hint,NOW);
 assert.equal(state.question.help,2);assert.equal(state.round,0);assert.deepEqual(await Rules.act(db,'u','hint',hint,NOW),state);
 state=await Rules.act(db,'u','turn',body(state,{questionId:q.id,choice:(saved(db).run.pendingQuestion.correctIndex+1)%4,help:3}),NOW+1000);
 const before=structuredClone(saved(db).run),practice=body(state,{questionId:q.id,point:'最高點速率',correction:true});
 state=await Rules.act(db,'u','practice',practice,NOW+2000);assert.equal(state.queuedPractice.length,1);
 await Rules.act(db,'u','practice',practice,NOW+2000);assert.equal(saved(db).practiceQueue.length,1);
 assert.equal(state.round,before.round);assert.deepEqual(saved(db).run.challenger,before.challenger);assert.equal(state.economy.gold,0);
 const log=[...db.records.entries()].find(([key])=>key.startsWith('exam_logs/'))[1];assert.equal(log.assistanceLevel,3);assert.equal(log.adaptiveConceptId,'concept-one');
 expected=await Rules.prepareQuestion(db,'u',NOW+3000);assert.equal(expected.adaptiveConceptId,'concept-one');assert.deepEqual(expected.adaptiveScope,unit);assert.equal(expected.recoveryOrigin,q.q);
 const correction=await Rules.commitQuestion(db,'u',expected,{q:'在新情境中，最高點速率的條件為何？',correct:'A',wrong:['B','C','D'],exp:'新情境同樣使用最高點受力條件。',adaptive:{...adaptive,questionId:'adaptive-correction'}},NOW+3000);
 assert.equal(correction.recoveryOrigin,q.q);assert.equal(correction.practicePoint,'最高點速率');assert.equal(correction.correctIndex,undefined);assert.equal(saved(db).practiceQueue.length,0);
 assert.equal((await Rules.prepareQuestion(db,'u',NOW+4000)).pending.id,correction.id);
});
test('extensions continue until cancelled, corrections take priority, and cancelled generation cannot replace the current flow',async()=>{
 const db=database();let state=await Rules.start(db,'u',{requestId:'continuous-extension-start'},NOW),request=await answerBody(db,state);
 state=await Rules.act(db,'u','turn',{...request,choice:(request.choice+1)%4},NOW+1000);
 const source=state.lastTurn.question,extension=body(state,{questionId:source.id,point:'同一觀念的應用',correction:false});
 state=await Rules.act(db,'u','practice',extension,NOW+2000);
 let expected=await Rules.prepareQuestion(db,'u',NOW+3000);
 const issued=await Rules.commitQuestion(db,'u',expected,{q:'延伸練習第一題，何者正確？',correct:'A',wrong:['B','C','D'],exp:'說明同一觀念的應用。'},NOW+3000);
 assert.equal(issued.extendedPractice,true);assert.ok(saved(db).activeExtension);
 state=await Rules.act(db,'u','turn',body(state,{questionId:issued.id,choice:(saved(db).run.pendingQuestion.correctIndex+1)%4}),NOW+4000);
 expected=await Rules.prepareQuestion(db,'u',NOW+5000);assert.equal(expected.practicePoint,'同一觀念的應用');assert.equal(expected.extendedPractice,true);
 state=await Rules.act(db,'u','practice',body(state,{questionId:issued.id,point:'先補強原觀念',correction:true}),NOW+6000);
 await assert.rejects(Rules.commitQuestion(db,'u',expected,{q:'較慢完成的延伸舊工作',correct:'A',wrong:['B','C','D'],exp:'舊工作'},NOW+7000),/練習順序已更新/);
 const next=await Rules.prepareQuestion(db,'u',NOW+7000);assert.equal(next.recoveryOrigin,issued.q);assert.equal(next.practicePoint,'先補強原觀念');
 state=await Rules.act(db,'u','cancel-practice',body(state),NOW+8000);assert.equal(state.activeExtension,null);assert.equal(state.queuedPractice.length,1);assert.equal(state.queuedPractice[0].correction,true);
});

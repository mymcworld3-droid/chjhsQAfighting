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
  const work=queue.then(async()=>{const writes=new Map();const result=await worker({get:async ref=>{assert.equal(writes.size,0);return snap(ref.key);},set:(ref,value)=>writes.set(ref.key,structuredClone(value))});for(const [key,value]of writes)records.set(key,value);return result;});queue=work.catch(()=>{});return work;
 }};
}
const saved=db=>db.records.get(Rules.COLLECTION+'/u');
let requests=0;
const body=(state,extra={})=>({requestId:'request-'+String(++requests).padStart(8,'0'),runId:state.runId,floor:state.floor,round:state.round,...extra});
async function fight(db,state,now=NOW){for(let i=0;i<24&&state.status==='active';i++)state=await Rules.act(db,'u','turn',body(state,{tactic:'assault'}),now+1000*i);return state;}
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
 await assert.rejects(Rules.act(db,'u','turn',body(state,{tactic:'assault',runId:'other'}),NOW),e=>e.status===409);
});
test('turns are authoritative, idempotent, serialized and paced; stale or changed requests cannot act twice',async()=>{
 const db=database(),state=await Rules.start(db,'u',{requestId:'start-the-run'},NOW),request=body(state,{tactic:'guard'});
 const [a,b]=await Promise.all([Rules.act(db,'u','turn',request,NOW),Rules.act(db,'u','turn',request,NOW)]);
 assert.deepEqual(a,b);assert.equal(a.round,1);
 await assert.rejects(Rules.act(db,'u','turn',{...request,tactic:'assault'},NOW),e=>e.status===409);
 await assert.rejects(Rules.act(db,'u','turn',body(a,{tactic:'guard'}),NOW+1),e=>e.status===429);
 await assert.rejects(Rules.act(db,'u','turn',body(state,{tactic:'guard'}),NOW+1000),e=>e.status===409);
});
test('real build upgrades change combat output, and each tactic changes the round',async()=>{
 const outcomes=[];
 for(const tactic of ['assault','guard','charge']){
  const db=database(),state=await Rules.start(db,'u',{requestId:'start-'+tactic},NOW);
  outcomes.push(await Rules.act(db,'u','turn',body(state,{tactic}),NOW));
 }
 assert.ok(outcomes[0].defender.hp<outcomes[2].defender.hp);assert.ok(outcomes[1].challenger.hp>outcomes[0].challenger.hp);assert.equal(outcomes[2].charge,1);
 const stronger=database(user({artifactSystem:{inventory:{'soul-axe-immortal':1},equipped:{本命法寶:'soul-axe-immortal'}}}));
 const start=await Rules.start(stronger,'u',{requestId:'stronger-run'},NOW);
 const upgraded=await Rules.act(stronger,'u','turn',body(start,{tactic:'assault'}),NOW);
 assert.ok(upgraded.defender.hp<outcomes[0].defender.hp);
});
test('clearing saves best progress once, next stage resets combat without refreshing the locked build',async()=>{
 const db=database(user({stats:{totalScore:1868,attack:900,maxHp:1000}})),before=structuredClone(db.records.get('users/u'));
 let state=await Rules.start(db,'u',{requestId:'start-run-wins'},NOW);state=await fight(db,state);
 assert.equal(state.status,'cleared');assert.equal(state.bestFloor,1);assert.equal(state.totalWins,1);
 db.records.get('users/u').stats.attack=10;
 const nextBody=body(state),next=await Rules.act(db,'u','next',nextBody,NOW+30000);
 assert.equal(next.floor,2);assert.equal(next.round,0);assert.equal(next.charge,0);assert.equal(next.challenger.hp,next.challenger.maxHp);assert.equal(next.challenger.atk,900);
 assert.deepEqual(await Rules.act(db,'u','next',nextBody,NOW+30000),next);
 assert.equal(db.records.get('users/u').stats.maxHp,before.stats.maxHp);assert.equal(saved(db).totalWins,1);
});
test('failed fights and voluntary exits preserve best scores; expired fights can restart from earned checkpoints',async()=>{
 const db=database(user({stats:{totalScore:28,attack:1,maxHp:1}}));
 let state=await Rules.start(db,'u',{requestId:'losing-start'},NOW);state=await fight(db,state);
 assert.equal(state.status,'defeated');assert.equal(state.bestFloor,0);
 saved(db).bestFloor=12;
 state=await Rules.start(db,'u',{requestId:'checkpoint-start'},NOW+30000);assert.equal(state.floor,11);
 const abandoned=await Rules.act(db,'u','abandon',body(state),NOW+31000);assert.equal(abandoned.bestFloor,12);assert.equal(abandoned.status,'abandoned');
 state=await Rules.start(db,'u',{requestId:'expiry-start'},NOW+32000);
 assert.equal(Rules.view(saved(db),NOW+Rules.TTL+40000).status,'expired');
 await assert.rejects(Rules.act(db,'u','turn',body(state,{tactic:'assault'}),NOW+Rules.TTL+40000),e=>e.status===410);
 const restarted=await Rules.start(db,'u',{requestId:'restarted-after-expiry'},NOW+Rules.TTL+40000);assert.equal(restarted.floor,11);assert.notEqual(restarted.runId,state.runId);
});
test('enemy progression increases through 100 floors and first 4 floors introduce combat before guard cores',()=>{
 let previous={atk:0,maxHp:0};for(let floor=1;floor<=100;floor++){const e=Rules.enemy(floor);assert.ok(e.atk>previous.atk&&e.maxHp>previous.maxHp);assert.equal(!!e.goldenCore,floor>=5);previous=e;}
 assert.equal(Rules.checkpoint(0),1);assert.equal(Rules.checkpoint(5),6);assert.equal(Rules.checkpoint(100),96);
});
test('last floor completion is bounded and no further floor can be started',async()=>{
 const db=database(user({stats:{totalScore:1868,attack:99999,maxHp:99999}}));
 let state=await Rules.start(db,'u',{requestId:'start-final-test'},NOW);
 const record=saved(db);record.bestFloor=99;record.run.floor=100;record.run.defender=Rules.enemy(100);
 state=Rules.view(record,NOW);state=await fight(db,state);
 assert.equal(state.status,'complete');assert.equal(state.bestFloor,100);assert.equal(state.title,'萬象破陣者');
 await assert.rejects(Rules.act(db,'u','next',body(state),NOW+30000),e=>e.status===409);
});
test('routes require verified main-project identity and register only domain endpoints',async()=>{
 const routes=[];require('../martial-trial-api.cjs')({get:(p,h)=>routes.push([p,h]),post:(p,h)=>routes.push([p,h])});
 assert.equal(routes.length,5);assert.ok(routes.some(([p])=>p==='/api/martial-trial/turn'));
 const res={set(){},status(s){this.code=s;return this;},json(v){this.value=v;}};
 await Rules.handler('status',{resolveA:()=>{throw Error('should not resolve without bearer');},logger:{error(){}}})({get:()=>''},res);
 assert.equal(res.code,401);
 assert.match(fs.readFileSync('server.js','utf8'),/registerMartialTrialApi\(app\)/);
});


test('delayed retries from earlier turns or a completed start return current progress without replaying combat',async()=>{
  const db=database(user({stats:{totalScore:1868,attack:900,maxHp:2000}}));
  const startBody={requestId:'original-start-request'};
  let state=await Rules.start(db,'u',startBody,NOW);
  const first=body(state,{tactic:'assault'});state=await Rules.act(db,'u','turn',first,NOW);
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

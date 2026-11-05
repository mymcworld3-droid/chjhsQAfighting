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
test('failed fights and voluntary exits preserve best scores; expired fights can restart from earned checkpoints',async()=>{
 const db=database(user({stats:{totalScore:28,attack:1,maxHp:1}}));
 let state=await Rules.start(db,'u',{requestId:'losing-start'},NOW);state=await fight(db,state);
 assert.equal(state.status,'defeated');assert.equal(state.bestFloor,0);
 saved(db).bestFloor=12;
 state=await Rules.start(db,'u',{requestId:'checkpoint-start'},NOW+30000);assert.equal(state.floor,11);
 const abandoned=await Rules.act(db,'u','abandon',body(state),NOW+31000);assert.equal(abandoned.bestFloor,12);assert.equal(abandoned.status,'abandoned');
 state=await Rules.start(db,'u',{requestId:'expiry-start'},NOW+32000);
 assert.equal(Rules.view(saved(db),NOW+Rules.TTL+40000).status,'expired');
 const expiredRequest=await answerBody(db,state,true,NOW+32000);
 await assert.rejects(Rules.act(db,'u','turn',expiredRequest,NOW+Rules.TTL+40000),e=>e.status===410);
 const restarted=await Rules.start(db,'u',{requestId:'restarted-after-expiry'},NOW+Rules.TTL+40000);assert.equal(restarted.floor,11);assert.notEqual(restarted.runId,state.runId);
});
test('enemy progression increases through 100 floors and realms advance every ten floors',()=>{
 let previous={atk:0,maxHp:0};for(let floor=1;floor<=100;floor++){const e=Rules.enemy(floor);assert.ok(e.atk>previous.atk&&e.maxHp>previous.maxHp);assert.equal(!!e.goldenCore,floor>=21);if(floor>1)assert.ok(e.totalScore>=previous.totalScore);previous=e;}
 assert.equal(Rules.enemy(1).realm,'煉氣期');assert.equal(Rules.enemy(11).realm,'築基期');assert.equal(Rules.enemy(91).realm,'真仙');
 assert.equal(Rules.checkpoint(0),1);assert.equal(Rules.checkpoint(5),6);assert.equal(Rules.checkpoint(100),96);
});
test('last floor completion is bounded and no further floor can be started',async()=>{
 const db=database(user({stats:{totalScore:1868,attack:99999,maxHp:99999}}));
 let state=await Rules.start(db,'u',{requestId:'start-final-test'},NOW);
 const record=saved(db);record.bestFloor=99;record.run.floor=100;record.run.defender=Rules.enemy(100);
 state=Rules.view(record,NOW);state=await fight(db,state);
 assert.equal(state.status,'complete');assert.equal(state.bestFloor,100);assert.equal(state.title,'萬象破陣者');
 assert.equal(state.economy.gold,610);assert.equal(state.economy.drawTickets,4);assert.equal(state.economy.materials['raid-refine-key-iii'],1);assert.deepEqual(state.claimedFloors,[100]);
 await assert.rejects(Rules.act(db,'u','next',body(state),NOW+30000),e=>e.status===409);
});
test('routes require verified main-project identity and register only domain endpoints',async()=>{
 const routes=[];require('../martial-trial-api.cjs')({get:(p,h)=>routes.push([p,h]),post:(p,h)=>routes.push([p,h])});
 assert.equal(routes.length,7);assert.ok(routes.some(([p])=>p==='/api/martial-trial/turn'));
 const res={set(){},status(s){this.code=s;return this;},json(v){this.value=v;}};
 await Rules.handler('status',{resolveA:()=>{throw Error('should not resolve without bearer');},logger:{error(){}}})({get:()=>''},res);
 assert.equal(res.code,401);
 assert.match(fs.readFileSync('server.js','utf8'),/registerMartialTrialApi\(app\)/);
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
 assert.equal(state.economy.gold,27);assert.equal(state.economy.forgeFragments,13);assert.equal(state.economy.drawTickets,2);
 assert.equal(db.records.get('users/u').materialSystem.inventory['unrelated-item'],123);
 await Rules.act(db,'u','turn',request,NOW+1000);
 assert.equal(db.records.get('users/u').stats.gold,27);
 state=await Rules.act(db,'u','abandon',body(state),NOW+2000);
 state=await Rules.start(db,'u',{requestId:'re-clear-first-floor',floor:1},NOW+3000);state=await fight(db,state,NOW+4000);
 assert.equal(state.awarded,undefined);assert.equal(state.economy.gold,27);assert.deepEqual(saved(db).rewardClaims,[1]);
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
 assert.equal(player.materialSystem.inventory['raid-refine-key-ii'],1);assert.equal(player.materialSystem.inventory.wood,77);
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
 db.runTransaction=original;state=await Rules.act(db,'u','turn',request,NOW+2000);assert.equal(state.bestFloor,1);assert.equal(state.economy.gold,25);
});

test('questions bind to saved grade/scope, keep answers private and serialize simultaneous generation',async()=>{
 const db=database(user({profile:{educationLevel:'國中二年級'},gameSettings:{sourceMode:'focused',difficulty:'hard',focusedUnits:[{path:'數學/八上',detail:'一元一次方程式'}]}}));
 let state=await Rules.start(db,'u',{requestId:'trusted-scope-start'},NOW);
 const expected=await Rules.prepareQuestion(db,'u',NOW);
 assert.equal(expected.level,'國中二年級');assert.equal(expected.subject,'數學');assert.equal(expected.difficulty,'hard');assert.match(expected.specificTopic,/一元一次/);
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
test('reports use the private server question and only independently approved errors can be replaced without a combat turn',async()=>{
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
 assert.equal(after.round,0);assert.equal(after.question,null);assert.equal(after.challenger.hp,state.challenger.hp);assert.equal(after.bestFloor,0);assert.equal(after.economy.gold,0);
 assert.deepEqual(await Rules.act(db,'u','replace',replace,NOW),after);
 assert.ok(saved(db).run.history.includes(privateQuestion.q));
 await assert.rejects(Rules.act(db,'u','turn',request,NOW),e=>e.status===409);
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

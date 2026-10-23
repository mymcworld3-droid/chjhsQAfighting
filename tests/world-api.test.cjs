const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express');
const {once}=require('node:events');
const register=require('../world-api.cjs'),W=require('../public/world/world-core.js'),B=require('../world-battle.cjs'),Q=require('../world-questions.cjs');
const {worldDb}=require('./helpers/world-db.cjs');
const {trustedRaidPlayerSnapshot}=require('../raid-authority.cjs');
const baseUser=()=>({uid:'u1',displayName:'青雲修士',stats:{attack:200,maxHp:1000,totalScore:0,gold:0},materialSystem:{inventory:{'qi-spirit-iron':10,'qi-spirit-wood':10}}});
async function setup(t,{saved={},db:provided=null}={}){
  let at=Date.now();const db=provided||worldDb({'users/u1':baseUser(),'users/u2':{...baseUser(),uid:'u2',displayName:'道友'},'worldPlayers/u1':{...saved,mapVersion:W.VERSION}});
  const app=express();app.use(express.json());const service=register(app,{resolveA:()=>({db}),resolveC:()=>({db}),verify:async req=>{const uid=req.get('x-test-uid');if(!uid)throw Object.assign(new Error('unauthorized'),{status:401});return uid;},now:()=>at,
    generateQuestions:async b=>Q.fallback(b,{subject:'數學'}),schedule:false,logger:{warn(){},error(){}}});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port;
  t.after(()=>{service.close();server.closeAllConnections();server.close();});
  let serial=0;
  async function request(action,payload={},uid='u1'){
    const res=await fetch(url+'/api/world',{method:'POST',headers:{'Content-Type':'application/json',...(uid?{'x-test-uid':uid}:{})},body:JSON.stringify({action,requestId:'request-'+(++serial),...payload})});
    return {status:res.status,...await res.json()};
  }
  return {db,service,request,url,advance(ms){at+=ms;},get now(){return at;}};
}
test('world API requires identity and never accepts a client-supplied position or combat snapshot',async t=>{
  const h=await setup(t);assert.equal((await h.request('join',{},'')).status,401);
  const joined=await h.request('join',{position:{x:37,y:12},attack:999999});assert.deepEqual(joined.state.position,W.SPAWN);
  const bad=await h.request('move',{sessionId:joined.sessionId,seq:1,target:{x:-1,y:0}});assert.equal(bad.status,409);
});
test('moving writes only at arrival/checkpoint and restores the real reached position after restart',async t=>{
  const h=await setup(t,{saved:{position:W.SPAWN,explored:'1'.repeat(2304)}}),join=await h.request('join'),before=h.db.writes;
  const r=await h.request('move',{sessionId:join.sessionId,seq:1,target:{x:14,y:36}});assert.equal(r.ok,true);
  assert.equal(h.db.writes,before);h.advance(W.STEP_MS*2+10);await h.service.tick();assert.equal(h.db.writes,before,'no per-tile writes');
  h.advance(W.STEP_MS*10);await h.service.tick();assert.ok(h.db.writes>before);
  const position=h.db.docs.get('worldPlayers/u1').position;assert.deepEqual(position,{x:14,y:36});
  const restarted=await setup(t,{db:h.db});const restored=await restarted.request('join');assert.deepEqual(restored.state.position,position);
});
test('new movement commands replace older routes and reject stale sequenced requests',async t=>{
  const h=await setup(t,{saved:{position:W.SPAWN,explored:'1'.repeat(2304)}}),join=await h.request('join');
  await h.request('move',{sessionId:join.sessionId,seq:2,target:{x:14,y:36}});h.advance(120);
  const r=await h.request('move',{sessionId:join.sessionId,seq:3,target:{x:9,y:40}});assert.equal(r.ok,true);
  assert.equal((await h.request('move',{sessionId:join.sessionId,seq:1,target:{x:12,y:36}})).status,409);
  h.advance(10000);await h.service.tick();assert.deepEqual(h.service.hub.actors.get('u1').state.position,{x:9,y:40});
});
test('overlapping explorers are both visible and nearby presence reveals no player inventory or battle answers',async t=>{
  const h=await setup(t);await h.request('join');const peer=await h.request('join',{},'u2');assert.equal(peer.players.length,2);
  const mine=peer.players.find(p=>p.uid==='u1');assert.deepEqual(mine.route.path[0],W.SPAWN);assert.equal(mine.state,undefined);assert.equal(mine.stats,undefined);
});
test('gather/chest claims are atomic, personal and safe after duplicate, concurrent or failed requests',async t=>{
  const h=await setup(t,{saved:{position:{x:12,y:27},explored:'1'.repeat(2304)}});
  await h.request('join');const requestId='gather-unique';
  const [a,b]=await Promise.all([h.request('interact',{objectId:'herb-a',requestId}),h.request('interact',{objectId:'herb-a',requestId})]);
  assert.equal(a.ok,true);assert.equal(b.duplicate,true);assert.equal(h.db.docs.get('users/u1').materialSystem.inventory['qi-spirit-wood'],12);
  assert.equal((await h.request('interact',{objectId:'herb-a'})).status,409);
  const other=h.service.hub.actors.get('u1');other.state.position={x:19,y:27};other.route={path:[{x:19,y:27}],stepMs:220,startedAtMs:h.now};
  h.db.failNext();assert.equal((await h.request('interact',{objectId:'chest-a',requestId:'chest-retry-1'})).status,503);
  assert.equal(h.db.docs.get('users/u1').stats.gold,0);
  const claimed=await h.request('interact',{objectId:'chest-a',requestId:'chest-retry-1'});assert.equal(claimed.ok,true);assert.equal(h.db.docs.get('users/u1').stats.gold,25);
});
test('shared bridge progress consumes materials exactly once and changes shared terrain for all players',async t=>{
  const h=await setup(t,{saved:{position:{x:25,y:28},explored:'1'.repeat(2304)}});h.db.docs.set('worldEvents/main',{bridge:19,array:0});
  await h.request('join');const r=await h.request('interact',{objectId:'bridge',requestId:'bridge-receipt'});assert.equal(r.events.bridge,20);
  assert.equal(h.db.docs.get('users/u1').materialSystem.inventory['qi-spirit-wood'],8);
  await h.request('interact',{objectId:'bridge',requestId:'bridge-receipt'});assert.equal(h.db.docs.get('worldEvents/main').bridge,20);
  const peer=await h.request('join',{},'u2');assert.equal(W.walkable(26,27,{events:peer.events}),true);
});
test('battle turns, answers, reward receipts and reconnect state are authoritative and durable',async t=>{
  const h=await setup(t,{saved:{position:{x:18,y:23},explored:'1'.repeat(2304)}});await h.request('join');
  const started=await h.request('interact',{objectId:'wolf',attack:999999});assert.equal(started.state.battle.player.atk,200);
  let b=started.state.battle;
  const questions=await h.request('battle',{command:'questions',battleId:b.id,turn:b.turn,revision:b.revision});b=questions.state.battle;
  assert.equal(b.questions.length,2);assert.equal(b.questions[0].answerIndex,undefined);
  const restarted=await setup(t,{db:h.db});const restored=await restarted.request('join');assert.equal(restored.state.battle.id,b.id);assert.equal(restored.state.battle.questions.length,2);
  const cheat=await h.request('battle',{command:'attack',battleId:b.id,turn:b.turn,revision:b.revision,enemyId:'enemy-1',damage:999999});assert.equal(cheat.status,409,'cannot bypass recharge');
  const skip=await h.request('battle',{command:'skip',battleId:b.id,turn:b.turn,revision:b.revision});b=skip.state.battle;
  // The fixture lowers a server-owned monster HP, not a client-provided payload.
  const raw=h.db.docs.get('worldPlayers/u1');raw.battle.enemies[0].hp=1;h.db.docs.set('worldPlayers/u1',raw);
  const won=await h.request('battle',{command:'attack',battleId:b.id,turn:b.turn,revision:b.revision,enemyId:'enemy-1',requestId:'last-attack'});assert.equal(won.state.battle.status,'won');
  assert.equal(h.db.docs.get('users/u1').stats.gold,20);
  const duplicate=await h.request('battle',{command:'attack',battleId:b.id,turn:b.turn,revision:b.revision,enemyId:'enemy-1',requestId:'last-attack'});assert.equal(duplicate.duplicate,true);assert.equal(h.db.docs.get('users/u1').stats.gold,20);
  const saved=h.db.docs.get('worldPlayers/u1');assert.equal(saved.victories,1);assert.ok(saved.claims['monster:wolf:'+new Date(h.now+8*3600000).toISOString().slice(0,10)]);
});
test('checkpoint cannot overwrite saved battle rewards or quest progress',async t=>{
  const h=await setup(t);await h.request('join');const actor=h.service.hub.actors.get('u1');
  h.db.docs.set('worldPlayers/u1',{...register.__test.normalize(),victories:3,questClaimed:true});actor.dirty=true;
  await h.service.checkpoint(actor);const saved=h.db.docs.get('worldPlayers/u1');assert.equal(saved.victories,3);assert.equal(saved.questClaimed,true);
});
test('presence sends routes once, not one duplicated message per tile/frame',async t=>{
  const h=await setup(t);await h.request('join');let packets=0;const remove=h.service.hub.subscribe('u1',()=>packets++);
  h.service.hub.broadcast();const initial=packets;h.advance(1000);h.service.hub.broadcast();assert.equal(packets,initial);remove();
});
test('failed saves back off and remain retryable instead of hammering D1 on each tick',async t=>{
  const h=await setup(t);await h.request('join');const actor=h.service.hub.actors.get('u1');actor.dirty=true;h.db.failNext();await h.service.tick();
  assert.ok(actor.saveRetryAtMs>h.now);assert.ok(actor.dirty);const writes=h.db.writes;await h.service.tick();assert.equal(h.db.writes,writes);
  h.advance(20000);await h.service.tick();assert.equal(actor.dirty,false);
});
test('SSE broadcasts an accepted route and removes a disconnected explorer without database polling',async t=>{
  const h=await setup(t,{saved:{position:W.SPAWN,explored:'1'.repeat(2304)}});const joined=await h.request('join');
  const abort=new AbortController();const response=await fetch(h.url+'/api/world',{method:'POST',headers:{'Content-Type':'application/json','x-test-uid':'u2'},body:JSON.stringify({action:'subscribe'}),signal:abort.signal});
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  async function packetWith(predicate){
    const deadline=Date.now()+1500;
    while(Date.now()<deadline){
      let end;while((end=buffer.indexOf('\n\n'))>=0){const raw=buffer.slice(0,end);buffer=buffer.slice(end+2);if(!raw.startsWith('data: '))continue;const packet=JSON.parse(raw.slice(6));if(predicate(packet))return packet;}
      const item=await reader.read();if(item.done)break;buffer+=decoder.decode(item.value);
    }
    throw Error('expected stream packet');
  }
  await packetWith(p=>p.type==='connected');
  await h.request('move',{sessionId:joined.sessionId,seq:1,target:{x:12,y:36}});
  const moved=await packetWith(p=>p.type==='presence'&&p.players.some(a=>a.uid==='u1'&&a.route.path.at(-1).x===12));
  assert.ok(moved.players.find(a=>a.uid==='u1').route.startedAtMs);assert.ok(!JSON.stringify(moved).includes('materialSystem'));
  abort.abort();await reader.cancel().catch(()=>{});await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(h.service.hub.listeners.has('u2'),false);assert.equal(h.service.hub.actors.get('u2').connected,false);
});
test('nearby invitations require an online target, a real waiting room and the verified host',async t=>{
  const h=await setup(t);await h.request('join');await h.request('join',{},'u2');const packets=[];
  const stop=h.service.hub.subscribe('u2',packet=>packets.push(packet));t.after(stop);
  h.db.docs.set('rooms/world-duel-room',{host:{uid:'u1'},worldTargetUid:'u2',status:'waiting'});
  const sent=await h.request('invite',{kind:'duel',targetUid:'u2',roomId:'world-duel-room'});assert.equal(sent.ok,true);
  const invite=packets.find(p=>p.type==='invite');assert.equal(invite.invite.roomId,'world-duel-room');assert.equal(invite.invite.fromUid,'u1');
  h.advance(20000);h.db.docs.set('rooms/world-duel-room',{host:{uid:'attacker'},worldTargetUid:'u2',status:'waiting'});
  assert.equal((await h.request('invite',{kind:'duel',targetUid:'u2',roomId:'world-duel-room'})).status,409);
  stop();assert.equal((await h.request('invite',{kind:'duel',targetUid:'u2',roomId:'world-duel-room'})).status,409);
});
test('a completed exploration quest credits the existing cultivation/inventory exactly once',async t=>{
  const h=await setup(t,{saved:{position:{x:18,y:27},explored:'1'.repeat(2304),gathered:1,victories:1,chests:1}});
  const joined=await h.request('join');assert.equal(joined.state.quest.ready,true);
  const[a,b]=await Promise.all([h.request('quest',{requestId:'quest-shared-receipt'}),h.request('quest',{requestId:'quest-shared-receipt'})]);
  assert.equal(a.ok,true);assert.equal(b.duplicate,true);const user=h.db.docs.get('users/u1');
  assert.equal(user.stats.totalScore,6);assert.equal(user.stats.gold,60);assert.equal(user.materialSystem.inventory['qi-spirit-iron'],12);
  assert.equal((await h.request('quest',{requestId:'quest-another-receipt'})).status,409);
});
test('the last array contribution unlocks the optional treasure entrance for another player',async t=>{
  const h=await setup(t,{saved:{position:{x:39,y:9},explored:'1'.repeat(2304)}});h.db.docs.set('worldEvents/main',{bridge:0,array:59});
  await h.request('join');const result=await h.request('interact',{objectId:'array'});assert.equal(result.events.array,60);
  const peer=await h.request('join',{},'u2');assert.equal(W.walkable(39,6,{events:peer.events}),true);
});
test('ordinary browser data access cannot read or forge world progress or shared events',()=>{
  const {mayRead,authorizeWrite}=require('../d1-browser-api.cjs');
  for(const path of ['worldPlayers/u1','worldEvents/main']){
    assert.equal(mayRead({role:'A',path,data:{uid:'u1'},uid:'u1',admin:false}),false);
    assert.throws(()=>authorizeWrite({role:'A',path,before:null,after:{uid:'u1',victories:99999},operation:{type:'set'},
      context:{uid:'u1',admin:false,decoded:{}},tx:{},preview:new Map()}),error=>error.status===403);
  }
});
test('D1 enforces a dedicated world duel target independently of client matchmaking filters',()=>{
  const {authorizeWrite}=require('../d1-browser-api.cjs');
  const before={host:{uid:'host'},guest:null,status:'waiting',worldTargetUid:'invited'};
  const attempt=uid=>authorizeWrite({role:'C',path:'rooms/world-private',before,after:{...before,guest:{uid},status:'intro'},
    operation:{type:'update',data:{guest:{uid},status:'intro'}},context:{uid,admin:false,decoded:{}},tx:{},preview:new Map()});
  assert.doesNotThrow(()=>attempt('invited'));assert.throws(()=>attempt('uninvited'),error=>error.status===403);
});

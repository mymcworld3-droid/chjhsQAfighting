const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express');
const {once}=require('node:events');
const register=require('../world-api.cjs'),W=require('../public/world/world-core.js'),B=require('../world-battle.cjs'),Q=require('../world-questions.cjs');
const P=W.starterPoint,C=W.townPoint;
const {worldDb}=require('./helpers/world-db.cjs');
const {trustedRaidPlayerSnapshot}=require('../raid-authority.cjs');
const baseUser=()=>({uid:'u1',displayName:'青雲修士',stats:{attack:200,maxHp:1000,totalScore:0,gold:0},materialSystem:{inventory:{'qi-spirit-iron':10,'qi-spirit-wood':10}}});
async function setup(t,{saved={},db:provided=null,world=null}={}){
  let at=Date.now();const db=provided||worldDb({'users/u1':baseUser(),'users/u2':{...baseUser(),uid:'u2',displayName:'道友'},'worldPlayers/u1':{...saved,mapVersion:world?.VERSION||W.VERSION}});
  const app=express();app.use(express.json());const service=register(app,{...(world?{world}:{}),resolveA:()=>({db}),resolveC:()=>({db}),verify:async req=>{const uid=req.get('x-test-uid');if(!uid)throw Object.assign(new Error('unauthorized'),{status:401});return uid;},now:()=>at,
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
  const joined=await h.request('join',{position:P(37,12),attack:999999});assert.deepEqual(joined.state.position,W.SPAWN);
  const bad=await h.request('move',{sessionId:joined.sessionId,seq:1,target:{x:-1,y:0}});assert.equal(bad.status,409);
});
test('moving writes only at arrival/checkpoint and restores the real reached position after restart',async t=>{
  const h=await setup(t,{saved:{position:W.SPAWN,explored:W.fullExplored()}}),join=await h.request('join'),before=h.db.writes;
  const r=await h.request('move',{sessionId:join.sessionId,seq:1,target:C(14,36)});assert.equal(r.ok,true);
  assert.equal(h.db.writes,before);h.advance(W.STEP_MS*2+10);await h.service.tick();assert.equal(h.db.writes,before,'no per-tile writes');
  h.advance(W.STEP_MS*10);await h.service.tick();assert.ok(h.db.writes>before);
  const position=h.db.docs.get('worldPlayers/u1').position;assert.deepEqual(position,C(14,36));
  const restarted=await setup(t,{db:h.db});const restored=await restarted.request('join');assert.deepEqual(restored.state.position,position);
});
test('new movement commands replace older routes and reject stale sequenced requests',async t=>{
  const h=await setup(t,{saved:{position:W.SPAWN,explored:W.fullExplored()}}),join=await h.request('join');
  await h.request('move',{sessionId:join.sessionId,seq:2,target:C(14,36)});h.advance(120);
  const r=await h.request('move',{sessionId:join.sessionId,seq:3,target:C(9,40)});assert.equal(r.ok,true);
  assert.equal((await h.request('move',{sessionId:join.sessionId,seq:1,target:C(12,36)})).status,409);
  h.advance(10000);await h.service.tick();assert.deepEqual(h.service.hub.actors.get('u1').state.position,C(9,40));
});
test('overlapping explorers are both visible and nearby presence reveals no player inventory or battle answers',async t=>{
  const h=await setup(t);await h.request('join');const peer=await h.request('join',{},'u2');assert.equal(peer.players.length,2);
  const mine=peer.players.find(p=>p.uid==='u1');assert.deepEqual(mine.route.path[0],W.SPAWN);assert.equal(mine.state,undefined);assert.equal(mine.stats,undefined);
});
test('gather/chest claims are atomic, personal and safe after duplicate, concurrent or failed requests',async t=>{
  const h=await setup(t,{saved:{position:P(12,27),explored:W.fullExplored()}});
  await h.request('join');const requestId='gather-unique';
  const [a,b]=await Promise.all([h.request('interact',{objectId:'herb-a',requestId}),h.request('interact',{objectId:'herb-a',requestId})]);
  assert.equal(a.ok,true);assert.equal(b.duplicate,true);assert.equal(h.db.docs.get('users/u1').materialSystem.inventory['qi-spirit-wood'],12);
  assert.equal((await h.request('interact',{objectId:'herb-a'})).status,409);
  const other=h.service.hub.actors.get('u1');other.state.position=P(19,27);other.route={path:[P(19,27)],stepMs:220,startedAtMs:h.now};
  h.db.failNext();assert.equal((await h.request('interact',{objectId:'chest-a',requestId:'chest-retry-1'})).status,503);
  assert.equal(h.db.docs.get('users/u1').stats.gold,0);
  const claimed=await h.request('interact',{objectId:'chest-a',requestId:'chest-retry-1'});assert.equal(claimed.ok,true);assert.equal(h.db.docs.get('users/u1').stats.gold,25);
});
test('shared bridge progress consumes materials exactly once and changes shared terrain for all players',async t=>{
  const h=await setup(t,{saved:{position:P(25,28),explored:W.fullExplored()}});h.db.docs.set('worldEvents/main',{bridge:19,array:0});
  await h.request('join');const r=await h.request('interact',{objectId:'bridge',requestId:'bridge-receipt'});assert.equal(r.events.bridge,20);
  assert.equal(h.db.docs.get('users/u1').materialSystem.inventory['qi-spirit-wood'],8);
  await h.request('interact',{objectId:'bridge',requestId:'bridge-receipt'});assert.equal(h.db.docs.get('worldEvents/main').bridge,20);
  const peer=await h.request('join',{},'u2');assert.equal(W.walkable(P(26,27).x,P(26,27).y,{events:peer.events}),true);
});
test('battle turns, answers, reward receipts and reconnect state are authoritative and durable',async t=>{
  const h=await setup(t,{saved:{position:P(18,23),explored:W.fullExplored()}});await h.request('join');
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
  const h=await setup(t,{saved:{position:W.SPAWN,explored:W.fullExplored()}});const joined=await h.request('join');
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
  await h.request('move',{sessionId:joined.sessionId,seq:1,target:C(12,36)});
  const moved=await packetWith(p=>p.type==='presence'&&p.players.some(a=>a.uid==='u1'&&W.same(a.route.path.at(-1),C(12,36))));
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
  const h=await setup(t,{saved:{position:P(18,27),explored:W.fullExplored(),gathered:1,victories:1,chests:1}});
  const joined=await h.request('join');assert.equal(joined.state.quest.ready,true);
  const[a,b]=await Promise.all([h.request('quest',{requestId:'quest-shared-receipt'}),h.request('quest',{requestId:'quest-shared-receipt'})]);
  assert.equal(a.ok,true);assert.equal(b.duplicate,true);const user=h.db.docs.get('users/u1');
  assert.equal(user.stats.totalScore,6);assert.equal(user.stats.gold,60);assert.equal(user.materialSystem.inventory['qi-spirit-iron'],12);
  assert.equal((await h.request('quest',{requestId:'quest-another-receipt'})).status,409);
});
test('the last array contribution unlocks the optional treasure entrance for another player',async t=>{
  const h=await setup(t,{saved:{position:P(39,9),explored:W.fullExplored()}});h.db.docs.set('worldEvents/main',{bridge:0,array:59});
  await h.request('join');const result=await h.request('interact',{objectId:'array'});assert.equal(result.events.array,60);
  const peer=await h.request('join',{},'u2');assert.equal(W.walkable(P(39,6).x,P(39,6).y,{events:peer.events}),true);
});
test('ordinary browser data access cannot read or forge world progress or shared events',()=>{
  const {mayRead,authorizeWrite}=require('../d1-browser-api.cjs');
  for(const path of ['worldPlayers/u1','worldEvents/main','worldChunks/'+W.VERSION+':0,0']){
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
test('joining pins the world seed once and never reads or transfers a million base tiles',async t=>{
  const world=W.createWorld('pinned-world'),h=await setup(t,{world}),joined=await h.request('join');
  assert.equal(joined.world.seed,'pinned-world');assert.equal(h.db.docs.get('worldEvents/main').world.worldId,world.VERSION);assert.deepEqual(joined.patches,{});
  assert.ok(JSON.stringify(joined).length<16000);assert.equal(h.db.reads.filter(k=>k.startsWith('worldChunks/')).length,0);
  const before=h.db.writes;await h.request('join');assert.equal(h.db.writes,before);
  const wrong=await setup(t,{db:h.db,world:W.createWorld('wrong-seed')});assert.equal((await wrong.request('join')).status,503,'seed changes cannot silently regenerate a saved shared world');
});
test('v1 migration archives the previous world, preserves cultivation and returns old explorers to the central sect once',async t=>{
  const previousId='qingyun-seeded-v1-'+W.seedHash(W.DEFAULT_SEED).toString(16).padStart(8,'0');
  const previous={seed:W.DEFAULT_SEED,size:1000,chunkSize:32,generatorVersion:'qingyun-seeded-v1',worldId:previousId};
  const oldPatch={worldId:previousId,revision:2,tiles:{22:{terrain:'road'}}},user=baseUser();
  const db=worldDb({'users/u1':user,'worldEvents/main':{world:previous,worldId:previousId,bridge:20,array:60,chunkRevisions:{'0,0':2}},
    ['worldChunks/'+previousId+':0,0']:oldPatch,'worldPlayers/u1':{mapVersion:previousId,position:{x:9,y:36},travelMode:'sail',explored:W.fullExplored(),
      gathered:3,victories:2,chests:1,questClaimed:true,claims:{'chest:chest-a':1},battle:{version:1,status:'active'},expedition:{version:1}}});
  const h=await setup(t,{db}),joined=await h.request('join');assert.equal(joined.ok,true);assert.deepEqual(joined.state.position,W.SPAWN);assert.equal(joined.state.travelMode,'walk');
  assert.equal(joined.state.battle,null);assert.equal(joined.state.expedition,null);assert.equal(joined.state.questClaimed,true);assert.equal(joined.state.victories,2);assert.equal(joined.state.claims['chest:chest-a'],1);
  assert.equal(W.known(joined.state.explored,9,36),false);assert.deepEqual(db.docs.get('users/u1'),user);assert.deepEqual(db.docs.get('worldChunks/'+previousId+':0,0'),oldPatch);
  const archived=db.docs.get('worldEvents/archive:'+previousId);assert.equal(archived.worldId,previousId);assert.deepEqual(archived.chunkRevisions,{'0,0':2});
  assert.deepEqual(db.docs.get('worldEvents/main').chunkRevisions,{});assert.equal(joined.events.bridge,20);assert.equal(joined.events.array,60);
  await h.service.checkpoint(h.service.hub.actors.get('u1'));assert.equal(db.docs.get('worldPlayers/u1').mapVersion,W.VERSION);
  const restarted=await setup(t,{db}),before=db.writes,again=await restarted.request('join');assert.deepEqual(again.state.position,W.SPAWN);assert.equal(db.writes,before);
});
test('only modified nearby chunks are read, cached, versioned and restored after restart',async t=>{
  const world=W.createWorld(),h=await setup(t,{world}),p=C(10,35),key=W.chunkKey(p.x,p.y),index=(p.y%32)*32+p.x%32;
  h.db.docs.set('worldEvents/main',{worldId:world.VERSION,world:world.descriptor,bridge:0,array:0,chunkRevisions:{[key]:1}});
  h.db.docs.set('worldChunks/'+world.VERSION+':'+key,{worldId:world.VERSION,revision:1,tiles:{[index]:{terrain:'rock'}}});
  const joined=await h.request('join');assert.equal(Object.keys(joined.patches).length,1);assert.equal(Object.keys(joined.patches[key].tiles).length,1);assert.equal(world.terrain(p.x,p.y),'rock');
  const reads=h.db.reads.filter(k=>k.startsWith('worldChunks/')).length;assert.equal(reads,1);
  const unchanged=await h.request('patches',{keys:[key,W.chunkKey(p.x+32,p.y)],versions:{[key]:1}});assert.deepEqual(unchanged.patches,{});assert.equal(h.db.reads.filter(k=>k.startsWith('worldChunks/')).length,reads);
  h.advance(500);const older=await h.request('patches',{keys:[key],versions:{}});assert.equal(older.patches[key].revision,1);assert.equal(h.db.reads.filter(k=>k.startsWith('worldChunks/')).length,reads);
  assert.equal((await h.request('patches',{keys:['31,31']})).status,400);assert.equal((await h.request('patches',{keys:['99,0']})).status,400);
  const restartedWorld=W.createWorld(),restarted=await setup(t,{db:h.db,world:restartedWorld});await restarted.request('join');assert.equal(restartedWorld.terrain(p.x,p.y),'rock');
  assert.equal((await h.request('edit-tile',{...p,terrain:'road'})).status,400);assert.equal(world.terrain(p.x,p.y),'rock');
});
test('a completed shared event persists only its changed tiles with an atomic revision',async t=>{
  const h=await setup(t,{saved:{position:P(25,28),explored:W.fullExplored()}});h.db.docs.set('worldEvents/main',{bridge:19,array:0});await h.request('join');
  const result=await h.request('interact',{objectId:'bridge'}),p=P(26,27),key=W.chunkKey(p.x,p.y);assert.equal(result.patches[key].revision,1);assert.equal(Object.keys(result.patches[key].tiles).length,2);
  const saved=h.db.docs.get('worldChunks/'+W.VERSION+':'+key);assert.equal(saved.revision,1);assert.equal(saved.worldId,W.VERSION);assert.equal(h.db.docs.get('worldEvents/main').chunkRevisions[key],1);
});
test('sailing crosses water by an actual route, persists its mode and requires land before disembarking',async t=>{
  let coast,water;
  for(let y=100;y<400&&!coast;y++)for(let x=100;x<400&&!coast;x++)if(W.walkable(x,y))for(const[dx,dy]of W.DIRS)if(['water','ocean'].includes(W.terrain(x+dx,y+dy))){coast={x,y};water={x:x+dx,y:y+dy};break;}
  assert.ok(coast);const h=await setup(t,{saved:{position:coast,explored:W.fullExplored()}}),joined=await h.request('join');
  assert.equal((await h.request('move',{sessionId:joined.sessionId,seq:1,target:water})).status,409);assert.equal((await h.request('travel',{mode:'sail'})).state.travelMode,'sail');h.advance(500);
  const move=await h.request('move',{sessionId:joined.sessionId,seq:2,target:water});assert.equal(move.ok,true);assert.deepEqual(move.self.route.path,[coast,water]);
  h.advance(2000);await h.service.tick();const restarted=await setup(t,{db:h.db}),restored=await restarted.request('join');assert.deepEqual(restored.state.position,water);assert.equal(restored.state.travelMode,'sail');assert.equal((await restarted.request('travel',{mode:'walk'})).status,409);
});
test('non-combat secret realms save mechanism progress and grant exploration rewards exactly once',async t=>{
  const o=W.objectsIn({x:64,y:64,w:160,h:160}).find(o=>o.kind==='realm'&&o.subtype==='puzzle');assert.ok(o);
  const p=W.DIRS.map(([dx,dy])=>({x:o.x+dx,y:o.y+dy})).find(p=>W.walkable(p.x,p.y));
  const h=await setup(t,{saved:{position:p,explored:W.fullExplored()}});await h.request('join');let result=await h.request('interact',{objectId:o.id}),e=result.state.expedition;
  assert.equal(e.objectId,o.id);assert.equal(result.state.battle,null);
  result=await h.request('explore',{command:'rotate',index:0});const restarted=await setup(t,{db:h.db});assert.deepEqual((await restarted.request('join')).state.expedition.rotations,result.state.expedition.rotations);
  let lastId;for(let i=0;i<3;i++)while(result.state.expedition&&result.state.expedition.rotations[i]!==0){lastId='rune-'+i+'-'+result.state.expedition.rotations[i];result=await h.request('explore',{command:'rotate',index:i,requestId:lastId});assert.ok(result.ok);}
  assert.equal(result.state.expedition,null);assert.ok(result.rewards);const gold=h.db.docs.get('users/u1').stats.gold;
  assert.equal((await h.request('explore',{command:'rotate',index:2,requestId:lastId})).duplicate,true);assert.equal(h.db.docs.get('users/u1').stats.gold,gold);
  assert.equal((await h.request('interact',{objectId:o.id})).rewards,undefined);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/cultivation/battle-mode-v2.js'),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const clone=x=>structuredClone(x);
function waiting(uid){return {modeVersion:2,status:'waiting',host:{uid,totalScore:20,lastSeenAtMs:10000},guest:null,createdAtMs:10000};}
function bus(initial){
 const rooms=new Map(Object.entries(initial).map(([k,v])=>[k,clone(v)])),listeners=new Map();let queue=Promise.resolve(),next=0;
 const snap=id=>({id,ref:{id},exists:()=>rooms.has(id),data:()=>clone(rooms.get(id))});
 const emit=id=>{for(const cb of [...(listeners.get(id)||[])])cb(snap(id));};
 const result={rooms,listeners,snap,emit,retryNext:null,
  async getDocs(cursor){return {docs:[...rooms].filter(([id,r])=>r.status==='waiting'&&(!cursor||id>cursor)).sort(([a],[b])=>a.localeCompare(b)).slice(0,80).map(([id])=>snap(id))};},
  onSnapshot(ref,next){if(!ref.id)return()=>{};let list=listeners.get(ref.id);if(!list)listeners.set(ref.id,list=new Set());list.add(next);next(snap(ref.id));return()=>list.delete(next);},
  transaction(worker){const promise=queue.then(async()=>{
   const execute=async()=>{const staged=[];const tx={get:async ref=>snap(ref.id),update:(ref,p)=>staged.push({id:ref.id,patch:clone(p)}),delete:ref=>staged.push({id:ref.id,delete:true})};return {value:await worker(tx),staged};};
   if(result.retryNext){await execute();const retry=result.retryNext;result.retryNext=null;retry();}
   const {value,staged}=await execute();for(const w of staged){if(w.delete)rooms.delete(w.id);else rooms.set(w.id,{...rooms.get(w.id),...w.patch});}
   // Firestore listeners may receive local committed deletion before the transaction Promise resolves.
   for(const id of new Set(staged.map(w=>w.id)))emit(id);if(result.loseResponse){result.loseResponse=false;throw Error('response lost after commit');}return value;
  });queue=promise.catch(()=>{});return promise;},
  async add(data){const id='new'+(++next);rooms.set(id,clone(data));return {id};}
 };return result;
}
function client(shared,uid,roomId){
 const messages=[],pages=[],staleCallbacks=[];
 const ctx=vm.createContext({console:{warn(){},error(){}},uid,time:10000,BATTLE_V2:{modeVersion:2,waitingRoomTtlMs:90000,maxRounds:15},
  ROOM_COLLECTION:'rooms',MATCH_SCAN_LIMIT:80,MATCH_SCAN_MAX_PAGES:4,MATCH_RECONCILE_MS:15000,INTRO_DURATION_MS:4800,ANSWER_WINDOW_MS:25000,HEARTBEAT_MS:8000,
  roomQuota:{blocked:()=>false,success(){},failure(){}},
  cultivationRules:{VERSION:1},battleDb:shared,playerRepository:{currentUser:()=>({uid:ctx.uid})},
  doc:(_,collection,id)=>({id}),collection:()=>({}),query:(...args)=>({cursor:args.find(arg=>arg?.cursor)?.cursor}),where:()=>({}),limit:()=>({}),startAfter:snap=>({cursor:snap.id}),
  getDocs:query=>shared.getDocs(query?.cursor),getDoc:async ref=>{if(shared.failReads)throw Error('temporarily offline');return shared.snap(ref.id);},addDoc:(_,data)=>shared.add(data),
  runTransaction:(_,worker)=>shared.transaction(worker),serverTimestamp:()=>10000,
  timestampMs:(t,f)=>Number(t)||f,playerSnapshot:()=>({uid:ctx.uid,totalScore:20}),
  applyNascentSoulDuelRule:(host,guest)=>({host,guest}),resolveBattleKnowledge:()=>({}),
  onSnapshot:(ref,options,next)=>{next ||= options;if(ref.id)staleCallbacks.push(next);return shared.onSnapshot(ref,next);},
  FOUNDATION_SCORE:10,score:()=>20,ensurePage(){},showSection(){},setText(){},setPlayerAvatar(){},playerCoreLabel:()=>'',playerPowerLabel:()=>'',playerNascentSealLabel:()=>'',
  window:{ensureCombatStats:async()=>{},getCurrentUserData:()=>({stats:{totalScore:20}}),switchToPage:p=>pages.push(p),dispatchEvent(){}},
  document:{querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null},setTimeout:()=>1,setInterval:()=>1,clearTimeout(){},clearInterval(){},
  toast:m=>messages.push(m),logBattleFirestoreError(){},heartbeat(){},tickRoom(){},renderLobby(){},renderIntro(){},prefetchRoundQuestion(){},
  renderArena(){},renderQuiz(){},renderResult(){},answerObject:()=>null,settleRound(){},settlementKey:()=>'',CustomEvent:class{},alert(){},inviteOnlineFriends(){},
 });
 vm.runInContext(section('  const state = {','  function db()')+
   'function db(){return battleDb;} function me(){return playerRepository.currentUser();} function nowMs(){return time;}' +
   section('  function roomRef(','  // Invite only')+
   section('  function scheduleReconcile(','  function renderLobby(')+
   section('  function onRoomSnapshot(','  function storyOrTutorialOpen(')+
   section('  function storyOrTutorialOpen()', '  async function forfeitCurrentRoom()')+
   '\nwatchWaitingRooms=()=>{};scheduleReconcile=()=>{};inviteOnlineFriends=()=>{};this.runtime=state;this.claim=claimWaitingRoom;this.merge=reconcileOwnWaitingRoom;this.subscribe=subscribeRoom;this.reset=resetRuntime;this.stale=isRoomStale;',ctx);
 ctx.runtime.role='host';if(roomId)ctx.subscribe(roomId);
 return {ctx,state:ctx.runtime,messages,pages,staleCallbacks};
}
test('two simultaneously created rooms merge without the deleted own-room listener ejecting the guest',async()=>{
 const shared=bus({a:waiting('A'),b:waiting('B')}),a=client(shared,'A','a'),b=client(shared,'B','b');
 await Promise.all([a.ctx.merge(),b.ctx.merge()]);
 assert.equal(shared.rooms.size,1);assert.equal(shared.rooms.get('a').guest.uid,'B');
 assert.equal(a.state.roomId,'a');assert.equal(b.state.roomId,'a');assert.equal(b.state.role,'guest');
 assert.equal(b.pages.includes('page-home'),false);assert.equal(b.messages.includes('鬥法房間已不存在。'),false);
});
test('a discarded successful claim cannot report success when its final transaction attempt loses the slot',async()=>{
 const shared=bus({a:waiting('A'),b:waiting('B')}),b=client(shared,'B','b');
 shared.retryNext=()=>{shared.rooms.get('a').guest={uid:'C'};shared.rooms.get('a').status='intro';};
 assert.equal(await b.ctx.claim({id:'a'},{uid:'B'}),false);
 assert.equal(shared.rooms.get('a').guest.uid,'C');
});
test('three simultaneous hosts form only one pair; the remaining host keeps its own waiting room',async()=>{
 const shared=bus({a:waiting('A'),b:waiting('B'),c:waiting('C')}),a=client(shared,'A','a'),b=client(shared,'B','b'),c=client(shared,'C','c');
 await Promise.all([a.ctx.merge(),b.ctx.merge(),c.ctx.merge()]);
 assert.equal(shared.rooms.get('a').guest.uid,'B');assert.equal(b.state.roomId,'a');assert.equal(c.state.roomId,'c');
 assert.equal(c.state.role,'host');assert.equal(shared.rooms.get('c').guest,null);
});
test('queued callbacks from a detached room cannot reset or overwrite the new room',async()=>{
 const shared=bus({a:waiting('A'),b:waiting('B')}),b=client(shared,'B','b'),old=b.staleCallbacks[0];
 await b.ctx.merge();old({exists:()=>false});old({exists:()=>true,data:()=>waiting('B')});
 assert.equal(b.state.roomId,'a');assert.equal(b.state.role,'guest');assert.equal(b.state.room.status,'intro');
});
test('a live waiting host remains matchable after ninety seconds; abandoned rooms expire',()=>{
 const shared=bus({a:waiting('A')}),a=client(shared,'A','a');a.ctx.time=120000;
 assert.equal(a.ctx.stale({...waiting('A'),host:{uid:'A',lastSeenAtMs:119000}}),false);
 assert.equal(a.ctx.stale(waiting('A')),true);
});

test('lost commit response and temporary read failure resume the already paired target without another match',async()=>{
 const shared=bus({a:waiting('A'),b:waiting('B')}),a=client(shared,'A','a'),b=client(shared,'B','b');
 shared.loseResponse=true;shared.failReads=true;
 await b.ctx.merge();assert.equal(shared.rooms.get('a').guest.uid,'B');assert.equal(b.state.roomId,'b');
 assert.ok(b.state.mergeAttempt);assert.equal(b.pages.includes('page-home'),false);
 shared.failReads=false;await b.ctx.merge();assert.equal(b.state.roomId,'a');assert.equal(b.state.role,'guest');
 assert.equal(shared.rooms.size,1);assert.equal(b.state.mergeAttempt,null);
});
test('transaction retry that loses a target keeps the host in its original room',async()=>{
 const shared=bus({a:waiting('A'),b:waiting('B')}),b=client(shared,'B','b');
 shared.retryNext=()=>{shared.rooms.get('a').guest={uid:'C'};shared.rooms.get('a').status='intro';};
 await b.ctx.merge();assert.equal(b.state.roomId,'b');assert.equal(b.state.role,'host');assert.equal(shared.rooms.get('b').status,'waiting');
});
test('cancelling or changing account during the initial scan cannot create a ghost waiting room',async()=>{
 const shared=bus({}),b=client(shared,'B');let resolve;
 b.ctx.findAndClaimRoom=()=>new Promise(done=>{resolve=done;});
 const pending=vm.runInContext('startMatchmaking()',b.ctx);await new Promise(done=>setImmediate(done));
 b.ctx.reset();resolve(null);await pending;assert.equal(shared.rooms.size,0);assert.equal(b.state.roomId,null);
});
test('cancelling while room creation is in flight deletes the late unmatched room',async()=>{
 const shared=bus({}),b=client(shared,'B');let resolve;
 b.ctx.findAndClaimRoom=async()=>null;b.ctx.createWaitingRoom=()=>new Promise(done=>{resolve=done;});
 const pending=vm.runInContext('startMatchmaking()',b.ctx);await new Promise(done=>setImmediate(done));
 b.ctx.reset();shared.rooms.set('late',waiting('B'));resolve('late');await pending;
 assert.equal(shared.rooms.size,0);assert.equal(b.state.roomId,null);
});
test('leaving during committed room merge forfeits the real target rather than leaving its host waiting',async()=>{
 const shared=bus({a:waiting('A'),b:waiting('B')}),b=client(shared,'B','b');
 const old=b.staleCallbacks[0];
 // A queued callback simulates the cancel action after commit but before the merge Promise resolves.
 shared.listeners.get('b').add(()=>{b.ctx.reset();});
 await b.ctx.merge();assert.equal(b.state.roomId,null);assert.equal(shared.rooms.get('a').status,'finished');
 assert.equal(shared.rooms.get('a').winner,'A');old({exists:()=>false});assert.equal(b.state.roomId,null);
});

test('old expired rooms cannot hide two live rooms beyond the first eighty records',async()=>{
 const initial=Object.fromEntries(Array.from({length:400},(_,i)=>['old'+String(i).padStart(3,'0'),waiting('offline'+i)]));
 initial.za=waiting('A');initial.zb=waiting('B');
 const shared=bus(initial),a=client(shared,'A','za'),b=client(shared,'B','zb');a.ctx.time=b.ctx.time=120000;
 shared.rooms.get('za').host.lastSeenAtMs=shared.rooms.get('zb').host.lastSeenAtMs=120000;
 await b.ctx.merge();assert.equal(b.state.roomId,'zb');assert.ok(b.state.waitingScanCursor);
 await b.ctx.merge();assert.equal(b.state.roomId,'za');assert.equal(shared.rooms.get('za').guest.uid,'B');
});
test('actual simultaneous initial searches can create two rooms and then converge to one pair',async()=>{
 const shared=bus({}),a=client(shared,'A'),b=client(shared,'B');
 await Promise.all([vm.runInContext('startMatchmaking()',a.ctx),vm.runInContext('startMatchmaking()',b.ctx)]);
 assert.equal(shared.rooms.size,2);
 await Promise.all([a.ctx.merge(),b.ctx.merge()]);assert.equal(shared.rooms.size,1);assert.equal(a.state.roomId,b.state.roomId);
 assert.notEqual(a.state.role,b.state.role);
});
test('an old merge completion cannot forfeit a target already adopted by the new session',async()=>{
 const shared=bus({a:waiting('A'),b:waiting('B')}),b=client(shared,'B','b');
 shared.listeners.get('b').add(()=>{b.ctx.reset();b.ctx.subscribe('a');});
 await b.ctx.merge();assert.equal(b.state.roomId,'a');assert.equal(b.state.role,'guest');
 assert.equal(shared.rooms.get('a').status,'intro');assert.equal(shared.rooms.get('a').guest.uid,'B');
});

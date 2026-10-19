'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {D1Store,Codec}=require('../d1-store.cjs');
const {setup}=require('./helpers/d1-db.cjs');
const {executeCommit,mayRead,publicPlayer,registerD1BrowserApi}=require('../d1-browser-api.cjs');
const context={uid:'alice',admin:false,decoded:{email:'alice@example.com'}};
function write(path,data,type='update',role='A'){return {target:{role,path,kind:'doc'},type,data:Codec.encode(data)};}
test('D1 browser rejects privilege escalation, peer theft and direct reward receipts',async()=>{
  const {db}=setup();await db.doc('users/alice').set({uid:'alice',isAdmin:false,stats:{gold:10}});await db.doc('users/bob').set({uid:'bob',stats:{gold:50}});
  for(const w of [write('users/alice',{isAdmin:true}),write('users/bob',{'stats.gold':0}),write('raidRewardClaims/fake',{uid:'alice'},'set')])
    await assert.rejects(executeCommit(db,{writes:[w]},context),e=>e.status===403);
  assert.equal((await db.doc('users/bob').get()).data().stats.gold,50);
  await executeCommit(db,{writes:[write('users/alice',{displayName:'修士'})]},context);
  assert.equal((await db.doc('users/alice').get()).data().displayName,'修士');
});
test('D1 browser transaction rejects stale versions and freezes all writes on conflict',async()=>{
  const {db}=setup();await db.doc('users/alice').set({uid:'alice',isAdmin:false,stats:{gold:10}});
  const before=await db.doc('users/alice').get();await db.doc('users/alice').update({'stats.gold':15});
  await assert.rejects(executeCommit(db,{reads:[{target:{role:'A',path:'users/alice',kind:'doc'},version:before.version}],writes:[write('users/alice',{'stats.gold':0})]},context),e=>e.code==='aborted');
  assert.equal((await db.doc('users/alice').get()).data().stats.gold,15);
});
test('D1 cross-user friend change requires matching reciprocal own update',async()=>{
  const {db}=setup();for(const uid of ['alice','bob'])await db.doc('users/'+uid).set({uid,isAdmin:false,friends:[]});
  const union=uid=>({__d1op:'arrayUnion',args:[uid]});
  await assert.rejects(executeCommit(db,{writes:[write('users/bob',{friends:union('alice')})]},context),e=>e.status===403);
  await executeCommit(db,{writes:[write('users/alice',{friends:union('bob')}),write('users/bob',{friends:union('alice')})]},context);
  assert.deepEqual((await db.doc('users/bob').get()).data().friends,['alice']);
});
test('D1 marketplace seller credit requires an atomic listing transition and buyer debit',async()=>{
  const {db}=setup();await db.doc('users/alice').set({uid:'alice',isAdmin:false,stats:{gold:100}});await db.doc('users/bob').set({uid:'bob',stats:{gold:10}});
  await db.doc('marketListings/item').set({sellerUid:'bob',buyerUid:'',price:30,status:'active',completedAtMs:0});
  const ws=[write('users/alice',{'stats.gold':70}),write('users/bob',{'stats.gold':40}),write('marketListings/item',{status:'sold',buyerUid:'alice',completedAtMs:1})];
  await executeCommit(db,{writes:ws},context);assert.equal((await db.doc('users/bob').get()).data().stats.gold,40);
  await assert.rejects(executeCommit(db,{writes:ws},context),e=>e.status===403);
});
test('D1 private documents and public player projection protect email and private learning fields',()=>{
  assert.equal(mayRead({role:'A',path:'exam_logs/x',data:{uid:'bob'},uid:'alice',admin:false}),false);
  assert.equal(mayRead({role:'BD',path:'friendChats/x/messages/y',data:{},uid:'alice',admin:false}),false);
  const p=publicPlayer({displayName:'B',email:'secret',isAdmin:true,profile:{weakSubjects:'secret'},stats:{totalScore:20,knowledgePointMapV1:{secret:true}}});
  assert.equal(p.email,undefined);assert.equal(p.isAdmin,undefined);assert.equal(p.profile.weakSubjects,undefined);assert.equal(p.stats.knowledgePointMapV1,undefined);
});
test('D1 browser authenticates before touching data and refuses revoked/wrong-audience tokens',async()=>{
  const routes={};registerD1BrowserApi({get:(p,f)=>routes[p]=f,post:(p,f)=>routes[p]=f},{env:{GAME_DATA_BACKEND:'d1'},resolve:()=>({auth:{verifyIdToken:async()=>({uid:'alice',aud:'bad',iss:'bad'})}}),store:()=>{throw Error('must not access DB');}});
  const response={statusCode:200,set(){return this;},status(s){this.statusCode=s;return this;},json(p){this.payload=p;return this;}};
  await routes['/api/data']({get:()=>'',body:{}},response);assert.equal(response.statusCode,401);
  await routes['/api/data']({get:()=>'Bearer token',body:{}},response);assert.equal(response.statusCode,401);
});

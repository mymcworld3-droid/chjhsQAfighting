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
test('D1 browser cannot bypass friend consent or change invitation preferences',async()=>{
  const {db}=setup();for(const uid of ['alice','bob'])await db.doc('users/'+uid).set({uid,isAdmin:false,friends:[]});
  const union=uid=>({__d1op:'arrayUnion',args:[uid]});
  await assert.rejects(executeCommit(db,{writes:[write('users/bob',{friends:union('alice')})]},context),e=>e.status===403);
  await assert.rejects(executeCommit(db,{writes:[write('users/alice',{friends:union('bob')}),write('users/bob',{friends:union('alice')})]},context),e=>e.status===403);
  await assert.rejects(executeCommit(db,{writes:[write('users/alice',{friends:['bob']})]},context),e=>e.status===403);
  await assert.rejects(executeCommit(db,{writes:[write('users/alice',{friendInvitesDisabled:true})]},context),e=>e.status===403);
  assert.deepEqual((await db.doc('users/bob').get()).data().friends,[]);
});
test('D1 rejects retired market writes, including complete purchases and admin listings',async()=>{
  const {db}=setup();await db.doc('users/alice').set({uid:'alice',isAdmin:false,stats:{gold:100}});await db.doc('users/bob').set({uid:'bob',stats:{gold:10}});
  await db.doc('marketListings/item').set({sellerUid:'bob',buyerUid:'',price:30,status:'active',completedAtMs:0});
  const ws=[write('users/alice',{'stats.gold':70}),write('users/bob',{'stats.gold':40}),write('marketListings/item',{status:'sold',buyerUid:'alice',completedAtMs:1})];
  await assert.rejects(executeCommit(db,{writes:ws},context),e=>e.status===403);
  const listing=write('marketListings/new',{sellerUid:'alice',type:'recipe',status:'active',price:30},'set');
  await assert.rejects(executeCommit(db,{writes:[listing]},context),e=>e.status===403);
  await db.doc('users/alice').update({isAdmin:true});
  await assert.rejects(executeCommit(db,{writes:[listing]},context),e=>e.status===403);
  assert.equal((await db.doc('users/alice').get()).data().stats.gold,100);
  assert.equal((await db.doc('users/bob').get()).data().stats.gold,10);
  assert.equal((await db.doc('marketListings/item').get()).data().status,'active');
});
test('D1 private documents and public player projection protect email and private learning fields',()=>{
  assert.equal(mayRead({role:'A',path:'exam_logs/x',data:{uid:'bob'},uid:'alice',admin:false}),false);
  assert.equal(mayRead({role:'BD',path:'friendChats/x/messages/y',data:{},uid:'alice',admin:false}),false);
  assert.equal(mayRead({role:'A',path:'friendRequestInboxes/bob',data:{},uid:'alice',admin:false}),false);
  assert.equal(mayRead({role:'A',path:'friendRequestOutboxes/alice',data:{},uid:'alice',admin:false}),false);
  const p=publicPlayer({displayName:'B',email:'secret',isAdmin:true,profile:{weakSubjects:'secret'},stats:{totalScore:20,knowledgePointMapV1:{secret:true}}});
  assert.equal(p.email,undefined);assert.equal(p.isAdmin,undefined);assert.equal(p.profile.weakSubjects,undefined);assert.equal(p.stats.knowledgePointMapV1,undefined);
});
test('D1 browser authenticates before touching data and refuses revoked/wrong-audience tokens',async()=>{
  const routes={};registerD1BrowserApi({get:(p,f)=>routes[p]=f,post:(p,f)=>routes[p]=f},{env:{GAME_DATA_BACKEND:'d1'},resolve:()=>({auth:{verifyIdToken:async()=>({uid:'alice',aud:'bad',iss:'bad'})}}),store:()=>{throw Error('must not access DB');}});
  const response={statusCode:200,set(){return this;},status(s){this.statusCode=s;return this;},json(p){this.payload=p;return this;}};
  await routes['/api/data']({get:()=>'',body:{}},response);assert.equal(response.statusCode,401);
  await routes['/api/data']({get:()=>'Bearer token',body:{}},response);assert.equal(response.statusCode,401);
});

test('D1 browsers cannot fabricate immortal seats, edit defender builds or read combat sessions',async()=>{
  const {db}=setup();await db.doc('users/alice').set({uid:'alice',stats:{totalScore:9999}});
  const playerSnap=await db.doc('users/alice').get();
  const reads=[{target:{role:'A',path:'users/alice',kind:'doc'},version:playerSnap.version}];
  await assert.rejects(executeCommit(db,{reads,writes:[write('worldImmortals/junior__ru-xian',{
    uid:'alice',cohort:'junior',challengeScore:10000},'set')]},context),e=>e.status===403);
  await db.doc('worldImmortals/junior__ru-xian').set({uid:'alice',cohort:'junior',avatarRevision:'valid'});
  for(const patch of [{avatar:{atk:999999}},{avatarPower:999999},{avatarRevision:'fake'},{uid:'bob'}])
    await assert.rejects(executeCommit(db,{writes:[write('worldImmortals/junior__ru-xian',patch)]},context),e=>e.status===403);
  assert.equal(mayRead({role:'A',path:'immortalAvatarSessions/alice',data:{uid:'alice'},uid:'alice',admin:false}),false);
  await assert.rejects(executeCommit(db,{writes:[write('immortalAvatarSessions/alice',{status:'completed'},'set')]},context),e=>e.status===403);
  await executeCommit(db,{writes:[write('worldImmortals/junior__ru-xian',{displayName:'新名號'})]},context);
  assert.equal((await db.doc('worldImmortals/junior__ru-xian').get()).data().displayName,'新名號');
});


test('D1 browser cannot forge or inspect private martial trial progress',async()=>{
  const {db}=setup();
  await db.doc('users/alice').set({uid:'alice'});
  await db.doc('martialTrialStates/alice').set({uid:'alice',bestFloor:10});
  for(const path of ['martialTrialStates/alice','martialTrialStates/bob']){
    assert.equal(mayRead({role:'A',path,data:{uid:'alice'},uid:'alice',admin:false}),false);
    await assert.rejects(executeCommit(db,{writes:[write(path,{bestFloor:100},'set')]},context),e=>e.status===403);
  }
  assert.equal((await db.doc('martialTrialStates/alice').get()).data().bestFloor,10);
});

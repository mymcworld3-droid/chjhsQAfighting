'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const rules=require('../immortal-challenge-api.cjs').__test;
const Combat=require('../immortal-avatar-combat.cjs');
const Ticket=require('../raid-question-ticket.cjs');
const beforeEnv=process.env.FIREBASE_A_SERVICE_ACCOUNT_JSON;
process.env.FIREBASE_A_SERVICE_ACCOUNT_JSON=JSON.stringify({type:'service_account',project_id:'question-learning',
  private_key:'-----BEGIN PRIVATE KEY-----\nnonsecret-test-key\n-----END PRIVATE KEY-----',client_email:'test@question-learning.iam.gserviceaccount.com'});
test.after(()=>{if(beforeEnv===undefined)delete process.env.FIREBASE_A_SERVICE_ACCOUNT_JSON;else process.env.FIREBASE_A_SERVICE_ACCOUNT_JSON=beforeEnv;});
const NOW=1800000000000;
function player(patch={}){return {displayName:'挑戰者',profile:{educationLevel:'國中三年級'},stats:{totalScore:1868,attack:230,maxHp:1800},...patch};}
function database(user=player()){
  const records=new Map([['users/u1',structuredClone(user)]]);let queue=Promise.resolve();
  const snap=key=>({exists:records.has(key),data:()=>structuredClone(records.get(key))});
  return {records,collection:name=>({doc:id=>({key:name+'/'+id,get:async()=>snap(name+'/'+id)})}),
    runTransaction(callback){const work=queue.then(async()=>{const writes=new Map();
      const value=await callback({get:async ref=>{assert.equal(writes.size,0,'all reads before writes');return snap(ref.key);},
        set:(ref,value)=>writes.set(ref.key,structuredClone(value)),
        update:(ref,patch)=>{const data=structuredClone(records.get(ref.key));assert.ok(data,'update existing document');
          for(const [key,value] of Object.entries(patch)){const parts=key.split('.');let cursor=data;
            for(const part of parts.slice(0,-1)){cursor[part]??={};cursor=cursor[part];}cursor[parts.at(-1)]=structuredClone(value);}
          writes.set(ref.key,data);}});
      for(const [key,value] of writes)records.set(key,value);return value;});queue=work.catch(()=>{});return work;}};
}
const state=db=>db.records.get(rules.COLLECTION+'/u1');
async function question(db,now=NOW){const expected=await rules.prepareQuestion(db,'u1',now);
  return rules.commitQuestion(db,'u1',expected,{q:'第 '+expected.index+' 題：下列何者正確？',correct:'正確',wrong:['錯一','錯二','錯三'],exp:'這是正確答案的說明。'},now);}
async function turn(db,{correct=true,tactic='assault',now=NOW,extra={}}={}){
  const q=await question(db,now),answerIndex=Ticket.readRaidQuestionTicket(q.ticket,{now}).answerIndex;
  const request={runId:state(db).runId,round:state(db).round,questionId:q.id,ticket:q.ticket,
    choice:correct?answerIndex:(answerIndex+1)%4,tactic,...extra};
  return {request,q,...await rules.answer(db,'u1',request,now)};
}
function addOwner(db,{legacy=false,...userPatch}={}){
  db.records.set('users/owner',player({displayName:'仙主',...userPatch}));
  const avatar=Combat.snapshot('owner',db.records.get('users/owner'));
  db.records.set('worldImmortals/junior__ru-xian',{uid:'owner',cohort:'junior',role:'ru-xian',challengeScore:999,
    ...(legacy?{}:{avatarVersion:2,avatar,avatarPower:avatar.power,avatarRevision:'first',avatarStyle:'counter'})});
}
test('stored build projects realm HP, enabled core, soul growth and only owned equipment',()=>{
  const user=player({cultivationTraining:{equippedCore:{type:'sword',grade:1}},nascentSoulGrowth:{version:1,branches:{attack:8,vitality:4}},
    artifactSystem:{equipped:{本命法寶:'test-sword',護身法寶:'not-owned'},inventory:{'test-sword':1}}});
  const config={artifactCatalogSchemaVersion:2,items:[{id:'test-sword',name:'測試劍',realm:'金丹',equipSlot:'本命法寶',effects:[
    {type:'equip_attack_flat',value:100},{type:'equip_hp_flat',value:100},{type:'equip_true_damage_flat',value:50}]},
    {id:'not-owned',name:'不應裝備',realm:'金丹',equipSlot:'護身法寶',effects:[{type:'equip_attack_flat',value:99999}]}]};
  const base=Combat.snapshot('u1',player()),built=Combat.snapshot('u1',user,config);
  assert.ok(built.atk>base.atk);assert.ok(built.maxHp>base.maxHp);assert.equal(built.goldenCore.type,'sword');
  assert.ok(built.nascentSoul);assert.deepEqual(built.equipment,['測試劍']);assert.equal(built.artifactBattle.effects.length,3);
  user.cultivationTraining.coreEnabled=false;const disabled=Combat.snapshot('u1',user,config);
  assert.equal(disabled.goldenCore,null);assert.equal(disabled.nascentSoul,null);
  assert.equal(Combat.snapshot('u1',player({cultivationTraining:{core:{type:'sword',grade:1}}})).goldenCore,null);
});
test('NPC guards empty seats and questions have no exposed answer; pending generation is idempotent',async()=>{
  const db=database();const s=await rules.start(db,'u1',{role:'ru-xian'},NOW);
  assert.equal(s.npc,true);assert.equal(s.status,'active');assert.ok(s.defender.hp>0);assert.equal(s.level,'國中三年級');
  const q=await question(db);assert.equal(q.answer,undefined);assert.equal(q.correct,undefined);assert.equal(q.answerIndex,undefined);
  assert.deepEqual((await rules.prepareQuestion(db,'u1',NOW)).pending,q);
  assert.equal((await question(db)).id,q.id);
  assert.equal((await rules.start(db,'u1',{role:'ru-xian'},NOW)).runId,s.runId);
  await assert.rejects(rules.start(db,'u1',{role:'fa-xian'},NOW),/還有一場/);
});
test('wrong answers cost a turn and HP, rather than ending the challenge',async()=>{
  const db=database();await rules.start(db,'u1',{role:'ru-xian'},NOW);
  const before=state(db).challenger.hp,result=await turn(db,{correct:false});
  assert.equal(result.state.status,'active');assert.equal(result.state.round,1);assert.equal(result.state.lastReview.correct,false);
  assert.ok(result.state.challenger.hp<before);assert.ok(result.state.defender.hp>0);
});
test('correct guard mitigates damage; charge accumulates and assault consumes it',async()=>{
  const db=database();await rules.start(db,'u1',{role:'ru-xian'},NOW);
  const initial=structuredClone(state(db)),strong=Combat.settle(initial,true,'assault'),guard=Combat.settle(initial,true,'guard');
  assert.ok(guard.challenger.hp>strong.challenger.hp);assert.ok(guard.defender.hp>strong.defender.hp);
  const charged=Combat.settle(initial,true,'charge');assert.equal(charged.charge,1);
  const released=Combat.settle({...initial,...charged},true,'assault');assert.equal(released.charge,0);
  const normal=Combat.settle({...initial,round:1},true,'assault');
  assert.ok(charged.defender.hp-released.defender.hp>initial.defender.hp-normal.defender.hp);
  assert.deepEqual(Combat.settle(initial,true,'assault'),Combat.settle(initial,true,'assault'));
});
test('answer retry cannot inflict damage twice and altered choice/ticket cannot settle',async()=>{
  const db=database();await rules.start(db,'u1',{role:'ru-xian'},NOW);const result=await turn(db);
  const saved=structuredClone(state(db));await rules.answer(db,'u1',result.request,NOW);
  assert.deepEqual(state(db),saved);
  const logs=[...db.records.keys()].filter(key=>key.startsWith('exam_logs/'));assert.equal(logs.length,1);
  assert.equal(db.records.get(logs[0]).question,result.q.q);
  await assert.rejects(rules.answer(db,'u1',{...result.request,choice:(result.request.choice+1)%4},NOW),/已結算/);
  await assert.rejects(rules.answer(db,'u1',{...result.request,ticket:result.request.ticket+'x'},NOW));
  await assert.rejects(rules.answer(db,'other',result.request,NOW),/不符/);
});
test('client wins, statistics, role and HP are ignored; server awards by actual knockout',async()=>{
  const db=database();await rules.start(db,'u1',{role:'ru-xian',atk:999999,maxHp:999999},NOW);
  assert.ok(state(db).challenger.atk<999999);
  const first=await turn(db,{correct:false,extra:{won:true,defenderHp:0,challenger:{atk:999999},role:'fa-xian'}});
  assert.equal(first.state.result,null);assert.equal(db.records.has('worldImmortals/junior__fa-xian'),false);
  while(state(db).status==='active')await turn(db);
  assert.equal(state(db).result.claimed,true);
  const seat=db.records.get('worldImmortals/junior__ru-xian');assert.equal(seat.uid,'u1');assert.equal(seat.avatarVersion,2);
  assert.equal(seat.avatar.hp,seat.avatar.maxHp);assert.equal(seat.avatar.coreCorrectStreak,0);
  assert.equal(seat.avatar.artifactShield,seat.avatar.artifactBattle.openingShield);
});
test('combat equipment effects and core/soul skills actually change damage',()=>{
  const base=player(),db=database(base);const challenger=Combat.snapshot('u1',base),defender=Combat.snapshot('owner',base);
  const initial={runId:'same',round:0,charge:0,style:'assault',challenger,defender};
  const plain=Combat.settle(initial,true,'assault');
  const geared=structuredClone(initial);geared.challenger.artifactBattle.effects=[{type:'equip_true_damage_flat',value:250,artifactName:'試驗法器'}];
  const enhanced=Combat.settle(geared,true,'assault');assert.ok(enhanced.defender.hp<plain.defender.hp);
  const soul=structuredClone(initial);soul.challenger.nascentSoul={bonusDamage:100,attackFlat:0,maxHpFlat:0};
  assert.ok(Combat.settle(soul,true,'assault').defender.hp<plain.defender.hp);
  const sword=structuredClone(initial);sword.challenger.goldenCore={type:'sword',grade:1};
  const results=Array.from({length:30},(_,i)=>Combat.settle({...sword,runId:'core-'+i},true,'assault'));
  assert.ok(results.some(r=>r.activations.some(a=>a.type==='sword')));
});
test('two simultaneous challengers cannot both claim the same unchanged seat',async()=>{
  const db=database(player({stats:{totalScore:1868,attack:100000,maxHp:100000}}));
  db.records.set('users/u2',player({displayName:'第二位挑戰者',stats:{totalScore:1868,attack:100000,maxHp:100000}}));
  for(const uid of ['u1','u2'])await rules.start(db,uid,{role:'ru-xian'},NOW);
  const requests=[];
  for(const uid of ['u1','u2']){
    const expected=await rules.prepareQuestion(db,uid,NOW);
    const q=await rules.commitQuestion(db,uid,expected,{q:'並行挑戰題目何者正確？',correct:'正確',wrong:['錯一','錯二','錯三']},NOW);
    requests.push([uid,{runId:expected.runId,round:0,questionId:q.id,ticket:q.ticket,
      choice:Ticket.readRaidQuestionTicket(q.ticket,{now:NOW}).answerIndex,tactic:'assault'}]);
  }
  const results=await Promise.all(requests.map(([uid,body])=>rules.answer(db,uid,body,NOW)));
  assert.equal(results.filter(r=>r.state.result.claimed).length,1);
  assert.equal(results.filter(r=>r.state.result.code==='changed').length,1);
  assert.equal(db.records.get('worldImmortals/junior__ru-xian').uid,'u1');
});
test('legacy owners retain seats and defend with a snapshot of their saved build',async()=>{
  const db=database();addOwner(db,{legacy:true});const s=await rules.start(db,'u1',{role:'ru-xian'},NOW);
  assert.equal(s.npc,false);assert.equal(s.defender.name,'仙主');assert.equal(s.defender.atk,230);
  assert.equal(db.records.get('worldImmortals/junior__ru-xian').uid,'owner');
});
test('qualification, school cohort and one-seat policy hold at start and settlement',async()=>{
  const low=database(player({stats:{totalScore:1267}}));await assert.rejects(rules.start(low,'u1',{role:'ru-xian'},NOW),/1268/);
  const noGrade=database(player({profile:{}}));await assert.rejects(rules.start(noGrade,'u1',{role:'ru-xian'},NOW),/年級/);
  const db=database(player({profile:{educationLevel:'國小高年級'}}));
  db.records.set('worldImmortals/junior__ru-xian',{uid:'owner',cohort:'junior'});
  const s=await rules.start(db,'u1',{role:'ru-xian'},NOW);assert.equal(s.npc,true);assert.equal(s.level,'國小高年級');
  db.records.get('users/u1').profile.educationLevel='國中三年級';await assert.rejects(turn(db),/年級/);
  const other=database();other.records.set('worldImmortals/junior__fa-xian',{uid:'u1',cohort:'junior'});
  await assert.rejects(rules.start(other,'u1',{role:'ru-xian'},NOW),/一席/);
});
test('mid-fight seat replacement cannot be overwritten by defeating the old avatar',async()=>{
  const db=database(player({stats:{totalScore:1868,attack:100000,maxHp:100000}}));addOwner(db);
  await rules.start(db,'u1',{role:'ru-xian'},NOW);
  db.records.get('worldImmortals/junior__ru-xian').avatarRevision='changed';
  const result=await turn(db);assert.equal(result.state.result.code,'changed');
  assert.equal(db.records.get('worldImmortals/junior__ru-xian').uid,'owner');
});
test('another seat gained during combat blocks a second award',async()=>{
  const db=database(player({stats:{totalScore:1868,attack:100000,maxHp:100000}}));
  await rules.start(db,'u1',{role:'ru-xian'},NOW);
  db.records.set('worldImmortals/junior__fa-xian',{uid:'u1',cohort:'junior'});
  const result=await turn(db);assert.equal(result.state.result.code,'already-other');
  assert.equal(db.records.has('worldImmortals/junior__ru-xian'),false);
});
test('owner can update a fixed offline defender and choose style; strangers cannot',async()=>{
  const db=database();addOwner(db);
  await assert.rejects(rules.configure(db,'u1',{role:'ru-xian',style:'sustain'},NOW),/只有在榜/);
  const saved=await rules.configure(db,'owner',{role:'ru-xian',style:'sustain'},NOW);assert.equal(saved.style,'sustain');
  const seat=db.records.get('worldImmortals/junior__ru-xian');assert.notEqual(seat.avatarRevision,'first');
  db.records.get('users/owner').stats.attack=99999;
  const s=await rules.start(db,'u1',{role:'ru-xian'},NOW);assert.equal(s.defender.atk,230);assert.equal(s.style,'sustain');
  await rules.abandon(db,'u1',{runId:s.runId},NOW);
  const practice=await rules.start(db,'owner',{role:'ru-xian'},NOW);assert.equal(practice.practice,true);
});
test('timeout, defeat and mutual knockout hold the seat; battle HP never writes back',async()=>{
  const db=database();addOwner(db);const original=structuredClone(db.records.get('users/u1'));
  await rules.start(db,'u1',{role:'ru-xian'},NOW);state(db).round=23;state(db).defender.hp=999999;
  const limit=await turn(db);assert.equal(limit.state.result.code,'limit');assert.equal(limit.state.result.claimed,false);
  assert.equal(db.records.get('worldImmortals/junior__ru-xian').defenseWins,1);
  assert.deepEqual(db.records.get('users/u1'),original);
  const challenger=Combat.snapshot('u1',player()),defender=Combat.snapshot('owner',player());
  challenger.hp=0;defender.hp=0;defender.artifactBattle.effects=[{type:'equip_reflect_percent',value:1}];
  const both=Combat.settle({runId:'mutual',round:0,charge:0,style:'assault',challenger,defender},true,'assault');
  assert.equal(both.won,false);assert.equal(both.finished,true);
});
test('expired and abandoned sessions cannot answer or commit a late question',async()=>{
  const db=database();const s=await rules.start(db,'u1',{role:'ru-xian'},NOW);
  const expected=await rules.prepareQuestion(db,'u1',NOW);
  await rules.abandon(db,'u1',{runId:s.runId},NOW);
  await assert.rejects(question(db),/已結束/);
  await assert.rejects(rules.commitQuestion(db,'u1',expected,{q:'舊題',correct:'A',wrong:['B','C','D']},NOW),/已更新/);
  const next=await rules.start(db,'u1',{role:'ru-xian'},NOW);assert.notEqual(next.runId,s.runId);
  const q=await question(db,NOW);
  await assert.rejects(rules.answer(db,'u1',{runId:next.runId,round:0,questionId:q.id,ticket:q.ticket,
    choice:Ticket.readRaidQuestionTicket(q.ticket,{now:NOW}).answerIndex,tactic:'assault'},NOW+3600001),/過期/);
  await assert.rejects(rules.prepareQuestion(db,'u1',NOW+3600001),/已結束/);
  assert.equal(rules.snapshot(state(db),NOW+3600001).status,'expired');
});
test('challenge routes authenticate and the quiz pipeline binds scope and signed answers',async()=>{
  const handler=rules.handler('start',{resolveA:()=>{throw Error('must not read DB');},logger:{error(){}}});
  let status,payload;const res={set(){},status(n){status=n;return this;},json(v){payload=v;}};
  await handler({get:()=>''},res);assert.equal(status,401);assert.equal(payload.ok,false);
  const server=readFileSync('server.js','utf8');assert.match(server,/avatarContext = \{uid,db,\.\.\.await immortalChallenge.prepareQuestion/);
  assert.match(server,/immortalChallenge.commitQuestion/);assert.match(server,/avatarMode \? `avatar:/);
  const browser=readFileSync('d1-browser-api.cjs','utf8');const policy=browser.slice(browser.indexOf("col==='worldImmortals'"),browser.indexOf("col==='marketListings'"));
  assert.doesNotMatch(policy,/challengeScore/);assert.match(policy,/throw fail/);
});

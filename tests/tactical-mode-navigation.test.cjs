'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const register=require('../tactical-combat-api.cjs'),api=register.__test;
const {database}=require('./helpers/tactical-db.cjs');
const now=2000000000000;
const raw=(db,s)=>db.records.get(api.ROOMS+'/'+s.id);
const pointer=(db,uid='u1')=>db.records.get(api.PLAYERS+'/'+uid);
async function legacyTrial(db){
  const s=await api.start(db,'u1',{mode:'pve'},now);
  delete pointer(db).roomIds;
  const expected=await api.prepareQuestion(db,'u1',s.id,now);
  const q=await api.commitQuestion(db,'u1',expected,{q:'一加二等於多少？',correct:'3',wrong:['1','2','4'],exp:'一加二等於三。'},now);
  return {s,q};
}
test('legacy unfinished trial cannot hijack duel entry, matchmaking or scoped synchronization',async()=>{
  const db=database(),{s,q}=await legacyTrial(db),before=structuredClone(raw(db,s));
  assert.equal(await api.state(db,'u1',now,'pvp'),null);
  assert.equal((await api.state(db,'u1',now,'pve')).question.id,q.id);
  const duel=await api.start(db,'u1',{mode:'pvp'},now);
  assert.equal(duel.mode,'pvp');assert.equal(duel.status,'waiting');assert.notEqual(duel.id,s.id);
  assert.deepEqual(raw(db,s),before,'entry must not move actors, erase a question or forfeit the trial');
  assert.deepEqual(pointer(db).roomIds,{pve:s.id,pvp:duel.id});
  assert.equal((await api.state(db,'u1',now,'pvp')).id,duel.id);
  assert.equal((await api.state(db,'u1',now,'pve')).id,s.id);
  assert.equal((await api.start(db,'u1',{mode:'pve'},now)).question.id,q.id);
  assert.equal((await api.start(db,'u1',{mode:'pvp'},now)).id,duel.id);
  const joined=await api.start(db,'u2',{mode:'pvp'},now);
  assert.equal(joined.id,duel.id);assert.equal(joined.status,'active');
  assert.equal((await api.state(db,'u1',now,'pvp')).mode,'pvp');
  assert.equal((await api.start(db,'u1',{mode:'pve'},now)).id,s.id);
});
test('room-code join works while both players have unfinished trials',async()=>{
  const db=database(),guest=await legacyTrial(db),hostTrial=await api.start(db,'u2',{mode:'pve'},now);
  const host=await api.start(db,'u2',{mode:'pvp'},now);
  const duel=await api.start(db,'u1',{mode:'pvp',code:host.id.replace('arena-','')},now);
  assert.equal(duel.id,host.id);assert.equal(duel.mode,'pvp');assert.equal(duel.actors.length,2);
  for(const uid of ['u1','u2']){
    assert.equal((await api.state(db,uid,now,'pvp')).id,duel.id);
    assert.equal((await api.start(db,uid,{mode:'pvp'},now)).id,duel.id);
  }
  assert.equal((await api.start(db,'u1',{mode:'pve'},now)).question.id,guest.q.id);
  assert.equal((await api.start(db,'u2',{mode:'pve'},now)).id,hostTrial.id);
});
test('a legacy waiting or active duel survives entering and resuming a trial',async()=>{
  for(const active of [false,true]){
    const db=database(),duel=await api.start(db,'u1',{mode:'pvp'},now);
    if(active)await api.start(db,'u2',{mode:'pvp',code:duel.id},now);
    delete pointer(db).roomIds;
    assert.equal(await api.state(db,'u1',now,'pve'),null);
    const before=structuredClone(raw(db,duel)),trial=await api.start(db,'u1',{mode:'pve'},now);
    assert.equal(trial.mode,'pve');assert.deepEqual(raw(db,duel),before);
    assert.equal((await api.start(db,'u1',{mode:'pvp'},now)).id,duel.id);
    assert.equal((await api.state(db,'u1',now,'pve')).id,trial.id);
    assert.equal((await api.state(db,'u1',now,'pvp')).id,duel.id);
  }
});
test('trial introductions and exactly-once stage rewards use the trial pointer while a duel is waiting',async()=>{
  const db=database(),trial=await api.start(db,'u1',{mode:'pve'},now),duel=await api.start(db,'u1',{mode:'pvp'},now);
  assert.equal(pointer(db).roomId,duel.id);
  const intro=await api.acknowledgeEnemy(db,'u1',{roomId:trial.id,species:0});assert.deepEqual(intro.newEnemies,[]);
  const s=raw(db,trial);s.blocks=[];Object.assign(s.actors[0],{x:1,y:3,stamina:4,correct:1,answered:1});
  Object.assign(s.actors[1],{x:2,y:3,hp:1});
  const command={roomId:s.id,revision:s.revision,type:'attack',x:2,y:3,requestId:'mode-trial-victory'};
  const win=await api.command(db,'u1',command,now),retry=await api.command(db,'u1',command,now);
  assert.equal(win.nextStage,2);assert.equal(retry.nextStage,2);assert.equal(pointer(db).trial.stage,2);
  assert.equal(db.records.get('users/u1').stats.gold,35);
  assert.equal((await api.state(db,'u1',now,'pvp')).id,duel.id);
  const next=await api.start(db,'u1',{mode:'pve'},now);assert.equal(next.trial.stage,2);assert.notEqual(next.id,trial.id);
  assert.equal((await api.state(db,'u1',now,'pvp')).id,duel.id);
});
test('simultaneous trial and duel entry retain both mode pointers',async()=>{
  const db=database(),[trial,duel]=await Promise.all([api.start(db,'u1',{mode:'pve'},now),api.start(db,'u1',{mode:'pvp'},now)]);
  assert.equal(trial.mode,'pve');assert.equal(duel.mode,'pvp');
  assert.deepEqual(pointer(db).roomIds,{pve:trial.id,pvp:duel.id});
});
test('state HTTP route forwards the requested mode and rejects invalid modes',async()=>{
  const db=database(),trial=await api.start(db,'u1',{mode:'pve'});let handler;
  register({get(path,fn){if(path==='/api/tactical/state')handler=fn;},post(){}},{resolve:()=>({db}),verify:async()=> 'u1'});
  async function request(mode){const response={statusCode:200,set(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
    await handler({query:{mode}},response);return response;}
  assert.equal((await request('pvp')).body.state,null);
  assert.equal((await request('pve')).body.state.id,trial.id);
  assert.equal((await request('')).body.state.id,trial.id,'legacy clients may still read their last-created room');
  assert.equal((await request('invalid')).statusCode,400);
});

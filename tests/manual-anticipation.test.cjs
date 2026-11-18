'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Catalog=require('../public/cultivation/manual-rules.js');
const js=fs.readFileSync(path.join(__dirname,'../public/cultivation/manual-anticipation.js'),'utf8');
const {manualAnticipation,renderManualAnticipation,manualRoomExp,
  battleBreakthroughEstimate,renderBattleBreakthroughEstimate}=vm.runInNewContext(
  js.replaceAll('export function ','function ')+
  '\n({manualAnticipation,renderManualAnticipation,manualRoomExp,battleBreakthroughEstimate,renderBattleBreakthroughEstimate})',
  {},{filename:'manual-anticipation.js'});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
const book=(exp,options={})=>{
  const mastery=Catalog.mastery(exp);
  return {id:'sword-wind',name:'流風劍訣',school:'sword',owned:true,
    ...mastery,skills:[
      {id:'wind-slash',name:'流風斬',levelRequired:1,unlocked:true,
        mastered:true,realmReady:true,realmName:'煉氣'},
      {id:'wind-step',name:'突進橫斬',levelRequired:5,
        unlocked:false,mastered:mastery.level>=5,realmReady:false,realmName:'築基'},
      {id:'wind-thousand',name:'遠線破擊',levelRequired:10,
        unlocked:false,mastered:mastery.level>=10,realmReady:false,realmName:'金丹'}
    ],...options};
};
const hint=(xp,opts={})=>manualAnticipation(book(xp,opts),Catalog.totalExpForLevel);
const room=(earned,options={})=>({
  id:'arena-stamina-test',revision:2,mode:'pve',status:'active',
  manualExp:{u1:{'sword-wind':earned}},manualKills:{u1:{}},...options
});

test('milestone thresholds exactly match the canonical server mastery formula',()=>{
  assert.equal(Catalog.totalExpForLevel(5),280);
  assert.equal(Catalog.totalExpForLevel(10),1080);
  assert.equal(hint(0).targetExp,280);
  assert.equal(hint(280).targetLevel,5);
});

test('progress rises from training to near to imminent without unlocking skills',()=>{
  assert.equal(hint(208).status,'training');
  assert.equal(hint(209).status,'near');
  assert.equal(hint(251).status,'imminent');
  assert.equal(hint(251).remaining,29);
  assert.equal(hint(251).targetLevel,5);
  assert.equal(hint(251).percent,90);
  assert.match(renderManualAnticipation(hint(251),esc),/突破在即/);
  assert.match(renderManualAnticipation(hint(251),esc),/功法等級達標後/);
});

test('mastery threshold is not the same as the player-realm unlock',()=>{
  const blocked=hint(280);
  assert.equal(blocked.status,'realm');
  assert.equal(blocked.targetLevel,5);
  assert.equal(blocked.remaining,0);
  assert.match(renderManualAnticipation(blocked,esc),/仍需達到修士 築基境/);
  assert.doesNotMatch(renderManualAnticipation(blocked,esc),/已領悟/);
});

test('after real second-skill unlock the next milestone changes to level 10',()=>{
  const original=book(880);
  original.skills[1].unlocked=true;
  const r=manualAnticipation(original,Catalog.totalExpForLevel);
  assert.equal(r.targetLevel,10);
  assert.equal(r.status,'near');
  assert.equal(r.percent,75);
  assert.equal(r.remaining,200);
  const r2=manualAnticipation({...original,...Catalog.mastery(1000)},Catalog.totalExpForLevel);
  assert.equal(r2.status,'imminent');
  assert.equal(r2.remaining,80);
});

test('level 10 with blocked realm remains blocked, not fully learned',()=>{
  const src=book(1080);
  src.skills[1].unlocked=true;
  const r=manualAnticipation(src,Catalog.totalExpForLevel);
  assert.equal(r.status,'realm');
  assert.equal(r.targetLevel,10);
  src.skills[2].unlocked=true;
  assert.equal(manualAnticipation(src,Catalog.totalExpForLevel),null);
});

test('untrusted or incomplete progress is never guessed',()=>{
  assert.equal(manualAnticipation(null,Catalog.totalExpForLevel),null);
  assert.equal(manualAnticipation({skills:[]},Catalog.totalExpForLevel),null);
  assert.equal(manualAnticipation(book(250),null),null);
  assert.equal(manualAnticipation({...book(250),exp:undefined,totalExp:undefined},
    Catalog.totalExpForLevel),null);
});

test('battle ledger totals contain only the authenticated player and known book',()=>{
  const r=room(45,{manualKills:{u1:{'sword-wind':2}},
    manualExp:{u1:{'sword-wind':45},u2:{'sword-wind':1000}}});
  assert.equal(manualRoomExp(r,'u1','sword-wind',Catalog),145);
  assert.equal(manualRoomExp(r,'u1','unknown',Catalog),0);
  assert.equal(manualRoomExp(r,'u2','sword-wind',Catalog),1000);
  assert.equal(manualRoomExp({...r,mode:'pvp'},'u1','sword-wind',Catalog),0);
});

test('battle gauge adds only ledger growth AFTER a same-room mastery snapshot',()=>{
  const initial=book(235),snapshot={library:[initial]};
  const baseline={uid:'u1',roomId:'arena-stamina-test',ledger:{'sword-wind':20}};
  const delta={books:[{id:'sword-wind',earned:32}]};
  const result=battleBreakthroughEstimate(snapshot,room(52),'u1',delta,Catalog,baseline);
  assert.equal(result.status,'imminent');
  assert.equal(result.projectedGain,32);
  assert.equal(result.confirmedExp,235);
  assert.equal(result.estimatedExp,267);
  assert.equal(result.remaining,13);
  const html=renderBattleBreakthroughEstimate(result,esc);
  assert.match(html,/本場僅為試算/);
  assert.match(html,/實際 EXP 與領悟以伺服器結算為準/);
  assert.doesNotMatch(html,/已領悟/);
});

test('provisional gauge cannot use an older room, another user or unknown books',()=>{
  const b=book(260),snapshot={library:[b]},delta={books:[{id:b.id,earned:20}]};
  const baseline={uid:'u1',roomId:'arena-stamina-test',ledger:{'sword-wind':0}};
  assert.equal(battleBreakthroughEstimate(snapshot,room(30),'u2',delta,Catalog,baseline),null);
  assert.equal(battleBreakthroughEstimate(snapshot,
    room(30,{id:'arena-other'}),'u1',delta,Catalog,baseline),null);
  assert.equal(battleBreakthroughEstimate(snapshot,room(30),'u1',
    {books:[{id:'non-owned',earned:30}]},Catalog,baseline),null);
  assert.equal(battleBreakthroughEstimate({library:[]},room(30),'u1',delta,Catalog,baseline),null);
});

test('the projection never modifies authoritative book or battle snapshots',()=>{
  const b=book(240),snapshot={library:[b]},battle=room(32);
  const previous=JSON.stringify([snapshot,battle]);
  const baseline={uid:'u1',roomId:battle.id,ledger:{'sword-wind':10}};
  battleBreakthroughEstimate(snapshot,battle,'u1',{books:[{id:b.id,earned:22}]},
    Catalog,baseline);
  assert.equal(JSON.stringify([snapshot,battle]),previous);
});

test('untrusted skill titles and realm text are escaped in both views',()=>{
  const b=book(260);b.skills[1].name='<img src=x onerror=alert(1)>';
  b.skills[1].realmName='<svg onload=alert(2)>';
  const r=manualAnticipation(b,Catalog.totalExpForLevel);
  const html=renderManualAnticipation(r,esc);
  assert.doesNotMatch(html,/<img src=x onerror/);
  assert.match(html,/&lt;img src=x/);
  b.skills[1].mastered=true;
  const r2=manualAnticipation(b,Catalog.totalExpForLevel);
  const html2=renderBattleBreakthroughEstimate(r2,esc);
  assert.doesNotMatch(html2,/<svg onload/);
  assert.match(html2,/&lt;svg onload/);
});

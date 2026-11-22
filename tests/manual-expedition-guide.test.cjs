'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Catalog=require('../public/cultivation/manual-rules.js');
const base=path.join(__dirname,'../public/cultivation');
const strip=src=>src.replace(/^import\s+.*;\s*$/gm,'')
  .replace(/^export function /gm,'function ');
const combined=['manual-anticipation.js','manual-expedition-guide.js']
  .map(name=>strip(fs.readFileSync(path.join(base,name),'utf8'))).join('\n');
const {nextManualExpedition,renderManualExpedition}=vm.runInNewContext(
  combined+'\n({nextManualExpedition,renderManualExpedition})',{});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
const opts={esc,bookArt:id=>'/assets/books/'+id+'.png'};
const state=(xp=250,overrides={})=>{
  const s=Catalog.publicState({school:'sword',books:{'sword-wind':{exp:xp}},
    equipped:['wind-slash']},1);
  return {...s,trialStage:1,...overrides};
};
const guide=(xp,overrides={})=>nextManualExpedition(state(xp,overrides),'sword-wind',Catalog);

test('server-canonical stage-1 realm gives 20 EXP per manual killing blow',()=>{
  const g=guide(250);
  assert.equal(g.stage,1);
  assert.equal(g.enemyRealm,'煉氣');
  assert.equal(g.xpPerKill,20);
  assert.equal(g.remaining,30);
  assert.equal(g.estimatedKills,2);
  assert.equal(g.action,'battle');
  assert.match(renderManualExpedition(g,opts),/第 1 關/);
  assert.match(renderManualExpedition(g,opts),/前往問道試煉/);
});

test('the same next level at stage 5 predicts 35 XP per kill and one kill',()=>{
  const g=guide(250,{trialStage:5});
  assert.equal(g.enemyRealm,'築基');
  assert.equal(g.xpPerKill,Catalog.expForBeast(5));
  assert.equal(g.estimatedKills,1);
  assert.match(renderManualExpedition(g,opts),/\+35/);
  assert.match(renderManualExpedition(g,opts),/皆由此武器完成擊殺估算/);
});

test('stage 10 uses 55 EXP and stage 20 uses 85, without pretending users can select stage',()=>{
  assert.equal(guide(250,{trialStage:10}).xpPerKill,55);
  assert.equal(guide(250,{trialStage:20}).xpPerKill,85);
  assert.match(renderManualExpedition(guide(250),opts),/無法自行指定靈獸境界/);
  assert.match(renderManualExpedition(guide(250),opts),/實際收穫依出現的靈獸與伺服器結算為準/);
});

test('wrong active loadout cannot be mistaken for having the selected manual equipped',()=>{
  const s=state(250);delete s.weaponIds;
  s.loadouts=[{name:'劍法',skillIds:['wind-slash']},
    {name:'備用',skillIds:[]}];
  s.activeLoadout=1;
  const g=nextManualExpedition(s,'sword-wind',Catalog);
  assert.equal(g.path,'needs-loadout');
  assert.equal(g.action,'loadout');
  assert.equal(g.activeLoadoutName,'備用');
  const html=renderManualExpedition(g,opts);
  assert.match(html,/前往裝備武器/);
  assert.doesNotMatch(html,/data-manual-expedition-action="battle"/);
});

test('a correct active loadout remains ready even if a different preset exists',()=>{
  const s=state(250,{weaponIds:undefined,activeLoadout:0,loadouts:[
    {name:'主戰劍修',skillIds:['wind-slash']},
    {name:'另一組',skillIds:[]}
  ]});
  const g=nextManualExpedition(s,'sword-wind',Catalog);
  assert.equal(g.path,'ready');
  assert.equal(g.activeSkillName,'流風斬');
  assert.equal(g.activeLoadoutName,'主戰劍修');
});

test('mastered second skill points to the third mastery threshold independent of player realm',()=>{
  const g=guide(280);
  assert.equal(g.targetLevel,10);
  assert.equal(g.remaining,800);
  assert.equal(g.estimatedKills,40);
  assert.doesNotMatch(g.nextGoal,/境界/);
  assert.match(renderManualExpedition(g,opts),/Lv. 10/);
});

test('owned book without any learned skills redirects to skill prerequisites',()=>{
  const s=state(250);
  s.library[0].skills=s.library[0].skills.map(skill=>({...skill,unlocked:false}));
  s.equipped=[];
  s.loadouts=[{name:'配置 1',skillIds:[]}];
  const g=nextManualExpedition(s,'sword-wind',Catalog);
  assert.equal(g.path,'locked');
  assert.equal(g.action,'skills');
  assert.match(renderManualExpedition(g,opts),/查看招式解鎖條件/);
});

test('unowned manual identifiers and missing state never make guide cards',()=>{
  assert.equal(nextManualExpedition(null,'sword-wind',Catalog),null);
  assert.equal(nextManualExpedition({library:[]},'sword-wind',Catalog),null);
  assert.equal(nextManualExpedition(state(250,{library:[]}),null,Catalog),null);
  const s=state(250);s.library[0].owned=false;
  assert.equal(nextManualExpedition(s,'sword-wind',Catalog),null);
});

test('all skills learned and level 10 avoids fabricated next goal',()=>{
  const s=state(1080);
  s.library[0].skills=s.library[0].skills.map(skill=>({...skill,unlocked:true,mastered:true,realmReady:true}));
  const g=nextManualExpedition(s,'sword-wind',Catalog);
  assert.equal(g.targetLevel,null);
  assert.equal(g.estimatedKills,null);
  assert.match(g.nextGoal,/可繼續修煉至 Lv. 20/);
});

test('markup escapes untrusted names and rendering never changes server data',()=>{
  const s=state(250,{trialStage:5});delete s.weaponIds;
  s.library[0].name='<svg onload=alert(1)>';
  s.loadouts=[{name:'<img src=x onerror=alert(1)>',skillIds:['wind-slash']}];
  s.activeLoadout=0;
  const prior=JSON.stringify(s);
  const g=nextManualExpedition(s,'sword-wind',Catalog);
  const html=renderManualExpedition(g,opts);
  assert.doesNotMatch(html,/&lt;svg onload=/);
  assert.match(html,/&lt;img src=x onerror=/);
  assert.doesNotMatch(html,/manual-expedition-cover/);
  assert.match(html,/manual-expedition-more/);
  assert.match(html,/查看擊殺估算與出戰條件/);
  assert.doesNotMatch(html,/<svg onload=/);
  assert.doesNotMatch(html,/<img src=x onerror=/);
  assert.equal(JSON.stringify(s),prior);
});

test('source stage from trusted manuals endpoint, not user-chosen controls',async()=>{
  const {database}=require('./helpers/tactical-db.cjs');
  const service=require('../tactical-combat-api.cjs').__test;
  const db=database();
  const user=db.records.get('users/u1');
  user.tacticalTrialV1={version:1,stage:10,seed:'a'.repeat(32)};
  db.records.set('users/u1',user);
  const official=await service.manualsState(db,'u1');
  assert.equal(official.trialStage,10);
  assert.equal(official.seed,undefined);
  user.tacticalTrialV1={version:1,stage:999999999};
  db.records.set('users/u1',user);
  assert.equal((await service.manualsState(db,'u1')).trialStage,1000000);
  delete user.tacticalTrialV1;
  db.records.set('users/u1',user);
  assert.equal((await service.manualsState(db,'u1')).trialStage,1);
});

test('the compact trial strip has one CTA, no repeated book cover or next-goal panel',()=>{
  const html=renderManualExpedition(guide(250),opts);
  assert.equal((html.match(/data-manual-expedition-action=/g)||[]).length,1);
  assert.equal((html.match(/manual-expedition-more/g)||[]).length,1);
  assert.match(html,/第 1 關/);
  assert.match(html,/武器擊殺/);
  assert.doesNotMatch(html,/manual-expedition-book-copy/);
  assert.doesNotMatch(html,/manual-expedition-cover/);
  assert.doesNotMatch(html,/manual-expedition-main/);
  assert.match(html,/<details class="manual-expedition-more">/);
});

test('fully maxed Lv20 books with all three skills learned have no future level targets',()=>{
  const s=state(4180);
  s.library[0].skills=s.library[0].skills.map(skill=>({...skill,unlocked:true,mastered:true,realmReady:true}));
  const g=nextManualExpedition(s,'sword-wind',Catalog);
  assert.equal(g.targetLevel,null);
  assert.equal(g.estimatedKills,null);
  assert.match(g.nextGoal,/武器已達 Lv. 20/);
});

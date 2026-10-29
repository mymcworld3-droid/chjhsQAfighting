'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./helpers/d1-db.cjs');
const Rules=require('../public/cultivation/spirit-farm-rules.js');
const Farm=require('../spirit-farm-api.cjs').__test;
const register=require('../spirit-farm-api.cjs');
const {mayRead,executeCommit}=require('../d1-browser-api.cjs');
const {Codec}=require('../d1-store.cjs');
let serial=0;
const request=(revision,action,extra={})=>({requestId:'farm-request-'+String(++serial).padStart(8,'0'),expectedRevision:revision,action,...extra});
async function fixture({score=28,random=()=>.99}={}){
  const {db}=setup();let time=Date.parse('2026-10-29T06:00:00Z');
  const user={uid:'u1',stats:{gold:123,totalScore:score},materialSystem:{inventory:{'qi-spirit-iron':4}}};await db.doc('users/u1').set(user);
  const service=Farm.createService({db,now:()=>time,random,uuid:()=> 'plant-'+String(++serial).padStart(8,'0')});
  const raw=async()=> (await db.doc('spiritFarms/u1').get()).data();
  const f={db,service,user,raw,get time(){return time;},set time(x){time=x;},async view(){return (await service.view('u1')).farm;},async act(action,extra={}){const farm=await f.view();return service.act('u1',request(farm.revision,action,extra));}};
  await service.view('u1');return f;
}
async function plant(f,index=0,cropId='jade'){return f.act('plant',{index,cropId});}
async function care(f,action,index=0){const farm=await f.view();return f.service.act('u1',request(farm.revision,action,{index,plantId:farm.plots[index].id}));}

test('new account receives one three-by-three garden, starter seeds and three open plots; opening again gives no extra resources',async()=>{
  const f=await fixture(),a=await f.view(),b=await f.view();assert.equal(a.plots.length,9);assert.equal(a.openPlots,3);assert.equal(a.plots.filter(x=>x.locked).length,6);
  assert.deepEqual(a.seeds,{jade:6,amber:3,moon:1});assert.equal(a.energy,6);assert.deepEqual(a,b);
  assert.deepEqual((await f.db.doc('users/u1').get()).data(),f.user);
});
test('plant response retry and double click spend exactly one seed, while changed use of an ID is rejected',async()=>{
  const f=await fixture(),op=request(0,'plant',{index:0,cropId:'jade'});
  const [a,b]=await Promise.all([f.service.act('u1',op),f.service.act('u1',op)]);
  assert.equal(a.farm.seeds.jade,5);assert.equal(b.farm.seeds.jade,5);assert.equal(b.replayed,true);assert.equal(a.farm.plots[0].id,b.farm.plots[0].id);
  await assert.rejects(f.service.act('u1',{...op,cropId:'moon'}),/其他田務/);
});
test('parallel different commands with the same revision cannot spend the same state twice',async()=>{
  const f=await fixture();const out=await Promise.allSettled([f.service.act('u1',request(0,'plant',{index:0,cropId:'jade'})),f.service.act('u1',request(0,'plant',{index:1,cropId:'moon'}))]);
  assert.equal(out.filter(x=>x.status==='fulfilled').length,1);assert.equal((await f.view()).plots.filter(x=>x.id).length,1);
});
test('offline growth uses absolute server time and mature crops wait indefinitely without spoilage',async()=>{
  const f=await fixture(),a=await plant(f);assert.equal(a.farm.plots[0].readyAt,f.time+10*60000);
  f.time+=10*60000-1;await assert.rejects(care(f,'harvest'),/尚未成熟/);
  f.time+=1;assert.equal((await f.view()).plots[0].ready,true);f.time+=30*86400000;
  const b=await care(f,'harvest');assert.equal(b.result.items[0].quantity,2);assert.equal(b.farm.plots[0].empty,true);assert.equal(b.farm.seeds.jade,6);
});
test('watering and fertilizer each apply once, reduce original growth time, and use only the documented energy',async()=>{
  const f=await fixture();await plant(f);const t=f.time;
  const a=await care(f,'water');assert.equal(a.farm.energy,6);assert.equal(a.farm.plots[0].readyAt,t+9*60000);await assert.rejects(care(f,'water'),/已灌溉/);
  const b=await care(f,'fertilize');assert.equal(b.farm.energy,4);assert.equal(b.farm.plots[0].readyAt,t+7.5*60000);await assert.rejects(care(f,'fertilize'),/已施肥/);
  f.time=b.farm.plots[0].readyAt;const harvest=await care(f,'harvest');assert.equal(harvest.result.items[0].quality,'良品');assert.equal(harvest.result.items[0].quantity,3);
});
test('bulk planting fills only open empty plots, caps at available seeds, and keeps each plant and channel bonus independent',async()=>{
  const f=await fixture();await plant(f,1,'amber');
  await f.db.doc('spiritFarms/u1').update({openPlots:6,channel:true,seeds:{jade:3,amber:2,moon:1}});
  const first=await f.act('plant-all',{cropId:'jade',quantity:999,index:8,readyAt:0});
  assert.deepEqual(first.result.indices,[0,2,3]);assert.equal(first.farm.seeds.jade,0);
  assert.equal(first.farm.plots[1].cropId,'amber');assert(first.farm.plots[4].empty);assert(first.farm.plots[6].locked);
  assert.equal(new Set(first.farm.plots.filter(p=>p.id).map(p=>p.id)).size,4);
  assert.equal(first.farm.plots[0].readyAt,f.time+450000);assert.equal(first.farm.plots[2].readyAt,f.time+600000);
  assert.equal(first.farm.plots[3].watered,true);assert.equal(first.farm.plots[2].watered,false);
  await assert.rejects(f.act('plant-all',{cropId:'jade'}),/種子不足/);
  const second=await f.act('plant-all',{cropId:'amber'});assert.deepEqual(second.result.indices,[4,5]);
  await assert.rejects(f.act('plant-all',{cropId:'moon'}),/空田/);
});
test('bulk planting replay and concurrent commands spend seeds only once',async()=>{
  const f=await fixture(),op=request(0,'plant-all',{cropId:'jade'});
  const [a,b]=await Promise.all([f.service.act('u1',op),f.service.act('u1',op)]);
  assert.deepEqual(a.farm.plots,b.farm.plots);assert.equal(b.replayed,true);assert.equal(b.farm.seeds.jade,3);
  await assert.rejects(f.service.act('u1',{...op,cropId:'moon'}),/其他田務/);
  const g=await fixture(),out=await Promise.allSettled([g.service.act('u1',request(0,'plant-all',{cropId:'jade'})),g.service.act('u1',request(0,'plant-all',{cropId:'amber'}))]);
  assert.equal(out.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await g.view()).plots.filter(p=>p.id).length,3);
});
test('batch care matches individual care and never recharges completed, mature, empty or locked plots',async()=>{
  const f=await fixture({random:()=>.05});await f.act('plant-all',{cropId:'jade'});
  await care(f,'water',0);await care(f,'fertilize',0);await care(f,'purify',0);
  await f.db.doc('spiritFarms/u1').update({energy:10});
  const water=await f.act('water-all');assert.deepEqual(water.result.indices,[1,2]);assert.equal(water.farm.energy,10);
  const farm=await f.view(),op=request(farm.revision,'fertilize-all'),fert=await f.service.act('u1',op);
  assert.deepEqual(fert.result.indices,[1,2]);assert.equal(fert.result.energySpent,4);assert.equal(fert.farm.energy,6);
  const retry=await f.service.act('u1',op);assert.equal(retry.farm.energy,6);assert.equal(retry.replayed,true);
  const pure=await f.act('purify-all');assert.deepEqual(pure.result.indices,[1,2]);assert.equal(pure.farm.energy,4);
  assert(pure.farm.plots.slice(0,3).every(p=>p.watered&&p.fertilized&&p.cleared&&!p.pest));
  assert(pure.farm.plots.slice(0,3).every(p=>p.readyAt===f.time+450000));
  await assert.rejects(f.act('water-all'),/沒有需要灌溉/);await assert.rejects(f.act('fertilize-all'),/沒有需要施肥/);
  await assert.rejects(f.act('purify-all'),/沒有需要驅蟲/);
  f.time+=450000;await assert.rejects(f.act('fertilize-all'),/沒有需要/);
});
test('insufficient energy leaves the entire care batch unchanged while free watering is still available',async()=>{
  const f=await fixture({random:()=>.05});await f.act('plant-all',{cropId:'jade'});
  await f.db.doc('spiritFarms/u1').update({energy:2});const before=await f.raw();
  await assert.rejects(f.act('fertilize-all'),/靈氣不足/);assert.deepEqual(await f.raw(),before);
  await assert.rejects(f.act('purify-all'),/靈氣不足/);assert.deepEqual(await f.raw(),before);
  assert.equal((await f.act('water-all')).farm.energy,2);
});
test('care batch skips crops that matured since its preview and charges only the remaining eligible plants',async()=>{
  const f=await fixture();await f.act('plant-all',{cropId:'jade'});
  await f.db.doc('spiritFarms/u1').update({'plots':(await f.raw()).plots.map((p,i)=>p&&({...p,readyAt:f.time+(i===0?10:600000)}))});
  const before=await f.view(),preview=Rules.workPlan(before,f.time);assert.equal(preview.fertilizeCost,6);
  f.time+=11;const result=await f.service.act('u1',request(before.revision,'fertilize-all'));
  assert.deepEqual(result.result.indices,[1,2]);assert.equal(result.result.energySpent,4);
  assert.equal(result.farm.plots[0].fertilized,false);assert.equal(result.farm.energy,2);
});
test('public and stored work plans agree, and failed batch writes roll back the whole batch',async()=>{
  const f=await fixture();await f.act('plant-all',{cropId:'jade'});
  assert.deepEqual(Rules.workPlan(await f.raw(),f.time,'jade'),Rules.workPlan(await f.view(),f.time,'jade'));
  const before=await f.raw(),original=f.db.runTransaction.bind(f.db);
  f.db.runTransaction=worker=>original(async tx=>{const save=tx.set.bind(tx);tx.set=(ref,value)=>{if(ref.path.startsWith('spiritFarms/'))throw Error('unavailable');return save(ref,value);};return worker(tx);});
  await assert.rejects(f.service.act('u1',request(before.revision,'fertilize-all')),/unavailable/);
  assert.deepEqual(await f.raw(),before);
});
test('pests are optional care and do not reduce an unattended plant below its base harvest',async()=>{
  const f=await fixture({random:()=>.05});await plant(f);assert.equal((await f.view()).plots[0].pest,true);
  f.time+=600000;const result=await care(f,'harvest');assert.equal(result.result.items[0].quantity,2);
  await plant(f);const before=(await f.view()).energy;const treated=await care(f,'purify');assert.equal(treated.farm.energy,before-1);assert.equal(treated.farm.plots[0].pest,false);assert.equal(treated.farm.plots[0].cleared,true);
  await assert.rejects(care(f,'purify'),/沒有靈蟲/);
});
test('harvest-all computes companion quality before clearing any plant and pays once on replay',async()=>{
  const f=await fixture();await plant(f,0,'jade');await plant(f,1,'amber');await plant(f,2,'moon');
  for(const i of [0,1,2])await care(f,'water',i);f.time+=180*60000;
  const farm=await f.view(),op=request(farm.revision,'harvest-all'),a=await f.service.act('u1',op);
  assert.equal(a.result.items[0].quality,'良品');assert.equal(a.result.items[1].quality,'良品');assert.equal(a.result.items[0].quantity,3);assert.equal(a.result.items[1].quantity,4);
  const b=await f.service.act('u1',op);assert.deepEqual(b.farm.harvest,a.farm.harvest);assert.equal(b.replayed,true);
});
test('mutation is fixed when planted, survives reload, and grants an extra seed and collection count',async()=>{
  const f=await fixture({random:()=>0});await plant(f,0,'moon');const hidden=(await f.raw()).plots[0].mutationRoll;
  assert.equal(hidden,0);const view=await f.view();assert(!('mutationRoll' in view.plots[0]));assert(!('operations' in view));
  f.time+=180*60000;const result=await care(f,'harvest');assert.equal(result.result.items[0].quality,'變異');assert.equal(result.farm.mutations.moon,1);assert.equal(result.farm.seeds.moon,2);
});
test('water channel reduces left-column growth by 25%, including planted crops, without repeatedly boosting them',async()=>{
  const f=await fixture();await plant(f,0);await plant(f,1);
  await f.db.doc('spiritFarms/u1').update({harvest:{jade:4,amber:2,moon:0}});const before=f.time;
  const a=await f.act('channel');assert.equal(a.farm.channel,true);assert.equal(a.farm.plots[0].readyAt,before+7.5*60000);assert.equal(a.farm.plots[1].readyAt,before+10*60000);assert.equal(a.farm.plots[0].watered,true);
  await assert.rejects(f.act('channel'),/已修復/);f.time+=10*60000;await care(f,'harvest',0);
  const b=await plant(f,0);assert.equal(b.farm.plots[0].readyAt,f.time+7.5*60000);assert.equal(b.farm.plots[0].channelBonus,true);
});
test('all nine plots require two crop-funded expansions; construction consumes neither gold nor cultivation',async()=>{
  const f=await fixture();await assert.rejects(plant(f,3),/尚未開墾/);await assert.rejects(f.act('expand'),/收成不足/);
  await f.db.doc('spiritFarms/u1').update({harvest:{jade:18,amber:8,moon:2}});assert.equal((await f.act('expand')).farm.openPlots,6);assert.equal((await f.act('expand')).farm.openPlots,9);
  await assert.rejects(f.act('expand'),/全部開墾/);assert.deepEqual((await f.db.doc('users/u1').get()).data().stats,f.user.stats);
});
test('seed exchange uses crop proceeds and harvest returns seed; no client prices or quantities can mint materials',async()=>{
  const f=await fixture();await f.db.doc('spiritFarms/u1').update({harvest:{jade:12,amber:3,moon:0}});
  const a=await f.act('seed',{cropId:'moon',quantity:9999,cost:0});assert.equal(a.farm.seeds.moon,2);assert.equal(a.farm.harvest.amber,0);
  const b=await f.act('exchange',{cropId:'jade',quantity:99999,materialId:'raid-refine-key-iii'});assert.equal(b.materialInventory['qi-spirit-wood'],1);assert.equal(b.materialInventory['raid-refine-key-iii'],undefined);assert.equal(b.materialInventory['qi-spirit-iron'],4);assert.equal(b.farm.harvest.jade,0);
});
test('material exchange honors attained realm, credits the existing inventory atomically, and never awards combat stats',async()=>{
  const f=await fixture({score:0});await f.db.doc('spiritFarms/u1').update({harvest:{jade:0,amber:12,moon:12}});await assert.rejects(f.act('exchange',{cropId:'amber'}),/築基/);await assert.rejects(f.act('exchange',{cropId:'moon'}),/金丹/);
  await f.db.doc('users/u1').update({trainingAccess:{version:1,highestRealmScore:28}});const a=await f.act('exchange',{cropId:'moon'});assert.equal(a.materialInventory['golden-lightning-wood'],1);
  assert.deepEqual((await f.db.doc('users/u1').get()).data().stats,f.user.stats);
});
test('a write failure rolls back harvest spending and material credit together',async()=>{
  const f=await fixture();await f.db.doc('spiritFarms/u1').update({harvest:{jade:12,amber:0,moon:0}});const before=await f.raw();
  const original=f.db.runTransaction.bind(f.db);f.db.runTransaction=worker=>original(async tx=>{const save=tx.set.bind(tx);tx.set=(ref,value)=>{if(ref.path.startsWith('spiritFarms/'))throw Error('unavailable');return save(ref,value);};return worker(tx);});
  await assert.rejects(f.service.act('u1',request(0,'exchange',{cropId:'jade'})),/unavailable/);assert.deepEqual(await f.raw(),before);assert.deepEqual((await f.db.doc('users/u1').get()).data().materialSystem.inventory,f.user.materialSystem.inventory);
});
test('stale plot IDs, occupied soil, forged time and invalid actions cannot change resources',async()=>{
  const f=await fixture();await plant(f);const before=await f.raw();
  for(const body of [request(before.revision,'plant',{index:0,cropId:'jade'}),request(before.revision,'harvest',{index:0,plantId:'different-plant',now:f.time+1e12}),request(before.revision,'harvest',{index:0,plantId:before.plots[0].id,now:f.time+1e12}),request(before.revision,'plant',{index:8,cropId:'moon'}),request(before.revision,'mint',{reward:9999})])await assert.rejects(f.service.act('u1',body));
  assert.deepEqual(await f.raw(),before);
});
test('older evicted request IDs still fail their stale revision; the bounded history cannot be used for replay minting',async()=>{
  const f=await fixture();const op=request(0,'plant',{index:0,cropId:'jade'});await f.service.act('u1',op);
  await f.db.doc('spiritFarms/u1').update({revision:80,operations:[]});await assert.rejects(f.service.act('u1',op),/新的變化/);assert.equal((await f.view()).seeds.jade,5);
});
test('study energy counts saved correct and incorrect answers once each, excludes skips, future dates and another account',async()=>{
  const f=await fixture();const logs=[['a',{question:'Q1',isCorrect:true,userIdx:0}],['b',{question:'Q2',isCorrect:false,userIdx:1}],['dup',{question:'Q1',isCorrect:false,userIdx:2}],['skip',{question:'Q3',isCorrect:false,userIdx:-1}],['future',{question:'Q4',isCorrect:true,userIdx:0,timestamp:new Date(f.time+1)}],['peer',{uid:'u2',question:'Q5',isCorrect:true,userIdx:0}],['old',{question:'Q6',isCorrect:true,userIdx:0,timestamp:new Date(f.time-86400000)}]];
  for(const [id,row]of logs)await f.db.doc('exam_logs/'+id).set({uid:'u1',timestamp:new Date(f.time),...row});
  const a=await f.act('study');assert.equal(a.result.energy,2);assert.equal(a.farm.energy,8);assert.equal(a.farm.studyClaimed,2);await assert.rejects(f.act('study'),/尚無新的/);
});
test('study cap, energy storage cap and Taiwan midnight keep unclaimed evidence separate',async()=>{
  const f=await fixture();for(let i=0;i<25;i++)await f.db.doc('exam_logs/q'+i).set({uid:'u1',question:'question '+i,isCorrect:true,userIdx:0,timestamp:new Date(f.time)});
  await f.db.doc('spiritFarms/u1').update({energy:59});const first=await f.act('study');assert.equal(first.result.energy,1);assert.equal(first.farm.studyClaimed,1);await assert.rejects(f.act('study'),/靈氣已滿/);
  await f.db.doc('spiritFarms/u1').update({energy:0});const rest=await f.act('study');assert.equal(rest.result.energy,19);assert.equal(rest.farm.studyClaimed,20);await assert.rejects(f.act('study'),/今日修習靈氣已納滿/);
  f.time=Date.parse('2026-10-29T16:00:00Z');await f.db.doc('exam_logs/next').set({uid:'u1',question:'question 0',isCorrect:false,userIdx:1,timestamp:new Date(f.time)});
  const next=await f.act('study');assert.equal(next.result.energy,1);assert.equal(next.farm.studyClaimed,1);assert.equal(Farm.dateKey(f.time),'2026-10-30');
});
test('farm persists independently of unrelated player stats writes and is isolated per account',async()=>{
  const f=await fixture();await plant(f);await f.db.doc('users/u1').update({stats:{gold:5,totalScore:2}});assert.equal((await f.view()).plots[0].cropId,'jade');
  await f.db.doc('users/u2').set({uid:'u2',stats:{totalScore:0}});const other=await f.service.view('u2');assert(other.farm.plots.every(x=>x.locked||x.empty));assert.equal(other.farm.seeds.jade,6);
});
test('browser cannot directly read or forge the server-owned farm document',async()=>{
  const f=await fixture(),context={uid:'u1',admin:false,decoded:{}};assert.equal(mayRead({role:'A',path:'spiritFarms/u1',uid:'u1',data:await f.raw(),admin:false}),false);
  await assert.rejects(executeCommit(f.db,{writes:[{type:'update',target:{role:'A',path:'spiritFarms/u1',kind:'doc'},data:Codec.encode({energy:999999})}]},context),e=>e.status===403);
});
test('HTTP routes authenticate before resolving a database, sanitize public state and return no-store',async()=>{
  const handlers={},app={get:(path,fn)=>handlers.GET=fn,post:(path,fn)=>handlers.POST=fn};let resolves=0;
  register(app,{resolve:()=>{resolves++;throw Error('not expected');},logger:{error(){}}});
  const out={set(k,v){this.cache=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
  await handlers.GET({get:()=>''},out);assert.equal(out.statusCode,401);assert.equal(resolves,0);assert.equal(out.cache,'no-store');
  const f=await fixture();register(app,{verify:async()=> 'u1',resolve:()=>({db:f.db}),now:()=>f.time});
  await handlers.GET({},out);assert.equal(out.body.ok,true);assert(!JSON.stringify(out.body).includes('operations'));assert(!JSON.stringify(out.body).includes('mutationRoll'));
});

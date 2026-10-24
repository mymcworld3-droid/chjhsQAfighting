'use strict';
const crypto = require('node:crypto');
const BaseWorld = require('./public/world/world-core.js');
const Battle = require('./world-battle.cjs');
const {playerRepository,battleRepository} = require('./server-repositories.cjs');
const {verifyMainIdentity} = require('./raid-question-ticket.cjs');
const {trustedRaidPlayerSnapshot} = require('./raid-authority.cjs');
const Questions = require('./world-questions.cjs');
const Knowledge = require('./public/cultivation/knowledge-points.js');
const fail = (message,status=409) => Object.assign(new Error(message),{status});
const count = n => Number.isFinite(Number(n))?Math.max(0,Math.floor(Number(n))):0;
const day = now => new Date(now+8*3600000).toISOString().slice(0,10);
const clone = value => structuredClone(value);
const STATE = 'worldPlayers', EVENTS = 'worldEvents';
function normalize(raw={},events={},W=BaseWorld) {
  const travelMode=raw.travelMode==='sail'?'sail':'walk',position=W.safePosition(raw.position,{events,mode:travelMode});
  const claims=Object.fromEntries(Object.entries(raw.claims||{}).filter(([key,at])=>key.startsWith('chest:')||key.startsWith('realm:')||key.startsWith('structure:')||Number(at)>Date.now()-3*86400000));
  const explored=raw.mapVersion===W.VERSION?W.normalizeExplored(raw.explored):typeof raw.explored==='string'&&raw.explored.length===2304?W.normalizeExplored(raw.explored):W.initialExplored();
  return {version:2,mapVersion:W.VERSION,position,travelMode,explored:W.reveal(explored,position),
    claims,gathered:count(raw.gathered),victories:count(raw.victories),chests:count(raw.chests),
    questClaimed:raw.questClaimed===true,battle:raw.mapVersion===W.VERSION&&raw.battle?.version===1?raw.battle:null,
    expedition:raw.mapVersion===W.VERSION&&raw.expedition?.version===1?raw.expedition:null,
    requests:Array.isArray(raw.requests)?raw.requests.slice(-32):[],updatedAtMs:count(raw.updatedAtMs)};
}
function quest(s,W=BaseWorld) {
  const steps=[{name:'走進青竹林',done:W.known(s.explored,18,27),target:{x:18,y:27}},
    {name:'採集一處靈材',done:s.gathered>0,objectId:'herb-a'},
    {name:'戰勝一隻妖獸',done:s.victories>0,objectId:'wolf'},
    {name:'打開林間遺箱',done:s.chests>0,objectId:'chest-a'}];
  return {name:'初入青竹林',steps,ready:steps.every(x=>x.done),claimed:s.questClaimed,reward:'6 修為・60 靈石・玄鐵 ×2・靈木 ×2'};
}
function publicState(s,W=BaseWorld) {return {...s,battle:Battle.view(s.battle),requests:undefined,quest:quest(s,W)};}
function createHub({now=Date.now,world:W=BaseWorld}={}) {
  const actors=new Map(),listeners=new Map(),locks=new Map(),signatures=new Map();
  let events={bridge:0,array:0},eventsLoadedAt=-Infinity;
  function publicActor(a) {return {uid:a.uid,name:a.name,gender:a.gender,route:clone(a.route),direction:a.direction||'down',
    status:a.battle?'battle':'explore',travelMode:a.state.travelMode,battleName:a.battle?.name||'',lastSeenAtMs:a.lastSeenAtMs};}
  function nearby(a) {
    const p=W.sample(a.route,now());
    return [...actors.values()].filter(o=>o.uid===a.uid||o.connected!==false&&now()-o.lastSeenAtMs<45000&&W.distance(p,W.sample(o.route,now()))<=15).map(publicActor);
  }
  function send(uid,packet) {
    for(const sink of listeners.get(uid)||[])sink({...packet,serverTime:now()});
  }
  function broadcast() {
    for(const [uid]of listeners){
      const a=actors.get(uid);if(!a)continue;const players=nearby(a);
      const signature=JSON.stringify([events,players.map(p=>[p.uid,p.status,p.route.startedAtMs,p.route.path.at(-1)])]);
      if(signatures.get(uid)!==signature){signatures.set(uid,signature);send(uid,{type:'presence',players,events});}
    }
  }
  function update(a) {
    const sampled=W.sample(a.route,now());
    for(let i=a.revealedIndex||0;i<=sampled.index;i++)a.state.explored=W.reveal(a.state.explored,a.route.path[i]);
    a.revealedIndex=sampled.index;a.state.position=sampled.tile;
    if(sampled.moving)a.direction=sampled.direction;
    return sampled;
  }
  async function serial(uid,work) {
    const previous=locks.get(uid)||Promise.resolve();
    const task=previous.catch(()=>{}).then(work);locks.set(uid,task);
    try{return await task;}finally{if(locks.get(uid)===task)locks.delete(uid);}
  }
  function subscribe(uid,sink) {
    const set=listeners.get(uid)||new Set();set.add(sink);listeners.set(uid,set);signatures.delete(uid);
    return ()=>{set.delete(sink);if(!set.size){listeners.delete(uid);signatures.delete(uid);}};
  }
  return {actors,listeners,send,broadcast,nearby,publicActor,update,serial,subscribe,
    get events(){return events;},set events(value){events={bridge:count(value?.bridge),array:count(value?.array),worldId:W.VERSION,
      chunkRevisions:Object.fromEntries(Object.entries(value?.chunkRevisions||{}).filter(([k,v])=>W.validChunk(k)&&Number.isSafeInteger(v)&&v>0))};eventsLoadedAt=now();},
    get eventsLoadedAt(){return eventsLoadedAt;}};
}
function registerWorldApi(app,{
  resolveA=()=>playerRepository.resolve(),resolveC=()=>battleRepository.resolve(),now=Date.now,world:W=BaseWorld.createWorld({seed:process.env.WORLD_SEED||BaseWorld.DEFAULT_SEED}),hub=createHub({now,world:W}),
  verify=(req)=>verifyMainIdentity(req,{resolveA}),generateQuestions=Questions.generate,logger=console,schedule=true
}={}) {
  const questionJobs=new Map(),patchCache=new Map();let ticking=false;
  const normalizeState=raw=>normalize(raw,hub.events,W),expose=state=>publicState(state,W);
  async function loadEvents(db,force=false) {
    if(force||now()-hub.eventsLoadedAt>60000){const ref=db.collection(EVENTS).doc('main'),snap=await ref.get();let data=snap.exists?snap.data():{};
      if(!data.worldId)data=await db.runTransaction(async tx=>{const current=await tx.get(ref),value=current.exists?current.data():{};
        if(value.worldId)return value;const pinned={...value,worldId:W.VERSION,world:W.descriptor};tx.set(ref,pinned);return pinned;});
      if(data.worldId&&data.worldId!==W.VERSION||data.world?.seed&&data.world.seed!==W.descriptor.seed)throw fail('世界種子與存檔不一致，請先由管理員確認世界設定',503);
      hub.events=data;}
  }
  function nearbyChunks(p,radius=1){const out=[],cx=Math.floor(p.x/32),cy=Math.floor(p.y/32);for(let y=Math.max(0,cy-radius);y<=Math.min(W.CHUNK_COUNT-1,cy+radius);y++)for(let x=Math.max(0,cx-radius);x<=Math.min(W.CHUNK_COUNT-1,cx+radius);x++)out.push(W.key(x,y));return out;}
  async function loadPatches(db,keys,versions={}){
    const out={};
    for(const k of keys){
      const revision=hub.events.chunkRevisions?.[k]||0;if(revision===(versions[k]||0))continue;
      if(!revision){out[k]={revision:0,tiles:{}};continue;}
      let data=patchCache.get(k);
      if(data?.revision!==revision){const snap=await db.collection('worldChunks').doc(W.VERSION+':'+k).get();
        if(!snap.exists||snap.data().worldId!==W.VERSION||snap.data().revision!==revision)throw fail('地圖變更尚未同步，請稍後再試',503);
        data={revision,tiles:snap.data().tiles||{}};patchCache.set(k,data);if(patchCache.size>192)patchCache.delete(patchCache.keys().next().value);}
      out[k]=data;
    }
    W.installPatches(out);return out;
  }
  async function join(uid,db) {
    if(hub.actors.has(uid)){const actor=hub.actors.get(uid);actor.lastSeenAtMs=now();return actor;}
    if(hub.actors.size>=2000)throw fail('大世界目前人數已滿，請稍後再試',503);
    await loadEvents(db);
    const [s,u,c]=await Promise.all([db.collection(STATE).doc(uid).get(),db.collection('users').doc(uid).get(),
      db.collection('gameConfig').doc('artifactCatalogV1').get()]);
    if(!u.exists)throw fail('找不到修士資料，請重新登入',404);
    const user=u.data(),raw=s.exists?s.data():{};
    await loadPatches(db,nearbyChunks(W.inside(raw.position?.x,raw.position?.y)?raw.position:W.SPAWN));
    const state=normalizeState(raw);
    const actor={uid,db,state,name:String(user.displayName||'無名修士').slice(0,32),gender:user.storyProgressV1?.gender==='female'?'female':'male',
      profile:trustedRaidPlayerSnapshot(user,uid,c.exists?c.data():{}),lastSeenAtMs:now(),lastSaveAtMs:now(),dirty:!s.exists,
      route:{path:[state.position],startedAtMs:now(),stepMs:W.STEP_MS},revealedIndex:0,battle:state.battle?.status==='active'?state.battle:null,
      commandSeq:0,sessionId:crypto.randomUUID(),lastCommandAtMs:-Infinity,connected:true};
    // The local battlefield is private; returning to it does not move the exploration anchor.
    hub.actors.set(uid,actor);return actor;
  }
  async function checkpoint(actor) {
    const sampled=hub.update(actor);if(!actor.dirty)return;
    const ref=actor.db.collection(STATE).doc(actor.uid),position={...sampled.tile},explored=actor.state.explored;
    await actor.db.runTransaction(async tx=>{
      const snap=await tx.get(ref),state=normalizeState(snap.exists?snap.data():actor.state);
      // Merge exploration instead of clobbering a reward or battle committed by another request.
      state.position=position;state.travelMode=actor.state.travelMode;state.explored=W.mergeExplored(state.explored,explored);state.updatedAtMs=now();
      tx.set(ref,state);
    });
    actor.lastSaveAtMs=now();actor.dirty=false;
    hub.send(actor.uid,{type:'exploration',position,explored});
  }
  async function mutate(actor,request,work) {
    const id=String(request.requestId||'');if(!/^[A-Za-z0-9:_-]{8,100}$/.test(id))throw fail('操作識別碼無效',400);
    const sampled=hub.update(actor),ref=actor.db.collection(STATE).doc(actor.uid),userRef=actor.db.collection('users').doc(actor.uid);
    const output=await actor.db.runTransaction(async tx=>{
      const [s,u]=await Promise.all([tx.get(ref),tx.get(userRef)]);
      if(!u.exists)throw fail('玩家資料不存在',404);
      const state=normalizeState(s.exists?s.data():actor.state),user=u.data();
      state.position=sampled.tile;state.travelMode=actor.state.travelMode;state.explored=W.mergeExplored(state.explored,actor.state.explored);
      if(state.requests.includes(id))return {state,duplicate:true,inventory:user.materialSystem?.inventory||{},stats:user.stats};
      const outcome=await work({tx,state,user,userRef});
      state.requests=[...state.requests,id].slice(-32);state.updatedAtMs=now();tx.set(ref,state);
      return {...outcome,state,inventory:user.materialSystem?.inventory||{},stats:user.stats};
    });
    actor.state=output.state;actor.battle=output.state.battle?.status==='active'?output.state.battle:null;
    actor.lastSaveAtMs=now();actor.dirty=false;
    hub.broadcast();return {...output,state:expose(output.state)};
  }
  function grant(tx,userRef,user,rewards) {
    const materialSystem=clone(user.materialSystem||{inventory:{}});materialSystem.inventory||={};
    for(const[id,n]of Object.entries(rewards.materials||{}))materialSystem.inventory[id]=count(materialSystem.inventory[id])+count(n);
    user.materialSystem=materialSystem;user.stats={...user.stats,gold:count(user.stats?.gold)+count(rewards.gold),totalScore:count(user.stats?.totalScore)+count(rewards.cultivation)};
    tx.update(userRef,{materialSystem,'stats.gold':user.stats.gold,'stats.totalScore':user.stats.totalScore});
  }
  const claimKey=o=>o.kind==='realm'?'realm:'+o.id:'monster:'+o.id+':'+day(now());
  const explorationRewards=o=>{const tier=W.TIERS[o.tier||0];return {materials:{[tier.iron]:o.kind==='realm'?4:2,[tier.wood]:2},gold:25+(o.tier||0)*10};};
  async function interact(actor,request) {
    if(W.sample(actor.route,now()).moving)throw fail('請先走到互動位置');
    const o=W.object(request.objectId);if(!o)throw fail('此地沒有可互動物件',400);
    if(W.distance(actor.state.position,o)>1)throw fail('請走到目標旁再互動');
    return mutate(actor,request,async({tx,state,user,userRef})=>{
      if(state.battle?.status==='active')throw fail('請先完成或撤離目前戰鬥');
      if(o.kind==='building'||o.kind==='npc')return {entry:o.entry||'quest'};
      if(!W.known(state.explored,o.x,o.y))throw fail('請先探索此處');
      if(o.kind==='monster'||o.kind==='realm'&&o.subtype==='guardian'){
        if(state.travelMode==='sail'&&['water','ocean'].includes(W.terrain(state.position.x,state.position.y,hub.events)))throw fail('請先靠岸再挑戰');
        const claim=claimKey(o);
        // Refresh cultivation/equipment from the trusted player record for each encounter.
        const catalog=await tx.get(actor.db.collection('gameConfig').doc('artifactCatalogV1'));
        state.battle=Battle.createBattle(state.position,o,trustedRaidPlayerSnapshot(user,actor.uid,catalog.exists?catalog.data():{}),hub.events,now(),W);
        state.battle.rewardEligible=!state.claims[claim];state.expedition=null;
        return {message:state.battle.rewardEligible?'戰場展開，先完成兩題補能':'今日獎勵已領取，這場可練習戰術'};
      }
      if(o.kind==='realm'||o.kind==='structure'){
        const key=o.kind+':'+o.id;if(state.claims[key])return {message:'此處已完成探索，可以繼續尋找其他秘境'};
        if(o.kind==='structure'&&o.subtype==='camp')return {entry:'practice',message:'在行腳營地稍作休整，可隨時問道練習'};
        if(o.kind==='structure'&&o.subtype==='watchtower'){
          state.explored=W.reveal(state.explored,o,18);state.claims[key]=now();const rewards=explorationRewards(o);grant(tx,userRef,user,rewards);return {rewards,message:'登高遠望，已揭開附近地圖並收錄遺跡'};
        }
        if(state.expedition&&state.expedition.objectId===o.id)return {message:'繼續接通秘境陣紋'};
        const h=W.hash(o.x,o.y,71);state.expedition={version:1,objectId:o.id,name:o.name,rotations:[1+h%3,1+(h>>>4)%3,1+(h>>>8)%3],target:[0,0,0]};
        return {message:'旋轉三座符盤，讓陣紋全部朝向上方；探索不需答題'};
      }
      if(o.kind==='gather'||o.kind==='chest'){
        const key=o.kind==='chest'?'chest:'+o.id:'gather:'+o.id+':'+day(now());
        if(state.claims[key])throw fail(o.kind==='chest'?'這只寶箱已經開啟':'今日已採集此處，明日再來');
        state.claims[key]=now();
        const rewards=o.kind==='gather'?{materials:{[o.material]:2}}:explorationRewards(o);
        if(o.kind==='gather')state.gathered++;else state.chests++;
        grant(tx,userRef,user,rewards);return {rewards,message:o.kind==='gather'?'採集完成，材料已放入寶庫':'遺箱開啟，獎勵已入帳'};
      }
      if(o.kind==='event'){
        const eventRef=actor.db.collection(EVENTS).doc('main'),eventSnap=await tx.get(eventRef),events=eventSnap.exists?eventSnap.data():{};
        const name=o.id,goal=name==='bridge'?20:60,field=name==='bridge'?'qi-spirit-wood':'qi-spirit-iron';
        if(count(events[name])>=goal)throw fail('全服已完成這項事件');
        const key='event:'+name+':'+day(now());if(state.claims[key])throw fail('今日已貢獻過此事件，明日可再次出力');
        if(count(user.materialSystem?.inventory?.[field])<2)throw fail('需要 '+(name==='bridge'?'靈木':'玄鐵')+' ×2');
        state.claims[key]=now();events[name]=count(events[name])+1;
        const materials=clone(user.materialSystem);materials.inventory[field]-=2;user.materialSystem=materials;
        const patches={};
        if(events[name]===goal){
          const changed=name==='bridge'?[{x:26,y:27,terrain:'bridge'},{x:27,y:27,terrain:'bridge'}]:[{x:39,y:6,terrain:'road'}];
          const k=W.chunkKey(changed[0].x,changed[0].y),patchRef=actor.db.collection('worldChunks').doc(W.VERSION+':'+k),previous=await tx.get(patchRef),data=previous.exists?previous.data():{tiles:{},revision:0};
          const tiles={...data.tiles};for(const p of changed)tiles[(p.y%32)*32+p.x%32]={terrain:p.terrain};
          const revision=count(data.revision)+1;patches[k]={revision,tiles};
          events.chunkRevisions={...events.chunkRevisions,[k]:revision};events.worldId=W.VERSION;events.world=W.descriptor;
          tx.set(patchRef,{worldId:W.VERSION,revision,tiles,updatedAtMs:now()});
        }
        tx.set(eventRef,events);tx.update(userRef,{materialSystem:materials});
        return {events,patches,message:'已貢獻材料，全服進度 '+events[name]+'／'+goal};
      }
      throw fail('此處暫時無法互動');
    });
  }
  async function battleAction(actor,request) {
    if(request.command==='questions'){
      const b=actor.state.battle;if(!b||b.status!=='active'||b.phase!=='recharge')return {state:expose(actor.state)};
      if(b.questions.length===2)return {state:expose(actor.state)};
      const jobKey=actor.uid+':'+b.id+':'+b.turn;
      let job=questionJobs.get(jobKey);
      if(!job){job=generateQuestions(clone(b));questionJobs.set(jobKey,job);}
      let questions;try{questions=await job;}finally{questionJobs.delete(jobKey);}
      return hub.serial(actor.uid,()=>mutate(actor,request,({state})=>{
        if(state.battle?.id!==b.id||state.battle.turn!==b.turn||state.battle.phase!=='recharge')throw fail('回合已改變，請重新取得補能題');
        if(!state.battle.questions.length)state.battle.questions=questions;
        return {};
      }));
    }
    return mutate(actor,request,({tx,state,user,userRef})=>{
      const previous=state.battle;if(!previous||previous.id!==request.battleId)throw fail('戰場已結束或已更換');
      if(request.command==='dismiss'){
        if(previous.status==='active')throw fail('請先完成或撤離戰鬥');state.battle=null;return {};
      }
      const next=Battle.act(previous,request,now());state.battle=next;
      let rewards=null;
      if(request.command==='answer'){
        const record=next.records.at(-1),stats=user.stats||{};
        user.stats={...stats,totalAnswered:count(stats.totalAnswered)+1,totalCorrect:count(stats.totalCorrect)+Number(record.correct)};
        const patch={'stats.totalAnswered':user.stats.totalAnswered,'stats.totalCorrect':user.stats.totalCorrect,
          'stats.knowledgePointMapV1':Knowledge.record(stats.knowledgePointMapV1||{},record,record.correct)};
        tx.update(userRef,patch);
        tx.set(actor.db.collection('exam_logs').doc(crypto.createHash('sha256').update(actor.uid+record.id).digest('hex')),
          {uid:actor.uid,subject:record.subject,topic:record.topic,question:record.q,q:record.q,options:record.options,
            correctIdx:record.answerIndex,userIdx:record.choice,correctAnswer:record.options[record.answerIndex],userAnswer:record.options[record.choice],isCorrect:record.correct,
            explanation:record.explanation,mode:'world',rankAtTime:'大世界・補能',email:'',timestamp:new Date(now())});
      }
      if(next.status==='won'&&previous.status==='active'){
        const object=W.object(next.objectId),key=claimKey(object);
        if(!state.claims[key]){
          const elite=object?.elite,tier=W.TIERS[object?.tier||0];rewards={materials:{[tier.iron]:elite?4:2,[tier.wood]:elite?3:2},gold:elite?45:20,cultivation:elite?2:1};
          state.claims[key]=now();state.victories++;grant(tx,userRef,user,rewards);next.rewards=rewards;
        }
      }
      return {rewards,message:next.status==='won'?'戰鬥勝利，材料已放入寶庫':undefined};
    });
  }
  async function tick() {
    if(ticking)return;ticking=true;let changed=false;
    try{
      for(const actor of hub.actors.values()){
        await hub.serial(actor.uid,async()=>{
          const old=actor.state.position,sampled=hub.update(actor);
          if(!W.same(old,sampled.tile))actor.dirty=true;
          if(sampled.moving||!W.same(old,sampled.tile))changed=true;
          if(actor.dirty&&now()>=(actor.saveRetryAtMs||0)&&(!sampled.moving||now()-actor.lastSaveAtMs>=60000)){
            try{await checkpoint(actor);actor.saveFailures=0;actor.saveRetryAtMs=0;}catch(error){
              actor.saveFailures=(actor.saveFailures||0)+1;actor.saveRetryAtMs=now()+Math.min(60000,5000*2**Math.min(4,actor.saveFailures));
              hub.send(actor.uid,{type:'save-warning',message:'位置尚未存妥，正在重試；請稍候再離開'});logger.warn('[World checkpoint]',error.message);
            }
          }
          if(now()-actor.lastSeenAtMs>45000&&!hub.listeners.has(actor.uid)){
            if(!actor.dirty){hub.actors.delete(actor.uid);changed=true;}
          }
        });
      }
      if(changed)hub.broadcast();
    }finally{ticking=false;}
  }
  function stream(req,res,actor) {
    if(req.aborted||res.destroyed)return;
    res.set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});
    res.flushHeaders();let stopped=false;
    const send=packet=>{if(stopped||res.destroyed)return;if(res.writableLength>512*1024){stop();return;}res.write('data: '+JSON.stringify(packet)+'\n\n');};
    actor.connected=true;const unsubscribe=hub.subscribe(actor.uid,send);
    function stop(){
      if(stopped)return;stopped=true;clearInterval(keepalive);clearTimeout(renew);unsubscribe();res.end();
      if(!hub.listeners.has(actor.uid)){
        actor.connected=false;
        void hub.serial(actor.uid,async()=>{
          if(hub.actors.get(actor.uid)!==actor||hub.listeners.has(actor.uid))return;
          const p=hub.update(actor);actor.route={path:[p.tile],startedAtMs:now(),stepMs:W.STEP_MS};actor.revealedIndex=0;actor.dirty=true;
          try{await checkpoint(actor);}catch(error){actor.saveRetryAtMs=now()+10000;logger.warn('[World disconnect save]',error.message);}
          hub.broadcast();
        });
      }
    }
    const keepalive=setInterval(()=>{actor.lastSeenAtMs=now();if(!res.destroyed)res.write(': keepalive\n\n');},15000);
    const renew=setTimeout(stop,5*60000);keepalive.unref?.();renew.unref?.();
    res.once('close',stop);req.once('aborted',stop);
    send({type:'connected',players:hub.nearby(actor),events:hub.events,serverTime:now()});hub.broadcast();
  }
  app.post('/api/world',async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{
      const uid=await verify(req),db=resolveA().db,action=String(req.body?.action||''),request=req.body||{};
      const actor=await hub.serial(uid,()=>join(uid,db));actor.lastSeenAtMs=now();
      if(action==='subscribe')return stream(req,res,actor);
      // Generation happens outside the per-player queue; slow providers cannot block retreat or disconnect.
      if(action==='battle'&&request.command==='questions')return res.json({ok:true,...await battleAction(actor,request)});
      const result=await hub.serial(uid,async()=>{
        hub.update(actor);
        if(action==='join'){
          await loadEvents(db);return {state:expose(actor.state),self:hub.publicActor(actor),players:hub.nearby(actor),events:hub.events,
            sessionId:actor.sessionId,commandSeq:actor.commandSeq,mapVersion:W.VERSION,world:W.descriptor,
            patches:await loadPatches(db,nearbyChunks(actor.state.position))};
        }
        if(action==='patches'){
          if(!Array.isArray(request.keys)||request.keys.length>25||request.keys.some(k=>!W.validChunk(k)))throw fail('區塊請求無效',400);
          const allowed=new Set(nearbyChunks(actor.state.position,2));if(request.keys.some(k=>!allowed.has(k)))throw fail('只能同步目前附近的地圖變更',400);
          if(now()-(actor.lastPatchAtMs||0)<300)throw fail('地圖同步過於頻繁',429);actor.lastPatchAtMs=now();
          return {worldId:W.VERSION,patches:await loadPatches(db,[...new Set(request.keys)],request.versions||{})};
        }
        if(action==='travel'){
          if(actor.battle||W.sample(actor.route,now()).moving)throw fail('請先停止移動並結束戰鬥');
          if(!['walk','sail'].includes(request.mode))throw fail('移動模式無效',400);
          const p=actor.state.position,water=['water','ocean'].includes(W.terrain(p.x,p.y,hub.events));
          if(request.mode==='walk'&&water)throw fail('請將靈舟駛到海岸地格再上岸');
          if(request.mode==='sail'&&!W.DIRS.some(([dx,dy])=>['water','ocean'].includes(W.terrain(p.x+dx,p.y+dy,hub.events)))&&!water)throw fail('請先走到水域旁再乘舟');
          return mutate(actor,request,({state})=>{state.travelMode=request.mode;return {message:request.mode==='sail'?'已乘靈舟，可沿水域前往其他陸地':'已上岸，可繼續探索陸地'};});
        }
        if(action==='explore')return mutate(actor,request,({tx,state,user,userRef})=>{
          if(state.battle?.status==='active'||W.sample(actor.route,now()).moving)throw fail('請先停止移動並結束戰鬥');
          const expedition=state.expedition,o=W.object(expedition?.objectId);if(!o||W.distance(state.position,o)>1)throw fail('請先回到秘境入口旁');
          const i=Number(request.index);if(request.command!=='rotate'||!Number.isInteger(i)||i<0||i>2)throw fail('陣紋操作無效',400);
          expedition.rotations[i]=(expedition.rotations[i]+1)%4;
          if(expedition.rotations.every((n,j)=>n===expedition.target[j])){
            const key=o.kind+':'+o.id;if(state.claims[key])throw fail('探索獎勵已領取');
            state.claims[key]=now();state.expedition=null;const rewards=explorationRewards(o);grant(tx,userRef,user,rewards);return {rewards,message:'陣紋接通，秘藏已開啟，材料放入寶庫'};
          }
          return {message:'符盤已旋轉'};
        });
        if(action==='move'||action==='stop'){
          if(actor.battle)throw fail('戰鬥中請使用戰棋移動');
          if(request.sessionId!==actor.sessionId||!Number.isSafeInteger(request.seq)||request.seq<=actor.commandSeq)throw fail('較舊的移動指令已忽略');
          if(now()-actor.lastCommandAtMs<90)throw fail('移動指令過於頻繁',429);
          actor.commandSeq=request.seq;actor.lastCommandAtMs=now();
          let next;
          if(action==='stop'){
            const p=W.sample(actor.route,now());next={path:p.moving?[p.tile,p.next]:[p.tile],startedAtMs:now()-(p.moving?p.fraction*W.STEP_MS:0),stepMs:W.STEP_MS};
          }else{
            if(request.objectId&&!W.object(request.objectId))throw fail('目標不存在',400);
            let planned;
            for(let attempt=0;attempt<4;attempt++){
              planned=W.redirect(actor.route,request.objectId?{objectId:request.objectId}:request.target,now(),{events:hub.events,explored:actor.state.explored,mode:actor.state.travelMode});
              const keys=[...new Set((planned.route?.path||[]).map(p=>W.chunkKey(p.x,p.y)))],versions=W.patchVersions();
              if(keys.every(k=>(versions[k]||0)===(hub.events.chunkRevisions?.[k]||0)))break;
              await loadPatches(db,keys,versions);planned=null;
            }
            if(!planned)throw fail('沿途地形已改變，請重新選擇目的地');
            if(!planned.route)throw fail(planned.reason||'無法前往此處');next=planned.route;actor.partial=planned.partial;
          }
          actor.route=next;actor.revealedIndex=0;actor.dirty=true;hub.broadcast();
          return {self:hub.publicActor(actor),partial:!!actor.partial,seq:request.seq,explored:actor.state.explored};
        }
        if(action==='checkpoint'||action==='leave'){
          await checkpoint(actor);if(action==='leave'){hub.actors.delete(uid);hub.send(uid,{type:'left'});hub.broadcast();}
          return {saved:true};
        }
        if(action==='interact'){
          const result=await interact(actor,request);if(result.events){hub.events=result.events;W.installPatches(result.patches||{});for(const[k,v]of Object.entries(result.patches||{}))patchCache.set(k,v);hub.broadcast();}return result;
        }
        if(action==='invite'){
          const target=hub.actors.get(String(request.targetUid||'')),kind=request.kind;
          if(!target||!hub.listeners.has(target.uid)||target.uid===uid||W.distance(W.sample(actor.route,now()),W.sample(target.route,now()))>15)throw fail('道友已離開附近區域，請稍後再邀請');
          if(target.battle||actor.battle)throw fail('請等局部戰鬥結束後再邀請');
          if(!['raid','duel'].includes(kind)||!/^[A-Za-z0-9_-]{8,160}$/.test(String(request.roomId||'')))throw fail('邀請房間無效',400);
          if(now()-(actor.lastInviteAtMs||0)<15000)throw fail('請稍候再發出邀請',429);
          const snap=await resolveC().db.collection(kind==='raid'?'raidRooms':'rooms').doc(request.roomId).get(),room=snap.exists?snap.data():null;
          if(!room||room.status!=='waiting'||(kind==='raid'?room.hostUid:room.host?.uid)!==uid||kind==='duel'&&room.worldTargetUid!==target.uid)throw fail('請先建立有效的邀請房間');
          actor.lastInviteAtMs=now();hub.send(target.uid,{type:'invite',invite:{id:crypto.randomUUID(),kind,roomId:request.roomId,
            roomCode:kind==='raid'?String(room.code||''):'',fromUid:uid,fromName:actor.name,expiresAtMs:now()+90000}});
          return {message:'已向 '+target.name+' 發出'+(kind==='raid'?'組隊':'切磋')+'邀請'};
        }
        if(action==='quest')return mutate(actor,request,({tx,state,user,userRef})=>{
          if(!quest(state,W).ready)throw fail('請先完成青竹林的四項目標');if(state.questClaimed)throw fail('這項任務已領取');
          state.questClaimed=true;const rewards={gold:60,cultivation:6,materials:{'qi-spirit-iron':2,'qi-spirit-wood':2}};
          grant(tx,userRef,user,rewards);return {rewards,message:'宗門嘉獎已領取；可帶材料前往鍛造坊'};
        });
        if(action==='battle')return battleAction(actor,request);
        throw fail('未知的大世界操作',400);
      });
      return res.json({ok:true,...result,serverTime:now()});
    }catch(error){
      if(res.headersSent)return res.end();const status=error.status||503;if(status>=500)logger.error('[Grid world]',error?.message||error);
      res.status(status).json({ok:false,error:status>=500?'大世界連線暫時中斷，請重試；已入帳的獎勵不會重複發放':error.message,status});
    }
  });
  const timer=schedule?setInterval(()=>void tick().catch(error=>logger.warn('[World tick]',error.message)),300):null;timer?.unref?.();
  return {hub,tick,checkpoint,close(){clearInterval(timer);},normalize,publicState};
}
module.exports=registerWorldApi;
module.exports.__test={normalize,quest,publicState,createHub};

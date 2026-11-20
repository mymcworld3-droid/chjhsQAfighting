#!/usr/bin/env node
'use strict';
// Local-only Chromium acceptance. No production Firebase, tickets or AI.
const assert=require('node:assert/strict');
const path=require('node:path');
const express=require('express');
const {generateDungeonLayout}=require('../dungeon-map-generator.cjs');
const AI=require('../dungeon-enemy-ai.cjs');
const PlayerCombat=require('../dungeon-player-combat.cjs');
const SkillCombat=require('../dungeon-skill-combat.cjs');
const QuizCredits=require('../dungeon-quiz-credit.cjs');
const Objectives=require('../dungeon-objectives.cjs');
const Boss=require('../dungeon-boss-battle.cjs');
const Portal=require('../dungeon-portal-readiness.cjs');
const Movement=require('../dungeon-movement.cjs');
const Rescue=require('../dungeon-team-rescue.cjs');
const Victory=require('../dungeon-victory-reward.cjs');
const Manuals=require('../public/cultivation/manual-rules.js');
const manualRecord={
  school:'sword',books:{'sword-wind':{exp:2500}},
  equipped:['wind-slash'],
  loadouts:[{name:'直線',skillIds:['wind-slash']},
    {name:'突進',skillIds:['wind-step']},
    {name:'空白',skillIds:[]}],
  activeLoadout:0
};
const dragonRecord={
  school:'body',books:{'body-dragon':{exp:2500}},
  equipped:['dragon-strike','dragon-guard','dragon-roar'],
  loadouts:[
    {name:'蓄勢連拳',skillIds:['dragon-strike','dragon-guard','dragon-roar']},
    {name:'拳法',skillIds:['dragon-strike']},
    {name:'無裝備',skillIds:[]}
  ],activeLoadout:0
};
let activeManual=manualRecord;
let playwright;try{playwright=require('playwright');}
catch(_){playwright=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');}
const app=express();app.use(express.json());
const map=generateDungeonLayout('stage6-browser-visual-1');
let room=null,clockLoop=null;const watchers=new Set(),requests=[];
const victoryReceipts=new Set(),playerRewards={a:{gold:0,cultivation:0},b:{gold:0,cultivation:0}};
const victoryArchives=new Map(),victoryInbox={a:[],b:[]};
function archiveVictory(){
  if(room?.bossEncounter?.status!=='defeated'||victoryArchives.has(room.id))return;
  const record=Victory.makeArchive(room.id,room,Date.now());
  victoryArchives.set(room.id,record);
  for(const uid of Object.keys(record.members)){
    victoryInbox[uid].unshift({roomId:room.id,archivedAtMs:record.archivedAtMs});
  }
}
const currentMap=()=>room?.dungeonArena==='boss'?
  Boss.mapFor('legacy:'+room.id):map;
const quizState=Object.fromEntries(['a','b'].map(uid=>[uid,{answered:0,
  pending:{},reviews:{},lastReview:null,errorRefunds:[]}]));
const exclusionScope={path:'數學/高中二年級/上學期/數學',
  detail:'平面向量內積',sub_topics:[]};
const quizRevision={a:0,b:0},exclusionRules={a:[],b:[]};
const question=(uid,n)=>({id:uid+'-q-'+n+
  (uid==='a'&&n===0&&quizRevision.a?'-v'+quizRevision.a:''),
  q:'副本問道測試：請選出整數加法的正確算式。'+
    (uid==='a'&&n===0&&quizRevision.a?'（新範圍規則已套用）':''),
  opts:['2+3=3','2+3=4','2+3=5','2+3=6'],
  subject:'數學',topic:'整數加法',difficulty:'easy',
  ...(uid==='a'&&n===0?{adaptive:{scope:exclusionScope}}:{})});
const quizView=uid=>{
  const q=quizState[uid],index=q.answered;
  return {roomId:room.id,answered:index,question:q.pending[index]||null,
    stock:Object.keys(q.pending).filter(k=>Number(k)>=index&&Number(k)<index+5).length,
    lastReview:q.lastReview,errorRefunds:q.errorRefunds,
    pendingCredits:Object.entries(q.reviews).filter(([,r])=>r.index>
      (room.members[uid].quizCreditSeq||0)).map(([id,r])=>({
        id,index:r.index,amount:r.amount,correct:r.correct
      })).sort((a,b)=>a.index-b.index)};
};
const clone=x=>JSON.parse(JSON.stringify(x));
const currentRoom=()=>{
  if(!room)return null;
  const view=clone(room);
  view.enemies=view.enemies?.map(e=>e.kind==='boss'?
    {...e,footprint:2,phase:Boss.phase(e.battleHealth)}:e);
  if(view.status==='assembled'){
    if(view.dungeonArena==='exploration'&&view.dungeonProgress?.portalStatus==='open')
      view.bossPortalReady=Portal.project(view,map,Date.now());
    const time=Date.now();
    const elapsedMs=Math.max(0,time-view.battleStartedAtMs);
    view.battleClock={
      version:1,startedAtMs:view.battleStartedAtMs,tickMs:1000,
      serverNowMs:time,elapsedMs,
      tick:Math.max(view.battleAppliedTick,Math.floor(elapsedMs/1000)),
      appliedTick:view.battleAppliedTick
    };
  }else view.battleClock=null;
  return view;
};
const publish=()=>{
  const payload='data: '+JSON.stringify({room:currentRoom()})+'\n\n';
  for(const res of watchers)res.write(payload);
};
const advanceWorld=()=>{
  if(room?.status!=='assembled')return;
  const patch=AI.advanceWorld(room,currentMap(),Date.now());
  if(!patch)return;
  room={...room,...patch,revision:room.revision+1};
  publish();
};
app.get('/dungeon-test.html',(_req,res)=>res.type('html').send(
  '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'+
  '<body style="margin:0;background:#132119">'+
  '<nav id="nav-grid"><button type="button" data-target="page-home">宗門</button>'+
  '<button type="button" id="nav-training" data-target="page-training">修煉</button>'+
  '<button type="button" data-target="page-settings">設定</button></nav>'+
  '<div id="page-home"></div><div id="page-gameplay" hidden>'+
  '<div class="gameplay-entries" style="width:310px;margin:20px auto"></div></div>'+
  '<script>window.switchToPage=id=>{document.getElementById("page-gameplay").hidden=id!=="page-gameplay";};</script>'+
  '<script type="module" src="/cultivation/gameplay-page.js"></script>'+
  '<script type="module" src="/cultivation/dungeon-lobby.js"></script></body></html>'
));
app.get('/cultivation/data/project-repository.js',(_req,res)=>res.type('text/javascript').send(
  "export const getMainUser=()=>({uid:sessionStorage.mockUid||'a'});"+
  "export const authenticatedMainFetch=(url,init={})=>fetch(url,{...init,headers:{...init.headers,'content-type':'application/json','x-test-user':getMainUser().uid}});"
));
// The normal study/trial scope-rule editor is loaded in the real browser,
 // while this endpoint mocks the same authenticated A revision and invalidates
 // still-unanswered server-side questions before the next dungeon draw.
app.post('/api/quiz/scope-exclusions',(req,res)=>{
  const uid=req.get('x-test-user'),action=req.body?.action;
  if(!room?.members?.[uid])return res.status(403).json({error:'not joined'});
  if(JSON.stringify(req.body?.unit)!==JSON.stringify(exclusionScope))
    return res.status(409).json({error:'scope changed'});
  const rules=exclusionRules[uid];
  if(action==='add'){
    const text=String(req.body.text||'').trim();
    if(text.length<4)return res.status(400).json({error:'invalid text'});
    rules.push({id:'test-'+rules.length,text});
    quizRevision[uid]++;
    const q=quizState[uid];
    for(const index of Object.keys(q.pending))
      if(Number(index)>=q.answered)delete q.pending[index];
    requests.push('scope-exclusion');
  }else if(action==='remove'){
    const i=rules.findIndex(r=>r.id===req.body.id);
    if(i<0)return res.status(404).json({error:'not found'});
    rules.splice(i,1);quizRevision[uid]++;
    for(const index of Object.keys(quizState[uid].pending))
      if(Number(index)>=quizState[uid].answered)delete quizState[uid].pending[index];
    requests.push('scope-exclusion');
  }
  return res.json({ok:true,state:{scopeKey:'test',revision:'v'+quizRevision[uid],
    rules:rules.map(r=>({...r,unitKey:'test'}))},rules});
});
app.post('/api/dungeon/quiz/state',(req,res)=>{
  const uid=req.get('x-test-user');requests.push('quiz-state');
  if(!room?.members?.[uid]||room.status!=='assembled')
    return res.status(403).json({error:'not assembled'});
  return res.json({ok:true,state:quizView(uid)});
});
app.post('/api/generate-quiz',(req,res)=>{
  const uid=req.get('x-test-user'),slot=req.body.slot??0;
  requests.push('generate-quiz');
  if(!room?.members?.[uid]||room.status!=='assembled'||
      req.body.quizMode!=='dungeon'||!Number.isInteger(slot)||slot<0||slot>=5)
    return res.status(403).json({error:'invalid slot'});
  const state=quizState[uid],index=state.answered+slot;
  state.pending[index]||=question(uid,index);
  return res.json({dungeonQuestion:state.pending[index]});
});
app.post('/api/dungeon/quiz/answer',(req,res)=>{
  const uid=req.get('x-test-user'),s=quizState[uid];
  requests.push('quiz-answer');
  if(!room?.members?.[uid]||room.status!=='assembled')
    return res.status(403).json({error:'not assembled'});
  const q=s.pending[s.answered],choice=req.body.choice;
  if(!q||q.id!==req.body.questionId||!Number.isInteger(choice)||choice<0||choice>3)
    return res.status(409).json({error:'stale answer'});
  const correct=choice===2,review={uid,questionId:q.id,index:s.answered+1,
    q:q.q,opts:q.opts,subject:q.subject,topic:q.topic,
    learningTopic:q.topic,difficulty:q.difficulty,adaptive:null,meta:{},
    correct,choice,answerIndex:2,amount:correct?4:1,
    explanation:'因為 2 加 3 等於 5。',
    reward:{cultivation:correct?1:0,gold:0,learning:''}};
  s.reviews[q.id]=review;s.lastReview=review;delete s.pending[s.answered];
  s.answered++;return res.json({ok:true,review,state:quizView(uid)});
});
app.post('/api/dungeon/quiz/report',(req,res)=>{
  const uid=req.get('x-test-user'),state=quizState[uid];
  requests.push('quiz-report');
  if(!room?.members?.[uid]||!state||room.status!=='assembled')
    return res.status(403).json({error:'not joined'});
  const reason=String(req.body?.reason||'').trim();
  if(reason.length<6)return res.status(400).json({error:'至少六字'});
  const questionId=req.body?.questionId;
  if(state.lastReview?.questionId!==questionId)
    return res.status(409).json({error:'not reviewed'});
  const old=state.errorRefunds.find(row=>row.id===questionId);
  if(!old){
    const corrected={...state.lastReview,errorConfirmed:true};
    state.lastReview=corrected;state.reviews[questionId]=corrected;
    if(!corrected.correct)
      state.errorRefunds.push({id:questionId,index:corrected.index});
  }
  return res.json({ok:true,status:old?'duplicate':'confirmed',
    valid:true,compensated:!old,cultivationAdded:old?0:1,
    skipped:false,state:quizView(uid)});
});
app.post('/api/dungeon/quiz/review-math-issue',(req,res)=>
  res.json({ok:true,status:'submitted',submitted:true}));
app.post('/api/dungeon/quiz/next',(req,res)=>{
  const uid=req.get('x-test-user'),s=quizState[uid];
  requests.push('quiz-next');
  if(!room?.members?.[uid]||room.status!=='assembled')
    return res.status(403).json({error:'not assembled'});
  if(s.lastReview?.questionId===req.body.questionId)
    s.lastReview=null;
  else if(!s.reviews[req.body.questionId]||s.lastReview)
    return res.status(409).json({error:'review mismatch'});
  return res.json({ok:true,state:quizView(uid)});
});
// Account-side mastery data is fetched only after the dungeon's
// authenticated, idempotent manuscript credit action.
app.get('/api/tactical/manuals',(req,res)=>{
  const uid=req.get('x-test-user');
  requests.push('manuals-read');
  if(!['a','b'].includes(uid))return res.status(403).json({error:'unauthorized'});
  const state=clone(manualRecord);
  state.books['sword-wind'].exp+=room?.manualExp?.[uid]?.['sword-wind']||0;
  return res.json({ok:true,state:Manuals.publicState(state,6)});
});
app.post('/api/dungeon/room',(req,res)=>{
  const uid=req.get('x-test-user'),action=req.body.action;
  requests.push(action);
  const success=()=>res.json({ok:true,roomId:room?.id||null,room:currentRoom()});
  if(!['a','b'].includes(uid))return res.status(401).json({ok:false,error:'sign-in required'});
  if(action==='list-public')return res.json({ok:true,rooms:[]});
  if(action==='claim-manual-exp'){
    if(!room?.members?.[uid])return res.status(403).json({error:'not a participant'});
    return res.json({ok:true,roomId:room.id,
      manualProgress:{credited:{},pending:false}});
  }
  if(action==='recent-victories'){
    const rewards=(victoryInbox[uid]||[]).map(row=>{
      const witness=victoryArchives.get(row.roomId),
        proof=Victory.verifiedArchive(row.roomId,witness,uid);
      return {roomId:row.roomId,archivedAtMs:row.archivedAtMs,
        defeatedAtTick:proof.defeatedAtTick,partySize:proof.partySize,
        claimed:victoryReceipts.has(Victory.receiptId(row.roomId,proof.session,uid)),
        gold:Victory.GOLD,cultivation:Victory.CULTIVATION};
    });
    return res.json({ok:true,rewards});
  }
  if(action==='reconnect')return res.json({ok:true,roomId:room?.members?.[uid]?room.id:null,
    room:room?.members?.[uid]?currentRoom():null});
  if(action==='create'){
    room={id:'dungroom000001',mode:'dungeon',version:1,revision:1,
      status:'waiting',visibility:'private',code:'ABCDEF',
      hostUid:uid,expiresAtMs:Date.now()+7200000,
      members:{[uid]:{uid,name:'修士甲',realm:'金丹',ready:false,
        joinedAtMs:1,heartbeatAtMs:Date.now()}}};
    return success();
  }
  if(action==='join-code'){
    if(!room||req.body.roomCode!=='ABCDEF')return res.status(409).json({ok:false,error:'invalid code'});
    room.members[uid]={uid,name:'修士乙',realm:'築基',ready:false,
      joinedAtMs:2,heartbeatAtMs:Date.now()};
    room.revision++;publish();return success();
  }
  if(!room?.members?.[uid]&&action!=='claim-boss-reward')
    return res.status(403).json({ok:false,error:'non-member'});
  if(req.body.roomId&&room.id!==req.body.roomId)
    return res.status(404).json({ok:false,error:'unknown room'});
  if(action==='get-map')return res.json({ok:true,roomId:room.id,
    map:clone(currentMap())});
  if(action==='get')return success();
  if(action==='clock'){
    const time=Date.now(),tick=Math.floor(Math.max(0,time-room.battleStartedAtMs)/1000);
    if(room.status!=='assembled')return res.status(409).json({ok:false,error:'not assembled'});
    if(tick>room.battleAppliedTick)advanceWorld();
    return res.json({ok:true,roomId:room.id,clock:currentRoom().battleClock});
  }
  if(action==='heartbeat')return res.json({ok:true,roomId:room.id,revision:room.revision});
  if(action==='quiz-error-refund'){
    const proof=quizState[uid].errorRefunds.find(v=>v.id===req.body.questionId);
    const receipt=room.members[uid].lastQuizErrorRefund;
    if(!proof)return res.status(403).json({ok:false,error:'not independently verified'});
    if(room.members[uid].quizCreditSeq<proof.index)
      return res.status(409).json({ok:false,error:'quiz credit pending'});
    if(!receipt||receipt.questionId!==proof.id){
      const member=room.members[uid];
      const gained=Math.min(10-member.explorationStamina,3);
      member.explorationStamina+=gained;
      member.lastQuizErrorRefund={questionId:proof.id,granted:gained,nominal:3};
      room.revision++;publish();
    }
    return success();
  }
  if(action==='subscribe'){
    res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
    res.flushHeaders?.();
    watchers.add(res);
    res.write('data: '+JSON.stringify({room:currentRoom()})+'\n\n');
    res.on('close',()=>watchers.delete(res));return;
  }
  if(action==='ready'){
    room.members[uid].ready=Boolean(req.body.ready);room.revision++;
    publish();return success();
  }
  if(action==='start'){
    if(uid!==room.hostUid||!Object.values(room.members).every(member=>member.ready))
      return res.status(409).json({ok:false,error:'not ready'});
    room.status='assembled';room.dungeonArena='exploration';room.bossEncounter=null;
    room.battleStartedAtMs=Date.now();
     room.assembledAtMs=room.battleStartedAtMs;
    room.battleAppliedTick=0;
    room.manualProgressSession=room.assembledAtMs;
    room.manualExp={a:{'sword-wind':0},b:{}};
    room.enemyAiVersion=AI.ENEMY_AI_VERSION;
    const seeded=Objectives.spawn(map,AI.initialEnemies(map));
    room.enemies=seeded.enemies;room.dungeonProgress=seeded.progress;
    if(clockLoop)clearInterval(clockLoop);
    clockLoop=setInterval(()=>{
      if(!room||room.status!=='assembled')return;
      advanceWorld();
    },1000);
    clockLoop.unref?.();
    Object.values(room.members).sort((a,b)=>a.joinedAtMs-b.joinedAtMs)
      .forEach((member,i)=>{
        member.position={...map.spawnPads[i]};
        member.explorationStamina=10;member.battleHealth=100;
        member.battleMaxHealth=100;member.downed=false;member.lastDamage=null;
        member.moveSeq=0;member.lastMove=null;
        member.strikeSeq=0;member.lastStrike=null;
         member.quizCreditSeq=0;member.lastQuizCredit=null;
         member.rescueSeq=0;member.lastRescue=null;
         member.selfRescueCount=0;member.allyReviveCount=0;
      });
    room.revision++;publish();return success();
  }
  if(action==='skill'){
    try{
      const out=SkillCombat.castSkill(room,uid,currentMap(),
        uid==='a'?activeManual:null,{
          skillId:req.body.skillId,target:req.body.target,seq:req.body.seq
        });
      if(out.duplicate)return success();
      room.dungeonProgress=Objectives.combatProgress(room,out.enemies,uid);
      room.bossEncounter=Boss.onDefeat(room,out.enemies,uid);
      room.members=out.members;room.enemies=out.enemies;
      archiveVictory();
      room.revision++;publish();return success();
    }catch(error){return res.status(error.status||409).json({ok:false,error:error.message});}
  }
  if(action==='activate-portal'){
    try{
      const applied=Objectives.activate(room,uid,map);
      if(applied.duplicate)return success();
      room.dungeonProgress=applied.progress;room.revision++;publish();
      return success();
    }catch(error){return res.status(error.status||409).json({
      ok:false,error:error.message
    });}
  }
  if(action==='enter-boss'||action==='boss-ready'){
    try{
      const ready=action==='enter-boss'?true:req.body.ready;
      const outcome=Portal.vote(room,uid,map,Date.now(),ready,room.id);
      if(outcome.changed||outcome.transitioned){
        room={...outcome.room,revision:room.revision+1};publish();
      }
      return success();
    }catch(error){return res.status(error.status||409).json({
      ok:false,error:error.message
    });}
  }
  if(action==='rescue'){
    try{
      const out=Rescue.help(room,uid,currentMap(),{
        targetUid:req.body.targetUid,seq:req.body.seq});
      if(out.duplicate)return success();
      room.members=out.members;room.revision++;publish();return success();
    }catch(error){return res.status(error.status||409).json({
      ok:false,error:error.message
    });}
  }
  if(action==='claim-boss-reward'){
    try{
      const witness=victoryArchives.get(req.body.roomId)||room;
      const proof=victoryArchives.has(req.body.roomId)?
        Victory.verifiedArchive(req.body.roomId,witness,uid):
        Victory.validate(room.id,room,uid);
      const id=Victory.receiptId(room.id,proof.session,uid);
      const duplicate=victoryReceipts.has(id);
      if(!duplicate){
        victoryReceipts.add(id);
        playerRewards[uid].gold+=Victory.GOLD;
        playerRewards[uid].cultivation+=Victory.CULTIVATION;
      }
      return res.json({ok:true,roomId:room.id,reward:{
        status:duplicate?'duplicate':'awarded',awarded:!duplicate,
        gold:Victory.GOLD,cultivation:Victory.CULTIVATION
      }});
    }catch(error){return res.status(error.status||409).json({
      ok:false,error:error.message
    });}
  }
  if(action==='leave'){
    const oldRoomId=room.id;
    if(!room?.members?.[uid])return res.json({ok:true,roomId:oldRoomId,room:null});
    delete room.members[uid];
    room.revision++;
    if(!Object.keys(room.members).length){
      room.status='closed';room.bossEncounter=null;room.dungeonArena=null;
      room.dungeonProgress=null;room.enemies=[];
    }else if(room.hostUid===uid){
      room.hostUid=Object.keys(room.members)[0];
    }
    publish();
    return res.json({ok:true,roomId:oldRoomId,room:null});
  }
  if(action==='loadout'){
    try{
      const out=SkillCombat.switchLoadout(room,uid,
        uid==='a'?manualRecord:null,req.body.index);
      if(out.duplicate)return success();
      room.members=out.members;room.revision++;publish();return success();
    }catch(error){return res.status(error.status||409).json({ok:false,error:error.message});}
  }
  if(action==='quiz-credit'){
    try{
      const proof={roomId:room.id,sessionKey:room.id+':'+room.assembledAtMs,
        reviews:quizState[uid].reviews};
      const result=QuizCredits.credit(room,uid,proof,req.body.questionId,room.id);
      if(result.duplicate)return success();
      room.members=result.members;room.revision++;publish();return success();
    }catch(error){return res.status(error.status||409).json({error:error.message});}
  }
  if(action==='strike'){
    try{
      const outcome=PlayerCombat.strikeEnemy(room,uid,currentMap(),{
        enemyId:req.body.enemyId,seq:req.body.seq});
      if(outcome.duplicate)return success();
      room.dungeonProgress=Objectives.combatProgress(room,outcome.enemies,uid);
      room.bossEncounter=Boss.onDefeat(room,outcome.enemies,uid);
      room.members=outcome.members;room.enemies=outcome.enemies;
      archiveVictory();
      room.revision++;publish();return success();
    }catch(error){return res.status(error.status||409).json({ok:false,error:error.message});}
  }
  if(action==='move'||action==='move-route'){
    try{
      const outcome=action==='move'?
        Movement.moveOnMap(room,uid,currentMap(),req.body):
        Movement.moveRouteOnMap(room,uid,currentMap(),req.body);
      if(outcome.duplicate)return success();
      room.members=outcome.members;room.revision++;publish();
      return success();
    }catch(error){return res.status(error.status||409).json({
      ok:false,error:error.message
    });}
  }
  res.status(400).json({ok:false,error:'unknown action'});
});
app.use(express.static(path.join(__dirname,'../public')));
async function main(){
  const server=await new Promise(resolve=>{
    const server=app.listen(0,'127.0.0.1',()=>resolve(server));
  });
  let browser;
  try{
    browser=await playwright.chromium.launch({headless:true,args:['--no-sandbox']});
    const errors=[];
    async function client(uid,viewport){
      const context=await browser.newContext({viewport,deviceScaleFactor:2});
      await context.addInitScript(name=>sessionStorage.mockUid=name,uid);
      const page=await context.newPage();
      page.on('pageerror',e=>errors.push(uid+': '+e.message));
      page.on('console',message=>{
        if(message.type()==='error')errors.push(uid+': console: '+message.text());
      });
      page.on('requestfailed',req=>errors.push(uid+': request: '+req.url()+' '+req.failure()?.errorText));
      page.on('response',response=>{
        if(response.status()>=400&&/\\.js(?:[?#]|$)/.test(response.url()))
          errors.push(uid+': HTTP '+response.status()+' '+response.url());
      });
      await page.goto('http://127.0.0.1:'+server.address().port+'/dungeon-test.html');
      try{
        await page.locator('#gameplay-dungeon-entry').waitFor({state:'attached',timeout:8000});
      }catch(error){
        console.error('[Dungeon preview startup]',uid,errors,await page.evaluate(async()=>({
          state:document.readyState,
          host:document.querySelector('#page-gameplay .gameplay-entries')?.outerHTML,
          entry:document.querySelector('#gameplay-dungeon-entry')?.outerHTML,
          links:[...document.querySelectorAll('script')].map(node=>node.src),
          loaded:(await Promise.all(['/cultivation/dungeon-lobby.js',
            '/cultivation/dungeon-map-view.js','/cultivation/data/project-repository.js']
            .map(async url=>{const r=await fetch(url);return {url,status:r.status,
              type:r.headers.get('content-type'),head:(await r.text()).slice(0,140)};})))
        })));
        throw error;
      }
      await page.locator('#nav-gameplay').waitFor();
      await page.locator('#nav-gameplay').click();
      const order=await page.locator('#nav-grid button').evaluateAll(nodes=>
        nodes.map(node=>node.id||node.dataset.target));
      assert.equal(order.indexOf('nav-gameplay'),order.indexOf('nav-training')+1);
      assert.equal(await page.locator('#page-gameplay').isVisible(),true);
      await page.locator('#gameplay-dungeon-entry').click();
      return {page,context};
    }
    const a=await client('a',{width:390,height:844});
    await a.page.locator('#dungeon-lobby [data-dg="create"]').click();
    await a.page.locator('#dungeon-lobby [data-dg="ready"]').waitFor();
    const b=await client('b',{width:990,height:570});
    // The lobby refreshes its public-room cards asynchronously. If that
    // refresh rerenders the code input between fill and click, retry the
    // user-visible join once the code field has settled.
    try{
      for(let attempt=0;attempt<3;attempt++){
        await b.page.locator('#dungeon-lobby [data-dg-code]').fill('ABCDEF');
        await b.page.locator('#dungeon-lobby [data-dg="join-code"]').click();
        try{
          await b.page.locator('#dungeon-lobby [data-dg="ready"]')
            .waitFor({timeout:3800});break;
        }catch(error){
          const notice=await b.page.locator('[data-dg-notice]').textContent();
          if(attempt===2||!notice?.includes('請輸入六碼'))throw error;
        }
      }
    }catch(error){
      console.error('[Dungeon join diagnostics]',{requests,room,errors,
        browser:await b.page.evaluate(()=>({
          uid:sessionStorage.mockUid,
          notice:document.querySelector('[data-dg-notice]')?.textContent,
          body:document.querySelector('#dungeon-lobby [data-dg-body]')?.innerText,
          buttons:[...document.querySelectorAll('#dungeon-lobby button')]
            .map(node=>({label:node.textContent,disabled:node.disabled}))
        }))});
      throw error;
    }
    await b.page.locator('#dungeon-lobby [data-dg="ready"]').click();
    await a.page.locator('#dungeon-lobby [data-dg="ready"]').click();
    await a.page.locator('#dungeon-lobby [data-dg="assemble"]:not([disabled])').waitFor();
    await a.page.locator('#dungeon-lobby [data-dg="assemble"]').click();
    // Current two-player acceptance: fixed-camera quarter wheel, 10-point
    // stamina, autonomous NPCs, independent quiz, shared key, unanimous
    // portal entry, authoritative boss kill and exactly-once personal rewards.
    for(const {page} of [a,b]){
      await page.locator('#dungeon-map-view:not([hidden])').waitFor({timeout:12000});
      await page.waitForFunction(()=>{
        const canvas=document.querySelector('#dungeon-map-view [data-dm-world]');
        return canvas&&canvas.width>200&&canvas.height>200&&
          document.querySelector('[data-dm-clock]')?.textContent.includes('戰場時鐘')&&
          document.querySelector('[data-dm="quiz"]')?.disabled===false;
      },null,{timeout:12000});
      const dims=await page.evaluate(()=>{
        const canvas=document.querySelector('#dungeon-map-view [data-dm-world]'),
          rect=canvas.getBoundingClientRect();
        return {w:rect.width,h:rect.height,pixels:canvas.width,
          touch:getComputedStyle(canvas).touchAction,
          stamina:document.querySelector('[data-dm-energy]')?.textContent,
          obsolete:document.querySelector('.dm-overview,.dm-controls,.dm-foot')};
      });
      assert.ok(dims.w>200&&dims.h>200,JSON.stringify(dims));
      assert.ok(dims.pixels>=dims.w*1.9,JSON.stringify(dims));
      assert.equal(dims.touch,'none');
      assert.equal(dims.stamina,'10');
      assert.equal(dims.obsolete,null,'retired panels must not be mounted');
    }
    // The server alone publishes a verified per-book kill ledger. A's
    // overlay must use the trial's book painting, XP animation, level bar
    // and one 'spirit-pulse' per actual change, without alerting teammate B.
    await a.page.evaluate(()=>{
      window.__dungeonXpSounds=[];
      window.QAGameAudio={play:(name)=>{
        if(name==='spirit-pulse')window.__dungeonXpSounds.push(name);
      }};
    });
    room.manualExp.a['sword-wind']=35;
    room.revision++;publish();
    const xpPopup=a.page.locator('#dungeon-map-view [data-manual-xp-toast]');
    await xpPopup.waitFor({timeout:9000});
    await a.page.locator('#dungeon-map-view [data-manual-progress-confirmed]')
      .waitFor({timeout:9000});
    const xpVisual=await a.page.evaluate(()=>{
      const toast=document.querySelector('#dungeon-map-view [data-manual-xp-toast]');
      return {
        text:toast?.textContent,
        artwork:toast?.querySelector('img')?.getAttribute('src'),
        animation:getComputedStyle(toast).animationName,
        progress:toast?.querySelector('[data-manual-xp-progress]')?.getAttribute('data-manual-xp-progress'),
        soundEvents:window.__dungeonXpSounds||[],
        pointerEvents:getComputedStyle(toast.closest('[data-manual-xp-host]')).pointerEvents
      };
    });
    assert.match(xpVisual.text,/流風劍訣/);
    assert.match(xpVisual.text,/\+35 EXP/);
    assert.match(xpVisual.text,/Lv\./);
    assert.equal(xpVisual.artwork,'/assets/books/sword-wind.png');
    assert.equal(xpVisual.progress,'sword-wind');
    assert.equal(xpVisual.pointerEvents,'none');
    assert.match(xpVisual.animation,/tc-manual-xp-enter|none/);
    assert.deepEqual(xpVisual.soundEvents,['spirit-pulse']);
    assert.equal(await b.page.locator('#dungeon-map-view [data-manual-xp-toast]').count(),0,
      'a teammate must not see another player manuscript credit');
    assert.ok(requests.includes('claim-manual-exp'));
    assert.ok(requests.includes('manuals-read'));
    // Same ledger, higher revision: no invented second EXP popup or sound.
    room.revision++;publish();
    await a.page.waitForTimeout(150);
    assert.deepEqual(await a.page.evaluate(()=>window.__dungeonXpSounds),
      ['spirit-pulse']);
    assert.equal(room.dungeonArena,'exploration');
    assert.equal(Object.keys(room.members).length,2);
    const startPositions=clone(Object.fromEntries(
      Object.entries(room.members).map(([uid,member])=>[uid,member.position])));
    const originalEnemies=clone(room.enemies);
    await a.page.waitForFunction(()=>
      Number((document.querySelector('[data-dm-clock]')?.textContent||'').match(/T(\d+)/)?.[1]||0)>=6,
      null,{timeout:15000});
    assert.ok(room.enemies.some((enemy,i)=>
      enemy.position.x!==originalEnemies[i].position.x||
      enemy.position.y!==originalEnemies[i].position.y),
      'beasts must autonomously move without player input');

    const dirs=[[1,0,'d'],[0,1,'s'],[-1,0,'a'],[0,-1,'w']];
    const original=room.members.a.position;
    const direction=dirs.find(([dx,dy])=>{
      const to={x:original.x+dx,y:original.y+dy};
      return to.x>=0&&to.y>=0&&to.x<map.width&&to.y<map.height&&
        map.tiles[to.y*map.width+to.x]&&
        !room.enemies.some(enemy=>Boss.occupies(enemy,to));
    });
    assert.ok(direction,'player must have at least one unblocked cardinal step');
    await a.page.locator('#dungeon-map-view [data-dm-world]').focus();
    // Observe live canvas frames, not only the server's final coordinate.
    await a.page.evaluate(()=>{
      const canvas=document.querySelector('#dungeon-map-view [data-dm-world]');
      window.__dungeonMotionFrames=[];
      const record=()=>window.__dungeonMotionFrames.push(canvas.dataset.motion||'unset');
      record();
      new MutationObserver(record).observe(canvas,{attributes:true,attributeFilter:['data-motion']});
    });
    await a.page.keyboard.press(direction[2]);
    try{
      await a.page.waitForFunction(()=>
        document.querySelector('[data-dm-energy]')?.textContent==='9',
        null,{timeout:7000});
    }catch(error){
      console.error('[Dungeon move diagnostics]',{
        requests:requests.slice(-12),errors,
        player:room.members.a,clock:room.battleAppliedTick,
        ui:await a.page.evaluate(()=>({
          energy:document.querySelector('[data-dm-energy]')?.textContent,
          movement:document.querySelector('[data-dm-world]')?.dataset.motion,
          feedback:document.querySelector('[data-dm-action-feedback]')?.textContent,
          status:document.querySelector('[data-dm-status]')?.textContent
        }))
      });
      throw error;
    }
    assert.deepStrictEqual(room.members.a.position,
      {x:original.x+direction[0],y:original.y+direction[1]});
    assert.deepStrictEqual(room.members.b.position,startPositions.b);
    assert.equal(room.members.a.moveSeq,1);
    assert.equal(room.members.a.explorationStamina,9);
    try{
      await a.page.waitForFunction(()=>window.__dungeonMotionFrames?.includes('walking'),
        null,{timeout:5000});
    }catch(error){
      console.error('[Dungeon motion diagnostics]',{
        requests:requests.slice(-12),
        errors,
        motion:await a.page.evaluate(()=>({
          frames:window.__dungeonMotionFrames,
          current:document.querySelector('[data-dm-world]')?.dataset.motion,
          hero:document.querySelector('[data-dm-world]')?.dataset.visualHero,
          reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
          source:document.querySelector('[data-dm-world]')?.outerHTML.slice(0,240)
        }))
      });
      throw error;
    }
    try{
      await a.page.waitForFunction(()=>{
        const frames=window.__dungeonMotionFrames||[];
        return frames.indexOf('walking')>=0&&
          frames.lastIndexOf('idle')>frames.indexOf('walking');
      },null,{timeout:5000});
    }catch(error){
      console.error('[Dungeon motion completion diagnostics]',{
        errors,requests:requests.slice(-12),
        motion:await a.page.evaluate(()=>({
          frames:window.__dungeonMotionFrames?.slice(-30),
          current:document.querySelector('[data-dm-world]')?.dataset.motion,
          hero:document.querySelector('[data-dm-world]')?.dataset.visualHero,
          reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
          clock:document.querySelector('[data-dm-clock]')?.textContent
        }))
      });
      throw error;
    }
    const motionFrames=await a.page.evaluate(()=>window.__dungeonMotionFrames);
    assert.ok(motionFrames.indexOf('walking')<motionFrames.lastIndexOf('idle'),
      'the dungeon should animate, then finish at the confirmed tile');
    const savedMoveSeq=room.members.a.moveSeq;
    const savedStamina=room.members.a.explorationStamina;
    // A retransmission must never move the player again or spend more energy.
    const duplicate=await a.page.evaluate(async({dx,dy,step})=>{
      const response=await fetch('/api/dungeon/room',{method:'POST',
        headers:{'content-type':'application/json','x-test-user':'a'},
        body:JSON.stringify({action:'move',roomId:'dungroom000001',dx,dy,step})});
      return response.status;
    },{dx:direction[0],dy:direction[1],step:1});
    assert.equal(duplicate,200);
    assert.equal(room.members.a.moveSeq,savedMoveSeq);
    assert.equal(room.members.a.explorationStamina,savedStamina);

    // A's question never interrupts the second player or the NPC clock.
    const charge=a.page.locator('#dungeon-map-view [data-dm="quiz"]');
    await charge.click();
    await a.page.locator('.dm-quiz-panel:not([hidden])').waitFor({timeout:9000});
    // Same parchment/choice/review hierarchy as the main trial, but no
    // Q&A assistant. Whiteboard strokes stay entirely local to this player.
    const stem=a.page.locator('.dm-quiz-question-sheet .dm-quiz-question');
    await stem.waitFor();
    assert.ok((await stem.textContent()).length>8);
    assert.equal(await a.page.locator('.dm-quiz-options button[data-dq="answer"]').count(),4);
    const beforeBan=quizState.a.pending[0].id;
    // The actual shared scope editor is used here, not a mocked battle-only
    // component. Saving a rule invalidates C's ungraded question without
    // counting an incorrect answer, costing stamina, or pausing teammate B.
    await a.page.evaluate(async()=>import(
      '/cultivation/quiz-scope-exclusion.js?v=20261120-battle-scope-parity-v1'));
    await a.page.locator('[data-dq="scope-exclusion"]:visible').click();
    await a.page.locator('#quiz-scope-exclusion-text').fill(
      '此範圍不要再出三維向量內積的計算');
    await a.page.locator('#quiz-scope-exclusion-dialog button:has-text("儲存禁出規則")').click();
    await a.page.waitForFunction(()=>
      document.querySelector('#quiz-scope-exclusion-dialog [role="status"]')
        ?.textContent.includes('已儲存'));
    await a.page.locator('#quiz-scope-exclusion-dialog button:has-text("關閉")').click();
    await a.page.waitForFunction(()=>
      document.querySelector('.dm-quiz-question')?.textContent
        .includes('新範圍規則已套用'),null,{timeout:9000});
    const afterBan=quizState.a.pending[0].id;
    assert.notEqual(beforeBan,afterBan);
    assert.equal(quizState.a.answered,0);
    assert.equal(room.members.a.explorationStamina,savedStamina);
    assert.equal(quizState.b.answered,0);
    assert.ok(requests.includes('scope-exclusion'));
    assert.equal(await a.page.locator('.dm-quiz-panel [data-helper-panel],'+
      '.dm-quiz-panel [data-helper-toggle],.dm-quiz-panel [data-helper-input]').count(),0);
    await a.page.locator('.dm-quiz-panel [data-dq="whiteboard"]').click();
    const scratch=a.page.locator('[data-dq-whiteboard-canvas]');
    await scratch.waitFor({state:'visible'});
    // The exclusion dialog can leave the answer sheet scrolled at its prior
    // position; make real pen events hit the visible canvas, not the toolbar.
    await scratch.scrollIntoViewIfNeeded();
    const rect=await scratch.boundingBox();assert.ok(rect&&rect.width>60);
    await a.page.mouse.move(rect.x+rect.width*.25,rect.y+rect.height*.45);
    await a.page.mouse.down();
    await a.page.mouse.move(rect.x+rect.width*.55,
      rect.y+rect.height*.55,{steps:8});
    await a.page.mouse.up();
    const drawn=await scratch.evaluate(canvas=>{
      const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      for(let i=3;i<data.length;i+=4)if(data[i]!==0)return true;
      return false;
    });
    if(!drawn)console.error('[Scope exclusion whiteboard diagnostics]',
      await scratch.evaluate(canvas=>{
        const r=canvas.getBoundingClientRect();
        const center=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
        return {box:{x:r.x,y:r.y,width:r.width,height:r.height},
          target:center?.tagName,selector:center?.getAttribute('data-dq'),
          visible:getComputedStyle(canvas).visibility,
          panelHidden:canvas.closest('.dm-quiz-whiteboard')?.hidden};
      }));
    assert.equal(drawn,true,'the independent scratchpad must accept pointer drawing');
    await a.page.locator('.dm-quiz-panel [data-dq="whiteboard-clear"]').click();
    assert.equal(await scratch.evaluate(canvas=>{
      const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      return data.some((value,index)=>index%4===3&&value!==0);
    }),false,'clear must erase the scratchpad without changing the question');
    await a.page.locator('.dm-quiz-panel [data-dq="whiteboard-close"]').click();
    assert.equal(await a.page.locator('[data-dq-whiteboard]').isHidden(),true);
    const beforeClock=await b.page.locator('[data-dm-clock]').innerText();
    await b.page.waitForFunction(text=>
      document.querySelector('[data-dm-clock]')?.textContent!==text,
      beforeClock,{timeout:5000});
    await a.page.locator('[data-dq="answer"][data-choice="2"]').waitFor({timeout:8000});
    await a.page.locator('[data-dq="answer"][data-choice="2"]').click();
    await a.page.locator('[data-dq="next"]:not([hidden])').waitFor();
    assert.match(await a.page.locator('.dm-quiz-explanation').innerText(),/加 3 等於 5/);
    assert.match(await a.page.locator('.dm-quiz-cultivation').innerText(),/\+1 修為/);
    assert.equal(room.members.a.quizCreditSeq,1);
    assert.equal(room.members.a.explorationStamina,10,'correct +4 clamps to ten');
    assert.equal(room.members.b.explorationStamina,10);
    assert.equal(quizState.b.answered,0);
    await a.page.locator('[data-dq="collapse"]').click();
    const retryCredit=await a.page.evaluate(async(questionId)=>{
      const response=await fetch('/api/dungeon/room',{method:'POST',
        headers:{'content-type':'application/json','x-test-user':'a'},
        body:JSON.stringify({action:'quiz-credit',roomId:'dungroom000001',
          questionId})});
      return response.status;
    },afterBan);
    assert.equal(retryCredit,200);
    assert.equal(room.members.a.explorationStamina,10);
    assert.equal(room.members.a.quizCreditSeq,1);
    // Real browser parity: no helper, correction goes to the shared queue,
    // manual report uses the trusted backend and C-side refund is repeatable.
    await a.page.evaluate(()=>{
      window.__dungeonCorrections=[];
      window.__dungeonLearning=[];
      window.queueTacticalSoloCorrection=async payload=>{
        window.__dungeonCorrections.push(payload);return {ok:true};
      };
      const original=window.QAAdaptiveLearning?.render;
      window.QAAdaptiveLearning={...window.QAAdaptiveLearning,
        render:(quiz,host)=>{
          window.__dungeonLearning.push({id:quiz.id,topic:quiz.learningTopic,
            attached:host?.classList.contains('dm-quiz-question')});
          original?.(quiz,host);
        }};
    });
    await charge.click();
    await a.page.locator('[data-dq="next"]:not([hidden])').click();
    await a.page.locator('[data-dq="answer"][data-choice="0"]').waitFor();
    await a.page.locator('[data-dq="answer"][data-choice="0"]').click();
    const correction=a.page.locator('[data-dq="correction"]');
    await correction.waitFor({timeout:8000});
    assert.equal(await a.page.locator('[data-dq="report-toggle"]').count(),1);
    assert.equal(await a.page.locator('[data-helper-toggle],[data-helper-input]').count(),0);
    await correction.click();
    await a.page.waitForFunction(()=>window.__dungeonCorrections?.length===1);
    assert.match(await correction.innerText(),/已加入共用待答題庫/);
    const corr=await a.page.evaluate(()=>window.__dungeonCorrections[0]);
    assert.ok(corr.question.includes('整數加法'));
    assert.equal(corr.topic,'整數加法');
    assert.ok((await a.page.evaluate(()=>window.__dungeonLearning))
      .some(v=>v.id==='a-q-1'&&v.attached));
    // The actual C-room world keeps updating while the question form is open.
    room.members.a.explorationStamina=7;room.revision++;publish();
    await a.page.locator('[data-dq="report-toggle"]').click();
    await a.page.locator('[data-dq="report-reason"]')
      .fill('此題的題目條件不足，應獨立確認後補償體力。');
    await a.page.locator('[data-dq="report-submit"]').click();
    await a.page.waitForFunction(()=>
      document.querySelector('[data-dq="report-status"]')?.textContent.includes('已確認'),
      null,{timeout:9000});
    await a.page.waitForFunction(()=>
      document.querySelector('[data-dm-energy]')?.textContent==='10',
      null,{timeout:9000});
    assert.equal(room.members.a.lastQuizErrorRefund.questionId,'a-q-1');
    assert.equal(room.members.a.lastQuizErrorRefund.granted,3);
    assert.equal(room.members.a.quizCreditSeq,2);
    const refunded=room.members.a.explorationStamina;
    const repeated=await a.page.evaluate(async()=>{
      const response=await fetch('/api/dungeon/room',{
        method:'POST',headers:{'content-type':'application/json','x-test-user':'a'},
        body:JSON.stringify({action:'quiz-error-refund',
          roomId:'dungroom000001',questionId:'a-q-1'})});
      return response.status;
    });
    assert.equal(repeated,200);
    assert.equal(room.members.a.explorationStamina,refunded);
    await a.page.locator('[data-dq="collapse"]').click();

    // Regression for the reported real-game symptom: four-step shove must
    // traverse FOUR clear tiles when no beast, teammate or wall is ahead.
    // Exercise the real client wheel and canvas, not a forged API payload.
    const lane=(()=>{
      for(let y=2;y<map.height-2;y++)for(let x=2;x<map.width-2;x++)
        for(const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1]]){
          const squares=Array.from({length:5},(_,i)=>({x:x+dx*i,y:y+dy*i}));
          if(squares.every(p=>p.x>=0&&p.y>=0&&p.x<map.width&&p.y<map.height&&
              !!map.tiles[p.y*map.width+p.x])&&
              !squares.some(p=>p.x===room.members.b.position.x&&
                p.y===room.members.b.position.y))
            return {from:squares[0],target:squares[1],end:squares[4]};
        }
      return null;
    })();
    assert.ok(lane,'the generated dungeon must contain five contiguous open squares');
    const savedParty=clone(room.members),savedBeasts=clone(room.enemies);
    clearInterval(clockLoop);clockLoop=null;
    activeManual=dragonRecord;
    room.enemies=[];
    room.members.a={...room.members.a,accessScore:200,
      ...SkillCombat.initialCombatLoadout(
        {...room.members.a,accessScore:200},dragonRecord),
      position:{...lane.from},explorationStamina:10,
      skillSeq:0,lastSkill:null};
    room.revision++;publish();
    await a.page.locator('[data-dm-wheel] [data-wheel-choice="dragon-guard"]')
      .waitFor({timeout:9000});
    // Sector buttons occupy the whole quarter-circle bounding box but are
    // clip-pathed to annular wedges. Its geometric center is NOT clickable.
    // Choose the actual middle of the second of three outer wedges.
    const guardChoice=a.page.locator('[data-dm-wheel] [data-wheel-choice="dragon-guard"]');
    const guardBounds=await guardChoice.boundingBox();
    assert.ok(guardBounds);
    const point=.385; // (-135°, radius 87%) in quarter-wheel coordinates
    await guardChoice.click({position:{
      x:guardBounds.width*point,y:guardBounds.height*point}});
    await a.page.waitForFunction(()=>
      document.querySelector('[data-dm-wheel] [data-wheel-choice="dragon-guard"]')
        ?.getAttribute('aria-pressed')==='true',null,{timeout:5000});
    await a.page.evaluate(()=>{
      const canvas=document.querySelector('[data-dm-world]');
      window.__chainVisualPoints=[];
      new MutationObserver(()=>{
        const raw=canvas.dataset.visualHero;
        if(raw)window.__chainVisualPoints.push(raw.split(',').map(Number));
      }).observe(canvas,{attributes:true,attributeFilter:['data-visual-hero']});
    });
    const tilePixel=await a.page.evaluate(async({origin,tile,area})=>{
      const Camera=await import('/cultivation/dungeon-map-camera.js');
      const canvas=document.querySelector('[data-dm-world]'),
        rect=canvas.getBoundingClientRect(),
        camera=Camera.lockToPlayer(origin,area,rect.width,rect.height),
        g=Camera.geometry(camera,area,rect.width,rect.height);
      return {x:g.ox+(tile.x+.5)*g.cell,y:g.oy+(tile.y+.5)*g.cell};
    },{origin:lane.from,tile:lane.target,area:map});
    await a.page.locator('#dungeon-map-view [data-dm-world]').click({
      position:tilePixel});
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-energy]')
      ?.textContent==='6',null,{timeout:9000});
    assert.equal(room.members.a.lastSkill?.skillId,'dragon-guard');
    assert.equal(room.members.a.lastSkill?.chainSteps?.length,4,
      'the authoritative C-room must confirm all four empty-lane stages');
    assert.deepStrictEqual(room.members.a.position,lane.end,
      'one click on a clear corridor must advance FOUR tiles');
    assert.equal(room.members.a.explorationStamina,6,
      'all four steps cost one skill cast, not four requests');
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-action-feedback]')
      ?.textContent.includes('前進 4 格'),null,{timeout:9000});
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-world]')
      ?.dataset.motion==='walking',null,{timeout:5000});
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-world]')
      ?.dataset.motion==='idle',null,{timeout:5000});
    const reported=await a.page.locator('[data-dm-action-feedback]').innerText();
    assert.match(reported,/完成 4 段/);
    assert.match(reported,/前進 4 格/);
    assert.equal(room.enemies.length,0);
    const visualPoints=await a.page.evaluate(()=>window.__chainVisualPoints);
    assert.ok(visualPoints.length>=12,'real Chromium must paint intermediate frames');
    const vx=lane.target.x-lane.from.x,vy=lane.target.y-lane.from.y;
    const progress=visualPoints.map(([x,y])=>
      (x-lane.from.x)*vx+(y-lane.from.y)*vy);
    assert.ok(Math.max(...progress)-Math.min(...progress)>3.5,
      'canvas should visually traverse FOUR tiles, not just the first tile');
    for(let step=1;step<=3;step++)
      assert.ok(progress.some(value=>Math.abs(value-step)<.16),
        'animation must pass through committed stage '+step);
    // Restore the exploration scenario before the guardian/boss suite.
    activeManual=manualRecord;
    room.members=savedParty;room.enemies=savedBeasts;
    room.revision++;publish();
    clockLoop=setInterval(()=>{if(room?.status==='assembled')advanceWorld();},1000);
    clockLoop.unref?.();

    // Put a genuine, low-HP guardian near a player for a deterministic
    // short browser battle; server tests cover full-length guardian combat.
    const guardian=Objectives.spawn(map,[]).enemies.find(e=>e.id===Objectives.GUARDIAN_ID);
    assert.ok(guardian);
    const nearby=dirs.map(([dx,dy])=>({
      x:guardian.position.x+dx,y:guardian.position.y+dy
    })).find(pos=>pos.x>=0&&pos.y>=0&&pos.x<map.width&&pos.y<map.height&&
      !!map.tiles[pos.y*map.width+pos.x]);
    assert.ok(nearby,'guardian has a walkable adjacent attack square');
    room.enemies=[{...guardian,battleHealth:20,cadence:999999}];
    room.members.a.position={...nearby};
    room.revision++;publish();
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-energy]')?.textContent==='10');
    const clickTile=async(page,from,tile,area)=>{
      const pos=await page.evaluate(async({from,tile,area})=>{
        const Camera=await import('/cultivation/dungeon-map-camera.js');
        const canvas=document.querySelector('#dungeon-map-view [data-dm-world]'),
          rect=canvas.getBoundingClientRect(),
          camera=Camera.lockToPlayer(from,area,rect.width,rect.height),
          g=Camera.geometry(camera,area,rect.width,rect.height);
        return {x:g.ox+(tile.x+.5)*g.cell,y:g.oy+(tile.y+.5)*g.cell};
      },{from,tile,area});
      await page.locator('#dungeon-map-view [data-dm-world]').click({position:pos});
    };
    await clickTile(a.page,nearby,guardian.position,map);
    await a.page.waitForFunction(()=>
      document.querySelector('[data-dm-objective]')?.textContent.includes('共享密鑰'),
      null,{timeout:8000});
    assert.equal(room.dungeonProgress.keyAcquired,true);
    assert.equal(room.dungeonProgress.portalStatus,'ready');
    assert.equal(room.enemies.length,0);
    assert.equal(room.members.a.explorationStamina,8);

    // Confirm the portal from a real visible button, then require BOTH
    // teammates' independent confirmations before anybody enters the arena.
    room.members.a.position={...map.portalSite};
    room.members.b.position={...map.portalSite};
    room.revision++;publish();
    await b.page.locator('[data-dm="portal"]:not([disabled])').waitFor({timeout:8000});
    await b.page.locator('[data-dm="portal"]').click();
    await b.page.waitForFunction(()=>document.querySelector('[data-dm-objective]')
      ?.textContent.includes('傳送門已啟動'),null,{timeout:8000});
    assert.equal(room.dungeonProgress.portalStatus,'open');
    const portalA=a.page.locator('[data-dm="enter-boss"]:not([disabled])');
    const portalB=b.page.locator('[data-dm="enter-boss"]:not([disabled])');
    await portalA.waitFor({timeout:9000});
    await portalA.click();
    await a.page.waitForFunction(()=>{
      const status=document.querySelector('[data-dm-portal-votes]')?.textContent||'';
      return /1\s*\/\s*2/.test(status)&&status.includes('你已確認');
    },null,{timeout:8000});
    assert.equal(room.dungeonArena,'exploration');
    await portalB.waitFor({timeout:9000});
    await portalB.click();
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-title]')
      ?.textContent.includes('首領戰'),null,{timeout:8000});
    await b.page.waitForFunction(()=>document.querySelector('[data-dm-title]')
      ?.textContent.includes('首領戰'),null,{timeout:8000});
    assert.equal(room.dungeonArena,'boss');
    assert.equal(room.enemies.length,1);
    assert.equal(room.enemies[0].id,Boss.ID);
    for(const {page} of [a,b]){
      await page.locator('[data-dm-boss-health]:not([hidden])').waitFor();
      assert.equal(await page.locator('[data-dm-boss-progress]').getAttribute('aria-valuemax'),String(Boss.HP));
      await page.waitForFunction(()=>{
        const canvas=document.querySelector('#dungeon-map-view [data-dm-world]');
        return canvas?.dataset.bossEffects==='active'&&
          Number(canvas.dataset.environmentEffects)>0;
      },null,{timeout:7000});
    }
    // The browser must actually redraw each server-authorized boss warning
    // before the hit; no client-invented attack cells are accepted.
    const bossMap=Boss.mapFor('legacy:'+room.id);
    const telegraph=Boss.plan(bossMap,room.enemies[0],room.members,
      (room.battleAppliedTick||0)+2);
    assert.ok(telegraph?.cells?.length);
    room.enemies[0].attack=telegraph;room.revision++;publish();
    await a.page.waitForFunction(()=>{
      const canvas=document.querySelector('#dungeon-map-view [data-dm-world]');
      return canvas?.dataset.bossTelegraph==='quake'&&
        Number(canvas.dataset.warningCells)>0;
    },null,{timeout:7000});
    room.enemies[0].attack=null;room.revision++;publish();

    // A server-authorized basic attack resolves on the 2x2 boss footprint,
    // archives one victory, then both players can claim their own prize.
    room.enemies[0].battleHealth=20;
    room.members.a.position={x:11,y:8};
    room.revision++;publish();
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-boss-progress]')
      ?.getAttribute('aria-valuenow')==='20',null,{timeout:8000});
    await clickTile(a.page,{x:11,y:8},{x:11,y:7},bossMap);
    await a.page.locator('[data-dm-victory]:not([hidden])').waitFor({timeout:9000});
    await b.page.locator('[data-dm-victory]:not([hidden])').waitFor({timeout:9000});
    assert.equal(room.bossEncounter.status,'defeated');
    assert.equal(room.enemies.length,0);
    assert.equal(victoryArchives.size,1,'one permanent victory proof for the room');
    assert.equal(victoryInbox.a.length,1);
    assert.equal(victoryInbox.b.length,1);
    for(const {page} of [a,b]){
      await page.locator('[data-dm="claim-victory"]:not([disabled])').click();
    }
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-reward-status]')
      ?.textContent.includes('已成功存入'),null,{timeout:9000});
    await b.page.waitForFunction(()=>document.querySelector('[data-dm-reward-status]')
      ?.textContent.includes('已成功存入'),null,{timeout:9000});
    assert.equal(playerRewards.a.gold,Victory.GOLD);
    assert.equal(playerRewards.b.gold,Victory.GOLD);
    assert.equal(victoryReceipts.size,2);
    const replay=await a.page.evaluate(async()=>{
      const response=await fetch('/api/dungeon/room',{method:'POST',
        headers:{'content-type':'application/json','x-test-user':'a'},
        body:JSON.stringify({action:'claim-boss-reward',roomId:'dungroom000001',
          gold:999999})});
      return (await response.json()).reward;
    });
    assert.equal(replay.status,'duplicate');
    assert.equal(playerRewards.a.gold,Victory.GOLD);
    assert.equal(room.status,'assembled','claim does not reset the party');
    await a.context.close();await b.context.close();
    console.log('[Dungeon browser] PASS: 2 players, real-time AI, 10 stamina, quiz, guardian, unanimous boss portal, victory and idempotent claims');
  }finally{
    clearInterval(clockLoop);
    clockLoop=null;
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});

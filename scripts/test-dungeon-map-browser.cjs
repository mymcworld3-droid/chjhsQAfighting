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
  pending:{},reviews:{},lastReview:null}]));
const question=(uid,n)=>({id:uid+'-q-'+n,q:'副本問道測試：請選出整數加法的正確算式。',
  opts:['2+3=3','2+3=4','2+3=5','2+3=6'],
  subject:'數學',topic:'整數加法',difficulty:'easy'});
const quizView=uid=>{
  const q=quizState[uid],index=q.answered;
  return {roomId:room.id,answered:index,question:q.pending[index]||null,
    stock:Object.keys(q.pending).filter(k=>Number(k)>=index&&Number(k)<index+5).length,
    lastReview:q.lastReview,
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
  '<body style="margin:0;background:#132119"><div id="page-home">'+
  '<div class="xiuxian-quick-actions" style="width:310px;margin:20px auto"></div></div>'+
  '<script type="module" src="/cultivation/dungeon-lobby.js"></script></body></html>'
));
app.get('/cultivation/data/project-repository.js',(_req,res)=>res.type('text/javascript').send(
  "export const getMainUser=()=>({uid:sessionStorage.mockUid||'a'});"+
  "export const authenticatedMainFetch=(url,init={})=>fetch(url,{...init,headers:{...init.headers,'content-type':'application/json','x-test-user':getMainUser().uid}});"
));
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
    q:q.q,opts:q.opts,correct,choice,answerIndex:2,amount:correct?4:1,
    explanation:'因為 2 加 3 等於 5。',
    reward:{cultivation:correct?1:0,gold:0,learning:''}};
  s.reviews[q.id]=review;s.lastReview=review;delete s.pending[s.answered];
  s.answered++;return res.json({ok:true,review,state:quizView(uid)});
});
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
app.post('/api/dungeon/room',(req,res)=>{
  const uid=req.get('x-test-user'),action=req.body.action;
  requests.push(action);
  const success=()=>res.json({ok:true,roomId:room?.id||null,room:currentRoom()});
  if(!['a','b'].includes(uid))return res.status(401).json({ok:false,error:'sign-in required'});
  if(action==='list-public')return res.json({ok:true,rooms:[]});
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
        await page.locator('#home-dungeon-entry').waitFor({timeout:8000});
      }catch(error){
        console.error('[Dungeon preview startup]',uid,errors,await page.evaluate(async()=>({
          state:document.readyState,
          host:document.querySelector('#page-home .xiuxian-quick-actions')?.outerHTML,
          entry:document.querySelector('#home-dungeon-entry')?.outerHTML,
          links:[...document.querySelectorAll('script')].map(node=>node.src),
          loaded:(await Promise.all(['/cultivation/dungeon-lobby.js',
            '/cultivation/dungeon-map-view.js','/cultivation/data/project-repository.js']
            .map(async url=>{const r=await fetch(url);return {url,status:r.status,
              type:r.headers.get('content-type'),head:(await r.text()).slice(0,140)};})))
        })));
        throw error;
      }
      await page.locator('#home-dungeon-entry').click();
      return {page,context};
    }
    const a=await client('a',{width:390,height:844});
    await a.page.locator('#dungeon-lobby [data-dg="create"]').click();
    await a.page.locator('#dungeon-lobby [data-dg="ready"]').waitFor();
    const b=await client('b',{width:990,height:570});
    await b.page.locator('#dungeon-lobby [data-dg-code]').fill('ABCDEF');
    await b.page.locator('#dungeon-lobby [data-dg="join-code"]').click();
    try{
      await b.page.locator('#dungeon-lobby [data-dg="ready"]').waitFor({timeout:6500});
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
    await a.page.waitForFunction(()=>
      document.querySelector('[data-dm-energy]')?.textContent==='9',null,{timeout:7000});
    assert.deepStrictEqual(room.members.a.position,
      {x:original.x+direction[0],y:original.y+direction[1]});
    assert.deepStrictEqual(room.members.b.position,startPositions.b);
    assert.equal(room.members.a.moveSeq,1);
    assert.equal(room.members.a.explorationStamina,9);
    await a.page.waitForFunction(()=>window.__dungeonMotionFrames?.includes('walking'),
      null,{timeout:5000});
    await a.page.waitForFunction(()=>{
      const frames=window.__dungeonMotionFrames||[];
      return frames.indexOf('walking')>=0&&
        frames.lastIndexOf('idle')>frames.indexOf('walking');
    },null,{timeout:5000});
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
    const beforeClock=await b.page.locator('[data-dm-clock]').innerText();
    await b.page.waitForFunction(text=>
      document.querySelector('[data-dm-clock]')?.textContent!==text,
      beforeClock,{timeout:5000});
    await a.page.locator('[data-dq="answer"][data-choice="2"]').waitFor({timeout:8000});
    await a.page.locator('[data-dq="answer"][data-choice="2"]').click();
    await a.page.locator('[data-dq="next"]:not([hidden])').waitFor();
    assert.match(await a.page.locator('.dm-quiz-explanation').innerText(),/加 3 等於 5/);
    assert.equal(room.members.a.quizCreditSeq,1);
    assert.equal(room.members.a.explorationStamina,10,'correct +4 clamps to ten');
    assert.equal(room.members.b.explorationStamina,10);
    assert.equal(quizState.b.answered,0);
    await a.page.locator('[data-dq="collapse"]').click();
    const retryCredit=await a.page.evaluate(async()=>{
      const response=await fetch('/api/dungeon/room',{method:'POST',
        headers:{'content-type':'application/json','x-test-user':'a'},
        body:JSON.stringify({action:'quiz-credit',roomId:'dungroom000001',
          questionId:'a-q-0'})});
      return response.status;
    });
    assert.equal(retryCredit,200);
    assert.equal(room.members.a.explorationStamina,10);
    assert.equal(room.members.a.quizCreditSeq,1);

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
      assert.equal(await page.locator('[data-dm-boss-progress]').getAttribute('aria-valuemax'),'900');
    }

    // A server-authorized basic attack resolves on the 2x2 boss footprint,
    // archives one victory, then both players can claim their own prize.
    room.enemies[0].battleHealth=20;
    room.members.a.position={x:11,y:8};
    room.revision++;publish();
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-boss-progress]')
      ?.getAttribute('aria-valuenow')==='20',null,{timeout:8000});
    const bossMap=Boss.mapFor('legacy:'+room.id);
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

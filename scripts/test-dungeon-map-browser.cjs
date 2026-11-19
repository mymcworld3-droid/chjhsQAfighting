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
  if(!room?.members?.[uid])return res.status(403).json({ok:false,error:'non-member'});
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
        member.explorationStamina=100;member.battleHealth=100;
        member.battleMaxHealth=100;member.downed=false;member.lastDamage=null;
        member.moveSeq=0;member.lastMove=null;
        member.strikeSeq=0;member.lastStrike=null;
         member.quizCreditSeq=0;member.lastQuizCredit=null;
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
  if(action==='enter-boss'){
    try{
      const entered=Boss.enter(room,uid,map,Date.now(),room.id);
      if(entered.duplicate)return success();
      room={...entered.room,revision:room.revision+1};
      publish();return success();
    }catch(error){return res.status(error.status||409).json({
      ok:false,error:error.message
    });}
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
      room.revision++;publish();return success();
    }catch(error){return res.status(error.status||409).json({ok:false,error:error.message});}
  }
  if(action==='move'){
    if(room.status!=='assembled')return res.status(409).json({ok:false,error:'not assembled'});
    const {dx,dy,step}=req.body,member=room.members[uid];
    if(!Number.isInteger(dx)||!Number.isInteger(dy)||Math.abs(dx)+Math.abs(dy)!==1)
      return res.status(400).json({ok:false,error:'invalid direction'});
    if(step===member.moveSeq&&member.lastMove?.dx===dx&&member.lastMove?.dy===dy)
      return success();
    if(!Number.isSafeInteger(step)||step!==member.moveSeq+1)
      return res.status(409).json({ok:false,error:'stale step'});
    const next={x:member.position.x+dx,y:member.position.y+dy},area=currentMap();
    if(next.x<0||next.y<0||next.x>=area.width||next.y>=area.height||
       !area.tiles[next.y*area.width+next.x]||
       room.enemies?.some(enemy=>Boss.occupies(enemy,next)))
      return res.status(409).json({ok:false,error:'wall'});
    if(member.explorationStamina<1)return res.status(409).json({ok:false,error:'no energy'});
    member.position=next;member.explorationStamina--;member.moveSeq=step;
    member.lastMove={dx,dy,step};room.revision++;publish();
    return success();
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
    for(const {page} of [a,b]){
      await page.locator('#dungeon-map-view:not([hidden])').waitFor({timeout:10000});
      await page.locator('#dungeon-map-view [data-dm-biome-box]:not([hidden])').waitFor();
      const dims=await page.evaluate(()=>{
        const canvas=document.querySelector('.dm-world'),r=canvas.getBoundingClientRect();
        return {w:r.width,h:r.height,pixels:canvas.width,
          touch:getComputedStyle(canvas).touchAction,
          zoom:document.querySelector('[data-dm-zoom]').textContent};
      });
      assert.ok(dims.w>200&&dims.h>200,JSON.stringify(dims));
      assert.ok(dims.pixels>=dims.w*1.9,JSON.stringify(dims));
      assert.equal(dims.touch,'none');assert.equal(dims.zoom,'100%');
      const creatureButton=page.locator('#dungeon-map-view [data-dm="beasts"]');
      await page.waitForFunction(()=>/^靈獸 [5-7]$/.test(
        document.querySelector('[data-dm="beasts"]')?.textContent||''));
      assert.equal(await creatureButton.isDisabled(),false);
    }
    // Stage-9 NPCs must move without the player pressing any controls.
    const spawnBeasts=AI.initialEnemies(map);
    await a.page.waitForFunction(()=>Number((
      document.querySelector('[data-dm-clock]')?.textContent||'').match(/T(\d+)/)?.[1]||0)>=6,
      null,{timeout:11000});
    await a.page.waitForFunction(()=>Number((
      document.querySelector('[data-dm-clock]')?.textContent||'').match(/T(\d+)/)?.[1]||0)>=6);
    assert.ok(room.enemies.some((e,i)=>e.position.x!==spawnBeasts[i].position.x||
      e.position.y!==spawnBeasts[i].position.y),'NPC should patrol with no player movement');
    for(const {page} of [a,b]){
      await page.locator('#dungeon-map-view [data-dm="beasts"]').click();
      await page.locator('#dungeon-map-view [data-dm-inspector]:not([hidden])').waitFor();
      const count=await page.locator('[data-dm-beast-list] button').count();
      assert.equal(count,room.enemies.length);
      await page.locator('[data-dm-beast-list] button').first().click();
      // Selecting a beast closes the inspector to free the narrow rail for
      // manual skill controls. Reopen it to read the selected beast details.
      await page.locator('[data-dm-inspector]').waitFor({state:'hidden'});
      await page.locator('#dungeon-map-view [data-dm="beasts"]').click();
      await page.locator('[data-dm-inspector]:not([hidden])').waitFor();
      const description=await page.locator('[data-dm-beast-details]').innerText();
      assert.match(description,/座標/);assert.match(description,/節拍 T/);
      assert.ok(description.includes(room.enemies[0].name));
      await page.locator('[data-dm="close-beasts"]').click();
    }
    // Both connected browsers display elapsed server time with no player
    // movement or actions required to make the clock advance.
    await a.page.waitForFunction(()=>Number((
      document.querySelector('[data-dm-clock]')?.textContent||'').match(/T(\d+)/)?.[1]||0)>=2,
      null,{timeout:8000});
    const clockA=await a.page.locator('[data-dm-clock]').innerText();
    const clockB=await b.page.locator('[data-dm-clock]').innerText();
    assert.match(clockA,/戰場時鐘/);
    assert.match(clockB,/戰場時鐘/);
    const tickA=Number(clockA.match(/T(\d+)/)?.[1]||-1),
      tickB=Number(clockB.match(/T(\d+)/)?.[1]||-1);
    assert.ok(Math.abs(tickA-tickB)<=1,clockA+' vs '+clockB);
    // Inspecting a creature intentionally zooms to it; restore the
    // all-map view before checking the original 100% -> 135% zoom control.
    await a.page.locator('#dungeon-map-view [data-dm="fit"]').click();
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-zoom]')
      ?.textContent==='100%');
    await a.page.locator('#dungeon-map-view [data-dm="plus"]').click();
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-zoom]').textContent==='135%');
    await a.page.locator('#dungeon-map-view [data-dm="route"]').click();
    assert.equal(await a.page.locator('[data-dm="route"]').getAttribute('aria-pressed'),'true');
    await a.page.locator('#dungeon-map-view [data-dm="fit"]').click();
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-zoom]').textContent==='100%');
    await a.page.evaluate(()=>{
      const canvas=document.querySelector('.dm-world'),r=canvas.getBoundingClientRect();
      const emit=(type,id,x)=>canvas.dispatchEvent(new PointerEvent(type,{
        bubbles:true,pointerType:'touch',pointerId:id,button:0,
        clientX:r.left+r.width*x,clientY:r.top+r.height*.5
      }));
      emit('pointerdown',1,.4);emit('pointerdown',2,.6);
      emit('pointermove',2,.8);emit('pointerup',1,.4);emit('pointerup',2,.8);
    });
    // Paint is intentionally deferred to requestAnimationFrame: wait for
    // the next frame rather than asserting a stale HUD value immediately.
    await a.page.waitForFunction(()=>parseInt(
      document.querySelector('[data-dm-zoom]')?.textContent||'0',10)>100,
      null,{timeout:5000});
    await a.page.locator('#dungeon-map-view [data-dm="focus"]').click();
    assert.equal(await a.page.locator('[data-dm="focus"]').getAttribute('aria-pressed'),'true');
    await a.page.locator('#dungeon-map-view [data-dm="close"]').click();
    await a.page.locator('#dungeon-map-view').waitFor({state:'hidden'});
    await a.page.locator('#dungeon-lobby [data-dg="preview-map"]').click();
    await a.page.locator('#dungeon-map-view [data-dm-biome-box]:not([hidden])').waitFor();
    await a.page.setViewportSize({width:880,height:530});
    await a.page.waitForFunction(()=>{
      const canvas=document.querySelector('.dm-world'),r=canvas.getBoundingClientRect();
      return r.width>700&&r.height>300&&canvas.width>=r.width*1.9;
    });
    // One move per player, each visible to both browsers through the same SSE.
    const names={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]};
    const moveFor=uid=>{
      const p=room.members[uid].position;
      return Object.entries(names).find(([,v])=>{
        const x=p.x+v[0],y=p.y+v[1];
        return x>=0&&y>=0&&x<map.width&&y<map.height&&
          map.tiles[y*map.width+x]!==0;
      })[0];
    };
    // Compare only the world canvas, not any status badges. This checks
    // that a's remote movement visibly reaches b's map via SSE.
    const canvasHash=()=>b.page.evaluate(()=>{
      const c=document.querySelector('#dungeon-map-view .dm-world');
      const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let h=2166136261;
      for(let i=0;i<d.length;i+=4){
        h^=d[i];h=Math.imul(h,16777619);
        h^=d[i+1];h=Math.imul(h,16777619);
        h^=d[i+2];h=Math.imul(h,16777619);
      }
      return h>>>0;
    });
    const beforeRemoteMove=await canvasHash();
    const firstMove=moveFor('a');
    await a.page.locator('#dungeon-map-view [data-dm="'+firstMove+'"]').click();
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-energy]')
      ?.textContent==='99 / 100');
    await b.page.waitForFunction(before=>{
      const c=document.querySelector('#dungeon-map-view .dm-world');
      const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let h=2166136261;
      for(let i=0;i<d.length;i+=4){
        h^=d[i];h=Math.imul(h,16777619);
        h^=d[i+1];h=Math.imul(h,16777619);
        h^=d[i+2];h=Math.imul(h,16777619);
      }
      return (h>>>0)!==before;
    },beforeRemoteMove,{timeout:7000});
    await b.page.waitForFunction(()=>document.querySelector('#dungeon-lobby .dg-room-status')
      ?.textContent.includes('已集結'));
    assert.equal(room.members.a.moveSeq,1);
    assert.equal(room.members.a.explorationStamina,99);
    assert.equal(room.members.b.moveSeq,0);
    const secondMove=moveFor('b');
    await b.page.locator('#dungeon-map-view [data-dm="'+secondMove+'"]').click();
    await b.page.waitForFunction(()=>document.querySelector('[data-dm-energy]')
      ?.textContent==='99 / 100');
    assert.equal(room.members.b.moveSeq,1);
    assert.equal(room.members.a.explorationStamina,99);
    assert.equal(room.members.b.explorationStamina,99);
    // Opening the modal focuses a button. WASD must work regardless of that
    // default focus and must still obey one-cell server validation.
    const nextMove=moveFor('a');
    const key={up:'w',right:'d',down:'s',left:'a'}[nextMove];
    await a.page.locator('#dungeon-map-view [data-dm="focus"]').focus();
    await a.page.keyboard.press(key);
    try{
      await a.page.waitForFunction(()=>document.querySelector('[data-dm-energy]')
        ?.textContent==='98 / 100',null,{timeout:6000});
    }catch(error){
      console.error('[Dungeon WASD diagnostics]',{key,nextMove,requests,
        a:room.members.a,errors,focus:await a.page.evaluate(()=>({
          tag:document.activeElement?.tagName,
          action:document.activeElement?.getAttribute('data-dm'),
          energy:document.querySelector('[data-dm-energy]')?.textContent,
          error:document.querySelector('[data-dm-move-alert]')?.textContent
        }))});
      throw error;
    }
    assert.equal(room.members.a.moveSeq,2);
    assert.equal(room.members.a.explorationStamina,98);
    // Use the production combat module in the mock server, then test that
    // the warning appears before the automatic hit on both clients.
    const playerPos=room.members.a.position;
    const candidate=[[1,0],[0,1],[-1,0],[0,-1]]
      .map(([dx,dy])=>({x:playerPos.x+dx,y:playerPos.y+dy}))
      .find(p=>p.x>=0&&p.y>=0&&p.x<map.width&&p.y<map.height&&
        map.tiles[p.y*map.width+p.x]>0&&
        !(room.members.b.position.x===p.x&&room.members.b.position.y===p.y));
    assert.ok(candidate,'a neighboring cell must exist for NPC warning');
    const wolf=AI.initialEnemies(map).find(beast=>beast.kind==='wolf');
    room.enemies=[{...wolf,position:candidate,attack:null,
      lastAttack:null,lastAttackTick:0}];
    room.revision++;publish();
    await a.page.waitForFunction(()=>{
      const node=document.querySelector('[data-dm-threat]');
      return node&&!node.hidden&&/危險/.test(node.textContent);
    },null,{timeout:10000});
    assert.equal(room.members.a.battleHealth,100);
    assert.ok(room.enemies[0].attack?.cells?.some(p=>
      p.x===playerPos.x&&p.y===playerPos.y));
    await a.page.waitForFunction(()=>{
      const node=document.querySelector('[data-dm-health]');
      return node&&/生命 ([0-9]+)\/100/.test(node.textContent)&&
        Number(node.textContent.match(/生命 ([0-9]+)/)?.[1])<100;
    },null,{timeout:10000});
    await b.page.waitForFunction(()=>/修士甲 (?:9[0-2]|8\d|7\d) HP/.test(
      document.querySelector('[data-dm-team-status]')?.textContent||''
    ),null,{timeout:7000});
    assert.ok(room.members.a.battleHealth<100);
    assert.ok(room.members.b.battleHealth>=0&&room.members.b.battleHealth<=100);
    // The other player may have been attacked by autonomous patrol earlier;
    // only the visibility of A's hit and shared HP is deterministic here.
    assert.deepStrictEqual(errors,[]);
    assert.equal(requests.filter(action=>action==='move').length,3);
    // Stage 11A: use a stationary nearby beast to exercise the new player
    // attack button and verify both clients see exactly one shared defeat.
    room.enemies=[{...wolf,position:candidate,attack:null,cadence:999999,
      battleHealth:60,battleMaxHealth:60}];
    room.revision++;publish();
    await a.page.locator('#dungeon-map-view [data-dm="beasts"]').click();
    await a.page.locator('[data-dm-beast-list] button').first().click();
    await a.page.locator('[data-dm="strike"]:not([disabled])').waitFor();
    await a.page.locator('[data-dm="strike"]').click();
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-strike-alert]')
      ?.textContent.includes('傷害 30'));
    assert.equal(room.enemies[0].battleHealth,30);
    await a.page.locator('[data-dm="strike"]:not([disabled])').waitFor();
    await a.page.locator('[data-dm="strike"]').click();
    await b.page.waitForFunction(()=>document.querySelector('[data-dm="beasts"]')
      ?.textContent.includes('靈獸 0'));
    assert.equal(room.enemies.length,0);
    assert.equal(room.members.a.strikeSeq,2);
    assert.equal(room.members.a.explorationStamina,94);
    assert.equal(room.members.b.explorationStamina,99);
    assert.equal(requests.filter(action=>action==='strike').length,2);
    assert.ok(!requests.some(action=>/reward|damage/.test(action)));
    // The previously unarmed player now receives a trusted skill snapshot.
    // Verify the new buttons against the real deterministic combat module,
    // without breaking the earlier stage-11A basic-strike acceptance.
    room.members.a.accessScore=50;
    room.members.a={...room.members.a,
      ...SkillCombat.initialCombatLoadout(room.members.a,manualRecord)};
    room.enemies=[{...wolf,position:candidate,attack:null,cadence:999999,
      battleHealth:60,battleMaxHealth:60}];
    room.revision++;publish();
    await a.page.locator('#dungeon-map-view [data-dm="cast"][data-skill-id="wind-slash"]')
      .waitFor({timeout:5000});
    if(await a.page.locator('#dungeon-map-view [data-dm-inspector]').isHidden())
      await a.page.locator('#dungeon-map-view [data-dm="beasts"]').click();
    await a.page.locator('#dungeon-map-view [data-dm-beast-list] button').first().click();
    const skillButton=a.page.locator('#dungeon-map-view [data-dm="cast"][data-skill-id="wind-slash"]');
    await skillButton.click();
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-skill-alert]')
      ?.textContent.includes('流風斬'));
    assert.equal(room.members.a.skillSeq,1);
    assert.ok(room.enemies[0].battleHealth<60);
    await b.page.waitForFunction(()=>document.querySelector('[data-dm="beasts"]')
      ?.textContent.includes('靈獸 1'));
    await skillButton.click();
    await b.page.waitForFunction(()=>document.querySelector('[data-dm="beasts"]')
      ?.textContent.includes('靈獸 0'));
    assert.equal(room.enemies.length,0);
    assert.equal(room.members.a.skillSeq,2);
    assert.equal(room.members.a.explorationStamina,90);
    assert.equal(requests.filter(action=>action==='skill').length,2);
    await a.page.locator('#dungeon-map-view [data-dm="loadout"][data-loadout-index="1"]')
      .click();
    await a.page.locator('#dungeon-map-view [data-dm="cast"][data-skill-id="wind-step"]')
      .waitFor();
    assert.equal(room.members.a.dungeonLoadoutIndex,1);
    assert.ok(room.members.a.dungeonSkillIds.includes('wind-step'));
    // Stage 13: the real deterministic combat routine prepares and spends
    // the six focus charges; a separate player's map sees the same gold halo.
    activeManual=dragonRecord;
    room.members.a.accessScore=200;
    room.members.a={...room.members.a,
      ...SkillCombat.initialCombatLoadout(room.members.a,dragonRecord)};
    room.enemies=[{...wolf,position:candidate,attack:null,cadence:999999,
      battleHealth:100000,battleMaxHealth:100000}];
    room.revision++;publish();
    const focusButton=a.page.locator(
      '#dungeon-map-view [data-dm="cast"][data-skill-id="dragon-roar"]');
    await focusButton.waitFor({timeout:5000});
    assert.equal(await focusButton.getAttribute('data-focus-empowered'),'false',
      '蓄勢本身不享受蓄勢金色加成');
    await focusButton.click();
    await a.page.waitForFunction(()=>
      document.querySelector('[data-dm-focus]')?.textContent.includes('6/6'),
      null,{timeout:5000});
    assert.equal(room.members.a.focusCharges,6);
    assert.equal(room.members.a.lastSkill.focusActivated,true);
    const goldButton=a.page.locator(
      '#dungeon-map-view [data-dm="cast"][data-skill-id="dragon-strike"]');
    await a.page.waitForFunction(()=>
      document.querySelector('[data-skill-id="dragon-strike"]')
        ?.classList.contains('is-focus-empowered'));
    assert.equal(await goldButton.getAttribute('data-focus-empowered'),'true');
    assert.match(await goldButton.innerText(),/✦.*1 體力/);
    const style=await goldButton.evaluate(node=>({
      color:getComputedStyle(node).color,
      background:getComputedStyle(node).backgroundImage,
      animation:getComputedStyle(node).animationName
    }));
    assert.ok(style.background.includes('gradient'),JSON.stringify(style));
    assert.equal(style.animation,'dmTechniqueGold');
    await a.page.locator('[data-focus-uid="a"] .dm-focus-ring').waitFor();
    await b.page.locator('[data-focus-uid="a"] .dm-focus-ring').waitFor();
    assert.equal(await a.page.locator('[data-focus-uid="a"]').getAttribute('data-charges'),'6');
    assert.equal(await b.page.locator('[data-focus-uid="a"]').getAttribute('data-charges'),'6');
    // Select the durable test beast and spend all six empowered casts.
    await a.page.locator('#dungeon-map-view [data-dm="beasts"]').click();
    await a.page.locator('[data-dm-beast-list] button').first().click();
    for(let remaining=6;remaining>=1;remaining--){
      await goldButton.click();
      await a.page.waitForFunction(n=>{
        const focus=document.querySelector('[data-dm-focus]')?.textContent||'';
        return n===1?!focus.includes('/6'):focus.includes((n-1)+'/6');
      },remaining,{timeout:5000});
      assert.equal(room.members.a.focusCharges,remaining-1);
      assert.equal(room.members.a.lastSkill.focusEmpowered,true);
      assert.equal(room.members.a.lastSkill.cost,1);
      assert.equal(room.members.a.lastSkill.effectCells.length>0,true);
    }
    await a.page.locator('[data-focus-uid="a"]').waitFor({state:'detached'});
    await b.page.locator('[data-focus-uid="a"]').waitFor({state:'detached'});
    assert.equal(await goldButton.getAttribute('data-focus-empowered'),'false');
    assert.match(await goldButton.innerText(),/2 體力/);
    assert.equal(room.members.a.skillSeq,7);
    // Stage 12: the question is personal, while NPC ticks and other clients
    // keep receiving the same live dungeon room stream.
    const chargeButton=a.page.locator('#dungeon-map-view [data-dm="quiz"]');
    await chargeButton.click();
    await a.page.locator('.dm-quiz-panel:not([hidden])').waitFor();
    await a.page.locator('[data-dq="answer"][data-choice="2"]').waitFor();
    const aBefore=room.members.a.explorationStamina;
    const bBefore=room.members.b.explorationStamina;
    const previousClock=await a.page.locator('[data-dm-clock]').innerText();
    await a.page.waitForFunction(previous=>
      document.querySelector('[data-dm-clock]')?.textContent!==previous,
      previousClock,{timeout:4500});
    await a.page.locator('[data-dq="collapse"]').click();
    await a.page.locator('.dm-quiz-panel').waitFor({state:'hidden'});
    // Collapsing to dodge never discards an unanswered personal question.
    await chargeButton.click();
    await a.page.locator('[data-dq="answer"][data-choice="2"]').click();
    await a.page.locator('[data-dq="next"]:not([hidden])').waitFor();
    assert.match(await a.page.locator('.dm-quiz-explanation').innerText(),/加 3 等於 5/);
    assert.equal(room.members.a.quizCreditSeq,1);
    assert.equal(room.members.a.explorationStamina,Math.min(100,aBefore+4));
    assert.equal(room.members.b.explorationStamina,bBefore);
    await a.page.locator('[data-dq="next"]').click();
    await a.page.locator('[data-dq="answer"][data-choice="0"]').waitFor();
    await a.page.locator('[data-dq="answer"][data-choice="0"]').click();
    await a.page.locator('[data-dq="next"]:not([hidden])').waitFor();
    assert.equal(room.members.a.quizCreditSeq,2);
    assert.equal(room.members.a.explorationStamina,Math.min(100,aBefore+5));
    assert.equal(quizState.b.answered,0);
    await a.page.locator('[data-dq="collapse"]').click();
    await b.page.locator('#dungeon-map-view [data-dm="quiz"]').click();
    await b.page.locator('[data-dq="answer"][data-choice="2"]').waitFor();
    await b.page.locator('[data-dq="answer"][data-choice="2"]').click();
    await b.page.locator('[data-dq="next"]:not([hidden])').waitFor();
    assert.equal(room.members.b.quizCreditSeq,1);
    assert.equal(room.members.b.explorationStamina,Math.min(100,bBefore+4));
    assert.equal(quizState.a.answered,2);
    const priorStamina=room.members.a.explorationStamina;
    await a.page.evaluate(async()=>{
      const response=await fetch('/api/dungeon/room',{method:'POST',
        headers:{'content-type':'application/json','x-test-user':'a'},
        body:JSON.stringify({action:'quiz-credit',roomId:'dungroom000001',
          questionId:'a-q-0'})});
      if(!response.ok)throw Error('duplicate quiz credit failed');
    });
    assert.equal(room.members.a.explorationStamina,priorStamina);
    assert.equal(room.members.a.quizCreditSeq,2);
    assert.ok(requests.filter(action=>action==='generate-quiz').length>=2);
    await b.page.locator('[data-dq="collapse"]').click();
    // Stage 14: server-owned guardian, party key and validated portal opening.
    assert.equal(room.dungeonProgress.portalStatus,'sealed');
    const guardian=Objectives.spawn(map,[]).enemies[0];
    room.enemies=[{...guardian,position:{...candidate},spawn:{...candidate},
      cadence:999999,battleHealth:20}];
    room.revision++;publish();
    const blocked=await b.page.evaluate(async()=>{
      const response=await fetch('/api/dungeon/room',{method:'POST',
        headers:{'content-type':'application/json','x-test-user':'b'},
        body:JSON.stringify({action:'activate-portal',roomId:'dungroom000001',
          keyAcquired:true,portalStatus:'open'})});
      return response.status;
    });
    assert.equal(blocked,409,'clients cannot forge the shared key');
    await a.page.locator('#dungeon-map-view [data-dm="beasts"]').click();
    await a.page.locator('[data-dm-beast-list] button').first().click();
    await a.page.locator('[data-dm="cast"][data-skill-id="dragon-strike"]')
      .click();
    await a.page.waitForFunction(()=>
      document.querySelector('[data-dm-objective]')?.textContent.includes('共享密鑰'));
    assert.equal(room.enemies.length,0);
    assert.equal(room.dungeonProgress.keyAcquired,true);
    assert.equal(room.dungeonProgress.guardianStatus,'defeated');
    assert.equal(room.dungeonProgress.portalStatus,'ready');
    await b.page.waitForFunction(()=>
      document.querySelector('[data-dm-objective]')?.textContent.includes('共享密鑰'));
    const portalButton=b.page.locator('[data-dm="portal"]');
    assert.equal(await portalButton.isDisabled(),true,'portal requires spatial proximity');
    room.members.b.position={...map.portalSite};
    room.revision++;publish();
    await portalButton.waitFor({state:'visible'});
    await b.page.waitForFunction(()=>
      !document.querySelector('[data-dm="portal"]')?.disabled);
    const beforePortal=room.revision;
    await portalButton.click();
    await a.page.waitForFunction(()=>
      document.querySelector('[data-dm-objective]')?.textContent.includes('傳送門'));
    assert.equal(room.dungeonProgress.portalStatus,'open');
    assert.equal(room.dungeonProgress.openedByUid,'b');
    assert.equal(room.revision,beforePortal+1);
    await b.page.waitForFunction(()=>
      document.querySelector('[data-dm="portal"]')?.textContent.includes('已啟動'));
    const retryPortal=await a.page.evaluate(async()=>{
      const response=await fetch('/api/dungeon/room',{method:'POST',
        headers:{'content-type':'application/json','x-test-user':'a'},
        body:JSON.stringify({action:'activate-portal',roomId:'dungroom000001'})});
      return response.status;
    });
    assert.equal(retryPortal,200);
    assert.equal(room.revision,beforePortal+1,'retries never reopen the key portal');
    // Stage 15: a member at the open portal brings the whole team through.
    const bossEntry=b.page.locator('[data-dm="enter-boss"]');
    await bossEntry.waitFor({state:'visible'});
    await b.page.waitForFunction(()=>
      !document.querySelector('[data-dm="enter-boss"]')?.disabled);
    const enteringRevision=room.revision;
    const aEnergy=room.members.a.explorationStamina,
      bEnergy=room.members.b.explorationStamina;
    await bossEntry.click();
    await a.page.waitForFunction(()=>
      document.querySelector('[data-dm-title]')?.textContent.includes('首領戰'),
      null,{timeout:7000});
    await b.page.waitForFunction(()=>
      document.querySelector('[data-dm-title]')?.textContent.includes('首領戰'),
      null,{timeout:7000});
    assert.equal(room.dungeonArena,'boss');
    assert.equal(room.bossEncounter.status,'fighting');
    assert.equal(room.enemies.length,1);
    assert.equal(room.enemies[0].id,Boss.ID);
    assert.equal(room.enemies[0].battleHealth,Boss.HP);
    assert.equal(room.revision,enteringRevision+1);
    assert.equal(room.members.a.explorationStamina,aEnergy);
    assert.equal(room.members.b.explorationStamina,bEnergy);
    for(const {page} of [a,b]){
      assert.equal(await page.locator('[data-dm-boss-value]').innerText(),'900/900');
      await page.locator('[data-dm-boss-health]:not([hidden])').waitFor();
      assert.equal(await page.locator('[data-dm="enter-boss"]').isHidden(),true);
      assert.match(await page.locator('[data-dm-summary]').innerText(),/2×2 巨獸/);
    }
    const enterRetry=await a.page.evaluate(async()=>{
      const response=await fetch('/api/dungeon/room',{method:'POST',
        headers:{'content-type':'application/json','x-test-user':'a'},
        body:JSON.stringify({action:'enter-boss',roomId:'dungroom000001',
          bossHealth:0,position:{x:0,y:0}})});
      return response.status;
    });
    assert.equal(enterRetry,200);
    assert.equal(room.revision,enteringRevision+1,
      'two players cannot create duplicate bosses or teleports');
    await b.page.waitForFunction(()=>
      document.querySelector('[data-dm-boss-health]')?.getAttribute('data-phase')==='1');
    // A deterministic C room update positions the fighter near the massive
    // boss to exercise genuine martial-art targeting of all four body tiles.
    room.members.a.position={x:11,y:8};
    room.enemies[0].battleHealth=20;
    room.revision++;publish();
    await a.page.waitForFunction(()=>
      document.querySelector('[data-dm-boss-value]')?.textContent==='20/900');
    assert.equal(await a.page.locator('[data-dm-boss-health]')
      .getAttribute('data-phase'),'3');
    await a.page.locator('#dungeon-map-view [data-dm="beasts"]').click();
    await a.page.locator('[data-dm-beast-list] button').first().click();
    await a.page.locator('[data-dm="cast"][data-skill-id="dragon-strike"]').click();
    await a.page.waitForFunction(()=>
      document.querySelector('[data-dm-objective]')?.textContent.includes('已擊敗玄炎鎮殿獸'));
    await b.page.waitForFunction(()=>
      document.querySelector('[data-dm-objective]')?.textContent.includes('已擊敗玄炎鎮殿獸'));
    assert.equal(room.bossEncounter.status,'defeated');
    assert.equal(room.bossEncounter.defeatedByUid,'a');
    assert.equal(room.enemies.length,0);
    assert.equal(await b.page.locator('[data-dm-boss-value]').innerText(),'0/900');
    assert.equal(quizState.a.answered,2,'questions survive the portal');
    assert.equal(quizState.b.answered,1,'teammate study state remains private');
    assert.equal(room.dungeonProgress.keyAcquired,true);
    assert.ok(!room.rewards,'no unimplemented loot/experience granted');
    await a.context.close();await b.context.close();
    console.log('[Dungeon map browser] PASS: two clients, autonomous enemies, golden focus, quizzes, shared guardian key, portal, boss arena, 2x2 hits and shared victory');
  }finally{
    clearInterval(clockLoop);
    clockLoop=null;
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});

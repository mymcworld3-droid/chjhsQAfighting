#!/usr/bin/env node
'use strict';
// Local-only browser harness. No production accounts, AI keys or database writes.
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const express=require('express');
const {database}=require('../tests/helpers/tactical-db.cjs');
const register=require('../tactical-combat-api.cjs'),service=register.__test;
const Rules=require('../public/cultivation/tactical-rules.js');
const Stage=require('../public/game-stage-rules.js');
let playwright;try{playwright=require('playwright');}catch(_){playwright=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');}
const output=path.resolve(process.argv[2]||'/tmp/tactical-browser');fs.mkdirSync(output,{recursive:true});
async function main(){
  const db=database(),app=express();app.use(express.json());
  const legacy=fs.readFileSync(path.join(__dirname,'../public/main-legacy.js'),'utf8');
  const index=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const mathDir=process.env.TACTICAL_MATHJAX_DIR,mathStart=index.indexOf('window.MathJax = {');
  const mathHead=mathDir?'<script>'+index.slice(mathStart,index.indexOf('</script>',mathStart))+'</script><script src="/test-mathjax/es5/tex-mml-chtml.js"></script>':'';
  if(mathDir)app.use('/test-mathjax',express.static(mathDir));
  const sheets=[...index.matchAll(/<link\b[^>]*>/g)].map(m=>m[0]).filter(tag=>/rel="stylesheet"/.test(tag))
    .map(tag=>tag.match(/href="([^"]+)"/)?.[1]).filter(href=>href&&!/^https?:/.test(href));
  const theme=[...new Set([...sheets,'xianxia-bright-accents.css','styles/xianxia-quiet.css','styles/page-layout-unified.css','styles/interface-cleanup.css','styles/interface-cleanup-pages.css'])]
    .map(href=>'<link rel="stylesheet" href="/'+href+'">').join('');
  const cloud=legacy.slice(legacy.indexOf('function ensureGameStartupGateStyle()'),legacy.indexOf('\nfunction gameStartupTip('))+
    legacy.slice(legacy.indexOf('const STARTUP_CLOUD_ASSETS ='),legacy.indexOf('\nasync function enterHomeWithStartupCloudCurtain()'));
  app.get('/test-cloud.js',(_,res)=>res.type('text/javascript').send(cloud));
  db.records.get('users/u1').displayName='青雲修士';db.records.get('users/u2').displayName='雲岫道友';
  let loseMoveResponse=true,loseIntroResponse=false;
  app.use('/api/tactical/acknowledge-enemy',(req,res,next)=>{
    if(loseIntroResponse){loseIntroResponse=false;const json=res.json.bind(res);res.json=()=>{res.status(503);return json({error:'介紹已保存，但回應遺失，請重試'});};}next();
  });
  app.use('/api/tactical/action',(req,res,next)=>{
    if(req.body.type==='move'&&loseMoveResponse){loseMoveResponse=false;const json=res.json.bind(res);res.json=()=>{res.status(503);return json({error:'模擬已提交但回應遺失'});};}next();
  });
  register(app,{resolve:()=>({db}),verify:async req=>{
    const uid=req.get('x-test-user');if(!['u1','u2','u3'].includes(uid))throw Object.assign(Error('test identity required'),{status:401});return uid;
  }});
  app.post('/api/generate-quiz',async(req,res)=>{
    try{const uid=req.get('x-test-user'),expected=await service.prepareQuestion(db,uid,req.body.roomId);
      const q=expected.pending||await service.commitQuestion(db,uid,expected,{q:mathDir?'若 \\(x+2=5\\)，則 \\(x\\) 的值為何？':'若 x + 2 = 5，則 x 的值為何？',correct:'3',wrong:['1','2',mathDir?'\\(4\\)':'4'],exp:mathDir?'等號兩邊同減 \\(2\\)，得到 \\(x=3\\)。':'等號兩邊同減 2，得到 x = 3。'});
      res.json({tacticalQuestion:q});
    }catch(e){res.status(e.status||500).json({error:e.message});}
  });
  app.get('/cultivation/data/project-repository.js',(req,res)=>res.type('text/javascript').send(`export const getMainUser=()=>({uid:sessionStorage.testUid||'u1'});export const authenticatedMainFetch=(url,init={})=>fetch(url,{...init,headers:{...init.headers,'Content-Type':'application/json','X-Test-User':getMainUser().uid}});`));
  if(process.env.TACTICAL_FONT_DIR)app.use('/test-font',express.static(process.env.TACTICAL_FONT_DIR));
  app.get(['/','/index.html','/stage.html'],(_,res)=>res.sendFile(path.join(__dirname,'../public/stage.html')));
  app.get('/app.html',(req,res)=>res.type('html').send(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>青雲問道 · 戰場測試</title><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/app-stage-bridge.js"></script>${theme}${mathHead}${process.env.TACTICAL_FONT_DIR?'<link rel="stylesheet" href="/test-font/400.css">':''}<style>body{margin:0;font-family:'Noto Sans TC',system-ui;background:#101a17}button{font:inherit}#tactical-combat :is(h1,h2,h3){font-family:'Noto Sans TC',serif!important}</style></head><body class="xianxia-theme ui-cleanup"><button id="entry" onclick="startQuizFlow()">問道試煉</button><script src="/test-cloud.js"></script><script>window.__testPlayer={displayName:'青雲修士',stats:{totalScore:30},cultivationTraining:{equippedCore:{type:'thunder',grade:9}}};window.getCurrentUserData=()=>window.__testPlayer;</script><script src="/cultivation/quiz-math.js"></script><script type="module" src="/cultivation/tactical-combat.js"></script></body></html>`));
  app.use(express.static(path.join(__dirname,'../public')));
  const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  const base='http://127.0.0.1:'+server.address().port;
  let browser;
  try{browser=await playwright.chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.TACTICAL_CHROMIUM?{executablePath:process.env.TACTICAL_CHROMIUM}:{})});}
  catch(e){server.close();throw e;}
  const errors=[];
  async function make(uid,viewport){const context=await browser.newContext({viewport,deviceScaleFactor:2});await context.addInitScript(uid=>sessionStorage.testUid=uid,uid);
    await context.addInitScript(()=>{const clear=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.closest('#tactical-combat'))window.__battleDraws=(window.__battleDraws||0)+1;return Reflect.apply(clear,this,args);};});
    await context.addInitScript(()=>{window.__pickersSeen=0;window.__pickerObserver=new MutationObserver(()=>{if(document.querySelector('#tactical-combat [data-map],#tactical-combat [data-branch]'))window.__pickersSeen++;});window.__pickerObserver.observe(document,{childList:true,subtree:true});});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const frame=()=>page.frames().find(f=>f!==page.mainFrame()&&/\/app\.html(?:[?#]|$)/.test(f.url()));
    const ready=async()=>{await page.frameLocator('#game-frame').locator('#entry').waitFor();await frame().waitForFunction(()=>typeof window.openTacticalCombat==='function');};
    await page.goto(base);await ready();
    return {page,locator:(...args)=>page.frameLocator('#game-frame').locator(...args),evaluate:(...args)=>frame().evaluate(...args),
      waitForFunction:(...args)=>frame().waitForFunction(...args),screenshot:(...args)=>page.screenshot(...args),
      reload:async()=>{await page.reload();await ready();},setViewportSize:async size=>{
        await page.setViewportSize(size);
        await page.waitForFunction(target=>{const s=window.QAGameStage.getState(),f=document.getElementById('game-frame');
          const landscape=innerWidth>=innerHeight;return s.designWidth===(landscape?1280:360)&&f.contentDocument.documentElement.clientWidth===s.designWidth&&Math.abs(s.width-target.width)<.15&&Math.abs(s.height-target.height)<.15;},Stage.fit(size));
      }};}
  const read=page=>page.evaluate(async()=>{const r=await fetch('/api/tactical/state',{headers:{'X-Test-User':sessionStorage.testUid||'u1'}});return (await r.json()).state;});
  async function cell(view,x,y){const s=await read(view),point=await view.evaluate(({x,y,width,height})=>{
    const r=document.querySelector('canvas').getBoundingClientRect(),size=Math.min((r.width-20)/width,(r.height-24)/height);
    return {x:r.left+Math.round((r.width-size*width)/2)+(x+.5)*size,y:r.top+Math.round((r.height-size*height)/2)+(y+.5)*size};
  },{x,y,width:s.width,height:s.height});const frame=await view.page.locator('#game-frame').boundingBox(),stage=await view.page.evaluate(()=>window.QAGameStage.getState());
    await view.page.mouse.click(frame.x+point.x*stage.scale,frame.y+point.y*stage.scale);
  }
  const near=(a,b)=>assert.ok(Math.abs(a-b)<.15,`${a} vs ${b}`);
  async function ratio(view,{cloud=false,dialog=false}={}){
    const outer=await view.page.evaluate(()=>({stage:window.QAGameStage.getState(),width:innerWidth,height:innerHeight,scrollX,scrollY,
      background:getComputedStyle(document.body).backgroundColor})),expected=Stage.fit(outer);
    const stage=outer.stage;for(const k of ['width','height','left','top'])near(stage[k],expected[k]);
    near(stage.width/stage.height,stage.mode==='portrait'?9/16:16/9);assert.equal(outer.scrollX,0);assert.equal(outer.scrollY,0);assert.equal(outer.background,'rgb(0, 0, 0)');
    const actual=await view.evaluate(({cloud,dialog})=>{
      const selectors=['#tactical-combat',...(cloud?['#startup-cloud-curtain']:[]),...(dialog?['.tc-dialog']:[])];
      const main=document.querySelector('#tactical-combat [data-main]'),css=getComputedStyle(main);
      const buttons=[...document.querySelectorAll('#tactical-combat [data-end],#tactical-combat [data-guard],#tactical-combat [data-action],#tactical-combat [data-quiz],#tactical-combat [data-execute],#tactical-combat [data-sync],#tactical-combat [data-leave]')];
      return {width:document.documentElement.clientWidth,height:document.documentElement.clientHeight,overflow:document.documentElement.scrollWidth>innerWidth,
        mainPadding:[parseFloat(css.paddingTop),parseFloat(css.paddingBottom)],buttons:buttons.map(b=>{const r=b.getBoundingClientRect();return {name:b.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom};}),
        rects:selectors.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {selector:s,x:r.x,y:r.y,width:r.width,height:r.height};})};
    },{cloud,dialog});
    assert.equal(actual.width,stage.designWidth);assert.equal(actual.height,stage.designHeight);assert.equal(actual.overflow,false);
    assert.deepEqual(actual.mainPadding,[0,0],'battle content must not inherit page-header/navigation padding');
    for(const b of actual.buttons)assert.ok(b.left>=0&&b.right<=actual.width+.1&&b.top>=0&&b.bottom<=actual.height+.1,`${JSON.stringify(b)} must remain visible inside the ${actual.width} × ${actual.height} stage`);
    for(const r of actual.rects){if(r.selector==='.tc-dialog'){assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=actual.width+.1&&r.y+r.height<=actual.height+.1);}
      else{near(r.x,0);near(r.y,0);near(r.width,actual.width);near(r.height,actual.height);}}
  }
  async function originalQuizStyle(view){
    const pairs=await view.evaluate(()=>{
      const old=document.createElement('div');old.id='page-quiz';old.inert=true;old.setAttribute('aria-hidden','true');
      old.style.cssText='position:fixed;left:-10000px;top:0;width:900px;pointer-events:none';
      old.innerHTML='<div class="quiz-main-column"><div class="glass-panel"><h3 id="question-text">原問道題卡</h3></div><div id="options-container"></div></div>';
      const options=[...document.querySelectorAll('.tc-quiz .tc-options>button')];
      for(const button of options)old.querySelector('#options-container').append(button.cloneNode(true));
      document.body.append(old);
      const style=(el,keys)=>Object.fromEntries(keys.map(k=>[k,getComputedStyle(el)[k]]));
      try{return [
        ['question card',old.querySelector('.glass-panel'),document.querySelector('.tc-question-sheet'),['backgroundColor','borderLeftColor','borderRadius','borderLeftWidth']],
        ['question text',old.querySelector('#question-text'),document.querySelector('.tc-question'),['color','fontSize','fontWeight','lineHeight','letterSpacing']],
        ...options.map((el,i)=>['option '+i,old.querySelectorAll('#options-container>button')[i],el,['backgroundColor','backgroundImage','borderColor','borderRadius','color','fontSize']])
      ].map(([name,a,b,keys])=>({name,original:style(a,keys),current:style(b,keys)}));}finally{old.remove();}
    });
    for(const pair of pairs)assert.deepEqual(pair.current,pair.original,pair.name+' must keep the original question-page appearance');
  }
  async function mathIsWhite(view,review=false){
    if(!mathDir)return;
    await view.locator((review?'.tc-feedback-text':'.tc-question')+' mjx-container').first().waitFor();
    const colors=await view.evaluate(()=>[...document.querySelectorAll('.tc-quiz mjx-container,.tc-quiz mjx-container *')].map(el=>({color:getComputedStyle(el).color,fill:getComputedStyle(el).webkitTextFillColor})));
    assert.ok(colors.length>10,'use real MathJax output in the question and explanation');
    assert.ok(colors.every(c=>c.color==='rgb(255, 255, 255)'&&c.fill==='rgb(255, 255, 255)'),'all rendered formula descendants remain white');
  }
  async function acknowledgeIntros(view){
    for(let i=0;i<20&&await view.locator('[data-intro-ack]').count();i++){
      await view.waitForFunction(()=>!document.querySelector('[data-intro-ack]').disabled);await ratio(view,{dialog:true});
      const name=await view.locator('.tc-encounter h2').textContent(),profile=Rules.MONSTERS.find(p=>p.name===name);
      assert.ok(profile);assert.ok((await view.locator('.tc-enemy-attack').textContent()).includes(profile.attackText));
      const button=await view.evaluate(()=>{const r=document.querySelector('[data-intro-ack]').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight};});
      assert.ok(button.top>=0&&button.bottom<=button.height,'introduction confirmation remains inside the stage');
      await view.locator('[data-intro-ack]').click();
      await view.waitForFunction(name=>!document.querySelector('[data-intro-ack]')||document.querySelector('.tc-encounter h2').textContent!==name,name);
    }
    assert.equal(await view.locator('[data-intro-ack]').count(),0);
  }
  async function enemyDemoChecks(view){
    const checkpoint=structuredClone([...db.records]),traffic=[];
    const track=request=>{if(request.url().includes('/api/'))traffic.push(request.url());};view.page.on('request',track);
    const canvas=view.locator('[data-enemy-demo] canvas');await canvas.waitFor();
    const phase=name=>view.waitForFunction(name=>document.querySelector('[data-enemy-demo] canvas')?.dataset.demoPhase===name,name,{timeout:18000});
    const pixels=()=>view.evaluate(()=>{const c=document.querySelector('[data-enemy-demo] canvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let h=0;for(let i=0;i<p.length;i+=4)h=Math.imul(h^p[i]^p[i+1]<<8^p[i+2]<<16,16777619);return h;});
    const moment=()=>view.evaluate(()=>new Promise(resolve=>{let count=0;function next(){if(++count===12)resolve();else requestAnimationFrame(next);}requestAnimationFrame(next);}));
    try{
      await phase('warning');await ratio(view,{dialog:true});await view.screenshot({path:path.join(output,'enemy-demo-wolf-mobile.png')});
      await phase('hit');const before=await pixels();await moment();assert.notEqual(await pixels(),before,'the actual attack changes canvas pixels over time');
      await view.locator('[data-demo-toggle]').click();assert.equal(await view.locator('[data-demo-toggle]').getAttribute('aria-pressed'),'true');
      const still=await pixels();await moment();assert.equal(await pixels(),still,'pause freezes the current simulation frame');
      await view.locator('[data-demo-replay]').click();assert.equal(await view.locator('[data-demo-toggle]').getAttribute('aria-pressed'),'false','replay restarts a paused demonstration');
      await phase('escape');await phase('success');
      assert.match(await view.locator('[data-demo-caption]').textContent(),/生命不減/);
      await view.locator('[data-demo-replay]').click();await phase('movement');
      await view.page.emulateMedia({reducedMotion:'reduce'});await view.locator('[data-demo-next]').waitFor();
      const reduced=await pixels();await moment();assert.equal(await pixels(),reduced,'reduced motion uses a steady manual preview');
      const step=await canvas.getAttribute('data-demo-step');await view.locator('[data-demo-next]').click();assert.notEqual(await canvas.getAttribute('data-demo-step'),step);
      await view.page.emulateMedia({reducedMotion:'no-preference'});
      await view.locator('[data-demo-toggle]').click();
      const coverage=await view.evaluate(async()=>{
        const {EnemyDemo}=await import('/cultivation/tactical-enemy-demo.js'),template=document.querySelector('.tc-encounter'),results=[];template.hidden=true;
        try{
        for(let species=0;species<20;species++){
          const card=template.cloneNode(true),profile=window.QATactical.monsterProfile(species);card.hidden=false;card.style.animation='none';card.setAttribute('aria-hidden','true');
          card.querySelector('h2').textContent=profile.name;card.querySelector('.tc-enemy-attack h3').textContent=profile.attackName;card.querySelector('.tc-enemy-attack p').textContent=profile.attackText;
          const details=card.querySelectorAll('.tc-enemy-details dd');details[0].textContent=profile.moveText;details[1].textContent=profile.tip;
          template.parentElement.append(card);const host=card.querySelector('[data-enemy-demo]');
          const demo=new EnemyDemo(host,species);demo.paused=true;
          try{
            await Promise.all(Object.values(demo.renderer.images).map(img=>img.complete?null:new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});})));
            for(const beat of demo.demo.beats){
              const hashes=[];for(const p of [.2,.6]){
                demo.elapsed=beat.start+beat.duration*p;demo.refresh();const c=host.querySelector('canvas'),bytes=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
                let hash=0;for(let i=0;i<bytes.length;i+=4)hash=Math.imul(hash^bytes[i]^bytes[i+1]<<8^bytes[i+2]<<16,16777619);hashes.push(hash);
              }
              results.push({species,phase:beat.phase,animated:!!beat.scene,changed:hashes[0]!==hashes[1]});
            }
            const rect=card.getBoundingClientRect(),buttons=[...card.querySelectorAll('.tc-enemy-footer button,.tc-demo-tools button:not([hidden])')].map(b=>b.getBoundingClientRect());
            results.push({species,phase:'layout',animated:false,cell:demo.renderer.cell,layout:rect.top>=0&&rect.bottom<=innerHeight&&buttons.every(b=>b.top>=rect.top&&b.bottom<=rect.bottom)});
          }finally{demo.destroy();card.remove();}
        }}finally{template.hidden=false;}return results;
      });
      assert.equal(new Set(coverage.map(r=>r.species)).size,20);assert.ok(coverage.filter(r=>r.animated).every(r=>r.changed),'every monster simulation really animates its moves and attacks');
      assert.ok(coverage.filter(r=>r.phase==='layout').every(r=>r.layout),'every monster introduction keeps its simulation and confirmation buttons visible');
      assert.ok(coverage.find(r=>r.species===0&&r.phase==='layout').cell>25,'the compact camera makes adjacent attacks legible on a phone');
      for(const size of [{width:1280,height:720},{width:393,height:852}]){
        await view.setViewportSize(size);await ratio(view,{dialog:true});
        const footer=await view.evaluate(()=>[...document.querySelectorAll('.tc-enemy-footer button,.tc-demo-tools button:not([hidden])')].map(b=>{const r=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight};}));
        assert.ok(footer.every(b=>b.top>=0&&b.bottom<=b.height),'simulation and acknowledgement controls remain inside the stage');
      }
      assert.deepEqual([...db.records],checkpoint,'all demonstrations preserve the real room, stamina, rewards and seen-species records');assert.deepEqual(traffic,[],'watching and controlling demos never calls the API');
    }finally{view.page.off('request',track);}
  }
  async function correct(page){
    await page.locator('[data-quiz]').click();await page.locator('[data-choice]').first().waitFor();await ratio(page,{dialog:true});await originalQuizStyle(page);await mathIsWhite(page);
    const orientation=await page.evaluate(()=>innerWidth<innerHeight?'portrait':'landscape');
    await page.screenshot({path:path.join(output,'question-'+orientation+'.png')});
    await page.locator('[data-choice]').filter({hasText:/^\w?3$/}).click();await page.locator('[data-continue]').waitFor();await originalQuizStyle(page);await mathIsWhite(page,true);
    await page.locator('[data-continue]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'question-review-'+orientation+'.png')});
    await page.locator('[data-continue]').click();await page.waitForFunction(()=>!document.querySelector('[data-end]').disabled);
  }
  async function rangePreviewChecks(view){
    const current=await read(view),key=service.ROOMS+'/'+current.id,saved=db.records.get(key);
    const room=Rules.create({id:current.id,mode:'pve',players:[{...saved.actors[0],core:'thunder',branch:'lightning'}]});
    room.pendingIntroductions={u1:[]};
    Object.assign(room.actors[0],{x:3,y:3,stamina:8,knowledgeScope:saved.actors[0].knowledgeScope});
    room.blocks=[{x:3,y:2}];room.actors=[room.actors[0],...[[4,3],[5,3],[4,4]].map(([x,y],i)=>Rules.actor({uid:'monster-'+i,name:'演武妖獸',bot:true,team:'monster',atk:100,maxHp:1000,species:i},{x,y,intent:{kind:'advance',cells:[],text:'下次：向你接近'}}))];
    room.revision=saved.revision+1;db.records.set(key,room);
    await view.setViewportSize({width:393,height:852});await view.locator('[data-sync]').click();
    await view.waitForFunction(()=>document.querySelector('[data-stamina] strong').textContent==='8'&&!document.querySelector('[data-end]').disabled);
    await view.locator('[data-action="move"]').click();
    const sample=(positions,duration)=>view.evaluate(({positions,duration})=>new Promise(resolve=>{
      const started=performance.now(),samples=[];
      function frame(now){const canvas=document.querySelector('#tactical-combat canvas'),r=canvas.getBoundingClientRect(),size=Math.min((r.width-20)/7,(r.height-24)/7),ox=Math.round((r.width-size*7)/2),oy=Math.round((r.height-size*7)/2),scale=canvas.width/r.width;
        samples.push(positions.map(p=>Array.from(canvas.getContext('2d').getImageData(Math.floor((ox+(p.x+.8)*size)*scale),Math.floor((oy+(p.y+.8)*size)*scale),1,1).data)));
        if(now-started>=duration)resolve(samples);else requestAnimationFrame(frame);
      }requestAnimationFrame(frame);
    }),{positions,duration});
    const pulse=await sample([{x:2,y:3}],1500),values=pulse.map(p=>p[0][0]);
    assert.ok(Math.max(...values)-Math.min(...values)>8,'reachable gray cells must visibly pulse');
    await view.page.emulateMedia({reducedMotion:'reduce'});
    const still=await sample([{x:2,y:3}],180);assert.deepEqual(still[0],still.at(-1),'reduced motion keeps a steady gray range');
    await view.screenshot({path:path.join(output,'range-move-mobile.png')});await ratio(view);
    await view.page.emulateMedia({reducedMotion:'no-preference'});
    const quiet=()=>view.evaluate(()=>new Promise(resolve=>{const before=window.__battleDraws;let frames=0;function frame(){if(++frames===8)resolve(window.__battleDraws-before);else requestAnimationFrame(frame);}requestAnimationFrame(frame);}));
    await view.locator('[data-quiz]').click();await view.locator('[data-choice]').first().waitFor();
    assert.equal(await quiet(),0,'question dialog pauses the battle animation');await view.locator('[data-dismiss]').click();
    assert.ok(await quiet()>0,'closing the question resumes the move preview');
    await view.locator('[data-close]').click();assert.equal(await quiet(),0,'closing the battle stops drawing');
    await view.locator('#entry').click();await view.locator('.tc-arena canvas').waitFor();await view.locator('#startup-cloud-curtain').waitFor({state:'detached'});
    assert.ok(await quiet()>0,'resuming a closed battle rebuilds its interactive renderer');
    await view.locator('[data-action="attack"]').click();
    const colors=(await sample([{x:2,y:3},{x:1,y:3},{x:2,y:2},{x:0,y:3}],0))[0];
    assert.ok(colors[0][0]-colors[0][1]>25&&colors[1][0]-colors[1][1]>25,'both cells of a cardinal ray are red');
    assert.ok(colors[2][0]-colors[2][1]<25&&colors[3][0]-colors[3][1]<25,'diagonals and third cells are outside the normal attack range');
    assert.equal(await quiet(),0,'static attack ranges do not keep repainting');
    await cell(view,4,3);assert.match(await view.locator('[data-execute]').textContent(),/向右攻擊/);
    await view.screenshot({path:path.join(output,'range-attack-mobile.png')});await ratio(view);
    await view.locator('[data-execute]').click();await view.waitForFunction(()=>!document.querySelector('[data-end]').disabled);
    const hit=await read(view);assert.deepEqual(hit.actors.slice(1).map(a=>a.hp),[800,800,1000]);assert.equal(hit.actors[0].stamina,6);
    await view.locator('[data-action="skill"]').click();
    const diagonal=(await sample([{x:2,y:2}],0))[0][0];assert.ok(diagonal[0]-diagonal[1]>25,'area core uses its own diamond aiming range');
    await cell(view,4,3);await view.screenshot({path:path.join(output,'range-core-mobile.png')});await ratio(view);
    await view.locator('[data-execute]').click();await view.waitForFunction(()=>!document.querySelector('[data-end]').disabled);
    const cast=await read(view);assert.deepEqual(cast.actors.slice(1).map(a=>a.hp),[520,520,720]);assert.equal(cast.actors[0].stamina,2);
    saved.revision=cast.revision+1;db.records.set(key,saved);await view.locator('[data-sync]').click();await view.waitForFunction(()=>!document.querySelector('[data-end]').disabled);
    await view.locator('[data-action="move"]').click();await ratio(view);
  }
  async function animationChecks(view){
    const checkpoint=new Map([...db.records].map(([k,v])=>[k,structuredClone(v)]));
    const current=await read(view),key=service.ROOMS+'/'+current.id,saved=structuredClone(db.records.get(key));
    const room=Rules.create({id:current.id,mode:'pve',players:[{...saved.actors[0],core:'ocean',branch:'surge',maxHp:10000}]});
    room.pendingIntroductions={u1:[]};room.blocks=[];Object.assign(room.actors[0],{x:2,y:3,stamina:10,knowledgeScope:saved.actors[0].knowledgeScope});
    room.actors=[room.actors[0],...[[0,3,2],[8,4,2],[12,6,6],[3,6,0]].map(([species,x,y],i)=>Rules.actor({uid:'monster-'+i,name:Rules.monsterProfile(species).name,bot:true,team:'monster',species,atk:100,maxHp:2000},{x,y}))];
    Rules.prepareIntents(room);room.revision=saved.revision+1;db.records.set(key,room);
    await view.setViewportSize({width:393,height:852});await view.locator('[data-sync]').click();await view.waitForFunction(()=>!document.querySelector('[data-end]').disabled);
    await view.evaluate(()=>{
      window.__animationHistory=[];const canvas=document.querySelector('#tactical-combat canvas');
      window.__animationObserver=new MutationObserver(()=>{const kind=canvas.dataset.animation;if(kind)window.__animationHistory.push({kind,locked:document.querySelector('[data-end]').disabled,result:!!document.querySelector('[data-next-stage]')});});
      window.__animationObserver.observe(canvas,{attributes:true,attributeFilter:['data-animation']});
    });
    const reset=()=>view.evaluate(()=>{window.__animationHistory=[];});
    const idle=()=>view.waitForFunction(()=>document.querySelector('#tactical-combat canvas').getAttribute('aria-busy')==='false'&&!document.querySelector('[data-end]').disabled);
    const beat=()=>view.evaluate(()=>new Promise(resolve=>{let frames=0;function next(){if(++frames===8)resolve();else requestAnimationFrame(next);}requestAnimationFrame(next);}));
    await view.locator('[data-action="move"]').click();await cell(view,2,2);await view.locator('[data-execute]').click();
    await view.locator('canvas[data-animation="move"]').waitFor();assert.equal(await view.locator('[data-end]').isDisabled(),true);
    await beat();await view.screenshot({path:path.join(output,'animation-move-mobile.png')});await idle();
    assert.equal((await read(view)).actors[0].stamina,9);await reset();
    await view.locator('[data-action="attack"]').click();await cell(view,3,2);await view.locator('[data-execute]').click();
    await view.locator('canvas[data-animation="cast"]').waitFor();await beat();await view.screenshot({path:path.join(output,'animation-attack-mobile.png')});
    await view.locator('canvas[data-animation="damage"]').waitFor();await beat();await view.screenshot({path:path.join(output,'animation-damage-mobile.png')});await idle();
    const attackHistory=await view.evaluate(()=>window.__animationHistory);assert.ok(attackHistory.some(e=>e.kind==='cast'));assert.ok(attackHistory.some(e=>e.kind==='damage'));assert.ok(attackHistory.every(e=>e.locked&&!e.result));
    await reset();await view.locator('[data-action="skill"]').click();await cell(view,3,2);await view.locator('[data-execute]').click();
    await view.locator('canvas[data-animation="cast"]').waitFor();await beat();await view.screenshot({path:path.join(output,'animation-core-mobile.png')});await idle();
    const coreHistory=await view.evaluate(()=>window.__animationHistory);assert.ok(coreHistory.some(e=>e.kind==='move'),'ocean push is visible after its hit');
    await reset();await view.locator('[data-end]').click();await idle();
    const monsters=await view.evaluate(()=>window.__animationHistory);assert.ok(monsters.filter(e=>e.kind==='move').length>=2,'a multi-monster turn shows individual movement');assert.ok(monsters.filter(e=>e.kind==='turn').length>=2);
    // Guard, answer recovery and focus/visibility changes use the same real UI.
    await view.locator('[data-guard]').click();await view.locator('canvas[data-animation="guard"]').waitFor();
    await view.locator('[data-leave]').click();await view.locator('[data-dismiss]').waitFor();
    const pausedDraws=await view.evaluate(()=>new Promise(resolve=>{const before=window.__battleDraws;let frames=0;function next(){if(++frames===8)resolve(window.__battleDraws-before);else requestAnimationFrame(next);}requestAnimationFrame(next);}));
    assert.equal(pausedDraws,0,'opening the leave dialog freezes the active action without skipping it');
    await view.locator('[data-dismiss]').click();await view.locator('canvas[data-animation="guard"]').waitFor();await beat();await view.screenshot({path:path.join(output,'animation-guard-mobile.png')});await idle();
    await correct(view);assert.equal((await read(view)).actors[0].stamina,7);
    await reset();await view.locator('[data-sync]').click();await idle();assert.deepEqual(await view.evaluate(()=>window.__animationHistory),[],'same snapshot cannot replay an action');
    await view.page.emulateMedia({reducedMotion:'reduce'});await reset();
    await view.locator('[data-guard]').click();await idle();assert.deepEqual(await view.evaluate(()=>window.__animationHistory),[],'reduced motion applies the final state immediately');
    await view.page.emulateMedia({reducedMotion:'no-preference'});
    // A lethal strike must finish its impact/fade before opening the result.
    const lethal=db.records.get(key);lethal.actors[0].attacks=0;lethal.actors[0].stamina=10;
    lethal.actors=lethal.actors.slice(0,2);Object.assign(lethal.actors[1],{x:lethal.actors[0].x+1,y:lethal.actors[0].y,hp:1});lethal.revision++;
    await view.locator('[data-sync]').click();await idle();await reset();
    await view.locator('[data-action="attack"]').click();await cell(view,lethal.actors[1].x,lethal.actors[1].y);await view.locator('[data-execute]').click();
    await view.locator('canvas[data-animation="damage"]').waitFor();assert.equal(await view.locator('[data-next-stage]').count(),0);
    await view.locator('canvas[data-animation="finish"]').waitFor();await beat();await view.screenshot({path:path.join(output,'animation-victory-mobile.png')});
    await view.locator('[data-next-stage]').waitFor();assert.equal(await view.locator('.tc-arena canvas').getAttribute('aria-busy'),'false');
    await view.evaluate(()=>window.__animationObserver.disconnect());
    saved.revision=(await read(view)).revision+1;db.records.clear();for(const [k,v]of checkpoint)db.records.set(k,v);db.records.set(key,saved);
    await view.locator('[data-exit]').click();await view.locator('#entry').click();await view.locator('#startup-cloud-curtain').waitFor({state:'detached'});await idle();
  }
  async function animationRenderingCoverage(view){
    const result=await view.evaluate(async()=>{
      const {TacticalRenderer}=await import('/cultivation/tactical-renderer.js'),R=window.QATactical,A=window.QATacticalAnimation;
      const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;left:0;top:0;width:300px;height:300px;z-index:30000';document.body.append(canvas);
      const renderer=new TacticalRenderer(canvas,()=>{}),checks=[];
      const fixture=(core='thunder',branch='lightning')=>{
        const s=R.create({id:'render-coverage',players:[{uid:'u1',name:'修士',core,branch,maxHp:10000}],now:2000000000000});
        s.blocks=[];Object.assign(s.actors[0],{x:1,y:3,hp:5000,stamina:10});Object.assign(s.actors[1],{x:3,y:3,hp:2000,maxHp:2000});return s;
      };
      const render=(before,next)=>{
        renderer.update(before,'u1','attack',null);renderer.state=next;
        for(const scene of A.plan(before,next,'u1')){
          const hashes=[];renderer.queue=[];
          for(const progress of [.2,.6]){
            renderer.scene={...scene,started:performance.now()-scene.duration*progress};renderer.draw();
            const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
            let hash=2166136261;for(let i=0;i<pixels.length;i+=4)hash=Math.imul(hash^pixels[i]^pixels[i+1]<<8^pixels[i+2]<<16,16777619);
            hashes.push(hash);
          }checks.push({kind:scene.kind,style:scene.style,changed:hashes[0]!==hashes[1]});
        }
      };
      try{
        for(const [core,c]of Object.entries(R.CORES))for(const branch of c.branches){
          const s=fixture(core,branch.id),sk=branch.skill,p=sk.range===0?s.actors[0]:sk.kind==='blink'?{x:2,y:3}:{x:3,y:3};
          const next=R.apply(s,'u1',{type:'skill',x:p.x,y:p.y},2000000000000);render(s,next);
          if(sk.kind==='meteor'){next.actors[1].intent={kind:'wait',cells:[]};render(next,R.apply(next,'u1',{type:'end'},2000000000000));}
        }
        for(const profile of R.MONSTERS){
          const s=fixture();s.width=11;s.height=11;Object.assign(s.actors[0],{x:5,y:5});const m=s.actors[1];m.species=profile.species;
          const spots=Array.from({length:121},(_,i)=>({x:i%11,y:Math.floor(i/11)}));
          const origin=spots.find(p=>R.key(p)!==R.key(s.actors[0])&&R.dist(p,s.actors[0])>=(profile.move.minDistance||0)&&R.monsterCells(s,{...m,...p},s.actors[0]).some(c=>R.key(c)===R.key(s.actors[0])));
          Object.assign(m,origin);R.prepareIntents(s);render(s,R.apply(s,'u1',{type:'end'},2000000000000));
          Object.assign(m,{x:0,y:0,intent:{kind:'advance',cells:[]}});Object.assign(s.actors[0],{x:9,y:9});render(s,R.apply(s,'u1',{type:'end'},2000000000000));
        }
        const s=fixture();render(s,R.answer(s,'u1',true));render(s,R.apply(s,'u1',{type:'guard'}));
        return checks;
      }finally{renderer.destroy();canvas.remove();}
    });
    assert.ok(result.length>150,'render every core, monster attack and monster movement through the real canvas');
    assert.ok(result.every(r=>r.changed),'different action phases must produce visibly different pixels');
  }
  try{
    const mobile=await make('u1',{width:393,height:852});
    await mobile.locator('#entry').click();await mobile.locator('#startup-cloud-curtain').waitFor();
    await mobile.locator('.tc-arena canvas').waitFor();await mobile.locator('#startup-cloud-curtain').waitFor({state:'detached'});
    await ratio(mobile);
    assert.deepEqual((await read(mobile)).newEnemies,[0]);await mobile.locator('.tc-encounter').waitFor();await ratio(mobile,{dialog:true});
    await enemyDemoChecks(mobile);
    await mobile.screenshot({path:path.join(output,'enemy-intro-wolf-mobile.png')});
    await mobile.reload();await mobile.locator('#entry').click();await mobile.locator('#startup-cloud-curtain').waitFor({state:'detached'});await mobile.locator('[data-intro-ack]').waitFor();
    assert.deepEqual((await read(mobile)).newEnemies,[0],'unread encounter survives refresh');await acknowledgeIntros(mobile);
    await mobile.reload();await mobile.locator('#entry').click();await mobile.locator('.tc-arena canvas').waitFor();await mobile.locator('#startup-cloud-curtain').waitFor({state:'detached'});
    assert.equal(await mobile.locator('[data-intro-ack]').count(),0,'acknowledged species does not repeat after refresh');
    assert.equal(await mobile.locator('[data-start],[data-map],[data-branch]').count(),0,'trial entry skips both pickers');
    assert.equal((await read(mobile)).trial.stage,1);await correct(mobile);
    assert.equal((await read(mobile)).actors[0].stamina,6);
    assert.equal(await mobile.evaluate(()=>getCurrentUserData().stats.totalScore),31,'answer progress updates the existing account UI immediately');
    const beforeMove=await read(mobile),pos=Rules.neighbours(beforeMove,beforeMove.actors[0]).find(p=>!Rules.at(beforeMove,p));
    await cell(mobile,pos.x,pos.y);await mobile.locator('[data-execute]').click();await mobile.waitForFunction(()=>!document.querySelector('[data-end]').disabled);
    const moved=await read(mobile);assert.equal(moved.actors[0].stamina,5,'lost move response retry must not charge twice');assert.equal(Rules.key(moved.actors[0]),Rules.key(pos));
    await mobile.locator('[data-end]').click();await mobile.waitForFunction(()=>document.querySelector('[data-turn]').textContent.includes('第 2')&&!document.querySelector('[data-end]').disabled);
    await mobile.locator('[data-end]').click();await mobile.waitForFunction(()=>document.querySelector('[data-turn]').textContent.includes('第 3')&&!document.querySelector('[data-end]').disabled);
    await mobile.screenshot({path:path.join(output,'battle-mobile.png')});
    assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const rect=await mobile.locator('.tc-arena canvas').boundingBox();assert.ok(rect.height>200,'mobile board must remain playable');
    await mobile.reload();await mobile.waitForFunction(()=>typeof window.openTacticalCombat==='function');await mobile.locator('#entry').click();await mobile.locator('.tc-arena canvas').waitFor();await mobile.locator('#startup-cloud-curtain').waitFor({state:'detached'});
    assert.equal((await read(mobile)).turn,3,'refresh resumes the same room');
    for(const [width,height,name]of [[1280,720,'battle-landscape'],[1024,768,'battle-tablet-landscape'],[768,1024,'battle-tablet-portrait'],[1920,800,'battle-ultrawide'],[844,390,'battle-phone-landscape']]){
      await mobile.setViewportSize({width,height});await ratio(mobile);await mobile.screenshot({path:path.join(output,name+'.png')});
    }
    assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await rangePreviewChecks(mobile);
    await animationChecks(mobile);
    await animationRenderingCoverage(mobile);
    // Reproduce the reported exhausted-stamina view with the densest later-stage HUD.
    const room=await read(mobile),key=service.ROOMS+'/'+room.id,saved=db.records.get(key);
    let denseStage=10;while(true){const layout=Rules.stageLayout('layout-fit',denseStage);if(layout.width===11&&layout.enemies.length===4)break;denseStage++;}
    const dense=Rules.create({id:room.id,mode:'pve',players:[{...saved.actors[0],name:'《九州》陳長青',maxHp:2400}],trial:{seed:'layout-fit',stage:denseStage}});
    dense.pendingIntroductions={u1:[]};
    Object.assign(dense.actors[0],{stamina:0,questions:2,attacks:1});dense.revision=saved.revision+1;db.records.set(key,dense);
    await mobile.locator('[data-sync]').click();await mobile.waitForFunction(()=>document.querySelector('[data-stamina] strong').textContent==='0');
    for(const size of [{width:393,height:852},{width:1280,height:720}]){
      await mobile.setViewportSize(size);await mobile.screenshot({path:path.join(output,'battle-exhausted-'+(size.width<size.height?'mobile':'landscape')+'.png')});
      await ratio(mobile);assert.equal(await mobile.locator('.tc-actor').count(),5);
      assert.equal(await mobile.locator('[data-end]').isEnabled(),true,'end turn stays usable when stamina and questions are exhausted');
    }
    await mobile.setViewportSize({width:393,height:852});
    await mobile.locator('[data-end]').click();await mobile.waitForFunction(()=>document.querySelector('[data-turn]').textContent.includes('第 2 回合'));await ratio(mobile);
    saved.revision=(await read(mobile)).revision+1;db.records.set(key,saved);await mobile.locator('[data-sync]').click();
    await mobile.waitForFunction(()=>!document.querySelector('[data-end]').disabled);await ratio(mobile);
    const prior=await read(mobile),raw=db.records.get(service.ROOMS+'/'+prior.id),hero=raw.actors[0],monster=raw.actors[1];
    raw.blocks=[];hero.stamina=5;monster.x=hero.x+1;monster.y=hero.y;monster.hp=1;
    await mobile.locator('[data-sync]').click();await mobile.waitForFunction(()=>!document.querySelector('[data-end]').disabled);
    await mobile.locator('[data-action="attack"]').click();await cell(mobile,monster.x,monster.y);await mobile.locator('[data-execute]').click();
    await mobile.locator('[data-next-stage]').waitFor();await mobile.locator('[data-next-stage]').click();
    await mobile.locator('#startup-cloud-curtain.is-closed').waitFor();await ratio(mobile,{cloud:true});await mobile.locator('#startup-cloud-curtain').waitFor({state:'detached'});
    const next=await read(mobile);assert.equal(next.trial.stage,2);assert.equal(next.trial.seed,prior.trial.seed);assert.notEqual(next.id,prior.id);
    assert.deepEqual(next.newEnemies,[8],'stage two introduces the new rock beast');
    await mobile.setViewportSize({width:393,height:852});await mobile.screenshot({path:path.join(output,'enemy-intro-rock-mobile.png')});await acknowledgeIntros(mobile);
    assert.equal(await mobile.evaluate(()=>window.__pickersSeen),0);await mobile.evaluate(()=>window.__pickerObserver.disconnect());
    await mobile.setViewportSize({width:393,height:852});await ratio(mobile);await mobile.screenshot({path:path.join(output,'trial-stage-2-mobile.png')});
    await mobile.reload();await mobile.waitForFunction(()=>typeof window.openTacticalCombat==='function');await mobile.locator('#entry').click();await mobile.locator('.tc-arena canvas').waitFor();await mobile.locator('#startup-cloud-curtain').waitFor({state:'detached'});
    assert.equal((await read(mobile)).id,next.id,'refresh resumes the current randomized stage');
    assert.equal(await mobile.locator('[data-intro-ack]').count(),0);
    // Two unseen species in one stage are introduced in order; a lost
    // acknowledgement response can be retried without duplicate progress.
    const introKey=service.ROOMS+'/'+next.id,introSaved=structuredClone(db.records.get(introKey)),introRoom=db.records.get(introKey);
    introRoom.actors.push(...[1,2].map((species,i)=>Rules.actor({uid:'intro-'+i,name:Rules.monsterProfile(species).name,bot:true,team:'monster',species},{x:i,y:0})));
    introRoom.pendingIntroductions={u1:[1,2]};introRoom.revision++;await mobile.locator('[data-sync]').click();await mobile.locator('[data-intro-ack]').waitFor();
    assert.equal(await mobile.locator('.tc-encounter h2').textContent(),'玄甲山豬');await mobile.screenshot({path:path.join(output,'enemy-intro-boar-mobile.png')});
    loseIntroResponse=true;await mobile.locator('[data-intro-ack]').click();
    await mobile.locator('.tc-enemy-error:not([hidden])').waitFor();assert.ok(db.records.get(service.PLAYERS+'/u1').bestiary.seen.includes(1));
    await acknowledgeIntros(mobile);
    assert.ok(db.records.get(service.PLAYERS+'/u1').bestiary.seen.includes(2));
    introSaved.revision=introRoom.revision+1;db.records.set(introKey,introSaved);await mobile.locator('[data-sync]').click();await mobile.waitForFunction(()=>!document.querySelector('[data-end]').disabled);
    await mobile.locator('[data-leave]').click();await mobile.locator('[data-forfeit]').click();await mobile.locator('[data-exit]').click();
    await mobile.evaluate(()=>window.startBattleMatchmaking());await mobile.locator('[data-start]').click();await mobile.locator('.tc-waiting').waitFor();
    const waiting=await read(mobile),p2=await make('u2',{width:1280,height:720});await p2.evaluate(()=>window.openTacticalCombat('pvp'));
    await p2.locator('[data-code]').fill(waiting.id.replace('arena-',''));await p2.locator('[data-join]').click();await p2.locator('.tc-arena canvas').waitFor();
    await mobile.locator('.tc-arena canvas').waitFor({timeout:15000});assert.equal((await read(p2)).id,waiting.id);
    await ratio(mobile);await ratio(p2);
    assert.equal(await p2.locator('[data-quiz]').isDisabled(),true);
    await correct(mobile);await mobile.locator('[data-end]').click();await p2.waitForFunction(()=>!document.querySelector('[data-quiz]').disabled,{timeout:15000});
    await correct(p2);assert.equal((await read(p2)).actors.find(a=>a.uid==='u2').stamina,6);
    await p2.screenshot({path:path.join(output,'duel-landscape.png')});
    assert.deepEqual(errors,[]);console.log('Browser checks passed: 20 live enemy introductions with movement/hit/dodge simulations, compact cameras retaining full attack shapes, pause/replay/manual steps and zero API calls or account mutations; shared 16:9 / 9:16 stage, six screen sizes, original question styles, visible controls with four enemies and zero stamina, gray/red ranges, white MathJax, persistent introductions, ordered combat effects/input lock, every core/monster canvas effect, paused action resume, reduced motion/no duplicate replay, defeat before results, lost-response retry, trial progression and two-player synchronization.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

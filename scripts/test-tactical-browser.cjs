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
  const sheets=[...index.matchAll(/<link\b[^>]*>/g)].map(m=>m[0]).filter(tag=>/rel="stylesheet"/.test(tag))
    .map(tag=>tag.match(/href="([^"]+)"/)?.[1]).filter(href=>href&&!/^https?:/.test(href));
  const theme=[...new Set([...sheets,'xianxia-bright-accents.css','styles/xianxia-quiet.css','styles/page-layout-unified.css','styles/interface-cleanup.css','styles/interface-cleanup-pages.css'])]
    .map(href=>'<link rel="stylesheet" href="/'+href+'">').join('');
  const cloud=legacy.slice(legacy.indexOf('function ensureGameStartupGateStyle()'),legacy.indexOf('\nfunction gameStartupTip('))+
    legacy.slice(legacy.indexOf('const STARTUP_CLOUD_ASSETS ='),legacy.indexOf('\nasync function enterHomeWithStartupCloudCurtain()'));
  app.get('/test-cloud.js',(_,res)=>res.type('text/javascript').send(cloud));
  db.records.get('users/u1').displayName='青雲修士';db.records.get('users/u2').displayName='雲岫道友';
  let loseMoveResponse=true;
  app.use('/api/tactical/action',(req,res,next)=>{
    if(req.body.type==='move'&&loseMoveResponse){loseMoveResponse=false;const json=res.json.bind(res);res.json=()=>{res.status(503);return json({error:'模擬已提交但回應遺失'});};}next();
  });
  register(app,{resolve:()=>({db}),verify:async req=>{
    const uid=req.get('x-test-user');if(!['u1','u2','u3'].includes(uid))throw Object.assign(Error('test identity required'),{status:401});return uid;
  }});
  app.post('/api/generate-quiz',async(req,res)=>{
    try{const uid=req.get('x-test-user'),expected=await service.prepareQuestion(db,uid,req.body.roomId);
      const q=expected.pending||await service.commitQuestion(db,uid,expected,{q:'若 x + 2 = 5，則 x 的值為何？',correct:'3',wrong:['1','2','4'],exp:'等號兩邊同減 2，得到 x = 3。'});
      res.json({tacticalQuestion:q});
    }catch(e){res.status(e.status||500).json({error:e.message});}
  });
  app.get('/cultivation/data/project-repository.js',(req,res)=>res.type('text/javascript').send(`export const getMainUser=()=>({uid:sessionStorage.testUid||'u1'});export const authenticatedMainFetch=(url,init={})=>fetch(url,{...init,headers:{...init.headers,'Content-Type':'application/json','X-Test-User':getMainUser().uid}});`));
  if(process.env.TACTICAL_FONT_DIR)app.use('/test-font',express.static(process.env.TACTICAL_FONT_DIR));
  app.get(['/','/index.html','/stage.html'],(_,res)=>res.sendFile(path.join(__dirname,'../public/stage.html')));
  app.get('/app.html',(req,res)=>res.type('html').send(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>青雲問道 · 戰場測試</title><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/app-stage-bridge.js"></script>${theme}${process.env.TACTICAL_FONT_DIR?'<link rel="stylesheet" href="/test-font/400.css">':''}<style>body{margin:0;font-family:'Noto Sans TC',system-ui;background:#101a17}button{font:inherit}#tactical-combat :is(h1,h2,h3){font-family:'Noto Sans TC',serif!important}</style></head><body class="xianxia-theme ui-cleanup"><button id="entry" onclick="startQuizFlow()">問道試煉</button><script src="/test-cloud.js"></script><script>window.__testPlayer={displayName:'青雲修士',stats:{totalScore:30},cultivationTraining:{equippedCore:{type:'thunder',grade:9}}};window.getCurrentUserData=()=>window.__testPlayer;</script><script type="module" src="/cultivation/tactical-combat.js"></script></body></html>`));
  app.use(express.static(path.join(__dirname,'../public')));
  const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  const base='http://127.0.0.1:'+server.address().port;
  let browser;
  try{browser=await playwright.chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.TACTICAL_CHROMIUM?{executablePath:process.env.TACTICAL_CHROMIUM}:{})});}
  catch(e){server.close();throw e;}
  const errors=[];
  async function make(uid,viewport){const context=await browser.newContext({viewport,deviceScaleFactor:2});await context.addInitScript(uid=>sessionStorage.testUid=uid,uid);
    await context.addInitScript(()=>{window.__pickersSeen=0;window.__pickerObserver=new MutationObserver(()=>{if(document.querySelector('#tactical-combat [data-map],#tactical-combat [data-branch]'))window.__pickersSeen++;});window.__pickerObserver.observe(document,{childList:true,subtree:true});});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const frame=()=>page.frames().find(f=>f!==page.mainFrame()&&/\/app\.html(?:[?#]|$)/.test(f.url()));
    const ready=async()=>{await page.frameLocator('#game-frame').locator('#entry').waitFor();await frame().waitForFunction(()=>typeof window.openTacticalCombat==='function');};
    await page.goto(base);await ready();
    return {page,locator:(...args)=>page.frameLocator('#game-frame').locator(...args),evaluate:(...args)=>frame().evaluate(...args),
      waitForFunction:(...args)=>frame().waitForFunction(...args),screenshot:(...args)=>page.screenshot(...args),
      reload:async()=>{await page.reload();await ready();},setViewportSize:async size=>{
        await page.setViewportSize(size);
        await page.waitForFunction(()=>{const s=window.QAGameStage.getState(),f=document.getElementById('game-frame');
          const landscape=innerWidth>=innerHeight;return s.designWidth===(landscape?1280:360)&&f.contentDocument.documentElement.clientWidth===s.designWidth;});
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
  async function correct(page){await page.locator('[data-quiz]').click();await page.locator('[data-choice]').first().waitFor();await ratio(page,{dialog:true});await page.locator('[data-choice]').filter({hasText:/^\w?3$/}).click();await page.locator('[data-continue]').click();await page.waitForFunction(()=>!document.querySelector('[data-end]').disabled);}
  try{
    const mobile=await make('u1',{width:393,height:852});
    await mobile.locator('#entry').click();await mobile.locator('#startup-cloud-curtain').waitFor();
    await mobile.locator('canvas').waitFor();await mobile.locator('#startup-cloud-curtain').waitFor({state:'detached'});
    await ratio(mobile);
    assert.equal(await mobile.locator('[data-start],[data-map],[data-branch]').count(),0,'trial entry skips both pickers');
    assert.equal((await read(mobile)).trial.stage,1);await correct(mobile);
    assert.equal((await read(mobile)).actors[0].stamina,6);
    assert.equal(await mobile.evaluate(()=>getCurrentUserData().stats.totalScore),31,'answer progress updates the existing account UI immediately');
    const beforeMove=await read(mobile),pos=Rules.neighbours(beforeMove,beforeMove.actors[0]).find(p=>!Rules.at(beforeMove,p));
    await cell(mobile,pos.x,pos.y);await mobile.locator('[data-execute]').click();await mobile.waitForFunction(()=>!document.querySelector('[data-end]').disabled);
    const moved=await read(mobile);assert.equal(moved.actors[0].stamina,5,'lost move response retry must not charge twice');assert.equal(Rules.key(moved.actors[0]),Rules.key(pos));
    await mobile.locator('[data-end]').click();await mobile.waitForFunction(()=>document.querySelector('[data-turn]').textContent.includes('第 2'));
    await mobile.locator('[data-end]').click();await mobile.waitForFunction(()=>document.querySelector('[data-turn]').textContent.includes('第 3'));
    await mobile.screenshot({path:path.join(output,'battle-mobile.png')});
    assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const rect=await mobile.locator('canvas').boundingBox();assert.ok(rect.height>200,'mobile board must remain playable');
    await mobile.reload();await mobile.waitForFunction(()=>typeof window.openTacticalCombat==='function');await mobile.locator('#entry').click();await mobile.locator('canvas').waitFor();await mobile.locator('#startup-cloud-curtain').waitFor({state:'detached'});
    assert.equal((await read(mobile)).turn,3,'refresh resumes the same room');
    for(const [width,height,name]of [[1280,720,'battle-landscape'],[1024,768,'battle-tablet-landscape'],[768,1024,'battle-tablet-portrait'],[1920,800,'battle-ultrawide'],[844,390,'battle-phone-landscape']]){
      await mobile.setViewportSize({width,height});await ratio(mobile);await mobile.screenshot({path:path.join(output,name+'.png')});
    }
    assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    // Reproduce the reported exhausted-stamina view with the densest later-stage HUD.
    const room=await read(mobile),key=service.ROOMS+'/'+room.id,saved=db.records.get(key);
    let denseStage=10;while(true){const layout=Rules.stageLayout('layout-fit',denseStage);if(layout.width===11&&layout.enemies.length===4)break;denseStage++;}
    const dense=Rules.create({id:room.id,mode:'pve',players:[{...saved.actors[0],name:'《九州》陳長青',maxHp:2400}],trial:{seed:'layout-fit',stage:denseStage}});
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
    assert.equal(await mobile.evaluate(()=>window.__pickersSeen),0);await mobile.evaluate(()=>window.__pickerObserver.disconnect());
    await mobile.setViewportSize({width:393,height:852});await ratio(mobile);await mobile.screenshot({path:path.join(output,'trial-stage-2-mobile.png')});
    await mobile.reload();await mobile.waitForFunction(()=>typeof window.openTacticalCombat==='function');await mobile.locator('#entry').click();await mobile.locator('canvas').waitFor();await mobile.locator('#startup-cloud-curtain').waitFor({state:'detached'});
    assert.equal((await read(mobile)).id,next.id,'refresh resumes the current randomized stage');
    await mobile.locator('[data-leave]').click();await mobile.locator('[data-forfeit]').click();await mobile.locator('[data-exit]').click();
    await mobile.evaluate(()=>window.startBattleMatchmaking());await mobile.locator('[data-start]').click();await mobile.locator('.tc-waiting').waitFor();
    const waiting=await read(mobile),p2=await make('u2',{width:1280,height:720});await p2.evaluate(()=>window.openTacticalCombat('pvp'));
    await p2.locator('[data-code]').fill(waiting.id.replace('arena-',''));await p2.locator('[data-join]').click();await p2.locator('canvas').waitFor();
    await mobile.locator('canvas').waitFor({timeout:15000});assert.equal((await read(p2)).id,waiting.id);
    await ratio(mobile);await ratio(p2);
    assert.equal(await p2.locator('[data-quiz]').isDisabled(),true);
    await correct(mobile);await mobile.locator('[data-end]').click();await p2.waitForFunction(()=>!document.querySelector('[data-quiz]').disabled,{timeout:15000});
    await correct(p2);assert.equal((await read(p2)).actors.find(a=>a.uid==='u2').stamina,6);
    await p2.screenshot({path:path.join(output,'duel-landscape.png')});
    assert.deepEqual(errors,[]);console.log('Browser checks passed: shared 16:9 / 9:16 stage, six screen sizes, production theme isolation, visible controls with four enemies and zero stamina, scaled canvas input, bounded cloud/dialogs, trial progression and two-player synchronization.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

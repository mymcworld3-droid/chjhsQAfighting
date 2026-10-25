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
let playwright;try{playwright=require('playwright');}catch(_){playwright=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');}
const output=path.resolve(process.argv[2]||'/tmp/tactical-browser');fs.mkdirSync(output,{recursive:true});
async function main(){
  const db=database(),app=express();app.use(express.json());
  const legacy=fs.readFileSync(path.join(__dirname,'../public/main-legacy.js'),'utf8');
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
  app.get('/',(req,res)=>res.type('html').send(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${process.env.TACTICAL_FONT_DIR?'<link rel="stylesheet" href="/test-font/400.css">':''}<style>body{margin:0;font-family:'Noto Sans TC',system-ui;background:#101a17}button{font:inherit}h1,h2,h3{font-family:'Noto Sans TC',serif!important}</style><button id="entry" onclick="startQuizFlow()">問道試煉</button><script src="/test-cloud.js"></script><script>window.__testPlayer={displayName:'青雲修士',stats:{totalScore:30},cultivationTraining:{equippedCore:{type:'thunder',grade:9}}};window.getCurrentUserData=()=>window.__testPlayer;</script><script type="module" src="/cultivation/tactical-combat.js"></script></html>`));
  app.use(express.static(path.join(__dirname,'../public')));
  const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  const base='http://127.0.0.1:'+server.address().port;
  let browser;
  try{browser=await playwright.chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.TACTICAL_CHROMIUM?{executablePath:process.env.TACTICAL_CHROMIUM}:{})});}
  catch(e){server.close();throw e;}
  const errors=[];
  async function make(uid,viewport){const context=await browser.newContext({viewport,deviceScaleFactor:2});await context.addInitScript(uid=>sessionStorage.testUid=uid,uid);
    await context.addInitScript(()=>{window.__pickersSeen=0;window.__pickerObserver=new MutationObserver(()=>{if(document.querySelector('#tactical-combat [data-map],#tactical-combat [data-branch]'))window.__pickersSeen++;});window.__pickerObserver.observe(document,{childList:true,subtree:true});});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.waitForFunction(()=>typeof window.openTacticalCombat==='function');return page;}
  const read=page=>page.evaluate(async()=>{const r=await fetch('/api/tactical/state',{headers:{'X-Test-User':sessionStorage.testUid||'u1'}});return (await r.json()).state;});
  async function cell(page,x,y){const s=await read(page),rect=await page.locator('canvas').boundingBox(),size=Math.min((rect.width-20)/s.width,(rect.height-24)/s.height),ox=Math.round((rect.width-size*s.width)/2),oy=Math.round((rect.height-size*s.height)/2);await page.locator('canvas').click({position:{x:ox+(x+.5)*size,y:oy+(y+.5)*size}});}
  async function correct(page){await page.locator('[data-quiz]').click();await page.locator('[data-choice]').filter({hasText:/^\w?3$/}).click();await page.locator('[data-continue]').click();await page.waitForFunction(()=>!document.querySelector('[data-end]').disabled);}
  try{
    const mobile=await make('u1',{width:393,height:698});
    await mobile.locator('#entry').click();await mobile.locator('#startup-cloud-curtain').waitFor();
    await mobile.locator('canvas').waitFor();await mobile.locator('#startup-cloud-curtain').waitFor({state:'detached'});
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
    await mobile.setViewportSize({width:1280,height:720});await mobile.screenshot({path:path.join(output,'battle-landscape.png')});
    await mobile.setViewportSize({width:844,height:475});await mobile.screenshot({path:path.join(output,'battle-phone-landscape.png')});
    assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const prior=await read(mobile),raw=db.records.get(service.ROOMS+'/'+prior.id),hero=raw.actors[0],monster=raw.actors[1];
    raw.blocks=[];hero.stamina=5;monster.x=hero.x+1;monster.y=hero.y;monster.hp=1;
    await mobile.locator('[data-sync]').click();await mobile.waitForFunction(()=>!document.querySelector('[data-end]').disabled);
    await mobile.locator('[data-action="attack"]').click();await cell(mobile,monster.x,monster.y);await mobile.locator('[data-execute]').click();
    await mobile.locator('[data-next-stage]').waitFor();await mobile.locator('[data-next-stage]').click();
    await mobile.locator('#startup-cloud-curtain').waitFor();await mobile.locator('#startup-cloud-curtain').waitFor({state:'detached'});
    const next=await read(mobile);assert.equal(next.trial.stage,2);assert.equal(next.trial.seed,prior.trial.seed);assert.notEqual(next.id,prior.id);
    assert.equal(await mobile.evaluate(()=>window.__pickersSeen),0);await mobile.evaluate(()=>window.__pickerObserver.disconnect());
    await mobile.setViewportSize({width:393,height:698});await mobile.screenshot({path:path.join(output,'trial-stage-2-mobile.png')});
    await mobile.reload();await mobile.waitForFunction(()=>typeof window.openTacticalCombat==='function');await mobile.locator('#entry').click();await mobile.locator('canvas').waitFor();await mobile.locator('#startup-cloud-curtain').waitFor({state:'detached'});
    assert.equal((await read(mobile)).id,next.id,'refresh resumes the current randomized stage');
    await mobile.locator('[data-leave]').click();await mobile.locator('[data-forfeit]').click();await mobile.locator('[data-exit]').click();
    await mobile.evaluate(()=>window.startBattleMatchmaking());await mobile.locator('[data-start]').click();await mobile.locator('.tc-waiting').waitFor();
    const waiting=await read(mobile),p2=await make('u2',{width:1280,height:720});await p2.evaluate(()=>window.openTacticalCombat('pvp'));
    await p2.locator('[data-code]').fill(waiting.id.replace('arena-',''));await p2.locator('[data-join]').click();await p2.locator('canvas').waitFor();
    await mobile.locator('canvas').waitFor({timeout:15000});assert.equal((await read(p2)).id,waiting.id);
    assert.equal(await p2.locator('[data-quiz]').isDisabled(),true);
    await correct(mobile);await mobile.locator('[data-end]').click();await p2.waitForFunction(()=>!document.querySelector('[data-quiz]').disabled,{timeout:15000});
    await correct(p2);assert.equal((await read(p2)).actors.find(a=>a.uid==='u2').stamina,6);
    await p2.screenshot({path:path.join(output,'duel-landscape.png')});
    assert.deepEqual(errors,[]);console.log('Browser checks passed: real cloud entry without pickers, randomized next stage, mobile/landscape, answers, lost-response retry, stage recovery and two-player synchronization.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

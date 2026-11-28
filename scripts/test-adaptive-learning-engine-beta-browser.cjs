#!/usr/bin/env node
'use strict';
// Isolated browser fixture: real entry markup, CSS, preview module and status handler.
// Only identity and host page are simulated; no production accounts/data or AI.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),express=require('express');
const {register}=require('../adaptive-learning-engine-beta-api.cjs');
const {chromium}=require('playwright');
const root=path.join(__dirname,'../public');
async function main(){
  const app=express(),env={NODE_ENV:'test',ADAPTIVE_LEARNING_ENGINE_BETA:'0'};
  let rejectIdentity=false,delay=0,requests=0;
  app.use('/api/adaptive-learning-engine-beta/status',(req,res,next)=>{requests++;next();});
  register(app,{env,verify:async req=>{const uid=req.get('x-test-user');if(delay)await new Promise(r=>setTimeout(r,delay));if(rejectIdentity||!uid)throw Object.assign(Error('fixture auth'),{status:401});return uid;}});
  app.get('/cultivation/data/project-repository.js',(_,res)=>res.type('text/javascript').send("export const getMainUser=()=>window.fixtureUid?{uid:window.fixtureUid}:null;export const authenticatedMainFetch=(url,init={})=>fetch(url,{...init,headers:{'x-test-user':window.fixtureUid||''}});"));
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),entry=html.match(/<select id="set-source-mode"[\s\S]*?<\/select>\s*<button id="adaptive-learning-beta-entry"[\s\S]*?<\/button>/)[0];
  app.get('/',(_,res)=>res.type('html').send('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles/curriculum-studio.css"><style>body{margin:0;background:#0b0f12}button,select{font:inherit}</style><section id="page-settings" class="active-page"><nav id="nav-grid"><button>宗門</button></nav></section><section id="scope-studio"><div class="ss-workspace"><div class="ss-picker"><div class="ss-picker-body"><div class="dongfu-scope-content">'+entry+'<button id="legacy-control">原有範圍</button></div></div></div><div class="ss-cart"></div></div></section><script>window.fixtureUid="u1";window.curriculumStudioReturnPage=()=>"page-settings";window.soloSelectedUnits=[{detail:"原有範圍"}];</script><script type="module">import {openBetaContext} from "/cultivation/adaptive-learning-engine-beta.js";window.openBetaContext=openBetaContext;openBetaContext();</script>'));
  app.use(express.static(root));
  const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
  let browser;try{
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    for(const viewport of [{width:360,height:640},{width:640,height:360},{width:768,height:1024},{width:1024,height:768}]){
      env.ADAPTIVE_LEARNING_ENGINE_BETA='0';rejectIdentity=false;delay=0;
      const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto('http://127.0.0.1:'+server.address().port);
      await page.waitForFunction(()=>typeof window.openBetaContext==='function');
      const entry=page.locator('#adaptive-learning-beta-entry'),dialog=page.locator('#adaptive-learning-beta-dialog');
      const before=requests;
      await page.waitForFunction(()=>document.getElementById('adaptive-learning-beta-entry').hidden);
      assert.equal(await entry.isVisible(),false);
      env.ADAPTIVE_LEARNING_ENGINE_BETA='1';await page.evaluate(()=>window.openBetaContext());await entry.waitFor({state:'visible'});
      const rect=await entry.boundingBox();assert.ok(rect&&rect.width<=viewport.width&&rect.x>=0&&rect.x+rect.width<=viewport.width+1);
      assert.equal(await page.locator('#set-source-mode').inputValue(),'focused');
      await entry.click();await dialog.waitFor({state:'visible'});
      const bounds=await dialog.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1);
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.id==='adaptive-learning-beta-entry');
      await entry.click();await dialog.waitFor({state:'visible'});
      env.ADAPTIVE_LEARNING_ENGINE_BETA='0';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await dialog.waitFor({state:'hidden'});await entry.waitFor({state:'hidden'});
      env.ADAPTIVE_LEARNING_ENGINE_BETA='1';rejectIdentity=true;await page.evaluate(()=>window.openBetaContext());await page.waitForTimeout(200);assert.equal(await entry.isVisible(),false);
      rejectIdentity=false;delay=200;await page.evaluate(()=>{window.openBetaContext();setTimeout(()=>{window.fixtureUid='';window.dispatchEvent(new Event('focus'));},20);});await page.waitForTimeout(350);assert.equal(await entry.isVisible(),false);
      await page.evaluate(()=>{window.fixtureUid='u1';window.openBetaContext();});await entry.waitFor({state:'visible'});
      await entry.click();await dialog.waitFor({state:'visible'});await dialog.locator('[data-beta-close]').click();await dialog.waitFor({state:'hidden'});
      assert.deepEqual(await page.evaluate(()=>window.soloSelectedUnits),[{detail:'原有範圍'}]);assert.equal(await page.locator('#set-source-mode').inputValue(),'focused');
      assert.equal(await page.locator('#nav-grid button').count(),1);assert.equal(await page.locator('#legacy-control').isVisible(),true);
      await page.evaluate(()=>{document.getElementById('scope-studio').hidden=true;window.dispatchEvent(new Event('qingyun:scope-studio-closed'));});assert.equal(await entry.isVisible(),false);
      assert.deepEqual(errors,[]);assert.ok(requests>before);console.log('Adaptive Beta preview passed '+viewport.width+'x'+viewport.height);await page.close();
    }
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

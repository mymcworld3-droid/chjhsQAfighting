#!/usr/bin/env node
'use strict';
// Optional real-browser check. Uses production modules with local account/API
// fixtures; never signs in, contacts a backend, or changes a real player's data.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const root=path.resolve(__dirname,'../public'),fixture=path.resolve(__dirname,'../tests/fixtures/ui-consistency.html');
const output=process.env.UI_SCREENSHOT_DIR||path.join(os.tmpdir(),'qingyun-v2-ui');
fs.mkdirSync(output,{recursive:true});
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=pathname==='/__preview'?fixture:path.resolve(root,'.'+decodeURIComponent(pathname));
 if(file!==fixture&&!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(data);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  for(const [name,width,height] of [['phone',390,844],['landscape',844,390],['tablet',820,1180],['desktop',1440,900]]){
   const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',route=>{
    const url=route.request().url();
    if(url.includes('/cultivation/data/project-repository.js'))return route.fulfill({contentType:'text/javascript',body:"export const getMainUser=()=>({uid:'visual-teacher'});export const authenticatedMainFetch=(...args)=>window.__previewApi(...args);"});
    if(url.includes('/cultivation/dungeon-room.js'))return route.fulfill({contentType:'text/javascript',body:'export const reconnectDungeonRoom=async()=>null;export const leaveDungeonRoom=async()=>null;'});
    if(url.includes('firebase-auth.js'))return route.fulfill({contentType:'text/javascript',body:'export const getAuth=()=>({});export const onAuthStateChanged=()=>()=>{};'});
    if(!url.startsWith(base))return route.abort();
    return route.continue();
   });
   await page.goto(base+'/__preview');await page.waitForFunction(()=>window.__previewReady);
   await page.locator('.manual-native-card').first().waitFor();
   assert.equal(await page.locator('.manual-native-card').count(),6);
   await page.evaluate(()=>{window.__preservedArt=document.querySelector('[data-qy-weapon-art="sword-wind"]');});
   await page.locator('[data-manual-pick-slot="0"]').click();
   await page.locator('[data-manual-pick-weapon="sword-flight"]').click();
   await page.waitForFunction(()=>window.__previewRaw.weaponIds[0]==='sword-flight');
   await page.waitForFunction(()=>!document.querySelector('[data-manual-weapon-dialog]'));
   assert(await page.evaluate(()=>document.querySelector('[data-qy-weapon-art="sword-wind"]')===window.__preservedArt),'weapon art node must survive equipment changes');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'training must fit viewport');
   await page.screenshot({path:path.join(output,name+'-training.png')});
   await page.evaluate(()=>QATeacherDongtian.open('demo'));
   await page.locator('[name="q-0"]').fill('第一題已修改，切換後要保留。');
   await page.locator('[data-td-action="select-question"][data-index="1"]').click();
   await page.locator('[name="q-1"]').fill('第二題已修改。');
   await page.locator('[name="option-1-3"]').fill('');
   await page.locator('[data-td-action="select-question"][data-index="0"]').click();
   assert.equal(await page.locator('[name="q-0"]').inputValue(),'第一題已修改，切換後要保留。');
   await page.locator('[data-td-action="save"]').click();
   await page.locator('[data-td-question="1"]:not([hidden])').waitFor();
   assert.equal(await page.evaluate(()=>__uiRequests.filter(x=>x.body.action==='save').length),0,'invalid hidden questions must not be saved');
   await page.locator('[name="option-1-3"]').fill('恢復第四個選項');
   await page.locator('[data-td-action="up"][data-index="1"]').click();
   assert.equal(await page.locator('[name="q-0"]').inputValue(),'第二題已修改。');
   await page.locator('[data-td-action="save"]').click();
   await page.waitForFunction(()=>__uiRequests.some(x=>x.body.action==='save'));
   assert.equal(await page.evaluate(()=>__previewCave.questions[0].q),'第二題已修改。');
   assert.equal(await page.evaluate(()=>__previewCave.questions[1].q),'第一題已修改，切換後要保留。');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'teacher editor must fit viewport');
   await page.screenshot({path:path.join(output,name+'-teacher.png')});
   await page.evaluate(()=>switchToPage('battle-preview'));
   await page.screenshot({path:path.join(output,name+'-battle.png')});
   await page.locator('#open-dungeon').click();await page.locator('[data-wd-dungeon]').first().click();
   assert.equal(await page.locator('[data-wd-difficulty]').count(),6);
   assert.equal(await page.locator('.wd-difficulties [data-qy-realm-kind="difficulty"]').count(),6);
   await page.screenshot({path:path.join(output,name+'-dungeon.png')});
   await page.locator('[data-wd-close]').click();assert.equal(await page.locator('#weapon-dungeons-panel').evaluate(el=>el.hidden),true);
   assert.deepEqual(errors,[],name+' browser errors');
   console.log(name+': training, teacher, battlefield and dungeon passed');await context.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});

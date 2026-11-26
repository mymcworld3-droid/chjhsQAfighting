#!/usr/bin/env node
'use strict';
// Exercise actual selector and page modules with local static data, without Firebase or paid AI.
const assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright'));}
const app=express();app.get('/__curriculum_test',(_req,res)=>res.type('html').send(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/curriculum-studio.css"><style>body{margin:0;background:#15120e;color:#e4d2af}#scope-studio{max-width:1100px;margin:auto;padding:12px;box-sizing:border-box}button,select{font:inherit}*{box-sizing:border-box}</style><div id="scope-studio"><div id="ss-picker-body"><div id="solo-unit-selectors-container"></div><p id="solo-unit-hint"></p></div><div id="solo-selected-units-list"></div><button id="ss-tab-cart">已選範圍</button></div><select id="set-level" hidden><option>國中一年級</option></select><select id="set-source-mode" hidden><option>focused</option></select><script>window.soloSelectedUnits=[];</script><script type="module">import '/cultivation/curriculum-scope.js';import '/cultivation/curriculum-pages.js';</script></html>`));
app.use(express.static(path.join(__dirname,'../public')));
if(process.argv.includes('--serve'))app.listen(4173,'0.0.0.0',()=>console.log('Curriculum browser harness ready on port 4173'));
else (async()=>{
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  let browser;const results=[];
  try{
    browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
    for(const viewport of [{width:390,height:844},{width:1024,height:768},{width:1440,height:900}]){
      const page=await browser.newPage({viewport});const errors=[],requests=[];
      page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>requests.push(r.url()));
      await page.goto('http://127.0.0.1:'+server.address().port+'/__curriculum_test');
      await page.locator('#cs-cards-0 button').filter({hasText:'高中二年級'}).click();
      await page.locator('#cs-cards-1 button').filter({hasText:'數學A'}).click();
      await page.waitForFunction(()=>document.querySelectorAll('#cs-units article').length>0&&document.querySelector('#cs-units').getAttribute('aria-busy')==='false');
      assert.ok(await page.locator('#cs-edition').isVisible());assert.ok(await page.locator('#cs-term').isVisible());
      const official=await page.locator('#cs-edition option').evaluateAll(options=>options.find(o=>o.value==='翰林版 · 115學年度')?.disabled);
      assert.equal(official,false,'officially verified contents can be selected');
      await page.locator('#cs-edition').selectOption('翰林版 · 115學年度');
      await page.waitForFunction(()=>document.querySelector('#cs-units').getAttribute('aria-busy')==='false');
      await page.locator('#cs-term').selectOption('第一學期');
      await page.waitForFunction(()=>document.querySelector('#cs-units').getAttribute('aria-busy')==='false');
      assert.ok((await page.locator('.cs-card-term').allTextContents()).every(t=>t==='上學期'));
      await page.locator('.cs-chapter').first().check();
      const saved=await page.evaluate(()=>structuredClone(window.soloSelectedUnits));
      assert.equal(saved.length,1);assert.ok(saved[0].curriculum.bookId);
      const share=await page.evaluate(()=>window.shareCustomCurriculumRanges());assert.equal(share.ok,true);
      await page.locator('#cs-edition').selectOption('翰林版 · 114學年度');
      await page.waitForFunction(()=>document.querySelector('#cs-units').getAttribute('aria-busy')==='false');
      await page.locator('#cs-term').selectOption('第二學期');
      await page.waitForFunction(()=>document.querySelector('#cs-units').getAttribute('aria-busy')==='false');
      assert.ok((await page.locator('.cs-card-term').allTextContents()).every(t=>t==='下學期'));
      assert.equal(await page.evaluate(()=>window.soloSelectedUnits.length),1,'filtering must retain selected first-semester units');
      const imported=await page.evaluate(code=>window.importCustomCurriculumRanges(code),share.code);assert.equal(imported.ok,true);
      assert.equal(await page.evaluate(()=>window.soloSelectedUnits.length),1,'reimport must deduplicate with full edition metadata');
      await page.evaluate(()=>window.openCurriculumPage(0));
      await page.locator('#cs-cards-0 button').filter({hasText:'國中一年級'}).click();
      const subjects=await page.locator('#cs-cards-1 button').allTextContents();
      assert.ok(subjects.some(s=>s.includes('生物')));assert.ok(!subjects.some(s=>/物理|化學|地球科學/.test(s)));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal overflow');
      assert.deepEqual(errors,[]);assert.ok(!requests.some(url=>url.includes('question-references')));
      results.push({viewport,passed:true,catalogRequests:requests.filter(url=>url.includes('/curriculum-data/')).length});
      await page.close();
    }
    console.log(JSON.stringify({passed:true,devices:results},null,2));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

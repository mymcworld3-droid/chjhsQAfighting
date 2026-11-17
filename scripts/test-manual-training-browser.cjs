#!/usr/bin/env node
'use strict';
// Local fixtures and API; no production account or data is accessed.
const assert=require('node:assert/strict');
const path=require('node:path');
const express=require('express');
const {chromium}=require('playwright');
const {database}=require('../tests/helpers/tactical-db.cjs');
const register=require('../tactical-combat-api.cjs');
const service=register.__test;
async function main(){
  const db=database();db.records.get('users/u1').stats.gold=10000;
  await service.chooseSchool(db,'u1',{school:'sword'});
  const app=express();app.use(express.json());
  app.get('/cultivation/data/project-repository.js',(_,res)=>res.type('text/javascript').send(`export const getMainUser=()=>({uid:'u1'});export const authenticatedMainFetch=(url,init={})=>fetch(url,{...init,headers:{...init.headers,'Content-Type':'application/json'}});`));
  app.use('/api/tactical/manuals',(req,res,next)=>{if(req.method==='POST')setTimeout(next,250);else next();});
  register(app,{resolve:()=>({db}),verify:async()=> 'u1'});
  app.get('/test',(_,res)=>res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="nav-grid"></div><main id="page-training" class="active-page"></main><script type="module" src="/cultivation/manual-training-page.js"></script></body></html>`));
  app.use(express.static(path.join(__dirname,'../public')));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  let browser;
  try{
    browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.TACTICAL_CHROMIUM?{executablePath:process.env.TACTICAL_CHROMIUM}:{})});
    const page=await browser.newPage({viewport:{width:393,height:852}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/test`);
    await page.locator('[data-manual-book="sword-wind"] summary').click();
    await page.locator('[data-manual-jump-skill="wind-slash"]').click();
    await page.locator('[data-manual-book="sword-wind"][open]').waitFor();
    assert.equal(await page.locator('.manual-hero-book-tab.is-current').count(),1);
    assert.equal(await page.locator('.manual-hero-cover').count(),1);
    await page.evaluate(()=>{window.savedArt=[...document.querySelectorAll('.manual-book-art,.manual-skill-art')];});
    const verifyArt=async()=>{
      assert.equal(await page.evaluate(()=>window.savedArt.length>0&&window.savedArt.every((img,i)=>img===document.querySelectorAll('.manual-book-art,.manual-skill-art')[i]&&img.isConnected)),true,'unchanged artwork must keep its original DOM node');
      assert.equal(await page.locator('[data-manual-book="sword-wind"]').evaluate(e=>e.open),true);
      assert.equal(await page.locator('.manual-hero-book-tab.is-current').count(),1);
      assert.equal(await page.locator('.manual-hero-cover').count(),1);
    };
    await page.locator('[data-manual-remove="wind-slash"]').click();await verifyArt();
    await page.waitForFunction(()=>document.querySelector('[data-manual-status]')?.textContent==='功法配置已儲存。');await verifyArt();
    assert.equal(await page.locator('[data-manual-remove="wind-slash"]').count(),0);
    await page.locator('[data-manual-equip="wind-slash"]').click();await verifyArt();
    await page.locator('[data-manual-remove="wind-slash"]').waitFor();await verifyArt();
    await page.evaluate(()=>{window.savedSlot=document.querySelector('.manual-slot-art');});
    await page.locator('.manual-hero [data-manual-upgrade="sword-wind"]').click();await verifyArt();
    await page.getByText('已升級《流風劍訣》。').waitFor();await verifyArt();
    assert.equal(await page.evaluate(()=>window.savedSlot===document.querySelector('.manual-slot-art')),true);
    await page.locator('[data-skill-upgrade="wind-slash"]').click();await verifyArt();
    await page.getByText('「流風斬」已升至 Lv. 2。').waitFor();await verifyArt();
    assert.equal(await page.evaluate(()=>window.savedSlot===document.querySelector('.manual-slot-art')),true);
    assert.deepEqual(errors,[]);console.log('Manual training artwork survives equip, unequip, manual and skill upgrades without replacing unchanged images.');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

#!/usr/bin/env node
'use strict';
// Browser fixture uses production UI, Foundation navigation and transactional APIs.
// All accounts and inventory exist only in memory; no AI or production services.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),express=require('express');
const {database}=require('../tests/helpers/tactical-db.cjs');
const register=require('../weapon-armory-api.cjs'),service=register.__test;
const Stage=require('../public/game-stage-rules.js');
const {chromium}=require('playwright');
const out=path.resolve(process.argv[2]||'/tmp/weapon-forge-browser');fs.mkdirSync(out,{recursive:true});
async function main(){
  const db=database(),app=express();app.use(express.json());if(process.env.WEAPON_FONT_DIR)app.use('/test-font',express.static(process.env.WEAPON_FONT_DIR));
  Object.assign(db.records.get('users/u1'),{displayName:'青雲修士',soulboundDrawTickets:3,forgeFragments:600});
  Object.assign(db.records.get('users/u1').stats,{totalScore:6,gold:5000});
  Object.assign(db.records.get('users/u2'),{displayName:'雲岫道友',soulboundDrawTickets:0,forgeFragments:0});
  let dropGoldResponse=true;const upgrades=[];
  app.use('/api/weapons/upgrade',(req,res,next)=>{
    upgrades.push({...req.body,uid:req.get('x-test-user')});
    if(req.body.payment==='gold'&&dropGoldResponse){dropGoldResponse=false;const json=res.json.bind(res);res.json=()=>{res.status(503);return json({ok:false,error:'已提交，但回應遺失'});};}next();
  });
  register(app,{resolve:()=>({db}),verify:async req=>{const uid=req.get('x-test-user');if(!['u1','u2'].includes(uid))throw Object.assign(Error('test identity required'),{status:401});return uid;}});
  app.get('/cultivation/data/project-repository.js',(_,res)=>res.type('text/javascript').send("export const getMainUser=()=>({uid:sessionStorage.testUid||'u1'});export const authenticatedMainFetch=(url,init={})=>fetch(url,{...init,headers:{...init.headers,'Content-Type':'application/json','X-Test-User':getMainUser().uid}});"));
  const index=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const theme=[...index.matchAll(/<link\b[^>]*>/g)].map(m=>m[0]).filter(s=>/rel="stylesheet"/.test(s)).map(s=>s.match(/href="([^"]+)"/)?.[1]).filter(s=>s&&!/^https?:/.test(s));
  app.get(['/','/index.html','/stage.html'],(_,res)=>res.sendFile(path.join(__dirname,'../public/stage.html')));
  app.get('/app.html',(_,res)=>res.type('html').send(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>青雲問道 · 兵器庫</title><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/app-stage-bridge.js"></script>${theme.map(h=>'<link rel="stylesheet" href="/'+h+'">').join('')}${process.env.WEAPON_FONT_DIR?'<link rel="stylesheet" href="/test-font/noto-sans-tc/400.css"><link rel="stylesheet" href="/test-font/noto-serif-tc/400.css">':''}<style>body{margin:0;background:#17140f;font-family:'Noto Sans TC',system-ui}#page-training{height:100%;padding:14px;overflow:auto;min-height:0}#training-tab-content{padding-bottom:20px}.training-subtabs-v3{display:flex;gap:8px}.training-subtab-v3{padding:10px;color:#ddc99f;background:#211b12;border:1px solid #c7a35e44;border-radius:8px}#page-home{display:none}</style></head><body class="xianxia-theme ui-cleanup" data-weapon-system="1"><div id="page-home"></div><nav id="nav-grid"><button data-target="page-home">宗門</button></nav><section id="page-training" class="page-section active-page training-page training-page-v3" data-static-layout="1"><div class="training-page-heading-v3"></div><div class="training-subtabs-v3" role="tablist"><button class="training-subtab-v3" data-training-tab="refinery"><span>煉器</span></button><button class="training-subtab-v3" data-training-tab="equipment"><span>裝備</span></button><button class="training-subtab-v3 active" data-training-tab="bag"><span>背包</span></button></div><div id="training-tab-content"></div></section><script>window.QA_WEAPON_SYSTEM_ENABLED=true;window.__users=${JSON.stringify(Object.fromEntries(['u1','u2'].map(uid=>[uid,db.records.get('users/'+uid)])))};window.getCurrentUserData=()=>window.__users[sessionStorage.testUid||'u1'];window.getTrainingAccessScore=()=>window.getCurrentUserData().stats.totalScore;window.switchToPage=()=>{};</script><script type="module">import '/cultivation/weapon-forge.js';import '/cultivation/foundation-training-page.js';import '/cultivation/training-fluid-layout.js';window.__weaponsReady=true;</script></body></html>`));
  app.use(express.static(path.join(__dirname,'../public')));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  let browser;try{browser=await chromium.launch({headless:true,executablePath:process.env.TACTICAL_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:2}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);const frame=()=>page.frames().find(f=>/\/app\.html/.test(f.url()));
    const ui=selector=>page.frameLocator('#game-frame').locator(selector);await ui('[data-training-tab="refinery"]').waitFor();await frame().waitForFunction(()=>window.__weaponsReady);
    await ui('[data-training-tab="refinery"]').click();await ui('.wf-weapons').waitFor();
    assert.equal(await ui('[data-training-tab="equipment"]').isVisible(),false);assert.equal(await ui('.wf-weapon').count(),5);assert.equal(await ui('.refinery-slot,.uib-equip-slot').count(),0);
    await ui('[data-weapon-view="acquire"]').click();await ui('[data-weapon-select="bow"]').click();await ui('[data-weapon-starter]').click();
    await frame().waitForFunction(()=>window.getCurrentUserData().weaponSystemV1?.equipped==='bow');
    await ui('[data-weapon-ticket]').click();await frame().waitForFunction(()=>window.getCurrentUserData().weaponSystemV1?.chests===1);
    await ui('[data-weapon-open]').click();await frame().waitForFunction(()=>window.getCurrentUserData().weaponSystemV1?.weapons.bow?.copies===2);
    await ui('[data-weapon-view="weapons"]').click();await ui('[data-weapon-upgrade="merge"]').click();
    await frame().waitForFunction(()=>window.getCurrentUserData().weaponSystemV1?.weapons.bow?.level===2);assert.equal(db.records.get('users/u1').stats.gold,5000);
    await ui('[data-weapon-upgrade="gold"]').click();await ui('[data-weapon-retry]').waitFor();assert.equal(db.records.get('weaponArmories/u1').weapons.bow.level,3);assert.equal(db.records.get('users/u1').stats.gold,3800);
    await ui('[data-weapon-retry]').click();await frame().waitForFunction(()=>window.getCurrentUserData().weaponSystemV1?.weapons.bow?.level===3);
    assert.equal(db.records.get('users/u1').stats.gold,3800);assert.equal(upgrades.at(-1).requestId,upgrades.at(-2).requestId);
    async function bounds(){return frame().evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,slots:document.querySelectorAll('.wf-equipped').length,
      cards:[...document.querySelectorAll('.wf-weapon,.wf-upgrade-options button')].map(b=>{const r=b.getBoundingClientRect();return {x:r.x,right:r.right};})}));}
    for(const [name,size]of [['mobile',{width:393,height:852}],['landscape',{width:1280,height:720}],['tablet',{width:1024,height:1366}]]){
      await page.setViewportSize(size);await page.waitForFunction(expected=>Math.abs(window.QAGameStage.getState().width-expected.width)<.2,Stage.fit(size));
      const measured=await bounds();assert.equal(measured.slots,1);assert.ok(measured.scroll<=measured.width+1);assert.ok(measured.cards.every(r=>r.x>=0&&r.right<=measured.width+1));
      await frame().evaluate(()=>{document.querySelector('#page-training').scrollTop=0;document.querySelector('#training-tab-content').scrollTop=0;});await frame().evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(out,'weapon-forge-'+name+'.png')});
    }
    await page.setViewportSize({width:393,height:852});await ui('[data-weapon-view="acquire"]').click();await page.screenshot({path:path.join(out,'weapon-acquisition-mobile.png')});
    await frame().evaluate(()=>{sessionStorage.testUid='u2';window.__users.u2.stats.totalScore=6;window.dispatchEvent(new CustomEvent('xiuxian:user-data-ready'));window.openWeaponForge();});
    await frame().waitForFunction(()=>window.getCurrentUserData().weaponSystemV1?.starterClaimed===false);assert.equal(await ui('[data-weapon-retry]').count(),0);assert.equal(db.records.has('weaponArmories/u2'),false);
    assert.deepEqual(errors,[]);console.log('Weapon browser checks passed: Foundation navigation, one slot, five weapons, starter/chest choice, duplicate and gold upgrades, lost-response idempotency, three stage sizes, no horizontal clipping and account isolation.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

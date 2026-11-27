#!/usr/bin/env node
'use strict';
// Isolated browser acceptance: fixture identity, signed quiz receipts, real combat API.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const express=require('express'),{chromium}=require('playwright');
const register=require('../tactical-combat-api.cjs'),API=register.__test;
const M=require('../public/cultivation/manual-rules.js'),R=require('../public/cultivation/tactical-rules.js');
const Receipt=require('../solo-question-receipt.cjs'),{database}=require('../tests/helpers/tactical-db.cjs');
const output=path.resolve(process.argv[2]||'/tmp/weapon-dungeon-browser');fs.mkdirSync(output,{recursive:true});
async function main(){
 const db=database(),key=Buffer.alloc(32,42),app=express();app.use(express.json());
 db.records.get('users/u1').stats.totalScore=0;
 db.records.set(API.MANUALS+'/u1',M.weaponize({books:{'body-rock':{exp:1080},'sword-wind':{exp:0}},weaponIds:['body-rock','sword-wind']}));
 const ordinary=await API.start(db,'u1',{mode:'pve'});
 db.records.get(API.PLAYERS+'/u1').bestiary={version:1,seen:Array.from({length:20},(_,i)=>i)};
 app.get('/cultivation/data/project-repository.js',(_,res)=>res.type('text/javascript').send(
  "export const getMainUser=()=>({uid:'u1'});export const authenticatedMainFetch=(url,init={})=>fetch(url,{...init,headers:{...init.headers,'Content-Type':'application/json'}});"));
 let question=0;
 app.get('/fixture-quiz',(_,res)=>{
  const parsed={q:'二加三是多少？（驗收 '+(++question)+'）',correct:'5',wrong:['3','4','6'],exp:'二加三等於五。',subject:'數學'};
  res.json({data:{q:parsed.q,opts:[parsed.correct,...parsed.wrong]},soloProof:Receipt.issue('u1',parsed,{difficulty:'easy'},key)});
 });
 app.post('/api/tactical/answer',async(req,res)=>{try{
  res.json({ok:true,state:await API.answer(db,'u1',req.body,Date.now(),(uid,input)=>Receipt.read(uid,input,key))});
 }catch(e){res.status(e.status||500).json({error:e.message});}});
 register(app,{resolve:()=>({db}),verify:async()=> 'u1'});
 app.get('/test',(_,res)=>res.type('html').send(`<!doctype html><html><head>
  <meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/gameplay-page.css">
  <style>body{margin:0;background:#14251e;color:#ede5cf}#fixture-study{position:fixed;inset:0;z-index:1000;background:#14251e;padding:20px}button{min-height:32px}</style></head>
  <body class="xianxia-theme ui-cleanup"><div id="page-gameplay" class="page-section active-page gameplay-page"><div class="gameplay-shell"><header class="gameplay-heading"><h2>歷練</h2></header><div class="gameplay-entries"></div></div></div>
  <section id="fixture-study" hidden><button id="fixture-answer">回答</button><p id="fixture-explanation"></p><button id="fixture-next">返回戰場</button></section>
  <script>window.getCurrentUserData=()=>({stats:{totalScore:0}});window.switchToPage=()=>{};
  window.QATrialQuestion={open(options){window.__study=options;document.getElementById('fixture-study').hidden=false;
    document.getElementById('fixture-explanation').textContent='';document.getElementById('fixture-answer').disabled=false;},
    close(){const panel=document.getElementById('fixture-study');const wasOpen=!panel.hidden;panel.hidden=true;return wasOpen;},next(){}};
  document.getElementById('fixture-answer').onclick=async()=>{try{const quiz=await(await fetch('/fixture-quiz')).json();
   const result=await window.__study.submit(quiz,0,Date.now());result.applyProgress();
   document.getElementById('fixture-explanation').textContent=result.review.explanation;
   document.getElementById('fixture-answer').disabled=true;
  }catch(e){document.getElementById('fixture-explanation').textContent='ERROR: '+e.message;}};
  document.getElementById('fixture-next').onclick=()=>window.__study.next();</script>
  <script type="module" src="/cultivation/weapon-dungeons-page.js"></script></body></html>`));
 app.use(express.static(path.join(__dirname,'../public')));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});let browser,page;
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.TACTICAL_CHROMIUM?{executablePath:process.env.TACTICAL_CHROMIUM}:{})});
  page=await browser.newPage({viewport:{width:393,height:852}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/test');
  await page.locator('#gameplay-weapon-dungeon-entry').click();
  await page.locator('[data-atlas-dungeon="peak-stone"]').waitFor();
  assert.equal(await page.locator('[data-wd-difficulty]').count(),0);
  assert.equal(await page.locator('.gameplay-entries').isVisible(),false);
  assert.equal(await page.locator('[data-atlas-back]').isVisible(),true);
  await page.waitForFunction(()=>{const img=document.querySelector('[data-atlas-dungeon="peak-stone"] img');return img?.complete&&img.naturalWidth>0;});
  await page.waitForFunction(()=>document.querySelector('[data-atlas-tickets] .game-resource-amount')?.textContent==='3');
  await page.screenshot({path:path.join(output,'dungeon-islands.png')});
  await page.locator('[data-atlas-back]').click();
  assert.equal(await page.locator('.gameplay-entries').isVisible(),true);
  assert.equal(await page.locator('#gameplay-dungeon-atlas').isVisible(),false);
  await page.locator('#gameplay-weapon-dungeon-entry').click();
  await page.locator('[data-atlas-dungeon="peak-stone"]').click();
  await page.locator('[data-wd-difficulty="0"]').waitFor();
  assert.equal(await page.locator('[data-wd-difficulty]').count(),6);
  assert.equal(await page.locator('#weapon-dungeons-panel header button').count(),1);
  assert.equal(await page.locator('[data-wd-back]').isVisible(),true);
  assert.equal(await page.locator('.wd-ticket-help').isVisible(),false);
  await page.locator('.wd-tickets summary').click();
  assert.equal(await page.locator('.wd-ticket-help').isVisible(),true);
  await page.locator('.wd-tickets summary').click();
  assert.equal(await page.locator('.wd-intel ol').isVisible(),false);
  assert.equal(await page.locator('[data-wd-difficulty="1"]').getAttribute('data-qy-difficulty'),'locked');
  assert.match(await page.locator('.wd-tickets').textContent(),/副本券\s*3\b/);
  assert.match(await page.locator('.wd-tickets').textContent(),/補發上限 5 張/);
  for(const viewport of [{width:393,height:852},{width:1180,height:820},{width:360,height:640}]){
   await page.setViewportSize(viewport);
   const bounds=await page.locator('#weapon-dungeons-panel').boundingBox();
   assert(bounds.x>=0&&bounds.x+bounds.width<=viewport.width+1);
   assert.equal(await page.locator('#weapon-dungeons-panel').evaluate(el=>el.tagName==='SECTION'&&!!el.closest('#page-gameplay')&&getComputedStyle(el).position!=='fixed'),true);
   assert.equal(await page.locator('dialog:modal').count(),0);
   await page.screenshot({path:path.join(output,'selection-'+viewport.width+'.png')});
  }
  // Landscape uses the complete gameplay tab and restores the identical atlas on return.
  await page.setViewportSize({width:1180,height:820});
  const panel=page.locator('#weapon-dungeons-panel'),atlas=page.locator('#gameplay-dungeon-atlas');
  const originalAtlas=await atlas.innerHTML();
  assert.equal(await page.locator('.gameplay-heading').isVisible(),false);
  assert.equal(await page.locator('.gameplay-entries').isVisible(),false);
  assert.equal(await atlas.isVisible(),false);
  const full=await panel.evaluate(el=>{
    const shell=el.parentElement,s=getComputedStyle(shell),a=el.getBoundingClientRect(),b=shell.getBoundingClientRect();
    return {width:a.width,available:b.width-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),height:a.height,availableHeight:b.height-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom),area:getComputedStyle(el).gridArea};
  });
  assert(Math.abs(full.width-full.available)<2);assert(full.height>=full.availableHeight-2);assert.match(full.area,/detail/);
  await panel.locator('[data-wd-close]').click();
  await atlas.waitFor({state:'visible'});
  assert.equal(await panel.isVisible(),false);
  assert.equal(await page.locator('.gameplay-heading').isVisible(),true);
  assert.equal(await page.locator('.gameplay-entries').isVisible(),true);
  assert.equal(await atlas.innerHTML(),originalAtlas);
  await atlas.locator('[data-atlas-dungeon="peak-stone"]').click();
  await page.locator('[data-wd-difficulty="0"]').waitFor({state:'visible'});
  assert.equal(await atlas.isVisible(),false);
  assert.equal((await API.weaponDungeonState(db,'u1')).tickets,3);
  await page.setViewportSize({width:393,height:852});
  const rail=page.locator('.wd-difficulties');
  await rail.scrollIntoViewIfNeeded();
  assert.equal(await rail.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  const row=await rail.locator('button').evaluateAll(items=>items.map(b=>Math.round(b.getBoundingClientRect().top)));
  assert.equal(new Set(row).size,1);
  await page.locator('[data-wd-difficulty="1"]').click();
  assert.equal(await page.locator('[data-wd-enter]').isDisabled(),true);
  assert.equal(await page.locator('[data-wd-difficulty="1"]').getAttribute('aria-pressed'),'true');
  assert.equal(await rail.evaluate(el=>el.style.getPropertyValue('--wd-selected-index')),'1');
  assert.match(await page.locator('[data-wd-preview]').textContent(),/30% 金丹武器/);
  assert.equal((await API.weaponDungeonState(db,'u1')).tickets,3);
  await page.locator('[data-wd-difficulty="0"]').click();
  await page.locator('[data-wd-enter]').click();
  await page.locator('#tactical-combat canvas').waitFor();
  await page.waitForFunction(()=>!document.querySelector('#tactical-combat [data-quiz]').disabled);
  const read=()=>API.state(db,'u1',Date.now(),'weapon-dungeon');
  let room=await read();assert(room.weaponDungeon);assert.equal((await API.state(db,'u1',Date.now(),'pve')).id,ordinary.id);
  assert.equal((await API.weaponDungeonState(db,'u1')).tickets,2);
  const clickSector=async selector=>{const target=page.locator(selector);await target.click({position:await target.evaluate(button=>{
   const label=button.querySelector('.tc-rw-sector-label');return {x:button.clientWidth*parseFloat(label.style.left)/100,y:button.clientHeight*parseFloat(label.style.top)/100};
  })});};
  await clickSector('[data-weapon-choice="1"]');
  assert.equal(await page.locator('[data-wheel-choice^="manual:"]').count(),1,'locked sword techniques are absent');
  assert.equal(await page.locator('[data-wheel-choice="manual:wind-step"]').count(),0);
  for(let i=1;i<=2;i++){
   await page.locator('[data-quiz]').click();await page.locator('#fixture-answer').click();
   await page.waitForFunction(()=>document.getElementById('fixture-explanation').textContent==='二加三等於五。');
   assert.equal((await read()).actors[0].answered,i);
   await page.locator('#fixture-next').click();await page.locator('#tactical-combat canvas').waitFor();
  }
  room=await read();assert.equal(room.actors[0].stamina,10);assert.equal(room.actors[0].questions,2);
  assert.equal((await API.weaponDungeonState(db,'u1')).tickets,2);
  await page.locator('[data-close]').click();await page.evaluate(()=>window.openWeaponDungeons());
  await page.waitForFunction(()=>document.querySelector('[data-atlas-tickets] .game-resource-amount')?.textContent==='2');
  await page.locator('[data-atlas-dungeon="peak-stone"]').click();
  await page.locator('[data-wd-enter]').waitFor({state:'visible'});
  assert.match(await page.locator('[data-wd-enter]').textContent(),/不耗券/);
  await page.locator('[data-wd-enter]').click();await page.locator('#tactical-combat canvas').waitFor();
  assert.equal((await read()).id,room.id);assert.equal((await API.weaponDungeonState(db,'u1')).tickets,2);
  const raw=db.records.get(API.ROOMS+'/'+room.id);
  raw.blocks=[];
  const remainingGuards=raw.actors.filter(a=>a.bot&&!a.weaponDungeonLord&&a.hp>0).length;
  assert(remainingGuards>=8,'guards must remain alive for the boss-only victory regression');
  Object.assign(raw.actors[0],{x:6,y:3,stamina:10});raw.actors[1].hp=1;R.prepareIntents(raw);
  const victory=await API.command(db,'u1',{roomId:room.id,type:'manual',skillId:'rock-fist',x:6,y:2,revision:raw.revision,requestId:'browser-final-blow'},Date.now());
  assert.equal(victory.status,'finished');
  assert.equal(victory.weaponDungeonResult.cleared,true);
  assert.equal(victory.actors.filter(a=>a.bot&&!a.weaponDungeonLord&&a.hp>0).length,remainingGuards);
  await page.evaluate(()=>document.querySelector('[data-sync]').click());
  await page.locator('[data-weapon-dungeon-menu]').waitFor();
  assert.match(await page.locator('.tc-dialog').textContent(),/尖峰石域.*通關/);
  assert.match(await page.locator('.tc-dialog').textContent(),/已擊敗石域領主/);
  assert.equal(await page.locator('[data-manual-xp-toast]').count(),0,'live XP must not obscure the results');
  await page.screenshot({path:path.join(output,'victory.png'),animations:'disabled'});
  await page.locator('[data-weapon-dungeon-menu]').click();
  await page.locator('[data-atlas-dungeon="peak-stone"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-wd-difficulty="1"]')?.dataset.qyDifficulty==='ready');
  await page.locator('[data-wd-difficulty="1"]').click();assert.equal(await page.locator('[data-wd-enter]').isDisabled(),false);
  assert.match(await page.locator('.wd-tickets').textContent(),/副本券\s*2\b/);
  assert.match(await page.locator('.wd-tickets').textContent(),/補發上限 5 張/);
  assert.equal((await API.weaponDungeonState(db,'u1')).clears[0],1);assert.deepEqual(errors,[]);
  console.log('Weapon dungeon verified: responsive selector, hidden locked skills, two signed quiz answers, free resume, victory and next-tier unlock.');
 }catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
 finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

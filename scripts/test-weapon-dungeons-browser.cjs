#!/usr/bin/env node
'use strict';
// Isolated browser acceptance: fixture identity, signed quiz receipts, real combat API.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const express=require('express'),{chromium}=require('playwright');
const register=require('../tactical-combat-api.cjs'),API=register.__test;
const M=require('../public/cultivation/manual-rules.js'),R=require('../public/cultivation/tactical-rules.js');
const Rewards=require('../weapon-dungeon-rewards.cjs');
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
 // Isolated test fixture only: actual HTTP routes with an explicit server-side
 // developer option. Production keeps the default public register above.
 const devRouter=express.Router();
 register(devRouter,{resolve:()=>({db}),verify:async()=> 'u1',allowHiddenWeaponDungeons:true});
 app.use('/dev',devRouter);
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
  await page.waitForFunction(()=>document.querySelector('[data-atlas-progress]')?.textContent.includes('已征服 0 / 6'));
  await page.screenshot({path:path.join(output,'dungeon-islands.png')});
  await page.locator('[data-atlas-back]').click();
  assert.equal(await page.locator('.gameplay-entries').isVisible(),true);
  assert.equal(await page.locator('#gameplay-dungeon-atlas').isVisible(),false);
  await page.locator('#gameplay-weapon-dungeon-entry').click();
  await page.locator('[data-atlas-dungeon="peak-stone"]').click();
  await page.locator('[data-wd-difficulty="0"]').waitFor();
  assert.equal(await page.locator('[data-wd-difficulty]').count(),6);
  const expectedSwordIds=M.BOOKS.filter(b=>b.weaponType==='sword'&&['築基','煉氣'].includes(b.tierRealm)).map(b=>b.id).sort();
  assert.deepEqual(await page.locator('[data-wd-reward-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.wdRewardId).sort()),expectedSwordIds);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-wd-reward-id] img')).every(img=>img.complete&&img.naturalWidth>0));
  assert.equal(await page.locator('#weapon-dungeons-panel header button').count(),1);
  assert.equal(await page.locator('[data-wd-back]').isVisible(),true);
  assert.equal(await page.locator('[data-wd-back] svg path').count(),1);
  assert.equal(await page.locator('[data-wd-back] svg').isVisible(),true);
  assert.equal(await page.locator('.wd-tickets .game-stone-sr-only').evaluate(el=>el.getBoundingClientRect().width<=1),true);
  assert.equal(await page.locator('.wd-ticket-help').isVisible(),false);
  await page.locator('.wd-tickets summary').click();
  assert.equal(await page.locator('.wd-ticket-help').isVisible(),true);
  await page.locator('.wd-tickets summary').click();
  assert.equal(await page.locator('.wd-intel ol').isVisible(),false);
  assert.equal(await page.locator('[data-wd-difficulty="1"]').getAttribute('data-qy-difficulty'),'locked');
  assert.match(await page.locator('.wd-tickets').textContent(),/副本券\s*3\b/);
  assert.match(await page.locator('.wd-tickets').textContent(),/補發上限 5 張/);
  for(const viewport of [{width:320,height:568},{width:393,height:852},{width:768,height:1024},{width:1180,height:820},{width:360,height:640},{width:667,height:375},{width:568,height:320}]){
   await page.setViewportSize(viewport);
   const bounds=await page.locator('#weapon-dungeons-panel').boundingBox();
   assert(bounds.x>=0&&bounds.x+bounds.width<=viewport.width+1);
   assert.equal(await page.locator('#weapon-dungeons-panel').evaluate(el=>el.tagName==='SECTION'&&!!el.closest('#page-gameplay')&&getComputedStyle(el).position!=='fixed'),true);
   assert.equal(await page.locator('dialog:modal').count(),0);
   const layout=await page.locator('#weapon-dungeons-panel').evaluate(el=>{const visible=['header','[data-wd-enter]','.wd-difficulties','.wd-reward-pair'].map(s=>el.querySelector(s));return {inside:visible.every(n=>{const a=n.getBoundingClientRect(),b=el.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1}),rail:el.querySelector('.wd-difficulties').scrollWidth<=el.querySelector('.wd-difficulties').clientWidth+1,root:el.scrollWidth<=el.clientWidth+1};});
   assert(layout.inside&&layout.rail&&layout.root,'no horizontal overflow at '+viewport.width+'x'+viewport.height);
   await page.locator('[data-wd-enter]').scrollIntoViewIfNeeded();assert.equal(await page.locator('[data-wd-enter]').isVisible(),true);
   await page.screenshot({path:path.join(output,'selection-'+viewport.width+'.png')});
   console.log('Dungeon selection viewport passed',viewport.width+'x'+viewport.height);
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
  assert.match(await page.locator('[data-wd-preview]').textContent(),/20% 築基武器/);
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
  await page.locator('[data-atlas-resume]').waitFor({state:'visible'});
  assert.match(await page.locator('[data-atlas-resume]').textContent(),/不耗券/);
  await page.locator('[data-atlas-resume]').click();await page.locator('#tactical-combat canvas').waitFor();
  await page.locator('.wd-portal').waitFor({state:'detached'});
  await page.waitForFunction(()=>document.querySelector('[data-sync]')?.disabled===false);
  assert.equal((await read()).id,room.id);assert.equal((await API.weaponDungeonState(db,'u1')).tickets,2);
  const raw=db.records.get(API.ROOMS+'/'+room.id);
  raw.blocks=[];
  const remainingGuards=raw.actors.filter(a=>a.bot&&!a.weaponDungeonLord&&a.hp>0).length;
  assert(remainingGuards===6,'guards must remain alive for the boss-only victory regression');
  Object.assign(raw.actors[0],{x:6,y:3,stamina:10});raw.actors[1].hp=1;R.prepareIntents(raw);
  // Force a current-tier roll only in this isolated fixture. The real roll,
  // inventory transaction and public artwork still execute; probability tests
  // separately cover all 100 values.
  const originalRoll=Rewards.roll;let victory;
  try{Rewards.roll=(...args)=>originalRoll(...args,()=>0);
   victory=await API.command(db,'u1',{roomId:room.id,type:'manual',skillId:'rock-fist',x:6,y:2,revision:raw.revision,requestId:'browser-final-blow'},Date.now());
  }finally{Rewards.roll=originalRoll;}
  assert.ok(victory.manualDrops?.u1?.id,'real transaction awards a weapon');
  assert.equal(M.BY_BOOK[victory.manualDrops.u1.id].weaponType,'sword');
  assert.equal(victory.status,'finished');
  assert.equal(victory.weaponDungeonResult.cleared,true);
  assert.equal(victory.actors.filter(a=>a.bot&&!a.weaponDungeonLord&&a.hp>0).length,remainingGuards);
  await page.waitForFunction(()=>document.querySelector('[data-sync]')?.disabled===false);
  await page.evaluate(()=>document.querySelector('[data-sync]').click());
  await page.locator('[data-weapon-dungeon-menu]').waitFor();
  assert.match(await page.locator('.tc-dialog').textContent(),/尖峰石域.*通關/);
  assert.match(await page.locator('.tc-dialog').textContent(),/已擊敗石域領主/);
  assert.equal(await page.locator('[data-manual-xp-toast]').count(),0,'live XP must not obscure the results');
  assert.equal(await page.locator('[data-wd-result="cleared"]').count(),1);
  assert.match(await page.locator('.wd-result-unlock').textContent(),/首次解鎖.*金丹/);
  assert.equal(await page.locator('.wd-result-crest svg').isVisible(),true);
  const rewardImage=page.locator('.mr-reward-item--weapon img');await rewardImage.waitFor();
  await page.waitForFunction(()=>{const im=document.querySelector('.mr-reward-item--weapon img');return im?.complete&&im.naturalWidth>0});
  await page.locator('.wd-result .mr-reward-skip').waitFor({state:'detached'});
  for(const viewport of [{width:320,height:568},{width:667,height:375},{width:1180,height:820}]){
   await page.setViewportSize(viewport);const settled=page.locator('.tc-dungeon-settlement');assert.equal(await settled.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
   await settled.evaluate(el=>{el.scrollTop=0;});
   const geometry=await settled.evaluate(el=>{const a=el.querySelector('.wd-result-crest').getBoundingClientRect(),b=el.querySelector('.wd-result-body').getBoundingClientRect(),f=el.querySelector('.wd-result-actions').getBoundingClientRect(),p=el.getBoundingClientRect();return {crest:a.top>=p.top-1,footer:f.top>=b.bottom-1,modal:document.elementFromPoint(p.left+3,p.top+3)?.closest('.tc-dungeon-settlement')===el};});
   assert(geometry.crest&&geometry.footer&&geometry.modal,'settlement content must not be covered by battle header or action bar '+viewport.width+'x'+viewport.height);
   await page.screenshot({path:path.join(output,'victory-top-'+viewport.width+'.png'),animations:'disabled'});
   await page.locator('[data-weapon-dungeon-retry]').scrollIntoViewIfNeeded();assert.equal(await page.locator('[data-weapon-dungeon-retry]').isVisible(),true);
   await page.screenshot({path:path.join(output,'victory-'+viewport.width+'.png'),animations:'disabled'});
  }
  await page.setViewportSize({width:393,height:852});
  await page.screenshot({path:path.join(output,'victory.png'),animations:'disabled'});
  await page.locator('[data-weapon-dungeon-retry]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-wd-result]')&&!!document.querySelector('#tactical-combat canvas')&&!document.querySelector('.wd-portal'));
  const retryRoom=await read();assert.notEqual(retryRoom.id,room.id);assert.equal((await API.weaponDungeonState(db,'u1')).tickets,1);
  await API.command(db,'u1',{roomId:retryRoom.id,type:'leave',requestId:'browser-retry-forfeit'},Date.now());
  await page.waitForFunction(()=>document.querySelector('[data-sync]')?.disabled===false);
  await page.evaluate(()=>document.querySelector('[data-sync]').click());
  await page.locator('[data-wd-result="failed"]').waitFor();assert.equal(await page.locator('.wd-result-unlock').count(),0);
  await page.screenshot({path:path.join(output,'failure-settlement.png'),animations:'disabled'});
  await page.locator('[data-weapon-dungeon-menu]').click();
  await page.locator('[data-atlas-dungeon="peak-stone"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-wd-difficulty="1"]')?.dataset.qyDifficulty==='ready');
  await page.locator('[data-wd-difficulty="1"]').click();assert.equal(await page.locator('[data-wd-enter]').isDisabled(),false);
  assert.match(await page.locator('.wd-tickets').textContent(),/副本券\s*1\b/);
  assert.match(await page.locator('.wd-tickets').textContent(),/補發上限 5 張/);
  assert.equal((await API.weaponDungeonState(db,'u1')).clears[0],1);assert.deepEqual(errors,[]);
  console.log('Weapon dungeon verified: responsive selector, hidden locked skills, two signed quiz answers, free resume, victory and next-tier unlock.');
  // Verify that no request flag can expose the second dungeon on public HTTP.
  const publicGate=await page.evaluate(async()=>{
   const list=await(await fetch('/api/tactical/weapon-dungeons?allowHidden=true')).json();
   const denied=await fetch('/api/tactical/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    activity:'weapon-dungeon',dungeonId:'beast-wilds',difficulty:0,requestId:'hidden-browser-denied',allowHidden:true,allowHiddenWeaponDungeons:true})});
   return {ids:list.state.dungeons.map(d=>d.id),status:denied.status};
  });
  assert.deepEqual(publicGate,{ids:['peak-stone'],status:400});
  assert.equal((await API.weaponDungeonState(db,'u1')).tickets,1);
  const devPage=await browser.newPage({viewport:{width:393,height:852}}),devErrors=[];
  devPage.on('pageerror',e=>devErrors.push(e.message));
  try{
   await devPage.route('**/api/tactical/**',route=>{
    const url=new URL(route.request().url());url.pathname='/dev'+url.pathname;return route.continue({url:url.href});
   });
   await devPage.goto('http://127.0.0.1:'+server.address().port+'/test');
   await devPage.locator('#gameplay-weapon-dungeon-entry').click();
   await devPage.locator('[data-atlas-dungeon="beast-wilds"]').waitFor();
   assert.equal(await devPage.locator('[data-atlas-dungeon]').count(),2);
   const wildArt=devPage.locator('[data-atlas-dungeon="beast-wilds"] img');
   assert.equal(await wildArt.getAttribute('src'),'/assets/dungeons/beast-wilds.png');
   await devPage.waitForFunction(()=>{const el=document.querySelector('[data-atlas-dungeon="beast-wilds"] img');return el?.complete&&el.naturalWidth>0});
   const rgba=await wildArt.evaluate(img=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;let transparent=0,opaque=0;for(let i=3;i<data.length;i+=4){if(data[i]===0)transparent++;if(data[i]===255)opaque++;}return {width:c.width,height:c.height,transparent,opaque};});
   assert.equal(rgba.width,1312);assert.equal(rgba.height,1199);assert.ok(rgba.transparent>0&&rgba.opaque>0,'Original RGBA Wilds asset must contain transparent and opaque pixels');
   for(const viewport of [{width:320,height:568},{width:393,height:852},{width:768,height:1024},{width:667,height:375},{width:1180,height:820}]){
    await devPage.setViewportSize(viewport);await devPage.locator('[data-atlas-dungeon="beast-wilds"]').waitFor();
    await devPage.waitForFunction(()=>{const el=document.querySelector('[data-atlas-dungeon="beast-wilds"] img');return el?.complete&&el.naturalWidth>0});
    const fit=await devPage.locator('[data-atlas-dungeon="beast-wilds"]').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&el.querySelector('img').complete&&el.querySelector('img').naturalWidth>0});
    assert.ok(fit,'Wilds atlas '+viewport.width+'x'+viewport.height);await devPage.screenshot({path:path.join(output,'wild-atlas-'+viewport.width+'.png')});
   }
   await devPage.locator('[data-atlas-dungeon="beast-wilds"]').click();
   await devPage.locator('[data-wd-difficulty="0"]').waitFor();
   assert.equal(await devPage.locator('[data-wd-difficulty]').count(),6);
   assert.match(await devPage.locator('.wd-bonus').textContent(),/弦修/);
   assert.equal(await devPage.locator('.wd-island').getAttribute('src'),'/assets/dungeons/beast-wilds.png');
   for(const viewport of [{width:320,height:568},{width:393,height:852},{width:768,height:1024},{width:667,height:375},{width:1180,height:820}]){
    await devPage.setViewportSize(viewport);await devPage.waitForFunction(()=>{const el=document.querySelector('.wd-island');return el?.complete&&el.naturalWidth>0});
    const fit=await devPage.locator('#weapon-dungeons-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.querySelector('.wd-island').complete&&el.querySelector('.wd-island').naturalWidth>0);
    assert.ok(fit,'Wilds selection '+viewport.width+'x'+viewport.height);await devPage.locator('[data-wd-enter]').scrollIntoViewIfNeeded();assert.ok(await devPage.locator('[data-wd-enter]').isVisible());
    await devPage.screenshot({path:path.join(output,'wild-selection-'+viewport.width+'.png')});
   }
   await devPage.locator('[data-wd-enter]').click();
   await devPage.locator('#tactical-combat canvas').waitFor();
   await devPage.waitForFunction(()=>document.querySelector('[data-objective]')?.textContent.includes('萬獸險域'));
   const wild=await read();assert.equal(wild.weaponDungeon.id,'beast-wilds');assert.equal(wild.width,11);assert.equal(wild.height,15);assert.equal(wild.terrain,13);
   assert.match(await devPage.locator('[data-objective]').textContent(),/弦修 \+15%/);
   assert.equal((await API.weaponDungeonState(db,'u1',Date.now(),{allowHidden:true})).tickets,0);
   await devPage.screenshot({path:path.join(output,'hidden-beast-wilds.png'),animations:'disabled'});
   assert.deepEqual(devErrors,[]);
  }finally{await devPage.close();}
  console.log('Hidden Beast Wilds verified: public admission rejected, trusted development atlas and 11x15 battlefield, shared ticket consumed once.');
 }catch(error){if(page)console.error('Dungeon browser diagnostic',await page.evaluate(()=>({notice:document.querySelector('[data-notice]')?.textContent,modal:document.querySelector('[data-modal]')?.textContent,portal:!!document.querySelector('.wd-portal'),syncDisabled:document.querySelector('[data-sync]')?.disabled})).catch(()=>null));if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
 finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

// Render production markup against local sample data. Never import account or API adapters.
const fs=require('node:fs'),path=require('node:path');
module.exports=async function capturePages({page,frame,origin,root,output,reports,assert}) {
 const read=name=>fs.readFileSync(path.join(root,name),'utf8');
 const strip=source=>source.replace(/^import[\s\S]*?;\n/gm,'');
 const auth=`const getApp=()=>({});const getAuth=()=>({currentUser:{uid:'layout-preview'}});const getMainUser=()=>({uid:'layout-preview'});`;
 const add=content=>frame.addScriptTag({type:'module',content}).then(()=>frame.waitForTimeout(30));
 const module=async(file,marker,imports,expose)=>{
  const source=strip(read(file)),end=source.indexOf(marker);if(end<0)throw Error('Missing capture marker '+file);
  await add(imports+'\n'+source.slice(0,end)+'\n'+expose+'\n})();');
 };
 const catalogs=`import * as A from '/cultivation/artifact-catalog.js';import * as M from '/cultivation/material-catalog.js';
 const {ARTIFACT_CATALOG,ARTIFACT_EQUIP_SLOTS,getArtifactById,artifactRealmColor,realmForScore,realmOrderByName}=A;
 const {MATERIAL_CATALOG,ARTIFACT_RECIPES,RAID_REFINEMENT_KEYS,RAID_CRAFT_MATERIAL_IDS,getMaterialById,getArtifactRecipe,materialRealmColor,materialRealmOrderByName,materialMarketReferencePrice,materialMarketMinimumTotal,artifactRecipeDepth,MAX_ARTIFACT_RECIPE_NESTING}=M;`;
 await add(`${catalogs}
 import '/cultivation/training-access-rules.js';import '/cultivation/soul-talents.js';import '/cultivation/nascent-growth.js';import '/cultivation/innate-ability.js';
 const core={type:'ocean',grade:3,createdAt:1};
 window.__pageSample={uid:'layout-preview',displayName:'青雲行者',stats:{totalScore:248,gold:1280},forgeFragments:360,
  inventory:[],equipped:{},profile:{displayName:'青雲行者',level:'國中三年級'},
  cultivationTraining:{core,equippedCore:core,equipped:true,coreEnabled:true},
  nascentSoulGrowth:{version:1,branches:{attack:5,vitality:3,cultivation:4,core:6}},
  innateAbilityGrowth:{version:1,paths:{ocean:{branch:'tide',level:3}}},
  raidTickets:{count:3,cap:5},goldenCoreWashV1:{count:4},
  materialSystem:{inventory:Object.fromEntries([...MATERIAL_CATALOG.filter(x=>RAID_CRAFT_MATERIAL_IDS.includes(x.id)).slice(0,8).map((x,i)=>[x.id,12+i]),['nascent-soul-essence',42]])},
  artifactSystem:{inventory:Object.fromEntries(ARTIFACT_CATALOG.filter(x=>x.effects?.some(e=>e.type?.startsWith('equip_'))).slice(0,8).map(x=>[x.id,1])),equipped:{}}};
 const equip=ARTIFACT_CATALOG.find(x=>x.effects?.some(e=>e.type?.startsWith('equip_'))&&x.equipSlot==='本命法寶');
 if(equip){window.__pageSample.artifactSystem.inventory[equip.id]=1;window.__pageSample.artifactSystem.equipped['本命法寶']=equip.id;}
 window.getCurrentUserData=()=>window.__pageSample;window.getTrainingAccessScore=()=>248;window.isGoldenCoreUnlocked=()=>true;
 window.getCombatPower=()=>({total:1824,base:640,core:520,equipment:664,items:[]});
 window.getCombatStats=()=>({attack:286,hp:1400,maxHp:1400,critChance:12,comboChance:8,critDamage:150,effects:[]});
 window.getCultivationRefineryPlan=()=>({valid:false,reason:'投入至少 2 個素材後，可查看煉製需求。'});
 window.getCultivationRefineryJob=()=>null;
 window.__previewCatalog={materials:MATERIAL_CATALOG,artifacts:ARTIFACT_CATALOG};`);
 // Existing settings disclosures retain their real listeners and original nodes.
 await frame.addScriptTag({url:origin+'/cultivation/dongfu-settings-collapsible.js'});
 await frame.evaluate(()=>{document.querySelector('#settings-email').textContent='preview@example.com';document.querySelector('#set-display-name').value='青雲行者';document.querySelector('#set-level').value='國中三年級';document.querySelector('#set-strong').value='數學';document.querySelector('#set-weak').value='自然';document.querySelector('#store-user-points').textContent='1,280';});
 // Social shell is injected by the same function as the signed-in application.
 const legacy=read('main-legacy.js');
 const social=legacy.slice(legacy.indexOf('function injectSocialUI()'),legacy.indexOf('// 切換分頁 (好友/聊天)'));
 await frame.evaluate(source=>{document.querySelector('#btn-social-nav')?.remove();const t=x=>({loading:'載入中'}[x]||x);eval(source);injectSocialUI();document.querySelector('#my-friend-code').textContent='QY248A';},social);
 // Friend sample identities exercise the existing list shell, profile triggers and unread controls.
 await frame.evaluate(()=>{const list=document.querySelector('#friend-list-container');list.innerHTML='';for(const [i,name]of ['沈清霜','雲間客','松風','白小滿'].entries()){
 const row=document.createElement('div');row.className='bg-slate-800/50 p-3 rounded-xl border border-slate-700 flex items-center gap-3';row.innerHTML='<button type="button" class="xpp-profile-trigger" aria-label="查看'+name+'的資料"><span class="ui-avatar-viewport" style="width:44px;height:44px;background:#c9ad7215;color:#cfb986">'+name[0]+'</span></button><div class="flex-1 min-w-0"><div class="flex justify-between items-center"><button type="button" class="xpp-profile-trigger font-bold text-white">'+name+'</button><span class="text-xs text-yellow-500">'+(i===0?'元嬰':'金丹')+'</span></div><div class="flex justify-between items-center mt-1"><span class="text-xs '+(i<2?'text-green-400':'text-gray-500')+'">'+(i<2?'在線':'離線')+'</span><button type="button" class="px-2 py-1 text-xs" aria-label="私訊'+name+'">私訊</button></div></div>';list.append(row);}
 window.switchSocialTab=tab=>{document.querySelector('#section-friends').classList.toggle('hidden',tab!=='friends');document.querySelector('#section-chat').classList.toggle('hidden',tab!=='chat');};
 document.querySelector('#chat-messages').innerHTML='<p class="text-center text-xs text-gray-500 py-3">今天 16:30</p>'+['清霜秘境有道友要一起嗎？','我可以，等我調整一下法寶。','剛完成今日問道，現在過去！'].map((x,i)=>'<article class="p-3 rounded-lg border border-white/5" style="max-width:80%;margin-top:12px"><small class="text-xs text-yellow-200/70">'+['雲間客','松風','青雲行者'][i]+'</small><p class="mt-2 text-sm">'+x+'</p></article>').join('');});
 // Production shop cards, with a small local cosmetic catalog.
 const storeLoop=legacy.slice(legacy.indexOf('        snap.forEach(doc => {',legacy.indexOf('window.loadStoreItems =')),legacy.indexOf('    } catch (e) { console.error(e); }',legacy.indexOf('window.loadStoreItems =')));
 await frame.evaluate(source=>{const grid=document.querySelector('#store-grid');grid.innerHTML='';const currentUserData=window.__pageSample;const t=x=>({btn_equip:'裝備',btn_equipped:'已裝備',btn_unequip_avatar:'取消裝備'}[x]||x);
 const renderVisual=(type,value)=>type==='avatar'?'<img src="'+value+'" style="width:72px;height:72px;object-fit:cover;object-position:50% 12%;border-radius:50%" alt="頭像">':'<span style="display:grid;place-items:center;width:72px;height:72px;border:2px solid '+value+';border-radius:50%;color:'+value+'">道</span>';
 const items=[['青雲弟子','avatar','assets/story/characters/player-male-determined.png'],['霜華劍影','avatar','assets/story/characters/shen-qingshuang.png'],['山月金環','frame','#c5ab70'],['清心玉環','frame','#89baa5'],['問道同修','avatar','assets/story/characters/player-female-determined.png'],['星河銀環','frame','#a8b3cb']];
 const snap={forEach:cb=>items.forEach((r,i)=>cb({id:'preview-'+i,data:()=>({name:r[0],type:r[1],value:r[2],price:200+i*100})}))};eval(source);
 },storeLoop);
 await frame.evaluate(source=>eval(source),legacy.slice(legacy.indexOf('window.filterStore ='),legacy.indexOf('\n};',legacy.indexOf('window.filterStore ='))+3));
 // Static pages use the actual containers. Sample rows exercise long and short text.
 await frame.evaluate(()=>{
 const rows=[['數學 · 二次函數','若 f(x) = 2x + 3，則 f(4) 的值為何？','答對','問道試煉'],['自然 · 物質的性質','下列哪一項屬於物理變化？','待訂正','清霜試煉'],['國文 · 文意理解','根據文章內容，作者想表達的主要意思為何？','答對','鬥法論道']];
 document.querySelector('#history-list').innerHTML=rows.map((r,i)=>'<li><div class="flex items-center justify-between gap-3"><span class="text-xs text-gray-400">'+r[0]+' · '+r[3]+'</span><span class="text-xs '+(i===1?'text-red-300':'text-green-300')+'">'+r[2]+'</span></div><p class="text-sm my-3">'+r[1]+'</p><button type="button" class="text-xs text-yellow-200/80">查看題目與解析 →</button></li>').join('');
 document.querySelector('#leaderboard-body').innerHTML=['沈清霜','雲間客','青雲行者','松風','白小滿'].map((x,i)=>'<tr><td class="text-yellow-200/70">'+(i+1)+'</td><td><div class="flex items-center gap-3"><span class="ui-avatar-viewport" style="width:32px;height:32px;background:#c8ad7210">'+x[0]+'</span><span>'+x+'</span></div></td><td class="text-right"><span class="text-xs text-yellow-100/70">'+(i<2?'煉虛':'化神')+'</span><small class="block text-gray-500">'+(580-i*86)+' 修為</small></td></tr>').join('');
 const options=document.querySelector('#options-container');options.innerHTML='';document.querySelector('#quiz-container').classList.remove('hidden');document.querySelector('#quiz-badge').textContent='數學 · 一次函數';document.querySelector('#question-text').textContent='若 f(x) = 2x + 3，則 f(4) 的值為何？';for(const [i,v]of ['7','9','11','13'].entries()){const b=document.createElement('button');b.type='button';b.className='w-full text-left p-4 bg-slate-700 rounded-lg border border-slate-600 flex items-center gap-3';b.innerHTML='<span class="flex items-center justify-center shrink-0">'+String.fromCharCode(65+i)+'</span><span class="quiz-rich-option">'+v+'</span>';options.append(b);}
 });
 await module('cultivation/player-marketplace.js','  function boot()',auth+catalogs,
 `currentUid='layout-preview';active=MATERIAL_CATALOG.filter(x=>RAID_CRAFT_MATERIAL_IDS.includes(x.id)).slice(0,4).map((x,i)=>({id:'listing'+i,type:'material',itemId:x.id,itemName:x.name,itemRealm:x.realm,itemIcon:x.icon||'材',quantity:4+i,price:120+i*50,sellerUid:'preview-seller',sellerName:['雲間客','松風'][i%2],status:'active'}));
 window.__uiMarket=open=>{mount();switchMarket(open);if(open)render();};`);
 // Real cultivation renderers, with side-effectful boot routines excluded.
 await module('cultivation/cultivation-training-v4.js','  function boot()',
 `${auth}import '/cultivation/golden-core-pity.js';import '/cultivation/golden-core-art.js';import '/cultivation/soul-talents.js';import '/cultivation/nascent-growth.js';import '/cultivation/innate-ability.js';
 import {equipmentShellMarkup,refineryShellMarkup} from '/cultivation/training-shared-shells.js';import {NASCENT_SOUL_THRESHOLD,normalizeSpirit} from '/cultivation/nascent-soul-rules.js';`,
 `state=migrate(window.__pageSample.cultivationTraining);window.__uiTraining={render(tab){activeTab=tab;renderTrainingPage();},choose(id){soulView.selected=id;renderTrainingPage();}};`);
 await module('cultivation/unified-inventory-grid.js','  function boot()',catalogs+`import {soulboundItemFrameMarkup} from '/cultivation/soulbound-item-frame.js';`,
 `window.__uiInventory=view=>{ensureStyle();const content=document.querySelector('#training-tab-content');const items=collectItems();content.innerHTML=rootMarkup(items,view);bindRoot(content.querySelector('#'+ROOT_ID));};`);
 await module('cultivation/cultivation-refinery-v2.js','  function boot()',auth+catalogs,
 `window.__uiForge=()=>{ensureStyle();const content=document.querySelector('#training-tab-content');content.innerHTML=markup();bindContent(content);};`);
 await module('cultivation/cultivation-status-panel.js','  function boot()','',
 `window.__uiStatus=()=>{loadStyle();document.querySelector('#training-tab-content').innerHTML=statusMarkup(statusSnapshot());};`);
 await module('cultivation/soulbound-draw.js','  window.mountSoulboundTrainingPage =',auth+catalogs+`import '/cultivation/soulbound-pool.js';`,
 `window.__uiContract=()=>{account='layout-preview';snapshot={rank:4,balance:1280,fragments:360,draws:8,misses:8,untilPity:12,drawTickets:3,prices:{single:500,five:2250},poolVersion:pool.VERSION};mount();render();stopCarousel();};`);
 const raidImports=auth+`import {RAID_MVP,shenPhaseForHp,shenIntentForRound,bossClockState} from '/cultivation/raid-engine.js';import {RAID_TRIALS,raidTrialById} from '/cultivation/raid-catalog.js';import '/cultivation/raid-difficulty.js';
 const playerRepository={currentUser:getMainUser};const listPublicRaidRooms=async()=>[];const raidRoomMembers=r=>Object.values(r?.members||{});const raidMemberOnline=()=>true;`;
 await module('cultivation/raid-mode.js','  function boot()',raidImports,
 `window.__uiRaid={render(){ensureStyle();const page=ensurePage();page.classList.remove('hidden');page.classList.add('active-page');syncRaidViewportLock();renderHub();},unlock:syncRaidViewportLock};`);
 let battle=strip(read('cultivation/battle-mode-v2.js'));battle=battle.slice(battle.indexOf('  (function () {'),battle.indexOf('  function boot()'));
 await add(`const battleDb={};const playerRepository={currentUser:()=>({uid:'layout-preview'})};
 import {BATTLE_V2} from '/cultivation/battle-engine-v2.js';import {createFirestoreQuotaGuard} from '/cultivation/data/firestore-quota-guard.js';
 import '/cultivation/battle-cultivation-rules.js';
${battle}
window.__uiBattle=()=>{ensurePage();window.switchToPage('page-battle');state.role='host';state.roomId='preview-duel';state.room={status:'playing',round:2,host:{uid:'layout-preview',name:'青雲行者',hp:1400,maxHp:1400},guest:{uid:'other',name:'雲間客',hp:1200,maxHp:1400},currentQuestion:{id:'sample-battle',q:'若 f(x) = 2x + 3，則 f(4) 的值為何？',opts:['7','9','11','13'],ans:2,exp:'將 x = 4 代入，可得 2 × 4 + 3 = 11。',subject:'數學',topic:'一次函數',issuedAtMs:Date.now()}};renderQuiz(state.room);};})();`);
 // Scenic map keeps the same assets and actual fitting/placement logic.
 let map=strip(read('cultivation/training-scene-map.js'));map=map.slice(0,map.indexOf('export const featureReady'));
 await add(`import '/cultivation/training-access-rules.js';import '/cultivation/training-scene-layer-art.js';import '/cultivation/training-scene-layouts.js';
 const getMainUser=()=>({uid:'layout-preview'});const trainingRenderProfile=()=> 'safe';const markTrainingEntry=()=>{};const markTrainingStable=()=>{};const markTrainingExit=()=>{};
 ${map}\nwindow.__uiMap={show(){loadStyle();ensure();showMap();},detail(place){loadStyle();ensure();setDetail(place);},sync};`);
 await frame.waitForFunction(()=>window.__uiMap&&window.__uiTraining&&window.__uiRaid);
 for(const name of ['training-fluid-layout.js','content-capacity-layout.js','market-fluid-layout.js','battle-v3-stability-ui.js']) await frame.addScriptTag({url:origin+'/cultivation/'+name});
 const scenarios=[
  ['settings','page-settings'],['store','page-store'],['market','page-store'],['social','page-social'],['chat','page-social'],['history','page-history'],['rank','page-rank'],['training-map','page-training'],['core','page-training'],['nascent','page-training'],['nascent-detail','page-training'],['refinery','page-training'],['equipment','page-training'],['bag','page-training'],['contract','page-training'],['status','page-training'],['raid','page-raid'],['quiz','page-quiz'],['battle','page-battle']
 ];
 // Add all native tabs so the same markup is exercised across stages.
 await frame.evaluate(()=>{const tabs=document.querySelector('.training-subtabs-v3');for(const [id,label,icon]of [['nascent-soul','元神','fa-child-reaching'],['contract','契器','fa-dharmachakra'],['status','狀態','fa-chart-simple']])if(!tabs.querySelector('[data-training-tab="'+id+'"]'))tabs.insertAdjacentHTML('beforeend','<button type="button" class="training-subtab-v3" data-training-tab="'+id+'" aria-selected="false"><i class="fa-solid '+icon+'"></i><span>'+label+'</span></button>');});
 for(const view of [{name:'landscape',width:1440,height:810},{name:'portrait',width:390,height:844}]){
  await page.setViewportSize(view);await page.waitForTimeout(120);
  for(const [name,id]of scenarios.filter(([name])=>!process.env.UI_CAPTURE_FILTER||process.env.UI_CAPTURE_FILTER.split(',').includes(name))){
   await frame.evaluate(({name,id})=>{
    document.querySelector('#quiz-helper-shell')?.classList.add('collapsed');
    document.querySelectorAll('.ns-orb-detail[data-ns-portrait-sheet]').forEach(e=>e.remove());
    document.body.classList.remove('raid-page-open','raid-fullscreen','raid-session-active','ns-map-active');document.documentElement.classList.remove('raid-page-open');
    document.querySelector('#page-training').classList.remove('training-scene-map-active');document.querySelector('#bottom-nav').classList.remove('hidden');
    window.switchToPage(id);window.__uiRaid.unlock();
    if(id==='page-social')window.switchSocialTab(name==='chat'?'chat':'friends');
    if(name==='raid')window.__uiRaid.render();
    if(id==='page-store')window.__uiMarket(name==='market');
    if(name==='battle')window.__uiBattle();
    if(id==='page-training'){
      const tab={core:'core',nascent:'nascent-soul','nascent-detail':'nascent-soul',refinery:'refinery',equipment:'equipment',bag:'bag',contract:'contract',status:'status'}[name];
      if(name==='training-map')window.__uiMap.show();
      else {
       window.__uiMap.detail({core:'meditation',nascent:'meditation','nascent-detail':'meditation',refinery:'forge',equipment:'vault',bag:'vault',contract:'contract',status:'status'}[name]);
       document.querySelectorAll('.training-subtab-v3').forEach(b=>{b.classList.toggle('active',b.dataset.trainingTab===tab);b.setAttribute('aria-selected',String(b.dataset.trainingTab===tab));});
       if(name==='core'||name.startsWith('nascent')){window.__uiTraining.render(tab);if(name.startsWith('nascent'))window.__uiTraining.choose(null);}
       if(name==='refinery')window.__uiForge();
       if(name==='equipment'||name==='bag')window.__uiInventory(name);
       if(name==='contract')window.__uiContract();
       if(name==='status')window.__uiStatus();
      }
    }
    if(id==='page-training'&&name!=='training-map'){const tab={nascent:'nascent-soul','nascent-detail':'nascent-soul'}[name]||name;document.querySelectorAll('.training-subtab-v3').forEach(b=>{b.classList.toggle('active',b.dataset.trainingTab===tab);b.setAttribute('aria-selected',String(b.dataset.trainingTab===tab));});}
    document.querySelector('main').scrollTop=0;document.querySelector('#raid-hub')?.scrollTo(0,0);window.dispatchEvent(new Event('resize'));
   },{name,id});
   await page.waitForTimeout(100);await frame.evaluate(()=>document.fonts.ready);
   if(name==='nascent-detail'){
    await frame.locator('[data-ns-node="attack"]').click();
    const detail=await frame.evaluate(()=>{const d=document.querySelector('#ns-node-dialog').getBoundingClientRect(),w=document.querySelector('.ns-growth-workspace').getBoundingClientRect(),nav=document.querySelector('#bottom-nav').getBoundingClientRect();return{width:d.width,height:d.height,bottom:d.bottom,viewport:innerHeight,workspace:w.width,navTop:nav.top,z:getComputedStyle(document.querySelector('#ns-node-dialog')).zIndex,navZ:getComputedStyle(document.querySelector('#bottom-nav')).zIndex};});
    if(view.name==='portrait'){assert.ok(Math.abs(detail.height-detail.viewport*.5)<2);assert.ok(Math.abs(detail.bottom-detail.viewport)<2);assert.ok(Number(detail.z)>Number(detail.navZ));}
    else assert.ok(Math.abs(detail.width-detail.workspace*.3)<2);
    const upgrade=await frame.locator('[data-ns-upgrade="attack"]').boundingBox();assert.ok(upgrade&&upgrade.y+upgrade.height<=view.height,'node upgrade is visible');
   }
   const measurement=await frame.evaluate(id=>{const p=document.getElementById(id),r=p.getBoundingClientRect();return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,outerY:scrollY,visible:r.width>0&&r.height>0,pageWidth:r.width,contentWidth:p.scrollWidth,overflow:id==='page-training'?[...p.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&e.clientWidth>0).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,right:Math.round(e.getBoundingClientRect().right),width:Math.round(e.getBoundingClientRect().width)})):[]};},id);
   reports.push({view,page:name,...measurement});assert.ok(measurement.visible,name+' visible');assert.ok(measurement.documentWidth<=measurement.width+1,name+' document fits');assert.equal(measurement.outerY,0,name+' document is not scrolled');
   await page.locator('#game-stage').screenshot({path:path.join(output,name+'-'+view.name+'.jpg'),animations:'disabled',type:'jpeg',quality:90});
   if(name==='nascent-detail'){await frame.locator('[data-ns-close]').click();assert.equal(await frame.locator('#ns-node-dialog').count(),0);}
   if(name==='refinery'){
    await frame.locator('.refinery-recipe-book>summary').scrollIntoViewIfNeeded();
    const reachable=await frame.evaluate(()=>{const r=document.querySelector('.refinery-recipe-book>summary').getBoundingClientRect(),nav=document.querySelector('#bottom-nav').getBoundingClientRect();return r.top>=0&&r.bottom<=nav.top+1;});assert.ok(reachable,'forge recipe control can scroll above navigation');
   }
  }
 }
 // Exercise the controls that change presentation without invoking gameplay APIs.
 await frame.evaluate(()=>window.switchToPage('page-settings'));await frame.locator('[data-dongfu-section="profile"]').click();assert.equal(await frame.locator('#dongfu-profile-body').isVisible(),true);
 await frame.evaluate(()=>window.switchToPage('page-store'));await frame.evaluate(()=>window.__uiMarket(false));await frame.locator('.store-tab').nth(1).click();assert.equal(await frame.locator('.store-card:visible').count(),3);assert.ok(await frame.locator('.store-tab').nth(1).evaluate(e=>e.classList.contains('active-tab')));
 await frame.evaluate(()=>window.__uiMarket(true));await frame.locator('.pm-compose>summary').click();await frame.locator('#pm-sell-price').fill('240');assert.equal(await frame.locator('.pm-compose').getAttribute('open'),'');await frame.evaluate(()=>window.__uiMarket(true));assert.equal(await frame.locator('.pm-compose').getAttribute('open'),'');
};

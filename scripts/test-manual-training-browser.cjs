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
  // Add a second owned manual to test filters, independent book art and hero selection.
  const ownedManuals=db.records.get(service.MANUALS+'/u1');
  ownedManuals.books['body-rock']={exp:40};
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
    await page.locator('[data-manual-book="sword-wind"] .manual-library-choice').waitFor();
    await page.locator('[data-manual-jump-skill="wind-slash"]').click();
    await page.locator('.manual-focus-skill[data-manual-skill="wind-slash"]').waitFor();
    assert.equal(await page.locator('.manual-focus-skill').count(),1);
    assert.equal(await page.locator('[data-manual-jump-skill="wind-slash"]').getAttribute('aria-expanded'),'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.manual-focus-skill').count(),0);
    assert.equal(await page.locator('[data-manual-jump-skill="wind-slash"]').getAttribute('aria-expanded'),'false');
    await page.locator('[data-manual-jump-skill="wind-slash"]').click();
    await page.locator('.manual-focus-skill[data-manual-skill="wind-slash"]').waitFor();
    assert.equal(await page.locator('.manual-summary').count(),0);
    assert.equal(await page.locator('[data-manual-status]').evaluate(node=>
      node.compareDocumentPosition(document.querySelector('.manual-loadout')) & Node.DOCUMENT_POSITION_FOLLOWING),4);
    assert.equal(await page.locator('.manual-hero-roster').count(),0);
    assert.equal(await page.locator('.manual-hero-goal').count(),0);
    // Next-stage expedition guidance is bound to the same authenticated state.
    const quest=page.locator('[data-manual-expedition]');
    await quest.waitFor();
    assert.equal(await quest.getAttribute('data-manual-expedition-book'),'sword-wind');
    assert.match(await quest.textContent(),/第 1 關/);
    assert.match(await quest.textContent(),/煉氣境/);
    assert.match(await quest.textContent(),/\+20/);
    assert.equal(await quest.locator('[data-manual-expedition-action="battle"]').count(),1);
    await page.evaluate(()=>{
      window.__expeditionLaunches=[];
      window.openTacticalCombat=mode=>{
        window.__expeditionLaunches.push(mode);
        return Promise.resolve();
      };
    });
    await quest.locator('[data-manual-expedition-action="battle"]').click();
    assert.deepEqual(await page.evaluate(()=>window.__expeditionLaunches),['pve'],
      'battle shortcut must invoke only the actual PvE entry point');
    assert.equal(await page.locator('[data-manual-book="sword-wind"] .manual-library-choice[aria-pressed="true"]').count(),1);
    assert.equal(await page.locator('.manual-hero-cover').count(),1);
    // The permanent visual stage must come from the actual manual level.
    assert.equal(await page.locator('.manual-hero').getAttribute('data-manual-visual-stage'),'seed');
    assert.equal(await page.locator('.manual-growth-mark').count(),20);
    assert.equal(await page.locator('.manual-growth-mark.is-reached').count(),1);
    assert.equal(await page.locator('.manual-growth-mark.is-milestone').count(),4);
    const masteryPoints=await page.locator('.manual-growth-mark.is-milestone').evaluateAll(nodes=>
      nodes.map(node=>{
        const rect=node.getBoundingClientRect();
        return {label:node.textContent.trim(),x:rect.x+rect.width/2,
          y:rect.y+rect.height/2,width:rect.width,height:rect.height,
          radius:getComputedStyle(node).borderRadius};
      })
    );
    assert.deepEqual(masteryPoints.map(p=>p.label),['1','5','10','20']);
    assert(masteryPoints.every(p=>p.width===p.height&&p.radius==='50%'&&p.width>=24),
      'milestones must be raised circular bubbles with centered numbers');
    assert(masteryPoints.every((p,i)=>i===0||masteryPoints[i-1].x<p.x));
    assert(Math.abs((masteryPoints[1].x-masteryPoints[0].x)/
      (masteryPoints[3].x-masteryPoints[0].x)-4/19)<.015,
      'Lv.5 node must remain correctly positioned on the twenty-level rail');
    assert(Math.abs(masteryPoints[0].y-masteryPoints[2].y)<2);
    assert.equal(await page.locator('.manual-hero-mastery').count(),1);
    assert.equal(await page.locator('.manual-growth').count(),0,
      'the older separate aura card must be removed');
    assert.equal((await page.locator('.manual-hero').innerText()).includes('功法氣象'),false);
    assert.equal(await page.locator('.manual-hero-qi-ring').count(),1);
    await page.evaluate(()=>{window.savedArt=[...document.querySelectorAll('.manual-book-art,.manual-skill-art')];});
    const verifyArt=async()=>{
      assert.equal(await page.evaluate(()=>window.savedArt.length>0&&window.savedArt.every((img,i)=>img===document.querySelectorAll('.manual-book-art,.manual-skill-art')[i]&&img.isConnected)),true,'unchanged artwork must keep its original DOM node');
      assert.equal(await page.locator('[data-manual-book="sword-wind"] .manual-library-choice').getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('[data-manual-book="sword-wind"] .manual-library-choice[aria-pressed="true"]').count(),1);
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
    assert.equal(await page.locator('.manual-celebration--manual-upgrade').count(),1,
      'confirmed manual upgrade should show a distinct visual breakthrough');
    await page.locator('[data-manual-celebration-dismiss]').click();
    assert.equal(await page.locator('.manual-celebration-backdrop').count(),0);
    assert.equal(await page.evaluate(()=>window.savedSlot===document.querySelector('.manual-slot-art')),true);
    await page.locator('[data-skill-upgrade="wind-slash"]').click();await verifyArt();
    await page.getByText('「流風斬」已升至 Lv. 2。').waitFor();await verifyArt();
    assert.equal(await page.locator('.manual-celebration--skill-upgrade').count(),1,
      'confirmed technique improvement should show a smaller upgrade cue');
    await page.locator('[data-manual-celebration-dismiss]').click();
    assert.equal(await page.evaluate(()=>window.savedSlot===document.querySelector('.manual-slot-art')),true);
    // Phase 2: select an inactive deck, equip through its new slot picker,
    // rename it, then explicitly apply. Viewing/editing must not silently apply it.
    await page.locator('[data-loadout-select="1"]').click();
    assert.equal(await page.locator('[data-loadout-select="0"]').getAttribute('class').then(v=>v.includes('is-active')),true);
    assert.equal(await page.locator('[data-loadout-select="1"]').getAttribute('aria-pressed'),'true');
    await page.locator('[data-manual-pick-slot="0"]').click();
    await page.locator('[data-manual-picker]').waitFor();
    await page.locator('[data-manual-pick-skill="wind-slash"]').click();
    await page.locator('[data-manual-picker]').waitFor({state:'detached'});
    await page.locator('[data-manual-slot="0"] .manual-slot-art').waitFor();
    assert.equal(await page.locator('[data-loadout-select="0"]').getAttribute('class').then(v=>v.includes('is-active')),true);
    await page.locator('.manual-deck-name-settings summary').click();
    await page.locator('[data-loadout-name]').fill('劍氣出戰');
    await page.locator('[data-loadout-rename]').click();
    await page.locator('[data-loadout-select="1"]').getByText('劍氣出戰').waitFor();
    await page.locator('[data-loadout-apply]').click();
    await page.waitForFunction(()=>document.querySelector('[data-loadout-select="1"]')?.classList.contains('is-active'));
    assert.equal(await page.locator('[data-loadout-apply]').isDisabled(),true);
    await page.locator('[data-manual-pick-slot="0"]').click();
    assert.equal(await page.locator('[data-manual-pick-skill="wind-slash"]').count(),1);
    await page.locator('[data-manual-close-picker]').click();
    assert.equal(await page.locator('[data-manual-picker]').count(),0);
    const deckWidth=await page.locator('.manual-loadout').evaluate(node=>({
      scroll:node.scrollWidth,client:node.clientWidth
    }));
    assert(deckWidth.scroll<=deckWidth.client+2,
      'mobile deck should fit horizontally: '+JSON.stringify(deckWidth));
    // Phase 3: gallery only shows owned manuals. Filtering must never mutate
    // the selected battle deck. Card selection updates the hero, not equipment.
    const activePresetBefore=await page.locator('[data-loadout-select="1"]').getAttribute('class');
    const library=page.locator('.manual-library');
    assert.equal(await library.locator('article[data-manual-book]').count(),2);
    await page.locator('[data-manual-collection-filter="sword"]').click();
    assert.equal(await library.locator('article[data-manual-book]').count(),1);
    assert.equal(await library.locator('[data-manual-book="body-rock"]').count(),0);
    await page.locator('[data-manual-collection-filter="body"]').click();
    assert.equal(await library.locator('[data-manual-book="body-rock"]').count(),1);
    assert.equal(await library.locator('[data-manual-book="sword-wind"]').count(),0);
    await library.locator('[data-manual-book="body-rock"] .manual-library-choice').click();
    assert.equal(await library.locator('[data-manual-book="body-rock"] .manual-library-choice').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.manual-hero-title-row h3').textContent(),'玄嶽鍛體訣');
    assert.equal(await page.locator('[data-manual-expedition]').getAttribute('data-manual-expedition-book'),'body-rock');
    assert.equal(await page.locator('[data-manual-expedition-action="loadout"]').count(),1,
      'a manuscript without an equipped technique should lead to a loadout, not a fake battle-ready promise');
    assert.equal(await library.locator('.manual-book.is-featured').count(),1);
    assert.equal(await library.locator('[data-manual-book="body-rock"] .manual-library-skill-picture').count(),0);
    assert.equal(await library.locator('[data-manual-book="body-rock"] .manual-book-art').count(),1);
    assert.equal(await page.locator('[data-loadout-select="1"]').getAttribute('class'),activePresetBefore);
    await page.locator('[data-manual-collection-filter="all"]').click();
    assert.equal(await library.locator('article[data-manual-book]').count(),2);
    await library.locator('[data-manual-book="sword-wind"] .manual-library-choice').click();
    assert.equal(await page.locator('.manual-hero-title-row h3').textContent(),'流風劍訣');
    const featured=library.locator('[data-manual-book="sword-wind"]');
    assert.equal(await featured.locator('.manual-library-choice').getAttribute('aria-pressed'),'true');
    await featured.locator('[data-manual-focus-hero]').click();
    assert.equal(await page.locator('.manual-hero-title-row h3').textContent(),'流風劍訣');
    const mobileGallery=await library.evaluate(node=>({scroll:node.scrollWidth,client:node.clientWidth}));
    assert(mobileGallery.scroll<=mobileGallery.client+2,
      'gallery should not overflow portrait width: '+JSON.stringify(mobileGallery));
    const mobileHero=await page.locator('.manual-hero').evaluate(node=>({
      scroll:node.scrollWidth,client:node.clientWidth
    }));
    assert(mobileHero.scroll<=mobileHero.client+2,
      'growth rings and ten markers should fit portrait hero: '+JSON.stringify(mobileHero));
    const mobileExpedition=await page.locator('[data-manual-expedition]').evaluate(node=>({
      width:node.clientWidth,scroll:node.scrollWidth
    }));
    assert(mobileExpedition.scroll<=mobileExpedition.width+2,
      'expedition guidance must not overflow portrait screen: '+JSON.stringify(mobileExpedition));
    await page.setViewportSize({width:1180,height:820});
    const desktopColumns=await page.locator('.manual-book-grid').evaluate(node=>
      getComputedStyle(node).gridTemplateColumns.split(' ').length);
    assert(desktopColumns>=2,'desktop view should use a multi-column gallery');
    // Phase 8: the Lv5 approach illuminates ONLY the surrounding mastery
    // gauge; the locked second technique must stay locked until realm-ready.
    db.records.get('users/u1').stats.totalScore=1;
    db.records.get('users/u1').tacticalTrialV1={version:1,stage:5,seed:'a'.repeat(32)};
    db.records.get(service.MANUALS+'/u1').books['sword-wind'].exp=250;
    await page.locator('[data-manual-refresh]').click();
    await page.locator('.manual-celebration--manual-upgrade').waitFor();
    assert.equal(await page.locator('.manual-hero--approaching').count(),1);
    assert.match(await page.locator('.manual-hero-next-inline').textContent(),/尚差 30 EXP/);
    assert.equal(await page.locator('.manual-anticipation').count(),0);
    assert.match(await page.locator('[data-manual-expedition]').textContent(),/第 5 關/);
    assert.match(await page.locator('[data-manual-expedition]').textContent(),/築基境/);
    assert.match(await page.locator('[data-manual-expedition]').textContent(),/\+35/);
    assert.match(await page.locator('[data-manual-expedition]').textContent(),/約 1 次/);
    assert.equal(await page.locator('.manual-hero-step.is-next.is-approaching.is-locked').count(),1);
    assert.equal(await page.locator('[data-manual-book="sword-wind"] .manual-library-brief-state.is-approaching').count(),1);
    await page.locator('[data-manual-celebration-dismiss]').click();
    db.records.get(service.MANUALS+'/u1').books['sword-wind'].exp=270;
    await page.locator('[data-manual-refresh]').click();
    await page.locator('.manual-hero--imminent').waitFor();
    assert.match(await page.locator('.manual-hero-next-inline').textContent(),/尚差 10 EXP/);
    await page.setViewportSize({width:393,height:852});
    const anticipationMobile=await page.locator('.manual-hero').evaluate(node=>({
      width:node.clientWidth,scroll:node.scrollWidth
    }));
    assert(anticipationMobile.scroll<=anticipationMobile.width+2,
      'approaching breakthrough should not overflow mobile hero '+JSON.stringify(anticipationMobile));
    await page.setViewportSize({width:1180,height:820});
    db.records.get(service.MANUALS+'/u1').books['sword-wind'].exp=280;
    await page.locator('[data-manual-refresh]').click();
    await page.locator('.manual-celebration--manual-upgrade').waitFor();
    await page.waitForFunction(()=>document.querySelector('.manual-hero-next-inline')?.textContent.includes('築基境'));
    assert.match(await page.locator('.manual-hero-next-inline').textContent(),/待修士 築基境/);
    assert.equal(await page.locator('.manual-hero-step.is-realm-locked').count(),1);
    assert.equal(await page.locator('.manual-hero-step.is-learned').count(),1);
    await page.locator('[data-manual-celebration-dismiss]').click();
    // Reaching Lv5 alone is not a skill awakening. Raise realm and re-sync.
    db.records.get('users/u1').stats.totalScore=100;
    const unlockedSnapshot=await service.manualsState(db,'u1');
    assert.equal(unlockedSnapshot.library.find(b=>b.id==='sword-wind').skills[1].unlocked,true);
    await page.locator('[data-manual-refresh]').click();
    await page.locator('.manual-celebration--unlock').waitFor();
    assert.equal(await page.locator('.manual-celebration-heading').textContent(),'招式領悟');
    assert.equal(await page.locator('.manual-hero').getAttribute('data-manual-visual-stage'),'inscribed');
    assert.equal(await page.locator('.manual-growth-mark.is-reached').count(),5);
    assert.equal(await page.locator('.manual-hero-step.is-learned').count(),2);
    await page.locator('[data-manual-celebration-dismiss]').click();
    // Direct fixture update simulates a settled PvE drop delivered through the
    // server state endpoint, without letting the client award its own scripture.
    db.records.get(service.MANUALS+'/u1').books['body-dragon']={exp:0};
    await page.locator('[data-manual-refresh]').click();
    await page.locator('.manual-celebration--discovery').waitFor();
    assert.equal(await page.locator('.manual-celebration-name').textContent(),'龍象真身訣');
    assert.equal(await library.locator('article[data-manual-book]').count(),3);
    await page.locator('[data-manual-celebration-dismiss]').click();
    await page.locator('[data-manual-refresh]').click();
    assert.equal(await page.locator('.manual-celebration-backdrop').count(),0,
      'refreshing identical data cannot replay a reward');
    // A higher manual level changes its permanent visuals even before another
    // skill unlock. Cosmetic tiers never change the existing loadout.
    const activeDeck=await page.locator('[data-loadout-select="1"]').getAttribute('class');
    db.records.get(service.MANUALS+'/u1').books['sword-wind'].exp=700;
    await page.locator('[data-manual-refresh]').click();
    await page.locator('.manual-celebration--manual-upgrade').waitFor();
    assert.equal(await page.locator('.manual-hero').getAttribute('data-manual-visual-stage'),'surge');
    assert.equal(await page.locator('.manual-growth-mark.is-reached').count(),8);
    assert.equal(await page.locator('[data-manual-book="sword-wind"] .manual-library-art-zone').getAttribute('data-manual-stage'),'surge');
    assert.equal(await page.locator('[data-loadout-select="1"]').getAttribute('class'),activeDeck);
    await page.locator('[data-manual-celebration-dismiss]').click();
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.manual-hero-qi-orbit').evaluate(node=>
      getComputedStyle(node).animationName),'none',
      'reduced motion must disable looping aura animation');
    await page.emulateMedia({reducedMotion:'no-preference'});
    db.records.get(service.MANUALS+'/u1').books['sword-wind'].exp=1080;
    await page.locator('[data-manual-refresh]').click();
    await page.locator('.manual-celebration--unlock').waitFor();
    assert.equal(await page.locator('.manual-hero').getAttribute('data-manual-visual-stage'),'refined');
    assert.equal(await page.locator('.manual-growth-mark.is-reached').count(),10);
    assert.equal(await page.locator('.manual-growth-mark.is-milestone.is-reached').count(),3);
    assert.equal(await page.locator('.manual-hero-stage-badge').textContent(),'大成');
    assert.equal(await page.locator('.manual-hero-mastery-level').textContent(),'Lv. 10 / 20');
    assert.match(await page.locator('.manual-hero-upgrade').textContent(),/升至 Lv. 11/);
    assert.equal(await page.locator('.manual-hero-step.is-learned').count(),3);
    await page.locator('[data-manual-celebration-dismiss]').click();
    // After Lv10 and the third-skill milestone, leveling continues through Lv20.
    db.records.get(service.MANUALS+'/u1').books['sword-wind'].exp=4180;
    await page.locator('[data-manual-refresh]').click();
    await page.locator('.manual-celebration--manual-upgrade').waitFor();
    assert.equal(await page.locator('.manual-hero').getAttribute('data-manual-visual-stage'),'complete');
    assert.equal(await page.locator('.manual-growth-mark.is-reached').count(),20);
    assert.equal(await page.locator('.manual-growth-mark.is-milestone.is-reached').count(),4);
    assert.equal(await page.locator('.manual-growth-marks').getAttribute('aria-valuenow'),'100');
    assert.equal(await page.locator('.manual-hero-stage-badge').textContent(),'圓滿');
    assert.equal(await page.locator('.manual-hero-mastery-status').textContent(),'功法已達最高等級');
    assert.equal(await page.locator('.manual-hero-mastery-level').textContent(),'Lv. 20 / 20');
    assert.match(await page.locator('.manual-hero-attack-bonus').textContent(),/本功法攻擊 \+20/);
    const badgeBeforeStatus=await page.locator('.manual-hero-mastery-summary').evaluate(node=>{
      const [badge,status]=[node.querySelector('.manual-hero-stage-badge'),
        node.querySelector('.manual-hero-mastery-status')];
      return badge.getBoundingClientRect().right<=status.getBoundingClientRect().left+1;
    });
    assert(badgeBeforeStatus,'the 圓滿 badge belongs to the left of the maximum-level message');
    assert.equal(await page.locator('.manual-hero-step.is-learned').count(),3);
    await page.locator('[data-manual-celebration-dismiss]').click();
    // Navigating straight from a finished battle must force an actual server
    // refresh instead of serving the old 15-second cultivation page cache.
    const response=page.waitForResponse(res=>res.url().endsWith('/api/tactical/manuals')
      &&res.request().method()==='GET');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('xiuxian:manual-battle-settled',{
      detail:{uid:'u1'}
    })));
    assert.equal((await response).ok(),true);
    assert.deepEqual(errors,[]);
    console.log('Manual artwork, owned-only gallery and deck stable; battle-return refresh, mobile and desktop verified.');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

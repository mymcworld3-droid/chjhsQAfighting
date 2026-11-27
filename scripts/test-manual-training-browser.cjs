#!/usr/bin/env node
'use strict';
// Browser acceptance for the two-weapon sword/totem system.
// Local user fixtures only; does not access production accounts.
const assert=require('node:assert/strict');
const path=require('node:path');
const express=require('express');
const {chromium}=require('playwright');
const {database}=require('../tests/helpers/tactical-db.cjs');
const register=require('../tactical-combat-api.cjs');
const service=register.__test;
async function main(){
  const db=database();
  db.records.get('users/u1').stats.gold=10000;
  await service.chooseSchool(db,'u1',{school:'sword'});
  db.records.get(service.MANUALS+'/u1').books['body-rock']={exp:40};
  const app=express();app.use(express.json());
  app.get('/cultivation/data/project-repository.js',(_,res)=>res.type('text/javascript').send(
    "export const getMainUser=()=>({uid:'u1'});export const authenticatedMainFetch=(url,init={})=>fetch(url,{...init,headers:{...init.headers,'Content-Type':'application/json'}});"
  ));
  app.use('/api/tactical/manuals',(req,res,next)=>{
    if(req.method==='POST')setTimeout(next,80);else next();
  });
  register(app,{resolve:()=>({db}),verify:async()=> 'u1'});
  app.get('/test',(_,res)=>res.type('html').send(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>'+
    '<body style="margin:0;height:100dvh"><div id="nav-grid"></div>'+
    '<main style="height:calc(100dvh - 64px);padding:0 0 84px;box-sizing:border-box;overflow-y:auto">'+
    '<div id="page-training" class="active-page"></div></main>'+
    '<script type="module" src="/cultivation/manual-training-page.js"></script></body></html>'
  ));
  app.use(express.static(path.join(__dirname,'../public')));
  const server=await new Promise(resolve=>{
    const s=app.listen(0,'127.0.0.1',()=>resolve(s));
  });
  let browser;
  try{
    browser=await chromium.launch({headless:true,args:['--no-sandbox'],
      ...(process.env.TACTICAL_CHROMIUM?{executablePath:process.env.TACTICAL_CHROMIUM}:{})});
    const page=await browser.newPage({viewport:{width:393,height:852}}),errors=[];
    const requestedWeaponArt=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',req=>{
      if(/\/assets\/weapons\//.test(new URL(req.url()).pathname))
        requestedWeaponArt.push(new URL(req.url()).pathname);
    });
    const origin='http://127.0.0.1:'+server.address().port;
    await page.goto(origin+'/test');
    const library=page.locator('.manual-library');
    await library.locator('[data-manual-book="sword-wind"]').waitFor();
    await page.locator('.manual-weapon-grid').waitFor();
    assert.equal(await page.locator('[data-manual-slot]').count(),2);
    assert.equal(await library.locator('article[data-manual-book]').count(),2);
    const card=library.locator('[data-manual-book="sword-wind"] .manual-native-card');
    assert.equal(await card.getAttribute('data-armory-equipped'),'true');
    assert.equal(await card.locator('.manual-armory-worn').count(),1);
    assert.equal(await card.locator('.manual-armory-exp').count(),1);
    assert.equal(await library.locator('[data-manual-book="body-rock"] .manual-armory-worn').count(),0);
    const cardAnimations=await library.locator('.manual-armory-sheen').evaluateAll(nodes=>nodes.map(n=>({name:getComputedStyle(n).animationName,delay:getComputedStyle(n).animationDelay})));
    assert.equal(cardAnimations.length,2);
    assert.ok(cardAnimations.every(a=>a.name==='manual-armory-sheen'),'unselected cards also animate');
    assert.notEqual(cardAnimations[0].delay,cardAnimations[1].delay,'card sweeps are staggered');
    assert.equal(await card.locator('.manual-weapon-art').evaluate(node=>getComputedStyle(node).animationName),'qy-armory-hover');
    assert.equal(await page.locator('[data-manual-slot="0"] .manual-weapon-skill.is-learned .manual-native-skill-icon').evaluate(node=>getComputedStyle(node).animationName),'qy-armory-skill');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await card.locator('.manual-armory-sheen').evaluate(node=>getComputedStyle(node).animationName),'none');
    assert.equal(await card.locator('.manual-weapon-art').evaluate(node=>getComputedStyle(node).animationName),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    assert.equal(await page.locator('.manual-library-heading h3').innerText().then(x=>x.includes('武器收藏')),true);
    const order=await library.evaluate(node=>
      !!(node.compareDocumentPosition(document.querySelector('.manual-hero'))&Node.DOCUMENT_POSITION_FOLLOWING));
    assert.equal(order,true,'weapon library must be the first section');
    assert.equal(await page.locator('[data-manual-slot="0"] .manual-weapon-slot-info strong').innerText(),'流風靈劍');
    assert.equal(await page.locator('[data-manual-slot="0"] .manual-weapon-skill').count(),3);
    assert.equal(await page.locator('[data-manual-slot="0"] .manual-weapon-skill.is-learned').count(),1);
    assert.equal(await page.locator('.manual-hero-cover').count(),1);
    const artwork=page.locator('[data-manual-book="sword-wind"] .manual-weapon-art');
    assert.match(await artwork.evaluate(node=>getComputedStyle(node).backgroundImage),/sword-wind-hd\.webp/);
    assert(!requestedWeaponArt.some(url=>/body-tiger|body-dragon|sword-sky|sword-flight/.test(url)),
      'unowned weapons must never load during library startup');
    assert(!requestedWeaponArt.some(url=>url.endsWith('.svg')),
      'do not download an SVG alongside a successfully available HD WebP');
    for(const id of ['sword-wind','sword-flight','sword-sky','body-rock','body-dragon','body-tiger']){
      const image=await page.request.get(origin+'/assets/weapons/'+id+'-hd.webp');
      assert.equal(image.status(),200);
      assert.match(image.headers()['content-type']||'',/webp/);
      assert((await image.body()).length>100_000,'HD weapon art must be the actual full-size file');
    }
    assert.equal(await page.locator('[data-manual-training-screen]').isVisible(),false);
    await library.locator('[data-manual-book="sword-wind"] .manual-library-choice').click();
    await page.locator('[data-manual-training-screen]').waitFor();
    assert.equal(await page.locator('[data-manual-training-screen]').evaluate(node=>node.tagName),'SECTION');
    assert.equal(await library.isVisible(),false);
    assert.equal(await page.locator('.manual-weapons').isVisible(),false);
    assert.equal(await page.locator('dialog[open]').count(),0);
    const assertFullscreen=async()=>{
      const detail=await page.locator('[data-manual-training-screen]').evaluate(node=>{
        const box=node.getBoundingClientRect(),style=getComputedStyle(node);
        return {x:box.x,y:box.y,width:box.width,height:box.height,viewportWidth:innerWidth,viewportHeight:innerHeight,radius:style.borderRadius,position:style.position,bodyOverflow:getComputedStyle(node.querySelector('.manual-training-screen-body')).overflowY};
      });
      assert(Math.abs(detail.x)<=1&&Math.abs(detail.y)<=1,'detail must begin at the viewport origin');
      assert(Math.abs(detail.width-detail.viewportWidth)<=1&&Math.abs(detail.height-detail.viewportHeight)<=1,'detail fills the entire game viewport');
      assert.equal(detail.radius,'0px');assert.equal(detail.position,'fixed');assert.equal(detail.bodyOverflow,'auto');
      for(const selector of ['.manual-native-skills-panel','.manual-shared-detail > :first-child','.manual-hero-step']){
        const radius=await page.locator(selector).first().evaluate(node=>parseFloat(getComputedStyle(node).borderTopLeftRadius));
        assert(radius>0,selector+' retains rounded corners');
      }
    };
    await assertFullscreen();
    const palette=await page.locator('#manual-training-root').evaluate(root=>{
      const style=getComputedStyle(root),bg=getComputedStyle(root.querySelector('.manual-training-screen-header')).backgroundColor;
      const body=getComputedStyle(document.body);
      return {paper:style.getPropertyValue('--mt-text').trim(),homePaper:body.getPropertyValue('--review-paper').trim()||body.getPropertyValue('--xq-paper').trim()||'#eee5d2',header:bg,action:style.getPropertyValue('--mt-action').trim()};
    });
    assert.equal(palette.paper,palette.homePaper);
    assert.equal(palette.header,'rgb(23, 23, 20)');
    assert.equal(palette.action,'#bda371');
    assert.equal(await page.locator('.manual-ritual-seal').count(),1);
    const disc=page.locator('.manual-ritual-disc'),wheel=page.locator('.manual-ritual-wheel');
    await disc.evaluate(img=>img.decode());
    await wheel.evaluate(img=>img.decode());
    assert.equal(await disc.evaluate(img=>img.naturalWidth),1280);
    assert.equal(await wheel.evaluate(img=>img.naturalWidth),1280);
    assert.equal(await disc.getAttribute('src'),'/assets/ui/qingyun_misty_brown_disc.png');
    assert.equal(await wheel.getAttribute('src'),'/assets/ui/qingyun_gold_frame.png');
    assert.equal(await disc.evaluate(node=>getComputedStyle(node).animationName),'none');
    assert.equal(await page.locator('.manual-ritual-energy').count(),0);
    assert.equal(await page.locator('.manual-hero-art-stage').evaluate(node=>getComputedStyle(node).backgroundImage),'none');
    assert.equal(await page.locator('.manual-ritual-wheel').evaluate(node=>getComputedStyle(node).animationName),'manual-ritual-spin');
    assert.equal(await page.locator('.manual-hero-cover').evaluate(node=>getComputedStyle(node).animationName),'qy-weapon-hover');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.manual-ritual-wheel').evaluate(node=>getComputedStyle(node).animationName),'none');
    assert.equal(await page.locator('.manual-hero-cover').evaluate(node=>getComputedStyle(node).animationName),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.setViewportSize({width:1180,height:820});
    await assertFullscreen();
    await page.setViewportSize({width:393,height:852});
    await assertFullscreen();
    const slot=page.locator('.manual-shared-detail');
    const mastery=async()=>{
      assert.equal(await slot.getAttribute('data-manual-detail-mode'),'mastery');
      assert.equal(await slot.locator('.manual-hero-mastery').count(),1);
      assert.equal(await page.locator('.manual-focus-skill').count(),0);
    };
    await mastery();
    await page.locator('[data-manual-browse-weapon="next"]').click();
    await mastery();
    await page.locator('[data-manual-jump-skill="rock-fist"]').click();
    await page.locator('.manual-focus-skill[data-manual-skill="rock-fist"]').waitFor();
    await page.locator('[data-manual-browse-weapon="prev"]').click();
    await mastery();
    for(const size of [{width:1180,height:820},{width:393,height:852}]){
      await page.setViewportSize(size);
      const position=()=>slot.evaluate(node=>{
        const r=node.getBoundingClientRect(),scroller=node.closest('.manual-training-screen-body');
        return {x:r.x,y:r.y+scroller.scrollTop,width:r.width};
      });
      const before=await position();
      await page.locator('[data-manual-jump-skill="wind-slash"]').click();
      await page.locator('.manual-focus-skill[data-manual-skill="wind-slash"]').waitFor();
      assert.equal(await slot.getAttribute('data-manual-detail-mode'),'skill');
      assert.equal(await page.locator('.manual-hero-mastery').count(),0);
      const after=await position();
      for(const key of ['x','y','width'])assert(Math.abs(before[key]-after[key])<=2,'shared detail '+key+' must not move');
      await page.locator('[data-manual-close-skill]').click();
      await mastery();
      await page.locator('[data-manual-jump-skill="wind-slash"]').click();
      await page.locator('[data-manual-jump-skill="wind-slash"]').click();
      await mastery();
    }
    await page.locator('[data-manual-jump-skill="wind-slash"]').click();
    await page.keyboard.press('Escape');
    await mastery();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-manual-training-screen]').isVisible(),false);
    assert.equal(await library.isVisible(),true);
    // Equipping a weapon changes one slot only; it does not change its XP.
    await page.locator('[data-manual-pick-slot="1"]').click();
    await page.locator('[data-manual-picker]').waitFor();
    assert.equal(await page.locator('[data-manual-weapon-dialog]').evaluate(node=>node.open),true);
    assert.equal(await page.locator('[data-manual-pick-weapon="sword-wind"]').isDisabled(),true);
    const equippedSaved=page.waitForResponse(response=>
      response.url().endsWith('/api/tactical/manuals/loadout')&&
      response.request().method()==='POST');
    await page.locator('[data-manual-pick-weapon="body-rock"]').click();
    assert.equal(await page.locator('[data-manual-slot="1"] .manual-weapon-slot-info strong').innerText(),'玄嶽圖騰');
    assert.equal(await page.locator('[data-manual-refresh]').isDisabled(),false);
    assert.equal(await page.locator('[data-manual-pick-slot="0"]').isDisabled(),false);
    assert.doesNotMatch(await page.locator('[data-manual-status]').innerText(),/正在保存|武器裝備已儲存/);
    await equippedSaved;
    assert.equal(await page.locator('[data-manual-status]').evaluate(node=>getComputedStyle(node).position),'fixed');
    const equipped=db.records.get(service.MANUALS+'/u1');
    assert.deepEqual(equipped.weaponIds,['sword-wind','body-rock']);
    assert.equal(equipped.books['body-rock'].exp,40);
    // Both weapon slots are peers. No activation/main-weapon button exists.
    assert.equal(await page.locator('[data-loadout-apply]').count(),0);
    assert.equal(await page.locator('.manual-weapon-slot.is-active').count(),0);
    const record=db.records.get(service.MANUALS+'/u1');
    assert.deepEqual(record.equipped,['wind-slash','rock-fist']);
    // A normal solo player can remove and restore equipment without losing XP.
    const removeSaved=page.waitForResponse(response=>
      response.url().endsWith('/api/tactical/manuals/loadout')&&
      response.request().method()==='POST');
    await page.locator('[data-manual-remove-weapon="1"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-manual-slot="1"] .manual-weapon-slot-info strong')?.textContent==='尚未裝備武器');
    await removeSaved;
    assert.equal(db.records.get(service.MANUALS+'/u1').books['body-rock'].exp,40);
    await page.locator('[data-manual-pick-slot="1"]').click();
    const restoredSaved=page.waitForResponse(response=>
      response.url().endsWith('/api/tactical/manuals/loadout')&&
      response.request().method()==='POST');
    await page.locator('[data-manual-pick-weapon="body-rock"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-manual-slot="1"] .manual-weapon-slot-info strong')?.textContent==='玄嶽圖騰');
    await restoredSaved;
    assert.equal(await page.locator('[data-manual-slot="0"] .manual-weapon-skill').count(),3);
    // Upgrading the original sword keeps both weapon artwork nodes stable.
    await library.locator('[data-manual-book="sword-wind"] .manual-library-choice').click();
    await page.evaluate(()=>{window.__art=[...document.querySelectorAll('.manual-weapon-art')];});
    const confirmation=page.waitForEvent('dialog');
    const upgradeClick=page.locator('[data-manual-upgrade="sword-wind"]').click();
    const dialog=await confirmation;
    assert.equal(dialog.type(),'confirm');assert.match(dialog.message(),/確定升級.*Lv\./);
    await dialog.accept();await upgradeClick;
    await page.waitForFunction(()=>document.querySelector('[data-manual-dialog-status]')?.textContent?.includes('已升級'));
    const visualStable=await page.evaluate(()=>window.__art.every(node=>node.isConnected));
    assert.equal(visualStable,true,'weapon image nodes should not blink after upgrade');
    assert.equal(await page.locator('[data-manual-celebration-host] [data-manual-celebration-dismiss]').count(),1);
    await page.locator('[data-manual-celebration-dismiss]').click();
    await page.locator('[data-manual-close-training]').click();
    assert.equal(await library.isVisible(),true);
    // The second technique appears automatically at weapon Lv.5 without a player-realm requirement.
    db.records.get('users/u1').stats.totalScore=0;
    db.records.get(service.MANUALS+'/u1').books['body-rock'].exp=280;
    await page.locator('[data-manual-refresh]').click();
    await page.waitForFunction(()=>
      document.querySelectorAll('[data-manual-slot="1"] .manual-weapon-skill.is-learned').length===2);
    assert.equal(await page.locator('[data-manual-slot="1"] .manual-weapon-skill.is-learned').count(),2);
    // An empty third slot must not invent a weapon or skill.
    assert.equal(await page.locator('[data-manual-slot="2"]').count(),0);
    for(const selector of ['.manual-library','.manual-weapons']){
      const sizes=await page.locator(selector).evaluate(node=>({scroll:node.scrollWidth,client:node.clientWidth}));
      assert(sizes.scroll<=sizes.client+3,selector+' must fit mobile width: '+JSON.stringify(sizes));
    }
    // The main branch uses one exact card ratio in both orientations.
    // Only the collection shelf grows to occupy unused vertical space.
    for(const [width,height] of [[393,680],[393,852],[768,1100],[1180,820],[1440,900],[844,390]]){
      await page.setViewportSize({width,height});
      await page.evaluate(()=>{document.querySelector('main').scrollTop=0;});
      // ResizeObserver and visualViewport resize handlers run asynchronously.
      // Wait for the actual armory to fill the resized viewport; keep the exact
      // original gap and card-ratio assertions below.
      await page.waitForFunction(()=>{
        const main=document.querySelector('main'),equipment=document.querySelector('.manual-weapons'),library=document.querySelector('.manual-library');
        if(!main||!equipment||!library)return false;
        const bottom=main.getBoundingClientRect().bottom-parseFloat(getComputedStyle(main).paddingBottom);
        return bottom-Math.max(equipment.getBoundingClientRect().bottom,library.getBoundingClientRect().bottom)<16;
      },null,{timeout:5000});
      const geometry=await page.evaluate(()=>{
        const main=document.querySelector('main');
        const card=document.querySelector('.manual-native-card').getBoundingClientRect();
        const equipment=document.querySelector('.manual-weapons').getBoundingClientRect();
        const library=document.querySelector('.manual-library').getBoundingClientRect();
        const bottom=main.getBoundingClientRect().bottom-parseFloat(getComputedStyle(main).paddingBottom);
        return {ratio:card.width/card.height,cardWidth:card.width,cardHeight:card.height,
          gap:bottom-Math.max(equipment.bottom,library.bottom),
          rows:[...document.querySelectorAll('.manual-weapon-slot')].map(slot=>{
            const picker=slot.querySelector('.manual-weapon-slot-picker').getBoundingClientRect();
            const skills=slot.querySelector('.manual-weapon-skill-list').getBoundingClientRect();
            return Math.min(picker.bottom,skills.bottom)>Math.max(picker.top,skills.top);
          })};
      });
      assert(Math.abs(geometry.ratio-1047/1501)<.006,
        'card aspect must match in portrait and landscape: '+width+'x'+height+': '+JSON.stringify(geometry));
      assert(geometry.gap<16,
        'collection leaves no empty space below: '+width+'x'+height+': '+geometry.gap);
      assert(geometry.rows.every(Boolean),'equipment and skills share the same row');
    }
    await page.setViewportSize({width:1180,height:820});
    const outer=await page.locator('#page-training').evaluate(node=>{const s=getComputedStyle(node);return {background:s.backgroundColor,image:s.backgroundImage,shadow:s.boxShadow,radius:s.borderRadius,maxWidth:s.maxWidth};});
    assert.deepEqual(outer,{background:'rgba(0, 0, 0, 0)',image:'none',shadow:'none',radius:'0px',maxWidth:'none'});
    const columns=await page.locator('.manual-weapon-grid').evaluate(node=>
      getComputedStyle(node).gridTemplateColumns.split(' ').length);
    assert.equal(columns,1);
    // Returning from battle always fetches fresh authoritative weapon XP.
    const refreshed=page.waitForResponse(res=>res.url().endsWith('/api/tactical/manuals')
      &&res.request().method()==='GET');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('xiuxian:manual-battle-settled',{detail:{uid:'u1'}})));
    assert.equal((await refreshed).ok(),true);
    assert.deepEqual(errors,[]);
    console.log('Native armory, consistent card ratios, full-height collection and nonblocking weapon saves verified.');
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});

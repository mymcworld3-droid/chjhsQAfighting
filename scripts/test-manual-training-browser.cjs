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
    '<body><div id="nav-grid"></div><main id="page-training" class="active-page"></main>'+
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
      for(const selector of ['.manual-native-skills-panel','.manual-focus-skill','.manual-hero-mastery','.manual-hero-step']){
        const radius=await page.locator(selector).first().evaluate(node=>parseFloat(getComputedStyle(node).borderTopLeftRadius));
        assert(radius>0,selector+' retains rounded corners');
      }
    };
    await assertFullscreen();
    await page.setViewportSize({width:1180,height:820});
    await assertFullscreen();
    await page.setViewportSize({width:393,height:852});
    await assertFullscreen();
    await page.locator('.manual-focus-skill[data-manual-skill="wind-slash"]').waitFor();
    await page.locator('[data-manual-browse-weapon="next"]').click();
    await page.locator('.manual-focus-skill[data-manual-skill="rock-fist"]').waitFor();
    await page.locator('[data-manual-browse-weapon="prev"]').click();
    await page.locator('[data-manual-jump-skill="wind-slash"]').click();
    await page.locator('.manual-focus-skill[data-manual-skill="wind-slash"]').waitFor();
    assert.equal(await page.locator('.manual-focus-skill').count(),1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.manual-focus-skill').count(),0);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-manual-training-screen]').isVisible(),false);
    assert.equal(await library.isVisible(),true);
    // Equipping a weapon changes one slot only; it does not change its XP.
    await page.locator('[data-manual-pick-slot="1"]').click();
    await page.locator('[data-manual-picker]').waitFor();
    assert.equal(await page.locator('[data-manual-weapon-dialog]').evaluate(node=>node.open),true);
    assert.equal(await page.locator('[data-manual-pick-weapon="sword-wind"]').isDisabled(),true);
    await page.locator('[data-manual-pick-weapon="body-rock"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-manual-status]')?.textContent==='武器裝備已儲存。');
    assert.equal(await page.locator('[data-manual-slot="1"] .manual-weapon-slot-info strong').innerText(),'玄嶽圖騰');
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
    await page.locator('[data-manual-remove-weapon="1"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-manual-slot="1"] .manual-weapon-slot-info strong')?.textContent==='尚未裝備武器');
    assert.equal(db.records.get(service.MANUALS+'/u1').books['body-rock'].exp,40);
    await page.locator('[data-manual-pick-slot="1"]').click();
    await page.locator('[data-manual-pick-weapon="body-rock"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-manual-slot="1"] .manual-weapon-slot-info strong')?.textContent==='玄嶽圖騰');
    assert.equal(await page.locator('[data-manual-slot="0"] .manual-weapon-skill').count(),3);
    // Upgrading the original sword keeps both weapon artwork nodes stable.
    await library.locator('[data-manual-book="sword-wind"] .manual-library-choice').click();
    await page.evaluate(()=>{window.__art=[...document.querySelectorAll('.manual-weapon-art')];});
    await page.locator('[data-manual-upgrade="sword-wind"]').click();
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
    // Realistic viewport budget: keep both primary sections above the fixed navigation.
    for(const [width,height,budget] of [[393,680,530],[393,852,702],[1180,820,670],[844,390,250]]){
      await page.setViewportSize({width,height});
      const geometry=await page.evaluate(()=>{
        const library=document.querySelector('.manual-library').getBoundingClientRect();
        const equipment=document.querySelector('.manual-weapons').getBoundingClientRect();
        return {span:Math.max(library.bottom,equipment.bottom)-Math.min(library.top,equipment.top),
          rows:[...document.querySelectorAll('.manual-weapon-slot')].map(slot=>{
            const picker=slot.querySelector('.manual-weapon-slot-picker').getBoundingClientRect();
            const skills=slot.querySelector('.manual-weapon-skill-list').getBoundingClientRect();
            return Math.min(picker.bottom,skills.bottom)>Math.max(picker.top,skills.top);
          })};
      });
      assert(geometry.span<=budget,'compact collection and both slots fit height budget '+width+'x'+height+': '+geometry.span);
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
    console.log('Two peer weapon slots, modal training, top-layer rewards, HD artwork, free equip/unequip, Lv.5 unlock and responsive layout verified.');
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});

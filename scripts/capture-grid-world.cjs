/* Real world API/entry/view in the original stage, header and navigation.
 * Isolated fixture identities/data; no production account or credentials. */
'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const express=require('express');
const {once}=require('node:events');
const {worldDb}=require('../tests/helpers/world-db.cjs');
const register=require('../world-api.cjs');
const W=require('../public/world/world-core.js');
const Q=require('../world-questions.cjs');
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','playwright')));}
const root=path.resolve(__dirname,'../public');
const output=path.resolve(process.env.LAYOUT_OUTPUT||'docs/design/grid-world');
const deps=process.env.WORLD_UI_DEPS||'/tmp/grid-world-ui/node_modules';
const tailwind=process.env.WORLD_TAILWIND||'/tmp/grid-world-tailwind.css';
const user={uid:'fixture',displayName:'青雲行者',storyProgressV1:{gender:'male'},stats:{totalScore:68,attack:200,maxHp:1000,gold:0},
  cultivationTraining:{equippedCore:{type:'xingchen',grade:3},coreEnabled:true},materialSystem:{inventory:{'qi-spirit-wood':4,'qi-spirit-iron':4}}};
const db=worldDb({'users/fixture':user,'users/peer':{...user,uid:'peer',displayName:'竹影道友',storyProgressV1:{gender:'female'}}});
const app=express();app.use(express.json());
const service=register(app,{resolveA:()=>({db}),verify:async req=>{
  const uid=req.get('x-fixture-uid');if(!['fixture','peer'].includes(uid))throw Object.assign(Error('fixture identity required'),{status:401});return uid;
},generateQuestions:async b=>Q.fallback(b,{subject:'數學'})});
async function setupFixture(){
  const legacy=await fs.readFile(path.join(root,'main-legacy.js'),'utf8');
  const navigation=legacy.slice(legacy.indexOf('window.switchToPage = (pageId) => {'),legacy.indexOf('\nlet brandHomeNavigationPending'));
  const social=legacy.slice(legacy.indexOf("    const navGrid = document.getElementById('nav-grid');",legacy.indexOf('function injectSocialUI()')),legacy.indexOf("    const main = document.querySelector('main');",legacy.indexOf('function injectSocialUI()')));
  const training=await fs.readFile(path.join(root,'cultivation/cultivation-training-v4.js'),'utf8');
  const trainingNav=training.slice(training.indexOf('  function createNavButton() {'),training.indexOf('  function createTrainingPage() {'));
  assert.ok(navigation.startsWith('window.switchToPage'));assert.ok(social.includes('btn-social-nav'));assert.ok(trainingNav.includes('nav-training'));
  const template=(await fs.readFile(path.join(root,'index.html'),'utf8'))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,tag=>tag.includes('app-stage-bridge.js')?tag:'')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css','/fixture-fa/css/all.min.css')
    .replace(/https:\/\/fonts.googleapis.com\/css2[^\"]+/,'/fixture-serif/400.css')
    .replace('</head>','<link rel="stylesheet" href="/fixture-tailwind.css"><link rel="stylesheet" href="/fixture-serif/600.css"><link rel="stylesheet" href="/fixture-sans/400.css"><link rel="stylesheet" href="/fixture-sans/600.css"></head>')
    .replace('</body>','<script type="module" src="/fixture-boot.js"></script></body>');
  app.get('/app.html',(_req,res)=>res.type('html').send(template));
  app.get('/fixture-tailwind.css',(_req,res)=>res.sendFile(tailwind));
  app.use('/fixture-fa',express.static(path.join(deps,'@fortawesome/fontawesome-free')));
  app.use('/fixture-serif',express.static(path.join(deps,'@fontsource/noto-serif-tc')));
  app.use('/fixture-sans',express.static(path.join(deps,'@fontsource/noto-sans-tc')));
  app.get('/cultivation/data/project-repository.js',(_req,res)=>res.type('js').send(`
    const uid=new URLSearchParams(location.search).get('identity')==='peer'?'peer':'fixture';
    export const getMainUser=()=>({uid});
    export const authenticatedMainFetch=(url,init={})=>fetch(url,{...init,headers:{'Content-Type':'application/json','x-fixture-uid':uid}});
  `));
  // Expose only the test instance; execute the production entry and lifecycle unchanged.
  const entry=(await fs.readFile(path.join(root,'world/world-entry.js'),'utf8')).replace('view=new WorldView(', 'view=window.fixtureView=new WorldView(');
  app.get('/world/world-entry.js',(_req,res)=>res.type('js').send(entry));
  app.get('/fixture-boot.js',(_req,res)=>res.type('js').send(`
    let isBattleActive=false,chatUnsub=null;
    const beginSceneTransition=()=>()=>{},sceneTheme=()=>'',updateTexts=()=>{},renderInventory=()=>{},switchSocialTab=()=>{},renderTrainingPage=()=>{};
    const t=()=> '仙盟';
    window.showToast=message=>window.fixtureToast=message;
    window.loadStoreItems=()=>{};window.getCurrentUserData=()=>(${JSON.stringify(user)});
    window.startQuizFlow=()=>window.fixtureEntry='practice';
    window.returnToImmortalHome=()=>window.openWorldMap?.();
    ${navigation}
    ${social}
    ${trainingNav}
    createNavButton();
    for(const id of ['page-training','page-social']){const page=document.createElement('section');page.id=id;page.className='page-section hidden';document.querySelector('main').append(page);}
    document.documentElement.classList.add('training-access-ready','golden-core-access-ready');
    document.getElementById('login-screen').classList.add('hidden');document.getElementById('bottom-nav').classList.remove('hidden');
    document.getElementById('user-info').textContent='青雲行者 · 1,280 靈石';
    window.switchToPage('page-home');
    window.fixtureNavMarkup=document.getElementById('nav-grid').innerHTML;
    window.fixtureNavAppearance=()=>[document.querySelector('#bottom-nav>.glass-capsule'),...document.querySelectorAll('#nav-grid>button')].map(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return {background:s.backgroundColor,color:s.color,radius:s.borderRadius,font:s.fontFamily,height:r.height,width:r.width};});
    window.fixtureOriginalNav=window.fixtureNavAppearance();
    const world=await import('/world/world-entry.js');await world.featureReady;await window.openWorldMap();
  `));
  app.get('/',(_req,res)=>res.sendFile(path.join(root,'stage.html')));
  app.use(express.static(root));
}
async function main(){
  await setupFixture();await fs.mkdir(output,{recursive:true});const server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.WORLD_CHROMIUM_PATH?{executablePath:process.env.WORLD_CHROMIUM_PATH}:{} )});const results=[];
  async function load(page,search=''){
    await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
    await page.goto(origin+'/'+search);
    await page.waitForFunction(()=>document.getElementById('game-frame')?.contentWindow?.fixtureView?.online);
    return page.frames().find(f=>f.url().includes('/app.html'));
  }
  try{
    const peer=await browser.newPage({viewport:{width:800,height:600}});await load(peer,'?identity=peer');
    for(const size of [{name:'desktop',width:1440,height:900},{name:'phone',width:390,height:844},{name:'tablet',width:1194,height:834},{name:'phone-frame',width:360,height:640},{name:'landscape-frame',width:1280,height:720}]){
      const page=await browser.newPage({viewport:size,deviceScaleFactor:1,isMobile:size.name==='phone',hasTouch:size.name==='phone'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      let frame=await load(page);
      await frame.waitForFunction(()=>Object.values(window.fixtureView.renderer.images).every(i=>i.complete&&i.naturalWidth));
      await frame.evaluate(()=>document.fonts.ready);
      await frame.waitForFunction(()=>window.fixtureView.players.some(p=>p.uid==='peer'));
      assert.equal(await frame.evaluate(()=>document.getElementById('nav-grid').innerHTML===window.fixtureNavMarkup),true,'world preserves the original navigation markup');
      assert.equal(await frame.evaluate(()=>JSON.stringify(window.fixtureOriginalNav)===JSON.stringify(window.fixtureNavAppearance())),true,'world preserves original navigation sizes and styles');
      assert.deepEqual(await frame.locator('#nav-grid>button').allTextContents().then(labels=>labels.map(s=>s.trim())),['宗門','修煉','坊市','仙盟','設定']);
      // Exercise the original dock and the title's return entrance.
      await frame.locator('#nav-training').click();await frame.waitForFunction(()=>document.getElementById('page-training').classList.contains('active-page'));
      await frame.locator('#brand-home').click();await frame.waitForFunction(()=>window.fixtureView.visible&&window.fixtureView.online);
      await frame.locator('#world-free-practice').click();assert.equal(await frame.evaluate(()=>window.fixtureEntry),'practice');
      const pick=async target=>{
        const p=await frame.evaluate(target=>{const r=window.fixtureView.renderer,rect=r.canvas.getBoundingClientRect(),s=40*r.camera.zoom;return{x:rect.left+r.width/2+(target.x+.5-r.camera.x)*s,y:rect.top+r.height/2+(target.y+.5-r.camera.y)*s};},target);
        const stage=await page.evaluate(()=>window.QAGameStage.getState());await page.mouse.click(stage.left+p.x*stage.scale,stage.top+p.y*stage.scale);
      };
      const capture=async phase=>{
        await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal(await frame.evaluate(()=>{const n=document.querySelector('#nav-grid>button'),r=n.getBoundingClientRect();return !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#bottom-nav');}),true,'original navigation remains visible above the world in '+phase);
        await page.screenshot({path:path.join(output,`${size.name}-${phase}.png`),animations:'disabled'});
      };
      await pick(W.townPoint(10,36));await frame.waitForFunction(target=>window.fixtureView.players.find(p=>p.uid==='fixture')?.route.path.at(-1).x===target.x,W.townPoint(10,36));
      await frame.waitForFunction(()=>!QAGridWorld.sample(window.fixtureView.players.find(p=>p.uid==='fixture').route,window.fixtureView.now()).moving);
      await capture('exploration');
      await frame.locator('.ww-objective [data-action="quest"]').click();await frame.locator('[data-action="navigate"][data-step="1"]').click();
      await frame.waitForFunction(()=>window.fixtureView.players.find(p=>p.uid==='fixture').route.path.length>1);
      await frame.waitForFunction(()=>!QAGridWorld.sample(window.fixtureView.players.find(p=>p.uid==='fixture').route,window.fixtureView.now()).moving);
      const fogStop=await frame.evaluate(()=>({position:window.fixtureView.state.position,explored:window.fixtureView.state.explored}));assert.notDeepEqual(fogStop.position,W.starterPoint(12,26));
      await frame.evaluate(()=>window.fixtureView.suspend());service.hub.actors.delete('fixture');
      db.docs.set('worldPlayers/fixture',{...register.__test.normalize(),position:W.starterPoint(18,23),mapVersion:W.VERSION,explored:W.reveal(W.initialExplored(),W.starterPoint(18,23),9)});
      await frame.evaluate(()=>window.fixtureView.start());await frame.waitForFunction(p=>window.fixtureView.state.position.x===p.x&&window.fixtureView.state.position.y===p.y,W.starterPoint(18,23));
      await frame.waitForFunction(p=>window.fixtureView.renderer.camera.x===p.x+.5&&window.fixtureView.renderer.camera.y===p.y+.5,W.starterPoint(18,23));
      await pick(W.object('wolf'));await frame.locator('[data-action="interact"]').click();
      await frame.waitForFunction(()=>window.fixtureView.state.battle?.questions?.length===2);
      await capture('recharge');
      // The restored navigation cannot bypass an active local battle.
      await frame.locator('#nav-training').click();assert.equal(await frame.locator('#page-world').evaluate(n=>n.classList.contains('active-page')),true);
      assert.match(await frame.evaluate(()=>window.fixtureToast),/撤離/);
      const correct=db.docs.get('worldPlayers/fixture').battle.questions[0].answerIndex;
      await frame.locator(`.ww-panel [data-action="answer"][data-choice="${correct}"]`).click();
      await frame.waitForFunction(()=>window.fixtureView.state.battle.answered===1&&window.fixtureView.state.battle.player.mana===2);
      await frame.locator('.ww-panel [data-action="close"]').click();await frame.locator('.ww-battle-actions [data-action="recharge"]').click();
      await frame.locator('.ww-panel [data-action="skip"]').click();await frame.waitForFunction(()=>window.fixtureView.state.battle?.phase==='command');
      await capture('battle');
      const b=await frame.evaluate(()=>window.fixtureView.state.battle),safe=b.reachable.find(p=>p.x!==b.player.x||p.y!==b.player.y);
      await pick(safe);await frame.locator('[data-action="confirm-move"]').click();await frame.waitForFunction(()=>window.fixtureView.state.battle.moved);
      await frame.locator('.ww-battle-actions [data-action="guard"]').click();await frame.waitForFunction(()=>window.fixtureView.state.battle.acted);
      await frame.locator('.ww-battle-actions [data-action="end"]').click();await frame.waitForFunction(()=>window.fixtureView.state.battle.turn===2);
      await page.reload();await page.waitForFunction(()=>document.getElementById('game-frame')?.contentWindow?.fixtureView?.state?.battle?.turn===2);
      frame=page.frames().find(f=>f.url().includes('/app.html'));
      const layout=await frame.evaluate(()=>{
        const p=document.getElementById('page-world'),nav=document.getElementById('bottom-nav'),header=document.querySelector('body>header');
        const buttons=[...p.querySelectorAll('button'),...nav.querySelectorAll('button')].filter(b=>b.getClientRects().length);
        return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,
          root:p.getBoundingClientRect().toJSON(),header:header.getBoundingClientRect().toJSON(),nav:nav.getBoundingClientRect().toJSON(),
          navVisible:getComputedStyle(nav).visibility,overflowButtons:buttons.filter(b=>{const r=b.getBoundingClientRect();return r.left<-.5||r.right>innerWidth+.5||r.bottom>innerHeight+.5;}).map(b=>b.textContent)};
      });
      const shell=await page.evaluate(()=>({stage:QAGameStage.getState(),width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,scrollX,scrollY}));
      assert.equal(layout.documentWidth,layout.width);assert.equal(layout.documentHeight,layout.height);assert.equal(layout.root.top,layout.header.bottom);assert.equal(layout.root.bottom,layout.nav.top);assert.equal(layout.navVisible,'visible');
      assert.equal(shell.documentWidth,size.width);assert.equal(shell.documentHeight,size.height);assert.equal(shell.scrollX,0);assert.equal(shell.scrollY,0);
      assert.equal(layout.width,size.width>=size.height?1280:360);assert.equal(layout.height,size.width>=size.height?720:640);
      assert.ok(Math.abs(shell.stage.width/shell.stage.height-(size.width>=size.height?16/9:9/16))<.0001);
      assert.deepEqual(layout.overflowButtons,[]);assert.deepEqual(errors,[]);
      results.push({viewport:size.name,shell,...layout,checks:['original-five-button-navigation','title-return-to-world','original-header','fixed-aspect-ratio','black-bar-containment','two-live-browsers','point-and-walk','fog-frontier','encounter','two-question-recharge','battle-navigation-guard','answer-and-save','close-and-resume-recharge','confirmed-two-tile-move','guard-after-move','next-turn','reload-recovery']});
      await frame.evaluate(()=>window.fixtureView.suspend());await page.close();service.hub.actors.delete('fixture');db.docs.delete('worldPlayers/fixture');
    }
    // Generated content uses the same entry, pointer controls, API and original chrome.
    const secret=W.objectsIn({x:64,y:64,w:160,h:160}).find(o=>o.kind==='realm'&&o.subtype==='puzzle');
    const entrance=W.DIRS.map(([dx,dy])=>({x:secret.x+dx,y:secret.y+dy})).find(p=>W.walkable(p.x,p.y));
    db.docs.set('worldPlayers/fixture',{...register.__test.normalize(),position:entrance,mapVersion:W.VERSION,explored:W.fullExplored()});
    const generated=await browser.newPage({viewport:{width:1440,height:900}}),generatedErrors=[];generated.on('pageerror',e=>generatedErrors.push(e.message));
    let generatedFrame=await load(generated);
    const pickGenerated=async target=>{
      await generatedFrame.waitForFunction(()=>window.fixtureView.renderer.camera.follow);
      const p=await generatedFrame.evaluate(target=>{const r=window.fixtureView.renderer,rect=r.canvas.getBoundingClientRect(),s=40*r.camera.zoom;return{x:rect.left+r.width/2+(target.x+.5-r.camera.x)*s,y:rect.top+r.height/2+(target.y+.5-r.camera.y)*s};},target);
      const stage=await generated.evaluate(()=>QAGameStage.getState());await generated.mouse.click(stage.left+p.x*stage.scale,stage.top+p.y*stage.scale);
    };
    await generatedFrame.waitForFunction(p=>Math.abs(window.fixtureView.renderer.camera.x-p.x-.5)<.01,entrance);
    await pickGenerated(secret);await generatedFrame.locator('[data-action="interact"]').click();await generatedFrame.waitForFunction(()=>!!window.fixtureView.state.expedition);
    await generatedFrame.evaluate(()=>document.fonts.ready);await generated.screenshot({path:path.join(output,'generated-secret-realm.png'),animations:'disabled'});
    await generatedFrame.locator('[data-action="rotate-rune"][data-index="0"]').click();await generatedFrame.waitForFunction(()=>!window.fixtureView.busy);
    const savedRotations=await generatedFrame.evaluate(()=>window.fixtureView.state.expedition.rotations);
    await generated.reload();await generated.waitForFunction(()=>document.getElementById('game-frame')?.contentWindow?.fixtureView?.online);generatedFrame=generated.frames().find(f=>f.url().includes('/app.html'));
    assert.deepEqual(await generatedFrame.evaluate(()=>window.fixtureView.state.expedition.rotations),savedRotations);
    await generatedFrame.waitForFunction(p=>Math.abs(window.fixtureView.renderer.camera.x-p.x-.5)<.01,entrance);
    await pickGenerated(secret);await generatedFrame.locator('[data-action="interact"]').click();await generatedFrame.waitForFunction(()=>!!document.querySelector('.ww-runes'));
    for(let i=0;i<3;i++)while(await generatedFrame.evaluate(i=>window.fixtureView.state.expedition?.rotations[i]>0,i)){
      const before=await generatedFrame.evaluate(i=>window.fixtureView.state.expedition.rotations[i],i);
      await generatedFrame.locator('[data-action="rotate-rune"][data-index="'+i+'"]').click();await generatedFrame.waitForFunction(({i,before})=>!window.fixtureView.busy&&window.fixtureView.state.expedition?.rotations[i]!==before,{i,before});
    }
    await generatedFrame.waitForFunction(()=>!window.fixtureView.state.expedition);await generated.screenshot({path:path.join(output,'generated-secret-cleared.png'),animations:'disabled'});
    let coast,water;
    for(let y=100;y<400&&!coast;y++)for(let x=100;x<400&&!coast;x++)if(W.walkable(x,y))for(const[dx,dy]of W.DIRS)if(['water','ocean'].includes(W.terrain(x+dx,y+dy))){coast={x,y};water={x:x+dx,y:y+dy};break;}
    await generatedFrame.evaluate(()=>window.fixtureView.suspend());service.hub.actors.delete('fixture');
    db.docs.set('worldPlayers/fixture',{...db.docs.get('worldPlayers/fixture'),position:coast,travelMode:'walk',explored:W.fullExplored()});
    await generatedFrame.evaluate(()=>window.fixtureView.start());await generatedFrame.waitForFunction(p=>Math.abs(window.fixtureView.renderer.camera.x-p.x-.5)<.01,coast);
    await generatedFrame.locator('[data-action="travel"]').click();await generatedFrame.waitForFunction(()=>window.fixtureView.state.travelMode==='sail');
    await pickGenerated(water);await generatedFrame.waitForFunction(p=>QAGridWorld.same(window.fixtureView.state.position,p),water);
    await generated.screenshot({path:path.join(output,'generated-sailing.png'),animations:'disabled'});assert.deepEqual(generatedErrors,[]);
    results.push({scenario:'generated-content',secret,coast,checks:['generated-realm-visible','pointer-interaction','non-combat-mechanism','reload-resumes-mechanism','exploration-reward','coast-boarding','sailing-along-real-route','original-navigation-preserved']});
    await generatedFrame.evaluate(()=>window.fixtureView.suspend());await generated.close();
    await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
  }finally{await browser.close();service.close();server.closeAllConnections();server.close();}
}
main().catch(error=>{console.error(error);service.close();process.exitCode=1;});

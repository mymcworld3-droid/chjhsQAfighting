/* Exercise real world navigation/interaction locally with isolated fixture data. */
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),express=require('express'),{once}=require('node:events');
const runtime=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules';
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(runtime,'playwright')));}
const {worldDb}=require('../tests/helpers/world-db.cjs'),register=require('../world-api.cjs'),W=require('../public/world/world-core.js');
const root=path.resolve(__dirname,'../public'),output=path.resolve(process.env.SECT_TOWN_OUTPUT||'docs/design/sect-town');
const user={uid:'fixture',displayName:'青雲行者',stats:{totalScore:68,maxHp:1000,attack:200,gold:1280},materialSystem:{inventory:{}}};
const db=worldDb({'users/fixture':user,'worldPlayers/fixture':{position:W.SPAWN,mapVersion:W.VERSION,explored:W.fullExplored()}}),app=express();
let at=Date.now();app.use(express.json());
const service=register(app,{resolveA:()=>({db}),verify:async()=> 'fixture',now:()=>at,schedule:false});
app.post('/fixture-advance',async(_req,res)=>{at+=30000;await service.tick();res.json({now:at});});
app.get('/cultivation/data/project-repository.js',(_req,res)=>res.type('js').send(`export const getMainUser=()=>({uid:'fixture'});export const authenticatedMainFetch=(url,init={})=>fetch(url,{...init,headers:{'Content-Type':'application/json',...init.headers}});`));
async function main(){
  await fs.mkdir(output,{recursive:true});
  const entry=(await fs.readFile(path.join(root,'world/world-entry.js'),'utf8')).replace('view=new WorldView(','view=window.fixtureView=new WorldView(');
  app.get('/world/world-entry.js',(_req,res)=>res.type('js').send(entry));
  const fonts=process.env.SECT_TOWN_FONTS;if(fonts)app.use('/fixture-font',express.static(fonts));
  app.get('/fixture',(_req,res)=>res.type('html').send(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${fonts?'<link rel="stylesheet" href="/fixture-font/index.css">':''}<style>
    :root{--ui-font:'Noto Sans TC',sans-serif;--ui-serif:'Noto Sans TC',serif}*{box-sizing:border-box}body{margin:0;background:#17140f;color:#eee4d0;font-family:'Noto Sans TC',sans-serif}header{height:54px;padding:14px 18px;background:#221c15}footer{position:fixed;bottom:0;left:0;right:0;height:58px;display:flex;justify-content:space-around;align-items:center;background:#221c15}.hidden{display:none}button{font:inherit}main>section:not(#page-world){padding:24px}dialog{background:#221c15;color:#eee4d0}.page-section.hidden{display:none!important}
    </style></head><body><header>青雲問道 · 問道宗</header><main><section id="page-home" class="page-section hidden"></section><section id="page-store" class="page-section hidden"><h2>坊市服務</h2><button id="pm-view-shop">坊市商品</button><button data-i18n="tab_avatar">頭像</button><button data-i18n="tab_frame">頭像框</button></section><section id="page-history" class="page-section hidden">答題紀錄</section><section id="page-training" class="page-section hidden"></section></main><footer id="bottom-nav"><span>宗門</span><span>修煉</span><span>坊市</span><span>好友</span><span>設定</span></footer><button id="quest-open" hidden></button><dialog id="quest-panel"><button id="quest-tab-daily">日常委託</button></dialog><script type="module">
    window.fixtureMarketFilter='';window.fixtureCategory='';window.fixturePage='';window.fixtureErrors=[];
    window.getCurrentUserData=()=>(${JSON.stringify(user)});window.showToast=text=>window.fixtureToast=text;
    window.switchToPage=id=>{document.querySelectorAll('.page-section').forEach(n=>{n.classList.toggle('hidden',n.id!==id);n.classList.toggle('active-page',n.id===id)});window.fixturePage=id;};
    window.openPlayerMarketplace=filter=>{window.fixtureMarketFilter=filter;window.switchToPage('page-store')};
    document.querySelector('[data-i18n="tab_avatar"]').onclick=()=>window.fixtureCategory='avatar';document.querySelector('[data-i18n="tab_frame"]').onclick=()=>window.fixtureCategory='frame';
    document.getElementById('quest-open').onclick=()=>document.getElementById('quest-panel').showModal();
    await import('/world/world-entry.js');await window.openWorldMap();
  </script></body></html>`));
  app.use(express.static(root));const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.SECT_TOWN_BROWSER?{executablePath:process.env.SECT_TOWN_BROWSER}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});const url='http://127.0.0.1:'+server.address().port+'/fixture',report=[];
    for(const width of [1200,390,320]){
      const context=await browser.newContext({viewport:{width,height:840},deviceScaleFactor:width<600?2:1}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
      await page.waitForFunction(()=>window.fixtureView?.state&&Object.values(window.fixtureView.renderer.images).every(i=>i.complete&&i.naturalWidth));
      await page.locator('[data-action="sect-guide"]').click();await page.locator('[data-place="market-hall"]').waitFor();
      const box=await page.locator('.ww-panel').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,'directory fits viewport');
      assert.equal(await page.locator('.ww-sect-guide [data-place]').count(),W.SECT_DISTRICTS.flatMap(d=>d.places).length);
      await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(output,'guide-'+width+'.png')});
      const target=width===1200?'material-shop':'avatar-shop';await page.locator('[data-place="'+target+'"]').click();
      await page.waitForFunction(()=>window.fixtureView.pending||window.fixtureView.navigation);
      await page.evaluate(async()=>{const r=await(await fetch('/fixture-advance',{method:'POST'})).json();window.fixtureView.clockOffset=r.now-Date.now();window.fixtureView.checkArrival();});
      if(width===1200)await page.waitForFunction(()=>window.fixtureMarketFilter==='material');else await page.waitForFunction(()=>window.fixtureCategory==='avatar');
      assert.equal(await page.evaluate(()=>window.fixturePage),'page-store');
      await page.evaluate(async()=>{await window.openWorldMap();const r=window.fixtureView.renderer;r.camera.follow=false;r.camera.x=482.5;r.camera.y=524.5;r.camera.zoom=1.25;});
      await page.waitForFunction(()=>window.fixtureView.visible&&window.fixtureView.online&&!window.fixtureView.busy);await page.screenshot({path:path.join(output,'market-'+width+'.png')});
      // The added medical and merit buildings use actual movement, server
      // proximity checks, arrival dispatch and the existing commission dialog.
      const home='sect-home-west-23-n11';
      for(const [place,title]of [['infirmary','回春醫館'],['merit-hall','功德堂'],[home,W.object(home).name]]){
        await page.locator('[data-action="sect-guide"]').click();await page.locator('[data-place="'+place+'"]').click();
        await page.waitForFunction(()=>window.fixtureView.pending||window.fixtureView.navigation,{},{timeout:5000}).catch(async error=>{throw new Error(error.message+' '+JSON.stringify(await page.evaluate(()=>({pending:window.fixtureView.pending,online:window.fixtureView.online,position:window.fixtureView.state.position,message:document.querySelector('.ww-message')?.textContent,title:document.querySelector('.ww-panel h2')?.textContent}))));});
        await page.evaluate(async()=>{const r=await(await fetch('/fixture-advance',{method:'POST'})).json();window.fixtureView.clockOffset=r.now-Date.now();window.fixtureView.checkArrival();});
        await page.waitForFunction(title=>document.querySelector('.ww-panel h2')?.textContent===title&&!window.fixtureView.busy,title);
        const current=await page.evaluate(()=>window.fixtureView.state.position);assert.equal(W.distance(current,W.object(place)),1);
        await page.evaluate(()=>{const r=window.fixtureView.renderer;r.camera.follow=true;});
        if(place!==home||width===390)await page.screenshot({path:path.join(output,place+'-'+width+'.png')});
        if(place==='merit-hall'){await page.locator('.ww-panel [data-entry="commissions"]').click();assert.equal(await page.locator('#quest-panel').evaluate(n=>n.open),true);await page.locator('#quest-panel').evaluate(n=>n.close());}
      }
      assert.deepEqual(errors,[]);report.push({width,guideFits:true,routeAndInteraction:true,medicalArrival:true,meritCommissions:true,housingArrival:true,service:width===1200?'material market':'avatar store',pageErrors:errors.length});await context.close();
    }
    await fs.writeFile(path.join(output,'browser-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  }finally{await browser?.close();service.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);service.close();process.exitCode=1;});

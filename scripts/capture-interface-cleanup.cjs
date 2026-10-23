// Local visual review only: sample data, no game API calls or player session.
const fs=require('fs'),path=require('path'),http=require('http'),cp=require('child_process'),assert=require('node:assert/strict'),os=require('node:os');
const {chromium}=require('playwright');
const repo=path.resolve(__dirname,'..'),root=path.join(repo,'public'),baseline=process.env.BASELINE==='1';
const deps=process.env.UI_CAPTURE_DEPS||path.join(os.tmpdir(),'ui-preview','node_modules');
const tailwind=process.env.UI_CAPTURE_TAILWIND||path.join(os.tmpdir(),'ui-tailwind.css');
const baseRef=process.env.UI_CAPTURE_BASE_REF||'691e980628052c628cb2b68aff742762fcf33bc6';
const output=process.env.UI_CAPTURE_OUTPUT||path.join(repo,'docs/design/interface-cleanup');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{
 let name=new URL(req.url,'http://localhost').pathname.slice(1)||'stage.html';if(name==='app.html')name='index.html';
 try{let data;
 if(name==='tailwind.js')data='const s=document.createElement("style");s.textContent='+JSON.stringify(fs.readFileSync(tailwind,'utf8'))+';document.head.append(s);';
 else if(name.startsWith('__font/'))data=fs.readFileSync(path.join(deps,'@fontsource/noto-serif-tc',name.slice(7)));
 else if(name.startsWith('__sans/'))data=fs.readFileSync(path.join(deps,'@fontsource/noto-sans-tc',name.slice(7)));
 else if(name.startsWith('__fa/'))data=fs.readFileSync(path.join(deps,'@fortawesome/fontawesome-free',name.slice(5)));
 else {data=baseline&&name==='index.html'?cp.execFileSync('git',['show',baseRef+':public/index.html'],{cwd:repo}):fs.readFileSync(path.join(root,name));
 if(name==='index.html')data=data.toString().replace('https://cdn.tailwindcss.com','/tailwind.js')
 .replace('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css','/__fa/css/all.min.css')
 .replace(/https:\/\/fonts.googleapis.com\/css2[^\"]+/,'/__font/400.css')
 .replace('</head>','<link rel="stylesheet" href="/__font/600.css"><link rel="stylesheet" href="/__sans/400.css"><link rel="stylesheet" href="/__sans/600.css"></head>')
 .replace(/<script[^>]*type="module"[^>]*><\/script>/g,'');}
 res.setHeader('Content-Type',name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':name.endsWith('.woff2')?'font/woff2':name.endsWith('.png')?'image/png':name.endsWith('.webp')?'image/webp':'application/octet-stream');res.end(data);
 }catch{res.writeHead(404).end();}
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.UI_CAPTURE_BROWSER||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try{
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
await page.goto(origin,{waitUntil:'load'});const frame=page.frames().find(f=>f.url().includes('/app.html'));await frame.waitForFunction(()=>getComputedStyle(document.body).display==='flex');
await frame.evaluate(()=>{
 window.limitImmortalRank=i=>i;window.getCurrentUserData=()=>({uid:'layout-preview',stats:{totalScore:116},profile:{displayName:'青雲行者'}});
 window.switchToPage=id=>{document.querySelectorAll('.page-section').forEach(e=>{e.classList.toggle('hidden',e.id!==id);e.classList.toggle('active-page',e.id===id);});document.querySelectorAll('#nav-grid [data-target]').forEach(e=>e.classList.toggle('active-nav-btn',e.dataset.target===id));document.querySelector('main').scrollTop=0;};
 window.startQuizFlow=()=>window.__uiClicked='solo';window.startBattleMatchmaking=()=>window.__uiClicked='duel';
 document.documentElement.classList.add('training-access-ready','golden-core-access-ready');document.querySelector('#login-screen').classList.add('hidden');
 document.querySelector('#bottom-nav').classList.remove('hidden');window.switchToPage('page-home');
 document.querySelector('#user-info').removeAttribute('data-i18n');document.querySelector('#user-info').textContent='青雲行者 · 1,280 靈石';
 const home=document.querySelector('[data-target="page-home"]');
 home.insertAdjacentHTML('afterend','<button id="nav-training" type="button" class="nav-btn training-nav-btn flex flex-col items-center justify-center h-full" data-target="page-training" onclick="switchToPage(\'page-training\')"><div class="relative p-1 training-nav-orb"><i class="fa-solid fa-fire-flame-curved"></i></div><span>修煉</span></button>');
 const settings=document.querySelector('[data-target="page-settings"]');settings.insertAdjacentHTML('beforebegin','<button id="btn-social-nav" type="button" class="nav-btn flex flex-col items-center justify-center h-full" data-target="page-social"><div class="relative p-1"><i class="fa-solid fa-user-group"></i></div><span>仙盟</span></button>');
 document.querySelector('#home-avatar-container').innerHTML='<div class="ui-avatar-viewport" style="width:100%;height:100%;border:1px solid #b89b5e66;background:#29302a"><img src="/assets/story/characters/player-male-determined.png" style="object-position:50% 12%!important" alt="玩家頭像"></div>';
 for(const [id,value] of Object.entries({'display-score':'116','display-accuracy':'82%','display-streak':'6','display-best-streak':'18','xiuxian-meditation-streak':'連續閉關 3 日 · 累計 12 日'}))document.getElementById(id).textContent=value;
 const slot=document.querySelector('#quest-spotlight-slot');slot.hidden=false;document.querySelector('#quest-spotlight-kind').textContent='日常任務';document.querySelector('#quest-spotlight-progress').textContent='3 / 5';
 document.querySelector('#quest-spotlight-title').textContent='今日問道，答對 5 題';document.querySelector('#quest-spotlight-reward').textContent='靈石 ×100 · 契器券 ×1';document.querySelector('#quest-spotlight-action').textContent='前往修行 →';
 for(const id of ['quest-ready-dot','meditation-pending-dot','sect-raid-ticket-dot'])document.getElementById(id).hidden=false;
});
await frame.addScriptTag({url:origin+'/cultivation/realm-icons.js'});
await frame.addScriptTag({url:origin+'/cultivation/cultivation-theme.js'});
await frame.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);
const reports=[];
for(const view of [{name:'landscape',width:1440,height:810},{name:'portrait',width:390,height:844}]){
 await page.setViewportSize(view);await page.waitForTimeout(120);await frame.evaluate(()=>{document.querySelector('main').scrollTop=0;document.querySelector('.home-records')?.removeAttribute('open');});await frame.evaluate(()=>document.fonts.ready);
 await page.locator('#game-stage').screenshot({path:path.join(output,(baseline?'before-':'home-')+view.name+'.jpg'),animations:'disabled',type:'jpeg',quality:90});
 const measure=await frame.evaluate(()=>{const ids=['xiuxian-panel','btn-home-start','btn-home-pvp','quest-spotlight','bottom-nav'];return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,bodyHeight:document.body.clientHeight,mainScroll:document.querySelector('main').scrollTop,mainHeight:document.querySelector('main').clientHeight,mainContent:document.querySelector('main').scrollHeight,nodes:ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,x:r.x,y:r.y,width:r.width,height:r.height};}),recordsOpen:document.querySelector('.home-records')?.open};});reports.push({view,...measure});
 if(!baseline){assert.ok(measure.documentWidth<=measure.width);const nav=measure.nodes.find(x=>x.id==='bottom-nav');for(const id of ['btn-home-start','btn-home-pvp']){const r=measure.nodes.find(x=>x.id===id);assert.ok(r.y+r.height<=nav.y,'primary actions fit above navigation');assert.ok(r.height>=44);}}
 if(!baseline&&view.name==='landscape'){
  await frame.locator('.home-records summary').click();await page.locator('#game-stage').screenshot({path:path.join(output,'home-landscape-records.jpg'),animations:'disabled',type:'jpeg',quality:90});assert.equal(await frame.locator('.home-records').getAttribute('open'),'');
 }
}
if(!baseline){await frame.locator('#btn-home-start').click();assert.equal(await frame.evaluate(()=>window.__uiClicked),'solo');await frame.locator('#btn-home-pvp').click();assert.equal(await frame.evaluate(()=>window.__uiClicked),'duel');
await frame.locator('.home-records summary').click();await page.locator('#game-stage').screenshot({path:path.join(output,'home-portrait-records.jpg'),animations:'disabled',type:'jpeg',quality:90});
}
if(!baseline){await frame.locator('#xiuxian-path').click();assert.equal(await frame.locator('#xiuxian-realm-atlas').count(),1);await frame.locator('[data-realm-atlas-close]').click();assert.equal(await frame.locator('#xiuxian-realm-atlas').count(),0);}
if(process.env.UI_CAPTURE_PAGES==='all') await require('./interface-preview-pages.cjs')({page,frame,origin,root,output,reports,assert});
console.log(JSON.stringify({baseline,reports,errors},null,2));assert.equal(errors.length,0);
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

'use strict';
// Isolated visual and interaction acceptance. No real player credentials.
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname,'../public');
const out = process.env.HOME_ART_OUTPUT || '/tmp/home-art-acceptance';
const mime = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.woff2':'font/woff2'};
const server = createServer(async(req,res)=>{
  const url = new URL(req.url,'http://localhost');
  if(url.pathname === '/cultivation/data/project-repository.js') {
    res.setHeader('Content-Type','text/javascript');
    return res.end(`export const getMainUser=()=>window.__homeTest.uid?{uid:window.__homeTest.uid}:null;
      export const authenticatedMainFetch=async(url,init)=>{window.__homeTest.requests.push({url,init});return {ok:true,json:async()=>({ok:true,quests:window.__homeTest.uid==='test-a'?window.__homeTest.quests:{...window.__homeTest.quests,daily:[],commissions:[]}})};};`);
  }
  try {
    const filename = path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!filename.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
    let data=await fs.readFile(filename);
    if(url.pathname==='/') data=Buffer.from(data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    res.setHeader('Content-Type',mime[path.extname(filename)]||'application/octet-stream');res.end(data);
  } catch {res.writeHead(404).end();}
});
(async()=>{
  await fs.mkdir(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.TACTICAL_CHROMIUM?{executablePath:process.env.TACTICAL_CHROMIUM}:{})});
  try {
    for(const viewport of [{width:390,height:844},{width:941,height:1672},{width:1672,height:941},{width:1024,height:768},{width:844,height:390},{width:320,height:568}]) {
      const context=await browser.newContext({viewport,serviceWorkers:'block',reducedMotion:'reduce'});
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
      await page.addStyleTag({content:'body{margin:0;height:100dvh}main{height:100%;position:relative}.page-section:not(.active-page),#login-screen{display:none!important}'});
      await page.evaluate(()=>{
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
        window.__homeTest={uid:'test-a',requests:[],actions:[],profile:{uid:'test-a',displayName:'雲游子',stats:{gold:12580000,totalScore:188,rankLevel:11}},quests:{date:today,weeklyKey:'2026-11-23',path:null,pathTotal:23,pathIndex:0,pathTicketRewards:[],daily:Array.from({length:6},(_,i)=>({id:'task-'+i,title:['靜心閉關','溫故知新','勤學不輟','論道切磋','洞天探幽','同門協力'][i],description:'今日的修行任務',current:i===1?3:0,target:i===1?3:1,claimed:i===1,claimable:false,locked:false,destination:i===0?'meditation':'solo',reward:{gold:30,cultivation:1}})),commissions:[],weekly:[]}};
        window.getCurrentUserData=()=>window.__homeTest.profile;
        window.getCombatPower=()=>({total:3256880,complete:true});
        window.getXiuxianRealmIndex=()=>11;
        window.openDailyMeditation=()=>window.__homeTest.actions.push('meditation');
        window.startQuizFlow=()=>window.__homeTest.actions.push('trial');
        window.loadLeaderboard=()=>window.__homeTest.actions.push('leaderboard');
        window.loadStoreItems=()=>window.__homeTest.actions.push('store');
        window.QAFriendRequests={open:()=>window.__homeTest.actions.push('invites')};
        window.switchToPage=id=>{window.__homeTest.actions.push(id);document.querySelectorAll('.page-section').forEach(p=>p.classList.toggle('active-page',p.id===id));};
        window.XianxiaQuestRules=undefined;
        document.getElementById('xiuxian-realm').textContent='化神';document.getElementById('xiuxian-sub').textContent='神念通天';
        document.getElementById('page-home').classList.add('active-page');
      });
      await page.addScriptTag({type:'module',url:'/cultivation/home-wireframe.js'});
      await page.addScriptTag({type:'module',url:'/cultivation/quest-system.js'});
      await page.waitForFunction(()=>document.querySelectorAll('.home-art-task').length===6);
      assert.equal(await page.locator('#home-art-gold').textContent(),'12,580,000');
      assert.ok(await page.locator('#home-art-gold').evaluate(el=>el.scrollWidth<=el.clientWidth),'gold amount fits without truncation');
      assert.equal(await page.locator('#home-art-name').textContent(),'雲游子');
      assert.equal(await page.locator('#home-art-tasks-count').textContent(),'（1/6）');
      assert.equal(await page.locator('.home-art-task-check').count(),1);
      const geometry=await page.evaluate(()=>{
        const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
        return {scene:rect('.home-art-scene'),tasks:rect('.home-art-tasks'),trial:rect('.home-art-trial'),nav:rect('.home-art-navigation'),wallet:rect('.home-art-wallet'),tools:rect('.home-art-tools'),player:rect('.home-art-player'),title:rect('.home-art-title'),width:document.documentElement.scrollWidth,innerWidth};
      });
      assert.ok(geometry.width<=viewport.width,'no horizontal overflow');
      assert.ok(geometry.tasks.bottom<geometry.trial.y+geometry.trial.h*.4,'task panel does not cover trial label');
      assert.ok(geometry.tools.x>=geometry.player.right-2,'player and tools do not overlap');
      // Images must load; the scene picks exactly one responsive background.
      assert.ok(await page.locator('.home-art-scene img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)));
      await page.locator('.home-art-meditation').click();
      await page.locator('#btn-home-start').click();
      await page.locator('[data-home-quest-id="task-0"]').click();
      assert.deepEqual(await page.evaluate(()=>window.__homeTest.actions),['meditation','trial','meditation']);
      await page.locator('[data-home-action="mail"]').click();
      await page.locator('#home-art-mail [data-invites]').click();
      assert.equal(await page.evaluate(()=>window.__homeTest.actions.at(-1)),'invites');
      await page.evaluate(()=>{document.getElementById('quest-ready-dot').hidden=false;});
      await page.waitForFunction(()=>!document.querySelector('[data-home-alert="quest"]').hidden);
      await page.screenshot({path:path.join(out,`${viewport.width}x${viewport.height}.png`)});
      await page.locator('[data-home-action="settings"]').click();
      assert.notEqual(await page.evaluate(()=>getComputedStyle(document.querySelector('body>header')).display),'none');
      // A new UID with the old profile must clear the previous wallet and name.
      await page.evaluate(()=>{window.switchToPage('page-home');window.__homeTest.uid='test-b';window.dispatchEvent(new Event('xiuxian:user-ready'));});
      await page.waitForFunction(()=>document.getElementById('home-art-gold').textContent==='—');
      assert.equal(await page.locator('#home-art-name').textContent(),'青雲修士');
      assert.equal(await page.locator('#home-art-tasks-list').textContent().then(t=>t.includes('靜心閉關')),false);
      assert.deepEqual(errors,[]);
      console.log(JSON.stringify({viewport,geometry,status:'passed'}));
      await context.close();
    }
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

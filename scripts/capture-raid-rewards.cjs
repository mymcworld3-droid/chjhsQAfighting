// Visual fixtures execute the real result renderer with synthetic server outcomes.
// This does not authenticate, mutate production data, or claim real rewards.
const {chromium}=require('playwright');
const {createServer}=require('node:http');
const {readFile,mkdir,writeFile}=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'../public');
const output=path.resolve(process.env.LAYOUT_OUTPUT || 'layout-screenshots');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json'};
const server=createServer(async(req,res)=>{
  try {
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
    const data=await readFile(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(data);
  }catch{res.writeHead(404).end();}
});
(async()=>{
  await mkdir(output,{recursive:true});
  const source=await readFile(path.join(root,'cultivation/raid-mode.js'),'utf8');
  const finish=source.slice(source.indexOf('  function finishRaid('),source.indexOf('  function resetRaid('));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const measurements=[];
  try {
    for(const size of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]) {
      const page=await browser.newPage({viewport:size,deviceScaleFactor:1,reducedMotion:'reduce'});
      await page.route('**/main.js*',route=>route.abort());
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'domcontentloaded'});
      await page.evaluate(async()=>{
        document.head.innerHTML='<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles/raid-mode.css">';
        document.body.className='xianxia-theme raid-page-open';
        document.body.innerHTML='<main><div id="page-raid" class="page-section raid-page active-page"><section id="raid-result" class="raid-view"></section></div></main>';
        Object.assign(document.body.style,{margin:'0',background:'#0b1415',color:'#d7d1bc',fontFamily:'sans-serif'});
        const raid=document.getElementById('page-raid');
        raid.style.setProperty('--raid-page-height','100dvh');raid.style.setProperty('--raid-header-height','0px');raid.style.setProperty('--raid-bottom-clearance','0px');
        window.lootView=await import('./cultivation/raid-loot-view.js');
      });
      await page.waitForFunction(()=>document.styleSheets.length>0);
      for(const mode of ['won','lost','pending','retry','duplicate']) {
        await page.evaluate(({finish,mode})=>{
          const mine={uid:'fixture',name:'青雲學子',damage:2400,correct:8,attempts:10,learningCorrect:8,spiritCorrect:8};
          const state={status:'active',roomId:'fixture_room',bossActionCount:6,room:{status:mode==='lost'?'lost':'won',bossHp:mode==='lost'?1400:0,members:{fixture:mine}},learningOutcome:mode==='pending'?null:{settledLearningCorrect:8,settledCorrect:8}};
          const rewards={awarded:mode!=='duplicate',rewards:{'raid-refine-key-ii':3,'raid-refine-key-iii':2,'taixu-mystic-iron':2,'nascent-soul-crystal':1},dailyFirstVictory:true,firstVictory:true,memento:{name:'清霜劍印'},realm:'元嬰'};
          const claim=()=>{
            const status=document.getElementById('raid-reward-status');
            status.innerHTML=mode==='retry'?'<b>獎勵尚未確認</b><small>連線中斷，請稍後重試</small><button class="raid-ghost" data-retry-reward>重試同步／領取</button>':window.lootView.renderRaidLoot(rewards);
          };
          const run=new Function('state','stopTick','setRaidCombatFocus','show','raidRoomMembers','RAID_MVP','escapeHtml','myRoomMember','renderRaidLearning','claimRaidReward','updateHomeEntry','leaveRaidRoom','resetRaid','renderHub','syncRaidViewportLock',finish+'\nfinishRaid(state.room.status===\'won\',\'fixture\');');
          run(state,()=>{},()=>{},()=>{},room=>Object.values(room.members),{bossImage:'assets/story/characters/shen-qingshuang.png'},value=>String(value),()=>mine,window.lootView.renderRaidLearning,claim,()=>{},async()=>{},()=>{},()=>{},()=>{});
          document.getElementById('raid-result').scrollTop=0;
        },{finish,mode});
        await page.screenshot({path:path.join(output,`${size.name}-raid-${mode}.png`),animations:'disabled'});
        const view=await page.evaluate(()=>{
          const result=document.getElementById('raid-result');
          return {viewport:innerWidth,contentWidth:result.scrollWidth,visibleWidth:result.clientWidth,documentWidth:document.documentElement.scrollWidth,lootItems:document.querySelectorAll('.raid-loot-item').length};
        });
        measurements.push({viewport:size.name,mode,...view});
        if(view.contentWidth>view.visibleWidth+1||view.documentWidth>view.viewport+1)throw Error('Raid result horizontal overflow: '+JSON.stringify(view));
        await page.locator('[data-refinery]').scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(output,`${size.name}-raid-${mode}-rewards.png`),animations:'disabled'});
      }
      await page.close();
    }
    await writeFile(path.join(output,'raid-reward-measurements.json'),JSON.stringify(measurements,null,2));
    console.log(JSON.stringify(measurements));
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});

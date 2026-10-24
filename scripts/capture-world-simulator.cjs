'use strict';
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict'),express=require('express'),{once}=require('node:events'),{pathToFileURL}=require('node:url');
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','playwright')));}
const root=path.resolve(__dirname,'../public'),output=path.resolve('docs/design/seed-world'),app=express();
app.use('/fonts',express.static('/tmp/grid-world-ui/node_modules/@fontsource/noto-sans-tc'));app.use(express.static(root));
(async()=>{
 await fs.mkdir(output,{recursive:true});const server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.WORLD_CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});const errors=[],reports=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('blob:')?route.continue():route.abort());
  await page.goto(origin+'/world-simulator.html');await page.addStyleTag({url:origin+'/fonts/400.css'});await page.addStyleTag({content:':root{font-family:"Noto Sans TC",sans-serif}'});
  const ready=()=>page.waitForFunction(()=>!!WorldSeedSimulator.getState().world&&!WorldSeedSimulator.getState().busy);
  await ready();await page.evaluate(()=>document.fonts.ready);
  const initial=await page.evaluate(()=>WorldSeedSimulator.getState());assert.equal(initial.world.size,1000);assert.equal(initial.stats.fingerprint,'d3b3c064');assert.ok(initial.stats.kinds.realm>300);
  await page.screenshot({path:path.join(output,'simulator-desktop.png')});
  await page.locator('#layer').selectOption('resources');await page.screenshot({path:path.join(output,'simulator-resources.png')});
  await page.locator('#spawn').click();await page.locator('#paint').selectOption('road');
  const tile={x:10,y:35};const point=await page.evaluate(p=>{const c=document.getElementById('map'),r=c.getBoundingClientRect(),v=WorldSeedSimulator.getState().view;return{x:r.x+(c.clientWidth/2+(p.x+.5-v.x)*v.scale)*r.width/c.clientWidth,y:r.y+(c.clientHeight/2+(p.y+.5-v.y)*v.scale)*r.height/c.clientHeight};},tile);
  await page.mouse.click(point.x,point.y);assert.equal(await page.evaluate(()=>Object.values(WorldSeedSimulator.getState().patches).reduce((n,c)=>n+Object.keys(c.tiles).length,0)),1);
  await page.screenshot({path:path.join(output,'simulator-delta.png')});
  const jsonDownload=page.waitForEvent('download');await page.locator('#export-json').click();const download=await jsonDownload,data=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.equal(data.world.size,1000);assert.equal(data.tiles,undefined);assert.equal(Object.keys(data.patches).length,1);assert.ok(JSON.stringify(data).length<1024);
  await fs.writeFile(path.join(output,'sample-world-delta.json'),JSON.stringify(data,null,2)+'\n');
  await page.locator('#paint').selectOption('restore');await page.mouse.click(point.x,point.y);assert.equal(await page.evaluate(()=>Object.keys(WorldSeedSimulator.getState().patches).length),0);
  await page.locator('#seed').fill('海上有仙山');await page.locator('#generate').click();await ready();assert.notEqual((await page.evaluate(()=>WorldSeedSimulator.getState().stats.fingerprint)),initial.stats.fingerprint);
  await page.locator('#compare').click();await page.waitForFunction(()=>document.querySelectorAll('.compare-card').length===4);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(output,'simulator-compare.png')});
  await page.locator('.compare-card').nth(2).click();await ready();assert.equal(await page.locator('#compare-dialog').evaluate(n=>n.open),false);
  await page.locator('#import-file').setInputFiles({name:'delta.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await ready();assert.equal(await page.evaluate(()=>Object.keys(WorldSeedSimulator.getState().patches).length),1);
  assert.equal(await page.evaluate(()=>WorldSeedSimulator.getState().world.seed),data.world.seed);
  const imageDownload=page.waitForEvent('download');await page.locator('#export-png').click();const png=await fs.readFile(await(await imageDownload).path());assert.equal(png.readUInt32BE(16),1000);assert.equal(png.readUInt32BE(20),1000);
  await fs.writeFile(path.join(output,'seed-map.png'),png);
  await page.locator('#import-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...data,world:{...data.world,generatorVersion:'unsupported'}}))});await page.waitForFunction(()=>document.getElementById('status').textContent.includes('匯入失敗'));
  await page.locator('#import-file').setInputFiles({name:'delta.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await ready();
  await page.locator('#layer').selectOption('terrain');
  for(const view of [{width:1440,height:900},{width:390,height:844},{width:1194,height:834}]){
   await page.setViewportSize(view);await page.locator('#fit').click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const measure=await page.evaluate(()=>{const s=document.getElementById('sim-stage').getBoundingClientRect();return{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,stage:s.toJSON()};});
   assert.equal(measure.width,measure.documentWidth);assert.equal(measure.height,measure.documentHeight);assert.ok(Math.abs(measure.stage.width/measure.stage.height-(view.width<view.height?9/16:16/9))<.001);
   reports.push(measure);if(view.width===390)await page.screenshot({path:path.join(output,'simulator-phone.png')});
  }
  const offline=await browser.newContext({offline:true,viewport:{width:1280,height:720}}),file=await offline.newPage();file.on('pageerror',e=>errors.push(e.message));
  await file.goto(pathToFileURL(path.join(root,'world-simulator.html')).href);await file.waitForFunction(()=>!!WorldSeedSimulator.getState().world&&!WorldSeedSimulator.getState().busy);
  assert.equal(await file.evaluate(()=>WorldSeedSimulator.getState().stats.fingerprint),initial.stats.fingerprint);await offline.close();assert.deepEqual(errors,[]);
  const result={checks:['million-tile-generation','browser-server-fingerprint','four-seed-comparison','layer-switch','zoom-to-sect','paint-real-tile','delta-only-json-under-1KB','restore-tile','new-seed-different-world','import-restores-seed-and-delta','reject-generator-version-mismatch','export-1000-square-png','16:9-and-9:16-fit','offline-standalone-file'],reports,defaultStats:initial.stats,errors};
  await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

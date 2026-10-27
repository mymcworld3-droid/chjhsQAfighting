'use strict';
// Local browser acceptance: node scripts/check-in-app-select-ui.cjs
// Optional SELECT_CHROMIUM points to an installed Chromium executable.
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'../public');
const html=`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/qa-font/index.css"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/styles/weapon-forge.css"><link rel="stylesheet" href="/styles/classroom.css"><link rel="stylesheet" href="/styles/in-app-select.css">
<style>body{margin:0;padding:20px;background:#10130f;color:#eddfc5;font:16px "Noto Sans TC",system-ui}*{box-sizing:border-box}.w-full{width:100%}.hidden{display:none!important}form{display:grid;gap:20px;width:min(100%,620px)}label{display:block}h1{font-size:22px}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}#dynamic{min-width:0}#nested{padding:20px;background:#10130f;color:#eddfc5;border:1px solid #9b855a;border-radius:10px}#scroll-space{height:900px}</style>
<body class="xianxia-theme"><h1>選單操作驗收</h1><form id="fixture"><label for="mode" id="external">課程選單</label><select id="mode" name="mode" class="input-cyber w-full" required><option value="a">數學</option><option value="b">自然</option><optgroup label="其他"><option value="c">歷史</option><option disabled value="x">停用課程</option></optgroup></select>
<label class="wf-payment">使用<select id="payment" name="payment"><option value="gold">靈石 · 持有 1000</option><option value="ticket">契器券 · 持有 5</option></select></label>
<div class="cc-shell fields"><label>年級<select id="grade"><option>七年級</option><option>八年級</option></select></label><div id="dynamic"></div></div>
<fieldset disabled id="disabled"><label>停用<select id="off"><option>不可操作</option></select></label></fieldset><select id="hidden" hidden><option>不可見</option></select><select id="css-hidden" style="display:none"><option>不可見</option></select>
<button type="reset" id="reset">重設</button><button type="button" id="open-nested">視窗內選單</button></form><dialog id="nested"><label>排序<select id="nested-select"><option>名稱</option><option>數量</option></select></label><button type="button" id="close-nested">關閉</button></dialog><div id="scroll-space"></div>
<script>window.events=[];window.nativeEvents=[];window.menuOpens=0;document.querySelectorAll('select').forEach(select=>{for(const type of ['input','change'])select.addEventListener(type,()=>events.push([select.id,type,select.value]));for(const type of ['pointerdown','mousedown','touchstart','touchend','click','keydown','focus'])select.addEventListener(type,event=>{if(event.isTrusted)nativeEvents.push([select.id,type])})});new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.matches?.('.app-select-menu'))menuOpens++}).observe(document.body,{childList:true});document.querySelector('#open-nested').onclick=()=>document.querySelector('#nested').showModal();document.querySelector('#close-nested').onclick=()=>document.querySelector('#nested').close();</script><script src="/cultivation/in-app-select.js"></script>`;
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(html);}if(url.pathname.startsWith('/qa-font/')){if(!process.env.SELECT_FONT_DIR){res.statusCode=204;return res.end();}const font=path.join(process.env.SELECT_FONT_DIR,url.pathname.slice('/qa-font/'.length));if(!font.startsWith(process.env.SELECT_FONT_DIR+path.sep)||!fs.existsSync(font)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',font.endsWith('.css')?'text/css':'font/woff2');return res.end(fs.readFileSync(font));}const file=path.join(root,url.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.SELECT_CHROMIUM?{executablePath:process.env.SELECT_CHROMIUM}: {})});
 try{
  for(const device of [{name:'desktop',viewport:{width:1280,height:800}},{name:'mobile',viewport:{width:393,height:852},isMobile:true,hasTouch:true},{name:'tablet',viewport:{width:768,height:1024},isMobile:true,hasTouch:true}]){
   const context=await browser.newContext(device),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.app-select-trigger');
   const trigger=id=>page.locator('#'+id+' + .app-select-trigger');
   const activate=async locator=>device.hasTouch?locator.tap():locator.click();
   const menu=page.locator('.app-select-menu');
   const open=async locator=>{const before=await page.evaluate(()=>menuOpens);await activate(locator);await menu.waitFor();assert.equal(await menu.count(),1);assert.equal(await page.evaluate(()=>menuOpens),before+1,'one menu per activation');};
   const choose=async label=>{await menu.getByRole('option',{name:label,exact:true}).click();await menu.waitFor({state:'detached'});};
   await open(trigger('mode'));await choose('自然');
   assert.equal(await page.locator('#mode').inputValue(),'b');assert.equal(await page.evaluate(()=>new FormData(document.querySelector('form')).get('mode')),'b');
   assert.deepEqual(await page.evaluate(()=>events),[['mode','input','b'],['mode','change','b']]);
   await open(trigger('mode'));await choose('自然');assert.equal(await page.evaluate(()=>events.length),2,'same value does not fire a second change');
   await open(page.locator('#external'));await page.keyboard.press('Escape');await menu.waitFor({state:'detached'});
   assert.equal(await page.evaluate(()=>document.activeElement.className),'app-select-trigger');
   await trigger('mode').focus();await page.keyboard.press('ArrowDown');await menu.waitFor();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await menu.waitFor({state:'detached'});assert.equal(await page.locator('#mode').inputValue(),'c');
   await page.locator('#reset').click();await page.waitForFunction(()=>document.querySelector('#mode + .app-select-trigger').getAttribute('aria-label').includes('數學'));assert.equal(await page.locator('#mode').inputValue(),'a');assert.match(await trigger('mode').getAttribute('aria-label'),/數學/);
   await open(trigger('payment'));await choose('契器券 · 持有 5');assert.equal(await page.locator('#payment').inputValue(),'ticket');
   assert.equal(await trigger('off').isDisabled(),true);assert.equal(await trigger('hidden').isVisible(),false);assert.equal(await trigger('css-hidden').isVisible(),false);
   await page.evaluate(()=>document.querySelector('#disabled').disabled=false);await trigger('off').waitFor();assert.equal(await trigger('off').isDisabled(),false);
   await page.evaluate(()=>document.querySelector('#dynamic').innerHTML='<label>動態選單<select id="added"><option>甲</option><option>乙</option></select></label>');
   await open(trigger('added'));await page.evaluate(()=>document.querySelector('#added').options[1].disabled=true);assert.equal(await menu.getByRole('option',{name:'乙',exact:true}).isDisabled(),true);await page.keyboard.press('Escape');
   await page.evaluate(()=>document.querySelector('#added').multiple=true);await page.waitForFunction(()=>!document.querySelector('#added').inert);assert.equal(await trigger('added').count(),0,'native list boxes retain their behavior');
   await page.evaluate(()=>document.querySelector('#added').multiple=false);await open(trigger('added'));await page.evaluate(()=>document.querySelector('#added').remove());await menu.waitFor({state:'detached'});
   await page.locator('#open-nested').click();await open(trigger('nested-select'));await choose('數量');assert.equal(await page.locator('#nested').evaluate(node=>node.open),true);await page.locator('#close-nested').click();
   await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
   const rects=await page.locator('#fixture select[inert]').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length).map(node=>{const a=node.getBoundingClientRect(),b=node.nextElementSibling.getBoundingClientRect();return [a.x,a.y,a.right,a.bottom,b.x,b.y,b.right,b.bottom]}));
   for(const [x,y,right,bottom,bx,by,br,bb] of rects){assert.ok(bx<=x+1&&by<=y+1&&br>=right-1&&bb>=bottom-1,'proxy covers native hit area');}
   assert.deepEqual(await page.evaluate(()=>nativeEvents),[],'trusted pointer, touch, keyboard and focus events never reach the native select');assert.deepEqual(errors,[]);
   await open(trigger('mode'));const bounds=await menu.boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=device.viewport.width+1&&bounds.y+bounds.height<=device.viewport.height+1,'menu stays within viewport');await page.screenshot({path:'/tmp/select-picker-'+device.name+'.png',fullPage:false});await page.keyboard.press('Escape');
   console.log(device.name+': passed one menu per click/tap, label and keyboard activation, input/change once, form/reset, disabled/hidden and dynamic controls, nested dialogs, no native activation, viewport bounds');await context.close();
  }
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});

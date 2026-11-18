#!/usr/bin/env node
'use strict';
// Local-only Chromium acceptance. No production Firebase, tickets or AI.
const assert=require('node:assert/strict');
const path=require('node:path');
const express=require('express');
const {generateDungeonLayout}=require('../dungeon-map-generator.cjs');
let playwright;try{playwright=require('playwright');}
catch(_){playwright=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');}
const app=express();app.use(express.json());
const map=generateDungeonLayout('stage6-browser-visual-1');
let room=null;const watchers=new Set(),requests=[];
const clone=x=>JSON.parse(JSON.stringify(x));
const publish=()=>{
  const payload='data: '+JSON.stringify({room:clone(room)})+'\n\n';
  for(const res of watchers)res.write(payload);
};
app.get('/dungeon-test.html',(_req,res)=>res.type('html').send(
  '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'+
  '<body style="margin:0;background:#132119"><div id="page-home">'+
  '<div class="xiuxian-quick-actions" style="width:310px;margin:20px auto"></div></div>'+
  '<script type="module" src="/cultivation/dungeon-lobby.js"></script></body></html>'
));
app.get('/cultivation/data/project-repository.js',(_req,res)=>res.type('text/javascript').send(
  "export const getMainUser=()=>({uid:sessionStorage.mockUid||'a'});"+
  "export const authenticatedMainFetch=(url,init={})=>fetch(url,{...init,headers:{...init.headers,'content-type':'application/json','x-test-user':getMainUser().uid}});"
));
app.post('/api/dungeon/room',(req,res)=>{
  const uid=req.get('x-test-user'),action=req.body.action;
  requests.push(action);
  const success=()=>res.json({ok:true,roomId:room?.id||null,room:room?clone(room):null});
  if(!['a','b'].includes(uid))return res.status(401).json({ok:false,error:'sign-in required'});
  if(action==='list-public')return res.json({ok:true,rooms:[]});
  if(action==='reconnect')return res.json({ok:true,roomId:room?.members?.[uid]?room.id:null,
    room:room?.members?.[uid]?clone(room):null});
  if(action==='create'){
    room={id:'dungroom000001',mode:'dungeon',version:1,revision:1,
      status:'waiting',visibility:'private',code:'ABCDEF',
      hostUid:uid,expiresAtMs:Date.now()+7200000,
      members:{[uid]:{uid,name:'修士甲',realm:'金丹',ready:false,
        joinedAtMs:1,heartbeatAtMs:Date.now()}}};
    return success();
  }
  if(action==='join-code'){
    if(!room||req.body.roomCode!=='ABCDEF')return res.status(409).json({ok:false,error:'invalid code'});
    room.members[uid]={uid,name:'修士乙',realm:'築基',ready:false,
      joinedAtMs:2,heartbeatAtMs:Date.now()};
    room.revision++;publish();return success();
  }
  if(!room?.members?.[uid])return res.status(403).json({ok:false,error:'non-member'});
  if(req.body.roomId&&room.id!==req.body.roomId)
    return res.status(404).json({ok:false,error:'unknown room'});
  if(action==='get-map')return res.json({ok:true,roomId:room.id,map:clone(map)});
  if(action==='get')return success();
  if(action==='heartbeat')return res.json({ok:true,roomId:room.id,revision:room.revision});
  if(action==='subscribe'){
    res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
    res.flushHeaders?.();
    watchers.add(res);
    res.write('data: '+JSON.stringify({room:clone(room)})+'\n\n');
    req.on('close',()=>watchers.delete(res));return;
  }
  if(action==='ready'){
    room.members[uid].ready=Boolean(req.body.ready);room.revision++;
    publish();return success();
  }
  if(action==='start'){
    if(uid!==room.hostUid||!Object.values(room.members).every(member=>member.ready))
      return res.status(409).json({ok:false,error:'not ready'});
    room.status='assembled';room.revision++;publish();return success();
  }
  res.status(400).json({ok:false,error:'unknown action'});
});
app.use(express.static(path.join(__dirname,'../public')));
async function main(){
  const server=await new Promise(resolve=>{
    const server=app.listen(0,'127.0.0.1',()=>resolve(server));
  });
  let browser;
  try{
    browser=await playwright.chromium.launch({headless:true,args:['--no-sandbox']});
    const errors=[];
    async function client(uid,viewport){
      const context=await browser.newContext({viewport,deviceScaleFactor:2});
      await context.addInitScript(name=>sessionStorage.mockUid=name,uid);
      const page=await context.newPage();
      page.on('pageerror',e=>errors.push(uid+': '+e.message));
      page.on('console',message=>{
        if(message.type()==='error')errors.push(uid+': console: '+message.text());
      });
      page.on('requestfailed',req=>errors.push(uid+': request: '+req.url()+' '+req.failure()?.errorText));
      page.on('response',response=>{
        if(response.status()>=400&&/\\.js(?:[?#]|$)/.test(response.url()))
          errors.push(uid+': HTTP '+response.status()+' '+response.url());
      });
      await page.goto('http://127.0.0.1:'+server.address().port+'/dungeon-test.html');
      try{
        await page.locator('#home-dungeon-entry').waitFor({timeout:8000});
      }catch(error){
        console.error('[Dungeon preview startup]',uid,errors,await page.evaluate(async()=>({
          state:document.readyState,
          host:document.querySelector('#page-home .xiuxian-quick-actions')?.outerHTML,
          entry:document.querySelector('#home-dungeon-entry')?.outerHTML,
          links:[...document.querySelectorAll('script')].map(node=>node.src),
          loaded:(await Promise.all(['/cultivation/dungeon-lobby.js',
            '/cultivation/dungeon-map-view.js','/cultivation/data/project-repository.js']
            .map(async url=>{const r=await fetch(url);return {url,status:r.status,
              type:r.headers.get('content-type'),head:(await r.text()).slice(0,140)};})))
        })));
        throw error;
      }
      await page.locator('#home-dungeon-entry').click();
      return {page,context};
    }
    const a=await client('a',{width:390,height:844});
    await a.page.locator('#dungeon-lobby [data-dg="create"]').click();
    await a.page.locator('#dungeon-lobby [data-dg="ready"]').waitFor();
    const b=await client('b',{width:990,height:570});
    await b.page.locator('#dungeon-lobby [data-dg-code]').fill('ABCDEF');
    await b.page.locator('#dungeon-lobby [data-dg="join-code"]').click();
    await b.page.locator('#dungeon-lobby [data-dg="ready"]').click();
    await a.page.locator('#dungeon-lobby [data-dg="ready"]').click();
    await a.page.locator('#dungeon-lobby [data-dg="assemble"]:not([disabled])').waitFor();
    await a.page.locator('#dungeon-lobby [data-dg="assemble"]').click();
    for(const {page} of [a,b]){
      await page.locator('#dungeon-map-view:not([hidden])').waitFor({timeout:10000});
      await page.locator('#dungeon-map-view [data-dm-biome-box]:not([hidden])').waitFor();
      const dims=await page.evaluate(()=>{
        const canvas=document.querySelector('.dm-world'),r=canvas.getBoundingClientRect();
        return {w:r.width,h:r.height,pixels:canvas.width,
          touch:getComputedStyle(canvas).touchAction,
          zoom:document.querySelector('[data-dm-zoom]').textContent};
      });
      assert.ok(dims.w>200&&dims.h>200,JSON.stringify(dims));
      assert.ok(dims.pixels>=dims.w*1.9,JSON.stringify(dims));
      assert.equal(dims.touch,'none');assert.equal(dims.zoom,'100%');
    }
    await a.page.locator('#dungeon-map-view [data-dm="plus"]').click();
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-zoom]').textContent==='135%');
    await a.page.locator('#dungeon-map-view [data-dm="route"]').click();
    assert.equal(await a.page.locator('[data-dm="route"]').getAttribute('aria-pressed'),'true');
    await a.page.locator('#dungeon-map-view [data-dm="fit"]').click();
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-zoom]').textContent==='100%');
    await a.page.evaluate(()=>{
      const canvas=document.querySelector('.dm-world'),r=canvas.getBoundingClientRect();
      const emit=(type,id,x)=>canvas.dispatchEvent(new PointerEvent(type,{
        bubbles:true,pointerType:'touch',pointerId:id,button:0,
        clientX:r.left+r.width*x,clientY:r.top+r.height*.5
      }));
      emit('pointerdown',1,.4);emit('pointerdown',2,.6);
      emit('pointermove',2,.8);emit('pointerup',1,.4);emit('pointerup',2,.8);
    });
    assert.ok(parseInt(await a.page.locator('[data-dm-zoom]').innerText(),10)>100);
    await a.page.locator('#dungeon-map-view [data-dm="focus"]').click();
    assert.equal(await a.page.locator('[data-dm="focus"]').getAttribute('aria-pressed'),'true');
    await a.page.locator('#dungeon-map-view [data-dm="close"]').click();
    await a.page.locator('#dungeon-map-view[hidden]').waitFor();
    await a.page.locator('#dungeon-lobby [data-dg="preview-map"]').click();
    await a.page.locator('#dungeon-map-view [data-dm-biome-box]:not([hidden])').waitFor();
    await a.page.setViewportSize({width:880,height:530});
    await a.page.waitForFunction(()=>{
      const canvas=document.querySelector('.dm-world'),r=canvas.getBoundingClientRect();
      return r.width>700&&r.height>300&&canvas.width>=r.width*1.9;
    });
    assert.deepStrictEqual(errors,[]);
    assert.ok(!requests.some(action=>/move|attack|reward|damage/.test(action)));
    await a.context.close();await b.context.close();
    console.log('[Dungeon map browser] PASS: two players, portrait/landscape, assembly, canvas, zoom, pinch, fit, follow, resize');
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});

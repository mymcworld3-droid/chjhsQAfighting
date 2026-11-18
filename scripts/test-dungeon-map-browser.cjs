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
    res.on('close',()=>watchers.delete(res));return;
  }
  if(action==='ready'){
    room.members[uid].ready=Boolean(req.body.ready);room.revision++;
    publish();return success();
  }
  if(action==='start'){
    if(uid!==room.hostUid||!Object.values(room.members).every(member=>member.ready))
      return res.status(409).json({ok:false,error:'not ready'});
    room.status='assembled';
    Object.values(room.members).sort((a,b)=>a.joinedAtMs-b.joinedAtMs)
      .forEach((member,i)=>{
        member.position={...map.spawnPads[i]};
        member.explorationStamina=100;member.moveSeq=0;member.lastMove=null;
      });
    room.revision++;publish();return success();
  }
  if(action==='move'){
    if(room.status!=='assembled')return res.status(409).json({ok:false,error:'not assembled'});
    const {dx,dy,step}=req.body,member=room.members[uid];
    if(!Number.isInteger(dx)||!Number.isInteger(dy)||Math.abs(dx)+Math.abs(dy)!==1)
      return res.status(400).json({ok:false,error:'invalid direction'});
    if(step===member.moveSeq&&member.lastMove?.dx===dx&&member.lastMove?.dy===dy)
      return success();
    if(!Number.isSafeInteger(step)||step!==member.moveSeq+1)
      return res.status(409).json({ok:false,error:'stale step'});
    const next={x:member.position.x+dx,y:member.position.y+dy};
    if(next.x<0||next.y<0||next.x>=map.width||next.y>=map.height||
       !map.tiles[next.y*map.width+next.x])
      return res.status(409).json({ok:false,error:'wall'});
    if(member.explorationStamina<1)return res.status(409).json({ok:false,error:'no energy'});
    member.position=next;member.explorationStamina--;member.moveSeq=step;
    member.lastMove={dx,dy,step};room.revision++;publish();
    return success();
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
    try{
      await b.page.locator('#dungeon-lobby [data-dg="ready"]').waitFor({timeout:6500});
    }catch(error){
      console.error('[Dungeon join diagnostics]',{requests,room,errors,
        browser:await b.page.evaluate(()=>({
          uid:sessionStorage.mockUid,
          notice:document.querySelector('[data-dg-notice]')?.textContent,
          body:document.querySelector('#dungeon-lobby [data-dg-body]')?.innerText,
          buttons:[...document.querySelectorAll('#dungeon-lobby button')]
            .map(node=>({label:node.textContent,disabled:node.disabled}))
        }))});
      throw error;
    }
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
    // Paint is intentionally deferred to requestAnimationFrame: wait for
    // the next frame rather than asserting a stale HUD value immediately.
    await a.page.waitForFunction(()=>parseInt(
      document.querySelector('[data-dm-zoom]')?.textContent||'0',10)>100,
      null,{timeout:5000});
    await a.page.locator('#dungeon-map-view [data-dm="focus"]').click();
    assert.equal(await a.page.locator('[data-dm="focus"]').getAttribute('aria-pressed'),'true');
    await a.page.locator('#dungeon-map-view [data-dm="close"]').click();
    await a.page.locator('#dungeon-map-view').waitFor({state:'hidden'});
    await a.page.locator('#dungeon-lobby [data-dg="preview-map"]').click();
    await a.page.locator('#dungeon-map-view [data-dm-biome-box]:not([hidden])').waitFor();
    await a.page.setViewportSize({width:880,height:530});
    await a.page.waitForFunction(()=>{
      const canvas=document.querySelector('.dm-world'),r=canvas.getBoundingClientRect();
      return r.width>700&&r.height>300&&canvas.width>=r.width*1.9;
    });
    // One move per player, each visible to both browsers through the same SSE.
    const names={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]};
    const moveFor=uid=>{
      const p=room.members[uid].position;
      return Object.entries(names).find(([,v])=>{
        const x=p.x+v[0],y=p.y+v[1];
        return x>=0&&y>=0&&x<map.width&&y<map.height&&
          map.tiles[y*map.width+x]!==0;
      })[0];
    };
    // Compare only the world canvas, not any status badges. This checks
    // that a's remote movement visibly reaches b's map via SSE.
    const canvasHash=()=>b.page.evaluate(()=>{
      const c=document.querySelector('#dungeon-map-view .dm-world');
      const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let h=2166136261;
      for(let i=0;i<d.length;i+=4){
        h^=d[i];h=Math.imul(h,16777619);
        h^=d[i+1];h=Math.imul(h,16777619);
        h^=d[i+2];h=Math.imul(h,16777619);
      }
      return h>>>0;
    });
    const beforeRemoteMove=await canvasHash();
    const firstMove=moveFor('a');
    await a.page.locator('#dungeon-map-view [data-dm="'+firstMove+'"]').click();
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-energy]')
      ?.textContent==='99 / 100');
    await b.page.waitForFunction(before=>{
      const c=document.querySelector('#dungeon-map-view .dm-world');
      const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let h=2166136261;
      for(let i=0;i<d.length;i+=4){
        h^=d[i];h=Math.imul(h,16777619);
        h^=d[i+1];h=Math.imul(h,16777619);
        h^=d[i+2];h=Math.imul(h,16777619);
      }
      return (h>>>0)!==before;
    },beforeRemoteMove,{timeout:7000});
    await b.page.waitForFunction(()=>document.querySelector('#dungeon-lobby .dg-room-status')
      ?.textContent.includes('已集結'));
    assert.equal(room.members.a.moveSeq,1);
    assert.equal(room.members.a.explorationStamina,99);
    assert.equal(room.members.b.moveSeq,0);
    const secondMove=moveFor('b');
    await b.page.locator('#dungeon-map-view [data-dm="'+secondMove+'"]').click();
    await b.page.waitForFunction(()=>document.querySelector('[data-dm-energy]')
      ?.textContent==='99 / 100');
    assert.equal(room.members.b.moveSeq,1);
    assert.equal(room.members.a.explorationStamina,99);
    assert.equal(room.members.b.explorationStamina,99);
    // Opening the modal focuses a button. WASD must work regardless of that
    // default focus and must still obey one-cell server validation.
    const nextMove=moveFor('a');
    const key={up:'w',right:'d',down:'s',left:'a'}[nextMove];
    await a.page.keyboard.press(key);
    await a.page.waitForFunction(()=>document.querySelector('[data-dm-energy]')
      ?.textContent==='98 / 100');
    assert.equal(room.members.a.moveSeq,2);
    assert.equal(room.members.a.explorationStamina,98);
    assert.deepStrictEqual(errors,[]);
    assert.equal(requests.filter(action=>action==='move').length,3);
    assert.ok(!requests.some(action=>/attack|reward|damage/.test(action)));
    await a.context.close();await b.context.close();
    console.log('[Dungeon map browser] PASS: two clients, 3 successful moves, remote canvas SSE repaint, WASD, stamina, pinch and resize');
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});

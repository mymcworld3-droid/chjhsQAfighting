/* Real world API, renderer and controls with isolated fixture identities/data.
 * Does not read credentials, authenticate real accounts or touch production. */
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
const output=path.resolve(process.env.LAYOUT_OUTPUT||'docs/design/grid-world');
const user={uid:'fixture',displayName:'青雲行者',storyProgressV1:{gender:'male'},stats:{totalScore:68,attack:200,maxHp:1000,gold:0},
  cultivationTraining:{equippedCore:{type:'xingchen',grade:3},coreEnabled:true},materialSystem:{inventory:{'qi-spirit-wood':4,'qi-spirit-iron':4}}};
const db=worldDb({'users/fixture':user,'users/peer':{...user,uid:'peer',displayName:'竹影道友',storyProgressV1:{gender:'female'}}});
const app=express();app.use(express.json());if(process.env.WORLD_FONT_DIR)app.use('/fixture-fonts',express.static(process.env.WORLD_FONT_DIR));
const service=register(app,{resolveA:()=>({db}),verify:async req=>{
  const uid=req.get('x-fixture-uid');if(!['fixture','peer'].includes(uid))throw Object.assign(Error('fixture identity required'),{status:401});return uid;
},generateQuestions:async b=>Q.fallback(b,{subject:'數學'})});
app.get('/fixture.html',(_req,res)=>res.type('html').send(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/world/world.css">${process.env.WORLD_FONT_DIR?'<link rel="stylesheet" href="/fixture-fonts/400.css"><link rel="stylesheet" href="/fixture-fonts/500.css">':''}<style>html,body{margin:0;height:100%;background:#14281f;font-family:sans-serif}button{font:inherit}main{height:100%}</style></head><body><main><section id="page-world" class="page-section active-page"></section></main><script type="module">
import {WorldView} from '/world/world-view.js';import {createWorldTransport} from '/world/world-transport.js';
const uid=new URLSearchParams(location.search).get('identity')==='peer'?'peer':'fixture';
const transport=createWorldTransport((url,init)=>fetch(url,{...init,headers:{'Content-Type':'application/json','x-fixture-uid':uid}}));
window.fixtureView=new WorldView(document.getElementById('page-world'),{api:transport.request,subscribe:transport.subscribe,uid,confirm:async()=>true,openEntry:(entry)=>{window.fixtureEntry=entry;}});await window.fixtureView.start();
</script></body></html>`));
app.use(express.static(path.join(__dirname,'../public')));
async function main(){
  await fs.mkdir(output,{recursive:true});const server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.WORLD_CHROMIUM_PATH?{executablePath:process.env.WORLD_CHROMIUM_PATH}:{} )});const results=[];
  const call=async(action,payload={},uid='fixture')=>{
    const r=await fetch(origin+'/api/world',{method:'POST',headers:{'Content-Type':'application/json','x-fixture-uid':uid},body:JSON.stringify({action,...payload})});const out=await r.json();if(!out.ok)throw Error(out.error);return out;
  };
  try{
    const peer=await browser.newPage({viewport:{width:800,height:600}});await peer.goto(origin+'/fixture.html?identity=peer');
    await peer.waitForFunction(()=>window.fixtureView?.online);
    for(const size of [{name:'desktop',width:1440,height:900},{name:'phone',width:390,height:844},{name:'tablet',width:1194,height:834},{name:'phone-frame',width:360,height:640},{name:'landscape-frame',width:1280,height:720}]){
      const page=await browser.newPage({viewport:size,deviceScaleFactor:1,isMobile:size.name==='phone',hasTouch:size.name==='phone'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin+'/fixture.html');await page.waitForFunction(()=>window.fixtureView?.state?.position&&window.fixtureView.online);
      await page.waitForFunction(()=>Object.values(window.fixtureView.renderer.images).every(i=>i.complete&&i.naturalWidth));
      await page.evaluate(()=>document.fonts.ready);
      await page.waitForFunction(()=>window.fixtureView.players.some(p=>p.uid==='peer'));
      const pick=async target=>{
        const p=await page.evaluate(target=>{const v=window.fixtureView,r=v.renderer,rect=r.canvas.getBoundingClientRect(),s=40*r.camera.zoom;return{x:rect.left+r.width/2+(target.x+.5-r.camera.x)*s,y:rect.top+r.height/2+(target.y+.5-r.camera.y)*s};},target);
        await page.mouse.click(p.x,p.y);
      };
      await pick({x:10,y:36});await page.waitForFunction(()=>window.fixtureView.players.find(p=>p.uid==='fixture')?.route.path.at(-1).x===10);
      await page.waitForFunction(()=>!QAGridWorld.sample(window.fixtureView.players.find(p=>p.uid==='fixture').route,window.fixtureView.now()).moving);
      await page.screenshot({path:path.join(output,`${size.name}-exploration.png`)});
      await page.locator('.ww-bottom [data-action="quest"]').click();await page.locator('[data-action="navigate"][data-step="1"]').click();
      await page.waitForFunction(()=>window.fixtureView.players.find(p=>p.uid==='fixture').route.path.length>1);
      await page.waitForFunction(()=>!QAGridWorld.sample(window.fixtureView.players.find(p=>p.uid==='fixture').route,window.fixtureView.now()).moving);
      const fogStop=await page.evaluate(()=>({position:window.fixtureView.state.position,explored:window.fixtureView.state.explored}));assert.notDeepEqual(fogStop.position,{x:12,y:26});
      // Restart at a legitimate encounter fixture to inspect battle UI and actual click controls.
      await page.evaluate(()=>window.fixtureView.suspend());
      service.hub.actors.delete('fixture');
      db.docs.set('worldPlayers/fixture',{...register.__test.normalize(),position:{x:18,y:23},mapVersion:W.VERSION,explored:W.reveal(W.initialExplored(),{x:18,y:23},9)});
      await page.evaluate(()=>window.fixtureView.start());await page.waitForFunction(()=>window.fixtureView.state.position.x===18&&window.fixtureView.state.position.y===23);
      await page.waitForFunction(()=>window.fixtureView.renderer.camera.x===18.5&&window.fixtureView.renderer.camera.y===23.5);
      await pick(W.object('wolf'));await page.locator('[data-action="interact"]').click();
      await page.waitForFunction(()=>window.fixtureView.state.battle?.questions?.length===2);
      await page.screenshot({path:path.join(output,`${size.name}-recharge.png`)});
      const correct=db.docs.get('worldPlayers/fixture').battle.questions[0].answerIndex;
      await page.locator(`.ww-panel [data-action="answer"][data-choice="${correct}"]`).click();
      await page.waitForFunction(()=>window.fixtureView.state.battle.answered===1&&window.fixtureView.state.battle.player.mana===2);
      await page.locator('.ww-panel [data-action="close"]').click();await page.locator('.ww-bottom [data-action="recharge"]').click();
      await page.locator('.ww-panel [data-action="skip"]').click();await page.waitForFunction(()=>window.fixtureView.state.battle?.phase==='command');
      await page.screenshot({path:path.join(output,`${size.name}-battle.png`)});
      const b=await page.evaluate(()=>window.fixtureView.state.battle),safe=b.reachable.find(p=>p.x!==b.player.x||p.y!==b.player.y);
      await pick(safe);await page.locator('[data-action="confirm-move"]').click();await page.waitForFunction(()=>window.fixtureView.state.battle.moved);
      await page.locator('.ww-bottom [data-action="guard"]').click();await page.waitForFunction(()=>window.fixtureView.state.battle.acted);
      await page.locator('.ww-bottom [data-action="end"]').click();await page.waitForFunction(()=>window.fixtureView.state.battle.turn===2);
      // Persisted turn recovery also uses the real join endpoint.
      await page.reload();await page.waitForFunction(()=>window.fixtureView.state?.battle?.turn===2);
      const layout=await page.evaluate(()=>{const p=document.getElementById('page-world'),buttons=[...p.querySelectorAll('button')].filter(b=>b.getClientRects().length);
        return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,height:innerHeight,
          root:p.getBoundingClientRect().toJSON(),overflowButtons:buttons.filter(b=>{const r=b.getBoundingClientRect();return r.left<-.5||r.right>innerWidth+.5||r.bottom>innerHeight+.5;}).map(b=>b.textContent)};});
      assert.equal(layout.documentWidth,layout.width);assert.equal(layout.documentHeight,layout.height);assert.deepEqual(layout.overflowButtons,[]);assert.deepEqual(errors,[]);
      results.push({viewport:size.name,...layout,checks:['two-live-browsers','point-and-walk','fog-frontier','encounter','two-question-recharge','answer-and-save','close-and-resume-recharge','confirmed-two-tile-move','guard-after-move','next-turn','reload-recovery']});
      await page.evaluate(()=>window.fixtureView.suspend());await page.close();service.hub.actors.delete('fixture');db.docs.delete('worldPlayers/fixture');
    }
    await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
  }finally{await browser.close();service.close();server.closeAllConnections();server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

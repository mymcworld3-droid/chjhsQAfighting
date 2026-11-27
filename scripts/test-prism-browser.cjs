#!/usr/bin/env node
'use strict';
// Real Chromium canvas acceptance for private weapons; no unlock, live
// accounts, production API or database is involved.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const {chromium}=require('playwright');
const R=require('../public/cultivation/tactical-rules.js');
const D=require('../public/cultivation/new-weapon-drafts.js');
const W=require('../public/cultivation/weapon-effects.js');
const A=require('../public/cultivation/tactical-animation.js');
const C=require('../public/cultivation/dungeon-skill-resolution.js');
const p=(x,y)=>({x,y});
const blocks=[p(3,1),p(12,3),p(4,4),p(7,4),p(13,4),p(3,6),p(11,7),p(6,8),p(7,10),p(6,11),p(13,11)];
const origin=p(7,7),target=p(8,7);
const map={width:15,height:15,biome:'ruins',layoutId:'prism-browser',tiles:Array(225).fill(1)};
for(const b of blocks)map.tiles[b.y*15+b.x]=0;
const fixtures=['prism-slash','prism-reflect','prism-scatter'].map((id,index)=>{
  const skill=D.skillAtLevel(id,1,0);
  const state=R.create({id:'prism-browser-'+id,mode:'pve',players:[{uid:'u',name:'青雲修士',atk:100,maxHp:10000,manualSkills:[]}],now:2000000000000});
  Object.assign(state,{width:15,height:15,blocks,ground:Array(225).fill(0),objective:null,events:[],revision:1});
  Object.assign(state.actors[0],{...origin,atk:100,stamina:10});
  Object.assign(state.actors[1],{x:9,y:7,hp:10000,maxHp:10000,shield:0,guard:0,counter:0});
  const original=JSON.stringify(state),out=R.previewCast(state,state.actors[0],skill,target);
  assert.equal(JSON.stringify(state),original);
  const timeline=W.normalize(out.weaponTimeline);assert.ok(timeline);
  if(id==='prism-scatter')assert.equal(timeline.segments.length,21);
  const changes=state.actors.map(a=>({...a,hp:a.hp-timeline.segments.flatMap(s=>s.hits).filter(h=>h.uid===a.uid).reduce((sum,h)=>sum+h.damage,0)}));
  const next={...state,actors:changes,revision:2,events:[{id:'2:1',actor:'u',type:'cast',skill:id,
    animation:{kind:'cast',style:id,origin,target,cells:out.cells,weaponTimeline:timeline,changes}}]};
  const scenes=A.plan(state,next,'u');assert.equal(scenes.length,1);
  const room={id:'prism-browser-room',dungeonArena:'exploration',status:'assembled',battleAppliedTick:0,
    members:{u:{uid:'u',position:origin,battleHealth:10000,battleMaxHealth:10000,explorationStamina:10,dungeonSkills:[skill]}},
    enemies:[{id:'e',kind:'wolf',position:p(9,7),battleHealth:10000,battleMaxHealth:10000}]};
  const result=C.resolveCast(room,'u',map,skill,{target,seq:index+1,base:100});
  assert.ok(W.normalize(result.result.weaponTimeline));
  assert.equal(result.result.totalDamage,result.result.weaponTimeline.segments.flatMap(s=>s.hits).reduce((sum,h)=>sum+h.damage,0));
  return {id,state,scene:scenes[0],room,nextRoom:{...room,members:result.members,enemies:result.enemies},duration:timeline.durationMs};
});
// Bell uses the same real renderers, but its positions and numbers are
// sourced from the four sequential committed hits rather than a ray tree.
for(const id of ['bell-strike','bell-shock','bell-echo']){
  const skill=D.skillAtLevel(id,1,0),aim=id==='bell-strike'?p(8,7):origin;
  const state=R.create({id:'bell-browser-'+id,mode:'pve',players:[{uid:'u',name:'青雲修士',atk:100,maxHp:10000,manualSkills:[]}],now:2000000000000});
  Object.assign(state,{width:15,height:15,blocks:[],ground:Array(225).fill(0),objective:null,events:[],revision:1,actors:state.actors.slice(0,2)});
  Object.assign(state.actors[0],{...origin,atk:100,stamina:10});
  Object.assign(state.actors[1],{x:8,y:7,hp:10000,maxHp:10000,shield:0,guard:0,counter:0,boss:false,footprint:{width:1,height:1}});
  const out=R.previewCast(state,state.actors[0],skill,aim),timeline=W.normalize(out.weaponTimeline);assert.ok(timeline);
  if(id==='bell-echo')assert.equal(timeline.segments.length,4);
  const changes=state.actors.map(a=>({...a,hp:a.hp-timeline.segments.flatMap(s=>s.hits).filter(h=>h.uid===a.uid).reduce((n,h)=>n+h.damage,0),...out.finalPositions.find(p=>p.uid===a.uid)}));
  const next={...state,actors:changes,revision:2,events:[{id:'2:1',actor:'u',type:'cast',skill:id,animation:{kind:'cast',style:id,origin,target:aim,cells:out.cells,weaponTimeline:timeline,changes}}]};
  const scenes=A.plan(state,next,'u');assert.equal(scenes.length,1);
  const room={id:'bell-browser-room',dungeonArena:'exploration',status:'assembled',battleAppliedTick:0,
    members:{u:{uid:'u',position:origin,battleHealth:10000,battleMaxHealth:10000,explorationStamina:10,dungeonSkills:[skill]}},
    enemies:[{id:'e',kind:'wolf',position:p(8,7),battleHealth:10000,battleMaxHealth:10000}]};
  // Use the normal irregular map for both dungeon painter and resolver.
  const result=C.resolveCast(room,'u',map,skill,{target:aim,seq:1,base:100});
  assert.ok(W.normalize(result.result.weaponTimeline));assert.equal(result.result.totalDamage,result.result.weaponTimeline.segments.flatMap(s=>s.hits).reduce((n,h)=>n+h.damage,0));
  fixtures.push({id,state,scene:scenes[0],room,nextRoom:{...room,members:result.members,enemies:result.enemies},duration:timeline.durationMs});
}
// Private weave fixtures use the same committed resolver and painters.
const O=require('../public/cultivation/weapon-special-objects.js');
const weaveBoard={width:15,height:15,blocked:q=>map.tiles[q.y*15+q.x]===0};
const marks=[p(8,7),p(10,5),p(10,9)].reduce((state,position,i)=>O.add(state,{type:'mark',ownerUid:'u',position,board:weaveBoard,generatedAt:i}),undefined);
for(const [id,aim,first,enemy] of [
  ['weave-mark',p(8,7),null,p(9,7)],['weave-thread',p(10,9),p(10,5),p(10,7)],['weave-domain',origin,null,p(9,7)]]){
  const skill=D.skillAtLevel(id,1,0);
  const state=R.create({id:'weave-browser-'+id,mode:'pve',players:[{uid:'u',name:'青雲修士',atk:100,maxHp:10000,manualSkills:[]}],now:2000000000000});
  Object.assign(state,{width:15,height:15,blocks,ground:Array(225).fill(0),objective:null,events:[],revision:1,actors:state.actors.slice(0,2),weaponObjects:marks});
  Object.assign(state.actors[0],{...origin,atk:100,stamina:10});
  Object.assign(state.actors[1],{...enemy,hp:10000,maxHp:10000,shield:0,guard:0,counter:0,boss:false,footprint:{width:1,height:1}});
  const out=R.previewCast(state,state.actors[0],skill,aim,first),timeline=W.normalize(out.weaponTimeline);assert.ok(timeline);
  const changes=state.actors.map(a=>({...a,hp:a.hp-timeline.segments.flatMap(s=>s.hits).filter(h=>h.uid===a.uid).reduce((n,h)=>n+h.damage,0)}));
  const next={...state,actors:changes,weaponObjects:out.weaponObjects,revision:2,events:[{id:'2:1',actor:'u',type:'cast',skill:id,animation:{kind:'cast',style:id,origin,target:aim,cells:out.cells,weaponTimeline:timeline,changes}}]};
  const scenes=A.plan(state,next,'u');assert.equal(scenes.length,1);
  const room={id:'weave-browser-room',dungeonArena:'exploration',status:'assembled',battleAppliedTick:0,weaponObjects:marks,
    members:{u:{uid:'u',position:origin,battleHealth:10000,battleMaxHealth:10000,explorationStamina:10,dungeonSkills:[skill]}},
    enemies:[{id:'e',kind:'wolf',position:enemy,battleHealth:10000,battleMaxHealth:10000}]};
  const result=C.resolveCast(room,'u',map,skill,{target:aim,first,seq:1,base:100});
  assert.ok(W.normalize(result.result.weaponTimeline));
  assert.equal(result.result.totalDamage,result.result.weaponTimeline.segments.flatMap(s=>s.hits).reduce((n,h)=>n+h.damage,0));
  assert.deepEqual(result.weaponObjects,marks);
  fixtures.push({id,state,scene:scenes[0],room,nextRoom:{...room,members:result.members,enemies:result.enemies,weaponObjects:result.weaponObjects},duration:timeline.durationMs,
    ...(id==='weave-thread'?{endpointPlan:R.skillPreviewPlan(state,state.actors[0],skill),first,aim}:{})});
}
async function main(){
  const output=path.resolve(process.argv[2]||'/tmp/prism-browser');fs.mkdirSync(output,{recursive:true});
  const app=express();
  app.get('/prism-test',(_req,res)=>res.type('html').send('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#17261d}canvas{display:block;width:100vw;height:100vh}</style><canvas id="battle"></canvas>'));
  app.use(express.static(path.join(__dirname,'../public')));
  const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);});
  let browser;
  try{
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,hasTouch:true});
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto('http://127.0.0.1:'+server.address().port+'/prism-test');
    await page.evaluate(async()=>{
      const {TacticalRenderer}=await import('/cultivation/tactical-renderer.js');
      const dungeon=await import('/cultivation/dungeon-skill-animation.js');
      const {drawWorld}=await import('/cultivation/dungeon-map-painter.js');
      const {initialCamera}=await import('/cultivation/dungeon-map-camera.js');
      const canvas=document.querySelector('canvas'),renderer=new TacticalRenderer(canvas,()=>{});
      window.prismTest={renderer,dungeon,drawWorld,initialCamera,canvas};
    });
    for(const viewport of [{width:390,height:844},{width:844,height:390},{width:768,height:1024},{width:1280,height:800}]){
      await page.setViewportSize(viewport);
      for(const reduced of [false,true]){
        await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
        for(const fixture of fixtures){
          const report=await page.evaluate(async({fixture,map,reduced})=>{
            const {renderer,dungeon,drawWorld,initialCamera,canvas}=window.prismTest;
            const W=window.QAWeaponEffects,F=window.QATacticalSkillEffects;
            const check=(value,label)=>{if(!value)throw new Error(label)};
            const scene=fixture.scene,t=scene.weaponTimeline;
            const ds=dungeon.dungeonAnimationEvents(fixture.room,fixture.nextRoom);
            check(ds.length===1&&ds[0].scene.weaponTimeline,'dungeon committed scene missing');
            check(dungeon.dungeonAnimationEvents(fixture.nextRoom,fixture.nextRoom).length===0,'duplicate skill replay');
            const dungeonScene=ds[0].scene;
            const beats=[...new Set(t.segments.map(s=>s.impact))];
            const first=t.segments.find(s=>s.hits.some(h=>h.damage||h.absorbed))?.impact;
            check(first!==undefined&&W.numberFrames(t,(first-1)/t.durationMs).length===0,'damage before committed impact');
            for(const ms of beats)check(W.active(t,ms/t.durationMs).length>0,'missing impact frame');
            // Draw real battle frames with the real actor/sprite renderer.
            const orders=[],originalEffect=renderer.drawEffect,originalSprite=renderer.sprite;
            renderer.drawEffect=function(s,q,above){orders.push(above?'above':'below');return originalEffect.call(this,s,q,above)};
            renderer.sprite=function(id,...args){if(['male','female','monsters'].includes(id))orders.push('actor');return originalSprite.call(this,id,...args)};
            let worst=0,frames=0;
            try{
              for(let ms=0;ms<fixture.duration;ms+=16){
                orders.length=0;
                const start=performance.now();
                renderer.present(fixture.state,'u',scene,ms/fixture.duration);
                worst=Math.max(worst,performance.now()-start);frames++;
                check(orders.indexOf('below')>=0&&orders.indexOf('actor')>orders.indexOf('below')&&orders.lastIndexOf('above')>orders.lastIndexOf('actor'),'trial layer order');
                await new Promise(requestAnimationFrame);
              }
            }finally{renderer.drawEffect=originalEffect;renderer.sprite=originalSprite;}
            // The second actual painter consumes the same committed V2 event.
            const ctx=canvas.getContext('2d'),w=canvas.clientWidth,h=canvas.clientHeight;
            canvas.width=w;canvas.height=h;
            let under=0,over=0;
            const render=(q)=>drawWorld(ctx,map,initialCamera(),w,h,{
              members:Object.values(fixture.room.members),enemies:fixture.room.enemies,selfUid:'u',reducedMotion:reduced,
              animationUnderlay:(c,v)=>{under++;if(fixture.room.weaponObjects)W.drawObjects(c,fixture.room.weaponObjects,[],{...v,width:map.width,height:map.height},q*fixture.duration,{reduced});check(dungeon.paintDungeonScene(c,{...dungeonScene,reducedMotion:reduced},q,v,false,F),'dungeon underlay')},
              animationOverlay:(c,v)=>{over++;check(dungeon.paintDungeonScene(c,{...dungeonScene,reducedMotion:reduced},q,v,true,F),'dungeon overlay');dungeon.drawDungeonHitNumbers(c,dungeonScene,q,v)}
            });
            for(const ms of [0,...beats,Math.floor(fixture.duration*.8)])render(ms/fixture.duration);
            check(under===over&&under>0,'dungeon paint passes');
            const image=ctx.getImageData(0,0,w,h).data;
            check(image.some((v,i)=>i%4===3&&v>0),'empty canvas');
            // CI machines are shared; report real draw cost rather than imposing
            // a device-specific FPS guarantee. An extreme stall is a failure.
            check(worst<500,'single frame stalled over 500ms');
            return {frames,worstMs:Math.round(worst*10)/10,beats,segments:t.segments.length};
          },{fixture,map,reduced});
          console.log(fixture.id,viewport,reduced?'reduced':'normal',report);
          await page.locator('canvas').screenshot({path:path.join(output,fixture.id+'-'+viewport.width+'x'+viewport.height+'-'+(reduced?'reduced':'normal')+'.png')});
        }
      }
    }
    // Actual touch taps through the trial renderer's existing canvas event
    // handler, with private preview data supplied only in this test harness.
    const fixture=fixtures.find(f=>f.id==='weave-thread');
    for(const viewport of [{width:390,height:844},{width:768,height:1024}]){
      await page.setViewportSize(viewport);
      const coords=await page.evaluate(async fixture=>{
        const {renderer,canvas}=window.prismTest;
        const cameraModule=await import('/cultivation/tactical-camera.js');
        const Camera=window.QATacticalCamera,Q=window.QAWeaveRules;
        renderer.preview=null;renderer.queue=[];renderer.scene=null;renderer.state=fixture.state;
        renderer.uid='u';renderer.mode='demo';renderer.camera=Camera.create();
        window.weaveTap={selection:null,confirm:0};
        renderer.onSelect=tile=>{
          const picked=Q.choose(fixture.endpointPlan,window.weaveTap.selection,tile);
          window.weaveTap.selection=picked.selection;
          if(picked.confirm)window.weaveTap.confirm++;
        };
        renderer.draw();
        const rect=canvas.getBoundingClientRect(),g=Camera.geometry(renderer.camera,rect.width,rect.height,{x:0,y:0,width:fixture.state.width,height:fixture.state.height});
        return [fixture.first,fixture.aim].map(p=>({x:rect.left+g.ox+(p.x+.5)*g.cell,y:rect.top+g.oy+(p.y+.5)*g.cell}));
      },fixture);
      const tap=async i=>page.touchscreen.tap(coords[i].x,coords[i].y);
      await tap(0);assert.equal(await page.evaluate(()=>window.weaveTap.selection?.choosing),true);
      await tap(0);assert.equal(await page.evaluate(()=>window.weaveTap.selection),null);
      assert.equal(await page.evaluate(()=>window.weaveTap.confirm),0);
      await tap(0);await tap(1);assert.equal(await page.evaluate(()=>window.weaveTap.selection?.choosing),false);
      assert.equal(await page.evaluate(()=>window.weaveTap.confirm),1);
    }
    // Real browser audio decoding and the existing single-context manager.
    await page.evaluate(async()=>{
      await import('/game-audio.js');
      window.QAGameAudio.setPreferences({enabled:true,volume:.35});
      const button=document.createElement('button');
      button.id='audio-unlock';button.textContent='Test audio';
      Object.assign(button.style,{position:'fixed',top:'0',left:'0',zIndex:100});
      button.addEventListener('click',()=>{window.prismAudioReady=window.QAGameAudio.unlock()});
      document.body.append(button);
    });
    await page.locator('#audio-unlock').click();
    const audio=await page.evaluate(async()=>{
      const A=window.QAGameAudio,W=window.QAWeaponEffects;
      const check=(value,label)=>{if(!value)throw new Error(label)};
      check(await window.prismAudioReady,'audio context unlock');
      await A.preload(['prism-sword','prism-crystal','prism-split']);
      check(A.diagnostics().failed.length===0,'MP3 decode failure');
      check(A.diagnostics().decoded>=3,'three decoded cues');
      // Separate real playback requests by more than the combat cooldown.
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      await wait(300);
      const before=A.diagnostics().played;
      for(const id of ['prism-sword','prism-crystal','prism-split']){
        check(A.play(id,{key:'browser:'+id}),'cue rejected: '+id);
        await wait(220);
      }
      const result=A.diagnostics();
      check(result.played===before+3,'three real cues played');
      check(result.peakVoices<=2&&result.pending===null,'audio backlog/overlap');
      check(!A.play('prism-sword',{key:'browser:prism-sword'}),'duplicate replay');
      A.setPreferences({enabled:false});
      check(!A.play('prism-split',{key:'muted'}),'mute ignored');
      check(A.diagnostics().voices===0,'mute left live sources');
      A.setPreferences({enabled:true});
      await A.preload(['bell-wave']);
      check(A.diagnostics().failed.length===0,'bell MP3 decode failure');
      const bellStart=A.diagnostics().played;
      await wait(300);
      for(let i=0;i<4;i++){
        check(A.play('bell-wave',{key:'browser:bell:'+i,rate:1.08-i*.10}),'bell cue rejected');
        await wait(135);
      }
      const bellResult=A.diagnostics();
      check(bellResult.played===bellStart+4&&bellResult.peakVoices<=2,'four bell cues with bounded sources');
      await wait(300);await A.preload(['weave-thread','weave-domain']);
      check(A.diagnostics().failed.length===0,'weave MP3 decode failure');
      const weaveStart=A.diagnostics().played;
      for(const id of ['weave-thread','weave-domain']){
        check(A.play(id,{key:'browser:'+id}),'weave cue rejected');
        await wait(250);
      }
      const weaveResult=A.diagnostics();
      check(weaveResult.played===weaveStart+2&&weaveResult.peakVoices<=2,'weave playback count');
      A.dispose();document.getElementById('audio-unlock').remove();
      return {...result,bellPlayed:bellResult.played-bellStart,bellPeakVoices:bellResult.peakVoices,weavePlayed:weaveResult.played-weaveStart};
    });
    console.log('Prism real Chromium audio acceptance',audio);
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>window.prismTest.renderer.destroy());
    console.log('Prism Chromium acceptance passed');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

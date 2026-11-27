/* Deterministic, decorative-only battlefield ambience.
 * Does not inspect hidden enemy state, alter collision, targeting, or server actions.
 * All coordinates are visual units; callers own camera and gameplay layers.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QATacticalAmbience=api;
})(globalThis,()=>{
  'use strict';
  const TAU=Math.PI*2;
  const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
  const themes=Object.freeze({
    stone:Object.freeze({label:'石域',ink:'rgba(210,213,213,.2)',detail:'rgba(80,85,90,.27)',glow:'rgba(204,211,216,.055)',mote:'#c4c9cc',wind:.035}),
    bamboo:Object.freeze({label:'竹林',ink:'rgba(174,218,159,.28)',detail:'rgba(53,89,55,.34)',glow:'rgba(178,215,142,.09)',mote:'#b9df98',wind:.09}),
    desert:Object.freeze({label:'荒漠',ink:'rgba(228,196,137,.25)',detail:'rgba(94,75,50,.32)',glow:'rgba(241,197,113,.085)',mote:'#e5cf9b',wind:.15}),
    snow:Object.freeze({label:'雪嶺',ink:'rgba(215,237,242,.37)',detail:'rgba(94,133,147,.28)',glow:'rgba(203,235,253,.085)',mote:'#f2fbff',wind:.07}),
    water:Object.freeze({label:'碧水',ink:'rgba(142,220,202,.26)',detail:'rgba(43,99,88,.28)',glow:'rgba(135,225,199,.085)',mote:'#9adfd3',wind:.045}),
    ruins:Object.freeze({label:'遺墟',ink:'rgba(212,192,144,.25)',detail:'rgba(80,77,66,.32)',glow:'rgba(196,167,117,.075)',mote:'#d4c49d',wind:.035})
  });
  function themeFor(state){
    if(state?.weaponDungeon&&(state.weaponDungeon.id||'peak-stone')==='peak-stone')return 'stone';
    const name=String(state?.trial?.biome||state?.trial?.title||'');
    const terrain=Number(state?.terrain);
    if(/雪|霜|冰/.test(name)||terrain===14)return 'snow';
    if(/荒|沙|漠|熔|焰/.test(name)||terrain===13)return 'desert';
    if(/古陣|遺墟|殘垣|廟|石窟/.test(name)||terrain===16)return 'ruins';
    if(/竹|林|溪|谷/.test(name)||terrain===0)return 'bamboo';
    if(/海|水|潮|庭苑/.test(name)||terrain===2)return 'water';
    return 'ruins';
  }
  function hash(value){
    let h=2166136261;
    for(const char of String(value)){h^=char.charCodeAt(0);h=Math.imul(h,16777619);}
    return h>>>0;
  }
  // The room ID stays the same when progressing to the next stage.
  // Keep the stage identity independent of live HP, turns and actor motion.
  function stageIdentity(state){
    const trial=state?.trial||{};
    return [String(state?.id||''),String(state?.mode||''),
      String(trial.layoutHash||''),String(trial.seed||''),
      String(trial.stage??''),String(trial.layoutVersion??'')].join('|');
  }
  function mapIdentity(state){
    if(!state)return '';
    const terrain=(state.ground||[]).join(',');
    const blocks=(state.blocks||[]).map(b=>[b.x,b.y,b.kind||''].join(':')).sort().join(';');
    return [stageIdentity(state),state.width,state.height,state.terrain,
      state.trial?.biome||'',state.trial?.title||'',terrain,blocks].join('|');
  }
  // Cap offscreen backing pixels without changing the visible CSS stage,
  // camera hit tests, or the game's fixed portrait/landscape aspect ratio.
  function pixelRatioFor(width,height,deviceRatio=1,memoryGB=null){
    const pixels=Math.max(1,Number(width)||1)*Math.max(1,Number(height)||1);
    const ratio=clamp(Number(deviceRatio)||1,1,3);
    const budget=Number(memoryGB)>0&&Number(memoryGB)<=4?2200000:3300000;
    return clamp(Math.min(ratio,Math.sqrt(budget/pixels)),1,3);
  }
  function random(seed){
    let h=seed>>>0;
    return ()=>{h+=0x6D2B79F5;let t=Math.imul(h^(h>>>15),1|h);
      t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};
  }
  function prepare(state){
    const width=clamp(Math.floor(Number(state?.width)||1),1,25);
    const height=clamp(Math.floor(Number(state?.height)||1),1,25);
    const theme=themeFor(state);
    const seed=hash(String(state?.trial?.layoutHash||state?.trial?.seed||state?.id||'battle')+
      '|'+width+'x'+height+'|'+theme);
    const rand=random(seed);
    const details=[],motes=[],lamps=[];
    const blocked=new Set((state?.blocks||[]).map(b=>b.x+','+b.y));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const v=rand(),u=rand(),a=rand(),r=rand();
      const water=(state?.ground?.[y*width+x]===4);
      if(blocked.has(x+','+y)&&!water)continue;
      if(v<.7||water)details.push({
        x,y,u:.16+u*.65,v:.19+a*.62,angle:r*TAU,
        size:.10+rand()*.14,kind:water?'ripple':theme
      });
      if(theme==='ruins'&&(x+y)%7===2&&a>.65)lamps.push({x:x+.5,y:y+.5,phase:r*TAU});
    }
    const count=Math.min(22,Math.max(7,Math.floor(width*height*.13)));
    for(let i=0;i<count;i++)motes.push({
      x:rand()*width,y:rand()*height,phase:rand()*TAU,
      speed:.4+rand()*.95,size:.8+rand()*1.3,depth:rand()
    });
    return Object.freeze({id:String(state?.id||''),key:mapIdentity(state),width,height,theme,seed,
      details:Object.freeze(details),motes:Object.freeze(motes),
      lamps:Object.freeze(lamps)});
  }
  function idlePose(actor,time=0,reduced=false){
    if(reduced||!actor||actor.hp<=0)return {dx:0,dy:0,sx:1,sy:1};
    const species=Number(actor.species);
    const phase=hash(String(actor.uid||actor.name||'actor'))%6283/1000;
    const t=Number.isFinite(time)?time/1000:0;
    const boss=!!actor.boss;
    // Motion amplitudes are <0.045 tile and never affect hit tests or selection.
    let frequency=1.4,dx=0,dy=0,sx=1,sy=1;
    if(actor.bot){
      if([3,4,13].includes(species)){frequency=1.2;dx=.026*Math.sin(t*frequency+phase);sy=1+.015*Math.sin(t*frequency+phase);}
      else if(species===12){frequency=2.2;dy=-.035*(.5+.5*Math.sin(t*frequency+phase));sx=1+.013*Math.sin(t*frequency+phase);}
      else if([5,6].includes(species)){frequency=.85;dx=.019*Math.sin(t*frequency+phase);sy=1+.024*Math.sin(t*frequency+phase);}
      else if([1,8,9,17].includes(species)||boss){frequency=.75;sy=1+.014*Math.sin(t*frequency+phase);sx=1-.008*Math.sin(t*frequency+phase);}
      else {frequency=1.7;sy=1+.018*Math.sin(t*frequency+phase);sx=1-.012*Math.sin(t*frequency+phase);}
    }else{
      frequency=1.5;dy=-.012*Math.sin(t*frequency+phase);
      sy=1+.012*Math.sin(t*frequency+phase);sx=1-.006*Math.sin(t*frequency+phase);
    }
    return {dx,dy,sx,sy};
  }
  function drawDetails(ctx,plan,view){
    if(!plan||!ctx)return;
    const {ox,oy,cell}=view,colors=themes[plan.theme];
    ctx.save();
    ctx.lineCap='round';
    for(const detail of plan.details){
      const x=ox+(detail.x+detail.u)*cell,y=oy+(detail.y+detail.v)*cell;
      const r=detail.size*cell;
      ctx.save();ctx.translate(x,y);ctx.rotate(detail.angle);
      ctx.strokeStyle=colors.detail;ctx.fillStyle=colors.ink;
      ctx.lineWidth=clamp(cell*.016,.5,1.65);
      if(detail.kind==='bamboo'){
        ctx.beginPath();ctx.moveTo(-r*.8,r*.2);ctx.quadraticCurveTo(0,-r*.65,r*.7,-r*.12);
        ctx.quadraticCurveTo(.0,r*.4,-r*.8,r*.2);ctx.fill();
        ctx.beginPath();ctx.moveTo(-r*.6,r*.21);ctx.lineTo(r*.6,-r*.14);ctx.stroke();
      }else if(detail.kind==='desert'){
        for(let j=0;j<2;j++){
          ctx.beginPath();ctx.moveTo(-r*.8+j*r*.2,j*r*.65);
          ctx.quadraticCurveTo(0,-r*.25+j*r*.65,r,j*r*.65);ctx.stroke();
        }
      }else if(detail.kind==='snow'){
        ctx.beginPath();ctx.moveTo(-r,0);ctx.lineTo(r,0);ctx.moveTo(0,-r);ctx.lineTo(0,r);
        ctx.moveTo(-r*.65,-r*.65);ctx.lineTo(r*.65,r*.65);ctx.stroke();
      }else if(detail.kind==='ripple'||detail.kind==='water'){
        ctx.beginPath();ctx.ellipse(0,0,r,r*.44,0,0,TAU);ctx.stroke();
        if(detail.kind!=='ripple'){ctx.beginPath();ctx.moveTo(-r*.5,r*.44);ctx.lineTo(r*.4,r*.44);ctx.stroke();}
      }else{
        ctx.beginPath();ctx.moveTo(-r*.9,-r*.7);ctx.lineTo(-r*.12,-r*.1);
        ctx.lineTo(r*.18,-r*.45);ctx.moveTo(-r*.12,-r*.1);ctx.lineTo(r*.8,r*.55);ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }
  function rasterize(plan,createCanvas){
    if(!plan||typeof createCanvas!=='function')return null;
    const canvas=createCanvas();
    if(!canvas?.getContext)return null;
    const cell=64;
    canvas.width=plan.width*cell;canvas.height=plan.height*cell;
    const ctx=canvas.getContext('2d');
    if(!ctx)return null;
    drawDetails(ctx,plan,{ox:0,oy:0,cell});
    return canvas;
  }
  function drawAtmosphere(ctx,plan,view,time=0,reduced=false,quality='normal'){
    if(!plan||!ctx||reduced)return;
    const {ox,oy,cell}=view,colors=themes[plan.theme];
    const width=plan.width*cell,height=plan.height*cell;
    const seconds=Number.isFinite(time)?time/1000:0;
    ctx.save();ctx.beginPath();ctx.rect(ox,oy,width,height);ctx.clip();
    // A restrained wash gives each habitat a lighting signature without
    // tinting tactical indicators, since those are drawn later.
    if(quality!=='low'){
      const wash=ctx.createLinearGradient(ox,oy,ox+width,oy+height);
      wash.addColorStop(0,colors.glow);wash.addColorStop(.52,'rgba(0,0,0,0)');
      wash.addColorStop(1,colors.glow);
      ctx.globalAlpha=.7+.1*Math.sin(seconds*.32);
      ctx.fillStyle=wash;ctx.fillRect(ox,oy,width,height);
    }
    const count=quality==='low'?Math.min(9,plan.motes.length):plan.motes.length;
    for(let i=0;i<count;i++){
      const mote=plan.motes[i],period=5+mote.speed*8;
      const travel=(seconds*.11*mote.speed+mote.phase/TAU)%1;
      const px=ox+((mote.x+travel*period)%plan.width)*cell;
      const py=oy+((mote.y-travel*period*.35%plan.height+plan.height)%plan.height)*cell;
      ctx.save();
      ctx.globalAlpha=(quality==='low'?.17:.26)*(.55+.45*Math.sin(seconds*1.3+mote.phase));
      ctx.fillStyle=colors.mote;ctx.strokeStyle=colors.mote;
      const radius=clamp(mote.size*cell/46,.7,2);
      if(plan.theme==='bamboo'){
        ctx.translate(px,py);ctx.rotate(mote.phase+seconds*.35);
        ctx.beginPath();ctx.ellipse(0,0,radius*2.3,radius*.6,-.4,0,TAU);ctx.fill();
      }else if(plan.theme==='desert'){
        ctx.lineWidth=Math.max(.8,radius*.65);ctx.beginPath();
        ctx.moveTo(px-radius*2,py+radius*.4);ctx.lineTo(px+radius*2.5,py-radius*.5);ctx.stroke();
      }else if(plan.theme==='snow'){
        ctx.lineWidth=Math.max(.65,radius*.5);ctx.beginPath();
        ctx.moveTo(px-radius*1.5,py);ctx.lineTo(px+radius*1.5,py);
        ctx.moveTo(px,py-radius*1.5);ctx.lineTo(px,py+radius*1.5);ctx.stroke();
      }else if(plan.theme==='water'){
        ctx.beginPath();ctx.ellipse(px,py,radius*1.55,radius*.6,0,0,TAU);ctx.stroke();
      }else{
        ctx.beginPath();ctx.arc(px,py,radius,0,TAU);ctx.fill();
      }
      ctx.restore();
    }
    if(quality!=='low'&&plan.lamps.length){
      for(const lamp of plan.lamps.slice(0,5)){
        const x=ox+lamp.x*cell,y=oy+lamp.y*cell;
        const glow=ctx.createRadialGradient(x,y,0,x,y,cell*.65);
        glow.addColorStop(0,colors.glow);glow.addColorStop(1,'rgba(0,0,0,0)');
        ctx.globalAlpha=.65+.15*Math.sin(seconds*.75+lamp.phase);
        ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,cell*.65,0,TAU);ctx.fill();
      }
    }
    ctx.restore();
  }
  return Object.freeze({themes,themeFor,hash,stageIdentity,mapIdentity,pixelRatioFor,prepare,idlePose,drawDetails,drawAtmosphere,rasterize});
});

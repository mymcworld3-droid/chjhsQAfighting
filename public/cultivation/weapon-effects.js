/* Shared V2 weapon timeline: visual-only, committed server events.
 * Arrays contain maps, not arrays, for Firestore compatibility. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QAWeaponEffects=api;
})(globalThis,()=>{
  'use strict';
  const clamp=n=>Math.max(0,Math.min(1,n)),point=p=>({x:p.x,y:p.y});
  const valid=p=>Number.isSafeInteger(p?.x)&&Number.isSafeInteger(p?.y)&&p.x>=0&&p.y>=0&&p.x<128&&p.y<128;
  const points=(a,max=1024)=>Array.isArray(a)&&a.every(valid)?a.slice(0,max).map(point):[];
  const kinds=new Set(['ray','shock','domain','echo','vortex','crash']);
  const colors=Object.freeze({ice:'#a9e7ff',gold:'#f9d68a',jade:'#72efc3',violet:'#bd9aff',copper:'#dfaa65'});
  const ink=k=>colors[k]||colors.gold,tone=k=>Object.hasOwn(colors,k)?k:'gold';
  const uid=s=>typeof s==='string'&&s.length>0&&s.length<=256;
  const amount=n=>Number.isFinite(n)&&n>=0?n:0;
  const lerp=(a,b,p)=>({x:a.x+(b.x-a.x)*p,y:a.y+(b.y-a.y)*p});
  function normalize(raw){
    if(raw?.version!==2||!Number.isInteger(raw.durationMs)||raw.durationMs<250||raw.durationMs>650||!Array.isArray(raw.segments)||!raw.segments.length||raw.segments.length>24)return null;
    const segments=[];let lastImpact=-1;
    for(const s of raw.segments){
      if(!s||!kinds.has(s.kind)||![s.start,s.impact,s.end].every(Number.isInteger)||s.start<0||s.impact<s.start||s.impact>=s.end||s.end>raw.durationMs||s.impact<lastImpact)return null;
      lastImpact=s.impact;
      const rays=Array.isArray(s.rays)?s.rays.slice(0,21).map(r=>({cells:points(r?.cells,256),tone:tone(r?.tone||s.tone),collision:valid(r?.collision)?point(r.collision):null})).filter(r=>r.cells.length>1):[];
      const moves=Array.isArray(s.moves)?s.moves.slice(0,64).filter(m=>uid(m?.uid)&&Array.isArray(m.path)&&m.path.length>=2&&m.path.length<=256&&m.path.every(valid)).map(m=>({uid:m.uid,path:points(m.path,256),style:['arc','swap','fall','slide'].includes(m.style)?m.style:'slide'})):[];
      const hits=Array.isArray(s.hits)?s.hits.slice(0,128).filter(h=>uid(h?.uid)&&Number.isFinite(h.damage)&&h.damage>=0).map(h=>({uid:h.uid,damage:amount(h.damage),absorbed:amount(h.absorbed),...(valid(h.cell)?{cell:point(h.cell)}:{})})):[];
      const echoes=Array.isArray(s.echoes)?s.echoes.slice(0,8).filter(e=>valid(e?.position)).map(e=>({position:point(e.position),...(valid(e.to)?{to:point(e.to)}:{}),type:e.type==='time'?'time':'mirror',tone:tone(e.tone||(e.type==='time'?'gold':'violet'))})):[];
      segments.push({kind:s.kind,start:s.start,impact:s.impact,end:s.end,tone:tone(s.tone),
        ...(Number.isInteger(s.chargeMs)&&s.chargeMs>0&&s.chargeMs<=s.start?{chargeMs:s.chargeMs}:{}),
        origin:valid(s.origin)?point(s.origin):null,target:valid(s.target)?point(s.target):null,
        cells:points(s.cells),vertices:points(s.vertices,16),radius:Number.isFinite(s.radius)?Math.max(0,Math.min(8,s.radius)):0,rays,moves,hits,echoes});
    }
    return {version:2,durationMs:raw.durationMs,segments};
  }
  function active(timeline,p){
    const t=clamp(p)*timeline.durationMs;
    return timeline.segments.filter(s=>t>=s.start&&t<s.end).map(s=>({...s,
      progress:clamp((t-s.start)/Math.max(1,s.end-s.start)),
      travel:clamp((t-s.start)/Math.max(1,s.impact-s.start)),
      impactProgress:t<s.impact?-1:clamp((t-s.impact)/Math.max(1,s.end-s.impact))}));
  }
  function numberFrames(timeline,p){
    const t=clamp(p)*timeline.durationMs,out=[];
    for(const s of timeline.segments){
      const q=(t-s.impact)/Math.max(1,Math.min(200,timeline.durationMs-s.impact));
      if(q<0||q>=1)continue;
      const merged=new Map();
      for(const h of s.hits){
        const old=merged.get(h.uid);
        if(old){old.damage+=h.damage;old.absorbed+=h.absorbed;}
        else merged.set(h.uid,{...h});
      }
      for(const h of merged.values())out.push({...h,progress:q});
    }
    return out;
  }
  function routePose(path,q,style){
    q=clamp(q);const n=q*q*(3-2*q)*(path.length-1),i=Math.min(path.length-2,Math.floor(n));
    return {...lerp(path[i],path[i+1],n-i),lift:style==='fall'?Math.sin(Math.PI*q)*1.15:style==='arc'?Math.sin(Math.PI*q)*.16:0,opacity:style==='swap'?.35+.65*Math.abs(2*q-1):1};
  }
  function motionPose(timeline,id,p){
    const t=clamp(p)*timeline.durationMs;let pose=null;
    for(const s of timeline.segments)for(const m of s.moves){
      const start=['fall','swap'].includes(m.style)?s.start:s.impact;
      if(m.uid!==id)continue;
      if(t<start){if(!pose)pose={...m.path[0],lift:0,opacity:1};continue;}
      pose=routePose(m.path,(t-start)/Math.max(1,s.end-start),m.style);
    }
    return pose;
  }
  function sample(timeline,before,after,p){
    const t=clamp(p)*timeline.durationMs;
    return before.map(a=>{
      const final=after.find(b=>b.uid===a.uid),pose=motionPose(timeline,a.uid,p);
      let hp=a.hp,shield=a.shield||0,flash=0;
      for(const s of timeline.segments)if(t>=s.impact){
        const q=clamp((t-s.impact)/Math.max(1,Math.min(75,s.end-s.impact)));
        for(const h of s.hits.filter(h=>h.uid===a.uid)){hp-=h.damage*q;shield-=h.absorbed*q;flash=Math.max(flash,Math.sin(Math.PI*q)*.75);}
      }
      const out={...a,...pose,hp:Math.max(0,hp),shield:Math.max(0,shield),flash,lift:pose?.lift||0,opacity:pose?.opacity??1,scaleX:1,scaleY:1};
      if(p>=1&&final)Object.assign(out,final,{lift:0,opacity:1,flash:0,scaleX:1,scaleY:1});
      return out;
    });
  }
  const center=(v,p)=>({x:v.ox+(p.x+.5)*v.cell,y:v.oy+(p.y+.5)*v.cell});
  function line(ctx,pts){if(pts.length<2)return;ctx.beginPath();pts.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p.x,p.y));ctx.stroke();}
  function ring(ctx,p,r){ctx.beginPath();ctx.arc(p.x,p.y,Math.max(1,r),0,Math.PI*2);ctx.stroke();}
  function silhouette(ctx,a,size,color,alpha){
    ctx.fillStyle=color;ctx.strokeStyle=color;ctx.globalAlpha=alpha;
    ctx.beginPath();ctx.arc(a.x,a.y-size*.22,size*.12,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.moveTo(a.x-size*.17,a.y+size*.3);ctx.lineTo(a.x-size*.1,a.y-size*.1);ctx.lineTo(a.x+size*.1,a.y-size*.1);ctx.lineTo(a.x+size*.17,a.y+size*.3);ctx.closePath();ctx.fill();
    ring(ctx,a,size*.35);
  }
  const PRISM_SOUNDS=Object.freeze(['prism-sword','prism-crystal','prism-split']);
  const isPrism=id=>['prism-slash','prism-reflect','prism-scatter'].includes(id);
  // The timeline's committed collision/hit data controls cues. One cue per
  // causal beat, never per ray or victim, including an empty wall collision.
  function prismSoundCues(timeline,id){
    if(!isPrism(id)||!timeline?.segments?.length)return [];
    const root=timeline.segments[0],cues=[{at:root.start,id:PRISM_SOUNDS[0],volume:.34}];
    const impact=s=>s.rays.some(r=>r.collision)||s.hits.some(h=>h.damage||h.absorbed);
    if(impact(root))cues.push({at:root.impact,id:PRISM_SOUNDS[1],volume:.32});
    const secondary=timeline.segments.filter(s=>s.start===root.impact);
    const beat=secondary.find(impact);
    if(beat)cues.push({at:beat.impact,id:id==='prism-scatter'&&timeline.segments.some(s=>s.start===beat.impact)?PRISM_SOUNDS[2]:PRISM_SOUNDS[1],volume:.29});
    return cues;
  }
  function advancePrismSound(timeline,id,elapsed,played,play,key){
    if(!isPrism(id)||!timeline)return false;
    const cues=prismSoundCues(timeline,id);
    let due=null;
    cues.forEach((cue,i)=>{
      if(elapsed<cue.at||played.has(i))return;
      played.add(i);due={...cue,index:i};
    });
    // A stalled frame must never queue multiple old sounds on resume.
    if(due&&elapsed-due.at<=100)play(due.id,{volume:due.volume,key:key+':prism:'+due.index});
    return true;
  }
  function draw(ctx,timeline,p,v,above,{reduced=false}={}){
    if(!timeline)return false;
    const size=v.cell,at=p=>center(v,p);
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    const ms=clamp(p)*timeline.durationMs;
    if(!above)for(const s of timeline.segments){
      if(!s.chargeMs||!s.origin||ms<s.start-s.chargeMs||ms>=s.start)continue;
      const a=at(s.origin),q=(ms-s.start+s.chargeMs)/s.chargeMs,r=size*(.08+.16*q);
      ctx.strokeStyle='#effaff';ctx.lineWidth=Math.max(1,size*.045);ctx.globalAlpha=.25+.65*q;
      ring(ctx,a,r);line(ctx,[{x:a.x-r*1.7,y:a.y},{x:a.x,y:a.y-r*1.7},{x:a.x+r*1.7,y:a.y},{x:a.x,y:a.y+r*1.7},{x:a.x-r*1.7,y:a.y}]);
    }
    for(const s of active(timeline,p)){
      const q=s.progress,b=s.impactProgress,origin=s.origin&&at(s.origin),target=s.target&&at(s.target),color=ink(s.tone);
      ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=Math.max(1,size*.045);
      if(!above){
        if(['shock','domain','crash','vortex'].includes(s.kind)){
          ctx.globalAlpha=.12*(1-q)+.07;
          for(const c of s.cells)ctx.fillRect(v.ox+c.x*size+1,v.oy+c.y*size+1,Math.max(1,size-2),Math.max(1,size-2));
          ctx.globalAlpha=.72*(1-q);
          if(s.kind==='shock'&&origin){const r=size*(.4+s.radius*s.travel);ctx.strokeRect(origin.x-r,origin.y-r,2*r,2*r);}
          if(s.kind==='domain'&&s.vertices.length>1){const pts=s.vertices.map(at);line(ctx,s.vertices.length>2?[...pts,pts[0]]:pts);}
          if(s.kind==='vortex'&&origin){ring(ctx,origin,size*(.3+s.radius*(1-s.travel)));ring(ctx,origin,size*(.22+s.radius*(1-s.travel)*.65));}
          if(s.kind==='crash'&&target&&b>=0)for(let i=1;i<=3;i++)ring(ctx,target,size*(i*.27+b*i*.8));
        }
        for(const ray of s.rays){
          const pts=ray.cells.map(at),length=(pts.length-1)*s.travel,index=Math.min(pts.length-2,Math.floor(length));
          const trail=pts.slice(0,index+1).concat(lerp(pts[index],pts[index+1],length-index));
          for(const [width,alpha] of [[.19,.18],[.065,.9],[.018,.95]]){
            ctx.strokeStyle=width===.018?'#fffaf0':ink(ray.tone);ctx.lineWidth=Math.max(1,size*width);
            ctx.globalAlpha=alpha*(1-Math.max(0,b)*.85);line(ctx,trail);
          }
        }
        for(const e of s.echoes)silhouette(ctx,at(e.to?lerp(e.position,e.to,s.travel):e.position),size,ink(e.tone),.36);
        if(s.kind==='crash'&&origin&&target&&b<0){const a=lerp(origin,target,s.travel);ctx.globalAlpha=.8;ctx.strokeStyle=color;line(ctx,[{x:a.x,y:a.y-size*(1+Math.sin(Math.PI*s.travel))},a]);}
        for(const m of s.moves){
          const phase=['fall','swap'].includes(m.style)?s.travel:Math.max(0,b);
          if(phase<=0)continue;const pos=routePose(m.path,phase,m.style),a=at(m.path[0]),z=at(pos);
          ctx.strokeStyle=color;ctx.globalAlpha=.35*(1-phase);ctx.lineWidth=Math.max(1,size*.06);
          if(m.style==='arc'){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo((a.x+z.x)/2+size*.18,(a.y+z.y)/2-size*.18,z.x,z.y);ctx.stroke();}
          else line(ctx,[a,z]);
        }
      }else if(b>=0){
        if(s.kind==='ray')for(const ray of s.rays){
          if(!ray.collision||b>.55)continue;
          const a=at(ray.collision),r=size*(.14+b*.4);
          ctx.strokeStyle='#f5fbff';ctx.lineWidth=Math.max(1,size*.035);ctx.globalAlpha=(1-b/.55)*.9;
          line(ctx,[{x:a.x-r,y:a.y},{x:a.x,y:a.y-r},{x:a.x+r,y:a.y},{x:a.x,y:a.y+r},{x:a.x-r,y:a.y}]);
        }
        const spots=s.rays.map(r=>r.collision).filter(Boolean).concat(s.hits.map(h=>h.cell).filter(Boolean)).slice(0,16);
        ctx.strokeStyle=color;ctx.globalAlpha=(1-b)*.85;
        for(const cell of spots){const a=at(cell);ring(ctx,a,size*(.14+b*.42));
          if(!reduced)for(let i=0;i<3;i++){const angle=i*2.094+q*3,d=size*(.08+b*.48);line(ctx,[{x:a.x+Math.cos(angle)*d,y:a.y+Math.sin(angle)*d},{x:a.x+Math.cos(angle)*(d+size*.08),y:a.y+Math.sin(angle)*(d+size*.08)}]);}
        }
        if(!reduced&&s.kind==='vortex'&&origin){ctx.fillStyle=color;for(let i=0;i<8;i++){const a=i*Math.PI/4+q*Math.PI*2,r=size*(.22+(1-q)*s.radius);ctx.beginPath();ctx.arc(origin.x+Math.cos(a)*r,origin.y+Math.sin(a)*r,Math.max(1,size*.035),0,Math.PI*2);ctx.fill();}}
      }
    }
    ctx.restore();return true;
  }
  function drawNumbers(ctx,timeline,p,v,actors=[]){
    ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold '+Math.max(10,Math.min(17,v.cell*.3))+'px sans-serif';ctx.lineWidth=3;
    const stacked=new Map();
    for(const h of numberFrames(timeline,p)){
      if(!h.damage&&!h.absorbed)continue;
      const pos=h.cell||actors.find(a=>a.uid===h.uid);if(!pos)continue;
      const i=stacked.get(h.uid)||0;stacked.set(h.uid,i+1);
      const a=center(v,pos),y=a.y-v.cell*(.55+h.progress*.6)-i*Math.max(10,v.cell*.28);
      ctx.globalAlpha=Math.min(1,(1-h.progress)*3);ctx.strokeStyle='#18201b';ctx.fillStyle=h.absorbed?'#b8e5f6':'#ffd39e';
      const label=h.damage?'−'+Math.round(h.damage):'護盾 −'+Math.round(h.absorbed);ctx.strokeText(label,a.x,y);ctx.fillText(label,a.x,y);
    }
    ctx.restore();
  }
  function drawObjects(ctx,state,actors,v,now=0,{reduced=false}={}){
    if(state?.version!==1||!Array.isArray(state.objects))return false;
    const clock=reduced?0:now/1000;
    ctx.save();ctx.lineWidth=Math.max(1,v.cell*.035);
    for(const o of state.objects.slice(0,64)){
      if(!o?.active)continue;
      const owner=actors.find(a=>a.uid===o.ownerUid),pos=o.positionMode==='point-symmetric'&&owner?{x:v.width-1-owner.x,y:v.height-1-owner.y}:o.position;
      if(!pos||!Number.isFinite(pos.x)||!Number.isFinite(pos.y)||pos.x<0||pos.y<0||pos.x>=v.width||pos.y>=v.height)continue;
      const a=center(v,pos),r=v.cell*.31,color=ink(o.type==='mark'?'jade':o.type==='echo'?'gold':'violet');
      ctx.strokeStyle=color;ctx.fillStyle=color;ctx.globalAlpha=.6;
      if(o.type==='mark')line(ctx,[{x:a.x,y:a.y-r},{x:a.x+r*.7,y:a.y},{x:a.x,y:a.y+r},{x:a.x-r*.7,y:a.y},{x:a.x,y:a.y-r}]);
      else if(o.type==='echo'||o.type==='mirror')silhouette(ctx,a,v.cell,color,.32);
      else if(o.type==='core'){ring(ctx,a,r);ctx.globalAlpha=.35;ring(ctx,a,r*.65);ctx.beginPath();ctx.arc(a.x,a.y,r*.42,0,Math.PI*2);ctx.fill();for(let i=0;i<6;i++){const t=i*Math.PI/3+clock;ctx.beginPath();ctx.arc(a.x+Math.cos(t)*r,a.y+Math.sin(t)*r,Math.max(1,r*.1),0,Math.PI*2);ctx.fill();}}
    }
    ctx.restore();return state.objects.length>0;
  }
  return Object.freeze({normalize,active,numberFrames,motionPose,sample,draw,drawNumbers,drawObjects,PRISM_SOUNDS,prismSoundCues,advancePrismSound});
});

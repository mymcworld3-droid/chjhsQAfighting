/* Canvas effects for the equipped manuals. The battlefield rules supply all
   cells, rays and movement; these drawings never decide damage or targeting. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QATacticalSkillEffects=api;
})(globalThis,()=>{
  'use strict';
  const manuals=()=>typeof module==='object'&&module.exports
    ?require('./manual-rules.js'):globalThis.QAManuals;
  const moves=new Set([
    'wind-slash','wind-step','wind-thousand','flight-summon','sky-cloud','sky-sever',
    'rock-fist','rock-quake','rock-break','dragon-guard','dragon-roar','tiger-step','tiger-throw'
  ]);
  const clamp=n=>Math.max(0,Math.min(1,n));
  const phase=(p,start,end)=>clamp((p-start)/(end-start));
  const pulse=p=>Math.sin(Math.PI*clamp(p));
  const point=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  function moveFor(skill){
    const move=manuals()?.BY_SKILL?.[skill]?.moveId||skill;
    return moves.has(move)?move:null;
  }
  function draw(ctx,scene,progress,view,above){
    const move=moveFor(scene.skill);
    if(!move||scene.kind!=='cast')return false;
    const p=clamp(progress),beat=pulse(p),{cell:size,ox,oy,width,height}=view;
    const c=ctx,center=pos=>({x:ox+(pos.x+.5)*size,y:oy+(pos.y+.5)*size});
    const origin=scene.origin||scene.before?.find(a=>a.uid===scene.actor)||{x:0,y:0};
    const target=scene.target||origin,from=center(origin),to=center(target);
    const cells=scene.cells||[],hit=cells.map(center);
    const jade='#9df8dc',white='#effff4',gold='#ffc77b',ember='#ff9563';
    const sword=['wind-slash','wind-step','wind-thousand','flight-summon','sky-cloud','sky-sever'].includes(move);
    const ink=sword?jade:gold,bright=sword?white:'#fff2c9';
    const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy)||1;
    const axis={x:dx/length,y:dy/length},side={x:-axis.y,y:axis.x};
    const glow=(color,blur)=>{c.shadowColor=color;c.shadowBlur=size*blur;};
    const circle=(at,r,alpha,color=ink,width=.025)=>{
      c.globalAlpha=clamp(alpha);c.strokeStyle=color;c.lineWidth=Math.max(1,size*width);
      c.beginPath();c.arc(at.x,at.y,Math.max(.1,r*size),0,Math.PI*2);c.stroke();
    };
    const stroke=(a,b,color,width,alpha)=>{
      c.globalAlpha=clamp(alpha);c.strokeStyle=color;c.lineWidth=Math.max(1,size*width);
      c.lineCap='round';c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
    };
    const sparks=(at,amount,color,spread=1,offset=0)=>{
      c.fillStyle=color;
      for(let i=0;i<amount;i++){
        const angle=i*2.399963+offset,travel=(.16+p*spread)*size*(.55+(i%4)*.17);
        const x=at.x+Math.cos(angle)*travel,y=at.y+Math.sin(angle)*travel*.72-p*size*.12;
        c.globalAlpha=(1-p)*(.45+(i%3)*.16);c.beginPath();c.arc(x,y,Math.max(1,size*(.018+(i%3)*.007)),0,Math.PI*2);c.fill();
      }
    };
    const impact=(at,phaseValue,color=ink)=>{
      const q=clamp(phaseValue);
      circle(at,.13+q*.48,pulse(q)*.9,color,.035);
      for(let i=0;i<8;i++){
        const angle=i*Math.PI/4,inner=(.1+q*.24)*size,outer=(.18+q*.46)*size;
        stroke({x:at.x+Math.cos(angle)*inner,y:at.y+Math.sin(angle)*inner},
          {x:at.x+Math.cos(angle)*outer,y:at.y+Math.sin(angle)*outer},bright,.025,pulse(q));
      }
    };
    const crescent=(at,angle,q,color=ink,scale=1)=>{
      const a=pulse(q);if(a<=0)return;
      c.save();c.translate(at.x,at.y);c.rotate(angle);glow(color,.18);
      for(const [offset,width,alpha] of [[0,.12,.18],[-.035,.055,.85],[-.065,.018,1]]){
        c.globalAlpha=a*alpha;c.strokeStyle=offset===-.065?bright:color;
        c.lineWidth=Math.max(1,size*width*scale);c.lineCap='round';c.beginPath();
        c.arc(-size*.14*scale,0,size*(.42+offset)*scale,-1.08+q*.7,1.08+q*.7);c.stroke();
      }
      c.restore();
    };
    const fist=(at,angle,q,scale=1)=>{
      const a=pulse(q);if(a<=0)return;
      c.save();c.translate(at.x,at.y);c.rotate(angle);
      glow(ember,.18);c.globalAlpha=a;c.fillStyle='#5b321e';c.strokeStyle=gold;c.lineWidth=Math.max(1,size*.035);
      c.beginPath();c.moveTo(-size*.25*scale,-size*.20*scale);
      c.lineTo(size*.1*scale,-size*.20*scale);c.lineTo(size*.24*scale,-size*.12*scale);
      c.lineTo(size*.24*scale,size*.12*scale);c.lineTo(size*.10*scale,size*.20*scale);
      c.lineTo(-size*.25*scale,size*.20*scale);c.closePath();c.fill();c.stroke();
      for(let i=-1;i<=1;i++)stroke({x:-size*.05*scale,y:i*size*.095*scale},{x:size*.17*scale,y:i*size*.095*scale},bright,.018,a);
      c.restore();
    };
    const beam=(start,end,t,color=ink,width=.1)=>{
      const q=clamp(t),tip=point(start,end,q);
      glow(color,.22);
      stroke(start,tip,color,width*2,.17*beat);
      stroke(start,tip,color,width,.65*beat);
      stroke(start,tip,bright,width*.26,.9*beat);
      return tip;
    };
    c.save();c.beginPath();c.rect(ox,Math.max(0,oy-size*.35),size*width,size*(height+.35));c.clip();
    if(!above){
      // Ground marks follow the committed cells, including walls and truncated rays.
      for(const tile of cells){
        const at=center(tile);c.globalAlpha=beat*.1;c.fillStyle=ink;
        c.fillRect(ox+tile.x*size+2,oy+tile.y*size+2,size-4,size-4);
        circle(at,.29+beat*.05,beat*.25,ink,.014);
      }
      if(move==='dragon-roar'||move==='flight-summon'){
        c.save();c.translate((move==='dragon-roar'?from:to).x,(move==='dragon-roar'?from:to).y);
        c.rotate((move==='dragon-roar'?1:-1)*p*.9);
        circle({x:0,y:0},.58,beat*.75,ink,.025);
        circle({x:0,y:0},.42,beat*.45,bright,.015);
        for(let i=0;i<8;i++){
          const angle=i*Math.PI/4;
          stroke({x:Math.cos(angle)*size*.43,y:Math.sin(angle)*size*.43},
            {x:Math.cos(angle)*size*.56,y:Math.sin(angle)*size*.56},ink,.022,beat*.8);
        }
        c.restore();
      }
      c.restore();return true;
    }
    if(move==='wind-slash'){
      const end=hit.at(-1)||to,q=phase(p,.06,.8);
      const sweep=point(from,end,q);
      for(let i=2;i>=0;i--)crescent(point(from,end,Math.max(0,q-i*.1)),Math.atan2(dy,dx),q, jade,1-i*.13);
      if(q>.15)sparks(sweep,9,jade,.45);
    }else if(move==='wind-step'){
      const at=hit.length?hit[Math.floor(hit.length/2)]:to;
      const angle=Math.atan2(dy,dx);
      crescent(at,angle-.55,phase(p,.03,.55),jade,1.35);
      crescent(at,angle+.55,phase(p,.43,.98),white,1.2);
      if(p>.32)impact(at,phase(p,.32,.95),jade);
    }else if(move==='wind-thousand'){
      const end=hit.at(-1)||to,q=phase(p,.12,.78),tip=beam(from,end,q,jade,.12);
      for(const offset of [-.16,.16]){
        const shift={x:side.x*size*offset,y:side.y*size*offset};
        stroke({x:from.x+shift.x,y:from.y+shift.y},{x:tip.x+shift.x,y:tip.y+shift.y},jade,.025,beat*.8);
      }
      crescent(tip,Math.atan2(dy,dx),phase(p,.05,.98),white,1.15);
      if(p>.48)impact(tip,phase(p,.48,1),jade);
    }else if(move==='flight-summon'){
      const hadSword=!!scene.before?.find(a=>a.uid===scene.actor)?.flyingSword;
      if(hadSword){
        const q=phase(p,.05,.92),tip=beam(from,to,q,jade,.045);
        for(let i=0;i<5;i++)circle(point(from,tip,i/5),.07+i*.012,(1-p)*.55,white,.014);
        sparks(tip,8,jade,.38);
      }else{
        circle(to,.12+p*.5,beat,jade,.035);circle(to,.44-p*.18,beat*.8,white,.018);
        for(let i=0;i<6;i++){
          const angle=i*Math.PI/3+p*3;
          stroke({x:to.x+Math.cos(angle)*size*.36,y:to.y+Math.sin(angle)*size*.36},
            {x:to.x+Math.cos(angle)*size*.18,y:to.y+Math.sin(angle)*size*.18},jade,.025,beat);
        }
        sparks(to,12,white,.55);
      }
    }else if(move==='sky-cloud'||move==='sky-sever'){
      const rays=scene.rays||[];
      for(const [i,ray] of rays.entries()){
        if(!ray.length)continue;
        const start=center(ray.at(-1)),q=phase(p,.04+(i%2)*.08,.68+(i%2)*.08);
        const tip=beam(start,to,q,i%2?white:jade,move==='sky-sever'?.065:.085);
        crescent(tip,Math.atan2(to.y-start.y,to.x-start.x),phase(p,.04,.88),jade,.58);
      }
      if(p>.45){
        const q=phase(p,.45,1);impact(to,q,white);circle(to,.25+q*.5,pulse(q),jade,.04);
        sparks(to,move==='sky-sever'?18:12,white,.85);
      }
    }else if(move==='rock-fist'){
      const end=hit.at(-1)||to,q=phase(p,.04,.85),at=point(from,end,q);
      for(let i=0;i<3;i++){
        const tail=point(from,at,i*.25);circle(tail,.18+i*.05,(1-p)*.5,gold,.025);
      }
      fist(at,Math.atan2(dy,dx),phase(p,.02,.98),.95);
      if(p>.5)impact(at,phase(p,.5,1),gold);
    }else if(move==='rock-quake'){
      fist(to,Math.atan2(dy,dx),phase(p,.04,.85),1.25);
      for(const [i,at] of hit.entries())impact(at,phase(p,.16+i*.045,.86+i*.025),gold);
      if(p>.3)sparks(to,14,ember,.7);
    }else if(move==='rock-break'){
      const q=phase(p,.06,.9);fist(point(from,to,q),Math.atan2(dy,dx),q,1.2);
      for(const [i,at] of hit.entries()){
        const local=phase(p,.16+i*.04,.92);
        impact(at,local,ember);
        for(let j=0;j<3;j++){
          const shift=(j-1)*.18*size;
          stroke({x:at.x-side.x*size*.12+axis.x*shift,y:at.y-side.y*size*.12+axis.y*shift},
            {x:at.x+axis.x*size*(.2+local*.55)+side.x*shift,y:at.y+axis.y*size*(.2+local*.55)+side.y*shift},gold,.035,pulse(local));
        }
      }
    }else if(move==='dragon-guard'){
      const q=phase(p,.04,.9),at=point(from,to,q);
      fist(at,Math.atan2(dy,dx)+(Math.floor((scene.step||1)%2)?-.12:.12),q,1.05);
      for(const at of hit)impact(at,phase(p,.2,1),ember);
      sparks(to,10,gold,.48);
    }else if(move==='dragon-roar'){
      for(let i=0;i<3;i++)circle(from,.2+i*.17+p*.18,beat*(.9-i*.18),i===1?bright:gold,.035-i*.006);
      for(let i=0;i<10;i++){
        const angle=i*Math.PI/5+p*2,r=size*(.25+p*.3);
        const start={x:from.x+Math.cos(angle)*r,y:from.y+Math.sin(angle)*r*.55};
        stroke(start,{x:start.x,y:start.y-size*(.25+.55*p)},i%2?gold:bright,.018,beat*.8);
      }
      sparks(from,16,gold,.8);
    }else if(move==='tiger-step'){
      const at=hit.length?hit[Math.floor(hit.length/2)]:to,angle=Math.atan2(dy,dx);
      for(const [i,offset] of [-.32,.32].entries()){
        const q=phase(p,.02+i*.4,.58+i*.4);
        fist({x:at.x+side.x*size*offset,y:at.y+side.y*size*offset},angle,q,.9);
        for(const cell of hit)impact(cell,q,gold);
      }
    }else if(move==='tiger-throw'){
      const q=phase(p,.05,.95);
      for(const at of hit){
        const reach=point(at,from,q);
        c.globalAlpha=beat*.8;c.strokeStyle=gold;c.lineWidth=Math.max(1,size*.055);c.lineCap='round';
        c.beginPath();c.moveTo(at.x,at.y);c.quadraticCurveTo(from.x+side.x*size*.35,from.y+side.y*size*.35,reach.x,reach.y);c.stroke();
        circle(at,.2+q*.15,beat,bright,.025);
      }
      crescent(from,Math.atan2(dy,dx)+Math.PI,phase(p,.1,.95),gold,1.1);
    }
    c.restore();return true;
  }
  function drawMotion(ctx,scene,progress,view){
    const move=moveFor(scene.visualSkill);
    if(!move||!['dash','throw'].includes(scene.style))return false;
    const p=clamp(progress),beat=pulse(p),{cell:size,ox,oy,width,height}=view,c=ctx;
    const center=pos=>({x:ox+(pos.x+.5)*size,y:oy+(pos.y+.5)*size});
    const sword=move==='wind-step',color=sword?'#a5f6da':'#ffc77b';
    c.save();c.beginPath();c.rect(ox,Math.max(0,oy-size*.35),size*width,size*(height+.35));c.clip();
    c.strokeStyle=color;c.lineCap='round';c.lineJoin='round';c.shadowColor=color;c.shadowBlur=size*.16;
    for(const motion of scene.moves||[]){
      const route=motion.path||[];
      if(route.length<2)continue;
      const distance=(scene.style==='dash'?1-(1-p)**3:p)*(route.length-1);
      const index=Math.min(route.length-2,Math.floor(distance)),fraction=distance-index;
      const start=center(route[0]),end=center(route.at(-1));
      const current=point(center(route[index]),center(route[index+1]),fraction);
      if(scene.style==='throw'){
        const lift=size*.28*beat,control={x:(start.x+end.x)/2,y:(start.y+end.y)/2-lift};
        for(const [widthScale,alpha] of [[.13,.18],[.035,.85]]){
          c.lineWidth=Math.max(1,size*widthScale);c.globalAlpha=beat*alpha;c.beginPath();
          c.moveTo(start.x,start.y);c.quadraticCurveTo(control.x,control.y,current.x,current.y);c.stroke();
        }
      }else{
        for(const [widthScale,alpha] of [[.18,.16],[.04,.75]]){
          c.lineWidth=Math.max(1,size*widthScale);c.globalAlpha=(1-p)*alpha;c.beginPath();
          c.moveTo(start.x,start.y);
          for(let i=1;i<=index;i++){const tile=center(route[i]);c.lineTo(tile.x,tile.y);}
          c.lineTo(current.x,current.y);c.stroke();
        }
        const previous=center(route[index]),next=center(route[index+1]);
        const dx=next.x-previous.x,dy=next.y-previous.y,length=Math.hypot(dx,dy)||1;
        const forward={x:dx/length,y:dy/length},side={x:-forward.y,y:forward.x};
        for(let i=0;i<5;i++){
          const offset=(i-2)*size*.1;
          c.globalAlpha=(1-p)*(.22+(i%2)*.18);c.lineWidth=Math.max(1,size*.02);c.beginPath();
          c.moveTo(current.x-forward.x*size*.25+side.x*offset,current.y-forward.y*size*.25+side.y*offset);
          c.lineTo(current.x-forward.x*size*.55+side.x*offset,current.y-forward.y*size*.55+side.y*offset);c.stroke();
        }
      }
      c.globalAlpha=beat*.75;c.lineWidth=Math.max(1,size*.03);c.beginPath();
      c.arc(current.x,current.y,size*(.16+beat*.12),0,Math.PI*2);c.stroke();
    }
    c.restore();return true;
  }
  return Object.freeze({moveFor,draw,drawMotion});
});

/* Canvas effects for the equipped manuals. The battlefield rules supply all
   cells, rays and movement; these drawings never decide damage or targeting. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QATacticalSkillEffects=api;
})(globalThis,()=>{
  'use strict';
  const manuals=()=>typeof module==='object'&&module.exports
    ?require('./manual-rules.js'):globalThis.QAManuals;
  const animation=()=>typeof module==='object'&&module.exports
    ?require('./tactical-animation.js'):globalThis.QATacticalAnimation;
  const rules=()=>typeof module==='object'&&module.exports
    ?require('./tactical-rules.js'):globalThis.QATactical;
  const moves=new Set([
    'wind-slash','wind-step','wind-thousand','flight-summon','sky-cloud','sky-sever',
    'rock-fist','rock-quake','rock-break','dragon-guard','dragon-roar','tiger-step','tiger-throw'
  ]);
  const heavyMoves=new Set(['rock-fist','rock-quake','rock-break','dragon-guard','tiger-step','tiger-throw','wind-thousand','sky-sever']);
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
    const strikeTime=index=>animation().strikeTime(scene,index);
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
    const beam=(start,end,t,color=ink,width=.1,strength=beat)=>{
      const q=clamp(t),tip=point(start,end,q);
      glow(color,.22);
      stroke(start,tip,color,width*2,.17*strength);
      stroke(start,tip,color,width,.65*strength);
      stroke(start,tip,bright,width*.26,.9*strength);
      return tip;
    };
    const heavyImpact=()=>{
      if(!heavyMoves.has(move)||(!scene.parallelImpact&&!scene.throwImpact)||
        !(p>scene.impactStart&&p<scene.impactStart+.26))return;
      const burst=phase(p,scene.impactStart,scene.impactStart+.26),force=pulse(burst);
      const victims=scene.throwImpact?(scene.moves||[]).filter(m=>m.timing==='manual-throw').map(m=>({uid:m.uid})):
        (scene.numbers||[]).filter(n=>n.uid!==scene.actor&&n.damage!==undefined);
      for(const number of victims){
        const victim=scene.before?.find(a=>a.uid===number.uid);if(!victim)continue;
        const motion=(scene.moves||[]).find(m=>m.uid===number.uid),path=motion?.path;
        let contact=center(victim);
        if(path?.length>1){
          const q=motion.timing==='manual-throw'?phase(p,.28,.81):phase(p,scene.impactStart,1);
          const travel=motion.timing==='manual-throw'?q*q*(3-2*q):move==='dragon-guard'?q:1-(1-q)**3;
          const t=travel*(path.length-1),i=Math.min(path.length-2,Math.floor(t));
          contact=center(point(path[i],path[i+1],t-i));
        }
        const strength=(scene.step===4?1.15:1)*force,primary=sword?jade:gold,secondary=sword?white:ember;
        glow(secondary,.22);c.globalAlpha=Math.min(1,strength*.38);c.fillStyle=bright;
        c.beginPath();c.arc(contact.x,contact.y,size*(.20+burst*.18),0,Math.PI*2);c.fill();
        circle(contact,.20+burst*.65,strength*.9,primary,.065);
        circle(contact,.13+burst*.38,strength*.9,bright,.035);
        for(let i=0;i<10;i++){
          const angle=i*Math.PI/5,inner=(.18+burst*.25)*size,outer=(.42+burst*.5)*size;
          stroke({x:contact.x+Math.cos(angle)*inner,y:contact.y+Math.sin(angle)*inner},
            {x:contact.x+Math.cos(angle)*outer,y:contact.y+Math.sin(angle)*outer},i%2?primary:bright,.035,strength*.9);
        }
        for(let i=0;i<6;i++){
          const angle=i*Math.PI/3+.25,travel=(.2+burst*.5)*size;
          const x=contact.x+Math.cos(angle)*travel,y=contact.y+Math.sin(angle)*travel*.7;
          c.globalAlpha=strength*.8;c.fillStyle=i%2?secondary:primary;c.beginPath();
          c.moveTo(x,y-size*.06);c.lineTo(x+size*.055,y+size*.035);c.lineTo(x-size*.035,y+size*.04);c.closePath();c.fill();
        }
      }
    };
    c.save();c.beginPath();c.rect(ox,Math.max(0,oy-size*.35),size*width,size*(height+.35));c.clip();
    if(!above){
      // Ground marks follow the committed cells, including walls and truncated rays.
      const markedCells=move==='sky-cloud'||move==='sky-sever'?[]:cells;
      for(const tile of markedCells){
        const at=center(tile);c.globalAlpha=beat*.1;c.fillStyle=ink;
        c.fillRect(ox+tile.x*size+2,oy+tile.y*size+2,size-4,size-4);
        if(move!=='wind-step')circle(at,.29+beat*.05,beat*.25,ink,.014);
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
      c.save();c.beginPath();
      for(const tile of cells)c.rect(ox+tile.x*size,oy+tile.y*size,size,size);
      c.clip();c.translate(to.x,to.y);c.rotate(Math.atan2(dy,dx));
      for(let i=0;i<2;i++){
        const time=p-strikeTime(i);
        if(time<-.13||time>.18)continue;
        const strength=time<=0?1+time/.13:1-time/.18;
        const x=size*time*1.6,reach=size*1.5;
        glow(jade,.19);c.globalAlpha=strength*.5;c.fillStyle=jade;
        c.beginPath();c.moveTo(x,-reach);
        c.quadraticCurveTo(x+size*.42,0,x,reach);
        c.quadraticCurveTo(x+size*.14,0,x,-reach);c.closePath();c.fill();
        c.globalAlpha=strength;c.strokeStyle=white;c.lineWidth=Math.max(1,size*.045);
        c.beginPath();c.moveTo(x,-reach);c.quadraticCurveTo(x+size*.42,0,x,reach);c.stroke();
      }
      c.restore();
    }else if(move==='wind-thousand'){
      // The full ray reaches the targets at the same beat as knockback starts.
      const hitAt=strikeTime(0),lightEnd=.67;
      const end=hit.at(-1)||to,q=phase(p,.08,hitAt),tip=point(from,end,q);
      const light=phase(p,.08,.25)*(1-phase(p,hitAt,lightEnd));
      // Hold the larger greatsword after the flash clears, then fade the shadow.
      const bladeAlpha=phase(p,.18,.33)*(1-phase(p,lightEnd+.05,1));
      if(bladeAlpha>0){
        c.save();c.translate(tip.x,tip.y);c.rotate(Math.atan2(dy,dx));glow('#71caff',.3);
        const unit=size*2.25;
        c.fillStyle='#8bddff';c.strokeStyle='#c8f4ff';c.lineWidth=Math.max(1,size*.04);
        c.beginPath();c.moveTo(-unit*.95,-unit*.125);c.lineTo(-unit*.18,-unit*.118);
        c.lineTo(unit*.16,0);c.lineTo(-unit*.18,unit*.118);c.lineTo(-unit*.95,unit*.125);c.closePath();
        c.globalAlpha=bladeAlpha*.52;c.fill();c.globalAlpha=bladeAlpha*.9;c.stroke();
        stroke({x:-unit*.95,y:-unit*.23},{x:-unit*.95,y:unit*.23},'#8bddff',.085,bladeAlpha*.9);
        stroke({x:-unit*1.20,y:0},{x:unit*.12,y:0},'#c8f4ff',.05,bladeAlpha*.8);
        c.restore();
      }
      if(light>0){
        beam(from,end,q,jade,.12,light);
        crescent(tip,Math.atan2(dy,dx),phase(p,.08,lightEnd),white,1.15);
        if(p>hitAt)impact(tip,phase(p,hitAt,lightEnd),jade);
      }
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
    }else if(move==='sky-cloud'){
      const cuts=scene.cuts||rules().crossedSwordLines(scene.rays||[],target);
      for(const [index,cut] of cuts.entries()){
        if(cut.length<2)continue;
        const time=p-strikeTime(index);
        if(time<=-.12||time>=.13)continue;
        const middle=cut.findIndex(tile=>tile.x===target.x&&tile.y===target.y)/(cut.length-1);
        const progress=time<0?middle*phase(time,-.12,0):middle+(1-middle)*phase(time,0,.065);
        const strength=phase(time,-.12,-.03)*(1-phase(time,.04,.13));
        const start=center(cut[0]),end=center(cut.at(-1)),tip=point(start,end,progress);
        const tail=point(start,end,Math.min(progress,phase(time,.015,.14)));
        glow(jade,.16);
        stroke(tail,tip,jade,.21,strength*.42);
        stroke(tail,tip,white,.068,strength);
      }
    }else if(move==='sky-sever'){
      const hitAt=strikeTime(0),launchAt=hitAt-.14;
      const gather=phase(p,launchAt,hitAt),charge=phase(p,0,.17);
      for(const ray of scene.rays||[]){
        if(!ray.length||p>=hitAt)continue;
        const start=center(ray.at(-1));
        glow(jade,.23);
        if(p<launchAt){
          circle(start,.17+charge*.12,charge*.85,jade,.038);
          c.globalAlpha=charge;c.fillStyle=white;c.beginPath();
          c.arc(start.x,start.y,size*(.035+charge*.05),0,Math.PI*2);c.fill();
        }else{
          const tip=point(start,to,gather),tail=point(start,to,Math.max(0,gather-.28));
          stroke(tail,tip,jade,.17,.54);
          stroke(tail,tip,white,.065,1);
        }
      }
      if(p>=hitAt&&p<hitAt+.22){
        const q=phase(p,hitAt,hitAt+.22);
        glow(jade,.28);c.globalAlpha=1-q;c.fillStyle=white;c.beginPath();
        c.arc(to.x,to.y,size*(.14+q*.27),0,Math.PI*2);c.fill();
        circle(to,.15+q*.58,1-q,jade,.058);
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
      const q=phase(p,.04,.9),advance=(scene.moves||[]).find(m=>m.timing==='chain-advance');
      const foot=advance?center(point(advance.path[0],advance.path.at(-1),p)):from;
      const aim=advance?{x:foot.x+axis.x*size*.8,y:foot.y+axis.y*size*.8}:to;
      const at=point(foot,aim,advance?phase(p,.02,.15):q);
      const burst=scene.parallelImpact?phase(p,scene.impactStart,scene.impactStart+.26):0;
      const force=scene.parallelImpact&&p>scene.impactStart&&p<scene.impactStart+.26?pulse(burst):0;
      fist(at,Math.atan2(dy,dx)+(Math.floor((scene.step||1)%2)?-.12:.12),q,1.18+force*.22);
      for(const tile of cells){
        const pushed=(scene.moves||[]).find(m=>m.timing!=='chain-advance'&&m.path?.[0]?.x===tile.x&&m.path[0].y===tile.y);
        let impactPoint=center(tile);
        if(pushed?.path.length>1&&scene.parallelImpact){
          const path=pushed.path,t=phase(p,scene.impactStart,1)*(path.length-1),i=Math.min(path.length-2,Math.floor(t));
          impactPoint=center(point(path[i],path[i+1],t-i));
        }
        impact(impactPoint,phase(p,.15,1),ember);
      }
      sparks(at,10,gold,.48);
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
        const when=strikeTime(i),q=phase(p,when-.15,when+.15);
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
    heavyImpact();c.restore();return true;
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
      const distance=(motion.timing==='chain-advance'?p:motion.timing==='manual-throw'?p*p*(3-2*p):scene.style==='dash'?1-(1-p)**3:p)*(route.length-1);
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

/* Seed-stable spiritual illumination. Visual only: never changes cells, collision or fog. */
(function(root){
  'use strict';
  const TONE={
    gold:['255,225,151','255,245,209'],
    jade:['166,242,214','217,255,235'],
    violet:['201,187,255','242,228,255']
  };
  function profile(o){
    if(o.kind==='sect')return {tone:'gold',radius:245,ring:87,beam:205,motes:26};
    if(o.kind==='realm'){
      const tone=/靈泉/.test(o.name||'')?'jade':/星/.test(o.name||'')?'violet':'gold';
      return {tone,radius:118,ring:46,beam:128,motes:11};
    }
    if(o.id==='shrine'||o.subtype==='shrine')return {tone:'gold',radius:130,ring:48,beam:112,motes:12};
    if(o.id==='raid'||o.id==='meditation')return {tone:'jade',radius:138,ring:0,beam:65,motes:8};
    if(o.kind==='building')return {tone:'gold',radius:104,ring:0,beam:0,motes:5};
    return null;
  }
  function motes(world,o,count){
    const result=[];
    for(let i=0;i<count;i++){
      const h=world.hash(o.x+i*17,o.y-i*29,180+i%5),h2=world.hash(o.x-i*13,o.y+i*11,188);
      const a=(h%4096)/4096*Math.PI*2,r=.18+(h2%1000)/1000*.82;
      result.push({dx:Math.cos(a)*r,dy:Math.sin(a)*r,phase:(h>>>8)%1000/1000*Math.PI*2,size:.8+((h2>>>9)%100)/100*1.1});
    }
    return result;
  }
  function create(world,canvasFactory=()=>document.createElement('canvas')){
    const haloCache=new Map(),particleCache=new Map();
    function halo(tone){
      if(haloCache.has(tone))return haloCache.get(tone);
      const canvas=canvasFactory();canvas.width=canvas.height=256;
      const c=canvas.getContext('2d'),g=c.createRadialGradient(128,128,2,128,128,125),rgb=TONE[tone][0];
      g.addColorStop(0,'rgba('+rgb+',.24)');
      g.addColorStop(.22,'rgba('+rgb+',.16)');
      g.addColorStop(.57,'rgba('+rgb+',.065)');
      g.addColorStop(1,'rgba('+rgb+',0)');
      c.fillStyle=g;c.fillRect(0,0,256,256);
      haloCache.set(tone,canvas);return canvas;
    }
    function glyph(c,x,y,r,tone){
      const rgb=TONE[tone][1];c.save();c.strokeStyle='rgba('+rgb+',.24)';c.lineWidth=.85;
      c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.stroke();
      c.strokeStyle='rgba('+rgb+',.12)';c.beginPath();c.arc(x,y,r*1.25,0,Math.PI*2);c.stroke();
      for(let i=0;i<8;i++){
        const a=i*Math.PI/4,inner=r*1.31,outer=r*(i%2?1.42:1.51);
        c.beginPath();c.moveTo(x+Math.cos(a)*inner,y+Math.sin(a)*inner*.6);
        c.lineTo(x+Math.cos(a)*outer,y+Math.sin(a)*outer*.6);c.stroke();
      }
      c.restore();
    }
    function drawGround(c,anchors,at){
      for(const o of anchors){
        const p=profile(o);if(!p)continue;
        const x=(o.x+.5)*40,y=(o.y+.57)*40,w=p.radius*2;
        c.save();c.globalAlpha=.78+.08*Math.sin(at/2700+o.x*.5);
        c.drawImage(halo(p.tone),x-p.radius,y-p.radius*.66,w,p.radius*1.32);
        c.restore();
        if(p.ring)glyph(c,x,y+9,p.ring,p.tone);
      }
    }
    function drawBeam(c,x,y,p,t){
      if(!p.beam)return;
      const beamH=p.beam,drift=Math.sin(t/4000+x*.01)*6,rgb=TONE[p.tone][0],top=y-beamH;
      const g=c.createLinearGradient(x,top,x,y+12);
      g.addColorStop(0,'rgba('+rgb+',0)');
      g.addColorStop(.45,'rgba('+rgb+',.040)');
      g.addColorStop(.82,'rgba('+rgb+',.085)');
      g.addColorStop(1,'rgba('+rgb+',0)');
      c.fillStyle=g;c.beginPath();
      c.moveTo(x-16+drift,top);c.lineTo(x+13+drift,top);
      c.lineTo(x+34,y+8);c.lineTo(x-37,y+8);c.closePath();c.fill();
    }
    function drawAir(c,anchors,at,motion=true){
      c.save();c.globalCompositeOperation='screen';
      for(const o of anchors){
        const p=profile(o);if(!p)continue;
        const x=(o.x+.5)*40,y=(o.y+.5)*40,rgb=TONE[p.tone][1];
        if(p.beam)drawBeam(c,x,y,p,at);
        const key=o.kind+':'+(o.id||o.name||'')+':'+o.x+':'+o.y;
        if(!particleCache.has(key)){
          if(particleCache.size>192)particleCache.clear();
          particleCache.set(key,motes(world,o,p.motes));
        }
        const spread=p.radius*.65;
        for(const m of particleCache.get(key)){
          const phase=motion?at/2400+m.phase:m.phase;
          const px=x+m.dx*spread+Math.sin(phase*.75)*2.6;
          const py=y+m.dy*spread*.59-(motion?(at/1000*3+m.phase*13)%19:0);
          const alpha=(.24+.21*(.5+.5*Math.sin(phase*1.4)))*(p.tone==='gold'?1:.9);
          c.fillStyle='rgba('+rgb+','+alpha+')';c.beginPath();c.arc(px,py,m.size,0,Math.PI*2);c.fill();
          if(m.size>1.55&&Math.sin(m.phase*3)>0){
            c.strokeStyle='rgba('+rgb+','+(alpha*.55)+')';c.lineWidth=.6;
            c.beginPath();c.moveTo(px-3,py);c.lineTo(px+3,py);c.moveTo(px,py-3);c.lineTo(px,py+3);c.stroke();
          }
        }
      }
      c.restore();
    }
    return Object.freeze({world,drawGround,drawAir});
  }
  const api=Object.freeze({profile,motes,create});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QAGridWorldAura=api;
})(globalThis);

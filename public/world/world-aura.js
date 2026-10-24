/* Static seed-stable spiritual illumination; no per-frame particles or global blending. */
(function(root){
  'use strict';
  const TONE=Object.freeze({
    gold:['255,225,151','255,245,209'],
    jade:['166,242,214','217,255,235'],
    violet:['201,187,255','242,228,255']
  });
  function profile(o){
    if(o.kind==='sect')return {tone:'gold',radius:245,ring:87,beam:205,motes:26};
    if(o.kind==='realm')return {tone:/靈泉/.test(o.name||'')?'jade':/星/.test(o.name||'')?'violet':'gold',radius:118,ring:46,beam:128,motes:11};
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
  function glyph(c,x,y,r,tone){
    const rgb=TONE[tone][1];c.save();
    c.strokeStyle='rgba('+rgb+',.18)';c.lineWidth=.9;
    c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.stroke();
    c.strokeStyle='rgba('+rgb+',.10)';c.beginPath();c.arc(x,y,r*1.25,0,Math.PI*2);c.stroke();
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4,inner=r*1.31,outer=r*(i%2?1.42:1.51);
      c.beginPath();c.moveTo(x+Math.cos(a)*inner,y+Math.sin(a)*inner*.6);
      c.lineTo(x+Math.cos(a)*outer,y+Math.sin(a)*outer*.6);c.stroke();
    }
    c.restore();
  }
  function create(world,canvasFactory=()=>document.createElement('canvas')){
    const groundCache=new Map(),airCache=new Map();
    function groundBitmap(p){
      const key=[p.tone,p.radius,p.ring].join(':');
      if(groundCache.has(key))return groundCache.get(key);
      const bitmap=canvasFactory();
      bitmap.width=Math.ceil(p.radius*2+4);bitmap.height=Math.ceil(p.radius*1.42+44);
      const c=bitmap.getContext('2d'),x=bitmap.width/2,y=bitmap.height/2,rgb=TONE[p.tone][0];
      c.save();c.translate(x,y);c.scale(1,.66);
      const g=c.createRadialGradient(0,0,2,0,0,p.radius);
      g.addColorStop(0,'rgba('+rgb+',.16)');g.addColorStop(.25,'rgba('+rgb+',.12)');
      g.addColorStop(.62,'rgba('+rgb+',.045)');g.addColorStop(1,'rgba('+rgb+',0)');
      c.fillStyle=g;c.fillRect(-p.radius,-p.radius,p.radius*2,p.radius*2);c.restore();
      if(p.ring)glyph(c,x,y+9,p.ring,p.tone);
      groundCache.set(key,bitmap);
      return bitmap;
    }
    function airBitmap(o,p){
      const key=[o.kind,o.id||o.name||'',o.x,o.y,p.tone,p.radius].join(':');
      if(airCache.has(key))return airCache.get(key);
      const bitmap=canvasFactory(),top=Math.ceil(Math.max(p.beam,p.radius*.48)+14);
      bitmap.width=Math.ceil(Math.max(95,p.radius*1.46));
      bitmap.height=Math.ceil(top+p.radius*.48+20);
      const c=bitmap.getContext('2d'),x=bitmap.width/2,y=top;
      if(p.beam){
        const rgb=TONE[p.tone][0],g=c.createLinearGradient(x,y-p.beam,x,y+10);
        g.addColorStop(0,'rgba('+rgb+',0)');g.addColorStop(.45,'rgba('+rgb+',.025)');
        g.addColorStop(.8,'rgba('+rgb+',.065)');g.addColorStop(1,'rgba('+rgb+',0)');
        c.fillStyle=g;c.beginPath();
        c.moveTo(x-13,y-p.beam);c.lineTo(x+13,y-p.beam);
        c.lineTo(x+30,y+8);c.lineTo(x-30,y+8);c.closePath();c.fill();
      }
      const rgb=TONE[p.tone][1],spread=p.radius*.65;
      for(const m of motes(world,o,p.motes)){
        const px=x+m.dx*spread,py=y+m.dy*spread*.59-8;
        c.fillStyle='rgba('+rgb+',.30)';c.beginPath();c.arc(px,py,m.size,0,Math.PI*2);c.fill();
      }
      const sprite={bitmap,top};
      if(airCache.size>=48)airCache.delete(airCache.keys().next().value);
      airCache.set(key,sprite);
      return sprite;
    }
    function drawGround(c,anchors){
      for(const o of anchors){
        const p=profile(o);if(!p)continue;
        const x=(o.x+.5)*40,y=(o.y+.57)*40,img=groundBitmap(p);
        c.drawImage(img,x-img.width/2,y-img.height/2);
      }
    }
    function drawAir(c,anchors){
      for(const o of anchors){
        const p=profile(o);if(!p)continue;
        const sprite=airBitmap(o,p),x=(o.x+.5)*40,y=(o.y+.5)*40;
        c.drawImage(sprite.bitmap,x-sprite.bitmap.width/2,y-sprite.top);
      }
    }
    return Object.freeze({world,drawGround,drawAir,get cachedGround(){return groundCache.size;},get cachedAir(){return airCache.size;}});
  }
  const api=Object.freeze({profile,motes,create});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QAGridWorldAura=api;
})(globalThis);

/* Objective artwork and hit/destruction VFX: client-only, deterministic.
 * Never writes HP, blocks, objectives or battle events. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QATacticalObjectiveVisuals=api;
})(globalThis,()=>{
  'use strict';
  const PALETTE=Object.freeze({
    shield:'#72ddff',hazard:'#d981f6',rage:'#ffc577',maze:'#74ecc0',
    guardian:'#a0f5d2'
  });
  const key=p=>p.x+','+p.y;
  const valid=s=>s?.mode==='pve'&&s.trial?.layoutVersion===4;
  const clamp=n=>Math.max(0,Math.min(1,n));
  function guardianFrame(objective){
    const max=Number(objective?.maxHp)||0,hp=Number(objective?.hp)||0;
    if(max<=0||hp<=0)return 2;
    return hp/max<=.50?1:0;
  }
  function transitions(before,after){
    if(!valid(before)||!valid(after)||before.id!==after.id||
      before.trial?.stage!==after.trial?.stage||
      before.trial?.layoutHash!==after.trial?.layoutHash||
      (Number.isFinite(before.revision)&&Number.isFinite(after.revision)&&
       after.revision<=before.revision))return [];
    const old=before.objective,next=after.objective;
    if(!old||!next||old.type!==next.type)return [];
    if(next.type==='sealing'){
      const history=new Map((old.points||[]).map(p=>[key(p),p]));
      return (next.points||[]).flatMap(p=>{
        const prev=history.get(key(p));
        if(!prev||prev.kind!==p.kind||prev.activated||!(Number(p.hp)<Number(prev.hp)))return [];
        const broken=!!p.activated||p.hp<=0;
        return [{x:p.x,y:p.y,kind:p.kind,broken,fromHp:prev.hp,toHp:p.hp,
          duration:broken?760:480}];
      });
    }
    if(next.type==='defense'&&old.shrine&&next.shrine&&
      key(old.shrine)===key(next.shrine)&&Number(next.hp)<Number(old.hp))
      return [{x:next.shrine.x,y:next.shrine.y,kind:'guardian',
        broken:next.hp<=0,fromHp:old.hp,toHp:next.hp,duration:next.hp<=0?850:470}];
    return [];
  }
  // Draws into an isolated, clipped canvas state. Returns whether another
  // frame is needed; queue is presentation state, never a battle snapshot.
  function draw(ctx,queue,now,view,reduced=false){
    if(!Array.isArray(queue)||!queue.length)return false;
    if(reduced){queue.length=0;return false;}
    const {ox,oy,cell,width,height}=view||{};
    if(!(cell>0&&width>0&&height>0))return false;
    ctx.save();
    ctx.beginPath();ctx.rect(ox,oy,cell*width,cell*height);ctx.clip();
    let any=false;
    for(let i=queue.length-1;i>=0;i--){
      const cue=queue[i];
      if(cue.started===null||cue.started===undefined)cue.started=now;
      const p=clamp((now-cue.started)/cue.duration);
      if(p>=1){queue.splice(i,1);continue;}
      any=true;
      const x=ox+(cue.x+.5)*cell,y=oy+(cue.y+.38)*cell;
      const color=PALETTE[cue.kind]||'#c7e8cd';
      const fade=Math.pow(1-p,1.4),ring=cell*(cue.broken?.20:.13)+cell*p*(cue.broken?.62:.34);
      ctx.save();
      ctx.globalAlpha=fade*(cue.broken?.9:.64);
      ctx.strokeStyle=color;ctx.lineWidth=Math.max(1.2,cell*(cue.broken?.055:.038));
      ctx.beginPath();ctx.ellipse(x,y,ring,ring*.66,0,0,Math.PI*2);ctx.stroke();
      if(cue.broken){
        ctx.globalAlpha=fade*.52;
        ctx.beginPath();ctx.ellipse(x,y,ring*.72,ring*.38,0,0,Math.PI*2);ctx.stroke();
      }
      const fragments=cue.broken?14:7;
      const seed=cue.x*1.71+cue.y*.91+cue.kind.length;
      for(let n=0;n<fragments;n++){
        const angle=n*2.399963229728653+seed;
        const amount=cell*(cue.broken?.13:.10)+p*cell*(cue.broken?.64:.32);
        const fx=x+Math.cos(angle)*amount;
        const fy=y+Math.sin(angle)*amount*.72-p*p*cell*.16;
        const part=cell*(cue.broken?.075:.045)*(1-p*.72);
        ctx.globalAlpha=fade*(.7+.3*Math.sin(n*7.1)**2);
        ctx.fillStyle=color;
        ctx.beginPath();
        ctx.moveTo(fx,fy-part);ctx.lineTo(fx+part*.62,fy);
        ctx.lineTo(fx,fy+part);ctx.lineTo(fx-part*.62,fy);
        ctx.closePath();ctx.fill();
      }
      if(p<.30){
        ctx.globalAlpha=(1-p/.30)*(cue.broken?.53:.37);
        ctx.fillStyle='#eafff7';
        ctx.beginPath();ctx.ellipse(x,y,cell*.18,cell*.26,0,0,Math.PI*2);ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
    return any;
  }
  return Object.freeze({PALETTE,guardianFrame,transitions,draw});
});

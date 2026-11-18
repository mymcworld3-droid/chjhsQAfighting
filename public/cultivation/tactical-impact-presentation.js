/* Presentation-only combat feedback, shared by the renderer and boss HUD.
 * Everything is derived from committed event scenes and read-only room snapshots.
 * No damage prediction, event writes, timers or browser UI dependencies.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QATacticalImpact=api;
})(globalThis,()=>{
  'use strict';
  const TAU=Math.PI*2;
  const clamp=(n,min=0,max=1)=>Math.min(max,Math.max(min,Number(n)||0));
  const positive=n=>Math.max(0,Number(n)||0);
  function bossFor(state){
    if(state?.mode!=='pve'||state?.objective?.type!=='boss')return null;
    const boss=state.actors?.find(a=>a.uid===state.objective.bossUid&&a.boss);
    return boss||null;
  }
  function bossStatus(state){
    const boss=bossFor(state);
    if(!boss)return null;
    const total=Math.max(1,positive(boss.maxHp)),hp=clamp(positive(boss.hp),0,total);
    return {uid:String(boss.uid),name:String(boss.name||'鎮關靈獸'),
      hp,maxHp:total,ratio:hp/total,phase:boss.phase===2?2:1,
      kind:['rock','vine','flame'].includes(boss.bossKind)?boss.bossKind:'rock',
      intent:String(boss.intent?.text||'觀察靈獸動向'),alive:hp>0};
  }
  function phaseTransition(before,after){
    if(!before||!after||before.id!==after.id)return null;
    const oldBoss=bossStatus(before),newBoss=bossStatus(after);
    if(!oldBoss||!newBoss||oldBoss.uid!==newBoss.uid||!newBoss.alive)return null;
    if(oldBoss.phase===1&&newBoss.phase===2)return {type:'phase',name:newBoss.name,phase:2,kind:newBoss.kind};
    return null;
  }
  const damaging=number=>number&&typeof number.uid==='string'&&(
    positive(number.damage)>0||positive(number.absorbed)>0);
  function hitWindows(scene,animation){
    if(!scene||!['cast','damage'].includes(scene.kind))return [];
    const out=[];
    if(scene.kind==='cast'&&Array.isArray(scene.strikeImpacts)){
      for(const [i,hits]of scene.strikeImpacts.entries()){
        const targets=(hits||[]).filter(damaging);
        if(targets.length)out.push({at:clamp(animation?.strikeTime?.(scene,i)??.4),targets,index:i});
      }
    }else if(scene.kind==='cast'&&scene.parallelImpact){
      const targets=(scene.numbers||[]).filter(damaging);
      if(targets.length)out.push({at:clamp(scene.impactStart??.4),targets,index:0});
    }else if(scene.kind==='damage'){
      const targets=(scene.numbers||[]).filter(damaging);
      if(targets.length)out.push({at:.12,targets,index:0});
    }
    return out;
  }
  function contactAt(scene,progress,animation){
    return hitWindows(scene,animation).map(win=>({
      ...win,age:(clamp(progress)-win.at)/.22
    })).filter(win=>win.age>=0&&win.age<=1);
  }
  function shake(scene,progress,animation){
    const effects=contactAt(scene,progress,animation);
    return Math.min(.55,effects.reduce((value,effect)=>{
      return Math.max(value,(1-effect.age)**2*.43);
    },0));
  }
  function style(scene){
    const source=scene?.before?.find(a=>a.uid===scene.actor);
    if(source?.bot)return {main:'#f1a078',light:'#ffd9ab',dust:'#e9a97d'};
    if(/^(wind|sky|flight)/.test(scene?.skill||''))return {main:'#85dfc9',light:'#dbfff2',dust:'#9acdbb'};
    return {main:'#eec07c',light:'#fff2c7',dust:'#e4b784'};
  }
  function drawHitEffects(ctx,scene,progress,view,animation){
    if(!ctx||!scene||!view||!Number.isFinite(view.cell))return;
    const hits=contactAt(scene,progress,animation);
    if(!hits.length)return;
    const actors=animation?.sample?.(scene,progress)||scene.before||[];
    const {ox,oy,cell}=view,colors=style(scene);
    ctx.save();
    ctx.beginPath();ctx.rect(ox,oy,cell*view.width,cell*view.height);ctx.clip();
    for(const window of hits){
      const q=window.age,fade=(1-q)**1.6;
      for(const damage of window.targets){
        const actor=actors.find(a=>a.uid===damage.uid);
        if(!actor)continue;
        const centerX=ox+(actor.x+(actor.boss?1:.5))*cell;
        const centerY=oy+(actor.y+(actor.boss?1:.5)-.08)*cell;
        const size=cell*(actor.boss?1.65:1);
        ctx.save();ctx.globalAlpha=fade*.73;
        const glow=ctx.createRadialGradient(centerX,centerY,0,centerX,centerY,size*.52);
        glow.addColorStop(0,'rgba(255,244,215,.17)');
        glow.addColorStop(.45,'rgba(255,244,215,.075)');
        glow.addColorStop(1,'rgba(255,244,215,0)');
        ctx.fillStyle=glow;ctx.beginPath();ctx.arc(centerX,centerY,size*.52,0,TAU);ctx.fill();
        ctx.strokeStyle=positive(damage.absorbed)>0&&!positive(damage.damage)?'#b9e3ed':colors.main;
        ctx.lineWidth=Math.min(4,Math.max(1.3,cell*.045))*(1-q*.65);
        ctx.beginPath();ctx.ellipse(centerX,centerY,size*(.20+.37*q),size*(.13+.23*q),0,0,TAU);ctx.stroke();
        // Short radial shards read like a contact impact, not an extra attack.
        const count=actor.boss?12:8;
        for(let j=0;j<count;j++){
          const theta=(j+window.index*.41)*TAU/count;
          const radius=size*(.18+q*.43),length=size*(.075+q*.04);
          const sx=centerX+Math.cos(theta)*radius,sy=centerY+Math.sin(theta)*radius*.8;
          ctx.globalAlpha=fade*(j%3===0?.66:.44);
          ctx.strokeStyle=j%3===0?colors.light:colors.dust;
          ctx.lineWidth=Math.max(1,cell*.018);
          ctx.beginPath();ctx.moveTo(sx,sy);
          ctx.lineTo(sx+Math.cos(theta)*length,sy+Math.sin(theta)*length*.8);ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }
  function drawBossPresence(ctx,boss,view,time,reduced=false){
    if(!boss||positive(boss.hp)<=0||!ctx||!view)return;
    const {ox,oy,cell}=view;
    const x=ox+(boss.x+(boss.footprint?.width||2)/2)*cell;
    const y=oy+(boss.y+(boss.footprint?.height||2)/2)*cell;
    const radius=cell*1.16,phase2=boss.phase===2;
    const palette=boss.bossKind==='vine'?'#a2d1a5':boss.bossKind==='flame'?'#ef9977':'#d7bf92';
    const breath=reduced?0:Math.sin((Number(time)||0)*.00145);
    ctx.save();
    ctx.beginPath();ctx.rect(ox,oy,cell*view.width,cell*view.height);ctx.clip();
    const glow=ctx.createRadialGradient(x,y,cell*.20,x,y,radius*1.55);
    const center=boss.bossKind==='flame'?'rgba(221,94,51,.16)':
      boss.bossKind==='vine'?'rgba(113,197,141,.13)':'rgba(221,187,126,.12)';
    glow.addColorStop(0,center);glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.globalAlpha=phase2?.90:.70;ctx.fillStyle=glow;
    ctx.beginPath();ctx.ellipse(x,y,radius*1.52,radius*1.25,0,0,TAU);ctx.fill();
    ctx.strokeStyle=palette;ctx.lineWidth=Math.max(1,cell*.025);
    ctx.globalAlpha=phase2?.42:.28;
    ctx.beginPath();ctx.ellipse(x,y+cell*.19,radius*(.83+breath*.018),radius*.42,0,0,TAU);ctx.stroke();
    if(phase2){
      ctx.strokeStyle=palette;ctx.globalAlpha=.20;
      ctx.setLineDash([cell*.12,cell*.17]);
      ctx.beginPath();ctx.ellipse(x,y+cell*.19,radius*(1.05+breath*.025),radius*.56,0,0,TAU);ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
  function drawPhaseWave(ctx,scene,progress,view){
    if(scene?.kind!=='cast'||!String(scene.label||'').includes('進入第二階段'))return;
    const actor=scene.before?.find(a=>a.uid===scene.actor);
    if(!actor)return;
    const p=clamp(progress),{ox,oy,cell}=view;
    const x=ox+(actor.x+(actor.boss?1:.5))*cell;
    const y=oy+(actor.y+(actor.boss?1:.5)) *cell;
    ctx.save();ctx.beginPath();ctx.rect(ox,oy,cell*view.width,cell*view.height);ctx.clip();
    ctx.strokeStyle=actor.bossKind==='vine'?'#b1e5ae':'#f1b18b';
    ctx.lineWidth=Math.max(2,cell*.055)*(1-p*.55);ctx.globalAlpha=(1-p)*.65;
    for(let i=0;i<2;i++){
      const q=Math.max(0,(p-i*.24)/(1-i*.24));
      if(!q||q>=1)continue;
      ctx.beginPath();ctx.arc(x,y,cell*(.45+q*2.25),0,TAU);ctx.stroke();
    }
    ctx.restore();
  }
  return Object.freeze({bossFor,bossStatus,phaseTransition,hitWindows,contactAt,shake,drawHitEffects,drawBossPresence,drawPhaseWave});
});

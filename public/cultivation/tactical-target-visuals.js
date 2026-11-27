/* Selection previews for the real battle. Geometry and optional private cast simulation.
 * Do not mutate combat state or submit commands.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QATacticalTargetVisuals=api;
})(globalThis,()=>{
  'use strict';
  const key=p=>p.x+','+p.y;
  const clamp=(n,low,high)=>Math.min(high,Math.max(low,n));
  const restricted=(s,p)=>!p||!Number.isInteger(p.x)||!Number.isInteger(p.y)||
    p.x<0||p.y<0||p.x>=s.width||p.y>=s.height;
  function derive(s,uid,mode,selection,rules,threats,skillPlan){
    if(s?.mode!=='pve'||!selection||restricted(s,selection)||!rules)return null;
    const me=s.actors?.find(a=>a.uid===uid);
    if(!me||me.hp<=0)return null;
    const result={type:mode==='move'?'move':'attack',
      target:{x:selection.x,y:selection.y},valid:false,cost:0,remaining:Number(me.stamina)||0,
      route:[],affected:[],cells:[],label:'',hint:'',threatened:false};
    const currentTurn=s.status==='active'&&s.turnUid===uid&&
      (!s.quizRound||s.phase==='action');
    if(mode==='move'){
      const route=rules.path(s,me,selection,me.uid);
      if(!route||route.length<2){
        result.label='無法到達';result.hint='請選擇可通行的灰色地格';return result;
      }
      result.route=route.map(p=>({x:p.x,y:p.y}));
      result.cost=route.length-1;
      result.remaining=(Number(me.stamina)||0)-result.cost;
      result.threatened=!!threats?.byKey?.[key(selection)];
      const reachable=rules.moveCells(s,me).some(p=>key(p)===key(selection));
      result.valid=currentTurn&&reachable&&(Number(me.actions)||0)<rules.LIMITS.actions;
      result.label=result.cost+' 體力 · '+result.cost+' 格';
      result.hint=!currentTurn?'等待行動回合':
        result.remaining<0?'體力不足':
        !reachable?'目前無法移動到此格':
        result.threatened?'落點在目前攻擊預告內':'預計剩餘 '+result.remaining+' 體力';
      return result;
    }
    const sk=mode.startsWith('manual:')?
      rules.manualSkillFor(me,mode.slice(7)):rules.basicFor(me);
    if(!sk){result.label='尚未裝備技能';return result;}
    result.cost=rules.techniqueCost(me,sk);
    result.remaining=(Number(me.stamina)||0)-result.cost;
    result.label=String(sk.name||'技能')+' · '+result.cost+' 體力';
    // The same server-side skill-validation routine decides whether an action
    // can be submitted; the rendered "affected" count is never a damage claim.
    try{
      rules.validateSkill(s,me,sk,selection,{first:selection.first||null});
      const permitted=!!skillPlan?.byAim?.[key(selection)]||rules.aimCells(s,me,sk).some(p=>key(p)===key(selection))||
        (sk.kind==='ring'||sk.range===0)&&key(selection)===key(me);
      result.valid=currentTurn&&permitted&&(Number(me.actions)||0)<rules.LIMITS.actions;
      if(!permitted){result.hint='不在可指定的攻擊範圍';return result;}
      const simulated=skillPlan?.byAim?.[key(selection)];
      const preview=simulated||rules.techniquePreview(s,me,sk,selection);
      result.cells=(preview.cells||[]).map(p=>({x:p.x,y:p.y}));
      const affected=new Map();
      for(const p of result.cells){
        const actor=rules.at(s,p);
        if(actor&&actor.uid!==uid&&actor.team!==me.team&&actor.hp>0)
          affected.set(actor.uid,actor);
      }
      if(simulated){
        affected.clear();
        for(const hit of simulated.hits){
          const actor=s.actors.find(a=>a.uid===hit.uid);
          if(actor&&actor.team!==me.team)affected.set(actor.uid,actor);
        }
        result.hits=simulated.hits;
        result.landings=simulated.landings;
        result.estimatedDamage=simulated.hits.reduce((sum,hit)=>sum+hit.damage,0);
      }
      result.affected=[...affected.values()].map(a=>({uid:a.uid,x:a.x,y:a.y,
        width:a.footprint?.width||1,height:a.footprint?.height||1}));
      result.hint=!currentTurn?'等待行動回合':
        result.remaining<0?'體力不足':
        !result.valid?'目前無法施放':
        result.affected.length?(simulated?result.affected.map(a=>{
          const hits=simulated.hits.filter(h=>h.uid===a.uid);
          return (s.actors.find(t=>t.uid===a.uid)?.name||'敵人')+'：預計 '+hits.map(h=>h.damage).join('＋')+' 傷害';
        }).join('；'):'範圍涵蓋 '+result.affected.length+' 名敵人'):'預覽範圍未涵蓋敵人';
    }catch(e){result.hint=String(e?.message||'目前不能使用此技能');}
    return result;
  }
  function drawRoute(ctx,plan,view){
    if(!ctx||plan?.type!=='move'||plan.route.length<2||!view)return;
    const {ox,oy,cell}=view;
    ctx.save();ctx.beginPath();ctx.rect(ox,oy,view.width*cell,view.height*cell);ctx.clip();
    ctx.lineCap='round';ctx.lineJoin='round';
    ctx.lineWidth=Math.max(2,cell*.055);
    ctx.strokeStyle=plan.valid?'rgba(248,225,163,.95)':'rgba(193,184,170,.76)';
    ctx.setLineDash([]);
    ctx.beginPath();
    plan.route.forEach((p,i)=>{
      const x=ox+(p.x+.5)*cell,y=oy+(p.y+.5)*cell;
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    });
    ctx.stroke();
    const count=plan.route.length-1;
    for(let i=1;i<plan.route.length;i++){
      const p=plan.route[i],cx=ox+(p.x+.5)*cell,cy=oy+(p.y+.5)*cell;
      const r=clamp(cell*.175,6,12);
      ctx.fillStyle=i===count?'rgba(35,76,57,.93)':'rgba(36,46,37,.83)';
      ctx.strokeStyle=plan.valid?'#e8d29d':'#b8b3a9';
      ctx.lineWidth=Math.max(1,cell*.022);
      ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#fff4d7';ctx.font='bold '+Math.round(clamp(cell*.2,9,13))+'px system-ui';
      ctx.textAlign='center';ctx.textBaseline='middle';
      // Show numbered steps only when they fit without obscuring the board.
      if(cell>=27)ctx.fillText(String(i),cx,cy+.5);
      if(i===count&&plan.threatened){
        ctx.fillStyle='#fcbd96';ctx.beginPath();ctx.arc(cx+r*.8,cy-r*.8,Math.max(2,r*.28),0,Math.PI*2);ctx.fill();
      }
    }
    ctx.restore();
  }
  function drawFocus(ctx,plan,view){
    if(!ctx||!plan||!view)return;
    const {ox,oy,cell}=view;
    ctx.save();ctx.beginPath();ctx.rect(ox,oy,view.width*cell,view.height*cell);ctx.clip();
    if(plan.type==='attack'){
      for(const a of plan.affected){
        const x=ox+(a.x+a.width*.5)*cell,y=oy+(a.y+a.height*.55)*cell;
        ctx.save();ctx.strokeStyle=plan.valid?'#f9d691':'#bbaca2';
        ctx.lineWidth=Math.max(1.8,cell*.05);ctx.setLineDash([Math.max(3,cell*.1),Math.max(2,cell*.05)]);
        ctx.beginPath();ctx.ellipse(x,y,cell*.44*a.width,cell*.38*a.height,0,0,Math.PI*2);
        ctx.stroke();ctx.restore();
      }
    }
    // Keep a single, non-interactive label anchored to the selected tile.
    // Do not create a new modal or button that competes with the quarter HUD.
    const t=plan.target;
    const anchorX=ox+(t.x+.5)*cell,anchorY=oy+t.y*cell;
    const label=plan.type==='move'?plan.label:
      plan.affected.length?(Number.isFinite(plan.estimatedDamage)?'預計 '+plan.estimatedDamage+' 傷害':plan.affected.length+' 名敵人'):plan.valid?'預覽範圍':'無法施放';
    const fontSize=Math.round(clamp(cell*.24,10,13));
    ctx.font='600 '+fontSize+'px system-ui,sans-serif';
    const width=clamp(ctx.measureText(label).width+15,54,Math.max(54,view.width*cell-10));
    const x=clamp(anchorX-width/2,ox+3,ox+view.width*cell-width-3);
    let y=anchorY-fontSize-13;
    if(y<oy+3)y=anchorY+cell+2;
    y=clamp(y,oy+3,oy+view.height*cell-fontSize-10);
    ctx.fillStyle=plan.valid?'rgba(29,48,38,.9)':'rgba(74,43,36,.91)';
    ctx.strokeStyle=plan.valid?'rgba(229,211,160,.8)':'rgba(246,158,139,.85)';
    ctx.lineWidth=1;
    ctx.beginPath();ctx.roundRect(x,y,width,fontSize+8,5);ctx.fill();ctx.stroke();
    ctx.fillStyle='#fff1d4';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(label,x+width/2,y+(fontSize+8)/2,width-8);
    ctx.restore();
  }
  return Object.freeze({derive,drawRoute,drawFocus});
});

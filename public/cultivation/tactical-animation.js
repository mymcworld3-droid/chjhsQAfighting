/* Presentation only. Replay committed events; never change battle outcomes. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QATacticalAnimation=api;
})(globalThis,()=>{
  'use strict';
  const copy=actors=>actors.map(a=>({...a}));
  const clamp=n=>Math.max(0,Math.min(1,n));
  const smooth=n=>n*n*(3-2*n);
  const jumps=new Set(['leap','hop','fly']);
  function duration(scene){
    if(scene.kind==='move'){
      if(scene.style==='teleport')return 360;
      if(jumps.has(scene.style))return 420;
      if(['dash','rush','push'].includes(scene.style))return 300;
      return Math.min(800,180+Math.max(...scene.moves.map(m=>m.path.length-1))*105);
    }
    return {cast:420,impact:520,damage:420,restore:420,guard:420,answer:620,turn:300,dodge:300,withdraw:360,finish:650}[scene.kind]||300;
  }
  function plan(previous,next,uid){
    if(!previous||previous.id!==next.id||next.revision<=previous.revision||previous.width!==next.width||previous.height!==next.height)return [];
    const seen=new Set(previous.events.map(e=>e.id)),events=next.events.filter(e=>{
      const revision=Number(String(e.id).split(':')[0]);
      return !seen.has(e.id)&&(!Number.isFinite(revision)||revision>=previous.revision);
    });
    // Resolve leaps/tackles visually on arrival, while leaving the authoritative
    // order (including reflection and collision handling) untouched.
    for(let i=0;i<events.length;i++){
      const e=events[i];if(e.animation?.kind!=='move'||!['dash','leap','fly'].includes(e.animation.style))continue;
      const at=events.findIndex((v,j)=>j<i&&v.actor===e.actor&&v.animation?.kind==='cast'&&['lunge','pounce','dive'].includes(v.animation.style));
      if(at>=0){events.splice(i,1);events.splice(at,0,e);}
    }
    let actors=copy(previous.actors);const scenes=[];
    for(const event of events){
      const raw=event.animation||(['move','monster-move','displace'].includes(event.type)?{kind:'move',style:'walk'}:null);
      if(!raw)continue;
      const scene={...raw,actor:event.actor,skill:event.skill,label:event.text,numbers:raw.numbers||[],before:copy(actors)};
      if(scene.kind==='cast'&&['lunge','pounce','dive'].includes(scene.style)){
        const a=actors.find(a=>a.uid===scene.actor);if(a)scene.origin={x:a.x,y:a.y};
      }
      scene.moves=raw.moves||(scene.kind==='move'&&event.path?[{uid:event.actor,path:event.path}]:[]);
      if(scene.kind==='move'){
        scene.moves=scene.moves.filter(m=>m.path?.length>1&&actors.some(a=>a.uid===m.uid));
        if(!scene.moves.length)continue;
        for(const m of scene.moves){const a=actors.find(a=>a.uid===m.uid);Object.assign(a,m.path.at(-1));}
      }
      for(const change of raw.changes||[]){const a=actors.find(a=>a.uid===change.uid);if(a)Object.assign(a,change);}
      scene.after=copy(actors);scene.duration=duration(scene);
      // One area attack hits several enemies at the same instant. Reflections
      // retain their own beat because their source/skill differ.
      const last=scenes.at(-1);
      if(scene.kind==='damage'&&last?.kind==='damage'&&scene.actor===last.actor&&scene.skill===last.skill){
        last.numbers=[...last.numbers,...scene.numbers];last.after=scene.after;last.label=scene.label;
      }else scenes.push(scene);
    }
    if(previous.status!=='finished'&&next.status==='finished'){
      const me=next.actors.find(a=>a.uid===uid),won=me?.team===next.winner,draw=next.winner==='draw';
      const scene={kind:'finish',style:won?'victory':draw?'draw':'defeat',actor:uid,label:draw?'平分秋色':won?next.mode==='pve'?'此關已破':'克敵制勝':'整裝再戰',before:copy(next.actors),after:copy(next.actors),moves:[],numbers:[]};
      scene.duration=duration(scene);scenes.push(scene);
    }
    // A busy four-monster turn remains short enough to read without building up
    // a delayed input queue. The server clock continues independently.
    const total=scenes.reduce((n,s)=>n+s.duration,0),scale=Math.min(1,4200/total);
    return scenes.map(s=>({...s,duration:s.duration*scale}));
  }
  function sample(scene,progress){
    const p=clamp(progress),beat=Math.sin(Math.PI*p),actors=copy(scene.before);
    for(const a of actors){
      a.opacity=1;a.lift=0;a.scaleX=1;a.scaleY=1;a.flash=0;
      const move=scene.moves.find(m=>m.uid===a.uid);
      if(move){
        const route=move.path,teleport=scene.style==='teleport',fast=['dash','rush','push'].includes(scene.style);
        const t=(fast?1-(1-p)**3:smooth(p))*(route.length-1),i=Math.min(route.length-2,Math.floor(t)),f=t-i;
        const from=route[i],to=route[i+1];
        if(teleport){Object.assign(a,p<.5?route[0]:route.at(-1));a.opacity=Math.abs(2*p-1);a.scaleX=.55+.45*a.opacity;}
        else{a.x=from.x+(to.x-from.x)*f;a.y=from.y+(to.y-from.y)*f;}
        a.row=to.x>from.x?1:to.x<from.x?2:to.y<from.y?3:0;
        a.frame=[1,2,3,0][Math.floor(p*route.length*2)%4];
        if(jumps.has(scene.style))a.lift=beat*(scene.style==='fly'?.55:.8);
        else if(['heavy','sentinel'].includes(scene.style)){a.lift=Math.abs(Math.sin(p*Math.PI*(route.length-1)))*.045;a.scaleY=1-beat*.045;}
        else if(scene.style==='weave'){a.sway=Math.sin(p*Math.PI*6)*.055;}
        else if(scene.style!=='sideways'&&scene.style!=='push')a.lift=Math.abs(Math.sin(p*Math.PI*(route.length-1)*2))*.055;
      }
      if(scene.actor===a.uid&&scene.kind==='cast'){
        const target=scene.target||a,dx=target.x-a.x,dy=target.y-a.y,length=Math.hypot(dx,dy)||1;
        a.x+=dx/length*beat*.12;a.y+=dy/length*beat*.12;a.scaleX=1+beat*.06;a.scaleY=1+beat*.06;
      }
      const number=scene.numbers.find(n=>n.uid===a.uid);
      if(scene.kind==='damage'&&number){
        a.flash=beat*.6;a.x+=Math.sin(p*Math.PI*5)*(1-p)*.07;
        const after=scene.after.find(b=>b.uid===a.uid);a.hp=a.hp+(after.hp-a.hp)*p;a.shield=after.shield;
        if(after.hp<=0){a.opacity=1-smooth(clamp((p-.35)/.65));a.scaleY=1-p*.25;}
      }
      if(scene.kind==='restore'&&number){const after=scene.after.find(b=>b.uid===a.uid);a.hp=a.hp+(after.hp-a.hp)*p;a.shield=after.shield;}
      if(scene.kind==='dodge'&&scene.actor===a.uid)a.x+=beat*.18;
      if(scene.kind==='withdraw'&&scene.actor===a.uid){a.opacity=1-p;a.lift=p*.3;}
    }
    return actors;
  }
  return Object.freeze({plan,sample});
});

/* Presentation only. Replay committed events; never change battle outcomes. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QATacticalAnimation=api;
})(globalThis,()=>{
  'use strict';
  const copy=actors=>actors.map(a=>({...a}));
  const clamp=n=>Math.max(0,Math.min(1,n));
  const smooth=n=>n*n*(3-2*n);
  const jumps=new Set(['leap','hop','fly','throw']);
  const manuals=()=>typeof module==='object'&&module.exports?require('./manual-rules.js'):globalThis.QAManuals;
  const moveFor=id=>manuals()?.BY_SKILL?.[id]?.moveId||id;
  const heavyMoves=new Set(['rock-fist','rock-quake','rock-break','dragon-guard','tiger-step','tiger-throw','wind-thousand','sky-sever']);
  const hitTime={'wind-slash':.40,'wind-step':.32,'wind-thousand':.45,'flight-summon':.45,
    'sky-cloud':.46,'sky-sever':.46,'rock-fist':.46,'rock-quake':.32,'rock-break':.40,'tiger-step':.32};
  function duration(scene){
    if(scene.kind==='move'){
      if(scene.style==='dash'&&scene.visualSkill==='dragon-guard')return 200;
      if(scene.style==='teleport')return 360;
      if(jumps.has(scene.style))return 420;
      if(['dash','rush','push'].includes(scene.style))return 300;
      return Math.min(800,180+Math.max(...scene.moves.map(m=>m.path.length-1))*105);
    }
    if(scene.kind==='cast'&&scene.style==='fist-chain')return 380;
    if(scene.kind==='damage'&&scene.skill==='dragon-guard')return 280;
    return {cast:420,impact:520,damage:420,restore:420,guard:420,answer:620,turn:300,dodge:300,withdraw:360,finish:650}[scene.kind]||300;
  }
  // Play a knockback at the impact of its originating attack. The server has
  // already resolved collisions and ordering; use only those committed paths.
  function combineKnockback(scenes){
    for(let i=0;i<scenes.length;i++){
      const cast=scenes[i];if(cast.kind!=='cast')continue;
      const hit=new Set(),numbers=[],moves=[],reflections=[];let j=i+1,hasDamage=false;
      const addNumber=number=>{
        const earlier=numbers.find(item=>item.uid===number.uid);
        if(earlier&&number.damage!==undefined&&earlier.damage!==undefined){
          earlier.damage+=number.damage;earlier.absorbed=(earlier.absorbed||0)+(number.absorbed||0);
          earlier.hits=(earlier.hits||1)+(number.hits||1);
        }else numbers.push({...number});
      };
      for(;j<scenes.length;j++){
        const scene=scenes[j];if(scene.eventRevision!==cast.eventRevision)break;
        if(scene.kind==='damage'){
          const direct=scene.actor===cast.actor&&(!cast.skill||scene.skill===cast.skill);
          const counter=hit.has(scene.actor)&&scene.numbers.some(n=>n.uid===cast.actor)&&
            ['counter','manual-counter'].includes(scene.skill);
          if(!direct&&!counter)break;
          hasDamage ||= direct;
          for(const number of scene.numbers){if(direct)hit.add(number.uid);addNumber(number);}
          if(counter)reflections.push({actor:scene.actor,target:cast.actor});
        }else if(scene.kind==='move'&&scene.style==='push'&&scene.moves.every(m=>hit.has(m.uid))){
          for(const move of scene.moves){
            const earlier=moves.find(m=>m.uid===move.uid);
            if(earlier)earlier.path.push(...move.path.slice(1));
            else moves.push({uid:move.uid,path:move.path.slice()});
          }
        }else break;
      }
      if(!hasDamage||!moves.length)continue;
      Object.assign(cast,{parallelImpact:true,impactStart:cast.style==='fist-chain'?.15:.45,numbers,moves,reflections,
        after:scenes[j-1].after,duration:cast.style==='fist-chain'?460:620});
      scenes.splice(i+1,j-i-1);
    }
  }
  // A chain strike and its committed forward step share one continuous beat.
  // Blocked steps have no dash event and therefore never advance visually.
  function combineChainAdvance(scenes){
    for(let i=0;i<scenes.length;i++){
      const cast=scenes[i];if(cast.kind!=='cast'||cast.style!=='fist-chain')continue;
      let j=i+1;const hits=new Set(),numbers=[],reflections=[];
      if(!cast.parallelImpact){
        // When a target is defeated or cannot be pushed, damage can precede
        // the step without a push event. Keep it at the same impact beat.
        for(;j<scenes.length;j++){
          const scene=scenes[j];if(scene.eventRevision!==cast.eventRevision||scene.kind!=='damage')break;
          const direct=scene.actor===cast.actor&&scene.skill===cast.skill;
          const counter=hits.has(scene.actor)&&scene.numbers.some(n=>n.uid===cast.actor)&&
            ['counter','manual-counter'].includes(scene.skill);
          if(!direct&&!counter)break;
          for(const number of scene.numbers){
            if(direct)hits.add(number.uid);
            const earlier=numbers.find(n=>n.uid===number.uid);
            if(earlier&&number.damage!==undefined&&earlier.damage!==undefined){
              earlier.damage+=number.damage;earlier.absorbed=(earlier.absorbed||0)+(number.absorbed||0);
              earlier.hits=(earlier.hits||1)+(number.hits||1);
            }else numbers.push({...number});
          }
          if(counter)reflections.push({actor:scene.actor,target:cast.actor});
        }
      }
      const step=scenes[j],actor=cast.before.find(a=>a.uid===cast.actor);
      if(!actor||step?.kind!=='move'||step.style!=='dash'||step.actor!==cast.actor||
        step.eventRevision!==cast.eventRevision||step.moves.length!==1||step.moves[0].uid!==cast.actor){
        if(numbers.length){
          Object.assign(cast,{parallelImpact:true,impactStart:.15,numbers,reflections,duration:460,after:scenes[j-1].after});
          scenes.splice(i+1,j-i-1);
        }
        continue;
      }
      const path=step.moves[0].path;
      if(path[0].x!==actor.x||path[0].y!==actor.y)continue;
      if(numbers.length)Object.assign(cast,{parallelImpact:true,impactStart:.15,numbers,reflections,duration:460});
      cast.moves=[...cast.moves,{uid:cast.actor,path:path.slice(),timing:'chain-advance'}];
      cast.after=step.after;
      scenes.splice(i+1,j-i);
    }
  }
  // Manual poses land their committed damage during the swing, not after it.
  function combineManualImpact(scenes){
    for(let i=0;i<scenes.length;i++){
      const cast=scenes[i];
      if(cast.kind!=='cast'||cast.parallelImpact||cast.style==='fist-chain'||!manuals()?.BY_SKILL?.[cast.skill])continue;
      let j=i+1;const hits=new Set(),numbers=[],reflections=[];
      for(;j<scenes.length;j++){
        const scene=scenes[j];if(scene.eventRevision!==cast.eventRevision||scene.kind!=='damage')break;
        const direct=scene.actor===cast.actor&&scene.skill===cast.skill;
        const counter=hits.has(scene.actor)&&scene.numbers.some(n=>n.uid===cast.actor)&&['counter','manual-counter'].includes(scene.skill);
        if(!direct&&!counter)break;
        for(const number of scene.numbers){
          if(direct)hits.add(number.uid);
          const earlier=numbers.find(n=>n.uid===number.uid);
          if(earlier&&number.damage!==undefined&&earlier.damage!==undefined){
            earlier.damage+=number.damage;earlier.absorbed=(earlier.absorbed||0)+(number.absorbed||0);
            earlier.hits=(earlier.hits||1)+(number.hits||1);
          }else numbers.push({...number});
        }
        if(counter)reflections.push({actor:scene.actor,target:cast.actor});
      }
      if(!hits.size)continue;
      Object.assign(cast,{parallelImpact:true,impactStart:hitTime[moveFor(cast.skill)]??.4,
        numbers,reflections,after:scenes[j-1].after,duration:600});
      scenes.splice(i+1,j-i-1);
    }
  }
  function combineManualThrow(scenes){
    for(let i=0;i<scenes.length-1;i++){
      const cast=scenes[i],thrown=scenes[i+1];
      if(cast.kind!=='cast'||moveFor(cast.skill)!=='tiger-throw'||thrown.kind!=='move'||
        thrown.style!=='throw'||thrown.actor!==cast.actor||thrown.eventRevision!==cast.eventRevision)continue;
      Object.assign(cast,{throwImpact:true,impactStart:.72,duration:650,after:thrown.after,
        moves:thrown.moves.map(m=>({...m,timing:'manual-throw'}))});
      scenes.splice(i+1,1);
    }
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
    for(const [index,event] of events.entries()){
      const raw=event.animation||(['move','monster-move','displace'].includes(event.type)?{kind:'move',style:'walk'}:null);
      if(!raw)continue;
      const scene={...raw,actor:event.actor,skill:event.skill,label:event.text,eventRevision:String(event.id).split(':')[0],numbers:(raw.numbers||[]).map(number=>({...number})),before:copy(actors)};
      if(scene.kind==='move'&&['dash','throw'].includes(scene.style)){
        const revision=String(event.id).split(':')[0];
        const related=events.filter(other=>other.actor===event.actor&&other.type==='cast'&&
          String(other.id).split(':')[0]===revision&&other.skill);
        const cast=related.find(other=>events.indexOf(other)>index)||related.at(-1);
        if(cast)scene.visualSkill=cast.skill;
      }
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
      if(scene.kind==='damage'&&last?.kind==='damage'&&scene.eventRevision===last.eventRevision&&scene.actor===last.actor&&scene.skill===last.skill){
        for(const number of scene.numbers){
          const earlier=last.numbers.find(item=>item.uid===number.uid);
          if(earlier&&number.damage!==undefined&&earlier.damage!==undefined){
            Object.assign(earlier,{damage:earlier.damage+number.damage,
              absorbed:(earlier.absorbed||0)+(number.absorbed||0),hits:(earlier.hits||1)+1});
          }else last.numbers.push({...number});
        }
        last.after=scene.after;last.label=scene.label;
      }else scenes.push(scene);
    }
    combineKnockback(scenes);
    combineChainAdvance(scenes);
    combineManualImpact(scenes);
    combineManualThrow(scenes);
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
  // A short contact pulse strengthens the hit without stopping the movement.
  function impactPulse(scene,progress){
    if(scene?.kind!=='cast'||!heavyMoves.has(moveFor(scene.skill)))return 0;
    const landed=scene.throwImpact&&scene.moves?.some(m=>m.timing==='manual-throw');
    if(!landed&&(!scene.parallelImpact||!scene.numbers?.some(n=>n.uid!==scene.actor&&n.damage!==undefined)))return 0;
    const q=(progress-scene.impactStart)/.22;
    return q>0&&q<1?Math.sin(Math.PI*q)*(1-q*.2):0;
  }
  function sample(scene,progress){
    const p=clamp(progress),beat=Math.sin(Math.PI*p),actors=copy(scene.before);
    const impact=scene.parallelImpact?clamp((p-scene.impactStart)/(1-scene.impactStart)):p;
    const weight=impactPulse(scene,p);
    for(const a of actors){
      a.opacity=1;a.lift=0;a.scaleX=1;a.scaleY=1;a.flash=0;
      const move=scene.moves.find(m=>m.uid===a.uid);
      if(move){
        const advance=move.timing==='chain-advance',throwing=move.timing==='manual-throw';
        const route=move.path,style=advance?'dash':throwing?'throw':scene.parallelImpact?'push':scene.style;
        const moveProgress=advance?p:throwing?clamp((p-.28)/.53):scene.parallelImpact?impact:p;
        const teleport=style==='teleport',fast=['dash','rush','push'].includes(style);
        const flowingPush=!advance&&scene.style==='fist-chain'&&scene.parallelImpact;
        const t=(advance||flowingPush?moveProgress:fast?1-(1-moveProgress)**3:smooth(moveProgress))*(route.length-1),i=Math.min(route.length-2,Math.floor(t)),f=t-i;
        const from=route[i],to=route[i+1];
        if(teleport){Object.assign(a,p<.5?route[0]:route.at(-1));a.opacity=Math.abs(2*p-1);a.scaleX=.55+.45*a.opacity;}
        else{a.x=from.x+(to.x-from.x)*f;a.y=from.y+(to.y-from.y)*f;}
        a.row=to.x>from.x?1:to.x<from.x?2:to.y<from.y?3:0;
        a.frame=[1,2,3,0][Math.floor(moveProgress*route.length*2)%4];
        if(jumps.has(style))a.lift=(throwing?Math.sin(Math.PI*moveProgress):beat)*(style==='fly'?.55:.8);
        else if(['heavy','sentinel'].includes(style)){a.lift=Math.abs(Math.sin(p*Math.PI*(route.length-1)))*.045;a.scaleY=1-beat*.045;}
        else if(style==='weave'){a.sway=Math.sin(p*Math.PI*6)*.055;}
        else if(style!=='sideways'&&style!=='push')a.lift=Math.abs(Math.sin(p*Math.PI*(route.length-1)*2))*.055;
      }
      if(scene.actor===a.uid&&scene.kind==='cast'){
        const target=scene.target||a,dx=target.x-a.x,dy=target.y-a.y,length=Math.hypot(dx,dy)||1;
        a.x+=dx/length*beat*.12;a.y+=dy/length*beat*.12;a.scaleX=1+beat*.06;a.scaleY=1+beat*.06;
        if(weight){a.scaleX*=1+weight*.10;a.scaleY*=1-weight*.08;}
      }
      const number=scene.numbers.find(n=>n.uid===a.uid);
      if(weight&&move?.timing==='manual-throw'){a.scaleX*=1+weight*.18;a.scaleY*=1-weight*.16;a.flash=weight*.6;}
      if((scene.kind==='damage'||scene.parallelImpact)&&number&&impact>0){
        const impactBeat=Math.sin(Math.PI*impact);
        a.flash=impactBeat*.6;
        if(scene.style!=='fist-chain')a.x+=Math.sin(impact*Math.PI*5)*(1-impact)*.07;
        if(weight&&a.uid!==scene.actor){
          a.flash=Math.max(a.flash,weight*.9);a.scaleX*=1+weight*.18;a.scaleY*=1-weight*.16;
        }
        const after=scene.after.find(b=>b.uid===a.uid);a.hp=a.hp+(after.hp-a.hp)*impact;a.shield=after.shield;
        if(after.hp<=0){a.opacity=1-smooth(clamp((impact-.35)/.65));a.scaleY*=1-impact*.25;}
      }
      if(scene.kind==='restore'&&number){const after=scene.after.find(b=>b.uid===a.uid);a.hp=a.hp+(after.hp-a.hp)*p;a.shield=after.shield;}
      if(scene.kind==='dodge'&&scene.actor===a.uid)a.x+=beat*.18;
      if(scene.kind==='withdraw'&&scene.actor===a.uid){a.opacity=1-p;a.lift=p*.3;}
    }
    return actors;
  }
  return Object.freeze({plan,sample,impactPulse});
});

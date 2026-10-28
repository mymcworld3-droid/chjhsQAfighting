// Fine-grained learning records are separate from the fixed ability-chart nodes.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QAAdaptiveLearningRules=api;})(globalThis,function(){
  'use strict';
  const POLICY=Object.freeze({diagnosticMin:5,diagnosticMax:8,lessonWrongStreak:2,independentWindow:10,independentCorrect:8,stableMinimum:5});
  const DAY=86400000, REVIEW_DAYS=[1,3,7], MIX=['reinforce','review','reinforce','challenge','reinforce','reinforce','review','reinforce','challenge','reinforce'];
  const count=x=>Math.max(0,Math.min(1000000,Math.floor(Number(x)||0)));
  const validScope=id=>/^[a-f0-9]{24}$/.test(String(id||''));
  const validId=(id,prefix)=>new RegExp('^'+prefix+'_[a-f0-9]{16}$').test(String(id||''));
  const empty=()=>({n:0,c:0,u:0,uc:0,h:0,w:0,recent:[],lastAt:0,dueAt:0,stage:0,level:0,taughtThrough:0});
  function row(input={}){input=input&&typeof input==='object'?input:{};const r=empty();for(const key of ['n','c','u','uc','h','w','stage','level','taughtThrough'])r[key]=count(input[key]);for(const key of ['lastAt','dueAt'])r[key]=Math.max(0,Number(input[key])||0);r.c=Math.min(r.n,r.c);r.u=Math.min(r.n,r.u);r.uc=Math.min(r.u,r.uc);r.level=Math.min(2,r.level);r.stage=Math.min(2,r.stage);r.recent=Array.isArray(input.recent)?input.recent.filter(x=>x===0||x===1).slice(-10):[];return r;}
  function scopeState(raw,id){const s=raw?.scopes?.[id]||{};return {answered:count(s.answered),skipped:count(s.skipped),facets:s.facets||{},concepts:s.concepts||{},seen:Array.isArray(s.seen)?s.seen.slice(-128):[],recent:Array.isArray(s.recent)?s.recent.slice(-8):[],updatedAt:Number(s.updatedAt)||0};}
  function update(input,correct,help,now){
    const r=row(input);r.n++;r.c+=Number(correct);r.h+=Number(help>0);r.w=correct?0:r.w+1;r.lastAt=now;
    if(!help){r.u++;r.uc+=Number(correct);r.recent.push(Number(correct));r.recent=r.recent.slice(-10);
      if(r.recent.length===POLICY.independentWindow&&r.recent.reduce((a,b)=>a+b,0)>=POLICY.independentCorrect&&r.level<2){r.level++;r.recent=[];}
      else if(r.recent.length>=5&&r.recent.slice(-5).reduce((a,b)=>a+b,0)<=2&&r.level>0){r.level--;r.recent=[];}
    }
    if(correct&&!help){
      if(!r.dueAt)r.dueAt=now+DAY;
      else if(now>=r.dueAt){r.stage=Math.min(2,r.stage+1);r.dueAt=now+REVIEW_DAYS[r.stage]*DAY;}
    }else if(!correct){r.stage=0;r.dueAt=now+DAY;}
    else r.dueAt=Math.min(r.dueAt||now+DAY,now+DAY);
    return r;
  }
  function record(raw,meta,event={}){
    if(!validScope(meta?.scopeId)||!validId(meta?.conceptId,'c')||!validId(meta?.facetId,'f'))return raw||{version:1,scopes:{}};
    const id=String(event.id||meta.questionId||'');if(!/^[A-Za-z0-9_-]{8,80}$/.test(id))return raw||{version:1,scopes:{}};
    const old=scopeState(raw,meta.scopeId);if(old.seen.includes(id))return raw;
    const now=Math.max(0,(Number.isFinite(Number(event.at))?Number(event.at):Date.now())),s={...old,facets:{...old.facets},concepts:{...old.concepts},seen:[...old.seen,id].slice(-128),updatedAt:now};
    if(event.kind==='lesson'){
      const r=row(s.concepts[meta.conceptId]);r.taughtThrough=Math.min(r.n,Math.max(r.taughtThrough,count(event.through)));s.concepts[meta.conceptId]=r;
    }else if(event.skipped){s.skipped++;}
    else if(typeof event.correct==='boolean'){
      const help=Math.min(3,count(event.help));s.answered++;
      s.facets[meta.facetId]=update(s.facets[meta.facetId],event.correct,help,now);
      s.concepts[meta.conceptId]=update(s.concepts[meta.conceptId],event.correct,help,now);
      s.recent=[...s.recent,{facetId:meta.facetId,conceptId:meta.conceptId,role:meta.role,at:now}].slice(-8);
    }else return raw||{version:1,scopes:{}};
    // Bound history without copying full questions or AI outlines into the profile.
    const scopes={...(raw?.scopes||{}),[meta.scopeId]:s};
    for(const key of Object.keys(scopes).sort((a,b)=>(scopes[b].updatedAt||0)-(scopes[a].updatedAt||0)).slice(24))delete scopes[key];
    return {version:1,scopes};
  }
  function status(input){const r=row(input);return !r.n?'待診斷':r.u<POLICY.stableMinimum?'持續診斷':(r.uc+2)/(r.u+4)<.6?'優先補強':(r.uc+2)/(r.u+4)<.78?'持續鞏固':'表現穩定';}
  function needsLesson(state,conceptId){const r=row(state?.concepts?.[conceptId]);return r.w>=POLICY.lessonWrongStreak&&r.n-r.taughtThrough>=POLICY.lessonWrongStreak;}
  function stable(input){const r=row(input);return r.u>=POLICY.stableMinimum&&r.uc/r.u>=.8&&r.w===0&&r.recent.slice(-5).reduce((a,b)=>a+b,0)>=Math.min(4,r.recent.length);}
  function decide(plan,raw,{now=Date.now(),pending=[],manualDifficulty='auto',conceptId=''}={}){
    const state=scopeState(raw,plan.scopeId),active=pending.filter(x=>x.scopeId===plan.scopeId).slice(0,8);
    const diagnosticTarget=Math.min(POLICY.diagnosticMax,Math.max(POLICY.diagnosticMin,plan.concepts.length)),slot=state.answered+active.length;
    const requestedRole=slot<diagnosticTarget?'diagnostic':MIX[(slot-diagnosticTarget)%10];
    const recovery=plan.concepts.find(c=>{const r=row(state.concepts[c.id]);return r.w>=POLICY.lessonWrongStreak&&(needsLesson(state,c.id)||r.n===r.taughtThrough)&&!active.some(x=>x.conceptId===c.id);});
    const focus=conceptId||recovery?.id||'';
    let pool=plan.facets.filter(f=>!focus||f.conceptId===focus),role=focus?'reinforce':requestedRole;
    if(!pool.length)pool=plan.facets.slice();
    if(role==='review'){
      const due=pool.filter(f=>{const r=row(state.facets[f.id]);return r.n&&r.dueAt&&r.dueAt<=now;});
      const practiced=pool.filter(f=>row(state.facets[f.id]).n>0);pool=due.length?due:practiced.length?practiced:pool;
      if(!practiced.length)role='reinforce';
    }
    if(role==='challenge'){
      const ready=pool.filter(f=>stable(state.concepts[f.conceptId]));if(ready.length)pool=ready;else role='reinforce';
    }
    const pendingCount=(key,id)=>active.filter(x=>x[key]===id).length;
    const unqueued=pool.filter(f=>!pendingCount('facetId',f.id));if(unqueued.length)pool=unqueued;
    if(role==='diagnostic'){const least=Math.min(...pool.map(f=>row(state.concepts[f.conceptId]).n+pendingCount('conceptId',f.conceptId)));pool=pool.filter(f=>row(state.concepts[f.conceptId]).n+pendingCount('conceptId',f.conceptId)===least);}
    const recentFacet=new Set(state.recent.slice(-2).map(x=>x.facetId));
    const fresh=pool.filter(f=>!recentFacet.has(f.id));if(fresh.length)pool=fresh;
    function score(f){const c=row(state.concepts[f.conceptId]),r=row(state.facets[f.id]),queued=pendingCount('facetId',f.id);
      if(role==='diagnostic')return [c.n+pendingCount('conceptId',f.conceptId),queued,r.n,recentFacet.has(f.id)?1:0,r.lastAt];
      if(role==='review')return [queued,recentFacet.has(f.id)?1:0,r.dueAt&&r.dueAt<=now?0:1,r.dueAt||Number.MAX_SAFE_INTEGER,r.lastAt];
      if(role==='challenge')return [queued,recentFacet.has(f.id)?1:0,r.n,r.lastAt];
      return [queued,recentFacet.has(f.id)?1:0,needsLesson(state,f.conceptId)?0:c.w?1:!c.n?2:3,(c.uc+2)/(c.u+4),r.n,r.lastAt];
    }
    pool.sort((a,b)=>{const x=score(a),y=score(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return a.id.localeCompare(b.id);});
    const cap={easy:0,medium:1,hard:2}[manualDifficulty]??2;
    const targets=pool.map(f=>{
      const c=row(state.concepts[f.conceptId]),difficulty=['easy','medium','hard'][Math.min(cap,c.level+Number(role==='challenge'&&stable(c)))];
      const simple=['direct-application','comparison','error-analysis'];
      let forms=role==='challenge'?(difficulty==='easy'?['comparison','error-analysis']:['scenario-modeling','concept-transfer','data-interpretation','inverse-reasoning']):f.forms;
      if(difficulty==='easy'){const compatible=forms.filter(x=>simple.includes(x));forms=compatible.length?compatible:simple;}
      return {...f,difficulty,forms};
    });
    return {role,requestedRole,diagnosticTarget,targets};
  }
  return Object.freeze({POLICY,DAY,REVIEW_DAYS,MIX,row,scopeState,record,status,needsLesson,decide});
});

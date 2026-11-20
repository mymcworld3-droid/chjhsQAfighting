'use strict';
// Retract the educational evidence of a server-confirmed invalid dungeon
// question. Combat stamina, cultivation rewards, and review history are
// intentionally NOT changed. A question's log is marked rather than deleted.
const Knowledge=require('./public/cultivation/knowledge-points.js');
const Solo=require('./public/cultivation/solo-learning-rules.js');
const Adaptive=require('./public/cultivation/adaptive-learning-rules.js');
const nonnegative=v=>Math.max(0,Math.trunc(Number(v)||0));
const copy=x=>x===undefined?undefined:structuredClone(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const decrement=(row,correct)=>({
  ...row,total:Math.max(0,nonnegative(row?.total)-1),
  correct:Math.max(0,nonnegative(row?.correct)-Number(correct))
});
function inverseKnowledge(raw,q,correct){
  const labels=Knowledge.labels(q,q.subject);
  if(!labels.length)return raw;
  const result=copy(raw)||{},subjects=new Set();
  for(const label of labels){
    const previous=result[label.subject]||{};
    result[label.subject]={...previous,
      [label.id]:decrement(previous[label.id]||{},correct)};
    subjects.add(label.subject);
  }
  const totals=Knowledge.totals(raw||{});
  const summary={
    ...totals,all:decrement(totals.all,correct),
    subjects:{...totals.subjects}
  };
  for(const name of subjects)
    summary.subjects[name]=decrement(summary.subjects[name],correct);
  result._totals=summary;
  return result;
}
function inverseAdaptive(raw,metadata,correct,evidence){
  const meta=metadata||{},id=meta.scopeId;
  if(!id||!raw?.scopes?.[id])return raw;
  const current=raw.scopes[id];
  // Exact reversion preserves spaced review schedules, proficiency levels,
  // wrong streaks and prior lesson state, when nothing touched this scope
  // after the now-invalid answer.
  if(evidence&&same(current,evidence.after)){
    const scopes={...raw.scopes};
    if(evidence.before===null||evidence.before===undefined)delete scopes[id];
    else scopes[id]=copy(evidence.before);
    return {...raw,scopes};
  }
  // When the bounded event history still contains every subsequent
  // observation, replay those verified observations from the pre-answer
  // snapshot. This exactly restores review spacing, streaks, and levels
  // without disturbing any later correct or incorrect work.
  const questionId=meta.questionId||'';
  const observedId=evidence?.eventId||questionId;
  const recent=Array.isArray(current.recent)?current.recent:[];
  const index=recent.findIndex(row=>row?.id===observedId);
  const later=index>=0?recent.slice(index+1):[];
  const seenAfter=Array.isArray(evidence?.after?.seen)?
    evidence.after.seen:[];
  const subsequent=Array.isArray(current.seen)?
    current.seen.filter(x=>!seenAfter.includes(x)):[];
  const complete=index>=0&&Array.isArray(evidence?.after?.seen)&&
    subsequent.length===later.length&&
    subsequent.every((value,i)=>value===later[i]?.id)&&
    later.every(row=>row?.id&&row?.facetId&&row?.conceptId&&
      typeof row.correct==='boolean');
  if(complete){
    const scopes={...raw.scopes};
    if(evidence.before===null||evidence.before===undefined)
      delete scopes[id];
    else scopes[id]=copy(evidence.before);
    let replayed={...raw,scopes};
    for(const row of later){
      replayed=Adaptive.record(replayed,{
        scopeId:id,questionId:row.id,
        facetId:row.facetId,conceptId:row.conceptId,
        difficulty:row.difficulty,role:row.role
      },{id:row.id,correct:row.correct,help:row.help,at:row.at});
    }
    return replayed;
  }
  // If later event history was trimmed or includes an unseen lesson, preserve
  // the later evidence and retract safe counts rather than rewriting history.
  const hasSeen=Array.isArray(current.seen)&&current.seen.includes(observedId);
  if(!hasSeen)return raw;
  const next={...current,answered:Math.max(0,nonnegative(current.answered)-1),
    seen:current.seen.filter(x=>x!==observedId),
    facets:{...current.facets},concepts:{...current.concepts}};
  const previous=evidence?.before||null;
  const adjust=(kind,key)=>{
    if(!key||!next[kind][key])return;
    const row=Adaptive.row(next[kind][key]);
    // For states with intervening observations keep their timing/levels;
    // reduce the evidence counts but never erase unrelated observations.
    const help=nonnegative(evidence?.help);
    row.n=Math.max(0,row.n-1);
    row.c=Math.max(0,row.c-Number(correct));
    if(!help){row.u=Math.max(0,row.u-1);row.uc=Math.max(0,row.uc-Number(correct));}
    else row.h=Math.max(0,row.h-1);
    if(!correct)row.w=Math.max(0,row.w-1);
    row.c=Math.min(row.n,row.c);row.uc=Math.min(row.u,row.uc);
    if(!row.n)row.w=0;
    // Do not retain an invalid independent result in the recent window.
    const record=next.recent?.find(x=>x?.id===observedId);
    if(record&&Array.isArray(row.recent)&&!help){
      const idx=row.recent.lastIndexOf(Number(correct));
      if(idx>=0)row.recent.splice(idx,1);
    }
    next[kind][key]=row;
  };
  adjust('facets',meta.facetId);adjust('concepts',meta.conceptId);
  const retainedRecent=Array.isArray(next.recent)?next.recent:[];
  // Newly recorded events carry their ID; legacy events are recognized
  // only if all their distinctive fields (including time) match.
  next.recent=retainedRecent.filter(x=>x?.id!==observedId&&!(
    !x?.id&&x?.facetId===meta.facetId&&x?.conceptId===meta.conceptId&&
    x?.at===evidence?.at&&x?.correct===correct
  ));
  return {...raw,scopes:{...raw.scopes,[id]:next}};
}
function evidenceBefore(stats,q,correct,help,now,patch){
  const topic=Solo.context({learningSubject:q.subject,
    learningTopic:q.learningTopic||q.topic}).topic;
  const subject=Solo.context({learningSubject:q.subject,
    learningTopic:q.learningTopic||q.topic}).subject;
  const mistakeKey=Solo.key(q.q);
  const scopeId=q.adaptive?.scopeId||null;
  return {
    subject,topic,mistakeKey,
    createdMistake:!correct&&!Object.hasOwn(stats.soloLearningV1?.mistakes||{},mistakeKey),
    beforeStreak:nonnegative(stats.currentStreak),
    afterStreak:nonnegative(patch['stats.currentStreak']),
    beforeBest:nonnegative(stats.bestStreak),
    afterBest:nonnegative(patch['stats.bestStreak']),
    adaptive:scopeId?{
      eventId:q.adaptive.questionId||q.id,
      help:nonnegative(help),at:now,
      before:copy(stats.adaptiveLearningV1?.scopes?.[scopeId])||null,
      after:copy(patch['stats.adaptiveLearningV1']?.scopes?.[scopeId])||null
    }:null
  };
}
function reverse(user,q,receipt){
  const stats=user?.stats||{},correct=q.correct===true;
  const evidence=receipt?.learningCorrectionEvidence||{};
  const subject=evidence.subject||Solo.context({
    learningSubject:q.subject,learningTopic:q.learningTopic||q.topic
  }).subject;
  const topic=evidence.topic||Solo.context({
    learningSubject:q.subject,learningTopic:q.learningTopic||q.topic
  }).topic;
  const knowledgeMap=copy(stats.knowledgeMap)||{};
  const topics={...(knowledgeMap[subject]||{})};
  topics[topic]=decrement(topics[topic]||{},correct);
  knowledgeMap[subject]=topics;
  const learning=copy(stats.soloLearningV1)||{version:1,mistakes:{},concepts:{}};
  const mistakeKey=evidence.mistakeKey||Solo.key(q.q);
  if(evidence.createdMistake!==false&&
      learning.mistakes?.[mistakeKey]&&
      learning.mistakes[mistakeKey].subject===subject&&
      learning.mistakes[mistakeKey].topic===topic){
    learning.mistakes={...learning.mistakes};
    delete learning.mistakes[mistakeKey];
  }
  const patch={
    'stats.totalAnswered':Math.max(0,nonnegative(stats.totalAnswered)-1),
    'stats.totalCorrect':Math.max(0,nonnegative(stats.totalCorrect)-Number(correct)),
    'stats.knowledgeMap':knowledgeMap,
    'stats.knowledgePointMapV1':inverseKnowledge(stats.knowledgePointMapV1,q,correct),
    'stats.soloLearningV1':learning
  };
  const adaptive= inverseAdaptive(stats.adaptiveLearningV1,q.adaptive,
    correct,evidence.adaptive);
  if(adaptive!==stats.adaptiveLearningV1)
    patch['stats.adaptiveLearningV1']=adaptive;
  // Only undo the answer's broken streak when the last-answer record still
  // identifies this question. Never rewrite a newer legitimate streak.
  const last=stats.lastQuizAnswer;
  if(last?.question===q.q&&
      (evidence.afterStreak===undefined||
        nonnegative(stats.currentStreak)===evidence.afterStreak)){
    patch['stats.currentStreak']=nonnegative(evidence.beforeStreak);
    if(evidence.afterBest!==undefined&&
        nonnegative(stats.bestStreak)===evidence.afterBest)
      patch['stats.bestStreak']=nonnegative(evidence.beforeBest);
    patch['stats.lastQuizAnswer']={...last,
      errorConfirmed:true,excludedFromLearning:true};
  }
  return patch;
}
function progress(user){
  const s=user?.stats||{};
  const fields=['totalScore','totalAnswered','totalCorrect','knowledgeMap',
    'knowledgePointMapV1','soloLearningV1','adaptiveLearningV1',
    'currentStreak','bestStreak'];
  return {stats:Object.fromEntries(fields.filter(k=>Object.hasOwn(s,k))
    .map(k=>[k,s[k]]))};
}
module.exports={evidenceBefore,reverse,progress,inverseKnowledge,inverseAdaptive};

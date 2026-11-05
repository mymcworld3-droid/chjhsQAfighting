// Mount the actual free-study question page in another mode. IDs, whiteboard,
// helper and reports stay shared; mode callbacks own answer/reward settlement.
export function createStudyQuestionBridge({render,resetWhiteboard,resetHelper,reviewHelper,userId=()=>null}) {
 let session=null;
 const $=id=>document.getElementById(id);
 function end(){
  if(!session)return;
  resetWhiteboard({close:true});window.toggleQuizHelper?.(false);
  const old=session;session=null;
  old.marker.replaceWith(old.page);old.page.className=old.className;
  for(const [node,handler,hidden,html] of old.controls){node.innerHTML=html;node.onclick=handler;node.classList.toggle('hidden',hidden);}
  const sameOwner=userId()===old.uid;
  window.currentActiveQuiz=sameOwner?old.previous:null;
  if(sameOwner&&old.previous?.data){render(old.previous.data,old.previous.rank||'',old.previous.topic||'',{study:true});}
  else resetHelper({});
 }
 return {
  mount(host,question,callbacks){
   if(!session){
    const page=$('page-quiz'),marker=document.createComment('study-question-home');
    if(!page)throw Error('題目頁面尚未準備完成');
    page.before(marker);
    const ids=['btn-giveup','btn-quiz-home','btn-next-step'];
    const back=$('feedback-section')?.querySelector('button');
    const controls=[...ids.map($),back].filter(Boolean).map(node=>[node,node.onclick,node.classList.contains('hidden'),node.innerHTML]);
    session={uid:userId(),page,marker,className:page.className,previous:window.currentActiveQuiz,controls,questionId:null};
   }
   const current=session;
   host.append(current.page);current.page.classList.remove('hidden');current.page.classList.add('tower-study-question','active-page');
   if(current.questionId===question.id)return;
   current.questionId=question.id;
   const quiz={id:question.id,mode:'trial-tower',data:{...question},topic:question.subject,
    towerRunId:callbacks.runId,towerQuestionId:question.id,helperReviewRedacted:true,onVerifiedSkip:callbacks.onSkip};
   window.currentActiveQuiz=quiz;
   $('feedback-section').classList.add('hidden');
   render(quiz.data,'試煉之塔',question.subject,{study:true,onAnswer:callbacks.onAnswer});
   $('btn-giveup').classList.add('hidden');
   $('btn-quiz-home').onclick=callbacks.onLeave;
   $('btn-next-step').onclick=callbacks.onContinue;
   const back=$('feedback-section')?.querySelector('button');if(back)back.onclick=callbacks.onLeave;
  },
  review(review){
   if(!session||window.currentActiveQuiz?.id!==review.questionId)return;
   const quiz=window.currentActiveQuiz;
   Object.assign(quiz.data,{ans:review.correctIndex,exp:review.explanation});delete quiz.helperReviewRedacted;
   reviewHelper(review);
   for(const [idx,button]of [...$('options-container').children].entries()){
    button.disabled=true;button.classList.toggle('bg-green-600',idx===review.correctIndex);
    button.classList.toggle('bg-red-600',idx===review.selectedChoice&&!review.correct);
   }
   $('feedback-section').classList.remove('hidden');
   $('feedback-title').textContent=review.correct?'答對，準備出手':'答錯，本回合無法出手';
   $('feedback-icon').textContent=review.correct?'✓':'×';
   const explanation=$('feedback-text');if(window.quizMathRichText)explanation.innerHTML=window.quizMathRichText(review.explanation||'此題暫無解析');
   else explanation.textContent=review.explanation||'此題暫無解析';
   void window.quizMathTypeset?.(explanation);
   $('solo-correction-actions').replaceChildren();
   $('btn-next-step').textContent='繼續 · 返回戰場';
   globalThis.QAGameAudio?.answer(review.correct,'tower:'+quiz.towerRunId+':'+review.questionId);
   $('feedback-section').scrollIntoView({block:'nearest',behavior:'smooth'});
  },
  disable(value=true){if(session)for(const node of $('options-container').children)node.disabled=value;},
  end
 };
}

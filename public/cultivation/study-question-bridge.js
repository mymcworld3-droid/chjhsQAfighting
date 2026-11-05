// Tower questions use the actual main study page and the normal learning flow.
// Combat answer validation stays on the server; the shared answer handler owns
// learning footprints, explanations, corrections and ordinary study rewards.
export function createStudyQuestionBridge({render,answer,resetWhiteboard,resetHelper,userId=()=>null,rankName=()=>'',beginSession=()=>null,endSession=()=>{},syncTools=()=>{},practiceStatus=()=>{}}) {
 let session=null;
 const $=id=>document.getElementById(id);
 function end(){
  if(!session)return;
  const old=session;session=null;resetWhiteboard({close:true});window.toggleQuizHelper?.(false);
  $('study-mode-status')?.remove();
  for(const [node,handler,html]of old.controls){node.innerHTML=html;node.onclick=handler;}
  const sameOwner=userId()===old.uid;
  endSession(old.learning,sameOwner);window.currentActiveQuiz=sameOwner?old.previous:null;
  if(sameOwner&&old.previous?.data)render(old.previous.data,old.previous.rank||'',old.previous.badge||old.previous.topic||'',{study:true});
  else resetHelper({});
  window.switchToPage?.(old.previousPage||'page-home',{preserveTrialTower:true});
 }
 return {
  open(question,callbacks){
   if(!session){
    const controls=[$('btn-next-step')].filter(Boolean).map(node=>[node,node.onclick,node.innerHTML]);
    session={uid:userId(),previous:window.currentActiveQuiz,previousPage:document.querySelector('.page-section.active-page')?.id||'page-home',
     controls,learning:beginSession(),questionId:null,quiz:null,reviewJob:null};
   }
   if(!$('page-quiz')?.classList.contains('active-page'))window.switchToPage?.('page-quiz',{preserveTrialTower:true});
   if(session.questionId===question.id){syncTools();return;}
   session.questionId=question.id;session.reviewJob=null;
   const quiz={id:question.id,mode:'trial-tower',data:{...question},meta:question.meta||{},adaptive:question.adaptive||null,adaptiveHelp:question.help||0,
    rank:rankName(),badge:`${question.recoveryOrigin?'📝 訂正練習':question.extendedPractice?'📚 延伸練習':'🎯 '+question.subject} | ${question.topic||'綜合'}`,
    learningSubject:question.subject,learningTopic:question.practicePoint||question.topic||'本題核心觀念',learningDifficulty:question.adaptive?.difficulty||question.difficulty,
    extendedPractice:!!question.extendedPractice,extendedPracticeSubject:question.subject,extendedPracticeKnowledgePoint:question.practicePoint||'',recoveryOrigin:question.recoveryOrigin||'',
    towerRunId:callbacks.runId,towerQuestionId:question.id,helperReviewRedacted:true,onVerifiedSkip:callbacks.onSkip};
   session.quiz=quiz;window.currentActiveQuiz=quiz;window.quizStartTime=Date.now();
   $('feedback-section').classList.add('hidden');$('solo-progress-panel')?.classList.remove('hidden');
   render(quiz.data,quiz.rank,quiz.badge,{study:true,onAnswer:callbacks.onAnswer});
   $('btn-next-step').onclick=callbacks.onContinue;syncTools();
  },
  review(review,onContinue){
   if(!session||session.quiz?.id!==review.questionId)return;
   if(!session.reviewJob){
    const quiz=session.quiz;Object.assign(quiz.data,{ans:review.correctIndex,exp:review.explanation});
    session.reviewJob=Promise.resolve(answer(review.selectedChoice,review.correctIndex,quiz.data.q,review.explanation));
   }
   // The shared answer handler binds its normal next button synchronously.
   $('btn-next-step').onclick=onContinue;$('btn-next-step').textContent='繼續 · 返回戰場';
  },
  async waitForAnswer(){await session?.reviewJob;},
  practiceStatus(questionId,status){if(session?.quiz?.id===questionId)practiceStatus(session.quiz,status);syncTools();},
  status({busy=false,error='',retry=null,sync=null}={}){
   if(!session)return;
   $('study-mode-status')?.remove();if(!error)return;
   const panel=document.createElement('section');panel.id='study-mode-status';panel.className='glass-panel p-4 rounded-xl mb-4';panel.setAttribute('role','alert');
   const message=document.createElement('p');message.textContent=error;panel.append(message);
   for(const [label,callback]of [['重試原操作',retry],['同步戰場',sync]])if(callback){const button=document.createElement('button');button.type='button';button.className='btn-cyber-primary px-4 py-3 rounded-lg mr-2 mt-3';button.textContent=label;button.disabled=busy;button.onclick=callback;panel.append(button);}
   $('quiz-container').prepend(panel);
  },
  disable(value=true){if(session)for(const node of $('options-container').children)node.disabled=value;},
  end
 };
}

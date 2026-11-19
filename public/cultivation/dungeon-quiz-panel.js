import {
  getDungeonQuizState,generateDungeonQuestion,answerDungeonQuestion,
  acknowledgeDungeonReview,claimDungeonQuizStamina
} from './dungeon-room.js';
import {getMainUser} from './data/project-repository.js';

// Stage 12: questions are independent of the dungeon world. This panel
// intentionally never stops the C-room SSE, NPC clock or teammate actions.
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rich=value=>typeof window.quizMathRichText==='function'?
  window.quizMathRichText(String(value||'')):escape(value);
const PREFETCH_STOCK=5;
export class DungeonQuizPanel{
  constructor(root,{onRoom}={}){
    this.root=root;this.onRoom=onRoom||(()=>{});
    this.roomId='';this.uid='';this.visible=false;this.epoch=0;
    this.question=null;this.review=null;this.loading=false;this.answering=false;
    this.prefetching=false;this.pendingCredits=[];this.warming=false;
    this.warmUntil=0;this.questionStartedAt=0;this.errorMessage='';
    const panel=document.createElement('aside');
    panel.className='dm-quiz-panel';panel.hidden=true;
    panel.setAttribute('role','region');panel.setAttribute('aria-label','副本獨立答題');
    panel.innerHTML='<section class="dm-quiz-sheet">'+
      '<header class="dm-quiz-top"><div><small>青雲問道 · 副本問道</small>'+
      '<h3>答題充能</h3></div>'+
      '<button type="button" data-dq="collapse" aria-label="收合題目返回戰場">收合 · 返回戰場</button></header>'+
      '<p class="dm-quiz-info">答對恢復 4 體力，答錯恢復 1 體力（上限 10）。'+
      '答題時靈獸仍會攻擊；可隨時收合題目，隊友不必等待。</p>'+
      '<p data-dq="status" class="dm-quiz-status" role="status" aria-live="polite"></p>'+
      '<div data-dq-content class="dm-quiz-content"></div>'+
      '<div class="dm-quiz-actions">'+
      '<button type="button" data-dq="retry" hidden>重新取得題目</button>'+
      '<button type="button" data-dq="credit" hidden>重試補充體力</button>'+
      '<button type="button" data-dq="next" hidden>下一題</button></div>'+
      '</section>';
    this.element=panel;root.append(panel);
    panel.addEventListener('click',event=>{
      const button=event.target.closest('[data-dq]');
      if(!button||button.disabled)return;
      const action=button.dataset.dq;
      if(action==='collapse')this.hide();
      else if(action==='retry')void this.load();
      else if(action==='credit')void this.retryCredits();
      else if(action==='next')void this.next();
      else if(action==='answer')void this.submit(Number(button.dataset.choice));
    });
    panel.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.stopPropagation();event.preventDefault();this.hide();}
    });
  }
  $(name){return this.element.querySelector('[data-dq="'+name+'"]');}
  valid(epoch=this.epoch){
    return epoch===this.epoch&&this.roomId&&this.uid===getMainUser()?.uid;
  }
  attach(roomId,uid){
    if(this.roomId===roomId&&this.uid===uid)return;
    this.epoch++;this.roomId=roomId;this.uid=uid;
    this.visible=false;this.element.hidden=true;
    this.question=null;this.review=null;this.pendingCredits=[];
    this.loading=false;this.answering=false;this.prefetching=false;
    this.warming=false;this.warmUntil=0;this.errorMessage='';
    this.questionStartedAt=0;this.paint();
  }
  destroy(){
    this.epoch++;this.visible=false;this.element.hidden=true;
    this.roomId='';this.uid='';this.question=null;this.review=null;
    this.pendingCredits=[];this.prefetching=false;this.loading=false;
    this.answering=false;this.warming=false;this.warmUntil=0;
    this.errorMessage='';this.questionStartedAt=0;
  }
  async warm(){
    // Preload before the player presses the charge button. Reconnecting and
    // frequent room SSE ticks cannot trigger an API request storm.
    if(!this.valid()||this.warming||Date.now()<this.warmUntil)return;
    this.warming=true;this.warmUntil=Date.now()+45000;
    const epoch=this.epoch;
    try{
      const data=await getDungeonQuizState(this.roomId);
      if(!this.valid(epoch))return;
      if(data.state.stock<PREFETCH_STOCK){
        if(!data.state.question)await generateDungeonQuestion(this.roomId,0);
        if(this.valid(epoch))await this.prefetch(epoch);
      }
    }catch(_){
      if(this.valid(epoch))this.warmUntil=Date.now()+10000;
    }finally{if(this.valid(epoch))this.warming=false;}
  }
  show(){
    if(!this.valid())return;
    this.visible=true;this.element.hidden=false;
    this.paint();
    if(!this.question&&!this.review)void this.load();
    this.$('collapse')?.focus({preventScroll:true});
  }
  hide(){
    this.visible=false;this.element.hidden=true;
    this.root.querySelector('[data-dm="quiz"]')?.focus({preventScroll:true});
  }
  status(message=''){
    const node=this.$('status');if(node)node.textContent=message;
  }
  paint(){
    const content=this.element.querySelector('[data-dq-content]');
    if(!content)return;
    content.replaceChildren();
    const retry=this.$('retry'),claim=this.$('credit'),next=this.$('next');
    retry.hidden=!this.visible||!!this.review||!!this.question||this.loading;
    next.hidden=!this.review;
    claim.hidden=!this.review||!this.pendingCredits.length;
    if(!this.visible)return;
    if(this.loading&&!this.question&&!this.review){
      this.status('正在填充題庫中，已通過審核的題目會自動出現…');
      return;
    }
    if(this.review){
      const r=this.review;
      this.status(this.errorMessage||(r.correct?'答對！':'答錯了')+' · 答題體力 '+r.amount+
        ' 點（實際恢復量依當前剩餘體力計算）');
      const title=document.createElement('p');title.className='dm-quiz-question';
      title.innerHTML=rich(r.q);content.append(title);
      const choices=document.createElement('div');choices.className='dm-quiz-options';
      (r.opts||[]).forEach((option,index)=>{
        const node=document.createElement('div');
        node.className='dm-quiz-option'+(index===r.answerIndex?' is-correct':'')+
          (index===r.choice&&index!==r.answerIndex?' is-wrong':'');
        node.innerHTML='<strong>'+String.fromCharCode(65+index)+'.</strong> '+
          rich(option);
        choices.append(node);
      });
      content.append(choices);
      const explanation=document.createElement('section');
      explanation.className='dm-quiz-explanation';
      const heading=document.createElement('strong');heading.textContent='解析';
      const detail=document.createElement('div');detail.innerHTML=rich(r.explanation);
      explanation.append(heading,detail);
      if(r.reward?.learning){
        const learning=document.createElement('p');
        learning.textContent=r.reward.learning;explanation.append(learning);
      }
      content.append(explanation);
    }else if(this.question){
      const q=this.question;
      this.status(this.errorMessage||'第 '+(this.answered+1)+' 題 · '+(q.subject||'綜合')+
        ' · '+(q.topic||'核心觀念')+
        ' · 玩家各自答題，戰場持續運作');
      const title=document.createElement('p');title.className='dm-quiz-question';
      title.innerHTML=rich(q.q);content.append(title);
      const choices=document.createElement('div');choices.className='dm-quiz-options';
      (q.opts||[]).forEach((option,index)=>{
        const node=document.createElement('button');node.type='button';
        node.dataset.dq='answer';node.dataset.choice=String(index);
        node.disabled=this.answering;
        node.innerHTML='<strong>'+String.fromCharCode(65+index)+'.</strong> '+
          rich(option);
        choices.append(node);
      });
      content.append(choices);
    }else this.status(this.errorMessage||'正在填充題庫中…');
    try{window.quizMathTypeset?.(content);}catch(_){}
  }
  async retryCredits(){
    if(!this.valid())return;
    const epoch=this.epoch;
    // Ordered A receipts must be committed to C in the same order. C
    // enforces quizCreditSeq even if two devices attempt credit concurrently.
    const credits=[...this.pendingCredits].sort((a,b)=>a.index-b.index);
    for(const record of credits){
      if(!this.valid(epoch))return;
      try{
        const response=await claimDungeonQuizStamina(this.roomId,record.id);
        if(!this.valid(epoch))return;
        if(response?.room)this.onRoom(response.room);
        this.pendingCredits=this.pendingCredits.filter(x=>x.id!==record.id);
      }catch(error){
        this.errorMessage='答題已記錄，但體力補發尚未完成：'+error.message+
          '。可按「重試補充體力」。';
        this.paint();return;
      }
    }
    this.errorMessage='';this.paint();
  }
  async load(){
    if(!this.valid()||this.loading)return;
    const epoch=this.epoch;
    this.loading=true;this.errorMessage='';this.paint();
    try{
      const response=await getDungeonQuizState(this.roomId);
      if(!this.valid(epoch))return;
      const state=response.state;
      this.answered=state.answered;
      this.pendingCredits=state.pendingCredits||[];
      await this.retryCredits();
      if(!this.valid(epoch))return;
      // A response can be reloaded in another browser without skipping the
      // original explanation. Only "下一題" acknowledges this review.
      if(state.lastReview){
        this.question=null;this.review=state.lastReview;
        this.paint();void this.prefetch(epoch);
        return;
      }
      let question=state.question;
      if(!question){
        this.status('正在填充題庫中…');
        const generated=await generateDungeonQuestion(this.roomId,0);
        question=generated.dungeonQuestion;
      }
      if(!this.valid(epoch))return;
      this.question=question;this.review=null;this.questionStartedAt=Date.now();this.paint();
      // Fill the next four independent slots without locking up the screen.
      // Main solo generation performs normal scope checks and AI review.
      void this.prefetch(epoch);
    }catch(error){
      if(this.valid(epoch)){
        this.question=null;this.errorMessage=error?.message||'題目取得失敗';
        this.paint();
      }
    }finally{
      this.loading=false;
      if(this.valid(epoch))this.paint();
    }
  }
  async prefetch(epoch){
    if(this.prefetching||!this.valid(epoch))return;
    this.prefetching=true;
    try{
      const state=(await getDungeonQuizState(this.roomId)).state;
      if(!this.valid(epoch))return;
      if(state.stock>=PREFETCH_STOCK)return;
      // All slots 1..4, not 1..(5-stock-1): the previous expression omitted
      // slot four and left holes after concurrent answers.
      for(let slot=1;slot<PREFETCH_STOCK&&this.valid(epoch);slot+=2){
        await Promise.allSettled([slot,slot+1].filter(n=>n<PREFETCH_STOCK)
          .map(n=>generateDungeonQuestion(this.roomId,n)));
      }
    }catch(_){
      // A temporary AI shortage must never invalidate the visible question.
    }finally{if(this.valid(epoch))this.prefetching=false;}
  }
  async submit(choice){
    if(!this.valid()||!this.question||this.answering||this.review)return;
    const epoch=this.epoch,q=this.question,startedAt=this.questionStartedAt||Date.now();
    this.answering=true;this.errorMessage='';this.paint();this.status('正在批改本題…');
    try{
      const result=await answerDungeonQuestion(this.roomId,q.id,choice,0,
        Math.max(0,Math.floor((Date.now()-startedAt)/1000)));
      if(!this.valid(epoch))return;
      this.review=result.review;this.question=null;
      this.answered=result.state.answered;
      this.pendingCredits=result.state.pendingCredits||[];
      this.paint();
      await this.retryCredits();
    }catch(error){
      if(this.valid(epoch))this.errorMessage=error?.message||'批改失敗，請重試';
    }finally{
      this.answering=false;
      if(this.valid(epoch))this.paint();
    }
  }
  async next(){
    if(!this.valid()||!this.review)return;
    const epoch=this.epoch,reviewId=this.review.questionId;
    this.$('next').disabled=true;
    try{
      await acknowledgeDungeonReview(this.roomId,reviewId);
      if(!this.valid(epoch))return;
      this.review=null;this.question=null;this.errorMessage='';
      this.questionStartedAt=Date.now();
      this.paint();await this.load();
    }catch(error){
      if(this.valid(epoch)){
        this.errorMessage='無法切換下一題：'+(error?.message||'請稍後再試');
        this.paint();
      }
    }finally{
      if(this.valid(epoch))this.$('next').disabled=false;
    }
  }
}

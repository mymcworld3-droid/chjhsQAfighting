import {
  getDungeonQuizState,generateDungeonQuestion,answerDungeonQuestion,
  acknowledgeDungeonReview,claimDungeonQuizStamina,
  reportDungeonQuestion,reviewDungeonMathIssue,refundDungeonQuestionStamina
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
    this.isAdmin=false;
    this.errorRefunds=[];this.reportOpen=false;this.reportBusy=false;
    this.correctionBusy=false;this.queuedCorrections=new Set();
    this.learningQuiz=null;this.mathReports=new Set();
    const panel=document.createElement('aside');
    panel.className='dm-quiz-panel';panel.hidden=true;
    panel.setAttribute('role','region');panel.setAttribute('aria-label','副本獨立答題');
    // Trial-style quiz and shared learning system, but NO 問道助手.
    // Question complaints use server-side evidence, never a client answer key.
    panel.innerHTML='<section class="dm-quiz-sheet">'+
      '<header class="dm-quiz-top"><div><small>青雲問道 · 問道試煉</small>'+
      '<h3>答題充能</h3></div>'+
      '<button type="button" data-dq="collapse" aria-label="返回戰場">返回戰場</button></header>'+
      '<p class="dm-quiz-info">答對恢復 4 體力，答錯恢復 1 體力（上限 10）。'+
      '逐題批改、查看解析，再按下一題。作答時戰鬥及隊友行動不暫停。</p>'+
      '<div class="dm-quiz-toolbar"><span data-dq="scope">依選擇的學習範圍出題</span>'+
      '<div class="dm-quiz-tools">'+
      '<button type="button" data-dq="report-toggle" aria-expanded="false">題目有錯</button>'+
      '<button type="button" data-dq="whiteboard" aria-expanded="false">計算白板</button></div></div>'+
      '<section class="dm-quiz-report" data-dq="report-panel" hidden aria-label="回報題目錯誤">'+
      '<label for="dm-quiz-report-reason">請具體指出題幹、選項、計算或排版上的錯誤</label>'+
      '<textarea id="dm-quiz-report-reason" data-dq="report-reason" rows="3" maxlength="1200" '+
      'placeholder="請至少輸入 6 個字，獨立審核確認後才會補償"></textarea>'+
      '<div class="dm-quiz-report-actions"><button type="button" data-dq="report-submit">送交獨立審核</button>'+
      '<button type="button" data-dq="report-close">取消</button></div>'+
      '<small>未作答也可回報。確認為錯題才跳過或補正；審核中可返回戰場。</small>'+
      '</section>'+
      '<p data-dq="report-status" class="dm-quiz-report-status" role="status" aria-live="polite"></p>'+
      '<p data-dq="status" class="dm-quiz-status" role="status" aria-live="polite"></p>'+
      '<div data-dq-content class="dm-quiz-content"></div>'+
      '<section class="dm-quiz-whiteboard" data-dq-whiteboard hidden aria-label="計算白板">'+
      '<div class="dm-quiz-whiteboard-head"><strong>計算白板</strong>'+
      '<div><button type="button" data-dq="whiteboard-clear">清除</button>'+
      '<button type="button" data-dq="whiteboard-close">收起白板</button></div></div>'+
      '<canvas data-dq-whiteboard-canvas width="720" height="280" '+
      'aria-label="可使用手指、滑鼠或觸控筆書寫的計算區域"></canvas></section>'+
      '<div class="dm-quiz-actions">'+
      '<button type="button" data-dq="retry" hidden>重新取得題目</button>'+
      '<button type="button" data-dq="credit" hidden>重試補充體力</button>'+
      '<button type="button" data-dq="error-credit" hidden>重試錯題補償</button>'+
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
      else if(action==='whiteboard'||action==='whiteboard-close')
        this.toggleWhiteboard(action==='whiteboard'?undefined:false);
      else if(action==='whiteboard-clear')this.clearWhiteboard();
      else if(action==='report-toggle')this.toggleReport();
      else if(action==='report-close')this.toggleReport(false);
      else if(action==='report-submit')void this.sendReport();
      else if(action==='correction')void this.queueCorrection();
      else if(action==='error-credit')void this.retryErrorRefunds();
    });
    panel.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.stopPropagation();event.preventDefault();this.hide();}
    });
    this.bindWhiteboard();
    window.addEventListener('qa:invalid-tex',event=>{
      const node=event.detail?.node;
      if(!this.visible||!this.valid()||!node||
          !this.element.contains(node)||!this.roomId)return;
      const questionId=this.review?.questionId||this.question?.id;
      if(!questionId||this.mathReports.has(questionId))return;
      this.mathReports.add(questionId);
      const epoch=this.epoch,roomId=this.roomId;
      void reviewDungeonMathIssue(roomId,questionId).catch(()=>{
        if(this.valid(epoch))this.mathReports.delete(questionId);
      });
    });
  }
  bindWhiteboard(){
    const canvas=this.element.querySelector('[data-dq-whiteboard-canvas]');
    const ctx=canvas?.getContext('2d');
    if(!ctx)return;
    let active=null;
    const point=event=>{
      const rect=canvas.getBoundingClientRect();
      return rect.width&&rect.height?{
        x:(event.clientX-rect.left)*canvas.width/rect.width,
        y:(event.clientY-rect.top)*canvas.height/rect.height}:null;
    };
    canvas.addEventListener('pointerdown',event=>{
      if(active!==null)return;
      const p=point(event);if(!p)return;
      active=event.pointerId;canvas.setPointerCapture?.(active);
      ctx.strokeStyle='#172e28';ctx.lineWidth=2.8;
      ctx.lineCap='round';ctx.lineJoin='round';
      ctx.beginPath();ctx.moveTo(p.x,p.y);
      ctx.lineTo(p.x+.01,p.y+.01);ctx.stroke();
      event.preventDefault();
    });
    canvas.addEventListener('pointermove',event=>{
      if(active!==event.pointerId)return;
      const p=point(event);if(!p)return;
      ctx.lineTo(p.x,p.y);ctx.stroke();event.preventDefault();
    });
    const end=event=>{
      if(active!==event.pointerId)return;
      active=null;ctx.closePath();
      if(canvas.hasPointerCapture?.(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup',end);
    canvas.addEventListener('pointercancel',end);
    canvas.addEventListener('lostpointercapture',event=>{
      if(active===event.pointerId){active=null;ctx.closePath();}
    });
  }
  toggleWhiteboard(force){
    const area=this.element.querySelector('[data-dq-whiteboard]');
    if(!area)return;
    const open=force===undefined?area.hidden:Boolean(force);
    area.hidden=!open;
    this.$('whiteboard')?.setAttribute('aria-expanded',String(open));
  }
  clearWhiteboard(){
    const canvas=this.element.querySelector('[data-dq-whiteboard-canvas]');
    canvas?.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);
  }
  setAdmin(flag){
    const admin=flag===true;
    if(this.isAdmin!==admin){this.isAdmin=admin;if(this.visible)this.paint();}
  }
  $(name){return this.element.querySelector('[data-dq="'+name+'"]');}
  valid(epoch=this.epoch){
    return epoch===this.epoch&&this.roomId&&this.uid===getMainUser()?.uid;
  }
  attach(roomId,uid,isAdmin=false){
    if(this.roomId===roomId&&this.uid===uid){
      this.setAdmin(isAdmin);return;
    }
    this.epoch++;this.roomId=roomId;this.uid=uid;this.isAdmin=isAdmin===true;
    this.clearWhiteboard();this.toggleWhiteboard(false);
    this.visible=false;this.element.hidden=true;
    this.question=null;this.review=null;this.pendingCredits=[];this.errorRefunds=[];
    this.reportOpen=false;this.reportBusy=false;this.learningQuiz=null;
    this.mathReports.clear();this.queuedCorrections.clear();
    this.loading=false;this.answering=false;this.prefetching=false;
    this.warming=false;this.warmUntil=0;this.errorMessage='';
    this.questionStartedAt=0;this.paint();
  }
  destroy(){
    this.epoch++;this.visible=false;this.element.hidden=true;
    this.roomId='';this.uid='';this.question=null;this.review=null;
    this.pendingCredits=[];this.errorRefunds=[];
    this.reportOpen=false;this.reportBusy=false;this.correctionBusy=false;
    this.prefetching=false;this.loading=false;
    this.answering=false;this.warming=false;this.warmUntil=0;
    if(window.currentTacticalQuiz===this.learningQuiz)window.currentTacticalQuiz=null;
    this.learningQuiz=null;this.mathReports.clear();this.queuedCorrections.clear();
    this.errorMessage='';this.questionStartedAt=0;this.isAdmin=false;
    this.clearWhiteboard();this.toggleWhiteboard(false);
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
    if(window.currentTacticalQuiz===this.learningQuiz)window.currentTacticalQuiz=null;
    this.root.querySelector('[data-dm="quiz"]')?.focus({preventScroll:true});
  }
  toggleReport(force){
    const item=this.review||this.question;
    if(!this.valid()||!this.visible||!item||this.reportBusy)return;
    this.reportOpen=force===undefined?!this.reportOpen:Boolean(force);
    this.$('report-panel').hidden=!this.reportOpen;
    this.$('report-toggle')?.setAttribute('aria-expanded',String(this.reportOpen));
    if(this.reportOpen)this.$('report-reason')?.focus({preventScroll:true});
  }
  reportStatus(message=''){
    const node=this.$('report-status');if(node)node.textContent=message;
  }
  bindLearning(item){
    if(!item||!this.visible)return;
    if(this.learningQuiz?.id!==item.id){
      this.learningQuiz={
        id:item.id,
        data:{q:item.q,opts:item.opts},
        learningSubject:item.subject,learningTopic:item.learningTopic||item.topic,
        learningDifficulty:item.difficulty||'easy',
        meta:item.meta||{},adaptive:item.adaptive||null,
        adaptiveAnswered:!!this.review,adaptiveHelp:0
      };
    }else this.learningQuiz.adaptiveAnswered=!!this.review;
    window.currentTacticalQuiz=this.learningQuiz;
    const host=this.element.querySelector('.dm-quiz-question');
    if(host)window.QAAdaptiveLearning?.render?.(this.learningQuiz,host);
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
    const item=this.review||this.question;
    const scope=this.$('scope');
    if(scope)scope.textContent=item?
      '第 '+(this.review?.index||this.answered+1)+' 題 · '+
      (item.subject||'綜合')+' · '+(item.topic||'核心觀念'):
      '依選擇的學習範圍出題';
    if(item){
      const sheet=document.createElement('section');
      sheet.className='dm-quiz-question-sheet tc-question-sheet glass-panel';
      const badge=document.createElement('small');
      badge.className='dm-quiz-question-badge tc-question-badge';
      badge.textContent=(item.subject||'綜合')+' · '+(item.topic||'核心觀念');
      const title=document.createElement('h3');
      title.className='dm-quiz-question tc-question';
      title.innerHTML=rich(item.q);
      sheet.append(badge,title);content.append(sheet);
      const choices=document.createElement('div');
      choices.className='dm-quiz-options tc-options';
      (item.opts||[]).forEach((option,index)=>{
        const node=document.createElement(this.review?'div':'button');
        if(!this.review){
          node.type='button';node.dataset.dq='answer';
          node.dataset.choice=String(index);node.disabled=this.answering;
        }
        node.className='dm-quiz-option'+
          (this.review&&index===this.review.answerIndex?' is-correct':'')+
          (this.review&&index===this.review.choice&&index!==this.review.answerIndex?
            ' is-wrong':'');
        const letter=document.createElement('span');
        letter.className='dm-quiz-letter';
        letter.textContent=String.fromCharCode(65+index);
        const label=document.createElement('span');
        label.className='quiz-rich-option';label.innerHTML=rich(option);
        node.append(letter,label);choices.append(node);
      });
      content.append(choices);
    }
    if(this.review){
      const r=this.review;
      this.status(this.errorMessage||'本題已批改 · 請閱讀解析後按下一題');
      const feedback=document.createElement('section');
      feedback.className='dm-quiz-feedback tc-feedback-section glass-panel';
      const heading=document.createElement('strong');
      heading.className=r.correct?'tc-correct':'tc-wrong';
      heading.textContent=(r.correct?'答對':'答錯')+
        (this.isAdmin?' · 管理員體力固定 10/10':' · 體力 +'+r.amount);
      feedback.append(heading);
      const explanation=document.createElement('section');
      explanation.className='dm-quiz-explanation';
      const label=document.createElement('strong');label.textContent='解析';
      const detail=document.createElement('div');
      detail.innerHTML=rich(r.explanation||'本題尚未提供解析');
      explanation.append(label,detail);
      if(r.reward?.learning){
        const learning=document.createElement('p');
        learning.textContent=r.reward.learning;explanation.append(learning);
      }
      feedback.append(explanation);content.append(feedback);
    }else if(this.question){
      this.status(this.errorMessage||'請選擇 A、B、C、D · '+
        (this.isAdmin?'管理員體力固定 10/10，答題仍計入學習紀錄':
          '答對 +4、答錯 +1 · 可隨時返回戰場'));
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
      this.clearWhiteboard();this.toggleWhiteboard(false);
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

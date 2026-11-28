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
    this.isAdmin=false;this.autoRegeneration=false;
    this.errorRefunds=[];this.reportOpen=false;this.reportBusy=false;
    this.correctionBusy=false;this.queuedCorrections=new Set();
    this.learningQuiz=null;this.mathReports=new Set();
    const panel=document.createElement('aside');
    panel.className='dm-quiz-panel';panel.hidden=true;
    panel.setAttribute('role','region');panel.setAttribute('aria-label','副本獨立答題');
    // Trial-style quiz and shared learning system, but NO 問道助手.
    // Question complaints use server-side evidence, never a client answer key.
    panel.innerHTML='<section class="dm-quiz-sheet">'+
      '<header class="dm-quiz-top"><div><small>青雲問道 · 合作副本</small>'+
      '<h3 data-dq="title">答題充能</h3></div>'+
      '<button type="button" data-dq="collapse" aria-label="返回戰場">返回戰場</button></header>'+
      '<p class="dm-quiz-info" data-dq="info">答對恢復 4 體力，答錯恢復 1 體力（上限 10）。'+
      '逐題批改、查看解析，再按下一題。作答時戰鬥及隊友行動不暫停。</p>'+
      '<div class="dm-quiz-toolbar"><span data-dq="scope">依選擇的學習範圍出題</span>'+
      '<div class="dm-quiz-tools">'+
      '<button type="button" data-dq="report-toggle" aria-expanded="false">題目有錯</button>'+
      '<button type="button" data-dq="scope-exclusion" hidden>此題超過學習範圍</button>'+
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
      else if(action==='scope-exclusion')this.openScopeExclusion();
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
  setAutoRegeneration(flag){
    const on=flag===true;
    if(this.autoRegeneration===on)return;
    this.autoRegeneration=on;
    const title=this.$('title'),info=this.$('info');
    if(title)title.textContent=on?'自由問道':'答題充能';
    if(info)info.textContent=on?
      '副本能量每秒自動恢復 1 點（上限 10），不需答題充能。這裡可自由作答、累積修為並查看解析；作答時靈獸與隊友仍持續行動。':
      '答對恢復 4 體力，答錯恢復 1 體力（上限 10）。逐題批改、查看解析，再按下一題。作答時戰鬥及隊友行動不暫停。';
    if(this.visible)this.paint();
  }
  $(name){return this.element.querySelector('[data-dq="'+name+'"]');}
  valid(epoch=this.epoch){
    return epoch===this.epoch&&this.roomId&&this.uid===getMainUser()?.uid;
  }
  attach(roomId,uid,isAdmin=false,autoRegeneration=false){
    if(this.roomId===roomId&&this.uid===uid){
      this.setAdmin(isAdmin);this.setAutoRegeneration(autoRegeneration);return;
    }
    this.epoch++;this.roomId=roomId;this.uid=uid;this.isAdmin=isAdmin===true;
    this.autoRegeneration=!Boolean(autoRegeneration);
    this.setAutoRegeneration(autoRegeneration);
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
    this.autoRegeneration=false;
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
  openScopeExclusion(){
    const item=this.review||this.question;
    if(!this.valid()||!this.visible||!item?.adaptive?.scope?.path||
        this.answering||this.reportBusy)return;
    const epoch=this.epoch,account=this.uid,roomId=this.roomId;
    const questionId=item.questionId||item.id;
    const current=()=>this.valid(epoch)&&this.uid===account&&
      this.roomId===roomId&&this.visible&&
      (this.review?.questionId||this.question?.id)===questionId;
    if(typeof window.openQuizScopeExclusion!=='function'){
      this.reportStatus('學習範圍管理介面尚未載入，請重新整理頁面。');
      return;
    }
    void window.openQuizScopeExclusion({
      mode:'dungeon',quiz:{data:{q:item.q},adaptive:item.adaptive},
      answered:!!this.review,isCurrent:current,
      onUpdated:()=>{
        if(!current())return;
        // The server scope version invalidates old queued questions and
        // in-flight commits. The view must discard its own old question
        // and any promises that were racing the saved exclusion revision.
        ++this.epoch;
        this.loading=false;this.prefetching=false;this.warming=false;
        this.warmUntil=0;
        if(!this.review){
          this.question=null;
          if(window.currentTacticalQuiz===this.learningQuiz)
            window.currentTacticalQuiz=null;
          this.learningQuiz=null;
          this.reportOpen=false;this.errorMessage='';
          this.reportStatus('已更新禁出規則，本題不計錯，正在重新取得題目。');
          this.clearWhiteboard();this.paint();
          void this.load();
        }else{
          // Never discard an already graded review and its explanation.
          this.reportStatus('禁出規則已更新，從下一題開始套用。');
          this.paint();
        }
      }
    });
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
    const questionId=item.questionId||item.id;
    if(this.learningQuiz?.id!==questionId){
      this.learningQuiz={
        id:questionId,
        data:{q:item.q,opts:item.opts},
        learningSubject:item.subject,learningTopic:item.learningTopic||item.topic,
        learningDifficulty:item.difficulty||'easy',
        meta:item.meta||{},adaptive:item.adaptive||null,
        adaptiveSurface:'dungeon',
        adaptiveAnswered:!!this.review,adaptiveHelp:0
      };
    }else this.learningQuiz.adaptiveAnswered=!!this.review;
    window.currentTacticalQuiz=this.learningQuiz;
    const host=this.element.querySelector('.dm-quiz-question');
    if(host)window.QAAdaptiveLearning?.render?.(this.learningQuiz,host);
  }
  syncLearningProgress(response){
    const progress=response?.progress?.stats||response?.state?.progress?.stats;
    if(!progress||getMainUser()?.uid!==this.uid)return;
    const own=window.getCurrentUserData?.();
    if(!own?.stats||own.uid&&own.uid!==this.uid)return;
    // The A-side transaction is authoritative. Sync only the fields it
    // returned and never recreate a grade or a learning observation locally.
    Object.assign(own.stats,progress);
    window.refreshXiuxianLiveSync?.(progress.totalScore);
    window.updateUIStats?.();
    window.renderKnowledgeGraph?.();
  }
  status(message=''){
    const node=this.$('status');if(node)node.textContent=message;
  }
  paint(){
    const content=this.element.querySelector('[data-dq-content]');
    if(!content)return;
    content.replaceChildren();
    const retry=this.$('retry'),claim=this.$('credit'),next=this.$('next');
    const refund=this.$('error-credit'),report=this.$('report-panel');
    const item=this.review||this.question;
    retry.hidden=!this.visible||!!item||this.loading;
    next.hidden=!this.review;
    claim.hidden=!this.pendingCredits.length;
    claim.textContent=this.autoRegeneration?'重試同步答題紀錄':'重試補充體力';
    refund.hidden=!this.errorRefunds.length;
    refund.textContent=this.autoRegeneration?'重試錯題紀錄同步':'重試錯題補償';
    report.hidden=!this.visible||!item||!this.reportOpen;
    this.$('report-toggle').hidden=!this.visible||!item;
    this.$('report-toggle').setAttribute('aria-expanded',String(!report.hidden));
    const exclude=this.$('scope-exclusion');
    exclude.hidden=!this.visible||!item?.adaptive?.scope?.path;
    exclude.disabled=this.answering||this.reportBusy;
    this.$('report-submit').disabled=this.reportBusy;
    this.$('report-submit').textContent=this.reportBusy?'獨立審核中…':'送交獨立審核';
    if(!this.visible)return;
    if(this.loading&&!this.question&&!this.review){
      this.status('正在填充題庫中，已通過審核的題目會自動出現…');
      return;
    }
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
          (this.review&&!this.review.skipped&&
            !this.review.errorConfirmed&&index===this.review.answerIndex?
            ' is-correct':'')+
          (this.review&&!this.review.skipped&&
            !this.review.errorConfirmed&&
            index===this.review.choice&&index!==this.review.answerIndex?
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
      this.status(this.errorMessage||(r.skipped?
        '獨立審核已確認本題有誤，已跳過且不計入成績 · 請按下一題':
        '本題已批改 · 請閱讀解析後按下一題'));
      const feedback=document.createElement('section');
      feedback.className='dm-quiz-feedback tc-feedback-section glass-panel';
      const heading=document.createElement('strong');
      heading.className=r.errorConfirmed||r.correct?'tc-correct':'tc-wrong';
      heading.textContent=r.skipped?
        '本題有誤 · 已跳過'+(this.autoRegeneration||this.isAdmin?'':' · 補充體力 +4'):
        r.errorConfirmed?
          '本題有誤 · 已排除學習統計'+
            (this.autoRegeneration?' · 體力仍每秒自動恢復':
              this.isAdmin?'':' · 原答題體力 +'+r.amount):
          (r.correct?'答對':'答錯')+
            (this.autoRegeneration?' · 能量每秒 +1':
              this.isAdmin?' · 管理員體力固定 10/10':' · 體力 +'+r.amount);
      feedback.append(heading);
      if(!r.skipped&&Number.isFinite(Number(r.reward?.cultivation))){
        const reward=document.createElement('p');
        reward.className='dm-quiz-cultivation';
        const amount=Number(r.reward.cultivation);
        reward.textContent=(r.errorConfirmed?'原始作答：':'本題獲得：')+
          (amount>=0?'+':'')+amount+' 修為'+
          (r.errorConfirmed?'（錯題補償另行結算）':'');
        feedback.append(reward);
      }
      const explanation=document.createElement('section');
      explanation.className='dm-quiz-explanation';
      const label=document.createElement('strong');label.textContent='解析';
      const detail=document.createElement('div');
      detail.innerHTML=rich(r.explanation||'本題尚未提供解析');
      if(r.errorConfirmed){
        label.textContent='原始解析（題目已確認有誤）';
        const original=document.createElement('details');
        const summary=document.createElement('summary');
        summary.textContent='查看已失效的原始解析';
        original.append(summary,detail);
        explanation.append(label,original);
      }else explanation.append(label,detail);
      if(r.reward?.learning){
        const learning=document.createElement('p');
        learning.textContent=r.reward.learning;explanation.append(learning);
      }
      feedback.append(explanation);
      if(r.errorConfirmed&&!r.skipped){
        const confirmed=document.createElement('p');
        confirmed.className='dm-quiz-error-confirmed';
        confirmed.textContent='獨立審核已確認本題有誤，補正由伺服器驗證入帳。';
        feedback.append(confirmed);
      }
      if(!r.correct&&!r.skipped&&!r.errorConfirmed&&
          Number.isInteger(r.choice)&&r.choice>=0){
        const correction=document.createElement('div');
        correction.className='dm-quiz-correction';
        const button=document.createElement('button');
        button.type='button';button.dataset.dq='correction';
        const queued=this.queuedCorrections.has(r.questionId);
        button.disabled=this.correctionBusy||queued;
        button.textContent=queued?'✓ 已加入共用待答題庫':
          this.correctionBusy?'訂正題生成中…':
          '加入訂正練習 · 訂正成功修為 +1';
        const note=document.createElement('small');
        note.textContent='與問道試煉共用訂正題；完成同觀念訂正後依原有規則獲得回饋。';
        correction.append(button,note);feedback.append(correction);
      }
      content.append(feedback);
    }else if(this.question){
      this.status(this.errorMessage||'請選擇 A、B、C、D · '+
        (this.autoRegeneration?'能量每秒自動 +1 · 答題不額外補充能量':
          this.isAdmin?'管理員體力固定 10/10，答題仍計入學習紀錄':
          '答對 +4、答錯 +1 · 可隨時返回戰場'));
    }else this.status(this.errorMessage||'正在填充題庫中…');
    this.bindLearning(item);
    try{window.quizMathTypeset?.(content);}catch(_){}
  }
  async queueCorrection(){
    const review=this.review;
    if(!this.valid()||!review||review.correct||review.skipped||
        review.errorConfirmed||this.correctionBusy||
        this.queuedCorrections.has(review.questionId))return;
    const uid=this.uid,epoch=this.epoch,questionId=review.questionId;
    this.correctionBusy=true;this.paint();
    try{
      if(typeof window.queueTacticalSoloCorrection!=='function')
        throw Error('共用訂正練習系統尚未就緒');
      // This is the same main-solo queue used by 問道試煉, NOT a dungeon
      // duplicate. Its own reward logic grants +1 only on real recovery.
      await window.queueTacticalSoloCorrection({
        question:review.q,subject:review.subject,
        topic:review.learningTopic||review.topic,
        difficulty:review.difficulty,
        adaptive:review.adaptive||null
      });
      if(!this.valid(epoch)||uid!==this.uid)return;
      this.queuedCorrections.add(questionId);
      this.reportStatus('訂正題已加入主問道共用待答題庫。');
    }catch(error){
      if(this.valid(epoch))this.reportStatus(
        error?.message||'訂正題暫時無法生成，請重試');
    }finally{
      this.correctionBusy=false;
      if(this.valid(epoch))this.paint();
    }
  }
  async retryErrorRefunds(){
    if(!this.valid()||!this.errorRefunds.length)return;
    const epoch=this.epoch;
    // The authenticated C receipt makes these retries safe even when a
    // browser reconnects or a previous response was lost in transit.
    for(const row of [...this.errorRefunds].sort((a,b)=>a.index-b.index)){
      if(!this.valid(epoch))return;
      try{
        const result=await refundDungeonQuestionStamina(this.roomId,row.id);
        if(!this.valid(epoch))return;
        if(result?.room)this.onRoom(result.room);
        this.errorRefunds=this.errorRefunds.filter(item=>item.id!==row.id);
      }catch(error){
        if(this.valid(epoch)){
          this.errorMessage=(this.autoRegeneration?
            '錯題審核已確認，但紀錄尚未同步：':
            '錯題審核已確認，但體力差額尚未補入：')+
            (error?.message||'請稍後重試');
          this.paint();
        }
        return;
      }
    }
    if(this.valid(epoch)){
      this.errorMessage='';
      this.paint();
    }
  }
  async sendReport(){
    const item=this.review||this.question,reason=this.$('report-reason')?.value?.trim()||'';
    if(!this.valid()||!item||this.reportBusy)return;
    if(reason.length<6){
      this.reportStatus('請至少用 6 個字具體指出題目錯誤。');
      return;
    }
    const epoch=this.epoch,uid=this.uid,roomId=this.roomId,questionId=item.questionId||item.id;
    this.reportBusy=true;this.paint();
    this.reportStatus('正在進行獨立雙重審核；審核完成後才會補償。');
    try{
      const result=await reportDungeonQuestion(roomId,questionId,reason);
      if(!this.valid(epoch)||this.uid!==uid||this.roomId!==roomId)return;
      if(!result.valid){
        this.reportStatus(result.reason||'審核尚未確認本題有誤。');
        return;
      }
      const state=result.state;
      this.syncLearningProgress(result);
      this.answered=state.answered;
      this.pendingCredits=state.pendingCredits||[];
      this.errorRefunds=state.errorRefunds||[];
      // Do not discard another question if this report finished while the
      // player was switching panels or a fresh SSE snapshot arrived.
      if((this.question?.id||this.review?.questionId)===questionId){
        if(state.lastReview?.questionId===questionId){
          this.review=state.lastReview;this.question=null;
        }
      }
      this.reportOpen=false;
      this.$('report-panel').hidden=true;
      this.$('report-reason').value='';
      this.paint();
      await this.retryCredits();
      await this.retryErrorRefunds();
      if(!this.valid(epoch))return;
      const reward=result.compensated?
        ' · 修為 +'+(result.cultivationAdded||0):'';
      const status=result.skipped?
        '已跳過這道有誤的題目，不計入答題成績。':
        this.autoRegeneration?
          '題目已確認有誤，答題紀錄已更新，能量仍每秒自動恢復。':
          '題目已確認有誤，原答題體力與補正差額依帳號紀錄入帳。';
      this.reportStatus(status+reward+
        (result.status==='limit'?' · 今日補償額度已達上限':''));
      this.paint();
    }catch(error){
      if(this.valid(epoch)){
        this.reportStatus(error?.message||'錯題審核暫時無法完成，請重新送審');
      }
    }finally{
      this.reportBusy=false;
      if(this.valid(epoch))this.paint();
    }
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
        this.errorMessage=this.autoRegeneration?
          '答題已記錄，但伺服器紀錄尚未同步：'+error.message+
            '。可按「重試同步答題紀錄」。':
          '答題已記錄，但體力補發尚未完成：'+error.message+
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
      this.syncLearningProgress(response);
      this.answered=state.answered;
      this.pendingCredits=state.pendingCredits||[];
      this.errorRefunds=state.errorRefunds||[];
      await this.retryCredits();
      if(this.valid(epoch))await this.retryErrorRefunds();
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
      this.question=question;this.review=null;this.reportOpen=false;
      this.questionStartedAt=Date.now();this.paint();
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
    if(globalThis.QAQuestionVisualUI?.allowAnswer(q.q,q.opts)===false)return;
    this.answering=true;this.errorMessage='';this.paint();this.status('正在批改本題…');
    try{
      const result=await answerDungeonQuestion(this.roomId,q.id,choice,0,
        Math.max(0,Math.floor((Date.now()-startedAt)/1000)));
      if(!this.valid(epoch))return;
      this.syncLearningProgress(result);
      this.review=result.review;this.question=null;
      this.answered=result.state.answered;
      this.pendingCredits=result.state.pendingCredits||[];
      this.errorRefunds=result.state.errorRefunds||[];
      this.reportOpen=false;this.paint();
      await this.retryCredits();
      if(this.valid(epoch))await this.retryErrorRefunds();
    }catch(error){
      if(this.valid(epoch))this.errorMessage=error?.message||'批改失敗，請重試';
    }finally{
      this.answering=false;
      if(this.valid(epoch))this.paint();
    }
  }
  async next(){
    if(!this.valid()||!this.review||this.reportBusy)return;
    const epoch=this.epoch,reviewId=this.review.questionId;
    this.$('next').disabled=true;
    try{
      await acknowledgeDungeonReview(this.roomId,reviewId);
      if(!this.valid(epoch))return;
      this.review=null;this.question=null;this.errorMessage='';
      this.reportOpen=false;this.reportStatus('');
      if(window.currentTacticalQuiz===this.learningQuiz)window.currentTacticalQuiz=null;
      this.learningQuiz=null;
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

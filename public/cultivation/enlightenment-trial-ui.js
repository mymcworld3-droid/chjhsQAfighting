import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';

(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rich=value=>window.quizMathRichText?.(String(value||''))||escape(value);
  const math=container=>window.quizMathTypeset?.(container);
  let layer=null, trial=null, selected=null, review=null, busy=false, generation=0, identity='';
  async function api(path,body){
    const response=await authenticatedMainFetch(path,{
      ...(body?{method:'POST',body:JSON.stringify(body)}:{method:'GET'})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||result.ok===false||result.error)throw Error(result.error||'試煉暫時無法使用');
    return result;
  }
  function ensureLayer(){
    if(layer)return layer;
    const link=document.createElement('link');
    link.rel='stylesheet';link.href='/styles/enlightenment-trial.css';link.id='enlightenment-trial-style';
    if(!$('enlightenment-trial-style'))document.head.appendChild(link);
    layer=document.createElement('div');layer.id='enlightenment-trial';
    layer.className='enlightenment-overlay';
    layer.setAttribute('role','dialog');layer.setAttribute('aria-modal','true');
    layer.setAttribute('aria-label','悟道試煉');
    layer.innerHTML='<div class="enlightenment-panel"><header><div><small>INNER CULTIVATION ／ 悟道修行</small><h2>悟道試煉</h2></div><button type="button" data-close aria-label="關閉試煉">×</button></header><div id="enlightenment-body" aria-live="polite"></div></div>';
    layer.querySelector('[data-close]').addEventListener('click',close);
    layer.addEventListener('click',event=>{if(event.target===layer)close();});
    document.body.appendChild(layer);
    return layer;
  }
  function close(){
    generation++;
    layer?.remove();layer=null;selected=null;review=null;busy=false;
    document.body.classList.remove('enlightenment-open');
  }
  function setBody(markup){
    if(!layer)return;
    window.quizMathClear?.($('enlightenment-body'));
    $('enlightenment-body').innerHTML=markup;
    math($('enlightenment-body'));
  }
  function notice(message){
    setBody('<div class="enlightenment-status"><i class="fa-solid fa-circle-notch fa-spin"></i> '+escape(message)+'</div>');
  }
  function trialHeader(){
    return '<div class="enlightenment-overview"><span>指定單元</span><strong>'+escape(trial?.subject||selected?.subject||'待診斷')+
      ' · '+escape(trial?.topic||selected?.topic||'學習弱項')+'</strong><small>固定 5 題，答對至少 4 題即通過。完成後更新知識掌握紀錄。</small></div>';
  }
  function finished(){
    const win=trial.success===true;
    setBody(trialHeader()+'<div class="enlightenment-finish '+(win?'passed':'')+'"><b>'+
      (win?'悟道試煉完成':'試煉尚未通過')+'</b><strong>'+escape(trial.correct)+' / 5 題</strong><p>'+
      (win?(trial.rewarded?'首次掌握此單元，取得 '+(trial.reward?.gold||0)+' 靈石與 '+(trial.reward?.cultivation||0)+' 修為。':'此單元已曾通過，本次不重複領獎。'):
        '已記錄此次練習表現；可複習解析，明日再次挑戰。')+'</p>'+
      '<div class="enlightenment-mastery"><i class="fa-solid fa-award"></i> 掌握單元 '+
      escape(trial.masteryCount||0)+' · '+escape(trial.title||'尚未取得稱號')+'</div>'+
      (win?'<p class="enlightenment-concept-growth">已通過「'+escape(trial.subject)+' · '+escape(trial.topic)+'」本次五題檢驗，完成一輪概念補強。</p>':'')+
      '<button type="button" class="enlightenment-primary" data-close-result>完成</button></div>');
    $('enlightenment-body')?.querySelector('[data-close-result]')?.addEventListener('click',close);
  }
  function resting(){
    const weakness=trial?.weakness;
    setBody('<div class="enlightenment-intro"><p>宗門會依已記錄的答題表現，挑選證據足夠且需要加強的單元。</p>'+
      (weakness?'<div class="enlightenment-overview"><span>推薦補強</span><strong>'+escape(weakness.subject)+' · '+escape(weakness.topic)+
        '</strong><small>已練習 '+escape(weakness.total)+' 題；保守估計 '+escape(weakness.estimate)+'%。</small></div>'+
        '<button type="button" class="enlightenment-primary" data-start>開始五題試煉</button>':
        '<p class="enlightenment-empty">目前沒有足夠的弱項證據。先在問道同一單元練習至少 5 題，系統才能安排試煉。</p>')+
      '<small>每天限一場；通過同一單元的首次獎勵只會發放一次，答題與獎勵皆以伺服器紀錄為準。</small></div>');
    $('enlightenment-body')?.querySelector('[data-start]')?.addEventListener('click',()=>void start());
  }
  function paintQuestion(){
    if(!trial)return;
    if(trial.status==='completed')return finished();
    if(!trial.question){
      setBody(trialHeader()+'<div class="enlightenment-status">已完成 '+trial.index+' / 5 題。</div>'+
        '<button type="button" class="enlightenment-primary" data-next>開始下一題</button>');
      $('enlightenment-body')?.querySelector('[data-next]')?.addEventListener('click',()=>void next());
      return;
    }
    const q=trial.question;
    setBody(trialHeader()+'<div class="enlightenment-step"><span>第 '+(trial.index+1)+' / 5 題</span>'+
      '<span>目前答對 '+trial.correct+' 題</span></div><h3 class="enlightenment-question">'+rich(q.q)+'</h3>'+
      '<div class="enlightenment-options">'+q.opts.map((opt,i)=>
      '<button type="button" data-answer="'+i+'" '+(busy?'disabled':'')+'><span>'+
        'ABCD'[i]+'</span><b>'+rich(opt)+'</b></button>').join('')+'</div>'+
      '<small class="enlightenment-footnote">此題由 AI 生成並經伺服器驗證；答案在提交前不傳送至瀏覽器。</small>');
    $('enlightenment-body')?.querySelectorAll('[data-answer]').forEach(button=>
      button.addEventListener('click',()=>void answer(Number(button.dataset.answer))));
  }
  function paintReview(){
    if(!review)return paintQuestion();
    setBody(trialHeader()+'<div class="enlightenment-review"><strong class="'+(review.correct?'correct':'wrong')+'">'+
      (review.correct?'答對了！':'本題未答對')+'</strong><p>第 '+review.index+' / 5 題 · '+(review.correct?'正確作答':'已記錄錯題')+
      '</p><div class="enlightenment-explanation">'+rich(review.explanation||'此題解析未提供')+'</div>'+
      '<button type="button" class="enlightenment-primary" data-continue>'+
      (trial.status==='completed'?'查看試煉成果':'繼續下一題')+'</button></div>');
    $('enlightenment-body')?.querySelector('[data-continue]')?.addEventListener('click',()=>{
      review=null;
      if(trial.status==='completed')finished();
      else void next();
    });
  }
  function updateLocal(outcome){
    const local=window.getCurrentUserData?.(),uid=getMainUser()?.uid;
    if(!local||uid!==identity||!outcome?.knowledge)return;
    local.stats||={};
    const map=local.stats.knowledgeMap||={};
    const subject=map[trial.subject]||={};
    subject[trial.topic]={...outcome.knowledge};
    map[trial.subject]=subject;
    if(outcome.balances){
      local.stats.gold=outcome.balances.gold;
      local.stats.totalScore=outcome.balances.totalScore;
    }
    if(outcome.state?.status==='completed'){
      local.enlightenmentProgress={...(local.enlightenmentProgress||{}),
        title:outcome.state.title};
    }
    window.dispatchEvent(new CustomEvent('xiuxian:enlightenment-updated',{detail:outcome.state}));
    window.renderKnowledgeGraph?.();
  }
  async function next(){
    if(busy||!layer)return;
    busy=true;notice('正在準備補強題目…');const epoch=++generation,uid=identity;
    try{
      const response=await api('/api/generate-quiz',{quizMode:'enlightenment-trial'});
      if(epoch!==generation||!layer||uid!==getMainUser()?.uid)return;
      const question=response.trialQuestion;
      if(!question||!question.ticket||question.opts?.length!==4)throw Error('題目資料未準備完成');
      trial={...trial,question};review=null;paintQuestion();
    }catch(err){
      if(epoch===generation&&layer)setBody(trialHeader()+'<p class="enlightenment-error">'+escape(err.message)+'</p>'+
        '<button class="enlightenment-primary" type="button" data-retry>重新取得題目</button>');
      $('enlightenment-body')?.querySelector('[data-retry]')?.addEventListener('click',()=>void next());
    }finally{if(epoch===generation)busy=false;}
  }
  async function answer(choice){
    if(busy||!trial?.question)return;
    busy=true;const q=trial.question,epoch=++generation,uid=identity;
    $('enlightenment-body')?.querySelectorAll('[data-answer]').forEach(b=>b.disabled=true);
    try{
      const result=await api('/api/enlightenment/trial/answer',{
        runId:trial.runId,index:trial.index,questionId:q.id,ticket:q.ticket,choice
      });
      if(epoch!==generation||uid!==getMainUser()?.uid||!layer)return;
      trial=result.state;review=result.review;updateLocal(result);paintReview();
      globalThis.QAGameAudio?.answer(review.correct === true, 'enlightenment:'+trial.runId+':'+q.id);
    }catch(err){
      if(epoch===generation&&layer){
        setBody(trialHeader()+'<p class="enlightenment-error">'+escape(err.message)+'</p>'+
          '<button class="enlightenment-primary" type="button" data-recover>同步試煉進度</button>');
        $('enlightenment-body')?.querySelector('[data-recover]')?.addEventListener('click',()=>void load());
      }
    }finally{if(epoch===generation)busy=false;}
  }
  async function start(){
    if(busy)return;busy=true;notice('正在確認學習紀錄…');
    try{
      const r=await api('/api/enlightenment/trial/start',selected||{});
      if(!layer||identity!==getMainUser()?.uid)return;
      trial=r.trial;
      if(trial.status==='completed')finished();
      else if(trial.question)paintQuestion();
      else {busy=false;await next();}
    }catch(err){if(layer)setBody('<p class="enlightenment-error">'+escape(err.message)+'</p>'+
      '<button class="enlightenment-primary" type="button" data-reload>查看試煉狀態</button>');
      $('enlightenment-body')?.querySelector('[data-reload]')?.addEventListener('click',()=>void load());
    }finally{busy=false;}
  }
  async function load(){
    if(busy)return;busy=true;notice('正在同步悟道紀錄…');
    const epoch=++generation;
    try{
      const payload=await api('/api/enlightenment/trial');
      if(epoch!==generation||!layer||identity!==getMainUser()?.uid)return;
      trial=payload.trial;review=null;
      if(trial.status==='idle')resting();
      else if(trial.status==='completed')finished();
      else if(trial.question)paintQuestion();
      else {busy=false;await next();}
    }catch(err){if(layer)setBody('<p class="enlightenment-error">'+escape(err.message)+'</p>');}
    finally{if(epoch===generation)busy=false;}
  }
  function open(event){
    identity=getMainUser()?.uid||'';
    if(!identity){window.showToast?.('請先登入才能開始悟道試煉');return;}
    close();
    selected={subject:String(event?.detail?.subject||''),topic:String(event?.detail?.topic||'')};
    identity=getMainUser()?.uid||'';
    ensureLayer();document.body.classList.add('enlightenment-open');
    void load();
  }
  window.addEventListener('xiuxian:enlightenment-open',open);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&layer)close();});
  window.addEventListener('xiuxian:user-ready',()=>{if(layer&&identity!==getMainUser()?.uid)close();});
})();

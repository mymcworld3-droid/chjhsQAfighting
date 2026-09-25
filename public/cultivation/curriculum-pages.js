// 研修所三步選課：年級 → 科目 → 全學年章節；學期與版本由資料層自動整合。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fields = ['cs-grade','cs-subject'];
  const names = ['選年級','選科目','選章節'];
  let root, active = 0, ready = false;
  function options(id) {
    return [...($(id)?.options || [])].filter(o => o.value).map(o => ({value:o.value,label:o.textContent}));
  }
  function current(id) { return $(id)?.value || ''; }
  function clean(value) { return String(value || '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function setPage(page) {
    if (!root) return;
    active = Math.max(0,Math.min(2,page));
    root.dataset.step = String(active);
    for (let i=0;i<3;i++) {
      const item = $('cs-stage-'+i);
      if (item) item.hidden = i!==active;
    }
    const back = $('cs-prev'), next = $('cs-next');
    if (back) back.textContent = active===0 ? '← 返回洞府' : '← 返回上一步';
    if (next) {
      next.textContent = active===2?'查看已選範圍':'下一步　→';
      next.disabled = active<2 && !current(fields[active]);
    }
    const scroller=$('ss-picker-body');if(scroller)scroller.scrollTop=0;
  }
  function visibleOptions(stage) {
    const native=$(fields[stage]);
    const holder=$('cs-cards-'+stage);
    if (!holder || !native) return;
    holder.replaceChildren();
    const list=options(fields[stage]);
    if (!list.length) {
      const empty=document.createElement('p');empty.className='cs-step-empty';
      empty.textContent='此範圍目前沒有可選資料，請返回調整上一項。';holder.append(empty);
      return;
    }
    const selected=current(fields[stage]);
    list.forEach((opt,index)=>{
      const btn=document.createElement('button');btn.type='button';btn.className='cs-choice';
      btn.classList.toggle('is-selected',opt.value===selected);
      btn.setAttribute('aria-pressed',String(opt.value===selected));
      btn.innerHTML='<span class="cs-choice-num">'+String(index+1).padStart(2,'0')+'</span><span class="cs-choice-main">'+clean(opt.label)+'</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i>';
      btn.addEventListener('click',()=>{
        if(native.value!==opt.value){native.value=opt.value;native.dispatchEvent(new Event('change',{bubbles:true}));}
        // 科目選完直接進章節；資料在 curriculum:options-ready 回報後刷新。
        setPage(Math.min(2,stage+1));
        refresh();
      });
      holder.append(btn);
    });
  }
  function refresh() {
    if (!root) return;
    for(let i=0;i<2;i++)visibleOptions(i);
    const next=$('cs-next');
    if (next && active<2)next.disabled=!current(fields[active]);
  }
  function onOptions() { if (!root) return;refresh(); }
  function mount() {
    if (ready) return true;
    const base=$('cs-scope');
    if (!base || !$('cs-units') || !$('cs-grade')) return false;
    const note=base.querySelector(':scope > .cs-note');
    const native=base.querySelector('.cs-fields');
    const search=base.querySelector('.cs-search-field');
    const tools=base.querySelector('.cs-tools');
    const chapter= $('cs-units'), add=$('cs-add'), custom=base.querySelector('.cs-custom-panel'),
      message=$('cs-message');
    if(!native||!search||!tools||!chapter||!add||!custom||!message)return false;
    root=document.createElement('section');root.id='cs-pages';root.className='cs-pages';root.dataset.step='0';
    root.innerHTML='<div class="cs-page-navigation"><button type="button" id="cs-prev" class="cs-back">← 返回洞府</button></div>'+
      names.map((name,i)=>'<section class="cs-stage" id="cs-stage-'+i+'" '+(i?'hidden':'')+' aria-label="'+name+'"><div class="cs-stage-title"><small>STEP 0'+(i+1)+'</small><h4>'+(['選擇你的年級','想練習哪一科？','勾選全學年章節與考點'][i])+'</h4><p>'+(['每個年級都可獨立安排，不必受個人資料的預設學制限制。','選完科目就直接進入章節；上下學期已合併，不再另外選版本。','上、下學期章節會一起顯示並標示原學期；可勾選整章或個別考點。'][i])+'</p></div><div id="cs-cards-'+i+'" class="cs-choice-grid"></div></section>').join('')+
      '<div class="cs-page-actions"><button type="button" id="cs-next">下一步　→</button></div>';
    base.insertBefore(root,note||base.firstChild);
    // 保留原始 select 與事件處理器，僅從可見區域隱藏。
    native.classList.add('cs-native-fields');root.append(native);
    const last=$('cs-stage-2');
    last.append(search,tools,chapter,add,custom,message);
    const smallNote=base.lastElementChild;
    if(smallNote?.classList.contains('cs-note'))last.append(smallNote);
    $('cs-prev').addEventListener('click',()=>{
      if(active===0) window.closeCurriculumStudio?.();
      else setPage(active-1);
    });
    $('cs-next').addEventListener('click',()=>{
      if(active===2){$('ss-tab-cart')?.click();return;}
      if(!current(fields[active]))return;
      setPage(active+1);
    });
    fields.forEach(id=>$(id)?.addEventListener('change',()=>{refresh();}));
    window.addEventListener('curriculum:options-ready',onOptions);
    ready=true;refresh();setPage(0);
    return true;
  }
  window.resetCurriculumPages=()=>{if(mount())setPage(0);};
  window.openCurriculumPage=page=>{if(mount())setPage(page);};
  function boot(){mount();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();

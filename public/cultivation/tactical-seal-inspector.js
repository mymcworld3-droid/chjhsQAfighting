/* Read-only PvE v4 sealing objective inspector; never submits combat actions. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
export function sealArtwork(seal,rules){
  const kinds=rules?.SEAL_KINDS||[],col=kinds.indexOf(seal.kind);
  const row=seal.broken?2:seal.hp<seal.maxHp?1:0;
  return {x:col<0?0:col/Math.max(1,kinds.length-1)*100,y:row*50};
}
export function sealAreaText(seal,state){
  if(seal.broken)return '已破除，該座陣眼的影響範圍不再生效。';
  if(seal.range.kind==='manhattan')return '距離 '+seal.range.radius+' 格內的菱形區域，石障不會阻擋效果。';
  if(seal.range.kind==='warning'){
    const hazards=(state.objective?.hazards||[]).filter(p=>Number.isInteger(p.x)&&Number.isInteger(p.y)&&
      p.x>=0&&p.y>=0&&p.x<state.width&&p.y<state.height);
    return hazards.length?'目前預告 '+hazards.length+' 格危險區域；紅色格為實際預告位置。':
      '目前沒有危險格預告；妖煞沒有固定半徑。';
  }
  if(seal.range.kind==='linked-block'){
    const gate=seal.gate,exists=gate&&(state.blocks||[]).some(p=>p.x===gate.x&&p.y===gate.y);
    return exists?'連動石障：第 '+(gate.x+1)+' 欄、第 '+(gate.y+1)+' 列；破除後開通道路。':
      '目前沒有尚存的連動石障，沒有固定半徑。';
  }
  return seal.range.label;
}
export function sealBreakText(seal,state){
  if(!seal.broken)return '需再命中 '+seal.hp+' 次；'+seal.onBreak;
  if(seal.kind==='hazard'&&(state.objective?.points||[]).some(p=>!p.activated&&p.kind==='hazard'))
    return '此座已破除，但其他妖煞陣眼仍然運作。';
  return seal.onBreak;
}
const status=s=>s.broken?'已破除':s.hp<s.maxHp?'已受損':'運作中';
const make=(type,className,attribute,label)=>{
  const el=document.createElement(type);
  el.className=className;el.hidden=true;
  if(attribute)el.dataset[attribute]='';
  if(label)el.setAttribute('aria-label',label);
  return el;
};
export class SealInspector{
  constructor(root,{getState,getRenderer,rules,onFocusRange,onNavigate,closeOther,isOtherOpen}){
    this.root=root;this.getState=getState;this.getRenderer=getRenderer;
    this.rules=rules;this.onFocusRange=onFocusRange;this.onNavigate=onNavigate;this.closeOther=closeOther;
    this.isOtherOpen=isOtherOpen||(()=>false);
    this.rosterOpen=false;this.pinnedId=null;this.returnFocus=null;
    this.cached=new WeakMap();
    // The battle canvas already falls back when artwork fails. The inspector
    // must be equally usable offline / before the WebP download completes.
    this.artworkStatus='idle';this.artworkImage=null;
    this.toggle=make('button','tc-seal-inspector-toggle','sealInspectorToggle','查看本關陣眼');
    this.toggle.type='button';this.toggle.setAttribute('aria-expanded','false');
    this.toggle.setAttribute('aria-controls','tc-seal-inspector-roster');
    this.toggle.innerHTML='<i class="fa-solid fa-dharmachakra" aria-hidden="true"></i> 陣眼 <span data-seal-inspector-count>0</span>';
    root.querySelector('.tc-top-right').insertBefore(this.toggle,root.querySelector('[data-loadout-toggle]'));
    this.scrim=make('button','tc-seal-inspector-scrim','sealInspectorDismiss','關閉陣眼資料');this.scrim.type='button';
    this.roster=make('section','tc-seal-inspector-roster','sealInspectorRoster','本關陣眼清單');
    this.roster.id='tc-seal-inspector-roster';
    this.panel=make('section','tc-seal-inspector-panel','sealInspectorPanel','陣眼戰場情報');
    this.panel.id='tc-seal-inspector-panel';
    for(const elem of [this.roster,this.panel]){
      elem.setAttribute('role','dialog');elem.setAttribute('aria-modal','true');
    }
    root.append(this.scrim,this.roster,this.panel);
  }
  validState(){
    const s=this.getState();
    return s?.mode==='pve'&&s.trial?.layoutVersion===4&&s.objective?.type==='sealing';
  }
  active(){
    return this.validState()&&!!this.root.querySelector('.tc-main.tc-game canvas')&&
      this.root.querySelector('[data-modal]')?.hidden===true;
  }
  seals(){return this.validState()?this.rules.sealInfos(this.getState()):[];}
  find(position){
    const id=typeof position==='string'?position:
      Number.isInteger(position?.x)&&Number.isInteger(position?.y)?position.x+','+position.y:null;
    return /^\d+,\d+$/.test(id||'')?this.seals().find(s=>s.id===id)||null:null;
  }
  isOpen(){return this.rosterOpen||!!this.pinnedId;}
  dialogElement(){return this.rosterOpen?this.roster:this.pinnedId?this.panel:null;}
  rememberFocus(){
    if(this.isOpen())return;
    const focus=document.activeElement;
    this.returnFocus=this.root.contains(focus)&&focus!==document.body?focus:this.toggle;
  }
  setHTML(node,html){
    if(this.cached.get(node)===html)return;
    const scroll=node.scrollTop,active=document.activeElement;
    const key=['data-seal-inspector-select','data-seal-inspector-close','data-seal-inspector-back',
      'data-seal-inspector-range','data-seal-inspector-locate'].find(k=>
      node.contains(active)&&active?.hasAttribute?.(k));
    const value=key?active.getAttribute(key):null;
    node.innerHTML=html;this.cached.set(node,html);node.scrollTop=scroll;
    if(key)[...node.querySelectorAll('button['+key+']')]
      .find(b=>b.getAttribute(key)===value)?.focus({preventScroll:true});
  }
  handleButton(button){
    if(button.hasAttribute('data-seal-inspector-toggle')){this.toggleRoster();return true;}
    if(button.hasAttribute('data-seal-inspector-close')||button.hasAttribute('data-seal-inspector-dismiss')){
      this.dismiss({restoreFocus:true});return true;
    }
    if(button.hasAttribute('data-seal-inspector-select')){
      this.inspect(button.dataset.sealInspectorSelect);return true;
    }
    if(button.hasAttribute('data-seal-inspector-back')){
      this.pinnedId=null;this.rosterOpen=true;this.refresh();
      this.roster.querySelector('[data-seal-inspector-select]')?.focus({preventScroll:true});
      return true;
    }
    if(button.hasAttribute('data-seal-inspector-range')||button.hasAttribute('data-seal-inspector-locate')){
      const seal=this.find(this.pinnedId);
      if(seal){
        const range=button.hasAttribute('data-seal-inspector-range');
        if(!range||seal.active){
          this.dismiss();
          if(range)this.onFocusRange?.(seal);else this.onNavigate?.(seal);
          this.getRenderer()?.canvas?.focus?.({preventScroll:true});
        }
      }
      return true;
    }
    return false;
  }
  toggleRoster(){
    if(!this.active())return;
    if(this.rosterOpen){this.dismiss({restoreFocus:true});return;}
    this.closeOther?.();this.rememberFocus();
    this.rosterOpen=true;this.pinnedId=null;this.refresh();
    this.roster.querySelector('[data-seal-inspector-close]')?.focus({preventScroll:true});
  }
  inspect(position){
    if(!this.active())return false;
    const seal=this.find(position);if(!seal)return false;
    if(!this.isOpen()){this.closeOther?.();this.rememberFocus();}
    this.rosterOpen=false;this.pinnedId=seal.id;this.refresh();
    this.panel.querySelector('[data-seal-inspector-close]')?.focus({preventScroll:true});
    return true;
  }
  dismiss({restoreFocus=false}={}){
    const focus=this.returnFocus;this.returnFocus=null;
    this.rosterOpen=false;this.pinnedId=null;
    this.scrim.hidden=true;this.roster.hidden=true;this.panel.hidden=true;
    this.toggle.setAttribute('aria-expanded','false');
    this.toggle.setAttribute('aria-controls','tc-seal-inspector-roster');
    const main=this.root.querySelector('[data-main]');
    if(main)main.inert=this.isOtherOpen()||this.root.querySelector('[data-modal]')?.hidden===false;
    if(restoreFocus){
      const target=focus?.isConnected?focus:this.toggle;
      if(target&&!target.hidden)target.focus({preventScroll:true});
      else this.getRenderer()?.canvas?.focus?.({preventScroll:true});
    }
  }
  reset(){
    this.dismiss();this.toggle.hidden=true;
    this.toggle.querySelector('[data-seal-inspector-count]').textContent='0';
  }
  ensureArtwork(){
    if(this.artworkStatus!=='idle')return;
    if(typeof Image==='undefined'){this.artworkStatus='unavailable';return;}
    this.artworkStatus='loading';
    const image=new Image();this.artworkImage=image;
    image.decoding='async';
    image.onload=()=>{
      if(this.artworkImage!==image)return;
      this.artworkStatus=image.naturalWidth===512&&image.naturalHeight===384?'ready':'unavailable';
      if(this.artworkStatus!=='ready')image.onload=image.onerror=null;
      if(this.active())this.refresh();
    };
    image.onerror=()=>{
      if(this.artworkImage!==image)return;
      this.artworkStatus='unavailable';image.onload=image.onerror=null;
      if(this.active())this.refresh();
    };
    image.src='/assets/seals/seal-atlas.webp';
  }
  picture(seal){
    const p=sealArtwork(seal,this.rules);
    const fallback={shield:'護',hazard:'煞',rage:'獸',maze:'迷'}[seal.kind]||'陣';
    const ready=this.artworkStatus==='ready';
    return '<span class="tc-seal-inspector-art'+(ready?' is-ready':'')+
      '" role="img" aria-label="'+esc(seal.name)+
      '" style="--seal-color:'+esc(seal.color)+';background-position:'+p.x+'% '+p.y+'%">'+
      (ready?'':'<span class="tc-seal-inspector-art-fallback" aria-hidden="true">'+fallback+'</span>')+
      '</span>';
  }
  renderRoster(){
    const seals=this.seals(),left=seals.filter(s=>s.active).length;
    const items=seals.map(s=>[
      '<button type="button" class="tc-seal-inspector-row',s.broken?' is-broken':'',
      '" data-seal-inspector-select="',esc(s.id),'" style="--seal-color:',esc(s.color),'">',
      this.picture(s),'<span class="tc-seal-inspector-row-info"><strong>',esc(s.name),
      '</strong><small>',esc(s.shortEffect),' · ',s.broken?'已破除':'耐久 '+s.hp+'/'+s.maxHp,
      '</small></span><span aria-hidden="true">›</span></button>'
    ].join('')).join('');
    const html=[
      '<header class="tc-seal-inspector-head"><div><small>問道試煉 · 封印機關</small><h2>本關陣眼 <span>',
      left,' / ',seals.length,' 未破除</span></h2></div>',
      '<button type="button" data-seal-inspector-close aria-label="關閉陣眼清單">×</button></header>',
      '<p class="tc-seal-inspector-helper">點選陣眼查看效果與破解方式；查看資料不消耗體力。</p>',
      '<div class="tc-seal-inspector-list">',items,'</div>'
    ].join('');
    this.setHTML(this.roster,html);
  }
  renderPanel(){
    const seal=this.find(this.pinnedId);if(!seal){this.dismiss();return;}
    const state=this.getState(),max=Math.max(1,Number(seal.maxHp)||1);
    const hp=clamp(Number(seal.hp)||0,0,max),pct=Math.round(100*hp/max);
    const current=this.getRenderer()?.sealTargetPlan?.seals?.find(s=>s.id===seal.id);
    const hit=seal.broken?'已破除，無須繼續攻擊':
      current?.reason||'切換攻擊招式後可以查看是否能命中。';
    const html=[
      '<header class="tc-seal-inspector-head"><div><small>戰場機關 · 即時情報</small><h2>',
      esc(seal.name),'</h2></div><button type="button" data-seal-inspector-close aria-label="關閉陣眼情報">×</button></header>',
      '<div class="tc-seal-inspector-identity" style="--seal-color:',esc(seal.color),'">',
      this.picture(seal),'<div class="tc-seal-inspector-ident-info"><strong>',status(seal),'</strong>',
      '<div class="tc-seal-inspector-hp-text"><span>耐久</span><b>',hp,' / ',max,'</b></div>',
      '<div class="tc-seal-inspector-hp" role="progressbar" aria-label="陣眼耐久" aria-valuemin="0" aria-valuemax="',
      max,'" aria-valuenow="',hp,'"><i style="width:',pct,'%"></i></div>',
      '<small>座標：第 ',seal.x+1,' 欄，第 ',seal.y+1,' 列</small></div></div>',
      '<div class="tc-seal-inspector-detail"><section><h3>機關效果</h3><p>',esc(seal.effect),
      '</p></section><section><h3>影響範圍</h3><p>',esc(sealAreaText(seal,state)),
      '</p></section><section><h3>攻擊與破解</h3><p>',esc(hit),
      '</p></section><section><h3>破除效果</h3><p>',esc(sealBreakText(seal,state)),
      '</p></section><section class="tc-seal-inspector-tactic"><h3>戰術建議</h3><p>',
      esc(seal.tactic),'</p></section></div>',
      '<footer class="tc-seal-inspector-footer"><button type="button" data-seal-inspector-back>本關清單</button>',
      '<button type="button" data-seal-inspector-locate>定位陣眼</button>',
      '<button type="button" data-seal-inspector-range ',seal.broken?'disabled title="已破除，範圍不再生效"':'',
      '>查看範圍</button></footer>'
    ].join('');
    this.setHTML(this.panel,html);
  }
  refresh(){
    if(!this.active()){this.reset();return;}
    this.ensureArtwork();
    const seals=this.seals(),count=seals.filter(s=>s.active).length;
    this.toggle.hidden=!seals.length;
    if(!seals.length){this.dismiss();return;}
    this.toggle.querySelector('[data-seal-inspector-count]').textContent=count+'/'+seals.length;
    this.toggle.setAttribute('aria-label','陣眼情報，未破除 '+count+' 座，共 '+seals.length+' 座');
    if(this.pinnedId&&!seals.some(s=>s.id===this.pinnedId))this.pinnedId=null;
    this.toggle.setAttribute('aria-expanded',String(this.isOpen()));
    this.toggle.setAttribute('aria-controls',this.pinnedId?'tc-seal-inspector-panel':'tc-seal-inspector-roster');
    this.scrim.hidden=!this.isOpen();
    this.roster.hidden=!this.rosterOpen;this.panel.hidden=!this.pinnedId;
    const main=this.root.querySelector('[data-main]');
    if(main)main.inert=this.isOpen()||this.isOtherOpen()||
      this.root.querySelector('[data-modal]')?.hidden===false;
    if(this.rosterOpen)this.renderRoster();
    if(this.pinnedId)this.renderPanel();
  }
}

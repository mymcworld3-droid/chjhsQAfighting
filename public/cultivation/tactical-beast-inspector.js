import './battle-presentation.js';
/* Read-only PvE creature inspection. Never submits an action or changes combat state. */
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);
const positive=value=>Math.max(0,Number(value)||0);
const profile=actor=>globalThis.QATactical?.monsterProfileFor?.(actor)||globalThis.QATactical?.monsterProfile(actor.species);
const portrait=actor=>{
  const species=Math.max(0,Math.min(19,Number(actor.species)||0));
  const x=(species%5)*25,y=Math.floor(species/5)*100/3;
  return '<span class="tc-beast-portrait" role="img" aria-label="'+esc(actor.name)+
    '" style="background-position:'+x+'% '+y+'%"></span>';
};
const health=actor=>'<div class="tc-beast-hp-row"><span>生命</span><b>'+globalThis.QABattlePresentation.health(actor).text+'</b></div>'+globalThis.QABattlePresentation.healthMarkup(actor,{trackClass:'tc-beast-hp-track',kind:'enemy'});

export class BeastInspector {
  constructor(root,{getState,getRenderer,getManuals,openDemo}){
    this.root=root;this.getState=getState;this.getRenderer=getRenderer;
    this.getManuals=getManuals;this.openDemo=openDemo;
    this.hoverUid=null;this.pinnedUid=null;this.rosterOpen=false;this.returnFocus=null;this.contentCache=new WeakMap();
    this.toggle=document.createElement('button');
    this.toggle.type='button';this.toggle.dataset.beastToggle='';
    this.toggle.className='tc-beast-toggle';this.toggle.hidden=true;
    this.toggle.setAttribute('aria-expanded','false');
    this.toggle.setAttribute('aria-controls','tc-beast-roster');
    this.toggle.innerHTML='<i class="fa-solid fa-paw" aria-hidden="true"></i> 靈獸 <span data-beast-count>0</span>';
    root.querySelector('.tc-top-right').insertBefore(this.toggle,root.querySelector('[data-loadout-toggle]'));
    this.scrim=document.createElement('button');
    this.scrim.type='button';this.scrim.className='tc-beast-scrim';
    this.scrim.dataset.beastDismiss='';this.scrim.setAttribute('aria-label','關閉靈獸資料');
    this.scrim.hidden=true;
    this.roster=document.createElement('section');
    this.roster.className='tc-beast-roster';this.roster.id='tc-beast-roster';
    this.roster.dataset.beastRoster='';this.roster.hidden=true;
    this.roster.setAttribute('role','dialog');this.roster.setAttribute('aria-label','本關靈獸清單');this.roster.setAttribute('aria-modal','true');
    this.panel=document.createElement('section');this.panel.className='tc-beast-panel';
    this.panel.dataset.beastPanel='';this.panel.id='tc-beast-panel';this.panel.hidden=true;
    this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-label','靈獸戰鬥資料');this.panel.setAttribute('aria-modal','true');
    this.peek=document.createElement('aside');this.peek.className='tc-beast-peek';
    this.peek.dataset.beastPeek='';this.peek.hidden=true;
    this.peek.setAttribute('aria-label','靈獸快速資訊');
    root.append(this.scrim,this.roster,this.panel,this.peek);
  }
  beasts(){
    const battle=this.getState();
    return battle?.mode==='pve'?(battle.actors||[]).filter(a=>a.bot):[];
  }
  active(){
    return this.getState()?.mode==='pve'&&!!this.root.querySelector('.tc-main.tc-game canvas')&&
      this.root.querySelector('[data-modal]')?.hidden===true;
  }
  find(uid){return this.beasts().find(a=>a.uid===uid)||null;}
  isOpen(){return this.rosterOpen||!!this.pinnedUid;}
  dialogElement(){return this.rosterOpen?this.roster:this.pinnedUid?this.panel:null;}
  rememberFocus(){
    if(!this.isOpen())this.returnFocus=this.root.contains(document.activeElement)&&document.activeElement!==document.body?
      document.activeElement:this.toggle;
  }
  setContent(element,html){
    if(this.contentCache.get(element)===html)return;
    const oldTop=element.scrollTop,active=document.activeElement;
    const focused=element.contains(active)&&active instanceof Element?active:null;
    const key=['data-beast-select','data-beast-close','data-beast-back','data-beast-demo']
      .find(attribute=>focused?.hasAttribute(attribute));
    const value=key?focused.getAttribute(key):null;
    element.innerHTML=html;
    this.contentCache.set(element,html);
    element.scrollTop=oldTop;
    if(key)[...element.querySelectorAll('button['+key+']')]
      .find(button=>button.getAttribute(key)===value)?.focus({preventScroll:true});
  }
  handleButton(button){
    if(button.hasAttribute('data-beast-toggle')){this.toggleRoster();return true;}
    if(button.hasAttribute('data-beast-dismiss')||button.hasAttribute('data-beast-close')){
      this.dismiss({restoreFocus:true});return true;
    }
    if(button.hasAttribute('data-beast-select')){
      this.inspect(button.dataset.beastSelect,'pin');return true;
    }
    if(button.hasAttribute('data-beast-back')){
      this.pinnedUid=null;this.rosterOpen=true;this.hoverUid=null;this.refresh();
      this.roster.querySelector('[data-beast-select]')?.focus({preventScroll:true});return true;
    }
    if(button.hasAttribute('data-beast-demo')){
      const actor=this.find(this.pinnedUid);
      if(actor){
        const species=actor.species;
        this.dismiss();
        this.openDemo(species);
      }
      return true;
    }
    return false;
  }
  inspect(uid,kind='hover'){
    if(!this.active()||!this.root.querySelector('[data-modal]')?.hidden)return;
    const actor=this.find(uid);
    if(kind==='hover'){
      if(this.isOpen())return;
      const next=actor?.hp>0?actor.uid:null;
      if(this.hoverUid===next)return;
      this.hoverUid=next;this.renderPeek();
      this.getRenderer()?.setInspectTarget(next);
      return;
    }
    if(!actor)return;
    this.rememberFocus();this.hoverUid=null;this.rosterOpen=false;this.pinnedUid=actor.uid;
    this.refresh();
    this.panel.querySelector('[data-beast-close]')?.focus({preventScroll:true});
  }
  toggleRoster(){
    if(!this.active())return;
    this.rememberFocus();
    const opening=!this.rosterOpen;
    this.pinnedUid=null;this.hoverUid=null;
    this.rosterOpen=opening;this.refresh();
    if(opening)this.roster.querySelector('[data-beast-close]')?.focus({preventScroll:true});
    else this.toggle.focus({preventScroll:true});
  }
  dismiss({restoreFocus=false}={}){
    const focus=this.returnFocus;
    this.returnFocus=null;
    this.rosterOpen=false;this.pinnedUid=null;this.hoverUid=null;
    this.scrim.hidden=true;this.roster.hidden=true;this.panel.hidden=true;this.peek.hidden=true;
    const main=this.root.querySelector('[data-main]');
    if(main)main.inert=this.root.querySelector('[data-modal]')?.hidden===false;
    this.toggle.setAttribute('aria-expanded','false');
    this.getRenderer()?.setInspectTarget(null);
    if(restoreFocus){
      const target=focus?.isConnected?focus:this.toggle;
      if(target&&!target.hidden)target.focus({preventScroll:true});
    }
  }
  reset(){this.dismiss();this.toggle.hidden=true;this.toggle.querySelector('[data-beast-count]').textContent='0';}
  renderRoster(){
    const actors=this.beasts().slice().sort((a,b)=>Number(b.hp>0)-Number(a.hp>0));
    const living=actors.filter(a=>a.hp>0).length;
    const html='<header class="tc-beast-card-title"><div><small>問道試煉 · 妖獸圖鑑</small><h2>本關靈獸 <span>'+living+' / '+actors.length+'</span></h2></div>'+
      '<button type="button" data-beast-close aria-label="關閉靈獸清單">×</button></header>'+
      '<p class="tc-beast-helper">點選靈獸查看攻擊、移動與應對方法；查看資料不消耗體力。</p>'+
      '<div class="tc-beast-list">'+(actors.length?actors.map(actor=>{
        const beast=profile(actor),down=actor.hp<=0;
        return '<button type="button" class="tc-beast-row'+(down?' is-down':'')+
          '" data-beast-select="'+esc(actor.uid)+'">'+portrait(actor)+
          '<span class="tc-beast-row-body"><strong>'+esc(actor.name||beast?.name)+'</strong>'+
          '<small>'+esc(beast?.attackName||'尚無招式資料')+' · '+esc(down?'已擊敗':Math.ceil(positive(actor.hp))+' / '+actor.maxHp+' 生命')+'</small></span>'+
          '<i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>';
      }).join(''):'<p class="tc-beast-empty">本關沒有靈獸。</p>')+'</div>';
    this.setContent(this.roster,html);
  }
  renderPanel(){
    const actor=this.find(this.pinnedUid);
    if(!actor){this.dismiss();return;}
    const beast=profile(actor),manuals=this.getManuals(),realm=manuals?.realmForStage?.(actor.level);
    const statuses=[actor.shield?'護盾 '+actor.shield:'',actor.slow?'緩速':'',actor.guard?'護身':'',actor.hp<=0?'已擊敗':''].filter(Boolean);
    const intent=actor.intent,shape=({charge:'直線衝撞',line:'直線',cone:'扇形',square:'方形震波',blast:'範圍'})[intent?.shape];
    const threat=(intent?.text||'目前沒有已鎖定的攻擊預告')+(intent?.kind==='attack'&&intent.version===3?' · '+(intent.warning==='locked'?'固定鎖定':'追蹤')+(shape?' · '+shape:'')+' · '+(intent.cells?.length||0)+' 格'+(intent.waves?.length?' · '+intent.waves.length+' 層':''):'')+(actor.dungeonResistanceEvery?'；每 '+actor.dungeonResistanceEvery+' 次合法推動抵消一格':'');
    const html='<header class="tc-beast-card-title"><div><small>戰場資料 · 即時狀態</small><h2>'+esc(actor.name||beast?.name)+'</h2></div>'+
      '<button type="button" data-beast-close aria-label="關閉靈獸資料">×</button></header>'+
      '<div class="tc-beast-identity">'+portrait(actor)+'<div><small>'+esc(actor.boss?'首領靈獸':'靈獸')+
      (realm?' · '+esc(realm.name)+'境':'')+'</small>'+health(actor)+
      (statuses.length?'<p class="tc-beast-status">'+statuses.map(esc).join(' · ')+'</p>':'')+
      '</div></div>'+
      '<div class="tc-beast-traits"><section><small>攻擊招式</small><strong>'+esc(beast?.attackName||'未知')+'</strong><p>'+esc(beast?.attackText||'尚無資料')+
      '</p></section><section><small>移動習性</small><strong>'+esc(beast?.moveName||'未知')+'</strong><p>'+esc(beast?.moveText||'尚無資料')+'</p></section></div>'+
      '<section class="tc-beast-intent"><strong>目前攻擊預告</strong><p>'+esc(threat)+'</p></section>'+
      '<section class="tc-beast-advice"><strong>應對建議</strong><p>'+esc(beast?.tip||'觀察紅色危險格並確認移動範圍。')+'</p></section>'+
      '<footer class="tc-beast-footer"><button type="button" data-beast-back>本關清單</button>'+
      '<button type="button" data-beast-demo>觀看招式演練</button></footer>';
    this.setContent(this.panel,html);
  }
  renderPeek(){
    const actor=this.find(this.hoverUid);
    if(!actor||this.isOpen()||!this.active()){
      this.peek.hidden=true;return;
    }
    const beast=profile(actor);
    const html='<div class="tc-beast-peek-head">'+portrait(actor)+
      '<span><strong>'+esc(actor.name||beast?.name)+'</strong><small>'+esc(beast?.attackName||'未知招式')+
      '</small></span></div>'+health(actor)+
      '<p>'+esc(actor.intent?.text||beast?.tip||'')+'</p><small class="tc-beast-peek-hint">長按靈獸或點頂部「靈獸」查看詳細資料</small>';
    this.setContent(this.peek,html);
    this.peek.hidden=false;
  }
  refresh(){
    if(!this.active()){this.reset();return;}
    const actors=this.beasts(),living=actors.filter(a=>a.hp>0).length;
    this.toggle.hidden=false;
    this.toggle.querySelector('[data-beast-count]').textContent=String(living);
    this.toggle.setAttribute('aria-label','查看本關靈獸，尚存活 '+living+' 隻');
    if(this.pinnedUid&&!this.find(this.pinnedUid))this.pinnedUid=null;
    this.toggle.setAttribute('aria-expanded',String(this.isOpen()));
    this.toggle.setAttribute('aria-controls',this.pinnedUid?'tc-beast-panel':'tc-beast-roster');
    this.scrim.hidden=!this.isOpen();
    this.roster.hidden=!this.rosterOpen;
    this.panel.hidden=!this.pinnedUid;
    const main=this.root.querySelector('[data-main]');
    if(main)main.inert=this.isOpen();
    if(this.rosterOpen)this.renderRoster();
    if(this.pinnedUid)this.renderPanel();
    this.renderPeek();
    this.getRenderer()?.setInspectTarget(this.pinnedUid||this.hoverUid);
  }
}

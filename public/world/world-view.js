import './world-core.js';
import {WorldRenderer} from './world-renderer.js';
const BaseWorld=globalThis.QAGridWorld;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rich=value=>window.quizMathRichText?window.quizMathRichText(value):esc(value);
const id=()=>globalThis.crypto?.randomUUID?.()||'world-'+Date.now()+'-'+Math.random().toString(36).slice(2);
const materialNames={'qi-spirit-wood':'靈木','qi-spirit-iron':'玄鐵','foundation-refined-iron':'精煉玄鐵','foundation-century-wood':'百年靈木','golden-purple-iron':'紫金玄鐵','golden-lightning-wood':'雷擊木','nascent-star-iron':'玄冥星鐵','nascent-soul-wood':'千載魂木'};
export class WorldView {
  constructor(root,{api,subscribe,uid,openEntry=()=>{},applyUser=()=>{},confirm=message=>Promise.resolve(globalThis.confirm(message))}){
    Object.assign(this,{root,api,subscribe,uid,openEntry,applyUser,confirm});this.world=BaseWorld.createWorld();this.players=[];this.events={};this.seq=0;this.busy=false;this.visible=false;this.generation=0;
    root.innerHTML=`<section class="ww-stage"><canvas class="ww-canvas" tabindex="0" role="application" aria-label="大世界地圖。點格移動，拖曳查看。也可用方向鍵選格，Enter 前往。"></canvas>
        <div class="ww-location"><strong data-zone>問道宗</strong><span><span data-coordinates>500，500</span> · 點格前往・拖曳查看</span><small data-connection role="status">正在連線</small></div>
        <div class="ww-explore-actions"><button type="button" class="btn-cyber-ghost" id="world-free-practice" data-entry="practice"><i class="fa-solid fa-scroll" aria-hidden="true"></i> 自由問道</button><div class="ww-top-right"><button type="button" class="btn-cyber-ghost" data-action="menu" aria-label="開啟功能選單"><i class="fa-solid fa-bars" aria-hidden="true"></i> 功能</button></div></div>
        <div class="ww-minimap"><canvas width="144" height="144" aria-label="已探索地圖，點擊可移動鏡頭"></canvas><span>全服共享 · 1000 × 1000</span></div>
        <div class="ww-camera"><button type="button" data-action="travel" aria-label="乘舟或上岸" hidden>乘舟</button><button type="button" data-action="center" aria-label="回到角色">◎ <span>回到角色</span></button><button type="button" data-action="zoom-in" aria-label="放大地圖">＋</button><button type="button" data-action="zoom-out" aria-label="縮小地圖">−</button><button type="button" data-action="stop" aria-label="停止移動">停</button></div>
        <div class="ww-battle-status" hidden></div><div class="ww-combat-log" aria-live="polite" hidden></div><div class="ww-objective" hidden></div>
        <div class="ww-message" role="status" aria-live="polite" hidden></div>
        <section class="ww-panel" aria-label="地圖互動" hidden></section>
      </section><footer class="ww-battle-actions" aria-label="本回合戰鬥操作" hidden></footer>`;
    // Use the app's existing header, navigation and logical game canvas.
    this.layoutObserver=new ResizeObserver(()=>this.fitViewport());
    for(const node of [document.documentElement,document.querySelector('body > header'),document.getElementById('bottom-nav')])if(node)this.layoutObserver.observe(node);
    this.renderer=new WorldRenderer(root.querySelector('.ww-canvas'),root.querySelector('.ww-minimap canvas'),p=>this.pick(p));
    this.onClick=e=>{
      const button=e.target.closest('button');if(!button||button.disabled)return;
      if(button.dataset.entry){if(this.battle()?.status==='active'){this.message('請先完成戰鬥，或使用撤離按鈕');return;}this.openEntry(button.dataset.entry);}
      else if(button.dataset.action)this.action(button.dataset.action,button.dataset);
    };
    this.onKeyDown=e=>{if(e.key==='Escape'){this.pending=null;this.navigation=null;this.closePanel();this.renderer.set({preview:null,selected:null});}};
    root.addEventListener('click',this.onClick);root.addEventListener('keydown',this.onKeyDown);
  }
  destroy(){this.destroyed=true;this.suspend();this.layoutObserver.disconnect();this.renderer.destroy();this.root.removeEventListener('click',this.onClick);this.root.removeEventListener('keydown',this.onKeyDown);}
  fitViewport(){
    if(this.destroyed||!this.root.getClientRects().length)return;
    const header=document.querySelector('body > header'),nav=document.getElementById('bottom-nav');
    const top=header?.getClientRects().length?Math.max(0,header.getBoundingClientRect().bottom):0;
    const bottom=nav?.getClientRects().length?Math.max(0,innerHeight-nav.getBoundingClientRect().top):0;
    this.root.style.setProperty('--ww-top',top+'px');this.root.style.setProperty('--ww-bottom',bottom+'px');
  }
  battle(){return this.state?.battle;}
  now(){return Date.now()+(this.clockOffset||0);}
  message(text){if(this.destroyed)return;const n=this.root.querySelector('.ww-message');n.textContent=text;n.hidden=!text;clearTimeout(this.messageTimer);if(text)this.messageTimer=setTimeout(()=>n.hidden=true,6000);}
  connected(value){this.online=value;const n=this.root.querySelector('[data-connection]');n.dataset.online=String(value);n.textContent=value?`附近 ${Math.max(1,this.players.length)} 位修士`:'連線中斷・正在重連';}
  set(data){
    if(this.destroyed)return;
    if(data.world){const descriptor=BaseWorld.validateDescriptor(data.world);if(data.mapVersion!==descriptor.worldId)throw new Error('地圖版本不一致，請重新整理');if(this.world.VERSION!==descriptor.worldId)this.world=BaseWorld.createWorld(descriptor);this.renderer.world=this.world;}
    if(data.patches){this.world.installPatches(data.patches);this.renderer.miniSignature='';}
    if(data.serverTime)this.clockOffset=data.serverTime-Date.now();
    const previousBattle=this.state?.battle,wasFighting=previousBattle?.status==='active';
    if(data.state)this.state=data.state;if(data.self)this.self=data.self;if(data.players)this.players=data.players;
    if(!wasFighting&&this.state?.battle?.status==='active')window.dispatchEvent(new CustomEvent('xiuxian:invite-blocked'));
    if(data.state?.battle&&previousBattle?.id===data.state.battle.id&&previousBattle.revision!==data.state.battle.revision){
      const b=data.state.battle;
      if(b.status==='won'&&wasFighting)globalThis.QAGameAudio?.play('reward-chime');
      else if(b.turn===previousBattle.turn&&b.answered>previousBattle.answered&&b.lastReview)globalThis.QAGameAudio?.play(b.lastReview.correct?'answer-correct':'answer-wrong');
      else if(b.enemies.some((e,i)=>e.hp<previousBattle.enemies[i]?.hp)||b.player.hp<previousBattle.player.hp)globalThis.QAGameAudio?.play('combat-impact');
    }
    if(data.events)this.events=data.events;if(data.sessionId)this.sessionId=data.sessionId;if(Number.isFinite(data.commandSeq))this.seq=Math.max(this.seq,data.commandSeq);
    if(this.self&&!this.players.some(p=>p.uid===this.uid))this.players.push(this.self);
    if(data.inventory||data.stats)this.applyUser(data);
    this.renderer.set({state:this.state,self:this.self,players:this.players,events:this.events,uid:this.uid,clockOffset:this.clockOffset});
    this.renderHud();
  }
  async start(){
    if(this.visible)return;this.visible=true;const generation=++this.generation;
    this.root.querySelector('.ww-panel').hidden=true;this.fitViewport();this.renderer.resize();this.renderer.start();
    try{
      const data=await this.api('join');if(!this.visible||generation!==this.generation)return;
      if(!data.world)throw new Error('世界種子尚未就緒，請重新整理遊戲');
      this.set(data);this.connected(true);this.renderer.center();
      this.unsubscribe=this.subscribe(packet=>{
        if(!this.visible||generation!==this.generation)return;
        this.connected(true);
        if(packet.type==='left'){this.unsubscribe?.();return;}
        if(packet.explored&&this.state){this.state.explored=this.world.mergeExplored(this.state.explored,packet.explored);this.state.position=packet.position;}
        this.set(packet);
        if(packet.type==='invite'){
          this.invite=packet.invite;this.message(packet.invite.fromName+' 邀請你'+(packet.invite.kind==='raid'?'組隊挑戰秘境':'切磋'));
          const bar=this.root.querySelector('.ww-top-right');bar.querySelector('[data-action="show-invite"]')?.remove();
          bar.insertAdjacentHTML('afterbegin',this.button('新邀請','show-invite'));
        }
        if(packet.type==='save-warning')this.message(packet.message);
        this.checkArrival();
      },()=>this.connected(false),async()=>{
        if(!this.visible||generation!==this.generation)return;
        const fresh=await this.api('join');if(this.visible&&generation===this.generation){this.pending=null;this.navigation=null;this.set(fresh);this.renderBattle();}
      });
      this.locationTick=setInterval(()=>{if(this.state){this.updateLocalExploration();this.checkArrival();this.renderLocation();void this.refreshPatches();}},200);
      this.renderBattle();
    }catch(error){if(generation!==this.generation)return;this.connected(false);this.panel('暫時無法進入青雲界',`<p>${esc(error.message)}</p>`,this.button('重新連線','reconnect'));}
  }
  async suspend(){
    if(!this.visible)return;this.visible=false;this.generation++;this.unsubscribe?.();this.unsubscribe=null;clearInterval(this.locationTick);clearTimeout(this.messageTimer);this.pending=null;this.navigation=null;this.renderer.stop();
    try{await this.api('leave',{}, {keepalive:true});}catch{/* The server checkpoints the final reached tile when the stream closes. */}
  }
  updateLocalExploration(){
    const W=this.world;
    if(this.battle()?.status==='active')return;const mine=this.players.find(p=>p.uid===this.uid)||this.self;if(!mine?.route)return;
    const sample=W.sample(mine.route,this.now());
    // Match the server: reveal the 15-cell radius only as each route tile is reached.
    const stamp=mine.route.startedAtMs+':'+mine.route.path.length;if(this.localRevealStamp!==stamp){this.localRevealStamp=stamp;this.localRevealIndex=-1;}
    for(let i=(this.localRevealIndex??-1)+1;i<=sample.index;i++)this.state.explored=W.reveal(this.state.explored,mine.route.path[i]);this.localRevealIndex=sample.index;
    this.state.position=sample.tile;
  }
  renderLocation(){
    const W=this.world;const mine=this.players.find(p=>p.uid===this.uid)||this.self,p=W.sample(mine?.route,this.now()).tile;
    this.root.querySelector('[data-zone]').textContent=W.zone(p);this.root.querySelector('[data-coordinates]').textContent=`${p.x}，${p.y}`;}
  renderHud(){
    if(this.destroyed||!this.state)return;this.renderLocation();if(this.online)this.connected(true);
    const quest=this.state.quest,b=this.battle(),objective=this.root.querySelector('.ww-objective');
    objective.hidden=b?.status==='active';
    if(!objective.hidden&&quest){const next=quest.steps.find(s=>!s.done);objective.innerHTML=`<button type="button" data-action="quest"><small>仙途任務 <span>${quest.steps.filter(s=>s.done).length} / 4</span></small><strong>${quest.claimed?'道途繼續，隨心探索':quest.ready?'回應宗門嘉獎':esc(next?.name||quest.name)}</strong><span>${quest.ready&&!quest.claimed?'領取獎勵 →':'查看目標與路線 →'}</span></button>`;}
    const status=this.root.querySelector('.ww-battle-status');status.hidden=b?.status!=='active';
    if(!status.hidden){status.innerHTML=`<div><small>局部戰場 · 第 ${b.turn} 回合</small><strong>${esc(b.name)}</strong></div><div class="ww-vitals"><span>生命 ${b.player.hp} / ${b.player.maxHp}</span><i><em style="width:${b.player.hp/b.player.maxHp*100}%"></em></i><span>靈力 ${b.player.mana} · 移動 ${b.moved?'已用':'2 格'} · 行動 ${b.acted?'已用':'可用'}</span></div>`;}
    const battleLog=this.root.querySelector('.ww-combat-log');battleLog.hidden=b?.status!=='active';
    if(!battleLog.hidden)battleLog.innerHTML=(b.log||[]).slice(-3).map(line=>`<p>${esc(line)}</p>`).join('');
    const fighting=b?.status==='active',actions=this.root.querySelector('.ww-battle-actions');
    this.root.classList.toggle('ww-in-battle',fighting);actions.hidden=!fighting;
    actions.innerHTML=fighting?(b.phase==='recharge'?`${this.button('繼續補能 '+b.answered+'/2','recharge')}${this.button('略過補能','skip')}${this.button('撤離','retreat')}`:`${this.button('普攻','select-attack')}${this.button('神通','select-skill')}${this.button('防守','guard')}${this.button('結束回合','end')}${this.button('撤離','retreat')}`):'';
    this.root.querySelector('[data-action="stop"]').hidden=b?.status==='active';
    const travel=this.root.querySelector('[data-action="travel"]'),p=this.state.position,W=this.world;travel.hidden=fighting||!W.DIRS.some(([dx,dy])=>['water','ocean'].includes(W.terrain(p.x+dx,p.y+dy,this.events)))&&this.state.travelMode!=='sail';travel.textContent=this.state.travelMode==='sail'?'上岸':'乘舟';
  }
  button(label,action,extra=''){const style=['interact','confirm-move','recharge','end','dismiss','claim','contribute'].includes(action)?'primary':'ghost';return `<button type="button" class="btn-cyber-${style}" data-action="${action}" ${extra}>${esc(label)}</button>`;}
  panel(title,content,actions=''){
    if(this.destroyed)return;
    const n=this.root.querySelector('.ww-panel');window.quizMathClear?.(n);n.classList.toggle('ww-quiz-panel',this.battle()?.phase==='recharge');n.hidden=false;n.innerHTML=`<div class="ww-panel-head"><h2>${esc(title)}</h2>${this.button('×','close','aria-label="關閉互動面板"')}</div><div class="ww-panel-content">${content}</div>${actions?`<div class="ww-panel-actions">${actions}</div>`:''}`;
    window.quizMathTypeset?.(n);
  }
  closePanel(){this.root.querySelector('.ww-panel').hidden=true;this.targeting=null;}
  async run(work){
    if(this.busy)return;this.busy=true;this.root.classList.add('ww-busy');
    try{await work();}
    catch(error){this.message(error.message||'連線未完成，請再試一次');
      try{const fresh=await this.api('join');this.set(fresh);this.renderBattle();}catch{this.connected(false);}
    }finally{this.busy=false;this.root.classList.remove('ww-busy');}
  }
  async move(target,objectId=null,after=null){
    if(!this.online){this.message('連線恢復後才能移動');return;}
    const seq=++this.seq;this.navigation=null;this.pending=after?{objectId,requestId:id(),seq}:null;this.closePanel();this.renderer.set({preview:null,selected:target});
    try{const data=await this.api('move',{target,objectId,seq,sessionId:this.sessionId});if(seq!==this.seq||!this.visible)return;
      this.set(data);this.players=this.players.filter(p=>p.uid!==this.uid).concat(data.self);this.renderer.set({players:this.players});
      if(data.partial){this.pending=null;this.navigation={target:{x:target.x,y:target.y},objectId,after};}this.checkArrival();
    }catch(error){if(seq===this.seq){this.pending=null;this.message(error.message);}}
  }
  checkArrival(){
    const W=this.world;
    if(!this.visible||this.busy||this.continuing)return;const mine=this.players.find(p=>p.uid===this.uid)||this.self;if(W.sample(mine?.route,this.now()).moving)return;
    if(this.navigation){const goal=this.navigation;this.navigation=null;this.continuing=true;void this.move(goal.target,goal.objectId,goal.after).finally(()=>{this.continuing=false;});return;}
    if(!this.pending)return;
    const pending=this.pending;this.pending=null;
    this.run(async()=>{
      const response=await this.api('interact',{objectId:pending.objectId,requestId:pending.requestId});this.set(response);
      if(response.message)this.message(response.message);if(response.entry)this.openEntry(response.entry);this.renderBattle();if(response.state?.expedition)this.renderExpedition();else if(response.rewards)this.panel('探索收穫',this.rewards(response.rewards),this.button('繼續探索','close'));
    });
  }
  pick(p){
    const W=this.world;
    if(!this.state||!W.inside(p.x,p.y)||this.busy)return;
    const b=this.battle();this.renderer.set({selected:p,cursor:p});
    if(b?.status==='active'){
      if(b.phase!=='command'){this.message('請先完成兩題補能，或選擇略過');return;}
      if(p.x<b.bounds.x||p.x>=b.bounds.x+8||p.y<b.bounds.y||p.y>=b.bounds.y+8){this.message('戰鬥中只能選擇金框內的地格');return;}
      if(this.targeting==='meteor'){this.preview={target:p};this.panel('落星地點',`<p>在（${p.x}，${p.y}）標記落星；敵人移動後，轟擊此格與上下左右相鄰格。</p>`,this.button('確認落星','confirm-skill'));return;}
      const enemy=b.enemies.find(e=>e.hp>0&&W.same(e,p));if(enemy){this.selectedEnemy=enemy.id;this.enemyPanel(enemy);return;}
      if(b.mechanism?.active&&W.same(b.mechanism,p)){this.panel('陣眼',`<p>所有金丹都可操作。站在陣眼旁，可消除護盾並使敵人攻擊降低 35%。</p>`,this.button('解除陣眼','mechanism',W.distance(b.player,p)>1||b.acted?'disabled':''));return;}
      if(b.moved){this.message('本回合已移動，仍可執行尚未使用的主要行動');return;}
      const blocked=new Set(b.enemies.filter(e=>e.hp>0).map(e=>W.key(e.x,e.y))),path=W.plan(b.player,p,{bounds:b.bounds,events:b.events,blocked,maxSteps:2}).path;
      if(path.length<2){this.message('此格無法到達，或超過本回合兩格移動範圍');return;}
      this.preview={path,target:p};this.renderer.set({preview:this.preview});const danger=b.enemies.filter(e=>e.hp>0&&e.intent.cells.some(c=>W.same(c,p)));
      this.panel('移動預覽',`<p>沿路移動 ${path.length-1} 格，抵達（${p.x}，${p.y}）。</p><p class="${danger.length?'ww-danger':'ww-safe'}">${danger.length?'危險：此格位於 '+danger.map(e=>esc(e.intent.name)).join('、')+' 的預告範圍':'此格不在目前的攻擊預告範圍內'}</p>`,this.button('確認移動','confirm-move'));return;
    }
    const peers=this.players.filter(a=>a.uid!==this.uid&&W.same(W.sample(a.route,this.now()).tile,p));
    if(peers.length){this.playerPanel(peers);return;}
    const object=W.objectAt(p.x,p.y);
    if(object&&W.known(this.state.explored,p.x,p.y)){this.selectedObject=object;this.objectPanel(object);return;}
    if(W.known(this.state.explored,p.x,p.y)&&!W.walkable(p.x,p.y,{events:this.events,mode:this.state.travelMode})){this.message('此處無法通行，請選擇道路或空地');return;}
    this.move(p);
  }
  objectPanel(o){
    const W=this.world;
    const info={gather:'每日個人採集資格；其他玩家採集不會影響你。可獲得材料 ×2。',chest:'個人首次寶箱；開啟後獲得玄鐵、靈木與靈石。',monster:'在此處展開 8 × 8 局部戰場。每回合兩題補能；答錯仍可移動、普攻與防守。每日第一次勝利可取得獎勵，其後仍可練習戰術。',building:'走到建築旁開啟，也可使用原本的修煉導覽或地圖功能選單。',npc:'追蹤仙途任務，從青竹林帶回第一批修行材料。',event:o.id==='bridge'?'全服共同投入靈木，修復後開通青溪捷徑。每日每人可投入一次。':'全服共同投入玄鐵，穩定山口古陣。每日每人可投入一次。'}[o.kind];
    let extra=o.level?`<p>建議等級 ${o.level} · ${esc(o.realm)}域${o.veinId?' · 連續礦脈':''}</p>`:'';if(['realm','structure'].includes(o.kind))extra+='<p>'+esc(o.kind==='realm'?(o.subtype==='guardian'?'古老守衛看守秘藏，可展開局部戰棋挑戰。':'旋轉陣紋機關，開啟秘境寶藏；探索不需答題。'):o.subtype==='watchtower'?'登上望樓可揭開附近迷霧。':o.subtype==='camp'?'可在此休整與問道練習。':'調查遺跡並破解陣紋，取得探索獎勵。')+'</p>';if(o.kind==='event'){const goal=o.id==='bridge'?20:60,value=this.events[o.id]||0;extra=`<div class="ww-event-bar"><span style="width:${Math.min(100,value/goal*100)}%"></span></div><p>全服進度 ${value} / ${goal} · 需要${o.id==='bridge'?'靈木':'玄鐵'} ×2</p>${o.id==='array'?'<p>完成後解除北方封印，所有修士皆可進入古陣秘藏。</p>':''}`;}
    this.panel(o.name,`<p>${info||'前往調查這處古老遺跡。'}</p>${extra}<small>地點（${o.x}，${o.y}）· ${esc(W.zone(o))}</small>`,this.button(o.kind==='monster'?'前往挑戰':o.kind==='gather'?'前往採集':o.kind==='chest'?'前往開箱':o.kind==='event'?'前往貢獻':'前往互動','interact'));
  }
  playerPanel(peers){
    this.panel(peers.length>1?`此格有 ${peers.length} 位道友`:peers[0].name,peers.map(p=>`<article class="ww-peer"><strong>${esc(p.name)}</strong><small>${p.status==='battle'?'交戰中・'+esc(p.battleName):'正在探索青雲界'}</small><div><button type="button" data-action="profile" data-uid="${esc(p.uid)}">角色資料</button><button type="button" data-action="chat" data-uid="${esc(p.uid)}" data-name="${esc(p.name)}">交流</button><button type="button" data-action="invite-raid" data-uid="${esc(p.uid)}">邀請組隊</button><button type="button" data-action="invite-duel" data-uid="${esc(p.uid)}">切磋</button></div></article>`).join(''));
  }
  enemyPanel(e){
    const W=this.world;
    const b=this.battle();this.panel(e.name,`<p>生命 ${e.hp} / ${e.maxHp}${e.shield?' · 護盾 '+e.shield:''}</p><p>下一式：${esc(e.intent.name)} · 傷害 ${e.intent.damage}${e.stunned?' · 已受干擾':''}</p><p>與你相距 ${W.distance(b.player,e)} 格。虛線表示敵人本回合預計移動方向。</p><small>${esc(b.skill.name)}：${esc(b.skill.detail)}</small>`,this.button('普攻','attack',b.acted||W.distance(b.player,e)>1?'disabled':'')+this.button(b.skill.name+' · '+b.skill.cost+' 靈力','select-skill',b.acted||b.player.mana<b.skill.cost?'disabled':''));
  }
  renderBattle(){
    if(this.destroyed)return;
    const b=this.battle();if(!b)return;
    if(b.status!=='active'){
      const rewards=b.rewards;this.panel(b.status==='won'?'戰鬥勝利':b.status==='lost'?'暫別戰場':'返回大世界',`<p>${b.status==='won'?'帶著新的材料，繼續你的修行。':'探索與已獲得的材料均已保留，可以整理養成後再來。'}</p>${rewards?this.rewards(rewards):''}`,this.button('繼續探索','dismiss')+`<button type="button" data-entry="refinery">前往煉器</button>`);return;
    }
    if(b.phase==='recharge'){
      if(b.questions?.length===2){const q=b.questions[b.answered];
        if(q)this.panel(`補能 · 第 ${b.answered+1} / 2 題`,`${b.lastReview&&b.answered?`<div class="ww-review ${b.lastReview.correct?'ww-safe':'ww-danger'}">${b.lastReview.correct?'答對・靈力 +1':'未答對・仍可正常行動'}<p>${rich(b.lastReview.explanation)}</p></div>`:''}<small>${esc(q.subject)} · ${esc(q.topic)}</small><p class="ww-question">${rich(q.q)}</p><div class="ww-answers">${q.options.map((o,i)=>`<button type="button" data-action="answer" data-choice="${i}">${String.fromCharCode(65+i)}　${rich(o)}</button>`).join('')}</div>`,this.button('略過剩餘補能','skip'));}
      else{this.panel('本回合補能','<p>凝聚兩題靈感，答對每題獲得 1 點額外靈力。</p><p>題目準備中…</p>',this.button('略過，直接行動','skip'));this.loadQuestions();}
    }else{
      this.closePanel();this.renderer.set({preview:null});
      const review=b.lastReview;
      if(!b.acted&&!b.moved)this.message((review&&b.answered===2?(review.correct?'答對，靈力 +1。':'補能完成。'):'本回合可開始行動。')+'點格預覽移動，或點敵人選擇行動。');
    }
  }
  async loadQuestions(){
    const b=this.battle(),key=b?.id+':'+b?.turn;if(this.questionJob===key)return;this.questionJob=key;
    try{const data=await this.api('battle',{command:'questions',battleId:b.id,turn:b.turn,revision:b.revision,requestId:id()});
      if(this.visible&&this.battle()?.id===b.id&&this.battle()?.turn===b.turn){this.set(data);this.renderBattle();}
    }catch(error){if(this.visible&&this.battle()?.phase==='recharge'){this.message(error.message);this.panel('補能尚未就緒','<p>可稍後重試，或略過補能，移動、普攻與防守仍可使用。</p>',this.button('重新準備題目','questions')+this.button('略過，直接行動','skip'));}}
    finally{if(this.questionJob===key)this.questionJob=null;}
  }
  rewards(r={}){return `<div class="ww-rewards">${Object.entries(r.materials||{}).map(([key,n])=>`<span>${esc(materialNames[key]||key)} <b>+${n}</b></span>`).join('')}${r.gold?`<span>靈石 <b>+${r.gold}</b></span>`:''}${r.cultivation?`<span>修為 <b>+${r.cultivation}</b></span>`:''}</div>`;}
  questPanel(){
    const q=this.state.quest;if(!q)return;this.panel(q.name,`<p>帶回第一批靈材，讓宗門見證你的成長。</p><div class="ww-quest-list">${q.steps.map((s,i)=>`<button type="button" data-action="navigate" data-step="${i}"><b>${s.done?'✓':i+1}</b><span>${esc(s.name)}</span><small>${s.done?'已完成':'尋路 →'}</small></button>`).join('')}</div><p class="ww-muted">${esc(q.reward)}</p>`,q.claimed?'<p>嘉獎已領取。可前往鍛造坊使用材料。</p>':q.ready?this.button('領取宗門嘉獎','claim-quest'):'');
  }
  async refreshPatches(){
    if(!this.visible||!this.state||this.patchLoading||Date.now()<(this.patchRetryAtMs||0))return;const W=this.world,p=this.state.position,cx=Math.floor(p.x/32),cy=Math.floor(p.y/32),keys=[];
    for(let y=Math.max(0,cy-1);y<=Math.min(W.CHUNK_COUNT-1,cy+1);y++)for(let x=Math.max(0,cx-1);x<=Math.min(W.CHUNK_COUNT-1,cx+1);x++)keys.push(W.key(x,y));
    const versions=W.patchVersions(),stamp=keys.map(k=>k+':'+(this.events.chunkRevisions?.[k]||0)).join('|');if(stamp===this.patchStamp)return;
    const changed=keys.filter(k=>(versions[k]||0)!==(this.events.chunkRevisions?.[k]||0));if(!changed.length){this.patchStamp=stamp;return;}
    this.patchLoading=true;try{const data=await this.api('patches',{keys:changed,versions});if(this.visible&&data.worldId===W.VERSION){this.set(data);this.patchStamp=stamp;this.patchFailures=0;this.patchRetryAtMs=0;}}catch{this.patchFailures=(this.patchFailures||0)+1;this.patchRetryAtMs=Date.now()+Math.min(60000,5000*2**Math.min(4,this.patchFailures-1));}finally{this.patchLoading=false;}
  }
  renderExpedition(){
    const e=this.state?.expedition;if(!e)return;const arrows=['↑','→','↓','←'];this.panel(e.name,`<p>旋轉三座符盤，讓陣紋全部朝向上方。每次點擊轉動四分之一圈。</p><div class="ww-runes">${e.rotations.map((r,i)=>`<button type="button" class="btn-cyber-ghost" data-action="rotate-rune" data-index="${i}" aria-label="旋轉第 ${i+1} 座符盤">${arrows[r]}</button>`).join('')}</div><small>陣紋解開後取得秘藏；途中可關閉面板，進度會保存。</small>`);
  }
  async command(command,extra={}){
    const b=this.battle();if(!b||b.status!=='active')return;
    await this.run(async()=>{const result=await this.api('battle',{command,battleId:b.id,turn:b.turn,revision:b.revision,requestId:id(),...extra});this.set(result);this.renderer.set({preview:null});this.renderBattle();});
  }
  async action(action,data={}){
    const W=this.world;
    switch(action){
      case 'close':this.closePanel();this.renderer.set({preview:null,selected:null});break;
      case 'dismiss':await this.run(async()=>{const b=this.battle();const r=await this.api('battle',{command:'dismiss',battleId:b.id,requestId:id()});this.set(r);this.closePanel();});break;
      case 'reconnect':await this.suspend();await this.start();break;
      case 'travel':await this.run(async()=>{const data=await this.api('travel',{mode:this.state.travelMode==='sail'?'walk':'sail',requestId:id()});this.set(data);this.message(data.message);});break;
      case 'rotate-rune':await this.run(async()=>{const response=await this.api('explore',{command:'rotate',index:Number(data.index),requestId:id()});this.set(response);if(this.state.expedition)this.renderExpedition();else this.panel('秘藏開啟',this.rewards(response.rewards),this.button('繼續探索','close'));});break;
      case 'center':this.renderer.center();break;
      case 'zoom-in':this.renderer.zoom(1.15);break;
      case 'zoom-out':this.renderer.zoom(1/1.15);break;
      case 'stop':this.pending=null;this.navigation=null;try{const response=await this.api('stop',{sessionId:this.sessionId,seq:++this.seq});this.players=this.players.filter(p=>p.uid!==this.uid).concat(response.self);this.set(response);}catch(e){this.message(e.message);}break;
      case 'quest':this.questPanel();break;
      case 'navigate':{const step=this.state.quest.steps[Number(data.step)],object=step.objectId?W.object(step.objectId):null;this.move(step.target||object,object?.id);break;}
      case 'claim-quest':await this.run(async()=>{const r=await this.api('quest',{requestId:id()});this.set(r);this.panel('宗門嘉獎',this.rewards(r.rewards)+`<p>修為與材料已入帳；帶著材料前往鍛造坊吧。</p>`,`<button type="button" data-entry="refinery">開啟鍛造坊</button>`+this.button('繼續探索','close'));});break;
      case 'interact':{const o=this.selectedObject;this.move(o,o.id,true);break;}
      case 'menu':this.panel('仙途行囊',`<div class="ww-menu">${[['training','修煉與突破'],['core','金丹・元嬰・化神'],['refinery','煉器'],['contract','契器'],['bag','寶庫'],['practice','自由問道'],['duel','鬥法'],['raid','團本秘境'],['rank','仙榜'],['friends','好友交流'],['settings','設定'],['sect','宗門事務']].map(([key,name])=>`<button type="button" data-entry="${key}">${name}<span>→</span></button>`).join('')}</div><p class="ww-muted">金色路線為前往方向。紅格為敵人攻擊預告；藍綠格可移動。一般探索不消耗靈力。</p>`);break;
      case 'questions':this.questionJob=null;this.loadQuestions();break;
      case 'recharge':this.renderBattle();break;
      case 'answer':await this.command('answer',{choice:Number(data.choice),index:this.battle().answered});break;
      case 'skip':await this.command('skip');break;
      case 'confirm-move':await this.command('move',{target:this.preview.target});break;
      case 'select-attack':this.message('請點選相鄰敵人，再確認普攻');this.closePanel();break;
      case 'attack':await this.command('attack',{enemyId:this.selectedEnemy});break;
      case 'select-skill':{
        const b=this.battle();if(!b||b.acted){this.message('本回合已使用主要行動');return;}if(b.player.mana<b.skill.cost){this.message('靈力不足，仍可普攻或防守');return;}
        const type=b.player.goldenCore?.type;
        if(type==='xingchen'){this.closePanel();this.targeting='meteor';this.message('點選四格內的落星地點，再確認施展');}
        else if(['thunder','reverse','taichu'].includes(type)){this.panel(b.skill.name,`<p>${esc(b.skill.detail)}</p><p>消耗 ${b.skill.cost} 靈力。</p>`,this.button('確認施展','confirm-skill'));}
        else if(this.selectedEnemy)this.panel(b.skill.name,`<p>${esc(b.skill.detail)}</p><p>消耗 ${b.skill.cost} 靈力。</p>`,this.button('確認施展','confirm-skill'));
        else{this.closePanel();this.message('請先點選神通範圍內的敵人');}break;
      }
      case 'confirm-skill':await this.command('skill',{enemyId:this.selectedEnemy,target:this.preview?.target});this.targeting=null;break;
      case 'guard':await this.command('guard');break;
      case 'mechanism':await this.command('mechanism');break;
      case 'end':{const b=this.battle();if(b?.phase!=='command'){this.message('請先完成或略過本回合補能');return;}
        const reminderKey=b.id+':'+b.turn;
        if((!b.acted||!b.moved)&&this.endReminderTurn!==reminderKey){this.endReminderTurn=reminderKey;if(!await this.confirm('本回合仍有'+(!b.moved?'移動':'')+(!b.moved&&!b.acted?'與':'')+(!b.acted?'主要行動':'')+'未使用，確定結束回合？'))return;}
        await this.command('end');break;
      }
      case 'retreat':if(await this.confirm('撤離後保留探索與已有材料，本場不獲得勝利獎勵。確定撤離？'))await this.command('retreat');break;
      case 'profile':this.openEntry('profile',data);break;
      case 'chat':this.openEntry('chat',data);break;
      case 'invite-raid':this.openEntry('invite-raid',data);break;
      case 'invite-duel':this.openEntry('invite-duel',data);break;
      case 'show-invite':if(this.battle()?.status==='active'){this.message('請先完成或撤離目前的局部戰鬥');break;}if(this.invite&&this.invite.expiresAtMs>this.now())this.panel('道友邀請',`<p>${esc(this.invite.fromName)} 邀請你${this.invite.kind==='raid'?'組隊挑戰秘境':'切磋'}。</p>`,this.button('接受邀請','accept-invite')+this.button('婉拒','decline-invite'));else this.message('這則邀請已過期');break;
      case 'accept-invite':this.openEntry('accept-invite',this.invite);this.invite=null;this.root.querySelector('[data-action="show-invite"]')?.remove();break;
      case 'decline-invite':this.invite=null;this.root.querySelector('[data-action="show-invite"]')?.remove();this.closePanel();break;
    }
  }
}

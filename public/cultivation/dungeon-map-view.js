import * as Camera from './dungeon-map-camera.js';
import { BIOMES, drawWorld } from './dungeon-map-painter.js';
import { getDungeonMap, moveDungeonMember, strikeDungeonBeast, castDungeonSkill, switchDungeonLoadout, moveDungeonMemberRoute, getDungeonRoom, activateDungeonPortal, enterDungeonBoss, setDungeonBossReady, rescueDungeonTeammate, guardDungeonTeammate, claimDungeonBossReward, claimDungeonManualExp } from './dungeon-room.js';
import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';
import { DungeonQuizPanel } from './dungeon-quiz-panel.js';
import { energyRingFill, dungeonFocusCharges, dungeonFocusEmpowers } from './dungeon-quarter-controls.js';
import { dungeonTrialWheelHTML, bindDungeonTrialWheel, renderDungeonTrialWheel } from './dungeon-trial-wheel.js?v=20261122-rightwheel-rails-v5';
import './flying-sword-path.js?v=20261120-sword-movement-v1';
import { dungeonRoute, dungeonReachableTiles, dungeonAttackTiles, dungeonSwordRoute, dungeonSwordTiles } from './dungeon-map-actions.js';
import { skillArt, bookArt } from './manual-art.js';
import './contextual-asset-preloader.js';
import { manualXpDelta, renderManualXpToast, renderManualXpProgress } from './tactical-manual-xp-feedback.js';
import {manualAnticipation,renderBattleBreakthroughEstimate} from './manual-anticipation.js';
// The trial's original shared manual catalog, animation timing and VFX.
import './manual-rules.js';
import './weapon-effects.js';
import './weapon-geometry.js';
import './prism-weapon-rules.js';
import './dungeon-boss-hit.js';
import './dungeon-skill-resolution.js';
import './tactical-animation.js';
import './tactical-skill-effects.js';
import './tactical-ambience.js';
// Ongoing cooperative rooms created before weapon slots existed must display
// the same right wheel as freshly created rooms. Infer from authorized moves
// if their serialized member lacks dungeonWeaponIds.
function dungeonWeaponSlots(member){
  if(Array.isArray(member?.dungeonWeaponIds)&&member.dungeonWeaponIds.length===2)
    return member.dungeonWeaponIds.map(id=>id||null);
  const names=[...new Set((member?.dungeonSkills||[]).map(skill=>
    skill.weaponId||globalThis.QAManuals?.BY_SKILL?.[skill.id]?.manualId).filter(Boolean))];
  return [names[0]||null,names[1]||null];
}
import './tactical-impact-presentation.js';
import {dungeonEnvironmentPlan} from './dungeon-environment-effects.js';
import {dungeonBossTransition} from './dungeon-boss-visuals.js';
import './tactical-threat-visuals.js';
import {dungeonThreatPlan,dungeonIncomingDamage} from './dungeon-threat-plan.js';
import {dungeonAnimationEvents,paintDungeonScene,drawDungeonHitNumbers} from './dungeon-skill-animation.js';
import {dungeonMovementEvents,sampleDungeonMovement,continueDungeonMovement,previewDungeonMovement} from './dungeon-movement-animation.js';
import {dungeonEnemyReactionEvents} from './dungeon-enemy-animation.js';

// The dungeon shares the trial's fullscreen quarter-dial presentation;
// its exploration, combat and questions remain live, server-authoritative actions.
const safeRoom=id=>/^[A-Za-z0-9_-]{8,160}$/.test(String(id||''));
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);
const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
const mapValid=map=>map?.mode==='dungeon'&&[1,2].includes(map.layoutVersion)&&
  Number.isInteger(map.width)&&map.width>5&&map.width<=128&&
  Number.isInteger(map.height)&&map.height>5&&map.height<=128&&
  Array.isArray(map.tiles)&&map.tiles.length===map.width*map.height&&
  map.tiles.every(t=>t===0||t===1||t===2)&&Array.isArray(map.spawnPads)&&
  map.spawnPads.length===4&&['spawn','portalSite','guardianSite'].every(id=>
    Number.isInteger(map[id]?.x)&&Number.isInteger(map[id]?.y)&&
    map[id].x>=0&&map[id].x<map.width&&map[id].y>=0&&map[id].y<map.height&&
    map.tiles[map[id].y*map.width+map[id].x]>0);
let viewer;
class DungeonMapView{
  constructor(){
    this.root=null;this.stage=null;this.canvas=null;this.ctx=null;
    this.quiz=null;
    this.map=null;this.room=null;this.roomId='';this.uid='';
    this.camera=Camera.initialCamera();this.follow=false;
    this.opened=false;this.seq=0;this.pointers=new Map();this.movePending=false;
    this.strikePending=false;this.skillPending=false;this.loadoutPending=false;
    this.portalPending=false;this.bossPending=false;
    this.rescuePending=false;this.guardPending=false;this.guardSignature='';
    this.rewardPending=false;this.rewardResult=null;
    this.manualXpTimer=null;this.manualXpGeneration=0;
    this.aimTile=null;this.skillSignature='';
    this.focusAuras=new Map();this.sprites={};
    this.visualScenes=new Map(); // authenticated room events only; never controls damage
    this.travelScenes=new Map(); // sampled trial movement; server positions remain untouched
    this.enemyReactionScenes=new Map(); // committed enemy attacks / personal damage
    this.pendingMovementPreview=null; // visual only; never enters C-room rules
    this.ambiencePlan=null;this.environmentPlan=null;
    this.ambientTimer=null;this.bossTransition=null;
    this.pendingAction=null;this.queuedSkill=null;
    this.wheelMode='attack';this.moveTarget='player';this.selectedSkillId='';this.weaponWheelSlot=-1;this.manualOpen=false;
    this.wheelSwipeStart=null;this.wheelSwipeSuppressUntil=0;
    this.routePending=false;this.actionFeedbackTimer=null;
    this.rangeSignature='';this.rangeTiles=[];this.rangeKind='move';
    this.width=0;this.height=0;this.frame=0;this.resizeFrame=0;
    this.observer=null;this.previousFocus=null;
    this.clockTimer=null;this.clockAnchor=null;this.clockTickFloor=0;
    this.inspectOpen=false;this.selectedBeastId=null;this.followBeast=false;
    this.beastIds='';this.touchOrigins=new Map();this.gestureMulti=false;
    this.longPressTimer=null;this.longPressTriggered=false;
    this.onResize=()=>this.scheduleResize();
    this.onVisibility=()=>{if(!document.hidden&&this.opened)this.scheduleResize();};
  }
  mount(){
    if(this.root)return;
    if(!document.getElementById('dungeon-map-view-style')){
      const style=document.createElement('link');
      style.id='dungeon-map-view-style';style.rel='stylesheet';
      style.href='/styles/dungeon-map-view.css?v=20261120-scope-exclusion-v1';
      document.head.append(style);
    }
    if(!document.getElementById('tactical-manual-xp-feedback-style')){
      const link=document.createElement('link');
      link.id='tactical-manual-xp-feedback-style';
      link.rel='stylesheet';
      link.href='/styles/tactical-manual-xp-feedback.css?v=20261120-dungeon-mastery-v1';
      document.head.append(link);
    }
    if(!document.getElementById('tactical-manual-anticipation-style')){
      const link=document.createElement('link');
      link.id='tactical-manual-anticipation-style';
      link.rel='stylesheet';
      link.href='/styles/manual-anticipation.css?v=20261120-dungeon-mastery-v1';
      document.head.append(link);
    }
    if(!document.getElementById('dungeon-trial-boss-style')){
      const link=document.createElement('link');
      link.id='dungeon-trial-boss-style';link.rel='stylesheet';
      link.href='/styles/dungeon-trial-boss.css?v=20261119-hud-parity-v1';
      document.head.append(link);
    }
    if(!document.getElementById('dungeon-trial-wheel-style')){
      const link=document.createElement('link');
      link.id='dungeon-trial-wheel-style';link.rel='stylesheet';
      link.href='/styles/dungeon-trial-wheel.css?v=20261122-rightwheel-rails-v5';
      document.head.append(link);
    }
    const root=document.createElement('section');
    root.id='dungeon-map-view';root.hidden=true;
    root.classList.add('dm-quarter-layout','tc-quarter-layout');
    root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
    root.setAttribute('aria-label','合作副本即時戰場');
    root.innerHTML=`<div class="dm-shell">
  <header class="dm-head">
    <h2 data-dm-title>合作副本</h2>
    <div class="dm-head-actions">
      <span class="dm-battle-clock" data-dm-clock role="timer" aria-live="off">等待集結</span>
      <button type="button" data-dm="beasts" aria-expanded="false">靈獸</button>
      <button type="button" data-dm="close" aria-label="收起副本戰場">收起</button>
    </div>
  </header>
  <div class="dm-stage" data-dm-stage>
    <canvas class="dm-world" data-dm-world tabindex="0" aria-label="合作副本。玩家固定中央，禁止拖曳與縮放。點選灰格移動、紅格攻擊，長按查看靈獸。"></canvas>
    <div class="dm-effect-layer" data-dm-effects aria-hidden="true"></div>
    <div class="dm-action-feedback" data-dm-action-feedback role="status" aria-live="polite" hidden></div>
    <div class="dm-message" data-dm-message role="status" aria-live="polite">正在取得副本地圖…</div>
    <p class="dm-objective-status" data-dm-objective role="status" aria-live="polite">尋找守鑰靈獸</p>
    <section class="tc-boss-hud" data-dm-boss-health data-phase="1" data-boss-kind="rock" aria-label="首領生命與戰況" hidden>
      <div class="tc-boss-line">
        <strong class="tc-boss-name" data-dm-boss-label>玄炎鎮殿獸</strong>
        <span class="tc-boss-phase" data-dm-phase>第一階段</span>
      </div>
      <div class="tc-boss-health" data-dm-boss-progress role="progressbar" aria-label="首領生命" aria-valuemin="0" aria-valuemax="2800" aria-valuenow="2800">
        <div class="tc-boss-fill" data-dm-boss-meter></div><div class="tc-boss-half" aria-hidden="true"></div>
      </div>
      <div class="tc-boss-subline">
        <span class="tc-boss-intent" data-dm-teamwork-hint></span>
        <span class="tc-boss-number" data-dm-boss-value>2800 / 2800</span>
      </div>
      <div class="dm-boss-shield" data-dm-boss-shield hidden>
        <span>玄甲護盾 <em data-dm-shield-value>180 / 180</em></span>
        <div class="dm-shield-meter"><i data-dm-shield-meter></i></div>
      </div>
    </section>
    <div class="dm-victory-panel" data-dm-victory hidden>
      <strong>✦ 玄炎鎮殿 · 全隊勝利</strong>
      <p>首領已擊敗！每位參戰隊員可領取 120 靈石與 3 修為。</p>
      <button type="button" data-dm="claim-victory" data-dm-claim>領取本場獎勵</button>
      <small data-dm-reward-status role="status" aria-live="polite">每場每人限領一次；現在或離隊後，都能從副本入口領取。</small>
    </div>
    <div class="dm-tactical-actions" data-dm-movement hidden>
      <div class="dm-threat" data-dm-threat role="status" aria-live="polite" hidden></div>
      <div class="dm-rescue-actions" data-dm-rescues hidden aria-live="polite"></div>
      <div class="dm-guard-actions" data-dm-guards hidden aria-label="首領戰掩護"></div>
      <button type="button" class="dm-portal-button" data-dm="portal" hidden disabled>啟動傳送門</button>
      <small class="dm-portal-votes" data-dm-portal-votes hidden role="status" aria-live="polite"></small>
      <button type="button" class="dm-boss-entry" data-dm="enter-boss" hidden disabled>我已準備進入首領戰</button>
    </div>
    <aside class="dm-inspector" data-dm-inspector hidden aria-label="靈獸資料">
      <div class="dm-inspector-head"><strong>靈獸動向</strong><button type="button" data-dm="close-beasts" aria-label="關閉靈獸資料">×</button></div>
      <p data-dm-beast-details role="status">點選靈獸查看行動狀態</p>
      <div class="dm-beast-list" data-dm-beast-list></div>
      <small>紅色方格表示即將遭到攻擊；預告後移出範圍即可閃避。</small>
    </aside>
    <aside class="dm-tactical-loadout" data-dm-manual hidden aria-label="副本技能配置">
      <div class="dm-presets" data-dm-presets></div>
      <div class="dm-skills" data-dm-skills hidden></div>
      <span data-dm-focus hidden></span>
      <small data-dm-aim hidden></small>
      <small data-dm-skill-alert hidden></small>
    </aside>
    <div class="dm-hud-live-status" role="status" aria-live="polite">
      <span data-dm-health>生命 100/100</span>
      <span data-dm-team-status></span>
    </div>
    <div class="dm-hidden-contract" hidden aria-hidden="true">
      <strong data-dm-energy>10</strong>
      <button type="button" class="dm-quiz-charge" data-dm="quiz" disabled>答題充能</button>
      <button type="button" data-dm="strike" disabled>普通攻擊</button>
      <small data-dm-strike-alert role="status" aria-live="polite"></small>
      <small data-dm-move-alert role="status" aria-live="polite"></small>
    </div>
  </div>
</div>`;
    // Same pointer-transparent live EXP overlay as 問道試煉. Keep it outside
    // .dm-stage, whose overflow would clip the animation on small screens.
    const xpHost=document.createElement('div');
    xpHost.className='tc-manual-xp-host';
    xpHost.dataset.manualXpHost='';
    xpHost.setAttribute('role','status');
    xpHost.setAttribute('aria-live','polite');
    xpHost.setAttribute('aria-atomic','true');
    root.append(xpHost);
    const stage=root.querySelector('[data-dm-stage]');
    stage.insertAdjacentHTML('beforeend',dungeonTrialWheelHTML());
    const loadoutToggle=root.querySelector('[data-dm="loadouts"]');
    loadoutToggle.classList.add('tc-loadout-toggle');
    root.querySelector('.dm-head-actions').prepend(loadoutToggle);
    // Preserve the existing one-per-action DOM controls: do not create a
    // second quiz/attack/move button with a duplicate event handler.
    const charge=root.querySelector('[data-dm="quiz"]');
    const stamina=root.querySelector('[data-dm-energy]');
    root.querySelector('[data-dm-quarter-energy]').append(charge);
    charge.setAttribute('data-quiz','');
    charge.replaceChildren();
    charge.innerHTML='<svg class="tc-energy-bolt" viewBox="0 0 72 100" aria-hidden="true" focusable="false">'+
      '<defs><linearGradient id="dm-trial-bolt-gradient" x1="0" y1="0" x2="0.95" y2="1">'+
      '<stop offset="0%" stop-color="#fcffe5"/><stop offset="48%" stop-color="#d9ffd4"/>'+
      '<stop offset="100%" stop-color="#8cffb4"/></linearGradient></defs>'+
      '<path class="tc-bolt-outline" d="M 43 6 L 16 50 Q 14 54 20 54 H 37 L 26 94 L 63 37 H 43 L 50 6 Z"></path>'+
      '<path class="tc-bolt-fill" d="M 43 6 L 16 50 Q 14 54 20 54 H 37 L 26 94 L 63 37 H 43 L 50 6 Z"></path>'+
      '<path class="tc-bolt-glint" d="M 42 17 L 27 46 H 40"></path></svg>';
    charge.querySelector('.tc-bolt-fill')?.setAttribute('fill','url(#dm-trial-bolt-gradient)');
    stamina.className='tc-energy-number';stamina.setAttribute('aria-hidden','true');
    const label=document.createElement('span');
    label.className='tc-charge-label';label.textContent='答題充能';
    label.setAttribute('aria-hidden','true');
    charge.append(stamina,label);
    charge.setAttribute('aria-label','答題充能，可無限次個別作答');
    root.querySelector('[data-dm-strike-slot]').append(
      root.querySelector('[data-dm="strike"]'));
    document.body.append(root);
    this.root=root;this.stage=stage;
    this.canvas=root.querySelector('[data-dm-world]');
    this.ctx=this.canvas.getContext('2d',{alpha:false});
    // Same image atlases as 問道試煉. Images affect presentation only;
    // failed downloads leave deterministic vector terrain/markers visible.
    const assets={
      ground:'/assets/world-map/ai/ground-atlas.webp',
      monsters:'/assets/world-map/ai/creatures-atlas.webp'
    };
    for(const [key,src] of Object.entries(assets)){
      const img=new Image();img.decoding='async';
      img.onload=()=>this.drawSoon();
      img.onerror=()=>this.drawSoon();
      img.src=src;this.sprites[key]=img;
    }
    this.quiz=new DungeonQuizPanel(root,{onRoom:room=>{
      if(!this.isCurrent()||room.id!==this.roomId)return;
      this.updateRoom(room);
      window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
        detail:{room}
      }));
    }});
    root.addEventListener('click',event=>{
      const button=event.target.closest('[data-dm]');
      if(button?.closest('[data-dm-wheel]')&&
          Date.now()<this.wheelSwipeSuppressUntil)return;
      if(button&&root.contains(button)&&!button.disabled)
        this.action(button.dataset.dm,button.dataset.beastId,
          button.dataset.skillId,button.dataset.loadoutIndex,
          button.dataset.targetUid);
    });
    root.addEventListener('keydown',event=>this.keyDown(event));
    this.canvas.addEventListener('pointerdown',event=>this.pointerDown(event));
    this.canvas.addEventListener('pointermove',event=>this.pointerMove(event));
    for(const type of ['pointerup','pointercancel','lostpointercapture'])
      this.canvas.addEventListener(type,event=>this.pointerUp(event));
    this.canvas.addEventListener('wheel',event=>this.wheel(event),{passive:false});
    this.canvas.addEventListener('contextmenu',event=>event.preventDefault());
    const wheel=root.querySelector('[data-dm-wheel]');
    bindDungeonTrialWheel(wheel,{
      select:choice=>this.selectTrialWheel(choice),
      refresh:()=>this.updateWheelHUD(),
      ignoreClick:()=>{this.wheelSwipeSuppressUntil=Date.now()+350;},
      allowClick:()=>{this.wheelSwipeSuppressUntil=0;}
    });
  }
  $(selector){return this.root?.querySelector(selector);}
  isCurrent(){return this.opened&&this.uid===getMainUser()?.uid&&
    this.room?.id===this.roomId&&Boolean(this.room?.members?.[this.uid]);}
  alert(message='',retry=false){
    const node=this.$('[data-dm-message]');if(!node)return;
    node.hidden=!message;node.textContent=message;
    if(retry){
      const button=document.createElement('button');
      button.type='button';button.dataset.dm='retry';
      button.textContent='重新載入地圖';node.append(button);
    }
  }
  ensureCharacterSprites(room){
    // Do not download both character sheets for every visitor: only the
    // genders in the currently active multiplayer room are rendered.
    for(const member of Object.values(room?.members||{})){
      const id=member?.gender==='female'?'female':'male';
      if(this.sprites[id])continue;
      const image=new Image();image.decoding='async';
      image.onload=()=>this.drawSoon();
      image.onerror=()=>this.drawSoon();
      image.src='/assets/world-map/players/player-'+id+'.webp';
      this.sprites[id]=image;
    }
  }
  async open({room,playerUid}){
    if(!safeRoom(room?.id)||!room?.members?.[playerUid]||
        playerUid!==getMainUser()?.uid)throw new Error('你不是此副本的有效隊員');
    window.prefetchXiuxianContext?.('dungeon');
    if(room.status==='assembled')
      void window.QAGameAudio?.preload(['combat-impact','spirit-pulse','reward-chime']);
    if(room.status==='assembled')void globalThis.QAContextualAssets?.warmImages(
      globalThis.QAContextualAssets.dungeonImages(room,playerUid),{max:8});
    this.mount();
    if(room.status==='assembled')this.ensureCharacterSprites(room);
    if(this.opened&&this.roomId===room.id){
      this.updateRoom(room);
      this.$('[data-dm="close"]')?.focus({preventScroll:true});
      return;
    }
    this.close();
    this.previousFocus=document.activeElement;
    this.room=room;this.roomId=room.id;this.uid=playerUid;
    this.quiz?.attach(room.id,playerUid,
      room.members[playerUid]?.dungeonAdmin===true,room.mapVersion===2);
    // Passive regen does not need questions: only prepare AI quizzes on demand.
    if(room.status==='assembled'&&room.mapVersion!==2)void this.quiz?.warm();
    this.map=null;this.camera=Camera.initialCamera();
    this.visualScenes.clear();this.travelScenes.clear();
    this.enemyReactionScenes.clear();
    this.pendingMovementPreview=null;this.pendingAction=null;
    this.queuedSkill=null;
    clearTimeout(this.ambientTimer);this.ambientTimer=null;
    this.ambiencePlan=null;this.environmentPlan=null;
    this.bossTransition=null;
    this.follow=true;this.pointers.clear();this.opened=true;
    this.movePending=false;this.strikePending=false;this.skillPending=false;
    this.portalPending=false;this.bossPending=false;
    this.rescuePending=false;this.rewardPending=false;this.rewardResult=null;
    this.loadoutPending=false;this.aimTile=null;this.skillSignature='';
    this.wheelMode='attack';this.moveTarget='player';this.selectedSkillId='';this.weaponWheelSlot=-1;this.manualOpen=false;this.wheelSwipeStart=null;
    this.routePending=false;this.rangeSignature='';this.rangeTiles=[];
    this.inspectOpen=false;this.selectedBeastId=null;this.followBeast=false;
    this.beastIds='';this.touchOrigins.clear();this.gestureMulti=false;
    clearTimeout(this.longPressTimer);this.longPressTimer=null;
    this.root.hidden=false;
    this.$('[data-dm="close"]').focus({preventScroll:true});
    if(typeof ResizeObserver==='function'){
      // Canvas writes inside ResizeObserver can trigger an undelivered loop.
      this.observer=new ResizeObserver(()=>this.scheduleResize());
      this.observer.observe(this.stage);
    }else window.addEventListener('resize',this.onResize);
    window.addEventListener('orientationchange',this.onResize);
    document.addEventListener('visibilitychange',this.onVisibility);
    this.clockTimer=setInterval(()=>this.renderClock(),250);
    this.syncClockAnchor(room);
    this.resize();this.updateStatus();
    await this.load();
  }
  async load(){
    if(!this.isCurrent())return;
    const request=++this.seq,roomId=this.roomId,uid=this.uid;
    this.alert('正在載入隊伍共享的秘境地圖…');
    try{
      const map=await getDungeonMap(roomId);
      if(!this.isCurrent()||request!==this.seq||uid!==this.uid)return;
      if(!mapValid(map))throw new Error('副本地圖資料不完整');
      this.map=map;
      this.environmentPlan=dungeonEnvironmentPlan(map);
      const ambience=globalThis.QATacticalAmbience;
      const biome={bamboo:'竹林',ruins:'遺墟',frost:'霜嶺',
        marsh:'碧水'}[map.biome]||'遺墟';
      this.ambiencePlan=ambience?.prepare?.({
        id:roomId,width:20,height:14,
        trial:{title:biome,seed:map.layoutId||map.seed||roomId}
      })||null;
      const palette=BIOMES[map.biome]||BIOMES.ruins;
      this.root.style.setProperty('--dm-accent',palette.trim);
      this.$('[data-dm-title]').textContent=map.arena==='boss'?
        '玄炎鎮殿 · 首領戰':palette.name+' · 合作副本';
      // Always center the player, including irregular map boundaries.
      this.follow=true;this.followBeast=false;
      this.camera=Camera.lockToPlayer(this.selfPad(),
        this.map,this.width,this.height);
      this.alert('');this.resize();
      this.updateMovementHUD();this.updateBeastHUD();this.drawSoon();
    }catch(error){
      if(!this.isCurrent()||request!==this.seq)return;
      this.alert(error?.message||'無法載入地圖',true);
    }
  }
  members(){
    return Object.values(this.room?.members||{}).sort((a,b)=>
      a.joinedAtMs-b.joinedAtMs||String(a.uid).localeCompare(String(b.uid)));
  }
  selfPad(){
    if(!this.map)return {x:0,y:0};
    const pos=this.room?.members?.[this.uid]?.position;
    if(pos&&Number.isInteger(pos.x)&&Number.isInteger(pos.y)&&
      pos.x>=0&&pos.y>=0&&pos.x<this.map.width&&pos.y<this.map.height&&
      this.map.tiles[pos.y*this.map.width+pos.x]>0)return pos;
    const index=Math.max(0,this.members().findIndex(m=>m.uid===this.uid));
    return this.map.spawnPads[index]||this.map.spawn;
  }
  updateMovementHUD(){
    const active=this.room?.status==='assembled';
    const holder=this.$('[data-dm-movement]');
    if(holder)holder.hidden=!active||!this.map;
    const own=this.room?.members?.[this.uid];
    const stamina=own?.dungeonAdmin===true?10:
      Number.isSafeInteger(own?.explorationStamina)?own.explorationStamina:10;
    const energy=this.$('[data-dm-energy]');
    if(energy)energy.textContent=String(Math.max(0,Math.min(10,stamina)));
    const chargeLabel=this.$('[data-dm="quiz"]');
    const autoRegeneration=this.room?.mapVersion===2;
    if(chargeLabel){
      const label=chargeLabel.querySelector('.tc-charge-label');
      if(label)label.textContent=autoRegeneration?'自由答題':'答題充能';
      chargeLabel.setAttribute('aria-label',
        (autoRegeneration?'自由答題':'答題充能')+'，能量 '+
        Math.max(0,Math.min(10,stamina))+' / 10，'+
        (own?.dungeonAdmin===true?'管理員體力固定十點，答題仍可累積學習紀錄':
          autoRegeneration?'每秒自動恢復 1 點，答題不再額外補充能量':
          '答對增加 4 點、答錯增加 1 點，無作答次數限制'));
    }
    this.$('[data-dm-quarter-energy]').hidden=!active||!this.map;
    this.root.querySelectorAll('[data-dm-energy-segment]').forEach((segment,index)=>
      segment.classList.toggle('is-filled',index<energyRingFill(stamina)));
    const p=this.selfPad();
    const maximum=Number.isSafeInteger(own?.battleMaxHealth)&&
      own.battleMaxHealth>0?own.battleMaxHealth:100;
    const hp=Number.isSafeInteger(own?.battleHealth)?
      Math.max(0,Math.min(maximum,own.battleHealth)):maximum;
    const downed=own?.downed===true||hp===0;
    const health=this.$('[data-dm-health]');
    if(health){
      health.textContent=downed?'倒地 · 等待救援':'生命 '+hp+'/'+maximum;
      health.classList.toggle('is-critical',hp/maximum<=.25);
    }
    const threatened=this.creatures().filter(beast=>
      beast?.attack?.cells?.some(tile=>tile.x===p.x&&tile.y===p.y));
    const threat=this.$('[data-dm-threat]');
    if(threat){
      threat.hidden=!threatened.length&&!downed;
      if(downed)threat.textContent=autoRegeneration?
        '已倒地 · 能量每秒回復，可蓄力自救或等待隊友靠近救援':
        '已倒地 · 可以答題蓄力自救，或等待隊友靠近救援';
      else if(threatened.length){
        const fire=Math.min(...threatened.map(beast=>beast.attack.resolvesAtTick));
        const applied=Number(this.room?.battleClock?.appliedTick)||0;
        const expected=threatened.map(beast=>
          dungeonIncomingDamage(beast.attack,own)).filter(Number.isFinite);
        const total=expected.reduce((sum,damage)=>sum+damage,0);
        threat.textContent='危險！'+threatened.length+
          ' 隻靈獸鎖定腳下 · 約 '+Math.max(0,fire-applied)+
          ' 秒後命中'+(expected.length===threatened.length?
            ' · 若不閃避，預估累計 '+total+' 傷害（未計掩護）':'')+
          '，請立即移開';
      }
    }
    const party=this.$('[data-dm-team-status]');
    if(party){
      const friends=this.members();
      party.hidden=friends.length<2||!active;
      if(!party.hidden)party.textContent=friends.map(m=>{
        const max=Number.isSafeInteger(m.battleMaxHealth)?m.battleMaxHealth:100;
        const value=Number.isSafeInteger(m.battleHealth)?m.battleHealth:max;
        return String(m.name||'修士').slice(0,10)+' '+
          (m.downed?'倒地':value+'/'+max+' HP');
      }).join(' · ');
    }
    const charge=this.$('[data-dm="quiz"]');
    if(charge){
      charge.disabled=!active||!this.map;
      charge.classList.toggle('is-charge-ready',active&&!!this.map);
    }
    this.updatePortalHUD();
    this.updateRescueHUD();this.updateGuardHUD();this.updateVictoryHUD();
    this.updateStrikeHUD();this.updateSkillHUD();this.updateWheelHUD();
    // Keep the world uncluttered as in 問道試煉. Contextual team actions
    // appear only when there is something useful to do or a live warning.
    if(holder){
      const exceptional=[
        this.$('[data-dm-threat]'),this.$('[data-dm-rescues]'),
        this.$('[data-dm-guards]'),this.$('[data-dm="portal"]'),
        this.$('[data-dm="enter-boss"]'),this.$('[data-dm-portal-votes]')
      ];
      holder.hidden=!active||!this.map||!exceptional.some(node=>
        node&&!node.hidden);
    }
  }
  setWheelMode(mode){
    if(mode!=='attack'&&mode!=='move')return;
    if(this.wheelMode!==mode){
      this.wheelMode=mode;this.aimTile=null;this.selectedBeastId=null;
      this.updateBeastHUD();this.updateSkillHUD();
      this.drawSoon();
    }
    this.updateWheelHUD();
  }
  selectTrialWheel(value){
    const own=this.room?.members?.[this.uid];
    const modern=!!own,weaponIds=dungeonWeaponSlots(own);
    if(modern&&value.startsWith('weapon:')){
      const slot=Number(value.slice(7));
      if(!Number.isInteger(slot)||slot<0||slot>=2||!weaponIds[slot])return;
      this.weaponWheelSlot=slot;this.selectedSkillId='';
      // Choosing an outer weapon only opens its skill list. It cannot move
      // or cast until a skill is explicitly selected on the inner ring.
      this.wheelMode='move';this.aimTile=null;this.selectedBeastId=null;
      this.rangeSignature='';
      this.updateBeastHUD();this.updateSkillHUD();this.updateWheelHUD();
      this.drawSoon();return;
    }
    if(value==='player'||value==='sword'){
      if(value==='sword'&&!own?.flyingSword)return;
      if(modern&&this.weaponWheelSlot>=0)return;
      this.weaponWheelSlot=-1;
      this.moveTarget=value;this.wheelMode='move';this.aimTile=null;
      this.selectedBeastId=null;this.rangeSignature='';
      this.updateBeastHUD();this.updateSkillHUD();this.updateWheelHUD();
      this.drawSoon();return;
    }
    if(value==='move'||value==='attack'){
      if(modern&&value==='move'){
        this.weaponWheelSlot=-1;this.selectedSkillId='';
      }else if(modern&&value==='attack'){
        if(weaponIds.some(Boolean))return;
        this.weaponWheelSlot=-1;this.selectedSkillId='basic';
      }
      this.setWheelMode(value);return;
    }
    const skills=own?.dungeonSkills||[];
    const chosen=skills.find(skill=>skill.id===value);
    if(value!=='basic'&&!chosen)return;
    if(value==='basic'&&skills.length)return;
    if(modern&&(this.weaponWheelSlot<0||
        (chosen?.weaponId||globalThis.QAManuals?.BY_SKILL?.[chosen?.id]?.manualId)!==
          weaponIds[this.weaponWheelSlot]))return;
    if(this.selectedSkillId!==value){
      this.selectedSkillId=value;this.aimTile=null;this.selectedBeastId=null;
    }
    this.wheelMode='attack';
    this.updateBeastHUD();this.updateSkillHUD();
    this.updateWheelHUD();this.drawSoon();
    if(value==='dragon-guard')
      this.actionFeedback('已選四步連推 · 點擊方向可連續推進最多四格（消耗 4 體力）');
  }
  updateWheelHUD(){
    const wheel=this.$('[data-dm-wheel]');
    if(!wheel)return;
    const active=this.room?.status==='assembled'&&!!this.map;
    wheel.hidden=!active;
    const own=this.room?.members?.[this.uid];
    const charges=active?dungeonFocusCharges(own):0;
    const badge=this.$('[data-dm-focus-indicator]');
    if(badge){
      badge.hidden=!active||charges===0;
      badge.textContent=charges>0?'✦ 金身蓄勢 '+charges+'/6':'';
      badge.title=charges>0?'剩餘 '+charges+' 次強化體術，施放後消耗一層':'';
    }
    const skills=Array.isArray(own?.dungeonSkills)?own.dungeonSkills:[];
    const modern=!!own,weaponIds=dungeonWeaponSlots(own);
    if(modern&&this.weaponWheelSlot>=0&&!weaponIds[this.weaponWheelSlot]){
      this.weaponWheelSlot=-1;this.wheelMode='move';this.selectedSkillId='';
    }
    if(modern&&this.weaponWheelSlot<0){
      if(weaponIds.some(Boolean)||this.wheelMode!=='attack'){
        this.wheelMode='move';this.selectedSkillId='';
      }else this.selectedSkillId='basic';
    }else if(modern&&this.weaponWheelSlot>=0){
      const weaponId=weaponIds[this.weaponWheelSlot];
      if(!skills.some(skill=>skill.id===this.selectedSkillId&&skill.weaponId===weaponId)){
        this.selectedSkillId='';
        this.wheelMode='move';
      }
    }else if(skills.length&&!skills.some(skill=>skill.id===this.selectedSkillId))
      this.selectedSkillId=skills[0].id;
    else if(!skills.length)this.selectedSkillId='basic';
    const selectedWeapon=modern&&this.weaponWheelSlot>=0?
      globalThis.QAManuals?.BY_BOOK?.[weaponIds[this.weaponWheelSlot]]:null;
    // Show only server-authorized moves from the selected weapon.
    // The wheel divides its inner rail among these visible moves.
    const visibleSkills=modern?(selectedWeapon?.skills||[])
      .filter(template=>skills.some(skill=>skill.id===template.id)).map(template=>{
      const skill=skills.find(value=>value.id===template.id);
      const empowered=!!skill&&dungeonFocusEmpowers(own,skill);
      let art='';try{art=skillArt(template)||''}catch(_){}
      return {value:template.id,name:template.name,
        cost:skill?(empowered?Math.ceil(skill.cost/2):skill.cost):null,
        description:skill?.description||'',art,empowered,locked:!skill};
    }):skills.map(skill=>{
      const empowered=dungeonFocusEmpowers(own,skill);
      const cost=empowered?Math.ceil(skill.cost/2):skill.cost;
      let art='';try{art=skillArt(skill)||''}catch(_){}
      return {value:skill.id,name:skill.name,cost,
        description:skill.description||'',art,empowered};
    });
    const options=visibleSkills.length?visibleSkills:
      modern?[]:[{value:'basic',name:'普通攻擊',cost:2}];
    if(this.moveTarget==='sword'&&!own?.flyingSword)this.moveTarget='player';
    renderDungeonTrialWheel(wheel,{
      mode:this.wheelMode,options,
      weaponIds:modern?weaponIds:null,
      selectedWeaponSlot:modern?this.weaponWheelSlot:-1,
      moveOptions:[{value:'player',name:'角色',cost:'1 體力/格'},
        ...(own?.flyingSword?[{value:'sword',name:'飛劍',cost:'每 2 格 1 體力'}]:[])],
      selected:this.wheelMode==='move'&&(!modern||this.weaponWheelSlot<0)?
        this.moveTarget:this.selectedSkillId,
      stamina:Math.max(0,Math.min(10,Number(own?.explorationStamina)||0)),
      focusCharges:charges,
      locked:!active||this.movePending||this.routePending||
        this.loadoutPending||this.strikePending||
        own?.downed===true||Number(own?.battleHealth)===0
    });
    const toggle=this.$('[data-dm="loadouts"]');
    if(toggle){
      toggle.hidden=!active||!own?.dungeonLoadoutNames?.length;
      toggle.setAttribute('aria-expanded',String(this.manualOpen));
      toggle.classList.toggle('is-open',this.manualOpen);
    }
  }
  updateGuardHUD(){
    const box=this.$('[data-dm-guards]');
    if(!box)return;
    const fighting=this.room?.status==='assembled'&&
      this.room?.dungeonArena==='boss'&&
      this.room?.bossEncounter?.status==='fighting'&&!!this.map;
    const own=this.room?.members?.[this.uid];
    if(!fighting||!own){
      box.hidden=true;this.guardSignature='';
      box.replaceChildren();return;
    }
    const roster=this.members();
    const signature=roster.map(m=>String(m.uid)+'|'+String(m.name||'')).join(';');
    if(this.guardSignature!==signature){
      box.replaceChildren(...roster.map(member=>{
        const button=document.createElement('button');
        button.type='button';button.dataset.dm='guard';
        button.dataset.targetUid=member.uid;
        return button;
      }));
      this.guardSignature=signature;
    }
    const tick=Number(this.room?.battleClock?.appliedTick)||0;
    const stamina=Math.max(0,Number(own.explorationStamina)||0);
    const ownAlive=own.downed!==true&&Number(own.battleHealth)>0;
    box.querySelectorAll('[data-dm="guard"]').forEach(button=>{
      const member=this.room.members[button.dataset.targetUid];
      if(!member)return;
      const self=member.uid===this.uid,cost=self?6:3;
      const nearby=own.position&&member.position&&
        Math.abs(own.position.x-member.position.x)+
        Math.abs(own.position.y-member.position.y)<=2;
      const protectedNow=member.bossGuard&&
        Number(member.bossGuard.expiresAtTick)>=tick;
      const name=self?'自己':String(member.name||'隊友').slice(0,7);
      button.textContent=protectedNow?'✓ '+name+' · 掩護中':
        '🛡 '+(self?'自守':'掩護 '+name)+' · '+cost+' 體力';
      button.disabled=this.guardPending||!ownAlive||
        member.downed===true||Number(member.battleHealth)<=0||
        !nearby||stamina<cost||!!protectedNow;
      button.title=protectedNow?'可抵擋一次 Boss 預告攻擊的一半傷害':
        !nearby?'需與目標相距兩格以內':
        stamina<cost?'先答題補充體力':
        '持續最多 5 秒，承受一次 Boss 傷害後消失；不影響原本的救援技能';
    });
    box.hidden=false;
  }
  async guard(targetUid){
    if(this.guardPending||!this.isCurrent()||!this.map||
      this.room?.dungeonArena!=='boss')return;
    const own=this.room?.members?.[this.uid];
    if(!own)return;
    const seq=(Number.isSafeInteger(own.guardSeq)?own.guardSeq:0)+1;
    const roomId=this.roomId,token=this.seq;
    this.guardPending=true;this.updateGuardHUD();
    try{
      const data=await guardDungeonTeammate(roomId,targetUid,seq);
      if(!this.isCurrent()||this.seq!==token||this.roomId!==roomId)return;
      if(data?.room){
        this.updateRoom(data.room);
        window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
          detail:{room:data.room}
        }));
        this.moveAlert(targetUid===this.uid?'🛡 已進入守護姿態':
          '🛡 已替隊友準備防護');
      }
    }catch(error){
      if(this.isCurrent()&&this.seq===token){
        this.moveAlert(error?.message||'隊友掩護失敗');
        if(error?.status===409){
          try{
            const fresh=await getDungeonRoom(roomId);
            if(this.isCurrent()&&this.seq===token&&fresh?.room)
              this.updateRoom(fresh.room);
          }catch(_){}
        }
      }
    }finally{
      this.guardPending=false;
      if(this.isCurrent()&&this.seq===token)this.updateGuardHUD();
    }
  }
  updateRescueHUD(){
    const box=this.$('[data-dm-rescues]');
    if(!box)return;
    box.replaceChildren();
    const own=this.room?.members?.[this.uid];
    const active=this.room?.status==='assembled'&&!!this.map&&
      !(this.room?.dungeonArena==='boss'&&
        this.room?.bossEncounter?.status==='defeated');
    if(!active||!own){box.hidden=true;return;}
    const isDown=own.downed===true||Number(own.battleHealth)===0;
    const list=isDown?[own]:this.members().filter(m=>
      m.uid!==this.uid&&(m.downed===true||Number(m.battleHealth)===0));
    box.hidden=!list.length;
    const energy=Math.max(0,Number(own.explorationStamina)||0);
    for(const friend of list){
      const ownAid=friend.uid===this.uid,cost=ownAid?25:8;
      const nearby=ownAid||Boolean(own.position&&friend.position&&
        Math.abs(own.position.x-friend.position.x)+
        Math.abs(own.position.y-friend.position.y)<=1);
      const limit=ownAid?(own.selfRescueCount||0)<1:
        (friend.allyReviveCount||0)<2;
      const button=document.createElement('button');
      button.type='button';button.dataset.dm='rescue';
      button.dataset.targetUid=friend.uid;
      button.textContent=ownAid?
        '✦ 凝神復起 · '+cost+' 體力（本場 1 次）':
        '✚ 救援 '+String(friend.name||'隊友').slice(0,9)+' · '+cost+' 體力';
      button.disabled=this.rescuePending||!nearby||!limit||energy<cost;
      button.title=!limit?'這位修士的本場救援次數已用盡':
        !nearby?'需走到隊友身旁相鄰一格':
        energy<cost?'可答題補充探索體力':
        ownAid?'以 25 體力恢復 25 生命，每場限 1 次':
        '恢復隊友 40 生命，每人每場最多接受 2 次援助';
      box.append(button);
    }
  }
  updateVictoryHUD(){
    const panel=this.$('[data-dm-victory]');
    if(!panel)return;
    const won=this.room?.status==='assembled'&&
      this.room?.dungeonArena==='boss'&&
      this.room?.bossEncounter?.status==='defeated';
    panel.hidden=!won;
    if(!won)return;
    const button=this.$('[data-dm-claim]');
    const status=this.$('[data-dm-reward-status]');
    const award=this.rewardResult;
    button.disabled=this.rewardPending||!!award;
    button.textContent=this.rewardPending?'正在驗證勝利並入帳…':
      award?'✓ 已領取本場獎勵':'領取 120 靈石 ＋ 3 修為';
    status.textContent=award?
      (award.status==='duplicate'?'本場獎勵先前已領取，不再重複發放':
        '已成功存入玩家帳號')+
      (award.manualDrop?.name?' · 獲得功法《'+award.manualDrop.name+'》':
        ' · 本場未掉落新功法'):
      '每場每人限領一次；離開隊伍後仍可從副本入口的勝利紀錄補領。';
  }
  async rescue(targetUid){
    if(!this.isCurrent()||!this.map||this.rescuePending)return;
    const own=this.room?.members?.[this.uid];
    if(!own||this.room.status!=='assembled')return;
    const seq=(Number.isSafeInteger(own.rescueSeq)?own.rescueSeq:0)+1;
    const roomId=this.roomId,token=this.seq;
    this.rescuePending=true;this.updateRescueHUD();
    try{
      const data=await rescueDungeonTeammate(roomId,targetUid,seq);
      if(!this.isCurrent()||this.seq!==token||this.roomId!==roomId)return;
      if(data?.room){
        this.updateRoom(data.room);
        window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
          detail:{room:data.room}
        }));
        this.moveAlert(targetUid===this.uid?'✦ 已凝神復起，恢復 25 生命':
          '✚ 已救起隊友，恢復 40 生命');
      }
    }catch(error){
      if(this.isCurrent()&&this.seq===token){
        this.moveAlert(error?.message||'救援失敗');
        if(error?.status===409){
          try{const current=await getDungeonRoom(roomId);
            if(this.isCurrent()&&this.seq===token&&current?.room)
              this.updateRoom(current.room);
          }catch(_){}
        }
      }
    }finally{
      this.rescuePending=false;
      if(this.isCurrent()&&this.seq===token)this.updateRescueHUD();
    }
  }
  async claimVictory(){
    if(!this.isCurrent()||this.rewardPending||this.rewardResult||
        this.room?.dungeonArena!=='boss'||
        this.room?.bossEncounter?.status!=='defeated')return;
    const roomId=this.roomId,token=this.seq;
    this.rewardPending=true;this.updateVictoryHUD();
    try{
      const data=await claimDungeonBossReward(roomId);
      if(!this.isCurrent()||this.seq!==token||this.roomId!==roomId)return;
      if(data?.reward)this.rewardResult=data.reward;
    }catch(error){
      if(this.isCurrent()&&this.seq===token)
        this.$('[data-dm-reward-status]').textContent=
          error?.message||'獎勵暫時無法入帳，可以重新按鈕領取';
    }finally{
      this.rewardPending=false;
      if(this.isCurrent()&&this.seq===token&&!this.rewardResult)
        this.$('[data-dm-claim]').disabled=false;
      else if(this.isCurrent()&&this.seq===token)this.updateVictoryHUD();
    }
  }
  updateStrikeHUD(){
    const button=this.$('[data-dm="strike"]');
    if(!button)return;
    const member=this.room?.members?.[this.uid];
    const target=this.creatures().find(e=>e.id===this.selectedBeastId);
    const current=member?.position;
    const visible=target&&current&&this.map&&
      dungeonAttackTiles(this.map,current,{kind:'attack',range:2})
        .some(p=>p.x>=target.position.x&&
          p.x<target.position.x+(target.kind==='boss'?2:1)&&
          p.y>=target.position.y&&
          p.y<target.position.y+(target.kind==='boss'?2:1));
    const energy=Number.isSafeInteger(member?.explorationStamina)?
      member.explorationStamina:0;
    button.hidden=Boolean(member?.dungeonSkillIds?.length);
    button.disabled=this.room?.status!=='assembled'||!this.map||
      !visible||this.strikePending||member?.downed===true||
      Number(member?.battleHealth)===0||energy<2;
    button.textContent=this.strikePending?'攻擊結算中…':target?
      '攻擊 '+String(target.name||'靈獸').slice(0,8)+' · 2 體力':
      '選擇靈獸後攻擊 · 2 體力';
    button.title=!target?'點擊地圖或靈獸名單選取目標':
      !visible?'須與目標位於同一行列的兩格內，且不能隔著岩壁':
        '直線攻擊前方兩格，可同時命中沿線靈獸；無冷卻';
  }
  updateSkillHUD(){
    const member=this.room?.members?.[this.uid];
    const panel=this.$('[data-dm-manual]');
    if(!panel)return;
    const active=this.room?.status==='assembled'&&!!this.map;
    const presets=member?.dungeonLoadoutNames||[];
    // Presets/details are an optional popup. The actual cast controls live
    // in the quarter dial and must update even while the popup is closed.
    panel.hidden=!active||!presets.length||!this.manualOpen||this.inspectOpen;
    panel.classList.toggle('has-focus',active&&Number(member?.focusCharges)>0);
    if(!active)return;
    const skills=member.dungeonSkills||[];
    const signature=JSON.stringify([presets,skills]);
    if(signature!==this.skillSignature){
      this.skillSignature=signature;
      const presetRoot=this.$('[data-dm-presets]');
      presetRoot.replaceChildren(...presets.map((name,index)=>{
        const button=document.createElement('button');
        button.type='button';button.dataset.dm='loadout';
        button.dataset.loadoutIndex=String(index);
        button.textContent=String(name||('配置 '+(index+1))).slice(0,15);
        return button;
      }));
      const skillButton=skill=>{
        const button=document.createElement('button');
        button.type='button';button.dataset.dm='cast';
        button.dataset.skillId=skill.id;
        button.title=skill.description||'';
        return button;
      };
      this.$('[data-dm-skills]').replaceChildren(...skills.map(skillButton));
      this.$('[data-dm-wheel-skills]').replaceChildren(...skills.map(skillButton));
    }
    const stamina=Number.isSafeInteger(member.explorationStamina)?
      member.explorationStamina:0;
    const downed=member.downed===true||member.battleHealth===0;
    const charges=dungeonFocusCharges(member);
    this.$('[data-dm-focus]').textContent=charges>0?
      '✦ 金身蓄勢 '+charges+'/6 · 體術減耗':'';
    const aimed=this.currentAim();
    this.$('[data-dm-aim]').textContent=aimed?
      '目標格 ('+aimed.x+'，'+aimed.y+') · 點其他格改變目標':
      '點擊靈獸或空白地格，再施放技能';
    this.root.querySelectorAll('[data-dm-presets] button').forEach((button,index)=>{
      const selected=index===member.dungeonLoadoutIndex;
      button.setAttribute('aria-pressed',String(selected));
      button.disabled=this.loadoutPending||this.skillPending||downed||selected;
    });
    this.root.querySelectorAll('[data-dm-skills] button,[data-dm-wheel-skills] button').forEach(button=>{
      const skill=skills.find(v=>v.id===button.dataset.skillId);
      if(!skill)return;
      const empowered=dungeonFocusEmpowers(member,skill);
      const cost=empowered?Math.ceil(skill.cost/2):skill.cost;
      // Match the server's school/kind rule, including disabled-to-aim skills.
      // The right quarter wheel uses a separate CSS skin, so mark BOTH copies.
      button.classList.toggle('is-focus-empowered',empowered);
      button.dataset.focusEmpowered=String(empowered);
      button.textContent=(empowered?'✦ ':'')+skill.name+' · '+cost+' 體力';
      button.title='技能等級 Lv.'+(skill.level||1)+' · '+
        (empowered?'蓄勢加成：體力減半、施放後消耗一層。':
          (skill.kind==='fist-focus'?'施放後凝聚六層蓄勢，無冷卻。':''))+
        (skill.kind==='fist-focus'?'':('基礎單段傷害約 '+
          (skill.singleHitDamage||0)+
          (skill.centerHitDamage?'，劍陣中心每擊約 '+skill.centerHitDamage:'')+'。'))+
        (skill.description||'');
      // Permit a second skill press while awaiting the first response.
      button.disabled=this.loadoutPending||this.movePending||
        downed||stamina<cost||
        (skill.kind!=='fist-focus'&&!aimed);
    });
    this.updateWheelHUD();
  }
  currentAim(){
    const beast=this.creatures().find(e=>e.id===this.selectedBeastId);
    return beast?(beast.kind==='boss'?
      (this.aimTile||beast.position):beast.position):this.aimTile||null;
  }
  targetFor(skill){
    const own=this.room?.members?.[this.uid]?.position;
    if(!own)return null;
    if(skill?.kind==='fist-focus')return {...own};
    if(skill?.kind==='flying-sword')return this.aimTile;
    const picked=this.currentAim();
    if(!picked)return null;
    if(['fist-throw','fist-sweep','fist-chain'].includes(skill?.kind)){
      const dx=picked.x-own.x,dy=picked.y-own.y;
      if(dx===0&&dy===0)return null;
      return Math.abs(dx)>=Math.abs(dy)?
        {x:own.x+Math.sign(dx),y:own.y}:
        {x:own.x,y:own.y+Math.sign(dy)};
    }
    if(skill?.kind==='dash-cleave'){
      // A dash ends on a vacant cell; targeting an NPC means stop directly
      // before it. A clicked empty tile is used as-is.
      const target=this.creatures().find(e=>e.id===this.selectedBeastId);
      if(!target)return {...picked};
      const dx=Math.sign(picked.x-own.x),dy=Math.sign(picked.y-own.y);
      if((dx===0)===(dy===0))return null;
      return {x:picked.x-dx,y:picked.y-dy};
    }
    return {...picked};
  }
  skillAlert(message=''){
    const node=this.$('[data-dm-skill-alert]');
    if(node)node.textContent=message;
    if(message)this.actionFeedback(message);
  }
  async changeLoadout(index){
    if(this.loadoutPending||this.skillPending||!this.isCurrent())return;
    const roomId=this.roomId,token=this.seq;
    this.loadoutPending=true;this.updateSkillHUD();this.skillAlert('');
    try{
      const response=await switchDungeonLoadout(roomId,index);
      if(!this.isCurrent()||this.seq!==token)return;
      if(response?.room){
        this.updateRoom(response.room);
        window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
          detail:{room:response.room}
        }));
        this.skillAlert('已切換至'+(
          response.room.members?.[this.uid]?.dungeonLoadoutNames?.[index]||
          '配置 '+(index+1)));
      }
    }catch(error){
      if(this.isCurrent()&&this.seq===token)
        this.skillAlert(error?.message||'切換失敗');
    }finally{
      this.loadoutPending=false;
      if(this.isCurrent()&&this.seq===token)this.updateSkillHUD();
    }
  }
  async cast(skillId,requestedTarget=null,moveSword=false){
    const member=this.room?.members?.[this.uid];
    if(!this.isCurrent()||!member||this.loadoutPending||
      this.room.status!=='assembled')return;
    const skill=member.dungeonSkills?.find(v=>v.id===skillId)||
      (moveSword&&member.flyingSword&&skillId==='flight-summon'?{
        id:'flight-summon',name:'移動飛劍',kind:'flying-sword'}:null);
    if(!skill)return;
    const target=requestedTarget||this.targetFor(skill);
    if(!target){this.skillAlert('請先選擇同一直線上的目標，或空白地格');return;}
    if(this.skillPending){
      // Keep only the most recent follow-up input and its original target.
      this.queuedSkill={skillId,target:{...target},moveSword,
        roomId:this.roomId,token:this.seq};
      this.skillAlert('下一招已預備 · 前一招結算後立即施放');
      return;
    }
    const seq=(Number.isSafeInteger(member.skillSeq)?member.skillSeq:0)+1;
    const roomId=this.roomId,token=this.seq;
    let committed=false;
    this.skillPending=true;this.updateSkillHUD();
    this.pendingAction={kind:'skill',target:{...target},
      origin:{...(skill.kind==='flying-sword'&&member.flyingSword||member.position)},skillId,style:skill.kind,
      startedAt:performance.now()};
    this.skillAlert('出招中 · 正在確認命中結果');
    this.drawSoon();
    try{
      const response=await castDungeonSkill(roomId,skillId,target,seq,moveSword);
      if(!this.isCurrent()||this.seq!==token||this.roomId!==roomId)return;
      if(response?.room){
        this.updateRoom(response.room);
        committed=true;
        window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
          detail:{room:response.room}
        }));
        const result=response.room.members?.[this.uid]?.lastSkill;
        if(result?.seq===seq&&result.skillId===skillId){
          const defeated=result.hits?.filter(hit=>hit.defeated).length||0;
          const chainSteps=Array.isArray(result.chainSteps)?
            result.chainSteps:[];
          const advanced=result.skillId==='dragon-guard'?
            Math.abs((result.position?.x??result.origin?.x??0)-
              (result.origin?.x??0))+
            Math.abs((result.position?.y??result.origin?.y??0)-
              (result.origin?.y??0)):0;
          const chainProgress=result.skillId==='dragon-guard'?
            ' · 完成 '+chainSteps.length+' 段 · 前進 '+advanced+' 格'+
            (chainSteps.length<4?' · 前路受到阻擋':''):'';
          this.skillAlert(result.focusActivated?
            '✦ 金身蓄勢！六層金色氣勁已凝聚，接下來六招體術體力減半':
            (result.focusEmpowered?'✦ 金身加成 · ':'')+
            result.skillName+chainProgress+' · '+result.totalDamage+
            ' 傷害 · '+(result.hits?.length||0)+' 次命中'+
            (result.focusEmpowered?' · 蓄勢剩餘 '+result.focusCharges+'/6':'')+
            (defeated?' · 擊敗 '+defeated+' 隻':'')+
            (result.manualMastery?.exp?
              ' · 《'+result.manualMastery.bookName+'》+'+
              result.manualMastery.exp+' EXP':''));
          // The authoritative ledger update triggers the same visual XP
          // feedback as the trial; no independent guessed popup here.
          if(result.position){
            this.follow=true;this.followBeast=false;
            this.camera=Camera.focusOn(this.camera,this.selfPad(),
              this.map,this.width,this.height);
            this.drawSoon();
          }
        }
      }
    }catch(error){
      if(!this.isCurrent()||this.seq!==token)return;
      this.skillAlert(error?.message||'施放失敗');
      if(error?.status===409){
        try{
          const fresh=await getDungeonRoom(roomId);
          if(this.isCurrent()&&this.seq===token&&fresh?.room){
            this.updateRoom(fresh.room);
            window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
              detail:{room:fresh.room}
            }));
          }
        }catch(_){}
      }
    }finally{
      this.skillPending=false;this.pendingAction=null;
      const queued=this.queuedSkill;this.queuedSkill=null;
      if(this.isCurrent()&&this.seq===token){
        this.updateSkillHUD();this.drawSoon();
        // Queue uses the newly committed server sequence; no fake hit or
        // resource spend occurs while waiting for the response.
        if(committed&&queued?.token===token&&queued.roomId===roomId)
          queueMicrotask(()=>{if(this.isCurrent()&&this.seq===token)
            void this.cast(queued.skillId,queued.target,queued.moveSword);});
        else if(!committed&&queued)
          this.skillAlert('上一招未成功，預備招式已取消，請重新施放');
      }
    }
  }
  strikeAlert(message=''){
    const node=this.$('[data-dm-strike-alert]');
    if(node)node.textContent=message;
    if(message)this.actionFeedback(message);
  }
  async strike(){
    if(!this.isCurrent()||!this.map||this.strikePending||
      this.room?.status!=='assembled')return;
    const member=this.room?.members?.[this.uid];
    const enemy=this.creatures().find(e=>e.id===this.selectedBeastId);
    if(!member||!enemy)return;
    const seq=(Number.isSafeInteger(member.strikeSeq)?member.strikeSeq:0)+1;
    const token=this.seq,roomId=this.roomId;
    this.strikePending=true;this.updateStrikeHUD();
    this.pendingAction={kind:'strike',target:{...enemy.position},
      origin:{...member.position},style:'basic',
      startedAt:performance.now()};
    this.strikeAlert('出拳中 · 正在確認命中結果');
    this.drawSoon();
    try{
      const response=await strikeDungeonBeast(roomId,enemy.id,seq);
      if(!this.isCurrent()||token!==this.seq||roomId!==this.roomId)return;
      if(response?.room){
        this.updateRoom(response.room);
        window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
          detail:{room:response.room}
        }));
        const result=response.room.members?.[this.uid]?.lastStrike;
        if(result?.seq===seq&&result.enemyId===enemy.id){
          this.strikeAlert(result.defeated?'擊敗 '+enemy.name+'！':
            '命中 '+enemy.name+' · 傷害 '+result.damage+
            ' · 剩餘生命 '+result.remainingHealth+
            (result.hits?.length>1?' · 沿線另命中 '+(result.hits.length-1)+' 隻':'')
          );
        }
      }
    }catch(error){
      if(!this.isCurrent()||token!==this.seq)return;
      this.strikeAlert(error?.message||'攻擊失敗，請重試');
      if(error?.status===409){
        try{
          const latest=await getDungeonRoom(roomId);
          if(this.isCurrent()&&token===this.seq&&latest?.room){
            this.updateRoom(latest.room);
            window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
              detail:{room:latest.room}
            }));
          }
        }catch(_){}
      }
    }finally{
      this.strikePending=false;this.pendingAction=null;
      if(this.isCurrent()&&token===this.seq){
        this.updateStrikeHUD();this.drawSoon();
      }
    }
  }
  actionFeedback(message=''){
    const node=this.$('[data-dm-action-feedback]');
    if(!node)return;
    clearTimeout(this.actionFeedbackTimer);
    node.hidden=!message;node.textContent=message;
    if(message)this.actionFeedbackTimer=setTimeout(()=>{
      if(node.isConnected){node.hidden=true;node.textContent='';}
    },3300);
  }
  beginMovementPreview(path,finalStep){
    const event=previewDungeonMovement(path,this.map,this.uid);
    if(!event)return;
    this.pendingMovementPreview={key:event.key,finalStep,
      target:{...path.at(-1)}};
    this.travelScenes.set(event.key,{...event,
      startedAt:performance.now(),optimistic:true});
    // Advertise the first frame immediately, but paint asynchronously.
    // A synchronous draw here could throw or do expensive VFX work before
    // the authoritative move request was even sent to the C-room server.
    if(this.canvas?.dataset)this.canvas.dataset.motion='walking';
    this.drawSoon();
  }
  confirmMovementPreview(member){
    const pending=this.pendingMovementPreview;
    if(!pending||!member||member.moveSeq<pending.finalStep)return;
    if(member.position?.x!==pending.target.x||
       member.position?.y!==pending.target.y){
      this.clearMovementPreview();return;
    }
    this.pendingMovementPreview=null;
    const prior=this.travelScenes.get(pending.key);
    if(prior?.optimistic)this.travelScenes.set(pending.key,{
      ...prior,optimistic:false});
    this.drawSoon();
  }
  clearMovementPreview(){
    const pending=this.pendingMovementPreview;
    this.pendingMovementPreview=null;
    if(pending&&this.travelScenes.get(pending.key)?.optimistic)
      this.travelScenes.delete(pending.key);
    this.drawSoon();
  }
  async moveTo(tile){
    if(!this.isCurrent()||!this.map||this.routePending||this.movePending||
        this.room?.status!=='assembled')return;
    const own=this.room?.members?.[this.uid];
    if(!own||own.downed||Number(own.battleHealth)===0)return;
    const from=this.selfPad();
    const route=dungeonRoute(this.map,from,tile,this.creatures());
    if(!route){
      this.actionFeedback('此地格無法抵達：請選擇可通行位置');return;
    }
    if(!route.length)return;
    const stamina=Math.max(0,Math.min(10,Number(own.explorationStamina)||0));
    if(!own.dungeonAdmin&&route.length>stamina){
      this.actionFeedback('體力不足，需要 '+route.length+' 點，目前 '+stamina+' 點');
      return;
    }
    this.routePending=true;
    const token=this.seq,roomId=this.roomId;
    this.updateWheelHUD();this.actionFeedback('移動中 · '+route.length+' 格');
    try{
      // A route is split into bounded server-validated transactions.
      // The next chunk uses the returned authoritative position and seq.
      for(let offset=0;offset<route.length;offset+=48){
        if(!this.isCurrent()||this.seq!==token||roomId!==this.roomId)break;
        const member=this.room.members?.[this.uid];
        const next=route.slice(offset,offset+48);
        const step=(Number.isSafeInteger(member?.moveSeq)?member.moveSeq:0)+1;
        const path=[{...member.position}];
        for(const {dx,dy} of next){
          const last=path.at(-1);
          path.push({x:last.x+dx,y:last.y+dy});
        }
        this.beginMovementPreview(path,step+next.length-1);
        const result=await moveDungeonMemberRoute(roomId,next,step);
        if(!this.isCurrent()||this.seq!==token||roomId!==this.roomId)break;
        if(!result?.room)throw new Error('移動結果遺失，請重新同步');
        this.updateRoom(result.room);
        this.confirmMovementPreview(result.room.members?.[this.uid]);
        window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
          detail:{room:result.room}
        }));
        this.follow=true;this.followBeast=false;
        this.camera=Camera.lockToPlayer(this.selfPad(),this.map,this.width,this.height);
        this.drawSoon();
      }
      if(this.isCurrent()&&this.seq===token)this.actionFeedback('');
    }catch(error){
      this.clearMovementPreview();
      if(this.isCurrent()&&this.seq===token){
        this.actionFeedback(error?.message||'移動失敗，請重新點選');
        if(error?.status===409){
          try{
            const latest=await getDungeonRoom(roomId);
            if(this.isCurrent()&&this.seq===token&&latest?.room)
              this.updateRoom(latest.room);
          }catch(_){}
        }
      }
    }finally{
      this.routePending=false;
      if(this.isCurrent()&&this.seq===token)this.updateWheelHUD();
    }
  }
  mapTap(tile){
    if(!this.map||!this.isCurrent()||this.routePending)return;
    const {x,y}=tile;
    if(!Number.isInteger(x)||!Number.isInteger(y)||
        x<0||x>=this.map.width||y<0||y>=this.map.height||
        this.map.tiles[y*this.map.width+x]===0)return;
    if(this.room?.members?.[this.uid]&&
        this.weaponWheelSlot>=0&&this.wheelMode!=='attack'){
      this.actionFeedback('請先選擇武器內圈的技能');return;
    }
    this.aimTile={x,y};this.followBeast=false;
    // Tapping an enemy is a combat action, not an inspector popup.
    // Long-press remains dedicated to displaying beast information.
    const beast=this.creatures().find(e=>e?.position&&
      x>=e.position.x&&y>=e.position.y&&
      x<e.position.x+(e.kind==='boss'?2:1)&&
      y<e.position.y+(e.kind==='boss'?2:1));
    this.selectedBeastId=beast?.id||null;
    this.updateBeastHUD();this.updateStrikeHUD();
    this.updateSkillHUD();this.drawSoon();
    if(this.wheelMode==='move'){
      if(this.moveTarget==='sword')void this.cast('flight-summon',tile,true);
      else void this.moveTo(tile);
    }else if(this.selectedSkillId&&this.selectedSkillId!=='basic'){
      const own=this.room?.members?.[this.uid];
      const skill=own?.dungeonSkills?.find(s=>s.id===this.selectedSkillId);
      const self=this.selfPad();
      if(skill?.kind==='fist-focus'&&(x!==self.x||y!==self.y)){
        this.actionFeedback('蓄勢須點選自己的角色位置');
        return;
      }
      void this.cast(this.selectedSkillId);
    }else if(beast){
      void this.strike();
    }else this.actionFeedback('請點選射程內的靈獸，或切換已裝備功法');
  }
  moveAlert(message=''){
    const node=this.$('[data-dm-move-alert]');
    if(node)node.textContent=message;
    if(message)this.actionFeedback(message);
  }
  async move(dx,dy){
    if(this.movePending||!this.map||!this.isCurrent()||
      this.room?.status!=='assembled')return;
    const member=this.room.members?.[this.uid];
    if(!member)return;
    const step=(Number.isSafeInteger(member.moveSeq)?member.moveSeq:0)+1;
    const token=this.seq,roomId=this.roomId;
    this.movePending=true;this.updateMovementHUD();this.moveAlert('');
    const origin={...member.position};
    const target={x:origin.x+dx,y:origin.y+dy};
    if(target.x>=0&&target.y>=0&&target.x<this.map.width&&
        target.y<this.map.height&&
        this.map.tiles[target.y*this.map.width+target.x]>0&&
        !this.creatures().some(e=>e.position?.x===target.x&&
          e.position?.y===target.y))
      this.beginMovementPreview([origin,target],step);
    try{
      const result=await moveDungeonMember(roomId,dx,dy,step);
      if(!this.isCurrent()||token!==this.seq||roomId!==this.roomId)return;
      if(result?.room){
        this.updateRoom(result.room);
        window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
          detail:{room:result.room}
        }));
        this.confirmMovementPreview(result.room.members?.[this.uid]);
      }
      this.follow=true;this.followBeast=false;
      this.camera=Camera.lockToPlayer(this.selfPad(),this.map,this.width,this.height);
      this.drawSoon();
    }catch(error){
      this.clearMovementPreview();
      if(!this.isCurrent()||token!==this.seq)return;
      this.moveAlert(error?.message||'移動失敗，請重試');
      if(error?.status===409){
        try{
          const response=await getDungeonRoom(roomId);
          if(this.isCurrent()&&token===this.seq&&response?.room){
            this.updateRoom(response.room);
            window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
              detail:{room:response.room}
            }));
          }
        }catch(_){}
      }
    }finally{
      this.movePending=false;
      if(this.isCurrent()&&token===this.seq)this.updateMovementHUD();
    }
  }
  creatures(){
    return Array.isArray(this.room?.enemies)?this.room.enemies:[];
  }
  updateBeastHUD(){
    const beasts=this.creatures();
    const button=this.$('[data-dm="beasts"]');
    const panel=this.$('[data-dm-inspector]');
    if(button){
      button.textContent='靈獸 '+beasts.length;
      button.disabled=!this.map||!beasts.length||this.room?.status!=='assembled';
      button.setAttribute('aria-expanded',String(this.inspectOpen&&beasts.length>0));
    }
    if(!panel)return;
    panel.hidden=!this.inspectOpen||!beasts.length||!this.map;
    if(panel.hidden)return;
    const list=this.$('[data-dm-beast-list]');
    const ids=beasts.map(e=>String(e.id)).join('|');
    if(ids!==this.beastIds){
      this.beastIds=ids;
      list.replaceChildren(...beasts.map(beast=>{
        const element=document.createElement('button');
        element.type='button';element.dataset.dm='beast-select';
        element.dataset.beastId=String(beast.id);return element;
      }));
    }
    const state={patrol:'巡邏中',return:'返回巡邏',pursuit:'追蹤中',
      alert:'警戒',windup:'準備攻擊！',recover:'收招中',staggered:'破盾失衡'};
    list.querySelectorAll('[data-beast-id]').forEach(item=>{
      const beast=beasts.find(e=>String(e.id)===item.dataset.beastId);
      if(!beast)return;
      item.textContent=String(beast.name||'靈獸')+' · '+(state[beast.intent]||'巡邏中');
      item.setAttribute('aria-pressed',String(beast.id===this.selectedBeastId));
    });
    const selected=beasts.find(e=>e.id===this.selectedBeastId);
    const details=this.$('[data-dm-beast-details]');
    if(selected){
      details.textContent=String(selected.name||'靈獸')+' · '+
        (state[selected.intent]||'巡邏中')+
        ' · 座標 ('+selected.position.x+','+selected.position.y+')'+
        ' · 每 '+selected.cadence+' 秒行動一次'+
        ' · 境界 '+(selected.realm||'築基')+
        ' · 生命 '+(selected.battleHealth??'—')+'/'+(selected.battleMaxHealth??'—')+
        (selected.targetUid?' · 已發現修士':'')+
        ' · 節拍 T'+(selected.lastActionTick||0)+
        (selected.attack?' · '+selected.attack.label+
          ' 即將於 T'+selected.attack.resolvesAtTick+' 攻擊（紅格危險）'+
          (dungeonIncomingDamage(selected.attack,this.room?.members?.[this.uid])!==null?
            ' · 若命中你，預估 '+
            dungeonIncomingDamage(selected.attack,this.room?.members?.[this.uid])+
            ' 傷害（未計掩護）':''):'')+
        (selected.lastAttack?.hits?.length?' · 最近命中 '+
          selected.lastAttack.hits.length+' 位修士':'');
    }else details.textContent='點選靈獸可查看最新行動';
  }
  selectBeast(id,{focus=true}={}){
    if(!this.map||!this.isCurrent())return;
    const beast=this.creatures().find(e=>e.id===id);
    if(!beast)return;
    this.inspectOpen=true;this.selectedBeastId=beast.id;
    const cells=beast.kind==='boss'?[
      beast.position,{x:beast.position.x+1,y:beast.position.y},
      {x:beast.position.x,y:beast.position.y+1},
      {x:beast.position.x+1,y:beast.position.y+1}
    ]:[beast.position];
    const self=this.room?.members?.[this.uid]?.position||beast.position;
    cells.sort((a,b)=>
      Math.abs(a.x-self.x)+Math.abs(a.y-self.y)-
      Math.abs(b.x-self.x)-Math.abs(b.y-self.y));
    this.aimTile={...cells[0]};
    // Inspecting a beast must never pull the centered player off-screen.
    this.follow=true;this.followBeast=false;
    this.camera=Camera.lockToPlayer(this.selfPad(),
      this.map,this.width,this.height);
    this.updateBeastHUD();this.updateStrikeHUD();this.updateSkillHUD();this.drawSoon();
  }
  inspectAt(screen){
    if(!this.map)return false;
    const g=Camera.geometry(this.camera,this.map,this.width,this.height);
    const closest=this.creatures().map(beast=>{
      const cells=beast.kind==='boss'?[
        beast.position,{x:beast.position.x+1,y:beast.position.y},
        {x:beast.position.x,y:beast.position.y+1},
        {x:beast.position.x+1,y:beast.position.y+1}
      ]:[beast.position];
      return {beast,distance:Math.min(...cells.map(p=>
        Math.hypot(g.ox+(p.x+.5)*g.cell-screen.x,
          g.oy+(p.y+.5)*g.cell-screen.y)))};
    }).sort((a,b)=>a.distance-b.distance)[0];
    if(!closest||closest.distance>Math.max(18,g.cell*.85))return false;
    this.selectBeast(closest.beast.id,{focus:false});
    return true;
  }
  syncClockAnchor(room){
    const battle=room?.battleClock;
    if(!battle||battle.version!==1||!Number.isSafeInteger(battle.startedAtMs)){
      this.clockAnchor=null;this.clockTickFloor=0;this.renderClock();return;
    }
    // The server transmits its timestamp/elapsed value; local performance
    // time is used only to smoothly *display* progress between room snapshots.
    const old=this.clockAnchor;
    if(old?.startedAtMs!==battle.startedAtMs)this.clockTickFloor=0;
    this.clockTickFloor=Math.max(this.clockTickFloor,Number(battle.tick)||0);
    this.clockAnchor={
      startedAtMs:battle.startedAtMs,
      elapsedMs:Math.max(0,Number(battle.elapsedMs)||0),
      receivedAt:performance.now(),
      tickMs:Math.max(1,Number(battle.tickMs)||1000),
      maxElapsedMs:Math.max(0,(Number(room.expiresAtMs)||0)-battle.startedAtMs)
    };
    this.renderClock();
  }
  renderClock(){
    const node=this.$('[data-dm-clock]');
    if(!node)return;
    const clock=this.clockAnchor;
    if(!clock||this.room?.status!=='assembled'){
      node.textContent='等待集結';
      node.title='副本時鐘尚未啟動';return;
    }
    const passed=Math.max(clock.elapsedMs,clock.elapsedMs+
      Math.max(0,performance.now()-clock.receivedAt));
    const duration=Math.min(passed,clock.maxElapsedMs||passed);
    // Network delays must not make a previously displayed tick run backward.
    // This is display-only; the server remains authoritative for all actions.
    const tick=Math.max(this.clockTickFloor,Math.floor(duration/clock.tickMs));
    this.clockTickFloor=tick;
    const seconds=Math.max(Math.floor(duration/1000),
      Math.floor(tick*clock.tickMs/1000));
    const h=Math.floor(seconds/3600),m=Math.floor(seconds/60)%60,s=seconds%60;
    const display=(h?String(h)+':':'')+
      String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
    node.textContent='戰場時鐘 '+display+' · T'+tick;
    node.title='由伺服器時間校準；玩家操作或離開地圖不會暫停';
  }
  updatePortalHUD(){
    const node=this.$('[data-dm-objective]');
    const button=this.$('[data-dm="portal"]');
    const progress=this.room?.dungeonProgress;
    if(!button||!node)return;
    const active=this.room?.status==='assembled'&&!!this.map;
    const stage=progress?.portalStatus;
    const bossFight=this.room?.dungeonArena==='boss';
    const boss=this.creatures().find(e=>e.kind==='boss');
    const encounter=this.room?.bossEncounter;
    const bossBar=this.$('[data-dm-boss-health]');
    if(bossBar){
      bossBar.hidden=!bossFight;
      if(bossFight){
        const hp=Math.max(0,boss?.battleHealth||0),
          max=boss?.battleMaxHealth||2800,phase=boss?.phase||1;
        this.$('[data-dm-boss-label]').textContent=encounter?.status==='defeated'?
          '✓ 玄炎鎮殿獸已擊敗':'玄炎鎮殿獸';
        this.$('[data-dm-phase]').textContent=
          ['第一階段','第二階段','第三階段'][Math.max(0,Math.min(2,phase-1))];
        this.$('[data-dm-boss-value]').textContent=hp+' / '+max;
        this.$('[data-dm-boss-meter]').style.width=
          Math.round(hp/Math.max(1,max)*100)+'%';
        const meter=this.$('[data-dm-boss-progress]');
        meter?.setAttribute('aria-valuenow',String(hp));
        meter?.setAttribute('aria-valuemax',String(max));
        bossBar.dataset.phase=String(phase);
        const shieldNode=this.$('[data-dm-boss-shield]');
        const hint=this.$('[data-dm-teamwork-hint]');
        if(shieldNode){
          shieldNode.hidden=!boss;
          if(boss){
            const shield=Math.max(0,Number(boss.shield)||0);
            const shieldMax=Math.max(1,Number(boss.shieldMax)||180);
            this.$('[data-dm-shield-value]').textContent=
              shield?shield+'/'+shieldMax:'已破盾';
            this.$('[data-dm-shield-meter]').style.width=
              Math.round(100*shield/shieldMax)+'%';
          }
        }
        if(hint){
          const tick=Number(this.room?.battleClock?.appliedTick)||0;
          const remaining=Math.max(0,(Number(boss?.exposedUntilTick)||0)-tick);
          const last=boss?.lastTeamHit;
          hint.textContent=!boss?'首領已擊敗':Number(boss.shield)>0?
            '護盾減傷 30% · 交替攻擊可合擊 +20%':
            '破盾！'+(remaining?'破綻剩 '+remaining+' 秒 · 傷害 +25%':'')+
            (last?.combo&&tick-(last.tick||0)<=2?' · 合擊 +20%':'');
        }
      }
    }
    const entry=this.$('[data-dm="enter-boss"]');
    const self=this.room?.members?.[this.uid];
    const p=self?.position,portal=this.map?.portalSite;
    const near=Boolean(p&&portal&&
      Math.abs(p.x-portal.x)+Math.abs(p.y-portal.y)<=1);
    const alive=self?.downed!==true&&Number(self?.battleHealth)>0;
    const portalReady=this.room?.bossPortalReady;
    const readyCount=Number(portalReady?.readyCount)||0;
    const requiredCount=Number(portalReady?.requiredCount)||0;
    const offlineCount=Number(portalReady?.offlineCount)||0;
    const confirmed=Boolean(portalReady?.readyUids?.includes(this.uid));
    const allReady=portalReady?.allReady===true;
    const votes=this.$('[data-dm-portal-votes]');
    if(votes){
      votes.hidden=bossFight||!active||stage!=='open';
      votes.textContent='首領準備 '+readyCount+' / '+requiredCount+' 人'+
        (offlineCount?' · '+offlineCount+' 人離線暫不計入':'')+
        (confirmed?' · 你已確認':'');
    }
    node.textContent=!active?'等待隊伍集結':
      bossFight?(encounter?.status==='defeated'?
        '✓ 全隊已擊敗玄炎鎮殿獸 · 點擊勝利面板領取個人靈石與修為':
        '⚔ 首領戰 · '+(boss?.attack?.label?
          boss.attack.label+' 預警中，請立即閃避':'注意紅色預警格，保持協作')):
      !progress?'舊版探索場次 · 重新集結才有守鑰任務':
      stage==='open'?'✓ 傳送門已啟動 · 首領準備 '+readyCount+'/'+requiredCount+
        ' · 全體在線隊員各自走近確認後共同傳送':
      stage==='ready'?'🔑 已取得全隊共享密鑰 · 前往深處傳送陣':
      '◆ 前往地圖最深處，擊敗鎮鑰玄甲獸取得密鑰';
    node.classList.toggle('is-ready',stage==='ready');
    node.classList.toggle('is-open',stage==='open');
    button.hidden=bossFight||!active||!progress||stage==='sealed';
    button.disabled=this.portalPending||stage==='open'||!near||!alive;
    button.textContent=stage==='open'?'✓ 傳送門已啟動':
      !near?'🔑 持有共享密鑰 · 請靠近傳送陣':
      this.portalPending?'正在啟動傳送門…':'🔑 使用密鑰啟動傳送門';
    if(entry){
      entry.hidden=bossFight||!active||stage!=='open';
      entry.disabled=this.bossPending||
        (!confirmed&&(!near||!alive))||
        (confirmed&&allReady&&(!near||!alive));
      entry.textContent=this.bossPending?'正在更新準備狀態…':
        confirmed&&allReady?'⚔ 確認全隊出發':
        confirmed?'取消首領準備 · '+readyCount+'/'+requiredCount:
        !near?'請走近傳送陣才能準備':
        '⚔ 我已準備 · '+readyCount+'/'+requiredCount;
      entry.title=confirmed&&!allReady?'取消自己的確認，繼續探索':
        !near?'需站在傳送陣或相鄰一格，且保持生命值大於零':
        '所有在線隊員都確認後會一同進入；離線逾 60 秒的隊員不阻擋傳送';
    }
    button.title=stage==='open'?'傳送陣已啟動，可進入首領戰':
      !alive?'角色已倒地，不能啟動傳送門':
      !near?'必須站在傳送門或相鄰一格':'使用全隊共享密鑰，不消耗探索體力';
  }
  async openPortal(){
    const progress=this.room?.dungeonProgress;
    if(!this.isCurrent()||this.portalPending||
        progress?.portalStatus!=='ready')return;
    this.portalPending=true;this.updatePortalHUD();
    const token=this.seq,roomId=this.roomId;
    try{
      const data=await activateDungeonPortal(roomId);
      if(!this.isCurrent()||this.seq!==token||this.roomId!==roomId)return;
      if(data?.room){
        this.updateRoom(data.room);
        window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
          detail:{room:data.room}
        }));
      }
    }catch(error){
      if(this.isCurrent()&&this.seq===token){
        this.moveAlert(error?.message||'傳送門啟動失敗，請重試');
        if(error?.status===409){
          try{
            const fresh=await getDungeonRoom(roomId);
            if(this.isCurrent()&&this.seq===token&&fresh?.room)
              this.updateRoom(fresh.room);
          }catch(_){}
        }
      }
    }finally{
      this.portalPending=false;
      if(this.isCurrent()&&this.seq===token)this.updatePortalHUD();
    }
  }
  async enterBoss(){
    if(!this.isCurrent()||this.bossPending||
        this.room?.dungeonArena==='boss'||
        this.room?.dungeonProgress?.portalStatus!=='open')return;
    this.bossPending=true;this.updatePortalHUD();
    const roomId=this.roomId,token=this.seq;
    try{
      const status=this.room?.bossPortalReady;
      const confirmed=status?.readyUids?.includes(this.uid)===true;
      const response=confirmed&&!status?.allReady?
        await setDungeonBossReady(roomId,false):
        await enterDungeonBoss(roomId);
      if(!this.isCurrent()||token!==this.seq||roomId!==this.roomId)return;
      if(response?.room){
        this.updateRoom(response.room);
        window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
          detail:{room:response.room}
        }));
      }
    }catch(error){
      if(this.isCurrent()&&token===this.seq){
        this.moveAlert(error?.message||'無法進入首領戰');
        if(error?.status===409){
          try{
            const latest=await getDungeonRoom(roomId);
            if(this.isCurrent()&&token===this.seq&&latest?.room)
              this.updateRoom(latest.room);
          }catch(_){}
        }
      }
    }finally{
      this.bossPending=false;
      if(this.isCurrent())this.updatePortalHUD();
    }
  }
  updateStatus(){
    const state=this.$('[data-dm-status]');
    const boss=this.creatures().find(e=>e.kind==='boss');
    const attack=boss?.attack;
    if(state)state.textContent=this.room?.status==='assembled'?
      this.room?.dungeonArena==='boss'?
        (this.room?.bossEncounter?.status==='defeated'?
          '首領已擊敗 · 請在勝利面板領取本場靈石與修為':
          attack?.label?
            '⚠ 首領蓄勢 · '+attack.label+' · 依地面預警範圍閃避':
            '首領戰進行中 · 預警格可閃避 · 功法與答題持續有效'):
        '戰場進行中 · 可隨時移動與施放已裝備功法 · 紅色預警格請閃避':
      '等待隊伍集結 · 地圖預覽不消耗體力';
    this.updateMovementHUD();
    this.updateBeastHUD();
  }
  updateRoom(room){
    if(!this.opened)return;
    if(!room||room.id!==this.roomId||!room.members?.[this.uid]||
      !['waiting','assembled'].includes(room.status)){
      this.close();return;
    }
    if(Number(room.revision)<Number(this.room?.revision||0))return;
    const changedArena=this.map&&
      (this.map.arena==='boss')!==(room.dungeonArena==='boss');
    // Play only newly committed skill/strike results; duplicate SSE snapshots
    // cannot restart a visual, and entering an arena cannot replay old casts.
    const previous=this.room;
    const xpDelta=manualXpDelta(previous,room,this.uid,globalThis.QAManuals);
    if(changedArena){
      this.visualScenes?.clear();this.travelScenes?.clear();
    this.enemyReactionScenes?.clear();
      this.pendingMovementPreview=null;this.pendingAction=null;
      this.ambiencePlan=null;this.environmentPlan=null;
      this.bossTransition=null;
    }
    else if(this.map&&previous?.status==='assembled'){
      this.visualScenes ||=new Map();
      const now=performance.now();
      const phase=dungeonBossTransition(previous,room);
      if(phase)this.bossTransition={scene:phase,startedAt:now,
        duration:phase.kind==='defeat'?1500:1150};
      for(const event of dungeonMovementEvents(previous,room,this.map)){
        const prior=this.travelScenes.get(event.key);
        const pending=this.pendingMovementPreview;
        const target=event.scene.moves?.[0]?.path?.at(-1);
        if(pending?.key===event.key&&
            room.members?.[this.uid]?.moveSeq>=pending.finalStep&&
            target?.x===pending.target.x&&target?.y===pending.target.y&&
            prior?.optimistic){
          this.pendingMovementPreview=null;
          const still=sampleDungeonMovement(prior,now);
          if(still?.active)this.travelScenes.set(event.key,{...prior,
            optimistic:false});
          else this.travelScenes.delete(event.key);
          continue;
        }
        const joined=continueDungeonMovement(event,prior,now);
        this.travelScenes.set(event.key,{...joined,startedAt:now});
      }
      for(const {key,scene} of dungeonAnimationEvents(previous,room)){
        if(!this.visualScenes.has(key))
          this.visualScenes.set(key,{scene,
            startedAt:now+(scene.delayMs||0),soundPlayed:false});
      }
      while(this.visualScenes.size>12)
        this.visualScenes.delete(this.visualScenes.keys().next().value);
      // Only publish VFX for server-confirmed lastAttack / lastDamage
      // transitions. Repeated room pushes never replay the same impact.
      for(const event of dungeonEnemyReactionEvents(previous,room)){
        if(!this.enemyReactionScenes.has(event.key))
          this.enemyReactionScenes.set(event.key,{event,startedAt:now,
            soundPlayed:false});
      }
      while(this.enemyReactionScenes.size>20)
        this.enemyReactionScenes.delete(this.enemyReactionScenes.keys().next().value);
    }
    this.room=room;
    if(room.status==='assembled'){
      this.ensureCharacterSprites(room);
      void globalThis.QAContextualAssets?.warmImages(
        globalThis.QAContextualAssets.dungeonImages(room,this.uid),{max:8});
    }
    this.quiz?.setAdmin(room.members[this.uid]?.dungeonAdmin===true);
    this.quiz?.setAutoRegeneration(room.mapVersion===2);
    if(changedArena){
      this.map=null;this.camera=Camera.initialCamera();
      this.follow=true;this.followBeast=false;
      this.inspectOpen=false;this.selectedBeastId=null;
      this.aimTile=null;this.beastIds='';
      this.alert('全隊正在進入首領戰場…');
      void this.load();
    }
    // Passive regen does not need questions: only prepare AI quizzes on demand.
    if(room.status==='assembled'&&room.mapVersion!==2)void this.quiz?.warm();
    this.syncClockAnchor(room);
    this.updateStatus();
    if(xpDelta)this.showLiveManualXp(xpDelta);
    if(this.map){
      this.follow=true;this.followBeast=false;
      this.camera=Camera.lockToPlayer(this.selfPad(),
        this.map,this.width,this.height);
    }
    this.drawSoon();
  }
  clearLiveManualXp(){
    ++this.manualXpGeneration;
    if(this.manualXpTimer!==null)clearTimeout(this.manualXpTimer);
    this.manualXpTimer=null;
    this.$('[data-manual-xp-host]')?.replaceChildren();
  }
  scheduleManualXpClear(generation,delay){
    if(this.manualXpTimer!==null)clearTimeout(this.manualXpTimer);
    this.manualXpTimer=setTimeout(()=>{
      if(this.manualXpGeneration!==generation)return;
      this.$('[data-manual-xp-host]')?.replaceChildren();
      this.manualXpTimer=null;
    },delay);
  }
  showLiveManualXp(delta){
    if(!delta?.books?.length||!this.isCurrent()||
      this.root?.hidden||document.hidden)return;
    const host=this.$('[data-manual-xp-host]');
    if(!host)return;
    this.clearLiveManualXp();
    const generation=this.manualXpGeneration,roomId=this.roomId,uid=this.uid;
    // Exactly the same book art, entry layout, entrance animation and sound
    // as the existing PvE trial. No speculative client-side damage/EXP.
    host.innerHTML=renderManualXpToast(delta,{esc:escapeHtml,bookArt});
    try{window.QAGameAudio?.play('spirit-pulse',{volume:.25});}catch(_){}
    // A network failure must not leave an overlay permanently on-screen.
    this.scheduleManualXpClear(generation,6500);
    void this.confirmManualXpProgress(delta,generation,roomId,uid);
  }
  async confirmManualXpProgress(delta,generation,roomId,uid){
    const active=()=>this.isCurrent()&&this.roomId===roomId&&
      this.uid===uid&&this.manualXpGeneration===generation;
    try{
      // Replaying this is safe: Firebase A uses the high-water XP receipt.
      await claimDungeonManualExp(roomId);
      if(!active())return;
      const response=await authenticatedMainFetch('/api/tactical/manuals',{
        method:'GET'
      });
      if(!response.ok)throw Error('功法等級資料讀取失敗');
      const data=await response.json();
      if(!active()||!data?.state)return;
      const catalog=globalThis.QAManuals;
      const progress=renderManualXpProgress(delta,data.state,catalog,{
        esc:escapeHtml
      });
      const library=new Map((data.state.library||[]).map(book=>[book.id,book]));
      const candidates=delta.books.map(row=>{
        const hint=manualAnticipation(library.get(row.id),
          catalog?.totalExpForLevel,0);
        return hint&&['near','imminent','realm'].includes(hint.status)?
          {...hint,bookName:row.name}:null;
      }).filter(Boolean);
      const priority={imminent:0,realm:1,near:2};
      candidates.sort((a,b)=>
        priority[a.status]-priority[b.status]||a.remaining-b.remaining);
      const breakthrough=candidates.length?
        renderBattleBreakthroughEstimate(candidates[0],escapeHtml,{
          confirmed:true
        }):'';
      const toast=this.$('[data-manual-xp-toast]');
      if(toast&&(progress||breakthrough)){
        toast.insertAdjacentHTML('beforeend',progress+breakthrough);
      }
      this.scheduleManualXpClear(generation,2750);
    }catch(error){
      if(!active())return;
      // A pending account write is NOT labelled as a confirmed level-up.
      const toast=this.$('[data-manual-xp-toast]');
      if(toast){
        const message=document.createElement('small');
        message.className='tc-manual-xp-more';
        message.textContent='經驗已記錄，帳號進度同步中；重新連線可補入帳。';
        toast.append(message);
      }
      this.scheduleManualXpClear(generation,2750);
    }
  }
  close(){
    ++this.seq;this.opened=false;this.pointers.clear();this.movePending=false;
    this.strikePending=false;this.skillPending=false;this.loadoutPending=false;
    this.queuedSkill=null;
    this.guardPending=false;this.guardSignature='';
    this.aimTile=null;this.skillSignature='';
    this.wheelSwipeStart=null;this.manualOpen=false;this.wheelMode='attack';
    this.moveTarget='player';this.selectedSkillId='';this.weaponWheelSlot=-1;this.routePending=false;
    this.rangeSignature='';this.rangeTiles=[];
    clearTimeout(this.actionFeedbackTimer);this.actionFeedbackTimer=null;
    this.quiz?.destroy();
    this.visualScenes?.clear();this.travelScenes?.clear();
    this.enemyReactionScenes?.clear();
    this.pendingMovementPreview=null;this.pendingAction=null;
    this.queuedSkill=null;
    clearTimeout(this.ambientTimer);this.ambientTimer=null;
    this.ambiencePlan=null;this.environmentPlan=null;
    this.bossTransition=null;
    for(const aura of this.focusAuras.values())aura.remove();
    this.focusAuras.clear();
    clearTimeout(this.longPressTimer);this.longPressTimer=null;
    this.touchOrigins.clear();this.gestureMulti=false;
    this.inspectOpen=false;this.selectedBeastId=null;
    this.followBeast=false;this.beastIds='';
    clearInterval(this.clockTimer);this.clockTimer=null;this.clockAnchor=null;this.clockTickFloor=0;
    this.observer?.disconnect();this.observer=null;
    if(this.resizeFrame)cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame=0;
    window.removeEventListener('resize',this.onResize);
    window.removeEventListener('orientationchange',this.onResize);
    document.removeEventListener('visibilitychange',this.onVisibility);
    if(this.frame)cancelAnimationFrame(this.frame);
    this.frame=0;
    this.clearLiveManualXp();
    if(this.root)this.root.hidden=true;
    this.map=null;this.room=null;this.roomId='';this.uid='';
    const focus=this.previousFocus;this.previousFocus=null;
    if(focus?.isConnected)focus.focus({preventScroll:true});
  }
  action(name,beastId,skillId,loadoutIndex,rescueUid){
    if(name==='close'){this.close();return;}
    if(name==='retry'){void this.load();return;}
    if(name==='close-beasts'){
      this.inspectOpen=false;this.followBeast=false;
      this.updateBeastHUD();this.updateSkillHUD();return;
    }
    if(name==='beast-select'){
      // Selecting an enemy from the inspector returns the left rail to
      // combat controls. The chosen enemy remains selected for casting.
      this.selectBeast(beastId);this.inspectOpen=false;
      this.updateBeastHUD();this.updateSkillHUD();return;
    }
    if(name==='quiz'){this.quiz?.show();return;}
    if(name==='wheel-attack'){this.setWheelMode('attack');return;}
    if(name==='wheel-move'){this.setWheelMode('move');return;}
    if(name==='wheel-choice'){this.selectTrialWheel(skillId||'player');return;}
    if(name==='loadouts'){
      this.manualOpen=!this.manualOpen;this.updateSkillHUD();return;
    }
    if(name==='portal'){void this.openPortal();return;}
    if(name==='enter-boss'){void this.enterBoss();return;}
    if(name==='rescue'){void this.rescue(rescueUid);return;}
    if(name==='guard'){void this.guard(rescueUid);return;}
    if(name==='claim-victory'){void this.claimVictory();return;}
    if(name==='strike'){void this.strike();return;}
    if(name==='cast'){void this.cast(skillId);return;}
    if(name==='loadout'){void this.changeLoadout(Number(loadoutIndex));return;}
    if(name==='beasts'){
      this.inspectOpen=!this.inspectOpen;
      if(!this.inspectOpen)this.followBeast=false;
      this.updateBeastHUD();this.updateSkillHUD();return;
    }
    const directions={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
    if(directions[name]){void this.move(...directions[name]);return;}
  }
  keyDown(event){
    if(this.quiz?.visible)return;
    if(event.key==='Escape'){event.preventDefault();this.close();return;}
    if(!this.opened)return;
    if(event.key==='Tab'){
      const controls=[...this.root.querySelectorAll('button:not(:disabled),canvas[tabindex]')]
        .filter(node=>node.getClientRects().length>0);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&event.target===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&event.target===last){event.preventDefault();first?.focus();}
      return;
    }
    if(!this.map)return;
    const walking={w:[0,-1],a:[-1,0],s:[0,1],d:[1,0],
      W:[0,-1],A:[-1,0],S:[0,1],D:[1,0]};
    if(!this.routePending&&walking[event.key]&&!event.ctrlKey&&!event.altKey&&!event.metaKey){
      event.preventDefault();void this.move(...walking[event.key]);return;
    }
    // Arrow keys and zoom shortcuts never move this fixed camera.
  }
  pointerPosition(event){
    const bounds=this.canvas.getBoundingClientRect();
    return {x:event.clientX-bounds.left,y:event.clientY-bounds.top};
  }
  pointerDown(event){
    if(!this.map||!this.isCurrent()||(event.pointerType==='mouse'&&event.button!==0))return;
    event.preventDefault();
    try{this.canvas.setPointerCapture(event.pointerId);}catch(_){}
    const at=this.pointerPosition(event);
    this.pointers.set(event.pointerId,at);
    this.touchOrigins.set(event.pointerId,at);
    clearTimeout(this.longPressTimer);this.longPressTimer=null;
    this.longPressTriggered=false;
    if(this.pointers.size>1)this.gestureMulti=true;
    else if(event.pointerType!=='mouse'){
      const id=event.pointerId;
      this.longPressTimer=setTimeout(()=>{
        if(!this.opened||this.gestureMulti||!this.pointers.has(id))return;
        this.longPressTriggered=this.inspectAt(at);
      },480);
    }
  }
  pointerMove(event){
    if(!this.map||!this.isCurrent()||!this.pointers.has(event.pointerId))return;
    const point=this.pointerPosition(event),origin=this.touchOrigins.get(event.pointerId);
    if(origin&&Math.hypot(point.x-origin.x,point.y-origin.y)>8){
      clearTimeout(this.longPressTimer);this.longPressTimer=null;
    }
    this.pointers.set(event.pointerId,point);
    // Map gestures never change the world camera; only short taps act.
  }
  pointerUp(event){
    clearTimeout(this.longPressTimer);this.longPressTimer=null;
    const origin=this.touchOrigins.get(event.pointerId);
    const at=this.pointerPosition(event);
    const tapped=event.type==='pointerup'&&!this.gestureMulti&&
      !this.longPressTriggered&&this.pointers.size===1&&origin&&
      Math.hypot(at.x-origin.x,at.y-origin.y)<8;
    this.pointers.delete(event.pointerId);
    this.touchOrigins.delete(event.pointerId);
    if(!this.pointers.size)this.gestureMulti=false;
    if(tapped&&this.map&&this.isCurrent()){
      const g=Camera.geometry(this.camera,this.map,this.width,this.height);
      const p={x:Math.floor((at.x-g.ox)/g.cell),
        y:Math.floor((at.y-g.oy)/g.cell)};
      this.mapTap(p);
    }
    try{
      if(this.canvas.hasPointerCapture?.(event.pointerId))
        this.canvas.releasePointerCapture(event.pointerId);
    }catch(_){}
  }
  wheel(event){if(this.opened)event.preventDefault();}
  scheduleResize(){
    if(!this.opened||this.resizeFrame)return;
    this.resizeFrame=requestAnimationFrame(()=>{
      this.resizeFrame=0;
      if(this.opened)this.resize();
    });
  }
  resize(){
    if(!this.opened||!this.stage)return;
    const rect=this.stage.getBoundingClientRect();
    const width=Math.max(1,Math.round(rect.width)),height=Math.max(1,Math.round(rect.height));
    const dpr=clamp(window.devicePixelRatio||1,1,2);
    const pixelsWide=Math.round(width*dpr),pixelsHigh=Math.round(height*dpr);
    if(width===this.width&&height===this.height&&
        this.canvas.width===pixelsWide&&this.canvas.height===pixelsHigh)return;
    if(this.map)this.camera=Camera.lockToPlayer(this.selfPad(),this.map,width,height);
    this.width=width;this.height=height;
    if(this.canvas.width!==pixelsWide)this.canvas.width=pixelsWide;
    if(this.canvas.height!==pixelsHigh)this.canvas.height=pixelsHigh;
    this.ctx?.setTransform(dpr,0,0,dpr,0,0);this.drawSoon();
  }
  updateFocusAuras(geometry,visualMembers=this.members()){
    const layer=this.$('[data-dm-effects]');
    if(!layer||!this.map||!geometry)return;
    const present=new Set(),members=visualMembers;
    if(this.room?.status==='assembled'){
      members.forEach((member,index)=>{
        const charges=member?.focusCharges;
        if(!Number.isSafeInteger(charges)||charges<=0||member.downed||
            Number(member.battleHealth)===0)return;
        const pos=member.position||this.map.spawnPads[index];
        if(!pos||!Number.isFinite(pos.x)||!Number.isFinite(pos.y)||
            pos.x<0||pos.y<0||pos.x>=this.map.width||pos.y>=this.map.height||
            this.map.tiles[Math.floor(pos.y)*this.map.width+
              Math.floor(pos.x)]===0)return;
        // Exactly match the position offsets of overlapping teammate sprites.
        const companions=members.filter((other,j)=>{
          const q=other.position||this.map.spawnPads[j];
          return q?.x===pos.x&&q?.y===pos.y;
        });
        const slot=Math.max(0,companions.findIndex(x=>x.uid===member.uid));
        const shift=member.uid===this.uid?0:(companions.length>1?.22*geometry.cell:0);
        const x=geometry.ox+(pos.x+.5)*geometry.cell+
          shift*(slot%2?1:-1);
        const y=geometry.oy+(pos.y+.5)*geometry.cell+
          shift*(slot>=2?1:-1);
        if(x< -80||x>this.width+80||y< -80||y>this.height+80)return;
        present.add(member.uid);
        let aura=this.focusAuras.get(member.uid);
        if(!aura){
          // CSS handles continuous shimmer independent of room update rate.
          // Halo, flares and motes surround the sprite; center stays clear.
          aura=document.createElement('div');
          aura.className='dm-focus-aura';
          aura.dataset.focusUid=member.uid;
          aura.innerHTML='<span class="dm-focus-glow"></span>'+
            '<span class="dm-focus-flames"></span>'+
            '<span class="dm-focus-ring"></span>'+
            '<span class="dm-focus-orbit"></span>'+
            '<span class="dm-focus-spark dm-spark-a"></span>'+
            '<span class="dm-focus-spark dm-spark-b"></span>'+
            '<span class="dm-focus-spark dm-spark-c"></span>'+
            '<span class="dm-focus-spark dm-spark-d"></span>'+
            '<span class="dm-focus-spark dm-spark-e"></span>'+
            '<span class="dm-focus-spark dm-spark-f"></span>'+
            '<span class="dm-focus-count"></span>';
          this.focusAuras.set(member.uid,aura);
          layer.append(aura);
        }
        aura.style.left=x+'px';aura.style.top=y+'px';
        aura.style.setProperty('--dm-focus-size',
          clamp(geometry.cell*2.05,58,148)+'px');
        aura.dataset.charges=String(charges);
        aura.classList.toggle('is-self',member.uid===this.uid);
        aura.querySelector('.dm-focus-count').textContent=
          member.uid===this.uid?'蓄勢 '+charges+'/6':'✦ '+charges;
        aura.title='蓄勢金身 · 剩餘 '+charges+' 招';
      });
    }
    for(const [uid,aura] of this.focusAuras){
      if(!present.has(uid)){aura.remove();this.focusAuras.delete(uid);}
    }
  }
  updateRangePlan(){
    if(!this.map||this.room?.status!=='assembled'){
      this.rangeSignature='';this.rangeTiles=[];this.skillPreview=null;return;
    }
    const member=this.room.members?.[this.uid];
    if(!member)return;
    const revision=Number(this.room.revision)||0;
    const key=this.roomId+'|'+this.seq+'|'+revision+'|'+
      this.wheelMode+'|'+this.moveTarget+'|'+this.selectedSkillId;
    if(this.rangeSignature===key)return;
    this.rangeSignature=key;
    this.skillPreview=null;
    const from=this.selfPad(),enemies=this.creatures();
    if(member&&this.weaponWheelSlot>=0&&this.wheelMode!=='attack'){
      this.rangeKind='move';this.rangeTiles=[];return;
    }
    if(this.wheelMode==='move'){
      if(this.moveTarget==='sword'&&member.flyingSword){
        this.rangeKind='sword';
        this.rangeTiles=dungeonSwordTiles(this.map,from,member.flyingSword,
          enemies,this.members(),member.dungeonAdmin===true?10:
            Math.max(0,Math.min(10,member.explorationStamina||0)),true);
      }else{
        this.rangeKind='move';
        this.rangeTiles=dungeonReachableTiles(this.map,from,enemies,
          member.dungeonAdmin===true?48:
          Math.max(0,Math.min(10,member.explorationStamina||0)));
      }
    }else{
      const skill=(member.dungeonSkills||[]).find(s=>s.id===this.selectedSkillId)||
        {kind:'attack',range:2};
      this.rangeKind=skill.kind==='dash-cleave'?'dash':'attack';
      this.rangeTiles=skill.kind==='flying-sword'?
        dungeonSwordTiles(this.map,from,member.flyingSword,enemies,this.members()):
        dungeonAttackTiles(this.map,from,skill,enemies);
      if(globalThis.QADungeonSkillResolution){
        this.skillPreview=skill.id?globalThis.QADungeonSkillResolution.previewPlan(this.room,this.uid,this.map,skill):
          globalThis.QADungeonSkillResolution.basicPreviewPlan(this.room,this.uid,this.map);
        this.rangeTiles=this.skillPreview.aims;
      }
    }
  }
  drawSoon(){
    if(!this.opened||this.frame)return;
    this.frame=requestAnimationFrame(()=>{this.frame=0;this.draw();});
  }
  draw(){
    if(!this.opened||!this.ctx||!this.width||!this.height)return;
    const ctx=this.ctx,m=this.map,w=this.width,h=this.height;
    ctx.fillStyle='#0b1915';ctx.fillRect(0,0,w,h);
    if(!m)return;
    const now=performance.now(),scenes=[];
    const reduceMotion=typeof window!=='undefined'&&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let travelActive=false,heroTravelActive=false;
    const visualActor=(actor,key)=>{
      const uid=actor.uid||actor.id;
      if(!reduceMotion)for(const entry of [...this.visualScenes.values()].reverse()){
        const timeline=entry.scene.weaponTimeline,elapsed=now-entry.startedAt;
        if(!timeline||elapsed<0||elapsed>=entry.scene.duration)continue;
        const pose=globalThis.QAWeaponEffects.motionPose(timeline,uid,elapsed/entry.scene.duration);
        if(pose){travelActive=true;if(key==='member:'+this.uid)heroTravelActive=true;return {...actor,position:{x:pose.x,y:pose.y},visualLift:pose.lift};}
      }
      const entry=this.travelScenes.get(key);
      if(!entry||reduceMotion){
        if(reduceMotion)return actor;
        const ambience=globalThis.QATacticalAmbience;
        const kind=actor.kind||'';
        const pose=ambience?.idlePose?.({
          uid:actor.uid||actor.id,
          hp:actor.battleHealth??100,
          bot:key.startsWith('enemy:'),
          species:kind==='wisp'?12:kind==='golem'?8:
            kind==='guardian'||kind==='boss'?9:0,
          boss:kind==='boss'
        },now,false);
        return pose?{...actor,visualLift:-(pose.dy||0)}:actor;
      }
      const sampled=sampleDungeonMovement(entry,now);
      if(!sampled){this.travelScenes.delete(key);return actor;}
      if(!sampled.active){
        if(entry.optimistic&&this.pendingMovementPreview?.key===key)
          return {...actor,position:sampled.position,visualLift:0};
        this.travelScenes.delete(key);return actor;
      }
      travelActive=true;
      if(key==='member:'+this.uid)heroTravelActive=true;
      return {...actor,position:sampled.position,visualLift:sampled.lift};
    };
    const visualMembers=this.members().map(member=>
      visualActor(member,'member:'+member.uid));
    const visualEnemies=this.creatures().map(enemy=>
      visualActor(enemy,'enemy:'+enemy.id));
    // Follow the same interpolated hero position, not the already-committed
    // server endpoint. The player remains screen-centered while terrain glides.
    const visualHero=visualMembers.find(member=>member.uid===this.uid)?.position||this.selfPad();
    this.camera=Camera.lockToPlayer(visualHero,m,w,h);
    this.updateRangePlan();
    let queuedScenes=false;
    for(const [key,entry] of this.visualScenes||[]){
      const elapsed=now-entry.startedAt;
      if(elapsed<0){queuedScenes=true;continue;}
      if(elapsed>=entry.scene.duration){
        this.visualScenes.delete(key);continue;
      }
      const p=reduceMotion ? .77 : Math.max(0,Math.min(1,
        elapsed/Math.max(1,entry.scene.duration)));
      const firstImpact=entry.scene.weaponTimeline?.segments.find(s=>s.hits.some(h=>h.damage||h.absorbed))?.impact;
      if(!entry.soundPlayed&&p>=(firstImpact===undefined?.38:firstImpact/entry.scene.weaponTimeline.durationMs)){
        entry.soundPlayed=true;
        if(entry.scene.hits?.some(hit=>hit.damage>0))
          try{window.QAGameAudio?.play('combat-impact',{volume:.27});}catch(_){}
      }
      scenes.push({scene:entry.scene,p});
    }
    const enemyImpactScenes=[];
    for(const [key,entry] of this.enemyReactionScenes||[]){
      const elapsed=now-entry.startedAt;
      if(elapsed>=entry.event.duration){
        this.enemyReactionScenes.delete(key);continue;
      }
      const progress=reduceMotion?.42:clamp(
        elapsed/Math.max(1,entry.event.duration),0,1);
      const scene={...entry.event,progress};
      enemyImpactScenes.push(scene);
      // One impact sound per confirmed enemy strike; never play when all
      // players dodged and never infer a hit from the warning alone.
      if(!entry.soundPlayed&&entry.event.kind==='strike'&&
          entry.event.hits?.length&&progress>=.16){
        entry.soundPlayed=true;
        try{window.QAGameAudio?.play('combat-impact',{volume:.24});}catch(_){}
      }
    }
    const paintEffects=(context,view,above)=>{
      const renderer=globalThis.QATacticalSkillEffects;
      if(!above)globalThis.QAWeaponEffects?.drawObjects(context,this.room?.weaponObjects,visualMembers.map(m=>({uid:m.uid,...m.position})),view,now,{reduced:reduceMotion});
      for(const {scene,p} of scenes){
        try{
          paintDungeonScene(context,scene.weaponTimeline?{...scene,reducedMotion:reduceMotion}:scene,p,view,above,renderer);
          if(above)drawDungeonHitNumbers(context,scene,p,view);
        }catch(error){
          // A malformed visual must never block the live multiplayer fight.
          if(!scene.visualErrorLogged){
            scene.visualErrorLogged=true;
            console.warn('[Dungeon visuals] failed to paint',error);
          }
        }
      }
    };
    const warning=dungeonThreatPlan(m,this.creatures(),this.members(),
      this.uid,this.rangeTiles,this.wheelMode);
    const transition=this.bossTransition;
    let phasePulse=null;
    if(transition){
      const elapsed=now-transition.startedAt;
      if(elapsed>=transition.duration)this.bossTransition=null;
      else phasePulse={scene:transition.scene,
        progress:clamp(elapsed/transition.duration,0,1)};
    }
    const clock=this.clockAnchor;
    const displayTick=clock?Math.max(
      Number(this.room?.battleAppliedTick)||0,this.clockTickFloor,
      Math.floor((clock.elapsedMs+Math.max(0,now-clock.receivedAt))/
        clock.tickMs)):
      Number(this.room?.battleAppliedTick)||0;
    const windupTick=clock?Math.max(displayTick,
      (clock.elapsedMs+Math.max(0,now-clock.receivedAt))/clock.tickMs):displayTick;
    // Only server-confirmed skill scenes animate the sword. Paths never
    // change authority or collision logic on the client.
    const swordVisuals={};
    for(const {scene,p} of scenes){
      if(scene.style!=='flying-sword'||!Array.isArray(scene.path)||
        scene.path.length<2||!scene.actor)continue;
      const length=scene.path.length-1,travel=Math.max(0,Math.min(length,p*length));
      const step=Math.min(length-1,Math.floor(travel)),fraction=travel-step;
      const from=scene.path[step],to=scene.path[step+1];
      swordVisuals[scene.actor]={
        x:from.x+(to.x-from.x)*fraction,
        y:from.y+(to.y-from.y)*fraction
      };
    }
    const own=this.room?.members?.[this.uid],aim=this.aimTile;
    const previewSword=own?.flyingSword&&aim&&(
      this.wheelMode==='move'&&this.moveTarget==='sword'||
      this.wheelMode==='attack'&&this.selectedSkillId==='flight-summon');
    const swordPreviewRoute=previewSword&&this.rangeTiles.some(p=>
      p.x===aim.x&&p.y===aim.y)?
      dungeonSwordRoute(m,own.flyingSword,aim,this.creatures()):null;
    const skill=own?.dungeonSkills?.find(s=>s.id===this.selectedSkillId);
    const selectedAim=skill&&this.wheelMode==='attack'?this.targetFor(skill):null;
    const selectedPreview=this.wheelMode==='attack'?(skill?(selectedAim&&this.skillPreview?.byAim[selectedAim.x+','+selectedAim.y]):this.skillPreview?.byEnemy?.[this.selectedBeastId]):null;
    const geometry=drawWorld(ctx,m,this.camera,w,h,{
      members:visualMembers,selfUid:this.uid,showRoutes:false,
      rangeTiles:this.rangeTiles,rangeKind:this.rangeKind,
      skillPreview:this.wheelMode==='attack'?this.skillPreview:null,selectedPreview,
      swordPreviewRoute,swordVisuals,
      enemies:visualEnemies,objectives:this.room?.dungeonProgress,
      aimTile:this.currentAim(),art:this.sprites,
      dangerPlan:warning,showDangerGuidance:this.wheelMode==='move',
      ambiencePlan:this.ambiencePlan,
      environmentPlan:this.environmentPlan,
      bossTransition:phasePulse,displayTick,
      windupTick,enemyImpactScenes,
      pendingAction:this.pendingAction,
      reducedMotion:reduceMotion,
      currentTick:Number(this.room?.battleClock?.appliedTick)||0,
      visualTimeMs:now,
      animationUnderlay:(context,view)=>paintEffects(context,view,false),
      animationOverlay:(context,view)=>paintEffects(context,view,true)
    });
    this.updateFocusAuras(geometry,visualMembers);
    // Read-only render diagnostics for real-device/browser acceptance.
    // These reflect actually constructed visual plans, not combat authority.
    this.canvas.dataset.skillPreviewCells=String(this.skillPreview?.cells.length||0);
    this.canvas.dataset.skillPreviewDamage=selectedPreview&&this.skillPreview?.exact?String(selectedPreview.totalDamage):'';
    this.canvas.dataset.environmentEffects=String(
      this.environmentPlan?.positions?.length||0);
    const visibleBoss=this.creatures().find(e=>e.kind==='boss');
    this.canvas.dataset.bossEffects=visibleBoss?'active':'none';
    this.canvas.dataset.bossTelegraph=visibleBoss?.attack?.kind||'none';
    this.canvas.dataset.warningCells=String(warning.cells.length);
    // Expose presentation activity for browser acceptance and accessibility.
    // This is never used as input to movement, collision or combat rules.
    // Autonomous beasts may move continuously. Only the local hero controls
    // the movement indicator; enemy steps must not keep it stuck on 'walking'.
    const motionState=heroTravelActive?'walking':'idle';
    if(this.canvas.dataset.motion!==motionState)this.canvas.dataset.motion=motionState;
    // Read-only animation coordinate used by browser regression diagnostics.
    // Never replace authoritative member.position with this fraction.
    if(travelActive)
      this.canvas.dataset.visualHero=visualHero.x.toFixed(3)+','+visualHero.y.toFixed(3);
    else if(this.canvas.hasAttribute('data-visual-hero'))
      this.canvas.removeAttribute('data-visual-hero');
    if((scenes.length||queuedScenes||phasePulse||enemyImpactScenes.length)&&!reduceMotion)
      this.drawSoon();
    if(travelActive&&!reduceMotion)this.drawSoon();
    // 20fps atmosphere refresh (not a 60fps polling loop). Pause entirely
    // when hidden or reduced motion is requested; C-room clock continues.
    if(!reduceMotion&&!document.hidden&&!this.ambientTimer){
      this.ambientTimer=setTimeout(()=>{
        this.ambientTimer=null;
        if(this.opened)this.drawSoon();
      },50);
    }
  }
}
export async function showDungeonMap(options){
  if(!viewer)viewer=new DungeonMapView();
  return viewer.open(options);
}
export function hideDungeonMap(){viewer?.close();}
export function updateDungeonMapRoom(room){viewer?.updateRoom(room);}

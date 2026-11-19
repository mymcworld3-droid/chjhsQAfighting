import * as Camera from './dungeon-map-camera.js';
import { BIOMES, drawWorld, drawMinimap } from './dungeon-map-painter.js';
import { getDungeonMap, moveDungeonMember, strikeDungeonBeast, castDungeonSkill, switchDungeonLoadout, getDungeonRoom } from './dungeon-room.js';
import { getMainUser } from './data/project-repository.js';
import { DungeonQuizPanel } from './dungeon-quiz-panel.js';

// Read-only expedition blueprint. Pointer and keyboard events manipulate only
// this viewer's local camera; no battle/move endpoint is called at this stage.
const safeRoom=id=>/^[A-Za-z0-9_-]{8,160}$/.test(String(id||''));
const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
const mapValid=map=>map?.mode==='dungeon'&&map.layoutVersion===1&&
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
    this.root=null;this.stage=null;this.canvas=null;this.mini=null;this.ctx=null;
    this.quiz=null;
    this.map=null;this.room=null;this.roomId='';this.uid='';
    this.camera=Camera.initialCamera();this.follow=false;this.routes=false;
    this.opened=false;this.seq=0;this.pointers=new Map();this.movePending=false;
    this.strikePending=false;this.skillPending=false;this.loadoutPending=false;
    this.aimTile=null;this.skillSignature='';
    this.focusAuras=new Map();
    this.width=0;this.height=0;this.frame=0;this.observer=null;this.previousFocus=null;
    this.clockTimer=null;this.clockAnchor=null;this.clockTickFloor=0;
    this.inspectOpen=false;this.selectedBeastId=null;this.followBeast=false;
    this.beastIds='';this.touchOrigins=new Map();this.gestureMulti=false;
    this.longPressTimer=null;this.longPressTriggered=false;
    this.onResize=()=>this.resize();
    this.onVisibility=()=>{if(!document.hidden&&this.opened)this.resize();};
  }
  mount(){
    if(this.root)return;
    if(!document.getElementById('dungeon-map-view-style')){
      const style=document.createElement('link');
      style.id='dungeon-map-view-style';style.rel='stylesheet';
      style.href='/styles/dungeon-map-view.css?v=20261119-stage13';
      document.head.append(style);
    }
    const root=document.createElement('section');
    root.id='dungeon-map-view';root.hidden=true;
    root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
    root.setAttribute('aria-label','合作副本地圖預覽');
    root.innerHTML='<div class="dm-shell">'+
      '<header class="dm-head"><div><small>青雲問道 · 秘境探勘</small>'+
      '<h2 data-dm-title>秘境地圖</h2></div><div class="dm-head-actions">'+
      '<span class="dm-battle-clock" data-dm-clock role="timer" aria-live="off">等待集結</span>'+
      '<button type="button" data-dm="close" aria-label="返回合作副本隊伍">返回隊伍 <span aria-hidden="true">×</span></button></div></header>'+
      '<div class="dm-stage" data-dm-stage>'+
      '<canvas class="dm-world" data-dm-world tabindex="0" aria-label="秘境地圖。可拖曳、雙指縮放，或使用方向鍵移動視角。"></canvas>'+ 
      '<div class="dm-effect-layer" data-dm-effects aria-hidden="true"></div>'+
      '<div class="dm-message" data-dm-message role="status" aria-live="polite">正在取得副本地圖…</div>'+
      '<aside class="dm-biome" data-dm-biome-box hidden><small>秘境地貌</small>'+
      '<strong data-dm-biome>—</strong><span data-dm-summary></span></aside>'+
      '<div class="dm-overview" data-dm-overview hidden aria-hidden="true">'+
      '<canvas data-dm-minimap></canvas><span>全域縮圖</span></div>'+
      '<div class="dm-controls" aria-label="地圖視角控制">'+
      '<button type="button" data-dm="plus" aria-label="放大地圖">＋</button>'+
      '<button type="button" data-dm="minus" aria-label="縮小地圖">－</button>'+
      '<button type="button" data-dm="fit" title="縮放至全圖">全圖</button>'+
      '<button type="button" data-dm="focus" aria-pressed="false" title="定位預留出生點">定位</button>'+
      '<button type="button" data-dm="route" aria-pressed="false" title="顯示路線">路線</button>'+
      '<button type="button" data-dm="beasts" aria-expanded="false">靈獸 0</button>'+
      '</div><aside class="dm-inspector" data-dm-inspector hidden>'+
      '<div class="dm-inspector-head"><strong>靈獸動向</strong>'+
      '<button type="button" data-dm="close-beasts" aria-label="關閉靈獸資料">×</button></div>'+
      '<p data-dm-beast-details role="status">點選靈獸查看行動狀態</p>'+
      '<div class="dm-beast-list" data-dm-beast-list></div>'+
      '<small>紅色方格表示即將遭到攻擊；預告後移出範圍即可閃避。</small></aside>'+
      '<div class="dm-movement" data-dm-movement hidden>'+
      '<div class="dm-energy"><span>探索體力</span><strong data-dm-energy>100 / 100</strong>'+
      '<span class="dm-health" data-dm-health>生命 100/100</span>'+
      '<span data-dm-location>（待命）</span></div>'+
      '<div class="dm-threat" data-dm-threat role="status" aria-live="polite" hidden></div>'+
      '<div class="dm-team-status" data-dm-team-status aria-label="隊友生命狀態"></div>'+
      '<div class="dm-dpad" role="group" aria-label="角色移動，一次一格">'+
      '<button type="button" data-dm="up" aria-label="向上移動一格">↑</button>'+
      '<button type="button" data-dm="left" aria-label="向左移動一格">←</button>'+
      '<button type="button" data-dm="down" aria-label="向下移動一格">↓</button>'+
      '<button type="button" data-dm="right" aria-label="向右移動一格">→</button>'+
      '</div><button type="button" class="dm-quiz-charge" data-dm="quiz" disabled>答題充能 · 隨時作答</button>'+ 
      '<button type="button" class="dm-strike" data-dm="strike" disabled>選擇靈獸後攻擊 · 2 體力</button>'+ 
       '<small data-dm-strike-alert role="status" aria-live="polite"></small>'+ 
       '<small data-dm-move-alert role="status" aria-live="polite"></small></div>'+ 
       '<aside class="dm-manual" data-dm-manual hidden aria-label="副本功法技能">'+
       '<div class="dm-manual-heading"><strong>即時功法</strong><span data-dm-focus></span></div>'+
       '<div class="dm-presets" data-dm-presets></div>'+
       '<div class="dm-skills" data-dm-skills></div>'+
       '<small data-dm-aim>先點擊靈獸或地圖格選擇施法目標</small>'+
       '<small data-dm-skill-alert role="status" aria-live="polite"></small></aside>'+ 
      '<div class="dm-legend" aria-hidden="true">'+
      '<span>● 起點</span><span>◇ 傳送陣</span><span>◆ 守護者</span></div></div>'+
      '<footer class="dm-foot"><span data-dm-status>地圖展示 · 尚未開放移動與戰鬥</span>'+
      '<span data-dm-zoom>100%</span></footer></div>';
    document.body.append(root);
    this.root=root;this.stage=root.querySelector('[data-dm-stage]');
    this.canvas=root.querySelector('[data-dm-world]');
    this.mini=root.querySelector('[data-dm-minimap]');
    this.ctx=this.canvas.getContext('2d',{alpha:false});
    this.quiz=new DungeonQuizPanel(root,{onRoom:room=>{
      if(!this.isCurrent()||room.id!==this.roomId)return;
      this.updateRoom(room);
      window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
        detail:{room}
      }));
    }});
    root.addEventListener('click',event=>{
      const button=event.target.closest('[data-dm]');
      if(button&&root.contains(button)&&!button.disabled)
        this.action(button.dataset.dm,button.dataset.beastId,
          button.dataset.skillId,button.dataset.loadoutIndex);
    });
    root.addEventListener('keydown',event=>this.keyDown(event));
    this.canvas.addEventListener('pointerdown',event=>this.pointerDown(event));
    this.canvas.addEventListener('pointermove',event=>this.pointerMove(event));
    for(const type of ['pointerup','pointercancel','lostpointercapture'])
      this.canvas.addEventListener(type,event=>this.pointerUp(event));
    this.canvas.addEventListener('wheel',event=>this.wheel(event),{passive:false});
    this.canvas.addEventListener('contextmenu',event=>event.preventDefault());
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
  async open({room,playerUid}){
    if(!safeRoom(room?.id)||!room?.members?.[playerUid]||
        playerUid!==getMainUser()?.uid)throw new Error('你不是此副本的有效隊員');
    this.mount();
    if(this.opened&&this.roomId===room.id){
      this.updateRoom(room);
      this.$('[data-dm="close"]')?.focus({preventScroll:true});
      return;
    }
    this.close();
    this.previousFocus=document.activeElement;
    this.room=room;this.roomId=room.id;this.uid=playerUid;
    this.quiz?.attach(room.id,playerUid);
    if(room.status==='assembled')void this.quiz?.warm();
    this.map=null;this.camera=Camera.initialCamera();
    this.follow=false;this.routes=false;this.pointers.clear();this.opened=true;
    this.movePending=false;this.strikePending=false;this.skillPending=false;
    this.loadoutPending=false;this.aimTile=null;this.skillSignature='';
    this.inspectOpen=false;this.selectedBeastId=null;this.followBeast=false;
    this.beastIds='';this.touchOrigins.clear();this.gestureMulti=false;
    clearTimeout(this.longPressTimer);this.longPressTimer=null;
    this.root.hidden=false;
    this.$('[data-dm="focus"]').setAttribute('aria-pressed','false');
    this.$('[data-dm="route"]').setAttribute('aria-pressed','false');
    this.$('[data-dm-biome-box]').hidden=true;
    this.$('[data-dm-overview]').hidden=true;
    this.$('[data-dm="close"]').focus({preventScroll:true});
    if(typeof ResizeObserver==='function'){
      this.observer=new ResizeObserver(()=>this.resize());
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
      const palette=BIOMES[map.biome]||BIOMES.ruins;
      this.root.style.setProperty('--dm-accent',palette.trim);
      this.$('[data-dm-title]').textContent=palette.name+' · 合作副本';
      this.$('[data-dm-biome]').textContent=palette.name;
      this.$('[data-dm-summary]').textContent=
        map.branchCount+' 條支線 · '+map.width+' × '+map.height+' 格';
      this.$('[data-dm-biome-box]').hidden=false;
      this.$('[data-dm-overview]').hidden=false;
      this.camera=Camera.initialCamera();this.alert('');
      this.resize();this.updateMovementHUD();this.updateBeastHUD();
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
    const stamina=Number.isSafeInteger(own?.explorationStamina)?
      own.explorationStamina:100;
    const energy=this.$('[data-dm-energy]');
    if(energy)energy.textContent=stamina+' / 100';
    const p=this.selfPad(),node=this.$('[data-dm-location]');
    if(node)node.textContent='座標 '+p.x+'，'+p.y;
    const hp=Number.isSafeInteger(own?.battleHealth)?
      Math.max(0,own.battleHealth):100;
    const downed=own?.downed===true||hp===0;
    const health=this.$('[data-dm-health]');
    if(health){
      health.textContent=downed?'倒地 · 等待救援':'生命 '+hp+'/100';
      health.classList.toggle('is-critical',hp<=25);
    }
    const threatened=this.creatures().filter(beast=>
      beast?.attack?.cells?.some(tile=>tile.x===p.x&&tile.y===p.y));
    const threat=this.$('[data-dm-threat]');
    if(threat){
      threat.hidden=!threatened.length&&!downed;
      if(downed)threat.textContent='已倒地，請等待後續復活機制';
      else if(threatened.length){
        const fire=Math.min(...threatened.map(beast=>beast.attack.resolvesAtTick));
        const applied=Number(this.room?.battleClock?.appliedTick)||0;
        threat.textContent='危險！'+threatened.length+
          ' 隻靈獸鎖定腳下 · 約 '+Math.max(0,fire-applied)+' 秒後命中，請立即移開';
      }
    }
    const party=this.$('[data-dm-team-status]');
    if(party){
      const friends=this.members();
      party.hidden=friends.length<2||!active;
      if(!party.hidden)party.textContent=friends.map(m=>{
        const value=Number.isSafeInteger(m.battleHealth)?m.battleHealth:100;
        return String(m.name||'修士').slice(0,10)+' '+(m.downed?'倒地':value+' HP');
      }).join(' · ');
    }
    this.root?.querySelectorAll('.dm-dpad button').forEach(button=>{
      button.disabled=!active||!this.map||this.movePending||stamina<1||downed;
    });
    const charge=this.$('[data-dm="quiz"]');
    if(charge)charge.disabled=!active||!this.map;
    this.updateStrikeHUD();this.updateSkillHUD();
  }
  updateStrikeHUD(){
    const button=this.$('[data-dm="strike"]');
    if(!button)return;
    const member=this.room?.members?.[this.uid];
    const target=this.creatures().find(e=>e.id===this.selectedBeastId);
    const current=member?.position;
    const adjacent=target&&current&&
      Math.abs(target.position.x-current.x)+Math.abs(target.position.y-current.y)===1;
    const energy=Number.isSafeInteger(member?.explorationStamina)?
      member.explorationStamina:0;
    button.hidden=Boolean(member?.dungeonSkillIds?.length);
    button.disabled=this.room?.status!=='assembled'||!this.map||
      !adjacent||this.strikePending||member?.downed===true||
      Number(member?.battleHealth)===0||energy<2;
    button.textContent=this.strikePending?'攻擊結算中…':target?
      '攻擊 '+String(target.name||'靈獸').slice(0,8)+' · 2 體力':
      '選擇靈獸後攻擊 · 2 體力';
    button.title=!target?'點擊地圖或靈獸名單選取目標':
      !adjacent?'必須移至目標相鄰一格':'無冷卻，攻擊成功後可再次施放';
  }
  updateSkillHUD(){
    const member=this.room?.members?.[this.uid];
    const panel=this.$('[data-dm-manual]');
    if(!panel)return;
    const active=this.room?.status==='assembled'&&!!this.map;
    const presets=member?.dungeonLoadoutNames||[];
    // The beast inspector and manual controls share the compact left rail.
    // Display only one at a time so neither hides the other's buttons.
    panel.hidden=!active||!presets.length||this.inspectOpen;
    panel.classList.toggle('has-focus',active&&Number(member?.focusCharges)>0);
    if(panel.hidden)return;
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
      const skillRoot=this.$('[data-dm-skills]');
      skillRoot.replaceChildren(...skills.map(skill=>{
        const button=document.createElement('button');
        button.type='button';button.dataset.dm='cast';
        button.dataset.skillId=skill.id;
        button.title=skill.description||'';
        return button;
      }));
    }
    const stamina=Number.isSafeInteger(member.explorationStamina)?
      member.explorationStamina:0;
    const downed=member.downed===true||member.battleHealth===0;
    const charges=Number.isSafeInteger(member.focusCharges)?
      Math.max(0,Math.min(6,member.focusCharges)):0;
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
    this.root.querySelectorAll('[data-dm-skills] button').forEach(button=>{
      const skill=skills.find(v=>v.id===button.dataset.skillId);
      if(!skill)return;
      const empowered=charges>0&&skill.school==='body'&&
        skill.kind!=='fist-focus';
      const cost=empowered?Math.ceil(skill.cost/2):skill.cost;
      // Only actually empowered body attacks turn gold.
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
      button.disabled=this.skillPending||this.loadoutPending||this.movePending||
        downed||stamina<cost||
        (skill.kind!=='fist-focus'&&!aimed);
    });
  }
  currentAim(){
    const beast=this.creatures().find(e=>e.id===this.selectedBeastId);
    return beast?.position||this.aimTile||null;
  }
  targetFor(skill){
    const own=this.room?.members?.[this.uid]?.position;
    if(!own)return null;
    if(skill?.kind==='fist-focus')return {...own};
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
  async cast(skillId){
    const member=this.room?.members?.[this.uid];
    if(!this.isCurrent()||!member||this.skillPending||this.loadoutPending||
      this.room.status!=='assembled')return;
    const skill=member.dungeonSkills?.find(v=>v.id===skillId);
    if(!skill)return;
    const target=this.targetFor(skill);
    if(!target){this.skillAlert('請先選擇同一直線上的目標，或空白地格');return;}
    const seq=(Number.isSafeInteger(member.skillSeq)?member.skillSeq:0)+1;
    const roomId=this.roomId,token=this.seq;
    this.skillPending=true;this.updateSkillHUD();this.skillAlert('');
    try{
      const response=await castDungeonSkill(roomId,skillId,target,seq);
      if(!this.isCurrent()||this.seq!==token||this.roomId!==roomId)return;
      if(response?.room){
        this.updateRoom(response.room);
        window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
          detail:{room:response.room}
        }));
        const result=response.room.members?.[this.uid]?.lastSkill;
        if(result?.seq===seq&&result.skillId===skillId){
          const defeated=result.hits?.filter(hit=>hit.defeated).length||0;
          this.skillAlert(result.focusActivated?
            '✦ 金身蓄勢！六層金色氣勁已凝聚，接下來六招體術體力減半':
            (result.focusEmpowered?'✦ 金身加成 · ':'')+
            result.skillName+' · '+result.totalDamage+
            ' 傷害 · '+(result.hits?.length||0)+' 次命中'+
            (result.focusEmpowered?' · 蓄勢剩餘 '+result.focusCharges+'/6':'')+
            (defeated?' · 擊敗 '+defeated+' 隻':''));
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
      this.skillPending=false;
      if(this.isCurrent()&&this.seq===token)this.updateSkillHUD();
    }
  }
  strikeAlert(message=''){
    const node=this.$('[data-dm-strike-alert]');
    if(node)node.textContent=message;
  }
  async strike(){
    if(!this.isCurrent()||!this.map||this.strikePending||
      this.room?.status!=='assembled')return;
    const member=this.room?.members?.[this.uid];
    const enemy=this.creatures().find(e=>e.id===this.selectedBeastId);
    if(!member||!enemy)return;
    const seq=(Number.isSafeInteger(member.strikeSeq)?member.strikeSeq:0)+1;
    const token=this.seq,roomId=this.roomId;
    this.strikePending=true;this.updateStrikeHUD();this.strikeAlert('');
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
            ' · 剩餘生命 '+result.remainingHealth);
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
      this.strikePending=false;
      if(this.isCurrent()&&token===this.seq)this.updateStrikeHUD();
    }
  }
  moveAlert(message=''){ 
    const node=this.$('[data-dm-move-alert]');
    if(node)node.textContent=message;
  }
  async move(dx,dy){
    if(this.movePending||!this.map||!this.isCurrent()||
      this.room?.status!=='assembled')return;
    const member=this.room.members?.[this.uid];
    if(!member)return;
    const step=(Number.isSafeInteger(member.moveSeq)?member.moveSeq:0)+1;
    const token=this.seq,roomId=this.roomId;
    this.movePending=true;this.updateMovementHUD();this.moveAlert('');
    try{
      const result=await moveDungeonMember(roomId,dx,dy,step);
      if(!this.isCurrent()||token!==this.seq||roomId!==this.roomId)return;
      if(result?.room){
        this.updateRoom(result.room);
        window.dispatchEvent(new CustomEvent('xiuxian:dungeon-room-state',{
          detail:{room:result.room}
        }));
      }
      // Explicit player movement takes precedence over observing a beast.
      this.followBeast=false;
      if(!this.follow){
        this.follow=true;
        this.camera=Camera.zoomAt(this.camera,Math.max(this.camera.zoom,2.6),
          this.width/2,this.height/2,this.map,this.width,this.height);
        this.$('[data-dm="focus"]').setAttribute('aria-pressed','true');
      }
      this.camera=Camera.focusOn(this.camera,this.selfPad(),this.map,
        this.width,this.height);
      this.drawSoon();
    }catch(error){
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
      alert:'警戒',windup:'準備攻擊！',recover:'收招中'};
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
        ' · 生命 '+(selected.battleHealth??'—')+'/'+(selected.battleMaxHealth??'—')+
        (selected.targetUid?' · 已發現修士':'')+
        ' · 節拍 T'+(selected.lastActionTick||0)+
        (selected.attack?' · '+selected.attack.label+
          ' 即將於 T'+selected.attack.resolvesAtTick+' 攻擊（紅格危險）':'')+
        (selected.lastAttack?.hits?.length?' · 最近命中 '+
          selected.lastAttack.hits.length+' 位修士':'');
    }else details.textContent='點選靈獸可查看最新行動';
  }
  selectBeast(id,{focus=true}={}){
    if(!this.map||!this.isCurrent())return;
    const beast=this.creatures().find(e=>e.id===id);
    if(!beast)return;
    this.inspectOpen=true;this.selectedBeastId=beast.id;this.aimTile={...beast.position};
    if(focus){
      this.follow=false;this.followBeast=true;
      this.camera=Camera.zoomAt(this.camera,Math.max(2.4,this.camera.zoom),
        this.width/2,this.height/2,this.map,this.width,this.height);
      this.camera=Camera.focusOn(this.camera,beast.position,this.map,this.width,this.height);
      this.$('[data-dm="focus"]').setAttribute('aria-pressed','false');
    }
    this.updateBeastHUD();this.updateStrikeHUD();this.updateSkillHUD();this.drawSoon();
  }
  inspectAt(screen){
    if(!this.map)return false;
    const g=Camera.geometry(this.camera,this.map,this.width,this.height);
    const closest=this.creatures().map(beast=>({
      beast,distance:Math.hypot(g.ox+(beast.position.x+.5)*g.cell-screen.x,
        g.oy+(beast.position.y+.5)*g.cell-screen.y)
    })).sort((a,b)=>a.distance-b.distance)[0];
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
  updateStatus(){
    const state=this.$('[data-dm-status]');
    if(state)state.textContent=this.room?.status==='assembled'?
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
    this.room=room;
    if(room.status==='assembled')void this.quiz?.warm();
    this.syncClockAnchor(room);
    this.updateStatus();
    if(this.map&&this.follow){
      this.camera=Camera.focusOn(this.camera,this.selfPad(),this.map,this.width,this.height);
    }else if(this.map&&this.followBeast){
      const beast=this.creatures().find(e=>e.id===this.selectedBeastId);
      if(beast)this.camera=Camera.focusOn(this.camera,beast.position,
        this.map,this.width,this.height);
    }
    this.drawSoon();
  }
  close(){
    ++this.seq;this.opened=false;this.pointers.clear();this.movePending=false;
    this.strikePending=false;this.skillPending=false;this.loadoutPending=false;
    this.aimTile=null;this.skillSignature='';
    this.quiz?.destroy();
    for(const aura of this.focusAuras.values())aura.remove();
    this.focusAuras.clear();
    clearTimeout(this.longPressTimer);this.longPressTimer=null;
    this.touchOrigins.clear();this.gestureMulti=false;
    this.inspectOpen=false;this.selectedBeastId=null;
    this.followBeast=false;this.beastIds='';
    clearInterval(this.clockTimer);this.clockTimer=null;this.clockAnchor=null;this.clockTickFloor=0;
    this.observer?.disconnect();this.observer=null;
    window.removeEventListener('resize',this.onResize);
    window.removeEventListener('orientationchange',this.onResize);
    document.removeEventListener('visibilitychange',this.onVisibility);
    if(this.frame)cancelAnimationFrame(this.frame);
    this.frame=0;
    if(this.root)this.root.hidden=true;
    this.map=null;this.room=null;this.roomId='';this.uid='';
    const focus=this.previousFocus;this.previousFocus=null;
    if(focus?.isConnected)focus.focus({preventScroll:true});
  }
  action(name,beastId,skillId,loadoutIndex){
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
    if(!this.map||!this.isCurrent())return;
    const w=this.width,h=this.height,m=this.map;
    switch(name){
      case 'plus':
        this.camera=Camera.zoomAt(this.camera,this.camera.zoom*1.35,w/2,h/2,m,w,h);
        this.follow=false;break;
      case 'minus':
        this.camera=Camera.zoomAt(this.camera,this.camera.zoom/1.35,w/2,h/2,m,w,h);
        this.follow=false;break;
      case 'fit':this.camera=Camera.fitMap();this.follow=false;break;
      case 'focus':
        this.follow=!this.follow;
        if(this.follow){
          this.camera=Camera.zoomAt(this.camera,Math.max(2.5,this.camera.zoom),w/2,h/2,m,w,h);
          this.camera=Camera.focusOn(this.camera,this.selfPad(),m,w,h);
        }break;
      case 'route':this.routes=!this.routes;break;
      default:return;
    }
    if(name!=='route')this.followBeast=false;
    this.$('[data-dm="focus"]').setAttribute('aria-pressed',String(this.follow));
    this.$('[data-dm="route"]').setAttribute('aria-pressed',String(this.routes));
    this.drawSoon();
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
    if(walking[event.key]&&!event.ctrlKey&&!event.altKey&&!event.metaKey){
      event.preventDefault();void this.move(...walking[event.key]);return;
    }
    if(event.target.closest('button'))return;
    const moves={ArrowLeft:[45,0],ArrowRight:[-45,0],ArrowUp:[0,45],ArrowDown:[0,-45]};
    if(moves[event.key]){
      event.preventDefault();this.follow=false;this.followBeast=false;
      this.camera=Camera.pan(this.camera,...moves[event.key],this.map,this.width,this.height);
      this.$('[data-dm="focus"]').setAttribute('aria-pressed','false');this.drawSoon();
    }else if(event.key==='+'||event.key==='='){
      event.preventDefault();this.action('plus');
    }else if(event.key==='-'){event.preventDefault();this.action('minus');}
    else if(event.key==='Home'){event.preventDefault();this.action('fit');}
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
    event.preventDefault();
    const old=[...this.pointers.values()],at=this.pointerPosition(event);
    const origin=this.touchOrigins.get(event.pointerId);
    if(this.pointers.size>1||(origin&&
      Math.hypot(at.x-origin.x,at.y-origin.y)>8)){
      clearTimeout(this.longPressTimer);this.longPressTimer=null;
    }
    this.pointers.set(event.pointerId,at);
    const now=[...this.pointers.values()];
    if(old.length>=2&&now.length>=2){
      const [a,b]=old,[c,d]=now;
      const centerOld={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      const centerNew={x:(c.x+d.x)/2,y:(c.y+d.y)/2};
      const before=Math.hypot(a.x-b.x,a.y-b.y),after=Math.hypot(c.x-d.x,c.y-d.y);
      if(before>3&&after>3)this.camera=Camera.zoomAt(this.camera,
        this.camera.zoom*(after/before),centerOld.x,centerOld.y,
        this.map,this.width,this.height);
      this.camera=Camera.pan(this.camera,centerNew.x-centerOld.x,
        centerNew.y-centerOld.y,this.map,this.width,this.height);
    }else if(old.length===1&&now.length===1){
      this.camera=Camera.pan(this.camera,now[0].x-old[0].x,now[0].y-old[0].y,
        this.map,this.width,this.height);
    }
    this.follow=false;this.followBeast=false;
    this.$('[data-dm="focus"]').setAttribute('aria-pressed','false');
    this.drawSoon();
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
    if(tapped&&this.map&&this.isCurrent()&&!this.inspectAt(at)){
      const g=Camera.geometry(this.camera,this.map,this.width,this.height);
      const p={x:Math.floor((at.x-g.ox)/g.cell),
        y:Math.floor((at.y-g.oy)/g.cell)};
      if(p.x>=0&&p.y>=0&&p.x<this.map.width&&p.y<this.map.height&&
          this.map.tiles[p.y*this.map.width+p.x]>0){
        this.aimTile=p;this.selectedBeastId=null;this.followBeast=false;
        this.updateBeastHUD();this.updateStrikeHUD();this.updateSkillHUD();
        this.drawSoon();
      }
    }
    try{
      if(this.canvas.hasPointerCapture?.(event.pointerId))
        this.canvas.releasePointerCapture(event.pointerId);
    }catch(_){}
  }
  wheel(event){
    if(!this.map||!this.isCurrent())return;
    event.preventDefault();
    const p=this.pointerPosition(event),scale=Math.exp(-clamp(event.deltaY,-180,180)*.002);
    this.camera=Camera.zoomAt(this.camera,this.camera.zoom*scale,p.x,p.y,
      this.map,this.width,this.height);
    this.follow=false;this.followBeast=false;
    this.$('[data-dm="focus"]').setAttribute('aria-pressed','false');
    this.drawSoon();
  }
  resize(){
    if(!this.opened||!this.stage)return;
    const rect=this.stage.getBoundingClientRect();
    const width=Math.max(1,Math.round(rect.width)),height=Math.max(1,Math.round(rect.height));
    if(this.map&&this.width>0&&this.height>0&&(width!==this.width||height!==this.height)){
      this.camera=Camera.resizePreservingCenter(this.camera,this.map,
        this.width,this.height,width,height);
      if(this.follow)this.camera=Camera.focusOn(this.camera,this.selfPad(),this.map,width,height);
    }
    this.width=width;this.height=height;
    const dpr=clamp(window.devicePixelRatio||1,1,2);
    if(this.canvas.width!==Math.round(width*dpr)||this.canvas.height!==Math.round(height*dpr)){
      this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);
    }
    this.ctx?.setTransform(dpr,0,0,dpr,0,0);this.drawSoon();
  }
  updateFocusAuras(geometry){
    const layer=this.$('[data-dm-effects]');
    if(!layer||!this.map||!geometry)return;
    const present=new Set(),members=this.members();
    if(this.room?.status==='assembled'){
      members.forEach((member,index)=>{
        const charges=member?.focusCharges;
        if(!Number.isSafeInteger(charges)||charges<=0||member.downed||
            Number(member.battleHealth)===0)return;
        const pos=member.position||this.map.spawnPads[index];
        if(!pos||!Number.isSafeInteger(pos.x)||!Number.isSafeInteger(pos.y)||
            pos.x<0||pos.y<0||pos.x>=this.map.width||pos.y>=this.map.height||
            this.map.tiles[pos.y*this.map.width+pos.x]===0)return;
        // Exactly match the position offsets of overlapping teammate sprites.
        const companions=members.filter((other,j)=>{
          const q=other.position||this.map.spawnPads[j];
          return q?.x===pos.x&&q?.y===pos.y;
        });
        const slot=Math.max(0,companions.findIndex(x=>x.uid===member.uid));
        const shift=companions.length>1?.22*geometry.cell:0;
        const x=geometry.ox+(pos.x+.5)*geometry.cell+
          shift*(slot%2?1:-1);
        const y=geometry.oy+(pos.y+.5)*geometry.cell+
          shift*(slot>=2?1:-1);
        if(x< -80||x>this.width+80||y< -80||y>this.height+80)return;
        present.add(member.uid);
        let aura=this.focusAuras.get(member.uid);
        if(!aura){
          // GPU-friendly CSS animations: never redraw the full maze on a
          // timer. Sparks and double rings surround, not cover, the avatar.
          aura=document.createElement('div');
          aura.className='dm-focus-aura';
          aura.dataset.focusUid=member.uid;
          aura.innerHTML='<span class="dm-focus-ring"></span>'+
            '<span class="dm-focus-orbit"></span>'+
            '<span class="dm-focus-spark dm-spark-a"></span>'+
            '<span class="dm-focus-spark dm-spark-b"></span>'+
            '<span class="dm-focus-spark dm-spark-c"></span>'+
            '<span class="dm-focus-spark dm-spark-d"></span>'+
            '<span class="dm-focus-count"></span>';
          this.focusAuras.set(member.uid,aura);
          layer.append(aura);
        }
        aura.style.left=x+'px';aura.style.top=y+'px';
        aura.style.setProperty('--dm-focus-size',
          clamp(geometry.cell*1.65,42,104)+'px');
        aura.dataset.charges=String(charges);
        aura.querySelector('.dm-focus-count').textContent=
          member.uid===this.uid?'✦ '+charges:'✦';
        aura.title='蓄勢金身 · 剩餘 '+charges+' 招';
      });
    }
    for(const [uid,aura] of this.focusAuras){
      if(!present.has(uid)){aura.remove();this.focusAuras.delete(uid);}
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
    const geometry=drawWorld(ctx,m,this.camera,w,h,{
      members:this.members(),selfUid:this.uid,showRoutes:this.routes,
      enemies:this.creatures(),aimTile:this.currentAim(),
      currentTick:Number(this.room?.battleClock?.appliedTick)||0,
      visualTimeMs:performance.now()
    });
    this.updateFocusAuras(geometry);
    const mini=this.mini,miniBounds=mini.getBoundingClientRect();
    const mw=Math.max(1,Math.round(miniBounds.width)),mh=Math.max(1,Math.round(miniBounds.height));
    const dpr=clamp(window.devicePixelRatio||1,1,2);
    if(mini.width!==Math.round(mw*dpr)||mini.height!==Math.round(mh*dpr)){
      mini.width=Math.round(mw*dpr);mini.height=Math.round(mh*dpr);
    }
    const miniCtx=mini.getContext('2d');
    if(miniCtx){
      miniCtx.setTransform(dpr,0,0,dpr,0,0);
      drawMinimap(miniCtx,m,geometry,mw,mh,{
        members:this.members(),selfUid:this.uid,enemies:this.creatures()
      });
    }
    this.$('[data-dm-zoom]').textContent=Math.round(this.camera.zoom*100)+'%';
  }
}
export async function showDungeonMap(options){
  if(!viewer)viewer=new DungeonMapView();
  return viewer.open(options);
}
export function hideDungeonMap(){viewer?.close();}
export function updateDungeonMapRoom(room){viewer?.updateRoom(room);}

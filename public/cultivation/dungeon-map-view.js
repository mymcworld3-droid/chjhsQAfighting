import * as Camera from './dungeon-map-camera.js';
import { BIOMES, drawWorld, drawMinimap } from './dungeon-map-painter.js';
import { getDungeonMap, moveDungeonMember, getDungeonRoom } from './dungeon-room.js';
import { getMainUser } from './data/project-repository.js';

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
    this.map=null;this.room=null;this.roomId='';this.uid='';
    this.camera=Camera.initialCamera();this.follow=false;this.routes=false;
    this.opened=false;this.seq=0;this.pointers=new Map();this.movePending=false;
    this.width=0;this.height=0;this.frame=0;this.observer=null;this.previousFocus=null;
    this.clockTimer=null;this.clockAnchor=null;this.clockTickFloor=0;
    this.onResize=()=>this.resize();
    this.onVisibility=()=>{if(!document.hidden&&this.opened)this.resize();};
  }
  mount(){
    if(this.root)return;
    if(!document.getElementById('dungeon-map-view-style')){
      const style=document.createElement('link');
      style.id='dungeon-map-view-style';style.rel='stylesheet';
      style.href='/styles/dungeon-map-view.css?v=20261119-stage8';
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
      '</div><div class="dm-movement" data-dm-movement hidden>'+
      '<div class="dm-energy"><span>探索體力</span><strong data-dm-energy>100 / 100</strong>'+
      '<span data-dm-location>（待命）</span></div>'+
      '<div class="dm-dpad" role="group" aria-label="角色移動，一次一格">'+
      '<button type="button" data-dm="up" aria-label="向上移動一格">↑</button>'+
      '<button type="button" data-dm="left" aria-label="向左移動一格">←</button>'+
      '<button type="button" data-dm="down" aria-label="向下移動一格">↓</button>'+
      '<button type="button" data-dm="right" aria-label="向右移動一格">→</button>'+
      '</div><small data-dm-move-alert role="status" aria-live="polite"></small></div>'+
      '<div class="dm-legend" aria-hidden="true">'+
      '<span>● 起點</span><span>◇ 傳送陣</span><span>◆ 守護者</span></div></div>'+
      '<footer class="dm-foot"><span data-dm-status>地圖展示 · 尚未開放移動與戰鬥</span>'+
      '<span data-dm-zoom>100%</span></footer></div>';
    document.body.append(root);
    this.root=root;this.stage=root.querySelector('[data-dm-stage]');
    this.canvas=root.querySelector('[data-dm-world]');
    this.mini=root.querySelector('[data-dm-minimap]');
    this.ctx=this.canvas.getContext('2d',{alpha:false});
    root.addEventListener('click',event=>{
      const button=event.target.closest('[data-dm]');
      if(button&&root.contains(button)&&!button.disabled)this.action(button.dataset.dm);
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
    this.map=null;this.camera=Camera.initialCamera();
    this.follow=false;this.routes=false;this.pointers.clear();this.opened=true;this.movePending=false;
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
      this.resize();this.updateMovementHUD();
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
    this.root?.querySelectorAll('.dm-dpad button').forEach(button=>{
      button.disabled=!active||!this.map||this.movePending||stamina<1;
    });
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
    const seconds=Math.floor(duration/1000);
    const h=Math.floor(seconds/3600),m=Math.floor(seconds/60)%60,s=seconds%60;
    const display=(h?String(h)+':':'')+
      String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
    const tick=Math.max(this.clockTickFloor,Math.floor(duration/clock.tickMs));
    node.textContent='戰場時鐘 '+display+' · T'+tick;
    node.title='由伺服器時間校準；玩家操作或離開地圖不會暫停';
  }
  updateStatus(){
    const state=this.$('[data-dm-status]');
    if(state)state.textContent=this.room?.status==='assembled'?
      '探索中 · WASD 或方向按鈕移動，1 格耗費 1 體力 · 尚無戰鬥':
      '等待隊伍集結 · 地圖預覽不消耗體力';
    this.updateMovementHUD();
  }
  updateRoom(room){
    if(!this.opened)return;
    if(!room||room.id!==this.roomId||!room.members?.[this.uid]||
      !['waiting','assembled'].includes(room.status)){
      this.close();return;
    }
    if(Number(room.revision)<Number(this.room?.revision||0))return;
    this.room=room;
    this.syncClockAnchor(room);
    this.updateStatus();
    if(this.map&&this.follow){
      this.camera=Camera.focusOn(this.camera,this.selfPad(),this.map,this.width,this.height);
    }
    this.drawSoon();
  }
  close(){
    ++this.seq;this.opened=false;this.pointers.clear();this.movePending=false;
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
  action(name){
    if(name==='close'){this.close();return;}
    if(name==='retry'){void this.load();return;}
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
    this.$('[data-dm="focus"]').setAttribute('aria-pressed',String(this.follow));
    this.$('[data-dm="route"]').setAttribute('aria-pressed',String(this.routes));
    this.drawSoon();
  }
  keyDown(event){
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
      event.preventDefault();this.follow=false;
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
    this.pointers.set(event.pointerId,this.pointerPosition(event));
  }
  pointerMove(event){
    if(!this.map||!this.isCurrent()||!this.pointers.has(event.pointerId))return;
    event.preventDefault();
    const old=[...this.pointers.values()];
    this.pointers.set(event.pointerId,this.pointerPosition(event));
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
    this.follow=false;this.$('[data-dm="focus"]').setAttribute('aria-pressed','false');
    this.drawSoon();
  }
  pointerUp(event){
    this.pointers.delete(event.pointerId);
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
    this.follow=false;this.$('[data-dm="focus"]').setAttribute('aria-pressed','false');
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
      members:this.members(),selfUid:this.uid,showRoutes:this.routes
    });
    const mini=this.mini,miniBounds=mini.getBoundingClientRect();
    const mw=Math.max(1,Math.round(miniBounds.width)),mh=Math.max(1,Math.round(miniBounds.height));
    const dpr=clamp(window.devicePixelRatio||1,1,2);
    if(mini.width!==Math.round(mw*dpr)||mini.height!==Math.round(mh*dpr)){
      mini.width=Math.round(mw*dpr);mini.height=Math.round(mh*dpr);
    }
    const miniCtx=mini.getContext('2d');
    if(miniCtx){
      miniCtx.setTransform(dpr,0,0,dpr,0,0);
      drawMinimap(miniCtx,m,geometry,mw,mh,{members:this.members(),selfUid:this.uid});
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

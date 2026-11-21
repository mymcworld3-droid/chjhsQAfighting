import {
  createDungeonRoom,joinDungeonRoomByCode,getDungeonRoom,reconnectDungeonRoom,
  leaveDungeonRoom,listPublicDungeonRooms,joinPublicDungeonRoom,quickJoinDungeonRoom,
  setDungeonRoomVisibility,inviteDungeonFriends,setDungeonReady,kickDungeonMember,
  disbandDungeonRoom,assembleDungeonRoom,cancelDungeonAssembly,
  subscribeDungeonRoom,heartbeatDungeonRoom
} from './dungeon-room.js';
import { getMainUser } from './data/project-repository.js';
import { showDungeonMap, hideDungeonMap, updateDungeonMapRoom } from './dungeon-map-view.js?v=20261121-rightwheel-v4';
import { listRecentDungeonVictories, claimDungeonBossReward } from './dungeon-room.js';

// Only the lobby is implemented here. The server controls all membership,
// readiness, host and assembly decisions. No battle or reward state lives here.
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);
const roomCode=value=>String(value||'').trim().toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,6);
const safeRoomId=value=>/^[A-Za-z0-9_-]{8,160}$/.test(String(value||''))?String(value):'';
const nameOf=member=>member?.name||'無名修士';
const localUser=()=>getMainUser()?.uid||'';
let entry,root,body,notice,open=false,room=null,account='',pending=false,refreshing=false,initializing=false;
let list=[],listLoading=false,lastListAt=0,clock=null,requestSerial=0,initialFocus=null,roomRevision=-1;
let streamStop=null,streamRoomId='',streamConnected=false,heartbeatBusy=false,lastHeartbeatAt=0;
let fallbackFailures=0,nextFallbackAt=0,roomViewSignature='';
let emptyRoomCheckAt=0,emptyRoomBusy=false,autoPreviewRoomId='';
let recentVictories=[],victoryRequestSeq=0;
const HEARTBEAT_MS=20000,PRESENCE_STALE_MS=60000;
const $=selector=>root?.querySelector(selector);
function loadStyle(){
  if(document.getElementById('dungeon-lobby-style'))return;
  const link=document.createElement('link');
  link.id='dungeon-lobby-style';link.rel='stylesheet';
  link.href='/styles/dungeon-lobby.css?v=20261118-stage3';
  document.head.append(link);
}
function mount(){
  if(root)return;
  loadStyle();
  root=document.createElement('section');
  root.id='dungeon-lobby';root.hidden=true;
  root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
  root.setAttribute('aria-label','合作副本隊伍');
  root.innerHTML='<div class="dg-shell"><header class="dg-header"><div><small>青雲問道 · 多人探索</small>'+
    '<h2>合作副本</h2></div><button type="button" data-dg="close" aria-label="收起合作副本">×</button></header>'+
    '<p class="dg-notice" role="status" aria-live="polite" data-dg-notice hidden></p>'+
    '<div class="dg-body" data-dg-body></div></div>';
  document.body.append(root);
  body=$('[data-dg-body]');notice=$('[data-dg-notice]');
  root.addEventListener('click',handleClick);
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key==='Enter'&&event.target.matches('[data-dg-code]')){
      event.preventDefault();void joinCode();
    }
    if(event.key==='Tab'){
      const controls=[...root.querySelectorAll('button:not(:disabled),input:not(:disabled)')]
        .filter(el=>el.getClientRects().length>0);
      if(!controls.length)return;
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){
        event.preventDefault();last.focus();
      }else if(!event.shiftKey&&document.activeElement===last){
        event.preventDefault();first.focus();
      }
    }
  });
}
function entryMount(){
  const target=document.querySelector('#page-gameplay .gameplay-entries');
  if(!target||document.getElementById('gameplay-dungeon-entry'))return;
  entry=document.createElement('button');
  entry.type='button';entry.id='gameplay-dungeon-entry';entry.className='gameplay-dungeon-entry';
  entry.innerHTML='<i class="fa-solid fa-people-group" aria-hidden="true"></i>'+
    '<span><strong>合作副本</strong><small>1～4 人組隊 · 秘境集結</small></span>'+
    '<i class="fa-solid fa-chevron-right" aria-hidden="true"></i>';
  entry.addEventListener('click',()=>{void openLobby();});
  target.append(entry);
}
function announce(message=''){
  if(!notice)return;
  notice.textContent=message;
  notice.hidden=!message;
}
function stopRoomStream(){
  const stop=streamStop;
  streamStop=null;streamRoomId='';streamConnected=false;
  stop?.();
}
function clearRoom(){
  hideDungeonMap();
  autoPreviewRoomId='';
  room=null;roomRevision=-1;roomViewSignature='';
  stopRoomStream();
  fallbackFailures=0;nextFallbackAt=0;lastHeartbeatAt=0;
}
function roomSignature(next){
  const members=Object.entries(next?.members||{}).sort(([a],[b])=>a.localeCompare(b))
    .map(([uid,m])=>[uid,m.name,m.realm,m.ready,m.joinedAtMs]);
  const explored=Object.values(next?.members||{}).some(m=>Number(m.moveSeq)>0);
  return JSON.stringify([next?.id,next?.revision===undefined?null:next?.status,
    next?.hostUid,next?.visibility,next?.code,next?.assembledAtMs,explored,
    next?.dungeonProgress?.portalStatus||null,next?.dungeonArena||null,
    next?.bossEncounter?.status||null,members]);
}
function memberOnline(member){
  const last=Number(member?.heartbeatAtMs)||0;
  return last>0&&Date.now()-last<=PRESENCE_STALE_MS;
}
function renderPresence(){
  if(!root||!open||!room)return;
  root.querySelectorAll('[data-dg-presence]').forEach(node=>{
    const member=room.members?.[node.dataset.dgPresence];
    const online=memberOnline(member);
    node.textContent=online?'在線':'離線';
    node.classList.toggle('is-online',online);
  });
  const label=$('[data-dg-sync]');
  if(label){
    label.textContent=streamConnected?'即時同步':'重新連線中';
    label.dataset.online=String(streamConnected);
  }
}
function validSession(uid,serial){return open&&uid===account&&localUser()===uid&&serial===requestSerial;}
function markBusy(value){
  pending=value;
  if(root)root.querySelectorAll('button:not([data-dg="close"])').forEach(button=>{
    button.disabled=value || button.dataset.dgDisabled==='true';
  });
}
// Read-only inbox: the server verifies C's saved victory and A's reward
// receipt. This is not client-generated loot or an unverified toast.
function renderVictoryHistory(){
  if(!recentVictories.length)return '';
  const visible=recentVictories.slice(0,6);
  const pendingCount=recentVictories.filter(v=>!v.claimed).length;
  return '<section class="dg-victory-history" data-dg-victories>'+
    '<div class="dg-section-heading"><h3>副本勝利紀錄</h3><span>'+
    (pendingCount?pendingCount+' 筆待領取':'獎勵已入帳')+'</span></div>'+
    visible.map(v=>{
      const id=safeRoomId(v.roomId);
      if(!id)return '';
      const date=Number.isFinite(Number(v.archivedAtMs))&&Number(v.archivedAtMs)>0?
        new Date(Number(v.archivedAtMs)).toLocaleDateString('zh-TW'):'近期';
      return '<div class="dg-victory-row"><div><strong>玄炎鎮殿 · '+
        esc(date)+'</strong><small>'+Math.max(1,Math.min(4,Number(v.partySize)||1))+
        ' 人合作 · 120 靈石＋3 修為 · '+
        (v.claimed?'已領取':'可補領')+
        (v.manualDrop?.name?' · 功法《'+esc(v.manualDrop.name)+'》':'')+
        '</small></div>'+
        (v.claimed?'<span class="dg-victory-claimed">✓ 已入帳</span>':
          '<button data-dg="claim-recovered" data-room-id="'+id+
          '">領取獎勵</button>')+'</div>';
    }).join('')+'</section>';
}
async function refreshVictories(){
  if(!open||!account)return;
  const uid=account,serial=requestSerial,ticket=++victoryRequestSeq;
  try{
    const rows=await listRecentDungeonVictories();
    if(!validSession(uid,serial)||ticket!==victoryRequestSeq)return;
    recentVictories=rows.filter(row=>safeRoomId(row.roomId)).slice(0,16);
    if(!initializing)render();
  }catch(_){
    // Prior builds of a server instance may not yet support the new action.
    // Keep the lobby usable and allow retrying on the next open/claim.
  }
}
async function claimRecovered(roomId){
  if(pending||initializing||!open||!safeRoomId(roomId))return;
  const uid=account,serial=requestSerial;
  markBusy(true);announce('正在驗證勝利並將獎勵存入角色帳號…');
  try{
    const result=await claimDungeonBossReward(roomId);
    if(!validSession(uid,serial))return;
    announce(result?.reward?.status==='duplicate'?
      '這場勝利先前已領取，不會重複發放。':
      '副本獎勵已入帳：120 靈石、3 修為'+
        (result?.reward?.manualDrop?.name?
          '，獲得功法《'+result.reward.manualDrop.name+'》！':'（本場未掉落新功法）')+'。');
    await refreshVictories();
  }catch(error){
    if(validSession(uid,serial))announce(error?.message||'暫時無法領取，請稍後再試');
  }finally{
    if(validSession(uid,serial))markBusy(false);
  }
}
function renderHome(){
  const count=list.length;
  body.innerHTML='<div class="dg-intro"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i>'+
    '<div><h3>秘境集結</h3><p>召集道友、隨時答題充能，一起深入秘境挑戰守鑰靈獸與玄炎鎮殿獸。</p></div></div>'+
    renderVictoryHistory()+
    '<div class="dg-actions"><button class="dg-primary" data-dg="quick">快速組隊</button>'+
    '<button data-dg="create">建立私人隊伍</button>'+
    '<button data-dg="create-public">建立公開隊伍</button></div>'+
    '<div class="dg-join"><label for="dg-room-code">加入好友隊伍</label>'+
    '<div><input id="dg-room-code" data-dg-code maxlength="6" placeholder="六碼隊伍代碼" autocomplete="off" spellcheck="false">'+
    '<button data-dg="join-code">加入隊伍</button></div></div>'+
    '<section class="dg-recruit"><div class="dg-section-heading"><h3>公開隊伍</h3>'+
    '<button data-dg="refresh-list" aria-label="刷新公開隊伍">刷新 <i class="fa-solid fa-rotate-right" aria-hidden="true"></i></button></div>'+
    '<div data-dg-list></div></section>';
  renderList();
}
function renderList(){
  const target=$('[data-dg-list]');if(!target)return;
  target.innerHTML=list.length?list.map(r=>{
    const id=safeRoomId(r.roomId);
    if(!id)return '';
    const count=Math.max(0,Math.min(4,Number(r.playerCount)||0));
    return '<div class="dg-public-row"><div><strong>'+esc(r.hostName||'修士')+'</strong>'+
      '<small>'+count+' / 4 人 · '+Math.max(0,Number(r.readyCount)||0)+' 人已準備</small></div>'+
      '<button data-dg="join-public" data-room-id="'+id+'" '+(count>=4?'disabled':'')+
      '>加入</button></div>';
  }).join(''):'<p class="dg-empty">'+(listLoading?'正在搜尋公開隊伍…':'目前沒有可加入的公開隊伍，可以自行建立。')+'</p>';
}
function renderRoom(){
  if(!room)return renderHome();
  const assembled=room.status==='assembled',memberList=Object.values(room.members||{})
    .sort((a,b)=>a.joinedAtMs-b.joinedAtMs||String(a.uid).localeCompare(String(b.uid)));
  const host=room.hostUid===account,me=room.members?.[account];
  if(!me){clearRoom();return renderHome();}
  const readyCount=memberList.filter(member=>member.ready===true).length;
  const exploring=assembled&&memberList.some(member=>Number(member.moveSeq)>0);
  const fullyReady=memberList.length>0&&readyCount===memberList.length;
  const objective=room.dungeonProgress;
  const portalReady=assembled&&room.dungeonArena!=='boss'&&
    objective?.portalStatus==='open'?room.bossPortalReady:null;
  const portalReadyCount=Number(portalReady?.readyCount)||0;
  const portalRequired=Number(portalReady?.requiredCount)||0;
  const portalOffline=Number(portalReady?.offlineCount)||0;
  const portalVotes=portalReady?.readyUids||[];
  const mission=room.dungeonArena==='boss'?
    (room.bossEncounter?.status==='defeated'?
      '玄炎鎮殿獸已被全隊擊敗！可一鍵領獎並離場，也可以日後從副本入口補領。':
      '已進入玄炎鎮殿首領戰，請留意紅色預告格、維持生命與體力。'):
    objective?.portalStatus==='open'?
    '傳送門已啟動，前往傳送陣分別確認首領戰準備（'+
      portalReadyCount+'/'+portalRequired+' 人已確認）'+
      (portalOffline?'；'+portalOffline+' 人離線逾一分鐘暫不計入':'')+
      '。在線隊員全部確認後才會共同傳送。':
    objective?.portalStatus==='ready'?
    '全隊已取得密鑰，前往深處傳送陣啟動入口。':
    objective?.portalStatus==='sealed'?
    '探索深處，擊敗鎮鑰玄甲獸，取得共享密鑰。':
    '請重新集結，以開啟新版守鑰任務。';
  const members=memberList.map(member=>{
    const leader=member.uid===room.hostUid,isMe=member.uid===account;
    const readyNow=portalReady?portalVotes.includes(member.uid):member.ready===true;
    const readyLabel=portalReady?
      (!member.online?'離線待機':readyNow?'已確認首領戰':'尚未確認'):
      assembled?(room.dungeonArena==='boss'?'首領戰中':'探索中'):
      readyNow?'已準備':'未準備';
    return '<article class="dg-member"><span class="dg-avatar" aria-hidden="true">'+
      (leader?'<i class="fa-solid fa-crown"></i>':'<i class="fa-solid fa-user"></i>')+'</span>'+
      '<span class="dg-member-body"><strong>'+esc(nameOf(member))+
      (isMe?' <em>（你）</em>':'')+'</strong><small>'+esc(member.realm||'凡人')+'境'+
      (leader?' · 隊長':'')+'</small><small class="dg-presence" data-dg-presence="'+esc(member.uid)+'"></small></span>'+
      '<span class="dg-ready '+(readyNow?'is-ready':'')+'">'+
      readyLabel+'</span>'+
      (host&&!leader&&!assembled?'<button class="dg-kick" data-dg="kick" data-target-uid="'+esc(member.uid)+
      '" aria-label="將 '+esc(nameOf(member))+' 移出隊伍">移除</button>':'')+'</article>';
  }).join('');
  body.innerHTML='<div class="dg-room-status"><div><small>副本隊伍 · '+(assembled?'已集結':'等待集結')+'</small>'+
    '<h3>'+esc(room.visibility==='public'?'公開隊伍':'私人隊伍')+'</h3></div>'+
    '<span class="dg-team-count">'+memberList.length+' / 4 人</span>'+
    '<span class="dg-sync" data-dg-sync role="status"></span></div>'+
    '<div class="dg-room-code"><span>邀請代碼 <strong>'+esc(room.code)+'</strong></span>'+
    '<button data-dg="copy">複製</button></div>'+
    '<div class="dg-section-heading"><h3>隊伍成員</h3><span>'+
    (portalReady?portalReadyCount+' / '+portalRequired+' 已確認首領戰':
      assembled?'共同探索中':readyCount+' / '+memberList.length+' 已準備')+
    '</span></div>'+
    '<div class="dg-members">'+members+'</div>'+
    (assembled?'<p class="dg-assembled" role="status"><i class="fa-solid fa-check-circle"></i> 探索進行中 · '+esc(mission)+
      ' 可隨時答題充能、施放功法或移動（一格耗 1 體力），靈獸依伺服器時鐘自行行動。</p>':
      '<p class="dg-helper">隊員各自確認準備。全員準備後，隊長才能確認集結出發。</p>')+
    renderVictoryHistory()+
    '<section class="dg-map-teaser"><div><strong><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i> 秘境地圖</strong>'+
    '<small>四種地貌 · 蜿蜒主線與支線 · 支援雙指縮放</small></div>'+
    '<button data-dg="preview-map" aria-label="檢視合作副本地圖">'+
    (assembled?'進入探索':'預覽地圖')+'</button></section>'+
    '<div class="dg-actions dg-room-actions">'+
    (!assembled?'<button class="dg-primary" data-dg="ready">'+(me.ready?'取消準備':'我已準備')+'</button>':'')+
    (host&&!assembled?'<button data-dg="assemble" '+(!fullyReady?'disabled':'')+
      ' data-dg-disabled="'+(!fullyReady)+'">確認集結出發</button>':'')+
    (host&&assembled&&!exploring?'<button data-dg="cancel-assemble">返回等待室</button>':'')+
    (host&&!assembled?'<button data-dg="visibility">'+(room.visibility==='public'?'改為私人':'開放招募')+'</button>':'')+
    (host&&!assembled?'<button data-dg="invite">邀請好友</button>':'')+
    (assembled&&room.dungeonArena==='boss'&&room.bossEncounter?.status==='defeated'?
      '<button class="dg-finish" data-dg="settle-and-leave">'+
      '✦ 領取獎勵並離開副本</button>':'')+
    '<button data-dg="leave">離開隊伍</button>'+
    (host?'<button class="dg-danger" data-dg="disband">解散隊伍</button>':'')+'</div>';
  // A room refresh must not erase a recent operation result or error.
  renderPresence();
}
function render(){
  if(!root||!open)return;
  const top=body.scrollTop;
  if(initializing){
    // Keep invitation/code inputs out of the DOM until the first reconnect
    // resolves; otherwise its late response can replace a code being typed.
    body.innerHTML='<div class="dg-intro" role="status"><div><h3>正在恢復副本隊伍…</h3>'+
      '<p>確認帳號及隊伍狀態後，即可建立或加入隊伍。</p></div></div>';
  }else if(room)renderRoom();
  else renderHome();
  markBusy(pending);
  body.scrollTop=top;
}
async function previewDungeonMap(){
  if(!room||!open||!room.members?.[account])return;
  const uid=account,serial=requestSerial,current=room;
  try{
    await showDungeonMap({room:current,playerUid:uid});
  }catch(error){
    if(validSession(uid,serial)&&room?.id===current.id)
      announce(error?.message||'目前無法檢視秘境地圖');
  }
}
function acceptRoom(next){
  if(!next||!safeRoomId(next.id))return false;
  const oldRoomId=room?.id,oldStatus=room?.status;
  const newVictory=room?.bossEncounter?.status!=='defeated'&&
    next?.bossEncounter?.status==='defeated';
  const revision=Number(next.revision);
  if(!Number.isFinite(revision))return false;
  if(room?.id===next.id&&revision<roomRevision)return false;
  if(room?.id!==next.id){
    stopRoomStream();
    fallbackFailures=0;nextFallbackAt=0;lastHeartbeatAt=0;
  }
  const signature=roomSignature(next);
  const needsRender=signature!==roomViewSignature;
  room=next;roomRevision=revision;roomViewSignature=signature;
  updateDungeonMapRoom(next);
  if(next.status==='waiting'&&oldStatus==='assembled')autoPreviewRoomId='';
  if(needsRender)render();
  else renderPresence();
  startRoomStream();
  if(newVictory)void refreshVictories();
  // The assembled state is a view-only entry until multiplayer movement
  // arrives. Each device opens its own local preview once per assembly.
  if(next.status==='assembled'&&autoPreviewRoomId!==next.id){
    autoPreviewRoomId=next.id;
    const uid=account,serial=requestSerial,roomId=next.id;
    queueMicrotask(()=>{
      if(validSession(uid,serial)&&room?.id===roomId&&room.status==='assembled')
        void previewDungeonMap();
    });
  }
  return true;
}
function streamInvalidated(error,roomId){
  if(!room||room.id!==roomId)return;
  clearRoom();
  announce(error?.message||'隊伍已關閉或你已離開');
  render();
  void refreshList({force:true});
}
function startRoomStream(){
  if(!open||document.hidden||!room?.id||streamRoomId===room.id)return;
  stopRoomStream();
  const uid=account,serial=requestSerial,id=room.id;
  streamRoomId=id;
  streamStop=subscribeDungeonRoom(id,
    next=>{
      if(!validSession(uid,serial)||room?.id!==id)return;
      acceptRoom(next);
    },
    error=>{
      if(!validSession(uid,serial)||room?.id!==id)return;
      if([401,403,404,410].includes(error?.status))return streamInvalidated(error,id);
      // Fall back to verified GETs while the independent SSE connection retries.
      streamConnected=false;renderPresence();
    },
    connected=>{
      if(!validSession(uid,serial)||room?.id!==id)return;
      streamConnected=connected;
      if(connected){fallbackFailures=0;nextFallbackAt=0;}
      renderPresence();
      if(!connected)void refreshRoom();
    });
}
async function sendHeartbeat({force=false}={}){
  if(!open||document.hidden||!room?.id||heartbeatBusy||pending)return;
  const now=Date.now();
  if(!force&&now-lastHeartbeatAt<HEARTBEAT_MS)return;
  lastHeartbeatAt=now;heartbeatBusy=true;
  const uid=account,serial=requestSerial,id=room.id;
  try{
    await heartbeatDungeonRoom(id);
  }catch(error){
    if(!validSession(uid,serial)||room?.id!==id)return;
    if([401,403,404,410].includes(error?.status))streamInvalidated(error,id);
    else {streamConnected=false;renderPresence();}
  }finally{heartbeatBusy=false;}
}
async function refreshList({force=false}={}){
  if(!open||room||listLoading||(!force&&Date.now()-lastListAt<12000))return;
  listLoading=true;renderList();
  const uid=account,serial=requestSerial;
  try{
    const response=await listPublicDungeonRooms();
    if(validSession(uid,serial)&&!room)list=response.filter(r=>safeRoomId(r.roomId));
  }catch(error){
    if(validSession(uid,serial))announce(error?.message||'公開隊伍載入失敗');
  }finally{
    if(validSession(uid,serial)){lastListAt=Date.now();listLoading=false;renderList();}
  }
}
async function refreshRoom({force=false}={}){
  if(!open||refreshing||pending||!room?.id||(!force&&streamConnected))return;
  if(!force&&Date.now()<nextFallbackAt)return;
  refreshing=true;
  const uid=account,serial=requestSerial,roomId=room.id;
  try{
    const result=await getDungeonRoom(roomId);
    if(!validSession(uid,serial)||room?.id!==roomId)return;
    fallbackFailures=0;nextFallbackAt=0;
    if(result.room)acceptRoom(result.room);
  }catch(error){
    if(!validSession(uid,serial)||room?.id!==roomId)return;
    if([401,403,404,410].includes(error?.status)){
      streamInvalidated(error,roomId);
    }else{
      fallbackFailures++;
      nextFallbackAt=Date.now()+Math.min(30000,5000*2**Math.min(3,fallbackFailures-1));
      announce('即時連線中斷，正在透過安全補查恢復隊伍資訊。');
    }
  }finally{refreshing=false;}
}
// A teammate may accept a room invite on another device while this tab is
// showing the recruitment screen. Check the server-side membership pointer
// occasionally, without continuously polling an already subscribed room.
async function refreshRemoteMembership({force=false}={}){
  if(!open||document.hidden||room||emptyRoomBusy||pending)return;
  if(!force&&Date.now()-emptyRoomCheckAt<20000)return;
  const uid=account,serial=requestSerial;
  emptyRoomBusy=true;emptyRoomCheckAt=Date.now();
  try{
    const result=await reconnectDungeonRoom();
    if(!validSession(uid,serial)||room||!result?.room)return;
    acceptRoom(result.room);
    announce('已恢復其他裝置或邀請加入的副本隊伍。');
    void sendHeartbeat({force:true});
  }catch(error){
    if(validSession(uid,serial)&&!room&&error?.status===401)
      announce('登入狀態已過期，請重新登入。');
  }finally{emptyRoomBusy=false;}
}
function poll(){
  if(!open)return;
  // Do not keep showing another account's private room after account switch.
  if(localUser()!==account){close();clearRoom();list=[];return;}
  if(document.hidden||initializing)return;
  if(room){
    if(!streamStop)startRoomStream();
    void sendHeartbeat();
    if(!streamConnected)void refreshRoom();
    renderPresence();
  }else{
    void refreshList();
    void refreshRemoteMembership();
  }
}
async function openLobby(){
  const uid=localUser();
  if(open&&uid===account){root?.querySelector('[data-dg="close"]')?.focus();return;}
  if(open)close();if(!uid){window.showToast?.('請先登入後再進入合作副本');return;}
  if(document.getElementById('tactical-combat')?.hidden===false||
     window.isXiuxianBattleInviteBlocked?.()||window.isXiuxianRaidInviteBlocked?.()){
    window.showToast?.('請先離開目前的戰鬥，再進入合作副本');return;
  }
  mount();account=uid;open=true;requestSerial++;initializing=true;
  recentVictories=[];victoryRequestSeq++;
  clearRoom();list=[];listLoading=false;refreshing=false;heartbeatBusy=false;lastListAt=0;pending=false;
  emptyRoomCheckAt=Date.now();emptyRoomBusy=false;
  initialFocus=document.activeElement;
  root.hidden=false;root.querySelector('[data-dg="close"]')?.focus({preventScroll:true});
  announce('正在恢復隊伍資訊…');render();
  clearInterval(clock);clock=setInterval(poll,5000);
  const serial=requestSerial;
  try{
    const result=await reconnectDungeonRoom();
    if(!validSession(uid,serial))return;
    initializing=false;announce('');
    if(result.room){
      acceptRoom(result.room);
      void sendHeartbeat({force:true});
    }else{
      clearRoom();render();
      void refreshList({force:true});
    }
    void refreshVictories();
  }catch(error){
    if(validSession(uid,serial)){initializing=false;announce(error?.message||'目前無法連線至副本隊伍');render();}
  }
}
function close(){
  hideDungeonMap();
  if(!open)return;
  open=false;requestSerial++;initializing=false;clearInterval(clock);clock=null;
  stopRoomStream();
  root.hidden=true;announce('');
  const target=initialFocus;initialFocus=null;
  if(target?.isConnected)target.focus({preventScroll:true});
}
async function mutate(operation,{clear=false,message=''}={}){
  if(pending||initializing||!open||!account)return;
  const uid=account,serial=requestSerial;
  markBusy(true);announce('');
  try{
    const result=await operation();
    if(!validSession(uid,serial))return;
    if(clear||!result?.room||result.room.status==='closed'){
      clearRoom();list=[];lastListAt=0;
      announce(message||'已離開隊伍');render();
      void refreshList({force:true});
      void refreshVictories();
    }else{
      acceptRoom(result.room);
      announce(message);
      void sendHeartbeat({force:true});
    }
  }catch(error){
    if(validSession(uid,serial))announce(error?.message||'副本隊伍操作未完成，請重新嘗試');
  }finally{
    if(validSession(uid,serial))markBusy(false);
  }
}
async function joinCode(){
  const value=roomCode($('[data-dg-code]')?.value);
  if(value.length!==6){announce('請輸入六碼隊伍代碼');return;}
  await mutate(()=>joinDungeonRoomByCode(value));
}
async function confirmAction(label,operation,options={}){
  if(pending)return;
  const uid=account,serial=requestSerial,roomId=room?.id;
  const confirmed=typeof window.openConfirm==='function'
    ? await window.openConfirm(label):window.confirm(label);
  if(confirmed!==true||!validSession(uid,serial)||room?.id!==roomId)return;
  await mutate(operation,options);
}
async function handleClick(event){
  const target=event.target.closest('[data-dg]');
  if(!target||!root.contains(target)||target.disabled)return;
  const action=target.dataset.dg;
  if(action==='close')return close();
  if(action==='preview-map')return previewDungeonMap();
  if(pending)return;
  if(action==='create')return mutate(()=>createDungeonRoom('private'));
  if(action==='create-public')return mutate(()=>createDungeonRoom('public'));
  if(action==='quick')return mutate(()=>quickJoinDungeonRoom());
  if(action==='join-code')return joinCode();
  if(action==='refresh-list')return refreshList({force:true});
  if(action==='join-public')return mutate(()=>joinPublicDungeonRoom(safeRoomId(target.dataset.roomId)));
  if(action==='claim-recovered')return claimRecovered(safeRoomId(target.dataset.roomId));
  if(!room?.id)return;
  const roomId=room.id,host=room.hostUid===account;
  if(action==='copy'){
    try{
      await navigator.clipboard.writeText(room.code);
      announce('隊伍代碼已複製');
    }catch(_){announce('請手動複製代碼：'+room.code);}
  }else if(action==='ready')return mutate(()=>setDungeonReady(roomId,room.members?.[account]?.ready!==true));
  else if(action==='assemble'&&host)return mutate(()=>assembleDungeonRoom(roomId),{message:'全隊已集結，現在可以進入秘境移動探索。'});
  else if(action==='cancel-assemble'&&host)return mutate(()=>cancelDungeonAssembly(roomId),{message:'已返回等待室，請隊友重新準備。'});
  else if(action==='visibility'&&host)return mutate(
    ()=>setDungeonRoomVisibility(roomId,room.visibility==='public'?'private':'public'));
  else if(action==='invite'&&host){
    const friends=(window.getCurrentUserData?.()?.friends||[])
      .filter(x=>typeof x==='string'&&x!==account).slice(0,30);
    if(!friends.length)return announce('尚無可邀請的好友，請先加好友或分享六碼隊伍代碼。');
    return mutate(async()=>{
      const result=await inviteDungeonFriends(room,friends);
      return {room,...result};
    },{message:'已向 '+friends.length+' 位好友發送合作副本邀請。'});
  }else if(action==='kick'&&host){
    const targetUid=target.dataset.targetUid,member=room.members?.[targetUid];
    if(!member||targetUid===account)return;
    return confirmAction('確定將「'+nameOf(member)+'」移出副本隊伍？',
      ()=>kickDungeonMember(roomId,targetUid));
  }else if(action==='settle-and-leave'&&
    room.dungeonArena==='boss'&&room.bossEncounter?.status==='defeated')
    return confirmAction('確定完成本場副本？系統會先將 120 靈石與 3 修為入帳，再離開隊伍。',
      async()=>{
        // If A-side reward fails, never destroy C membership. The next
        // claim will safely replay the same A receipt if leaving fails.
        await claimDungeonBossReward(roomId);
        return leaveDungeonRoom(roomId);
      },{clear:true,message:'已領取本場獎勵並離開副本，勝利紀錄仍可查詢。'});
  else if(action==='disband'&&host)return confirmAction(
    room.bossEncounter?.status==='defeated'?
      '確定解散隊伍？本場勝利已保存，尚未領取的隊員之後仍可從副本入口補領。':
      '確定解散目前的合作副本隊伍？所有隊員都會離開。',
    ()=>disbandDungeonRoom(roomId),{clear:true,message:'隊伍已解散'});
  else if(action==='leave')return confirmAction(
    room.bossEncounter?.status==='defeated'?
      '確定離開已完成的副本？本場勝利已保存，可稍後回副本入口領取尚未入帳的獎勵。':
      (room.status==='assembled'?
        '確定退出正在進行的副本？其他隊員會保留探索與戰鬥進度繼續挑戰，但你無法重新加入這一場。':
        '確定離開目前的合作副本隊伍？'),
    ()=>leaveDungeonRoom(roomId),{clear:true,message:'已離開隊伍'});
}
function init(){
  entryMount();
  window.openDungeonLobby=openLobby;
  window.addEventListener('xiuxian:dungeon-room-joined',()=>{
    if(!open||localUser()!==account){void openLobby();return;}
    // A room invite can be accepted while the screen was already open.
    void refreshRemoteMembership({force:true});
  });
  window.addEventListener('xiuxian:dungeon-room-state',event=>{
    const next=event.detail?.room;
    if(open&&next?.id===room?.id&&localUser()===account)acceptRoom(next);
  });
  window.addEventListener('xiuxian:user-ready',entryMount);
  window.addEventListener('pageshow',entryMount);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)stopRoomStream();
    else {
      // A fresh authenticated snapshot repairs missed push notifications.
      if(open&&room){
        startRoomStream();
        void refreshRoom({force:true});
        void sendHeartbeat({force:true});
      }else poll();
    }
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();

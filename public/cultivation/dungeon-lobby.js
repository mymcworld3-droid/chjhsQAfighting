import {
  createDungeonRoom,joinDungeonRoomByCode,getDungeonRoom,reconnectDungeonRoom,
  leaveDungeonRoom,listPublicDungeonRooms,joinPublicDungeonRoom,quickJoinDungeonRoom,
  setDungeonRoomVisibility,inviteDungeonFriends,setDungeonReady,kickDungeonMember,
  disbandDungeonRoom,assembleDungeonRoom,cancelDungeonAssembly,
  subscribeDungeonRoom,heartbeatDungeonRoom
} from './dungeon-room.js';
import { getMainUser } from './data/project-repository.js';

// Only the lobby is implemented here. The server controls all membership,
// readiness, host and assembly decisions. No battle or reward state lives here.
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);
const roomCode=value=>String(value||'').trim().toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,6);
const safeRoomId=value=>/^[A-Za-z0-9_-]{8,160}$/.test(String(value||''))?String(value):'';
const nameOf=member=>member?.name||'無名修士';
const localUser=()=>getMainUser()?.uid||'';
let entry,root,body,notice,open=false,room=null,account='',pending=false,refreshing=false;
let list=[],listLoading=false,lastListAt=0,clock=null,requestSerial=0,initialFocus=null,roomRevision=-1;
let streamStop=null,streamRoomId='',streamConnected=false,heartbeatBusy=false,lastHeartbeatAt=0;
let fallbackFailures=0,nextFallbackAt=0,roomViewSignature='';
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
  const target=document.querySelector('#page-home .xiuxian-quick-actions');
  if(!target||document.getElementById('home-dungeon-entry'))return;
  entry=document.createElement('button');
  entry.type='button';entry.id='home-dungeon-entry';entry.className='home-dungeon-entry';
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
  room=null;roomRevision=-1;roomViewSignature='';
  stopRoomStream();
  fallbackFailures=0;nextFallbackAt=0;lastHeartbeatAt=0;
}
function roomSignature(next){
  const members=Object.entries(next?.members||{}).sort(([a],[b])=>a.localeCompare(b))
    .map(([uid,m])=>[uid,m.name,m.realm,m.ready,m.joinedAtMs]);
  return JSON.stringify([next?.id,next?.revision===undefined?null:next?.status,
    next?.hostUid,next?.visibility,next?.code,next?.assembledAtMs,members]);
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
function renderHome(){
  const count=list.length;
  body.innerHTML='<div class="dg-intro"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i>'+
    '<div><h3>秘境集結</h3><p>先召集道友，一起踏上即時探索副本。地圖與戰鬥將在後續階段開放。</p></div></div>'+
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
  const fullyReady=memberList.length>0&&readyCount===memberList.length;
  const members=memberList.map(member=>{
    const leader=member.uid===room.hostUid,isMe=member.uid===account;
    return '<article class="dg-member"><span class="dg-avatar" aria-hidden="true">'+
      (leader?'<i class="fa-solid fa-crown"></i>':'<i class="fa-solid fa-user"></i>')+'</span>'+
      '<span class="dg-member-body"><strong>'+esc(nameOf(member))+
      (isMe?' <em>（你）</em>':'')+'</strong><small>'+esc(member.realm||'凡人')+'境'+
      (leader?' · 隊長':'')+'</small><small class="dg-presence" data-dg-presence="'+esc(member.uid)+'"></small></span>'+
      '<span class="dg-ready '+(member.ready?'is-ready':'')+'">'+
      (member.ready?'已準備':'未準備')+'</span>'+
      (host&&!leader&&!assembled?'<button class="dg-kick" data-dg="kick" data-target-uid="'+esc(member.uid)+
      '" aria-label="將 '+esc(nameOf(member))+' 移出隊伍">移除</button>':'')+'</article>';
  }).join('');
  body.innerHTML='<div class="dg-room-status"><div><small>副本隊伍 · '+(assembled?'已集結':'等待集結')+'</small>'+
    '<h3>'+esc(room.visibility==='public'?'公開隊伍':'私人隊伍')+'</h3></div>'+
    '<span class="dg-team-count">'+memberList.length+' / 4 人</span>'+
    '<span class="dg-sync" data-dg-sync role="status"></span></div>'+
    '<div class="dg-room-code"><span>邀請代碼 <strong>'+esc(room.code)+'</strong></span>'+
    '<button data-dg="copy">複製</button></div>'+
    '<div class="dg-section-heading"><h3>隊伍成員</h3><span>'+readyCount+' / '+memberList.length+' 已準備</span></div>'+
    '<div class="dg-members">'+members+'</div>'+
    (assembled?'<p class="dg-assembled" role="status"><i class="fa-solid fa-check-circle"></i> 全隊集結完成。探索地圖將於後續階段開放，目前不會消耗入場券。</p>':
      '<p class="dg-helper">隊員各自確認準備。全員準備後，隊長才能確認集結出發。</p>')+
    '<div class="dg-actions dg-room-actions">'+
    (!assembled?'<button class="dg-primary" data-dg="ready">'+(me.ready?'取消準備':'我已準備')+'</button>':'')+
    (host&&!assembled?'<button data-dg="assemble" '+(!fullyReady?'disabled':'')+
      ' data-dg-disabled="'+(!fullyReady)+'">確認集結出發</button>':'')+
    (host&&assembled?'<button data-dg="cancel-assemble">返回等待室</button>':'')+
    (host&&!assembled?'<button data-dg="visibility">'+(room.visibility==='public'?'改為私人':'開放招募')+'</button>':'')+
    (host&&!assembled?'<button data-dg="invite">邀請好友</button>':'')+
    '<button data-dg="leave">離開隊伍</button>'+
    (host?'<button class="dg-danger" data-dg="disband">解散隊伍</button>':'')+'</div>';
  // A room refresh must not erase a recent operation result or error.
  renderPresence();
}
function render(){
  if(!root||!open)return;
  const top=body.scrollTop;
  if(room)renderRoom();else renderHome();
  markBusy(pending);
  body.scrollTop=top;
}
function acceptRoom(next){
  if(!next||!safeRoomId(next.id))return false;
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
  if(needsRender)render();
  else renderPresence();
  startRoomStream();
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
function poll(){
  if(!open)return;
  // Do not keep showing another account's private room after account switch.
  if(localUser()!==account){close();clearRoom();list=[];return;}
  if(document.hidden)return;
  if(room){
    if(!streamStop)startRoomStream();
    void sendHeartbeat();
    if(!streamConnected)void refreshRoom();
    renderPresence();
  }else void refreshList();
}
async function openLobby(){
  const uid=localUser();
  if(open&&uid===account){root?.querySelector('[data-dg="close"]')?.focus();return;}
  if(open)close();if(!uid){window.showToast?.('請先登入後再進入合作副本');return;}
  if(document.getElementById('tactical-combat')?.hidden===false||
     window.isXiuxianBattleInviteBlocked?.()||window.isXiuxianRaidInviteBlocked?.()){
    window.showToast?.('請先離開目前的戰鬥，再進入合作副本');return;
  }
  mount();account=uid;open=true;requestSerial++;
  clearRoom();list=[];listLoading=false;refreshing=false;heartbeatBusy=false;lastListAt=0;pending=false;
  initialFocus=document.activeElement;
  root.hidden=false;root.querySelector('[data-dg="close"]')?.focus({preventScroll:true});
  announce('正在恢復隊伍資訊…');render();
  clearInterval(clock);clock=setInterval(poll,5000);
  const serial=requestSerial;
  try{
    const result=await reconnectDungeonRoom();
    if(!validSession(uid,serial))return;
    announce('');
    if(result.room){
      acceptRoom(result.room);
      void sendHeartbeat({force:true});
    }else{
      clearRoom();render();
      void refreshList({force:true});
    }
  }catch(error){
    if(validSession(uid,serial)){announce(error?.message||'目前無法連線至副本隊伍');render();}
  }
}
function close(){
  if(!open)return;
  open=false;requestSerial++;clearInterval(clock);clock=null;
  stopRoomStream();
  root.hidden=true;announce('');
  const target=initialFocus;initialFocus=null;
  if(target?.isConnected)target.focus({preventScroll:true});
}
async function mutate(operation,{clear=false,message=''}={}){
  if(pending||!open||!account)return;
  const uid=account,serial=requestSerial;
  markBusy(true);announce('');
  try{
    const result=await operation();
    if(!validSession(uid,serial))return;
    if(clear||!result?.room||result.room.status==='closed'){
      clearRoom();list=[];lastListAt=0;
      announce(message||'已離開隊伍');render();
      void refreshList({force:true});
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
  if(pending)return;
  if(action==='create')return mutate(()=>createDungeonRoom('private'));
  if(action==='create-public')return mutate(()=>createDungeonRoom('public'));
  if(action==='quick')return mutate(()=>quickJoinDungeonRoom());
  if(action==='join-code')return joinCode();
  if(action==='refresh-list')return refreshList({force:true});
  if(action==='join-public')return mutate(()=>joinPublicDungeonRoom(safeRoomId(target.dataset.roomId)));
  if(!room?.id)return;
  const roomId=room.id,host=room.hostUid===account;
  if(action==='copy'){
    try{
      await navigator.clipboard.writeText(room.code);
      announce('隊伍代碼已複製');
    }catch(_){announce('請手動複製代碼：'+room.code);}
  }else if(action==='ready')return mutate(()=>setDungeonReady(roomId,room.members?.[account]?.ready!==true));
  else if(action==='assemble'&&host)return mutate(()=>assembleDungeonRoom(roomId),{message:'全隊集結完成。副本地圖尚未開放。'});
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
  }else if(action==='disband'&&host)return confirmAction('確定解散目前的合作副本隊伍？所有隊員都會離開。',
    ()=>disbandDungeonRoom(roomId),{clear:true,message:'隊伍已解散'});
  else if(action==='leave')return confirmAction('確定離開目前的合作副本隊伍？',
    ()=>leaveDungeonRoom(roomId),{clear:true,message:'已離開隊伍'});
}
function init(){
  entryMount();
  window.openDungeonLobby=openLobby;
  window.addEventListener('xiuxian:dungeon-room-joined',()=>{void openLobby();});
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

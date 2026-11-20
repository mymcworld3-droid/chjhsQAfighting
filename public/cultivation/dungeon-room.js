// New dungeon co-op lobby transport. The server owns room membership and
// invitation codes; no browser-side Firestore access or cached member state.
import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';
import { readRoomEvents } from './data/room-event-stream.js';

const ENDPOINT='/api/dungeon/room';
async function request(action,payload={}){
  const uid=getMainUser()?.uid;
  if(!uid)throw new Error('請先登入後再建立副本隊伍');
  const response=await authenticatedMainFetch(ENDPOINT,{
    method:'POST',body:JSON.stringify({action,...payload})
  });
  const data=await response.json().catch(()=>null);
  if(getMainUser()?.uid!==uid)throw new Error('登入帳號已切換，請重新進入副本');
  if(!response.ok||data?.ok!==true){
    const error=new Error(data?.error||'副本房間連線失敗');
    error.status=response.status;
    throw error;
  }
  return data;
}
export const createDungeonRoom=(visibility='private')=>request('create',{visibility});
export const joinDungeonRoomByCode=roomCode=>request('join-code',{roomCode});
export const getDungeonRoom=roomId=>request('get',{roomId});
export const reconnectDungeonRoom=()=>request('reconnect');
export const leaveDungeonRoom=roomId=>request('leave',{roomId});

export const listPublicDungeonRooms=async()=>{
  const data=await request('list-public');
  return Array.isArray(data.rooms)?data.rooms:[];
};
export const joinPublicDungeonRoom=roomId=>request('join-public',{roomId});
export const quickJoinDungeonRoom=()=>request('quick');
export const setDungeonRoomVisibility=(roomId,visibility)=>
  request('set-visibility',{roomId,visibility});
// Friend notifications share the authenticated legacy invitation transport;
// receipt still needs an authorized dungeon room join to become a member.
export async function inviteDungeonFriends(room,friendUids=[]){
  if(!room?.id||!room.code)throw new Error('請先建立副本隊伍');
  const uid=getMainUser()?.uid;
  if(!uid)throw new Error('請先登入後再邀請好友');
  const response=await authenticatedMainFetch('/api/invitations/send',{
    method:'POST',body:JSON.stringify({
      friendUids:Array.isArray(friendUids)?friendUids:[],
      invitation:{dungeonVersion:1,dungeonCode:room.code,roomId:room.id}
    })
  });
  const data=await response.json().catch(()=>null);
  if(getMainUser()?.uid!==uid)throw new Error('登入帳號已切換');
  if(!response.ok||data?.ok!==true){
    const error=new Error(data?.error||'副本好友邀請失敗');
    error.status=response.status;
    throw error;
  }
  return data;
}
export const acceptDungeonInvitation=invite=>{
  if(Number(invite?.dungeonVersion)!==1||typeof invite?.dungeonCode!=='string')
    throw new Error('副本邀請無效');
  return joinDungeonRoomByCode(invite.dungeonCode);
};

export const setDungeonReady=(roomId,ready)=>request('ready',{roomId,ready:!!ready});
export const kickDungeonMember=(roomId,targetUid)=>request('kick',{roomId,targetUid});
export const disbandDungeonRoom=roomId=>request('disband',{roomId});
export const assembleDungeonRoom=roomId=>request('start',{roomId});
export const activateDungeonPortal=roomId=>request('activate-portal',{roomId});
// Explicit co-op vote. The legacy enter-boss action is a YES vote as well.
export const setDungeonBossReady=(roomId,ready)=>
  request('boss-ready',{roomId,ready:!!ready});
export const enterDungeonBoss=roomId=>setDungeonBossReady(roomId,true);
export const rescueDungeonTeammate=(roomId,targetUid,seq)=>
  request('rescue',{roomId,targetUid,seq});
export const claimDungeonBossReward=roomId=>
  request('claim-boss-reward',{roomId});
export const claimDungeonManualExp=roomId=>
  request('claim-manual-exp',{roomId});
export const listRecentDungeonVictories=async()=>{
  const data=await request('recent-victories');
  return Array.isArray(data.rewards)?data.rewards:[];
};
export const cancelDungeonAssembly=roomId=>request('cancel-start',{roomId});

// Only one active subscription per visible dungeon lobby is necessary.
// Credentials stay in the signed POST header, never in a URL or persistent browser storage.
export function subscribeDungeonRoom(roomId,onRoom,onError,onConnection){
  if(!/^[A-Za-z0-9_-]{8,160}$/.test(String(roomId||'')))
    throw new Error('副本房間編號無效');
  const uid=getMainUser()?.uid;
  if(!uid)throw new Error('請先登入');
  let stopped=false,controller=null,retryTimer=null,retryDelay=1000;
  let lastRevision=-1,connected=false;
  const status=next=>{
    if(connected!==next){connected=next;onConnection?.(next);}
  };
  async function connect(){
    if(stopped)return;
    const current=new AbortController();
    controller=current;
    let watchdog=setTimeout(()=>current.abort(),8000);
    const progress=()=>{
      clearTimeout(watchdog);
      watchdog=setTimeout(()=>current.abort(),30000);
      status(true);
    };
    try{
      if(getMainUser()?.uid!==uid)
        throw Object.assign(new Error('登入帳號已變更'),{status:401});
      const response=await authenticatedMainFetch(ENDPOINT,{
        method:'POST',
        body:JSON.stringify({action:'subscribe',roomId}),
        signal:current.signal
      });
      await readRoomEvents(response,packet=>{
        if(stopped||getMainUser()?.uid!==uid){current.abort();return;}
        const next=packet?.room;
        if(!next||next.id!==roomId)return;
        const revision=Number(next.revision);
        if(!Number.isFinite(revision)||revision<=lastRevision)return;
        lastRevision=revision;
        retryDelay=1000;
        onRoom?.(next);
      },current.signal,progress);
    }catch(error){
      if(stopped)return;
      if(getMainUser()?.uid!==uid){
        stopped=true;
        status(false);
        onError?.(Object.assign(new Error('登入帳號已切換'),{status:401}));
        return;
      }
      if(error?.name!=='AbortError')onError?.(error);
      else onError?.(new Error('即時連線逾時，正在嘗試重新連線'));
      if([401,403,404,410].includes(error?.status)){
        stopped=true;status(false);return;
      }
    }finally{
      clearTimeout(watchdog);
      current.abort();
      if(controller===current)controller=null;
      status(false);
      if(!stopped){
        retryTimer=setTimeout(connect,retryDelay);
        retryDelay=Math.min(30000,retryDelay*2);
      }
    }
  }
  void connect();
  return ()=>{
    stopped=true;
    clearTimeout(retryTimer);retryTimer=null;
    controller?.abort();controller=null;
    status(false);
  };
}
export const heartbeatDungeonRoom=roomId=>request('heartbeat',{roomId});

// Phase 5: fetch the server-authored blueprint. No browser-selected seed and
// no local map regeneration; everyone in the same room receives one layout.
export async function getDungeonMap(roomId){
  const {map}=await request('get-map',{roomId});
  if(map?.mode!=='dungeon'||![1,2].includes(map.layoutVersion)||
      !Array.isArray(map.tiles)||map.tiles.length!==map.width*map.height)
    throw new Error('副本地圖資料不完整，請重新整理後再試');
  return map;
}

// Only the movement direction and expected per-player step are accepted.
// Position and stamina come exclusively from the server room snapshot.
export const moveDungeonMember=(roomId,dx,dy,step)=>
  request('move',{roomId,dx,dy,step});
export const moveDungeonMemberRoute=(roomId,vectors,step)=>
  request('move-route',{roomId,vectors,step});

// Attack requests contain only enemy ID and per-player sequence. The
// server calculates range, damage and energy in one room transaction.
export const strikeDungeonBeast=(roomId,enemyId,seq)=>
  request('strike',{roomId,enemyId,seq});

export const castDungeonSkill=(roomId,skillId,target,seq,moveSword=false)=>
  request('skill',{roomId,skillId,target,seq,...(moveSword?{moveSword:true}:{})});
export const guardDungeonTeammate=(roomId,targetUid,seq)=>
  request('boss-guard',{roomId,targetUid,seq});
export const switchDungeonLoadout=(roomId,index)=>
  request('loadout',{roomId,index});

// Individual question sessions belong to Firebase A; only verified answer
// receipts can be credited by the C room transaction.
export async function dungeonQuizRequest(endpoint,body){
  const uid=getMainUser()?.uid;
  if(!uid)throw new Error('請先登入後再進行副本答題');
  const response=await authenticatedMainFetch(endpoint,{
    method:'POST',body:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>null);
  if(getMainUser()?.uid!==uid)throw new Error('登入帳號已切換，請重新開啟副本');
  if(!response.ok){
    const error=new Error(data?.error||'副本答題服務暫時無法使用');
    error.status=response.status;
    throw error;
  }
  return data;
}
export const getDungeonQuizState=roomId=>
  dungeonQuizRequest('/api/dungeon/quiz/state',{roomId});
export const generateDungeonQuestion=(roomId,slot=0)=>
  dungeonQuizRequest('/api/generate-quiz',{quizMode:'dungeon',roomId,slot});
export const answerDungeonQuestion=(roomId,questionId,choice,help=0,timeTaken=0)=>
  dungeonQuizRequest('/api/dungeon/quiz/answer',
    {roomId,questionId,choice,help,timeTaken});
export const acknowledgeDungeonReview=(roomId,questionId)=>
  dungeonQuizRequest('/api/dungeon/quiz/next',{roomId,questionId});
export const claimDungeonQuizStamina=(roomId,questionId)=>
  request('quiz-credit',{roomId,questionId});
export const reportDungeonQuestion=(roomId,questionId,reason)=>
  dungeonQuizRequest('/api/dungeon/quiz/report',{roomId,questionId,reason});
export const reviewDungeonMathIssue=(roomId,questionId)=>
  dungeonQuizRequest('/api/dungeon/quiz/review-math-issue',{roomId,questionId});
export const refundDungeonQuestionStamina=(roomId,questionId)=>
  request('quiz-error-refund',{roomId,questionId});

// The server computes clock ticks from its own assembly epoch. This request
// never accepts client timestamps or a requested tick value.
export const synchronizeDungeonBattleClock=roomId=>request('clock',{roomId});

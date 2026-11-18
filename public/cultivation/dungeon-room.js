// New dungeon co-op lobby transport. The server owns room membership and
// invitation codes; no browser-side Firestore access or cached member state.
import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';

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

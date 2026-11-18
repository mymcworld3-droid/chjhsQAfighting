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
export const createDungeonRoom=()=>request('create');
export const joinDungeonRoomByCode=roomCode=>request('join-code',{roomCode});
export const getDungeonRoom=roomId=>request('get',{roomId});
export const reconnectDungeonRoom=()=>request('reconnect');
export const leaveDungeonRoom=roomId=>request('leave',{roomId});

import {
  doc, getDoc, setDoc, updateDoc, runTransaction, onSnapshot,
  collection, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getProjectServices, getMainUser, authenticatedMainFetch } from './project-repository.js';

const COLLECTION='users';
function uidValue(uid){const value=String(uid||'').trim();if(!value)throw new Error('玩家 UID 不可為空');return value;}
async function services(){return getProjectServices('A',{authenticateSecondary:false});}

async function sendServerInvitations({friendUids=[],invitation={}}={}) {
  const response = await authenticatedMainFetch('/api/invitations/send', {
    method: 'POST',
    body: JSON.stringify({ friendUids, invitation })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.error || '邀請服務暫時無法使用');
  }
  return Array.isArray(payload.sentTo) ? payload.sentTo : [];
}

export const playerRepository=Object.freeze({
  domain:'player',role:'A',collection:COLLECTION,
  currentUser(){return getMainUser();},
  async get(uid){const {db}=await services();const snap=await getDoc(doc(db,COLLECTION,uidValue(uid)));return snap.exists()?{id:snap.id,...snap.data()}:null;},
  async merge(uid,value){const {db}=await services();await setDoc(doc(db,COLLECTION,uidValue(uid)),value||{},{merge:true});},
  async patch(uid,value){const {db}=await services();await updateDoc(doc(db,COLLECTION,uidValue(uid)),value||{});},
  async transaction(uid,worker){
    if(typeof worker!=='function')throw new Error('playerRepository.transaction 需要 worker');
    const {db}=await services(),ref=doc(db,COLLECTION,uidValue(uid));
    return runTransaction(db,async tx=>{const snap=await tx.get(ref);return worker({tx,ref,snapshot:snap,data:snap.exists()?snap.data():null});});
  },
  async subscribe(uid,next,error){const {db}=await services();return onSnapshot(doc(db,COLLECTION,uidValue(uid)),snap=>next?.(snap.exists()?{id:snap.id,...snap.data()}:null),error);},
  async addExamLog(value={}){const {db}=await services();return addDoc(collection(db,'exam_logs'),value);},
  async shareDongtian(cave){
    const user=getMainUser();
    if(!user)throw new Error('請先登入');
    if(!/^[A-Za-z0-9_-]{1,160}$/.test(String(cave?.id||'')) || cave.ownerUid!==user.uid || cave.status!=='active' || cave.tutorialOnly)
      throw new Error('只能分享自己已開放的正式洞天');
    const {db}=await services();
    const snap=await getDoc(doc(db,COLLECTION,user.uid));
    if(!snap.exists() || getMainUser()?.uid!==user.uid)throw new Error('登入狀態已改變，請重新開啟洞天管理');
    const player=snap.data();
    return addDoc(collection(db,'global_chat'),{
      uid:user.uid,displayName:String(player.displayName||'修士'),
      avatar:player.equipped?.avatar||'',frame:player.equipped?.frame||'',
      rankLevel:player.stats?.rankLevel||0,totalScore:player.stats?.totalScore||0,
      type:'dongtian-share',dongtianId:cave.id,dongtianName:String(cave.name||'無名洞天').slice(0,80),
      text:`分享洞天「${String(cave.name||'無名洞天').slice(0,80)}」`,timestamp:serverTimestamp()
    });
  },
  async sendInvitations(options){return sendServerInvitations(options);},
  async sendRaidInvitations(options){return sendServerInvitations(options);}
});

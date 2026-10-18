import {
  doc, getDoc, setDoc, updateDoc, runTransaction, onSnapshot,
  collection, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getProjectServices, getMainUser, authenticatedMainFetch } from './project-repository.js';
import { resolvePlayerAvatar } from '../profile-avatar.js';
import '../curriculum-range-rules.js';
import '../knowledge-points.js';

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
  // 關鍵作答採固定來源鍵：跨裝置／監聽重複觸發不得建立兩筆相同歷史。
  async saveExamAnswer(key, value={}) {
    const user=getMainUser();
    if(!user?.uid) throw new Error('請先登入才能儲存答題紀錄');
    const stable=String(key||'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,480);
    if(stable.length<6) throw new Error('答題紀錄缺少固定來源鍵');
    const {db}=await services(),ref=doc(db,'exam_logs',stable);
    const point = globalThis.QAKnowledgePoints.label(value, value.subject);
    return runTransaction(db,async tx=>{
      const existing=await tx.get(ref);
      if(existing.exists()) return false;
      if (getMainUser()?.uid !== user.uid) throw new Error('帳號已更換，請重新載入');
      const playerRef = point ? doc(db,COLLECTION,user.uid) : null;
      const player = playerRef ? await tx.get(playerRef) : null;
      const opts=Array.isArray(value.options)?value.options.slice(0,4).map(x=>String(x??'').slice(0,1500)):[];
      tx.set(ref,{
        uid:user.uid,email:user.email||'',timestamp:serverTimestamp(),
        mode:['raid','duel','immortal'].includes(value.mode)?value.mode:'raid',
        topic:String(value.topic||'').slice(0,70),
        rankAtTime:String(value.rankAtTime||'').slice(0,80),
        question:String(value.question||'').slice(0,3000),
        subject:String(value.subject||'').slice(0,50),
        subTopic:String(value.subTopic||'').slice(0,150),
        knowledgeSubject:point?.subject || '',
        knowledgePointId:point?.id || '',
        knowledgePoint:point?.name || '',
        knowledgePoints:globalThis.QAKnowledgePoints.labels(value,value.subject),
        questionForm:String(value.question_form || '').slice(0,40),
        isCorrect:value.isCorrect===true,
        options:opts,
        correctIdx:Number.isInteger(value.correctIdx)?value.correctIdx:-1,
        userIdx:Number.isInteger(value.userIdx)?value.userIdx:-1,
        explanation:String(value.explanation||'').slice(0,3500),
        timeTaken:Math.max(0,Number(value.timeTaken)||0)
      });
      if (player?.exists()) tx.update(playerRef, {
        'stats.knowledgePointMapV1':globalThis.QAKnowledgePoints.record(player.data()?.stats?.knowledgePointMapV1 || {},value,value.isCorrect===true)
      });
      return true;
    });
  },
  async shareCurriculum({code,title}={}){
    const user=getMainUser();
    if(!user)throw new Error('請先登入');
    const parsed=globalThis.CurriculumRangeRules.readSharedSelection(code);
    if(!parsed.ok)throw new Error(parsed.message);
    const shared=globalThis.CurriculumRangeRules.createChatShare(parsed.units,title);
    if(!shared.ok)throw new Error(shared.message);
    const {db}=await services();
    const snap=await getDoc(doc(db,COLLECTION,user.uid));
    if(!snap.exists() || getMainUser()?.uid!==user.uid)throw new Error('登入狀態已改變，請重新開啟修習清單');
    const player=snap.data();
    return addDoc(collection(db,'global_chat'),{
      uid:user.uid,displayName:String(player.displayName||'修士'),
      avatar:resolvePlayerAvatar(player,user),frame:player.equipped?.frame||'',
      rankLevel:player.stats?.rankLevel||0,totalScore:player.stats?.totalScore||0,
      ...shared.message,timestamp:serverTimestamp()
    });
  },
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
      avatar:resolvePlayerAvatar(player,user),frame:player.equipped?.frame||'',
      rankLevel:player.stats?.rankLevel||0,totalScore:player.stats?.totalScore||0,
      type:'dongtian-share',dongtianId:cave.id,dongtianName:String(cave.name||'無名洞天').slice(0,80),
      text:`分享洞天「${String(cave.name||'無名洞天').slice(0,80)}」`,timestamp:serverTimestamp()
    });
  },
  async sendInvitations(options){return sendServerInvitations(options);},
  async sendRaidInvitations(options){return sendServerInvitations(options);}
});

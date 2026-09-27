'use strict';

const crypto = require('crypto');
const { PROJECT_IDS, parseServiceAccount } = require('./firebase-admin-projects.cjs');
const { playerRepository } = require('./server-repositories.cjs');

const VERSION='v1';
const TTL_MS=45*60*1000;

function deriveKey(env=process.env){
  const account=parseServiceAccount('A',env);
  return crypto.createHash('sha256')
    .update(account.private_key+'\n'+account.client_email+'\nraid-question-ticket-v1')
    .digest();
}
function b64(value){return Buffer.from(value).toString('base64url');}
function unb64(value){return Buffer.from(String(value||''),'base64url');}

async function verifyMainIdentity(req,{resolveA=()=>playerRepository.resolve()}={}){
  const bearer=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization')||''));
  if(!bearer)throw Object.assign(new Error('請先登入後再進行團本答題'),{status:401});
  const a=resolveA();let verified;
  try{verified=await a.auth.verifyIdToken(bearer[1],true);}
  catch(_){throw Object.assign(new Error('登入狀態已失效，請重新登入'),{status:401});}
  if(!verified?.uid||verified.aud!==PROJECT_IDS.A||
      verified.iss!=='https://securetoken.google.com/'+PROJECT_IDS.A){
    throw Object.assign(new Error('登入身分驗證失敗'),{status:401});
  }
  return verified.uid;
}

function issueRaidQuestionTicket(payload,{env=process.env,now=Date.now()}={}){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',deriveKey(env),iv);
  const body=Buffer.from(JSON.stringify({...payload,issuedAtMs:now,expiresAtMs:now+TTL_MS}),'utf8');
  const encrypted=Buffer.concat([cipher.update(body),cipher.final()]),tag=cipher.getAuthTag();
  return [VERSION,b64(iv),b64(encrypted),b64(tag)].join('.');
}
function readRaidQuestionTicket(token,{env=process.env,now=Date.now()}={}){
  const parts=String(token||'').split('.');
  if(parts.length!==4||parts[0]!==VERSION)throw Object.assign(new Error('團本題目票證無效'),{status:409});
  try{
    const decipher=crypto.createDecipheriv('aes-256-gcm',deriveKey(env),unb64(parts[1]));
    decipher.setAuthTag(unb64(parts[3]));
    const clear=Buffer.concat([decipher.update(unb64(parts[2])),decipher.final()]);
    const payload=JSON.parse(clear.toString('utf8'));
    if(!payload||finite(payload.expiresAtMs)<now)throw Object.assign(new Error('團本題目已過期，請取得下一題'),{status:409});
    return payload;
  }catch(error){
    if(error?.status)throw error;
    throw Object.assign(new Error('團本題目票證驗證失敗'),{status:409});
  }
}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:0;}
function assertRaidQuestionTicket(payload,{uid,roomId,actionId,questionId}={}){
  if(String(payload?.uid||'')!==String(uid||'')||String(payload?.roomId||'')!==String(roomId||'')||
      finite(payload?.actionId)!==finite(actionId)||String(payload?.questionId||'')!==String(questionId||'')){
    throw Object.assign(new Error('團本題目與本次出手不符，請重新取得題目'),{status:409});
  }
  const answerIndex=Math.floor(finite(payload?.answerIndex));
  if(answerIndex<0||answerIndex>3)throw Object.assign(new Error('團本題目答案票證無效'),{status:409});
  return {...payload,answerIndex};
}

module.exports={TTL_MS,deriveKey,verifyMainIdentity,issueRaidQuestionTicket,readRaidQuestionTicket,assertRaidQuestionTicket};

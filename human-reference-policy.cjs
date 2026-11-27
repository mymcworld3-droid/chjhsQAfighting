'use strict';
const crypto=require('node:crypto');
const registry=require('./curriculum-data/human-reference-provenance.json');
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
const sourceClass=ref=>{
  const id=String(ref?.id||''),source=String(ref?.source||'');
  if(!source.trim())return 'missing-source';
  if(/^self[-_]/i.test(id)||/自編|自製|自行編|AI\s*(生成|編寫|自編|改寫|出題)|人工智慧生成|模型生成|synthetic|ai-generated/i.test(source))return 'self-or-generated';
  if(/改寫|改編|改作|仿作|仿題|命題思路|整理為|改為|改成|變式|重寫|改造|adapted/i.test(source)||/adapted/i.test(String(ref?.question?.template_id||'')))return 'adapted';
  if(/大考中心|學測|指考|分科測驗|教育會考|基測|統測|歷屆|考選部/.test(source))return 'exam-claimed-unverified';
  if(/教師|老師|學校|段考|期中考|期末考|出版社|教材/.test(source))return 'other-human-source-claimed-unverified';
  return 'unverified-other';
};
function checkApproval(ref,record,file){
  if(!ref||!record||!nonempty(ref.id)||!nonempty(ref.source))return false;
  if(['self-or-generated','adapted','missing-source'].includes(sourceClass(ref)))return false;
  if(record.status!=='approved'||record.authorship!=='human-original'||record.method!=='human-original-source-comparison'||record.originalTextAndOptionsMatched!==true||record.answerVerified!==true||record.sourceRightsVerified!==true)return false;
  if(record.referenceId!==ref.id||record.referenceHash!==digest(ref)||!/^question-references\/[^/]+\/[^/]+\/[^/]+\.json$/.test(record.file||'')||(file&&file!==record.file))return false;
  if(!['official-exam','licensed-teacher','licensed-school','licensed-publisher','open-licensed-human'].includes(record.sourceType))return false;
  if(!['statutory-exam','explicit-permission','open-license','public-domain'].includes(record.rightsBasis))return false;
  if(record.rightsBasis==='statutory-exam'&&record.sourceType!=='official-exam')return false;
  if(!['sourceTitle','sourceAuthorOrInstitution','originalQuestionNumberOrLocator','rightsEvidence','reviewer','reviewEvidence'].every(k=>nonempty(record[k])))return false;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(record.reviewedAt||'')||!Number.isFinite(Date.parse(record.reviewedAt)))return false;
  if(!/^https:\/\//.test(record.originalSourceUrl||''))return false;
  try{const u=new URL(record.originalSourceUrl);if(!u.hostname||u.username||u.password)return false;}catch(_){return false;}
  return true;
}
const approvals=registry.schema===1&&Array.isArray(registry.approvals)?registry.approvals:[];
const byHash=new Map();
for(const r of approvals){if(!byHash.has(r.referenceHash))byHash.set(r.referenceHash,[]);byHash.get(r.referenceHash).push(r);}
function isApproved(ref,file){const records=byHash.get(digest(ref));return !!(records&&records.length===1&&checkApproval(ref,records[0],file));}
const policyVersion='human-reference-v1:'+digest(registry);
module.exports={digest,sourceClass,checkApproval,isApproved,policyVersion};

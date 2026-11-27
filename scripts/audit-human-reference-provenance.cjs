'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {digest,sourceClass,checkApproval}=require('../human-reference-policy.cjs');
const ROOT=path.join(__dirname,'..');
const read=(root,p)=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const gitBlobHash=buf=>crypto.createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');
function audit(root=ROOT){
 const baseline=read(root,'curriculum-data/reference-provenance-baseline.json');
 const registry=read(root,'curriculum-data/human-reference-provenance.json');
 const errors=[],rows=[],seen=new Set(),byHash=new Map(),files=[];
 if(registry.schema!==1||!Array.isArray(registry.approvals))errors.push('invalid approval registry');
 for(const r of registry.approvals||[]){
  if(byHash.has(r.referenceHash))errors.push('duplicate approval: '+r.referenceHash);
  byHash.set(r.referenceHash,r);
 }
 function walk(dir){for(const ent of fs.readdirSync(path.join(root,dir),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  const file=dir+'/'+ent.name;
  if(ent.isDirectory())walk(file);
  else if(ent.isFile()&&file.endsWith('.json')&&file!=='question-references/index.json')files.push(file);
  else if(file!=='question-references/index.json')errors.push('unexpected reference-bank entry: '+file);
 }}
 walk('question-references');
 const classes={},bySubject={},missing=[];
 for(const file of files){
  const buf=fs.readFileSync(path.join(root,file)),legacyUnchanged=baseline.files?.[file]===gitBlobHash(buf);
  let group;try{group=JSON.parse(buf.toString('utf8'));}catch(e){errors.push('invalid JSON '+file);continue;}
  if(!Array.isArray(group.references)){errors.push('missing references '+file);continue;}
  let approvedCount=0;
  for(const ref of group.references){
   const hash=digest(ref),record=byHash.get(hash),approved=checkApproval(ref,record,file);
   if(record){seen.add(hash);if(!approved)errors.push('invalid approval '+file+' '+ref.id);}
   if(approved)approvedCount++;
   else if(!legacyUnchanged)errors.push('unverified question in new/modified bank '+file+' '+ref.id);
   const classification=approved?'verified-human-original':sourceClass(ref);
   classes[classification]=(classes[classification]||0)+1;
   const subject=file.split('/')[1];const s=bySubject[subject]||={total:0,approved:0,quarantined:0};s.total++;s[approved?'approved':'quarantined']++;
   rows.push({file,id:ref.id||null,source:ref.source||null,referenceHash:hash,classification,status:approved?'eligible':'quarantined',legacyUnchanged});
  }
  if(!approvedCount)missing.push(file);
 }
 for(const r of registry.approvals||[])if(!seen.has(r.referenceHash))errors.push('stale approval: '+r.referenceId);
 return {schema:1,summary:{groups:files.length,total:rows.length,approved:rows.filter(r=>r.status==='eligible').length,quarantined:rows.filter(r=>r.status==='quarantined').length,groupsWithoutApproved:missing.length,classes,bySubject},rows,groupsWithoutApproved:missing,errors};
}
if(require.main===module){
 const report=audit();
 const output=process.argv[2];if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report.summary,null,2));
 if(report.errors.length){console.error(report.errors.join('\n'));process.exitCode=1;}
}
module.exports={audit,gitBlobHash};

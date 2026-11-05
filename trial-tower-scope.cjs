'use strict';
// Tower study choices follow free-study scope semantics, not PvP's mutual-grade filter.
const crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const SUBJECTS=new Set(['國文','國語','英文','數學','數學A','數學B','數學甲','數學乙','生物','物理','化學','地球科學','歷史','地理','公民','自然','自然科學','社會','生活','藝術','健康與體育','本土語文','綜合活動','資訊科技','綜合']);
const RANDOM_SUBJECTS=['國文','英文','數學','公民','歷史','地理','物理','化學','生物'];
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const clean=(v,n=240)=>String(v||'').trim().slice(0,n);
function snapshot(user={}){
 const settings=user.gameSettings||{},profile=user.profile||{},mode=['focused','bank'].includes(settings.sourceMode)?settings.sourceMode:'random';
 const level=clean(profile.educationLevel,40)||'國中一年級',difficulty=['easy','medium','hard'].includes(settings.difficulty)?settings.difficulty:'auto';
 const units=mode==='focused'?(Array.isArray(settings.focusedUnits)?settings.focusedUnits:[]).map(u=>({path:clean(u?.path).replaceAll('\\','/'),detail:clean(u?.detail,200),sub_topics:(Array.isArray(u?.sub_topics)?u.sub_topics:[]).map(v=>clean(v,200)).filter(Boolean).slice(0,24)})):[];
 if(mode==='focused'&&(!units.length||units.length>24||units.some(u=>!SUBJECTS.has(u.path.split('/')[0]))))throw fail('請先儲存有效的修習範圍');
 const source=mode==='bank'?clean(settings.source):'';
 if(mode==='bank'&&(!source||source==='ai'))throw fail('請先選擇並儲存題庫');
 return {version:1,mode,level,difficulty,source,units,weakSubjects:mode==='focused'?clean(profile.weakSubjects,200):''};
}
function key(scope){
 // Reordering equivalent selections does not replace an unanswered question.
 const units=scope.units.map(u=>({...u,sub_topics:[...u.sub_topics].sort()})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return crypto.createHash('sha256').update(JSON.stringify({...scope,units})).digest('hex');
}
function smartDifficulty(user){
 const rank=Number(user.stats?.rankLevel)||0,streak=Number(user.stats?.currentStreak)||0;
 const base=rank>=5?'hard':rank>=2?'medium':'easy';
 return streak>=3?(base==='easy'?'medium':'hard'):base;
}
function pick(scope,user={},index=0){
 const i=Math.max(0,Math.floor(Number(index)||0));
 let difficulty=scope.difficulty==='auto'?smartDifficulty(user):scope.difficulty;
 if(scope.mode==='bank')return {bankSource:scope.source,level:scope.level,difficulty,
  subject:[...scope.source.split('/')].reverse().find(p=>SUBJECTS.has(p))||'',specificTopic:scope.source.replace('.json','')};
 if(scope.mode!=='focused')return {subject:RANDOM_SUBJECTS[i%RANDOM_SUBJECTS.length],level:scope.level,difficulty,specificTopic:''};
 const unit=scope.units[i%scope.units.length],parts=unit.path.split('/'),subject=parts[0],chosenGrade=parts[1]||'';
 // The selected curriculum grade wins even when it is above the profile grade.
 const level=/^[七7](?:上|下|年級)/.test(chosenGrade)?'國中一年級'
  :/^[八8](?:上|下|年級)/.test(chosenGrade)?'國中二年級'
  :/^[九9](?:上|下|年級)/.test(chosenGrade)?'國中三年級'
  :/^(國小|國中|高中)[一二三四五六]年級/.test(chosenGrade)?chosenGrade:scope.level;
 let specificTopic=unit.detail||unit.path.replace('.json','');
 if(unit.sub_topics.length)specificTopic+=` (核心考點細項：${unit.sub_topics.join('、')})`;
 if((chosenGrade.startsWith('高中')||chosenGrade.startsWith('國小'))&&parts.length>=4)specificTopic=`${chosenGrade}／${parts[2].slice(0,20)}／${(parts[3]||subject).slice(0,16)}：${specificTopic}`;
 if(scope.difficulty!=='hard'&&difficulty==='hard'&&scope.weakSubjects.split(',').map(v=>v.trim()).includes(subject))difficulty='medium';
 return {subject,level,difficulty,specificTopic:specificTopic.slice(0,240),adaptiveScope:unit};
}
async function bankQuestion(context,{root=path.join(__dirname,'public','banks'),random=Math.random}={}){
 const source=String(context.bankSource||'');
 if(!source||source.includes('\\')||source.includes('\0')||source.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(source))throw fail('題庫範圍無效，請重新選擇');
 const base=await fs.realpath(root),inside=file=>file.startsWith(base+path.sep);
 let selected;try{selected=await fs.realpath(path.join(base,source));}catch(error){if(error.code==='ENOENT')throw fail('所選題庫不存在，請重新選擇');throw error;}
 if(!inside(selected))throw fail('題庫範圍無效，請重新選擇');
 const files=[];
 async function collect(file){
  const real=await fs.realpath(file);if(!inside(real))throw fail('題庫範圍無效，請重新選擇');
  const stat=await fs.stat(real);
  if(stat.isDirectory()){for(const item of (await fs.readdir(real,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name)))if(!item.isSymbolicLink())await collect(path.join(real,item.name));}
  else if(real.endsWith('.json'))files.push(real);
 }
 await collect(selected);
 const questions=[];
 for(const file of files){
  const raw=JSON.parse(await fs.readFile(file,'utf8'));if(!Array.isArray(raw))continue;
  for(const q of raw){const opts=[q?.correct,...(Array.isArray(q?.wrong)?q.wrong:[])];
   if(typeof q?.q==='string'&&q.q.trim()&&opts.length===4&&opts.every(v=>typeof v==='string'&&v.trim())&&new Set(opts.map(v=>v.trim())).size===4)questions.push(q);
  }
 }
 if(!questions.length)throw fail('所選題庫沒有有效題目，請調整範圍');
 const matching=questions.filter(q=>q.difficulty===context.difficulty),pool=matching.length?matching:questions;
 const fingerprint=v=>String(v||'').toLowerCase().replace(/\s+/g,'');
 const seen=new Set((context.history||[]).map(fingerprint)),unseen=pool.filter(q=>!seen.has(fingerprint(q.q))),available=unseen.length?unseen:pool;
 const index=Math.min(available.length-1,Math.max(0,Math.floor(random()*available.length)));
 return {...available[index],subject:context.subject||available[index].subject||'題庫'};
}
module.exports={snapshot,key,pick,bankQuestion};

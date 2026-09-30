const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'); const base=require('node:path').resolve(__dirname,'..');
const talents=require(base+'/public/cultivation/soul-talents.js');
const authority=require(base+'/raid-authority.cjs');
const settle=new Function(fs.readFileSync(base+'/public/cultivation/battle-engine-v2.js','utf8').replace(/^export /gm,'')+'\nreturn settleBattleRound;')();
const nodes=Object.fromEntries(['leftMain','leftTop','leftBottom','leftFarTop','leftFarBottom','leftFinal','rightMain','rightTop','rightBottom','rightFarTop','rightFarBottom','rightFinal'].map(x=>[x,10]));
function player(type,uid,grade){const p=authority.trustedRaidPlayerSnapshot({stats:{attack:200,maxHp:1000,totalScore:68},cultivationTraining:{equippedCore:{type,grade}},nascentSoulTree:{version:4,paths:{[type]:{nodes}}}},uid,{items:[]});return {...p,answer:{correct:true,atMs:1000}};}
for(const grade of [9,1])test('nine-core balance at grade '+grade+' with equal full trees, no equipment and 80% accuracy',()=>{
 const names=Object.keys(talents.TYPES),wins=Object.fromEntries(names.map(x=>[x,0])),games=Object.fromEntries(names.map(x=>[x,0]));
 for(let a=0;a<names.length;a++)for(let b=a+1;b<names.length;b++)for(let n=0;n<200;n++){
  let h=player(names[a],'h',grade),g=player(names[b],'g',grade);
  for(let round=1;round<=15;round++){
   const rand=k=>require('crypto').createHash('sha256').update(k).digest().readUInt32LE(0)/4294967296; const first=rand('order:'+n+':'+round)<.5; h.answer={correct:rand('host-correct:'+n+':'+round)<.8,atMs:first?1000:1200};g.answer={correct:rand('guest-correct:'+n+':'+round)<.8,atMs:first?1200:1000};
   const r=settle({roomId:'balanced-'+n,round,host:h,guest:g,soulTalents:talents});
   h.hp=r.hostHp;g.hp=r.guestHp;h.coreCorrectStreak=r.hostCoreStreak;g.coreCorrectStreak=r.guestCoreStreak;h.coreShield=r.hostCoreShield;g.coreShield=r.guestCoreShield;
   if(r.finished){if(r.winnerUid==='h')wins[names[a]]++;else if(r.winnerUid==='g')wins[names[b]]++;else{wins[names[a]]+=.5;wins[names[b]]+=.5;}break;}
  }
  games[names[a]]++;games[names[b]]++;
 }
 for(const type of names){const rate=wins[type]/games[type];assert.ok(rate>=.35&&rate<=.65,type+': '+rate);}

});


'use strict';
// Cross-compare all nine golden cores and both maxed Huashen variants using live PvP engine.
// Usage: node scripts/simulate-huashen-winrates.cjs [accuracy=0.7] [games/pair=400] [score=350]
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const Access=require('../public/cultivation/training-access-rules.js');
const Growth=require('../public/cultivation/nascent-growth.js');
const Innate=require('../public/cultivation/innate-ability.js');
const Talents=require('../public/cultivation/soul-talents.js');
const Combo=require('../public/cultivation/combat-combo.js');
const accuracy=Number(process.argv[2]??.7),games=Number(process.argv[3]??400),score=Number(process.argv[4]??350);
if(!(accuracy>=0&&accuracy<=1)||!Number.isInteger(games)||games<2||games%2||!Number.isFinite(score)||score<188)
  throw Error('Usage: node scripts/simulate-huashen-winrates.cjs [accuracy 0..1] [positive even games/pair] [score >=188]');
const context={window:{},QACombatCombo:Combo,QASoulTalents:Talents,QAInnateAbility:Innate};
vm.createContext(context);
for(const name of ['artifact-battle-effects.js','battle-engine-v2.js']){
  let code=fs.readFileSync(path.join(root,'public/cultivation',name),'utf8');
  code=code.replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  vm.runInContext(code+(name==='battle-engine-v2.js'?'\nthis.settle=settleBattleRound;':''),context);
}
const options=Object.keys(Talents.TYPES).flatMap(type=>Innate.branches(type).map(row=>({
  type,branch:row.id,name:row.name,core:Talents.TYPES[type].name
})));
const realmHp=Access.hpBonus({stats:{totalScore:score}});
function player(opt,uid){
  const core={type:opt.type,grade:1};
  const soul=Growth.bonuses({
    stats:{totalScore:score},
    cultivationTraining:{equippedCore:core},
    nascentSoulGrowth:{version:1,branches:Object.fromEntries(Growth.branches(core).map(row=>[row.id,10]))}
  },core);
  const hp=1000+realmHp+soul.maxHpFlat;
  return {uid,totalScore:score,trainingAccessScore:score,goldenCore:core,nascentSoul:soul,
    atk:200+soul.attackFlat,hp,maxHp:hp,coreCorrectStreak:0,coreShield:false,
    innateAbility:{version:1,type:opt.type,branch:opt.branch,level:10},innateAbilityState:null,
    artifactBattle:{effects:[]}};
}
const roll=key=>crypto.createHash('sha256').update(key).digest().readUInt32LE(0)/4294967296;
const trials=Array.from({length:games/2},(_,n)=>Array.from({length:15},(_,r)=>{
  const first=roll('order:'+n+':'+r)<.5;
  return [
    {correct:roll('host:'+n+':'+r)<accuracy,atMs:first?1000:1200},
    {correct:roll('guest:'+n+':'+r)<accuracy,atMs:first?1200:1000}
  ];
}));
const totals=options.map(()=>({wins:0,draws:0,games:0})),pairs=[];
for(let a=0;a<options.length;a++)for(let b=a+1;b<options.length;b++){
  let winsA=0,winsB=0,draws=0;
  for(let n=0;n<games;n++){
    const flip=n%2===1,seed=Math.floor(n/2);
    const hostOpt=options[flip?b:a],guestOpt=options[flip?a:b];
    let host=player(hostOpt,'h'),guest=player(guestOpt,'g'),finished=false;
    for(let round=1;round<=15;round++){
      [host.answer,guest.answer]=trials[seed][round-1];
      const result=context.settle({roomId:'huashen:'+seed,round,host,guest,
        soulTalents:Talents,resolveEquipmentHit:context.window.resolveArtifactBattleHit,
        resolveGuardedFollowup:context.window.resolveArtifactGuardedFollowup,
        resolveGuardAbsorption:context.window.resolveArtifactGuardAbsorption,
        resolveTalentDefense:context.window.resolveArtifactBattleDefense});
      for(const [member,role] of [[host,'host'],[guest,'guest']]){
        member.hp=result[role+'Hp'];
        member.coreCorrectStreak=result[role+'CoreStreak'];
        member.coreShield=result[role+'CoreShield'];
        member.soulStarCorrectWindow=result[role+'StarCorrectWindow'];
        member.innateAbilityState=result[role+'InnateAbilityState'];
        Object.assign(member,result[role+'ArtifactState']);
      }
      if(result.finished){
        finished=true;
        if(result.winnerUid==='draw')draws++;
        else if((result.winnerUid==='h'?hostOpt:guestOpt)===options[a])winsA++;
        else winsB++;
        break;
      }
    }
    if(!finished)throw Error('Unfinished battle at '+a+','+b+','+n);
  }
  totals[a].wins+=winsA;totals[b].wins+=winsB;
  totals[a].draws+=draws;totals[b].draws+=draws;
  totals[a].games+=games;totals[b].games+=games;
  pairs.push({a:options[a].name,b:options[b].name,winsA,winsB,draws});
}
const rank=options.map((x,i)=>({...x,winPercent:+(100*(totals[i].wins+totals[i].draws/2)/totals[i].games).toFixed(2)}))
  .sort((a,b)=>b.winPercent-a.winPercent);
const byCore=Object.keys(Talents.TYPES).map(type=>{
  const branches=rank.filter(row=>row.type===type);
  return {type,meanWinPercent:+(branches.reduce((sum,row)=>sum+row.winPercent,0)/branches.length).toFixed(2)};
});
console.log(JSON.stringify({accuracy,score,realmHp,baseHp:1000,grade:1,nascentMaxed:true,innateLevel:10,
  equipment:'none',maxRounds:15,gamesPerPair:games,matchCount:pairs.length*games,byCore,rank,
  sameCore:pairs.filter(row=>options.some(o=>o.name===row.a&&o.type===options.find(p=>p.name===row.b)?.type))},null,2));

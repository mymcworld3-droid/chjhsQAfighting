#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {Worker,isMainThread,parentPort}=require('node:worker_threads');
const S=require('./lib/tactical-balance.cjs');
const root=path.resolve(__dirname,'..'),coreVariants=S.variants.filter(v=>v.core!=='none');
function duelJob(job){
  const a=S.variants.find(v=>v.id===job.a),b=S.variants.find(v=>v.id===job.b),clusters=[],byMap=S.R.MAPS.map(m=>({map:m.id,games:0,winsA:0,winsB:0,draws:0}));
  const result={...job,games:0,winsA:0,winsB:0,draws:0,seat0Wins:0,turnLimit:0,totalTurns:0,castsA:0,castsB:0,byMap,clusters};delete result.kind;
  for(let seed=0;seed<job.seeds;seed++){
    const cluster={seed,games:0,winsA:0,winsB:0,draws:0};
    for(const [i,map]of S.R.MAPS.entries())for(const flip of [false,true]){
      const r=S.duel(flip?b:a,flip?a:b,{map:map.id,accuracy:job.accuracy,seed:'tactical-balance-v1:'+seed});
      const outcome=r.winner==='draw'?'draws':r.winner===(flip?'seat1':'seat0')?'winsA':'winsB';
      result.games++;result[outcome]++;cluster.games++;cluster[outcome]++;byMap[i].games++;byMap[i][outcome]++;
      if(r.winner==='seat0')result.seat0Wins++;if(r.reason==='turn-limit')result.turnLimit++;result.totalTurns+=r.turns;
      result.castsA+=r.metrics[flip?'seat1':'seat0'].skill;result.castsB+=r.metrics[flip?'seat0':'seat1'].skill;
    }clusters.push(cluster);
  }return result;
}
function trialJob(job){
  const v=S.variants.find(v=>v.id===job.variant),result={...job,games:0,wins:0,losses:0,turnLimit:0,totalTurns:0,totalHp:0,byMap:{},enemies:{}};delete result.kind;
  for(let seed=0;seed<job.seeds;seed++){
    const r=S.trial(v,{stage:job.stage,accuracy:job.accuracy,seed:'tactical-trial-v1:'+seed});
    const win=r.winner==='player';result.games++;result[win?'wins':'losses']++;if(r.reason==='turn-limit')result.turnLimit++;
    result.totalTurns+=r.turns;result.totalHp+=r.hp;result.byMap[r.map]||={games:0,wins:0};result.byMap[r.map].games++;if(win)result.byMap[r.map].wins++;
    for(const species of r.enemySpecies)result.enemies[species]=(result.enemies[species]||0)+1;
  }return result;
}
if(!isMainThread){parentPort.on('message',job=>{try{parentPort.postMessage({result:job.kind==='pvp'?duelJob(job):trialJob(job)});}catch(e){parentPort.postMessage({error:e.stack,job});}});}

function interval(clusters,key){
  // Resample independent answer-seed clusters. All maps, seat swaps and
  // opponents of one seed stay together; individual games are not IID.
  const rng=S.random('cluster-bootstrap-v1'),values=[];
  for(let i=0;i<2000;i++){
    let wins=0,games=0;for(let k=0;k<clusters.length;k++){const c=clusters[Math.floor(rng()*clusters.length)];wins+=c[key];games+=c.games;}
    values.push(100*wins/games);
  }values.sort((a,b)=>a-b);return [values[49],values[1949]];
}
function summarize(pairs,accuracy){
  const rows=coreVariants.map(v=>{
    const clusters=Array.from({length:pairs[0].seeds},(_,seed)=>({seed,games:0,wins:0,draws:0}));let games=0,wins=0,draws=0,casts=0;
    for(const p of pairs.filter(p=>p.a===v.id||p.b===v.id)){
      const key=p.a===v.id?'winsA':'winsB';games+=p.games;wins+=p[key];draws+=p.draws;
      casts+=p[p.a===v.id?'castsA':'castsB'];
      for(const c of p.clusters){clusters[c.seed].games+=c.games;clusters[c.seed].wins+=c[key];clusters[c.seed].draws+=c.draws;}
    }
    return {...v,games,wins,draws,losses:games-wins-draws,winPercent:100*wins/games,drawPercent:100*draws/games,scorePercent:100*(wins+draws*.5)/games,castsPerGame:casts/games,ci95:interval(clusters,'wins')};
  });
  const byCore=Object.keys(S.R.CORES).filter(c=>c!=='none').map(core=>{
    const branches=rows.filter(r=>r.core===core),games=branches.reduce((n,r)=>n+r.games,0),wins=branches.reduce((n,r)=>n+r.wins,0),draws=branches.reduce((n,r)=>n+r.draws,0);
    return {core,name:S.R.CORES[core].name,games,wins,draws,winPercent:100*wins/games,drawPercent:100*draws/games,scorePercent:100*(wins+.5*draws)/games};
  });
  const games=pairs.reduce((n,p)=>n+p.games,0);
  return {accuracy,games,seat0WinPercent:100*pairs.reduce((n,p)=>n+p.seat0Wins,0)/games,drawPercent:100*pairs.reduce((n,p)=>n+p.draws,0)/games,
    turnLimitPercent:100*pairs.reduce((n,p)=>n+p.turnLimit,0)/games,meanTurns:pairs.reduce((n,p)=>n+p.totalTurns,0)/games,rows,byCore};
}
function csv(rows,keys){return keys.join(',')+'\n'+rows.map(r=>keys.map(k=>JSON.stringify(r[k]??'')).join(',')).join('\n')+'\n';}
function parse(argv){
  const config={mainAccuracy:.7,seeds:64,sensitivitySeeds:8,pveSeeds:32,workers:4,stages:[1,5,10,15,20,30],accuracies:[.5,.7,.9],out:'docs/balance/tactical-v1'};
  for(let i=0;i<argv.length;i+=2){const name=argv[i],value=argv[i+1];if(value===undefined)throw Error('Missing value for '+name);
    const key={'--seeds':'seeds','--sensitivity-seeds':'sensitivitySeeds','--pve-seeds':'pveSeeds','--workers':'workers','--out':'out'}[name];
    if(!key)throw Error('Unknown option '+name);config[key]=key==='out'?value:Number(value);
  }
  for(const k of ['seeds','sensitivitySeeds','pveSeeds','workers'])if(!Number.isInteger(config[k])||config[k]<1||config[k]>10000)throw Error('Invalid '+k);
  return config;
}
async function run(config){
  const jobs=[];
  for(const accuracy of config.accuracies)for(let a=0;a<coreVariants.length;a++)for(let b=a+1;b<coreVariants.length;b++)jobs.push({kind:'pvp',a:coreVariants[a].id,b:coreVariants[b].id,accuracy,seeds:accuracy===config.mainAccuracy?config.seeds:config.sensitivitySeeds,baseline:false});
  for(const v of coreVariants)jobs.push({kind:'pvp',a:'none.breath',b:v.id,accuracy:config.mainAccuracy,seeds:config.seeds,baseline:true});
  for(const v of S.variants)for(const stage of config.stages)jobs.push({kind:'pve',variant:v.id,stage,accuracy:config.mainAccuracy,seeds:config.pveSeeds});
  const results=[],workers=[];let dispatched=0,completed=0;
  await new Promise((resolve,reject)=>{
    for(let i=0;i<Math.min(config.workers,jobs.length);i++){
      const worker=new Worker(__filename);workers.push(worker);
      worker.on('error',reject);worker.on('message',data=>{
        if(data.error){reject(Error(data.error));return;}results.push(data.result);completed++;
        if(completed%24===0||completed===jobs.length)process.stderr.write('Completed '+completed+'/'+jobs.length+' matchup batches\n');
        if(completed===jobs.length){resolve();return;}if(dispatched<jobs.length)worker.postMessage(jobs[dispatched++]);
      });worker.postMessage(jobs[dispatched++]);
    }
  }).finally(()=>Promise.all(workers.map(w=>w.terminate())));
  const pvp=config.accuracies.map(accuracy=>{
    const pairs=results.filter(r=>r.a&&!r.baseline&&r.accuracy===accuracy).sort((a,b)=>a.a.localeCompare(b.a)||a.b.localeCompare(b.b));
    return {accuracy,pairs,summary:summarize(pairs,accuracy)};
  });
  const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
  const report={schema:1,sourceRevision:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),rulesSha256:hash('public/cultivation/tactical-rules.js'),policySha256:hash('scripts/lib/tactical-balance.cjs'),
    config,stats:{atk:200,maxHp:1000,openingShield:0,equipment:'none',nascentProjection:'equalized',skillScaling:'fixed tactical coefficients'},
    variants:S.variants.map(v=>({...v,skillDefinition:S.R.CORES[v.core].branches.find(b=>b.id===v.branch).skill})),
    pvp,baseline:results.filter(r=>r.baseline).sort((a,b)=>a.b.localeCompare(b.b)),pve:results.filter(r=>r.variant).sort((a,b)=>a.variant.localeCompare(b.variant)||a.stage-b.stage)};
  const out=path.resolve(root,config.out);fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report)+'\n');
  const summary=pvp.flatMap(t=>t.summary.rows.map(r=>({...r,accuracy:t.accuracy,ciLow:r.ci95[0],ciHigh:r.ci95[1]})));
  fs.writeFileSync(path.join(out,'summary.csv'),csv(summary,['accuracy','id','coreName','branchName','skill','games','wins','draws','losses','winPercent','drawPercent','scorePercent','castsPerGame','ciLow','ciHigh']));
  fs.writeFileSync(path.join(out,'matchups.csv'),csv(pvp.flatMap(t=>t.pairs),['accuracy','a','b','games','winsA','winsB','draws','seat0Wins','turnLimit','totalTurns','castsA','castsB']));
  fs.writeFileSync(path.join(out,'trials.csv'),csv(report.pve.map(r=>({...r,winPercent:100*r.wins/r.games,meanTurns:r.totalTurns/r.games,meanHp:r.totalHp/r.games})),['accuracy','variant','stage','games','wins','losses','turnLimit','winPercent','meanTurns','meanHp']));
  process.stdout.write(JSON.stringify({out,totalMatches:results.reduce((n,r)=>n+r.games,0),main:pvp.find(t=>t.accuracy===config.mainAccuracy).summary},null,2)+'\n');return report;
}
if(isMainThread&&require.main===module)run(parse(process.argv.slice(2))).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={parse,summarize,interval,duelJob,trialJob,run};

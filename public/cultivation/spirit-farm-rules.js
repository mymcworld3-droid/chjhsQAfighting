// Shared garden configuration. Growth and harvest are settled by the server.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QASpiritFarmRules = api;
})(globalThis, function() {
  'use strict';
  const MINUTE = 60000;
  const CROPS = Object.freeze([
    {id:'jade',name:'青露草',minutes:10,yield:2,companion:'amber',seedCost:{jade:1},material:'qi-spirit-wood',materialName:'靈木',exchange:12,minScore:0,description:'生長快，適合累積建設所需的靈草。'},
    {id:'amber',name:'赤穗花',minutes:45,yield:3,companion:'moon',seedCost:{jade:3},material:'foundation-century-wood',materialName:'百年靈木',exchange:12,minScore:6,description:'中期收成，是開墾與修復水渠的重要材料。'},
    {id:'moon',name:'月華蘭',minutes:180,yield:5,companion:'jade',seedCost:{amber:3},material:'golden-lightning-wood',materialName:'雷擊木',exchange:12,minScore:28,description:'適合離線培育，細心照料可提高品質。'}
  ].map(Object.freeze));
  const STUDY_CAP = 20, ENERGY_CAP = 60;
  const CHANNEL_COST = Object.freeze({jade:4,amber:2});
  const EXPANSION_COSTS = Object.freeze([{jade:6,amber:2},{jade:12,amber:6,moon:2}]);
  const integer = x => Number.isFinite(Number(x)) ? Math.max(0,Math.min(1000000,Math.floor(Number(x)))) : 0;
  const crop = id => CROPS.find(x => x.id === id);
  const inventory = raw => Object.fromEntries(CROPS.map(c => [c.id,integer(raw?.[c.id])]));
  function initial(now) {
    return {schema:1,revision:0,createdAt:now,plots:Array(9).fill(null),openPlots:3,channel:false,
      seeds:{jade:6,amber:3,moon:1},harvest:inventory(),energy:6,totalHarvest:0,mutations:inventory(),study:{date:'',count:0,seen:[]},operations:[]};
  }
  function normalize(raw, now) {
    if (!raw) return initial(now);
    if (raw.schema !== 1) throw Error('靈田資料版本不相容');
    const plots=Array.from({length:9},(_,i)=>{
      const p=raw.plots?.[i];
      if (!p || !crop(p.cropId) || typeof p.id!=='string') return null;
      return {id:p.id.slice(0,80),cropId:p.cropId,plantedAt:Math.max(0,Number(p.plantedAt)||0),readyAt:Math.max(0,Number(p.readyAt)||0),
        originalMs:crop(p.cropId).minutes*MINUTE,watered:p.watered===true,fertilized:p.fertilized===true,channelBonus:p.channelBonus===true,
        pest:p.pest===true,cleared:p.cleared===true,mutationRoll:typeof p.mutationRoll==='number'&&p.mutationRoll>=0&&p.mutationRoll<1?p.mutationRoll:1};
    });
    return {schema:1,revision:integer(raw.revision),createdAt:Number(raw.createdAt)||now,plots,openPlots:[3,6,9].includes(raw.openPlots)?raw.openPlots:3,
      channel:raw.channel===true,seeds:inventory(raw.seeds),harvest:inventory(raw.harvest),energy:Math.min(ENERGY_CAP,integer(raw.energy)),
      totalHarvest:integer(raw.totalHarvest),mutations:inventory(raw.mutations),
      study:{date:String(raw.study?.date||'').slice(0,10),count:Math.min(STUDY_CAP,integer(raw.study?.count)),seen:Array.isArray(raw.study?.seen)?raw.study.seen.filter(x=>typeof x==='string').slice(-STUDY_CAP):[]},
      operations:Array.isArray(raw.operations)?raw.operations.slice(-64):[]};
  }
  function neighbors(index) {
    return [index-3,index+3,index%3>0?index-1:-1,index%3<2?index+1:-1].filter(i=>i>=0&&i<9);
  }
  function companion(farm,index) {
    const p=farm.plots[index],c=crop(p?.cropId);
    return !!c&&neighbors(index).some(i=>farm.plots[i]?.cropId===c.companion);
  }
  function quality(farm,index) {
    const p=farm.plots[index];if(!p)return {points:0,label:'普通',bonus:0,companion:false};
    const paired=companion(farm,index),points=Number(p.watered)+Number(p.fertilized)+Number(p.cleared)+Number(paired);
    return {points,label:points>=3?'上品':points>=2?'良品':'普通',bonus:points>=3?2:points>=2?1:0,companion:paired};
  }
  function harvestResult(farm,index) {
    const p=farm.plots[index],c=crop(p?.cropId);if(!c)return null;
    const q=quality(farm,index),mutated=p.mutationRoll<.02+Number(p.fertilized)*.05+Number(q.companion)*.03;
    return {index,cropId:c.id,name:c.name,quantity:c.yield+q.bonus+Number(mutated),seeds:mutated?2:1,quality:mutated?'變異':q.label,mutated};
  }
  function plotView(farm,index,now) {
    const p=farm.plots[index];
    if(index>=farm.openPlots)return {index,locked:true};
    if(!p)return {index,empty:true};
    const c=crop(p.cropId),ready=now>=p.readyAt;
    const progress=Math.max(0,Math.min(1,(now-p.plantedAt)/Math.max(1,p.readyAt-p.plantedAt)));
    return {index,id:p.id,cropId:c.id,name:c.name,plantedAt:p.plantedAt,readyAt:p.readyAt,ready,progress,
      stage:ready?'mature':progress>=.5?'growing':'sprout',watered:p.watered,fertilized:p.fertilized,pest:p.pest,cleared:p.cleared,
      channelBonus:p.channelBonus,...quality(farm,index)};
  }
  // Accept both stored plots and their public view, so previews and settlement
  // use identical eligibility. Time can only reduce a care batch before commit.
  function workPlan(farm,now,cropId='jade') {
    const plan={empty:[],plant:[],water:[],fertilize:[],purify:[],harvest:[]};
    for(let i=0;i<farm.openPlots;i++){
      const p=farm.plots[i];
      if(!p||p.empty){plan.empty.push(i);continue;}
      if(p.readyAt<=now){plan.harvest.push(i);continue;}
      if(!p.watered)plan.water.push(i);
      if(!p.fertilized)plan.fertilize.push(i);
      if(p.pest&&!p.cleared)plan.purify.push(i);
    }
    plan.plant=plan.empty.slice(0,crop(cropId)?integer(farm.seeds[cropId]):0);
    plan.fertilizeCost=plan.fertilize.length*2;plan.purifyCost=plan.purify.length;
    return plan;
  }
  function view(farm,now,date,score=0) {
    return {schema:1,revision:farm.revision,serverNow:now,openPlots:farm.openPlots,channel:farm.channel,
      plots:farm.plots.map((_,i)=>plotView(farm,i,now)),seeds:farm.seeds,harvest:farm.harvest,energy:farm.energy,energyCap:ENERGY_CAP,
      totalHarvest:farm.totalHarvest,mutations:farm.mutations,studyClaimed:farm.study.date===date?farm.study.count:0,studyCap:STUDY_CAP,
      expansionCost:EXPANSION_COSTS[farm.openPlots/3-1]||null,channelCost:CHANNEL_COST,
      crops:CROPS.map(c=>({...c,exchangeUnlocked:score>=c.minScore}))};
  }
  return Object.freeze({MINUTE,CROPS,STUDY_CAP,ENERGY_CAP,CHANNEL_COST,EXPANSION_COSTS,integer,crop,inventory,initial,normalize,neighbors,companion,quality,harvestResult,plotView,workPlan,view});
});

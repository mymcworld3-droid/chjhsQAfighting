// 化神本命神通：瀏覽器與團本伺服器共用。只保存養成；戰鬥計數留在單場快照。
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const Growth = node ? require('./nascent-growth.js') : root.QANascentGrowth;
  const Access = node ? require('./training-access-rules.js') : null;
  const THRESHOLD = 188, DUEL_THRESHOLD = 68, CAP = 10;
  const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const level = value => Math.min(CAP, count(value));
  const TYPES = Object.freeze({
    ocean: {name:'滄海元神', branches:[
      {id:'tide',name:'滄溟潮生',describe:n=>`答對且目標生命至少 60% 時，追加攻擊力 ${2*n}% 的普通傷害。`},
      {id:'surge',name:'百川歸海',describe:n=>`每累積答對 3 題，追加攻擊力 ${6*n}% 的普通傷害，不要求連答。`} ]},
    taichu: {name:'太初元神', branches:[
      {id:'renew',name:'太初生息',describe:n=>`每次答對回復生命上限的 ${n/2}%。`},
      {id:'devour',name:'歸元納氣',describe:n=>`每次實際回復生命時，對對手造成回復量 ${3*n}% 的真實傷害；滿血溢補不計入，轉化傷害不再觸發吸血或治療轉傷。`} ]},
    ningxin: {name:'凝心元神', branches:[
      {id:'focus',name:'一念凝鋒',describe:n=>`每連續答對 2 題，追加攻擊力 ${4*n}% 的普通傷害。答錯重新累積。`},
      {id:'calm',name:'靜心返照',describe:n=>`答錯後的下一題答對，回復生命上限的 ${Math.round(.6*n*10)/10}%；開場首題不觸發。`} ]},
    pojing: {name:'破境元神', branches:[
      {id:'execute',name:'破妄斬關',describe:n=>`元嬰斬殺生命門檻增加 ${2*n} 個百分點，由 50% 提高至 ${50+2*n}%（最高 70%），原斬殺傷害倍率不變。`},
      {id:'momentum',name:'三疊破障',describe:n=>`每累積答對 3 題，追加攻擊力 ${6*n}% 的普通傷害，不要求連答。`} ]},
    xingchen: {name:'星辰元神', branches:[
      {id:'meteor',name:'三星聚曜',describe:n=>`每作答 3 題，追加一顆攻擊力 ${6*n}% 的隕石；第三題答錯仍觸發，每顆隕石獨立命中。`},
      {id:'moon',name:'月華養神',describe:n=>`每作答 3 題，依該三題答對數，每答對一題回復 ${3*n} 生命；第三題答錯仍結算。`} ]},
    wugou: {name:'無垢元神', branches:[
      {id:'clarity',name:'無塵神光',describe:n=>`道心護體吸收普通傷害時，對攻擊者造成吸收量 ${n}% 的真實傷害；不再觸發吸血或反傷。`},
      {id:'purify',name:'洗心明性',describe:n=>`每連續答對 2 題，回復生命上限的 ${Math.round(.6*n*10)/10}%。答錯重新累積。`} ]},
    thunder: {name:'雷霆元神', branches:[
      {id:'rebound',name:'劫雷返照',describe:n=>`答對後反擊傷害額外增加 ${2*n} 個百分點，與金丹、元嬰、法寶相加；團本持續至下次首領攻擊。真傷不計入反擊基數。`},
      {id:'nourish',name:'雷息養神',describe:n=>`每累積答對 2 題，回復 ${6*n} 生命，不要求連答。`} ]},
    reverse: {name:'陰陽元神', branches:[
      {id:'defy',name:'逆命回天',describe:n=>`答對且自身生命不高於 50% 時，追加攻擊力 ${10*n}% 的普通傷害；低血時受到的普通傷害降低 ${3*n}%。`},
      {id:'balance',name:'陰陽相生',describe:n=>`每次答對回復已損失生命的 ${n}%；生命不高於 50% 時受到的普通傷害降低 ${3*n}%。`} ]},
    sword: {name:'劍心元神', branches:[
      {id:'pursuit',name:'分神御劍',describe:n=>`每累積答對 2 題，追加攻擊力 ${4*n}% 的普通傷害，不要求連答。`},
      {id:'unity',name:'劍意歸一',describe:n=>`每次答對追加攻擊力 ${1.5*n}% 的普通傷害，並回復已損失生命的 ${n/2}%。`} ]}
  });
  for (const value of Object.values(TYPES)) {
    value.branches.forEach(Object.freeze); Object.freeze(value.branches); Object.freeze(value);
  }
  const accessScore = player => (Access || root.QATrainingAccessRules)?.score(player) ?? count(player?.stats?.totalScore);
  function branches(type) { return TYPES[type]?.branches || []; }
  function normalize(raw) {
    const paths = {};
    if (raw?.version === 1) for (const type of Object.keys(TYPES)) {
      const path = raw.paths?.[type];
      if (branches(type).some(b=>b.id===path?.branch) && level(path.level)>0)
        paths[type] = {branch:path.branch,level:level(path.level)};
    }
    return {version:1,paths};
  }
  function status(player={}) {
    const type=player.cultivationTraining?.equippedCore?.type, growth=normalize(player.innateAbilityGrowth);
    const path=growth.paths[type] || null;
    const reason=accessScore(player)<THRESHOLD?'化神境界解鎖':!TYPES[type]?'請先調御金丹':'';
    const fragments=Growth.prepare(player).fragments;
    const cost=path&&path.level<CAP?path.level+1:0;
    return {ok:!reason,reason,type,growth,path,fragments,cost,
      canUpgrade:!reason&&!!path&&path.level<CAP&&fragments>=cost};
  }
  function select(player,branch) {
    const result=status(player);
    if (!result.ok) return result;
    if (!branches(result.type).some(b=>b.id===branch)) return {...result,ok:false,reason:'未知神通變化'};
    result.growth.paths[result.type]={branch,level:result.path?.level || 1};
    return result;
  }
  function upgrade(player) {
    const result=status(player);
    if (!result.canUpgrade) return {...result,ok:false,reason:result.reason||(!result.path?'請先選擇神通變化':result.path.level>=CAP?'神通已圓滿':'元嬰碎精不足')};
    result.resources=Growth.prepare(player);
    result.resources.inventory[Growth.ITEM_ID]-=result.cost;
    result.resources.fragments-=result.cost;
    result.growth.paths[result.type].level++;
    return result;
  }
  function patch(result) {
    return {...(result.resources?Growth.patch(result.resources):{}),innateAbilityGrowth:result.growth};
  }
  function apply(player,result) {
    if(result.resources) Growth.apply(player,result.resources);
    player.innateAbilityGrowth=result.growth;
  }
  function snapshot(player={}) {
    const result=status(player);
    if(!result.ok||!result.path||player.cultivationTraining?.coreEnabled===false)return null;
    return {version:1,type:result.type,...result.path};
  }
  // Room snapshots never accept a different core's powers or a pre-Huashen owner.
  function active(player) {
    const value=player?.innateAbility;
    if(value?.version!==1||Math.max(count(player?.totalScore),count(player?.trainingAccessScore))<THRESHOLD ||
       player?.goldenCore?.type!==value.type||!branches(value.type).some(b=>b.id===value.branch)||!level(value.level))return null;
    return {...value,level:level(value.level)};
  }
  function suppressForDuel(player,opponent) {
    if(!player?.innateAbility||count(opponent?.totalScore)>=DUEL_THRESHOLD)return player;
    return {...player,innateAbility:null,innateAbilityState:null,innateAbilitySuppressed:true};
  }
  function advance(player,correct) {
    if(!active(player))return null;
    const old=player.innateAbilityState || {}, answers=count(old.answers)%3+1;
    const windowCount=Math.min(3,count(old.windowCorrect)+(correct===true?1:0));
    return {answers:answers===3?0:answers,windowCorrect:answers===3?0:windowCount,
      windowReady:answers===3,windowCount,
      correctCount:(count(old.correctCount)+(correct===true?1:0))%6,
      streak:correct===true?count(old.streak)+1:0,
      previousWrong:old.correct===false,correct:correct===true,reflectReady:correct===true};
  }
  function healingOnAnswer(player) {
    const a=active(player),s=player?.innateAbilityState;
    if(!a||!s||Number(player.hp)<=0)return 0;
    const n=a.level,b=a.branch;
    let heal=0;
    if(a.type==='xingchen'&&b==='moon'&&s.windowReady)heal=s.windowCount*3*n;
    if(s.correct) {
      if(a.type==='taichu'&&b==='renew')heal=Number(player.maxHp)*.005*n;
      if(a.type==='ningxin'&&b==='calm'&&s.previousWrong)heal=Number(player.maxHp)*.006*n;
      if(a.type==='wugou'&&b==='purify'&&s.streak%2===0)heal=Number(player.maxHp)*.006*n;
      if(a.type==='thunder'&&b==='nourish'&&s.correctCount%2===0)heal=6*n;
      if(a.type==='reverse'&&b==='balance')heal=Math.max(0,Number(player.maxHp)-Number(player.hp))*.01*n;
      if(a.type==='sword'&&b==='unity')heal=Math.max(0,Number(player.maxHp)-Number(player.hp))*.005*n;
    }
    return Math.min(Math.max(0,Number(player.maxHp)-Number(player.hp)),Math.max(0,Math.round(heal)));
  }
  function attack(player,target) {
    const a=active(player),s=player?.innateAbilityState;
    const result={normal:0,trueDamage:0,name:''};
    if(!a||s?.correct!==true)return result;
    const n=a.level,b=a.branch,p=Math.min(600,count(player.atk));
    const enemy=Number(target?.hp)/Math.max(1,Number(target?.maxHp)||1);
    const own=Number(player.hp)/Math.max(1,Number(player.maxHp)||1);
    let factor=0;
    if(a.type==='ocean')factor=b==='tide'?(enemy>=.6?.02*n:0):(s.correctCount%3===0?.06*n:0);
    if(a.type==='ningxin'&&b==='focus'&&s.streak%2===0)factor=.04*n;
    if(a.type==='pojing'&&b==='momentum')factor=s.correctCount%3===0?.06*n:0;
    if(a.type==='reverse'&&b==='defy'&&own<=.5)factor=.10*n;
    if(a.type==='sword')factor=b==='pursuit'?(s.correctCount%2===0?.04*n:0):.015*n;
    result.normal=Math.round(p*factor);
    result.name=branches(a.type).find(row=>row.id===b).name;
    return result;
  }
  function reflection(player,normalReceived) {
    const a=active(player);
    return a?.type==='thunder'&&a.branch==='rebound'&&player.innateAbilityState?.reflectReady===true
      ?Math.round(Math.max(0,normalReceived)*.02*a.level):0;
  }
  function healingDamage(player,actualHealed) {
    const a=active(player);
    return a?.type==='taichu'&&a.branch==='devour'?Math.round(count(actualHealed)*.03*a.level):0;
  }
  // Low-HP defensive passive shared by both Yin-Yang paths; real damage bypasses normal mitigation.
  function damageReduction(player) {
    const a=active(player);
    if(a?.type!=='reverse'||Number(player.hp)<=0)return 0;
    const maxHp=Math.max(1,Number(player.maxHp)||1);
    return Number(player.hp)/maxHp<=.5 ? .03*a.level : 0;
  }
  function executeThreshold(player) {
    const a=active(player);
    return a?.type==='pojing'&&a.branch==='execute'?Math.min(.7,(50+2*a.level)/100):.5;
  }
  function meteorDamage(player) {
    const a=active(player);
    return a?.type==='xingchen'&&a.branch==='meteor'&&player.innateAbilityState?.windowReady
      ?Math.round(Math.min(600,count(player.atk))*.06*a.level):0;
  }
  function shieldDamage(player,absorbed) {
    const a=active(player);
    return a?.type==='wugou'&&a.branch==='clarity'?Math.round(count(absorbed)*.01*a.level):0;
  }
  const api=Object.freeze({THRESHOLD,DUEL_THRESHOLD,CAP,TYPES,branches,normalize,status,select,upgrade,patch,apply,snapshot,
    active,suppressForDuel,advance,healingOnAnswer,attack,reflection,healingDamage,damageReduction,executeThreshold,meteorDamage,shieldDamage});
  if(node)module.exports=api;else root.QAInnateAbility=api;
})(globalThis);

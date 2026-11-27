/* Shared immutable technique catalog. Rules run identically in the browser and server. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QAManuals=api;
})(globalThis,()=>{
  'use strict';
  // Each successful manual killing blow earns XP for that scripture.
  // Lv. 1 -> 2 costs 40 XP; each following level costs 20 XP more.
  const EXP_PER_KILL=50,MAX_LEVEL=20,MAX_GOLD_LEVEL=10,MAX_EXP=10*(MAX_LEVEL-1)*(MAX_LEVEL+2),MAX_SKILL_LEVEL=5;
  // Exactly the existing cultivation score cutoffs, with human-readable realm labels.
  const REALMS=Object.freeze([
    {name:'煉氣',score:1,stage:1,exp:20},
    {name:'築基',score:6,stage:5,exp:35},
    {name:'金丹',score:28,stage:10,exp:55},
    {name:'元嬰',score:68,stage:20,exp:85},
    {name:'化神',score:188,stage:35,exp:120},
    {name:'煉虛',score:428,stage:55,exp:170},
    {name:'合體',score:788,stage:80,exp:235},
    {name:'渡劫',score:1268,stage:110,exp:320},
    {name:'真仙',score:1868,stage:150,exp:430}
  ].map(Object.freeze));
  const normalizedScore=value=>Number.isFinite(Number(value))?
    Math.max(0,Math.floor(Number(value))):0;
  const realmForScore=score=>REALMS.findLast(realm=>normalizedScore(score)>=realm.score)||{name:'凡人',score:0};
  const realmForStage=stage=>REALMS.findLast(realm=>Math.max(1,Math.floor(Number(stage)||1))>=realm.stage)||REALMS[0];
  const expForBeast=stage=>realmForStage(stage).exp;
  // Compatibility helper for old callers; techniques have no realm gate.
  const meetsRealm=skill=>!!skill;
  const xpForNextLevel=level=>40+20*(Math.max(1,Math.floor(level))-1);
  const totalExpForLevel=level=>{
    const steps=Math.max(0,Math.floor(level)-1);
    return 10*steps*(steps+3);
  };
  function levelForExp(raw){
    const xp=Math.max(0,Math.min(MAX_EXP,Math.floor(Number(raw)||0)));
    let level=Math.max(1,Math.floor((Math.sqrt(9+xp/2.5)-3)/2)+1);
    // Protect exact level boundaries from floating-point rounding.
    while(level>1&&totalExpForLevel(level)>xp)level--;
    while(totalExpForLevel(level+1)<=xp)level++;
    return level;
  }
  function mastery(raw){
    const exp=Math.max(0,Math.min(MAX_EXP,Math.floor(Number(raw)||0)));
    const level=levelForExp(exp);
    if(level===MAX_LEVEL)return {level,exp,totalExp:exp,expInLevel:0,expToNext:0,progress:100};
    const current=exp-totalExpForLevel(level),needed=xpForNextLevel(level);
    return {level,exp,totalExp:exp,expInLevel:current,expToNext:needed,progress:Math.min(100,Math.floor(current/needed*100))};
  }
  function upgradeQuote(raw){
    const {level,exp}=mastery(raw);
    // Gold can only bridge missing EXP to Lv.10; Lv.11–20 are earned in PvE.
    if(level>=MAX_GOLD_LEVEL)return null;
    const targetLevel=level+1,targetExp=totalExpForLevel(targetLevel);
    return {targetLevel,targetExp,gold:(targetExp-exp)*2};
  }
  // Old saves only tracked kills. Map their existing unlock thresholds to
  // Lv. 5 / Lv. 10 so nobody loses an already-unlocked skill during migration.
  function legacyKillsToExp(raw){
    const kills=Math.max(0,Math.floor(Number(raw)||0));
    const toFive=totalExpForLevel(5),toTen=totalExpForLevel(10);
    if(kills<=3)return Math.floor(toFive*kills/3);
    if(kills<=8)return toFive+Math.floor((toTen-toFive)*(kills-3)/5);
    return Math.min(MAX_EXP,toTen+(kills-8)*EXP_PER_KILL);
  }
  const technique=(id,name,cost,range,kind,power,description,extra={})=>
    Object.freeze({id,name,cost,range,kind,power,description,...extra,cooldown:0});
  const book=(id,name,school,description,skills,tierRealm='煉氣')=>Object.freeze({
    id,name,school,weaponType:school==='sword'?'sword':'totem',description,tierRealm,skills:Object.freeze(skills.map((skill,index)=>
      Object.freeze({...skill,moveId:skill.moveId||skill.id,manualId:id,school,
        levelRequired:[1,5,10][index]})))
  });
  // Each book keeps its own unlock and EXP source even for a shared move.
  const shared=(move,id,power)=>({...move,id,moveId:move.id,power});
  const straight=technique('wind-slash','流風斬',2,3,'line',1.2,'選擇一個方向，斬擊前方直線三格。');
  const breakLine=technique('wind-thousand','遠線破擊',4,null,'line',2,
    '劍氣沿直線延伸至石障或邊界。命中後將存活敵人推至最遠的可落腳格。',{unlimited:true,pushToEdge:true});
  const straightFist=technique('rock-fist','直拳',2,2,'line',1.3,'攻擊前方直線兩格。');
  const ORIGINAL_BOOKS=Object.freeze([
    book('sword-wind','流風靈劍','sword','以身法切入，再以劍氣逼退敵人。',[
      straight,
      technique('wind-step','突進橫斬',4,4,'dash-cleave',2.4,
        '沿直線突進最多四格，再揮出三格寬的劍氣兩次。',{hits:2}),
      breakLine
    ]),
    book('sword-flight','御靈飛劍','sword','御使飛劍，控制敵人的站位。',[
      shared(straight,'flight-slash',1.5),
      technique('flight-summon','召劍',3,2,'flying-sword',2.4,
        '在自身曼哈頓距離兩格內的空地召劍。場上已有飛劍時，飛劍沿優先經過靈獸的最短路徑回到所選位置，沿途造成傷害。另可在移動選項中以每兩格一體力移動飛劍（移動傷害低於召劍回擊）。',
        {travel:4,cooldown:0,movePower:.85}),
      shared(breakLine,'flight-break',2.8)
    ],'築基'),
    // Preserve the former 青霄劍典 book and slot IDs in existing saves.
    book('sword-sky','八方天劍','sword','以多路劍氣交擊一點，兼及周圍敵人。',[
      shared(straight,'sky-pierce',1.9),
      technique('sky-cloud','交叉劍斬',4,3,'sword-array',1.8,
        '選擇三格內的中心，揮出兩道交叉劍氣，各從中心向兩端延伸兩格。中心最多命中兩次。',
        {diagonal:2,centerPower:4}),
      technique('sky-sever','八方合劍',6,4,'sword-array',2,
        '選擇四格內的中心。正向各延伸三格、斜向各延伸兩格，八路劍氣向中心匯聚。',
        {orthogonal:3,diagonal:2,centerPower:6})
    ],'金丹'),
    book('body-rock','玄嶽圖騰','body','突進破陣，將敵人擊退。',[
      straightFist,
      technique('rock-quake','突進震拳',3,3,'dash-cleave',1.8,
        '直線突進最多三格，再攻擊落點前方的 T 形四格。',{tShape:true}),
      technique('rock-break','崩山拳',3,2,'fist-sweep',1.95,
        '攻擊前方 T 形四格，將命中的敵人沿出拳方向擊退最多三格。',{tShape:true,push:3})
    ]),
    book('body-dragon','龍象圖騰','body','連步逼退對手，蓄勢後連續出拳。',[
      shared(straightFist,'dragon-strike',2),
      technique('dragon-guard','四步連推',4,1,'fist-chain',1.2,
        '最多四段。每段攻擊前方一排並將敵人推退一格，再前進一格。敵人無法被推退時追加撞擊傷害；前路受阻則停止。',{steps:4,collisionPower:.6}),
      technique('dragon-roar','蓄勢',7,0,'fist-focus',0,
        '立即結束回合。接下來自己的兩個回合各可出手三次，其他拳法體力消耗減半並向上取整。',{cooldown:3})
    ],'金丹'),
    book('body-tiger','伏虎圖騰','body','以步法貼近敵人，借力改變敵人的站位。',[
      shared(straightFist,'tiger-fist',1.6),
      technique('tiger-step','踏步連拳',4,2,'dash-cleave',3.2,
        '直線踏步最多兩格，再攻擊落點前方橫排三格兩次。',{hits:2}),
      technique('tiger-throw','翻摔',4,1,'fist-throw',3,
        '將身前橫排三格內的敵人摔到身後的對應格，落地時造成傷害。若對應落點有障礙或被占用，該目標留在原地。')
    ],'築基')
  ]);
  // One authoritative definition of all six new weapons. A release candidate
  // can be tested by changing this literal in an isolated checkout only.
  const RELEASE_NEW_WEAPONS=false;
  const DEVELOPMENT_BOOKS=(()=>{
  const freeze=o=>{if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
  const skill=(id,name,cost,range,kind,power,description,extra={})=>({id,name,cost,range,kind,power,description,cooldown:0,...extra});
  const book=(id,name,school,tierRealm,description,skills,extra={})=>({id,name,school,weaponType:school==='body'?'totem':'sword',tierRealm,description,
    release:'development',...extra,skills:skills.map((s,i)=>({...s,moveId:s.id,manualId:id,school,levelRequired:[1,5,10][i]}))});
  return freeze([
    book('sword-prism','折光靈劍','sword','煉氣','以地形碰撞、法線反射與漫射攻擊敵人。',[
      skill('prism-slash','流光斬',2,3,'prism-slash',1.2,'沿指定方向攻擊直線三格，遇障礙停止。'),
      skill('prism-reflect','折壁穿斬',4,null,'prism-reflect',1.6,'劍氣延伸至碰撞面，再沿法線向可通行側延伸三格。',{unlimited:true,reflectionRange:3,powers:{initial:1.6,reflected:1},maxTargetPower:2.6}),
      skill('prism-scatter','漫光斬',4,null,'prism-scatter',1,'碰撞後向左右九十度與一百三十五度漫射，最多兩層。',{unlimited:true,branchTurns:[-3,-2,2,3],maxDepth:2,maxRays:21,powers:{initial:1,first:.7,second:.35},maxTargetPower:2.4})
    ]),
    book('body-bell','鳴鐘圖騰','body','煉氣','以正方形震波與逐層擊退連續命中。',[
      skill('bell-strike','鳴拳',2,2,'bell-strike',1.3,'攻擊前方直線兩格。'),
      skill('bell-shock','震鐘',3,0,'bell-shock',1.65,'以自身為中心攻擊二格正方形，不含自己，向外擊退一格。',{radius:2,push:1,excludeCenter:true}),
      skill('bell-echo','回響',4,0,'bell-echo',.65,'依次攻擊四層正方形外圈，每層結算後擊退一格。',{rings:4,push:1,maxTargetPower:2.6})
    ]),
    book('sword-weave','織界靈劍','sword','築基','以劍痕、兩點連線及封閉劍陣布置戰場。',[
      skill('weave-mark','刻界',2,3,'weave-mark',1.5,'直線攻擊三格，在有效指定位置留下劍痕。',{maxMarks:3,objectType:'mark'}),
      skill('weave-thread','牽絲',3,null,'weave-thread',2.25,'選取兩道劍痕或本體與一道劍痕，第二端點點擊即施放；靈絲可穿牆。',{endpointCount:2,allowOwnerEndpoint:true}),
      skill('weave-domain','織界',4,0,'weave-domain',2.4,'至少兩道劍痕；兩點連線、三點共線或三角封閉區域皆可穿牆攻擊有效格。',{minMarks:2,powers:{two:2.4,collinear:2.8,polygon:3.2},maxTargetPower:3.2})
    ]),
    book('body-mirror','蜃影圖騰','body','築基','以地圖中心點對稱蜃影同步複製合法體術。',[
      skill('mirror-strike','虛形拳',2,2,'mirror-strike',1.6,'攻擊前方兩格；已啟用蜃影時同步複製。'),
      skill('mirror-summon','金蟬脫殼',4,0,'mirror-summon',2.8,'啟用唯一蜃影，於點對稱位置釋放九格攻擊。',{radius:1,objectType:'mirror',noMirrorCopy:true}),
      skill('mirror-swap','虛實互換',4,0,'mirror-swap',1.6,'與蜃影合法換位，兩處各釋放九格攻擊。',{radius:1,hits:2,maxTargetPower:3.2,noMirrorCopy:true})
    ],{mirrorCopyFactor:.3}),
    book('sword-time','歲輪天劍','sword','金丹','保留施放位置的時間殘影，與本體多重合擊。',[
      skill('time-slash','刻時斬',2,3,'time-slash',1.9,'攻擊直線三格，於施放原點留下殘影。',{maxEchoes:2,objectType:'echo'}),
      skill('time-double','昔影重斬',4,4,'time-double',2,'本體與最新殘影各自向同一目標出劍。',{minEchoes:1,maxSources:2,maxTargetPower:4}),
      skill('time-union','三世歸一',6,4,'time-union',2,'本體與所有殘影合擊，之後消耗所有殘影。',{minEchoes:1,maxSources:3,maxTargetPower:6,consumeEchoes:true})
    ]),
    book('body-gravity','星隕圖騰','body','金丹','以持續右旋吸引的星核布置高傷害墜擊。',[
      skill('gravity-strike','沉星拳',2,2,'gravity-strike',2,'攻擊前方直線兩格。'),
      skill('gravity-core','引力星核',4,2,'gravity-core',.8,'在空地放置星核，吸引曼哈頓三格內敵人並逐次造成傷害。',{radius:3,maxTriggers:5,push:1,maxTargetPower:4,objectType:'core',noMirrorCopy:true}),
      skill('gravity-crash','萬象星隕',5,2,'gravity-crash',5.5,'躍至合法星核落點並引爆，依曼哈頓距離結算一次最高傷害。',{radius:3,powers:{near:5.5,middle:3,outer:1.5},maxTargetPower:5.5,consumeCore:true,noMirrorCopy:true})
    ])
  ]);
  })();
  const BOOKS=Object.freeze(RELEASE_NEW_WEAPONS?[...ORIGINAL_BOOKS,...DEVELOPMENT_BOOKS]:[...ORIGINAL_BOOKS]);
  const BY_BOOK=Object.freeze(Object.fromEntries(BOOKS.map(book=>[book.id,book])));
  const BY_SKILL=Object.freeze(Object.fromEntries(BOOKS.flatMap(book=>book.skills.map(skill=>[skill.id,skill]))));
  const skillLevel=raw=>Number.isInteger(raw)&&raw>=1&&raw<=MAX_SKILL_LEVEL?raw:1;
  const skillUpgradeQuote=level=>level<MAX_SKILL_LEVEL?{targetLevel:level+1,gold:200*level}:null;
  const MAX_REFINEMENT=5, REFINEMENT_PERCENT=5;
  const refinement=raw=>Math.max(0,Math.min(MAX_REFINEMENT,Math.trunc(Number(raw)||0)));
  const copyCount=record=>Math.max(1,Object.values(record?.copies||{}).reduce((sum,n)=>sum+Math.max(0,Math.trunc(Number(n)||0)),0));
  const refinementFor=record=>record?Math.max(refinement(record.refinement),refinement(copyCount(record)-1)):0;
  const refinementPercent=stars=>refinement(stars)*REFINEMENT_PERCENT;
  function skillAtLevel(skill,raw,stars=0){
    const level=skillLevel(raw),upgrades=level-1;
    if(skill.kind==='fist-focus')return {...skill,level,cost:Math.max(5,skill.cost-Math.ceil(upgrades/2))};
    const refine=refinement(stars),factor=1+refinementPercent(refine)/100;
    const scaled=power=>{const base=upgrades?power*(10+upgrades)/10:power;return refine?base*factor:base;};
    return {...skill,level,power:scaled(skill.power),
      ...(skill.centerPower!==undefined?{centerPower:scaled(skill.centerPower)}:{}),
      ...(skill.collisionPower!==undefined?{collisionPower:scaled(skill.collisionPower)}:{}),
      ...(skill.movePower!==undefined?{movePower:scaled(skill.movePower)}:{}),
      ...(skill.powers?{powers:Object.fromEntries(Object.entries(skill.powers).map(([id,power])=>[id,scaled(power)]))}:{}),
      ...(skill.maxTargetPower!==undefined?{maxTargetPower:scaled(skill.maxTargetPower)}:{})};
  }
  // The tactical engine rounds EACH strike before applying shields, guard
  // or remaining HP. This preview intentionally describes raw per-hit damage,
  // never the sum of all hits or all enemies in an area.
  function singleHitDamage(attack,skill,{flyingSwordReady=null}={}){
    const atk=Number(attack);
    const safeAttack=Number.isFinite(atk)?Math.max(1,atk):200;
    const raw=Number(skill?.power);
    const power=Number.isFinite(raw)?Math.max(0,raw):0;
    const hit=value=>Math.max(0,Math.round(safeAttack*value));
    if(!skill||skill.kind==='fist-focus'){
      return {damage:0,direct:false,label:'無直接傷害',note:'蓄勢只提供後續回合的出手與體力強化'};
    }
    if(skill.kind==='flying-sword'&&flyingSwordReady===false){
      return {damage:0,direct:false,label:'召劍（0 傷害）',potential:hit(power),
        note:'本次先召喚飛劍，不造成傷害；下次移動飛劍才會命中'};
    }
    const split=skill.hits===2&&skill.kind!=='mirror-swap';
    const damage=hit(power/(split?2:1));
    const result={damage,direct:true,label:'單次攻擊力 '+damage,
      note:split?'每次命中獨立結算，最多攻擊兩次':null};
    if(skill.kind==='flying-sword')
      result.note=flyingSwordReady===true?'飛劍每穿過一名敵人時各結算一次':
        '首次召劍不造成傷害；之後移動飛劍穿過敵人時結算';
    if(skill.kind==='fist-chain')
      result.note='每一步命中分別計算，最多四段；無法推退目標時額外造成撞擊傷害';
    if(skill.kind==='fist-throw')
      result.note='只有成功摔到身後空格時才造成傷害';
    if(skill.kind==='sword-array'&&skill.centerPower!==undefined){
      const centerPower=Number(skill.centerPower);
      // Crossed sword beams deal centerPower/2 each for up to two sweeps.
      // Eight-direction beams deal centerPower/8 on EACH ray that reaches center.
      const centerValue=skill.orthogonal?centerPower/8:centerPower/2;
      result.center=hit(Number.isFinite(centerValue)?Math.max(0,centerValue):0);
      result.centerHits=skill.orthogonal?8:2;
      result.note='一般劍氣每擊 '+damage+'；中心交會每擊 '+result.center+
        '（最多 '+result.centerHits+' 次；實際依劍氣路線）';
    }
    return result;
  }
  // Present the actual raw per-hit amount in the technique description,
  // rather than adding another visible badge to narrow combat controls.
  // Target guard/shields and remaining HP can reduce damage actually dealt.
  function descriptionWithDamage(attack,skill,options={}){
    if(!skill)return '';
    const description=String(skill.description||'').trim();
    const value=singleHitDamage(attack,skill,options);
    const fmt=n=>Math.max(0,Math.round(n)).toLocaleString('zh-TW');
    let suffix='';
    const hit=p=>fmt(Number(attack)*p);
    const special={
      'prism-reflect':()=> '初段 '+hit(skill.powers.initial)+'、法線反射 '+hit(skill.powers.reflected)+' 傷害。',
      'prism-scatter':()=> '初段 '+hit(skill.powers.initial)+'、第一次漫射 '+hit(skill.powers.first)+'、第二次漫射 '+hit(skill.powers.second)+'；每敵倍率上限 '+hit(skill.maxTargetPower)+'（逐擊取整）。',
      'bell-echo':()=> '每層 '+hit(skill.power)+' 傷害，最多四層；每層擊退後重判。',
      'weave-domain':()=> '兩痕 '+hit(skill.powers.two)+'、三痕共線 '+hit(skill.powers.collinear)+'、三角陣 '+hit(skill.powers.polygon)+' 傷害。',
      'mirror-strike':()=> '本體 '+hit(skill.power)+'，已召喚的蜃影另造成 '+hit(skill.power*.3)+' 傷害。',
      'mirror-swap':()=> '兩處各 '+hit(skill.power)+' 傷害，重疊可命中兩次。',
      'time-double':()=> '每道劍氣 '+hit(skill.power)+' 傷害，最多兩道。',
      'time-union':()=> '每道劍氣 '+hit(skill.power)+' 傷害，最多三道。',
      'gravity-core':()=> '每波 '+hit(skill.power)+' 傷害，最多 '+skill.maxTriggers+' 次。',
      'gravity-crash':()=> '中心及相鄰 '+hit(skill.powers.near)+'、距離二 '+hit(skill.powers.middle)+'、距離三 '+hit(skill.powers.outer)+' 傷害。'
    };
    if(Object.hasOwn(special,skill.kind))return description+special[skill.kind]();
    if(skill.kind==='fist-focus'){
      suffix='不造成直接傷害。';
    }else if(skill.kind==='flying-sword'){
      const amount=fmt(value.potential??value.damage);
      if(options.flyingSwordReady===true)
        suffix='本次移動飛劍，穿過敵人時每次造成 '+amount+' 傷害。';
      else if(options.flyingSwordReady===false)
        suffix='本次召劍不造成傷害；之後飛劍移動命中時每次造成 '+amount+' 傷害。';
      else suffix='首次召劍不造成傷害；之後飛劍移動命中時每次造成 '+amount+' 傷害。';
    }else if(value.center!==undefined){
      suffix='一般劍氣每擊造成 '+fmt(value.damage)+' 傷害；中心交點最多造成 '+
        value.centerHits+' 次 '+fmt(value.center)+' 的傷害（依實際劍氣路線）。';
    }else if(skill.hits===2){
      suffix='造成 '+skill.hits+' 次 '+fmt(value.damage)+' 的傷害（戰場攻擊力 '+fmt(attack)+' × 每擊倍率 '+
        Number((skill.power/skill.hits).toFixed(3))+'；每次命中獨立結算）。';
    }else if(skill.kind==='fist-chain'){
      suffix='最多造成 '+skill.steps+' 次 '+fmt(value.damage)+' 的傷害（依實際踏步命中情況）；若無法推退，額外造成 '+fmt(Math.round(attack*(skill.collisionPower||0)))+' 撞擊傷害。';
    }else if(skill.kind==='fist-throw'){
      suffix='成功翻摔時造成 '+fmt(value.damage)+' 傷害。';
    }else{
      suffix='造成 '+fmt(value.damage)+' 傷害。';
    }
    // Keep the existing skill description, only append the computed clause.
    if(skill.kind==='fist-throw'&&description.includes('落地時造成傷害')){
      return description.replace('落地時造成傷害',
        '落地時造成 '+fmt(value.damage)+' 傷害');
    }
    if(skill.kind==='flying-sword'){
      const amount=fmt(value.potential??value.damage);
      const described=description.replace('穿過敵人時造成傷害',
        '穿過敵人時每次造成 '+amount+' 傷害').replace('沿途造成傷害',
        '沿途每次造成 '+amount+' 傷害');
      return described+'一般飛劍移動每名靈獸造成 '+fmt(Math.round(attack*(skill.movePower||0)))+' 傷害。'+(options.flyingSwordReady===true?'':options.flyingSwordReady===false
        ?'本次召劍不造成傷害。':'首次召劍不造成傷害。');
    }
    if(suffix.startsWith('造成 ')){
      return (description.endsWith('。')?description.slice(0,-1):description)+'，'+suffix;
    }
    return description+suffix;
  }
  const publicSkill=(skill,masteryLevel,score,rank,stars)=>{
    const mastered=masteryLevel>=skill.levelRequired;
    const unlocked=mastered,stats=skillAtLevel(skill,rank,stars);
    return {...stats,mastered,realmReady:true,
      unlocked,upgrade:unlocked?skillUpgradeQuote(stats.level):null};
  };
  function normalizeLegacy(raw){
    const books={};
    for(const [id,record] of Object.entries(raw?.books||{})){
      if(!Object.hasOwn(BY_BOOK,id))continue;
      const exp=Object.prototype.hasOwnProperty.call(record||{},'exp')
        ?Number(record.exp):legacyKillsToExp(record?.kills);
      const tierRealm=BY_BOOK[id].tierRealm;
      const copies=copyCount(record);
      const stars=refinementFor(record);
      books[id]={exp:mastery(exp).exp,
        ...(record?.tierRealm||record?.copies?{tierRealm,copies:{[tierRealm]:copies}}:{}),
        ...(stars?{refinement:stars}:{})};
    }
    const school=['sword','body'].includes(raw?.school)?raw.school:null;
    const equipped=[],moves=new Set();
    for(const id of (Array.isArray(raw?.equipped)?raw.equipped:[])){
      const skill=BY_SKILL[id],owned=books[skill?.manualId];
      if(skill&&owned&&levelForExp(owned.exp)>=skill.levelRequired
        &&!moves.has(skill.moveId)&&equipped.length<3){
        equipped.push(id);moves.add(skill.moveId);
      }
    }
    const skillLevels={};
    for(const [id,value] of Object.entries(raw?.skillLevels||{})){
      if(!Object.hasOwn(BY_SKILL,id))continue;
      const level=skillLevel(value),skill=BY_SKILL[id],owned=books[skill.manualId];
      if(level>1&&owned&&levelForExp(owned.exp)>=skill.levelRequired)skillLevels[id]=level;
    }
    const cleanIds=ids=>{
      const result=[],used=new Set();
      for(const id of Array.isArray(ids)?ids:[]){
        const skill=BY_SKILL[id],book=books[skill?.manualId];
        if(skill&&book&&levelForExp(book.exp)>=skill.levelRequired&&!used.has(skill.moveId)&&result.length<3){result.push(id);used.add(skill.moveId);}
      }
      return result;
    };
    const activeLoadout=Number.isInteger(raw?.activeLoadout)&&raw.activeLoadout>=0&&raw.activeLoadout<3?raw.activeLoadout:0;
    const loadouts=Array.from({length:3},(_,i)=>({
      name:typeof raw?.loadouts?.[i]?.name==='string'&&raw.loadouts[i].name.trim()?Array.from(raw.loadouts[i].name.trim()).slice(0,20).join(''):`配置 ${i+1}`,
      skillIds:cleanIds(raw?.loadouts?.[i]?.skillIds??(i===0?equipped:[]))
    }));
    // The established equipped field is authoritative for backwards-compatible writes.
    loadouts[activeLoadout].skillIds=[...equipped];
    return {version:2,school,books,equipped,skillLevels,loadouts,activeLoadout,
      dropMisses:Math.max(0,Math.min(3,Math.trunc(Number(raw?.dropMisses)||0))),
      starterClaimed:raw?.starterClaimed===true};
  }

  // V3 stores at most two unique owned weapons. An equipped weapon grants
  // all three techniques at their original Lv.1/5/10 proficiency thresholds.
  function normalize(raw){
    const legacy=normalizeLegacy(raw);
    if(!Array.isArray(raw?.weaponIds))return legacy;
    const used=new Set(),weaponIds=Array.from({length:2},(_,index)=>{
      const id=raw.weaponIds[index];
      if(typeof id!=='string'||!legacy.books[id]||!BY_BOOK[id]||used.has(id))return null;
      used.add(id);return id;
    });
    const loadouts=weaponIds.map(weaponId=>({
      name:weaponId?BY_BOOK[weaponId].name:'空白武器槽',
      weaponId,
      skillIds:weaponId?BY_BOOK[weaponId].skills
        .filter(skill=>levelForExp(legacy.books[weaponId].exp)>=skill.levelRequired)
        .map(skill=>skill.id):[]
    }));
    // There is no "main" weapon. Every equipped weapon's unlocked moves are
    // available simultaneously. Both slots are independently editable.
    const equipped=loadouts.flatMap(slot=>slot.skillIds);
    return {...legacy,version:3,weaponIds,loadouts,activeLoadout:0,
      equipped};
  }
  // Preserve the six original book IDs, their EXP, and upgraded skill levels.
  // Project old skill presets into weapon slots only when a V3 save is written.
  function weaponize(raw){
    if(Array.isArray(raw?.weaponIds))return normalize(raw);
    const legacy=normalizeLegacy(raw),weaponIds=[null,null],used=new Set();
    const add=(id,slot)=>{
      if(!id||!legacy.books[id]||used.has(id))return false;
      if(slot<0||slot>1||weaponIds[slot])return false;
      weaponIds[slot]=id;used.add(id);return true;
    };
    const active=legacy.activeLoadout;
    add(BY_SKILL[legacy.equipped[0]]?.manualId,0);
    legacy.loadouts.forEach((item,index)=>add(BY_SKILL[item.skillIds[0]]?.manualId,index));
    const leftovers=[...legacy.equipped,...legacy.loadouts.flatMap(item=>item.skillIds)];
    for(const skillId of leftovers){
      const bookId=BY_SKILL[skillId]?.manualId;
      if(!used.has(bookId))add(bookId,weaponIds.findIndex(item=>!item));
    }
    return normalize({...legacy,version:3,weaponIds});
  }
  function unlocked(state,id){
    const s=normalize(state),skill=BY_SKILL[id];
    return !!skill&&!!s.books[skill.manualId]
      &&levelForExp(s.books[skill.manualId].exp)>=skill.levelRequired;
  }
  // Shared server/client ordering for the weapon shelf and training navigation.
  // Compare each priority independently, not the equipped slot number or EXP.
  function sortedOwnedWeapons(library,weaponIds){
    const equipped=new Set((Array.isArray(weaponIds)?weaponIds:[]).filter(Boolean));
    const realmRank=book=>REALMS.findIndex(realm=>realm.name===book.tierRealm);
    return (Array.isArray(library)?library:[]).filter(book=>book?.owned===true)
      .map((book,index)=>({book,index}))
      .sort((a,b)=>Number(equipped.has(b.book.id))-Number(equipped.has(a.book.id))
        ||(Number(b.book.level)||0)-(Number(a.book.level)||0)
        ||realmRank(b.book)-realmRank(a.book)||a.index-b.index)
      .map(row=>row.book);
  }
  function publicState(raw,realmScore=0){
    const s=weaponize(raw),weaponIds=s.weaponIds,score=normalizedScore(realmScore);
    // Do not expose undiscovered scriptures to the cultivation UI.
    const library=BOOKS.filter(book=>!!s.books[book.id]).map(book=>{
      const levelInfo=mastery(s.books[book.id].exp);
      return {id:book.id,name:book.name,school:book.school,weaponType:book.weaponType,tierRealm:book.tierRealm,weaponCopies:s.books[book.id].copies||{[book.tierRealm]:1},refinement:refinementFor(s.books[book.id]),description:book.description,
        owned:true,...levelInfo,upgrade:upgradeQuote(levelInfo.exp),skills:book.skills.map(skill=>publicSkill(skill,levelInfo.level,score,s.skillLevels[skill.id],refinementFor(s.books[book.id])))};
    });
    return {...s,weaponIds,realmScore:score,realmName:realmForScore(score).name,
      attackBonus:manualAttackBonus(s),cultivationBonusPercent:library.filter(book=>book.level>=MAX_LEVEL).length*30,maxManualLevel:MAX_LEVEL,library};
  }
  // Sum all owned manuscript levels, including a Lv.1 manuscript (+1).
  // This is derived from the owned books; never increment the saved user attack.
  function manualAttackBonus(raw){
    const state=normalize(raw);
    return Object.values(state.books).reduce((sum,row)=>sum+levelForExp(row.exp),0);
  }
  const starterFor=school=>school==='sword'?'sword-wind':school==='body'?'body-rock':null;
  return Object.freeze({BOOKS,BY_BOOK,BY_SKILL,DEVELOPMENT_BOOKS,RELEASE_NEW_WEAPONS,EXP_PER_KILL,MAX_LEVEL,MAX_GOLD_LEVEL,MAX_EXP,REALMS,realmForScore,realmForStage,expForBeast,meetsRealm,xpForNextLevel,totalExpForLevel,levelForExp,mastery,upgradeQuote,MAX_SKILL_LEVEL,MAX_REFINEMENT,REFINEMENT_PERCENT,refinementPercent,refinement,refinementFor,copyCount,skillLevel,skillAtLevel,singleHitDamage,descriptionWithDamage,skillUpgradeQuote,legacyKillsToExp,normalize,weaponize,unlocked,manualAttackBonus,sortedOwnedWeapons,publicState,starterFor});
});

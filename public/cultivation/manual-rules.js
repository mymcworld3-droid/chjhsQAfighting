/* Shared immutable technique catalog. Rules run identically in the browser and server. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QAManuals=api;
})(globalThis,()=>{
  'use strict';
  // Each successful manual killing blow earns XP for that scripture.
  // Lv. 1 -> 2 costs 40 XP; each following level costs 20 XP more.
  const EXP_PER_KILL=50,MAX_EXP=100000000;
  // Exactly the existing cultivation score cutoffs, with human-readable realm labels.
  const REALMS=Object.freeze([
    {name:'煉氣',score:1,stage:1,exp:50},
    {name:'築基',score:6,stage:5,exp:70},
    {name:'金丹',score:28,stage:10,exp:100},
    {name:'元嬰',score:68,stage:20,exp:140},
    {name:'化神',score:188,stage:35,exp:190},
    {name:'煉虛',score:428,stage:55,exp:250},
    {name:'合體',score:788,stage:80,exp:330},
    {name:'渡劫',score:1268,stage:110,exp:430},
    {name:'真仙',score:1868,stage:150,exp:550}
  ].map(Object.freeze));
  const normalizedScore=value=>Number.isFinite(Number(value))?
    Math.max(0,Math.floor(Number(value))):0;
  const realmForScore=score=>REALMS.findLast(realm=>normalizedScore(score)>=realm.score)||{name:'凡人',score:0};
  const realmForStage=stage=>REALMS.findLast(realm=>Math.max(1,Math.floor(Number(stage)||1))>=realm.stage)||REALMS[0];
  const expForBeast=stage=>realmForStage(stage).exp;
  const meetsRealm=(skill,score)=>normalizedScore(score)>=skill.realmRequired;
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
    const level=levelForExp(exp),current=exp-totalExpForLevel(level),needed=xpForNextLevel(level);
    return {level,exp,totalExp:exp,expInLevel:current,expToNext:needed,progress:Math.min(100,Math.floor(current/needed*100))};
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
  const book=(id,name,school,description,skills,realms=[1,6,28])=>Object.freeze({
    id,name,school,description,skills:Object.freeze(skills.map((skill,index)=>
      Object.freeze({...skill,moveId:skill.moveId||skill.id,manualId:id,school,
        levelRequired:[1,5,10][index],realmRequired:realms[index]})))
  });
  // Each book keeps its own unlock and EXP source even for a shared move.
  const shared=(move,id)=>({...move,id,moveId:move.id});
  const straight=technique('wind-slash','流風斬',2,3,'line',1.15,'選擇一個方向，斬擊前方直線三格。');
  const breakLine=technique('wind-thousand','遠線破擊',4,null,'line',1.5,
    '劍氣沿直線延伸至石障或邊界。命中後將存活敵人推至最遠的可落腳格。',{unlimited:true,pushToEdge:true});
  const straightFist=technique('rock-fist','直拳',2,2,'line',1.2,'攻擊前方直線兩格。');
  const BOOKS=Object.freeze([
    book('sword-wind','流風劍訣','sword','以身法切入，再以劍氣逼退敵人。',[
      straight,
      technique('wind-step','突進橫斬',5,4,'dash-cleave',1.8,
        '沿直線突進最多四格，再對落點前方一排三格連斬兩次。',{hits:2}),
      breakLine
    ]),
    book('sword-flight','御劍真訣','sword','御使飛劍，控制敵人的站位。',[
      shared(straight,'flight-slash'),
      technique('flight-summon','召劍',3,3,'flying-sword',1.1,
        '在自身直線三格內的空地召劍。再用此招可讓飛劍直線移動最多四格，穿過敵人時造成傷害。每回合最多用兩次。',
        {travel:4,cooldown:0}),
      shared(breakLine,'flight-break')
    ],[6,6,28]),
    // Preserve the former 青霄劍典 book and slot IDs in existing saves.
    book('sword-sky','八方劍典','sword','以多路劍氣交擊一點，兼及周圍敵人。',[
      shared(straight,'sky-pierce'),
      technique('sky-cloud','交叉劍斬',4,3,'sword-array',1.1,
        '選擇三格內的中心，沿四條對角線各斬兩格。中心承受兩段交叉劍氣。',
        {diagonal:2,centerPower:1.6}),
      technique('sky-sever','八方合劍',6,4,'sword-array',1.25,
        '選擇四格內的中心。正向各延伸三格、斜向各延伸兩格，八路劍氣向中心匯聚。',
        {orthogonal:3,diagonal:2,centerPower:2.4})
    ],[6,28,68]),
    book('body-rock','玄嶽鍛體訣','body','突進破陣，將敵人擊退。',[
      straightFist,
      technique('rock-quake','突進震拳',3,3,'dash-cleave',1.15,
        '直線突進最多三格，再攻擊落點前方的 T 形四格。',{tShape:true}),
      technique('rock-break','崩山拳',3,2,'fist-sweep',1.25,
        '攻擊前方 T 形四格，將命中的敵人沿出拳方向擊退最多三格。',{tShape:true,push:3})
    ]),
    book('body-dragon','龍象真身訣','body','連步逼退對手，蓄勢後連續出拳。',[
      shared(straightFist,'dragon-strike'),
      technique('dragon-guard','四步連推',5,1,'fist-chain',.45,
        '最多四段。每段打前方一排並將敵人推退一格，再前進一格。擊退後正前方仍被阻擋就停止。',{steps:4}),
      technique('dragon-roar','蓄勢',7,0,'fist-focus',0,
        '立即結束回合。接下來自己的兩個回合各可出手三次，其他拳法體力消耗減半並向上取整。',{cooldown:3})
    ],[6,28,68]),
    book('body-tiger','伏虎擒拿訣','body','以步法貼近敵人，借力改變敵人的站位。',[
      shared(straightFist,'tiger-fist'),
      technique('tiger-step','踏步連拳',4,2,'dash-cleave',1.5,
        '直線踏步最多兩格，再攻擊落點前方橫排三格兩次。',{hits:2}),
      technique('tiger-throw','翻摔',4,1,'fist-throw',0,
        '將身前橫排三格內的敵人拉到身後的對應格。若對應落點有障礙或被占用，該目標留在原地。')
    ],[6,28,68])
  ]);
  const BY_BOOK=Object.freeze(Object.fromEntries(BOOKS.map(book=>[book.id,book])));
  const BY_SKILL=Object.freeze(Object.fromEntries(BOOKS.flatMap(book=>book.skills.map(skill=>[skill.id,skill]))));
  const publicSkill=(skill,level,score)=>{
    const mastered=level>=skill.levelRequired,realmReady=meetsRealm(skill,score);
    return {...skill,mastered,realmReady,realmName:realmForScore(skill.realmRequired).name,
      unlocked:mastered&&realmReady};
  };
  function normalize(raw){
    const books={};
    for(const [id,record] of Object.entries(raw?.books||{})){
      if(!BY_BOOK[id])continue;
      const exp=Object.prototype.hasOwnProperty.call(record||{},'exp')
        ?Number(record.exp):legacyKillsToExp(record?.kills);
      books[id]={exp:mastery(exp).exp};
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
    return {version:2,school,books,equipped,
      dropMisses:Math.max(0,Math.min(3,Math.trunc(Number(raw?.dropMisses)||0))),
      starterClaimed:raw?.starterClaimed===true};
  }
  function unlocked(state,id){
    const s=normalize(state),skill=BY_SKILL[id];
    return !!skill&&!!s.books[skill.manualId]
      &&levelForExp(s.books[skill.manualId].exp)>=skill.levelRequired;
  }
  function publicState(raw,realmScore=0){
    const s=normalize(raw),score=normalizedScore(realmScore);
    // Do not expose undiscovered scriptures to the cultivation UI.
    const library=BOOKS.filter(book=>!!s.books[book.id]).map(book=>{
      const levelInfo=mastery(s.books[book.id].exp);
      return {id:book.id,name:book.name,school:book.school,description:book.description,
        owned:true,...levelInfo,skills:book.skills.map(skill=>publicSkill(skill,levelInfo.level,score))};
    });
    return {...s,realmScore:score,realmName:realmForScore(score).name,library};
  }
  const starterFor=school=>school==='sword'?'sword-wind':school==='body'?'body-rock':null;
  return Object.freeze({BOOKS,BY_BOOK,BY_SKILL,EXP_PER_KILL,MAX_EXP,REALMS,realmForScore,realmForStage,expForBeast,meetsRealm,xpForNextLevel,totalExpForLevel,levelForExp,mastery,legacyKillsToExp,normalize,unlocked,publicState,starterFor});
});

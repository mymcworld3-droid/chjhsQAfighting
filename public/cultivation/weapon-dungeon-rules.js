/* Shared, deterministic weapon-dungeon definitions. Rewards are rolled server-side. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QAWeaponDungeons=api;})(globalThis,()=>{
  'use strict';
  const ID='peak-stone',NAME='尖峰石域',DAILY_TICKETS=3,MAX_TICKETS=5;
  const DIFFICULTIES=Object.freeze([
    ['foundation','築基',5],['golden','金丹',10],['nascent','元嬰',20],
    ['divine','化神',35],['unity','合體',80],['tribulation','渡劫',110]
  ].map(([id,name,stage],index)=>Object.freeze({id,name,stage,index,nextRealm:index===5?'真仙':null})));
  const CATALOG=Object.freeze([Object.freeze({id:ID,name:NAME,subtitle:'群峰深處 · 重甲之試',theme:'stone',rewardWeaponType:'sword',
    description:'穿過三重石陣擊敗深處領主即可通關，沿途守衛會持續追擊。',
    traits:['追蹤落石','重甲靈獸','領主鎮守'],bonus:'圖騰攻擊傷害 +15%',
    tactics:['蓄勢中的落石會追蹤站位；離開射程即可閃避。','成功擊退則會打斷蓄勢，撞牆未位移不算。','領主從開戰起即可攻擊，也能直接受到傷害及擊退，不必先清除守衛。','擊敗領主立即通關，剩餘守衛不必清除。'],totemDamageMultiplier:1.15})]);
  const WEAPON_REALMS=Object.freeze(['煉氣',...DIFFICULTIES.map(d=>d.name),'真仙']);
  const day=now=>Math.floor((Number(now)+8*3600000)/86400000);
  function progress(raw,now=Date.now()){
    const today=day(now),previous=Number.isSafeInteger(raw?.grantDay)?raw.grantDay:today-1;
    const saved=Math.max(0,Math.trunc(Number(raw?.tickets)||0));
    const elapsed=Math.max(0,today-previous);
    return {version:1,tickets:Math.max(saved,Math.min(MAX_TICKETS,saved+Math.min(2,elapsed)*DAILY_TICKETS)),
      grantDay:Math.max(today,previous),unlocked:Math.max(0,Math.min(5,Math.trunc(Number(raw?.unlocked)||0))),
      clears:Array.from({length:6},(_,i)=>Math.max(0,Math.trunc(Number(raw?.clears?.[i])||0))),
      ...(raw?.byDungeon?{byDungeon:Object.fromEntries(CATALOG.filter(d=>d.id!==ID).map(d=>[d.id,progressFor(raw,d.id)]))}:{})};
  }
  function progressFor(p,id){
    if(id===ID)return {unlocked:p.unlocked,clears:p.clears};
    const raw=p.byDungeon?.[id];
    return {unlocked:Math.max(0,Math.min(5,Math.trunc(Number(raw?.unlocked)||0))),
      clears:Array.from({length:6},(_,i)=>Math.max(0,Math.trunc(Number(raw?.clears?.[i])||0)))};
  }
  function recordClear(p,id,index){
    const next=progressFor(p,id);
    next.clears[index]++;next.unlocked=Math.max(next.unlocked,Math.min(5,index+1));
    if(id===ID)Object.assign(p,next);else p.byDungeon={...p.byDungeon,[id]:next};
    return next;
  }
  function catalog(p){
    return CATALOG.map(entry=>{const current=progressFor(p,entry.id);
      return {...entry,...current,difficulties:DIFFICULTIES.map(d=>({...d,locked:d.index>current.unlocked,nextRealm:DIFFICULTIES[d.index+1]?.name||'真仙'}))};});
  }
  function selection(input){
    const entry=CATALOG.find(d=>d.id===input?.dungeonId);
    if(!entry)throw Object.assign(Error('武器副本不存在'),{status:400});
    const difficulty=input.difficulty;
    if(!Number.isInteger(difficulty)||difficulty<0||difficulty>=6)throw Object.assign(Error('副本難度無效'),{status:400});
    return {id:entry.id,name:entry.name,difficulty,realm:DIFFICULTIES[difficulty].name,stage:DIFFICULTIES[difficulty].stage,
      nextRealm:DIFFICULTIES[difficulty+1]?.name||'真仙',totemDamageMultiplier:entry.totemDamageMultiplier};
  }
  function layout(seed,index,dungeonId=ID){
    const definition=selection({dungeonId,difficulty:index});
    if(dungeonId!==ID)throw Error('副本地圖尚未配置');
    const width=13,height=21;
    let h=0;for(const c of String(seed))h=(Math.imul(h,31)+c.charCodeAt(0))>>>0;
    const blocks=[];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x===0||x===width-1||y===0||y===height-1)blocks.push({x,y});
    // Entrance barricades, staggered stone gates and a broad lord arena.
    // Keep the center connected; seed varies the flank routes.
    const mirror=x=>h%2?width-1-x:x,stone=(x,y)=>blocks.push({x:mirror(x),y});
    for(const [x,y] of [[2,17],[3,17],[9,17],[10,17],[2,13],[2,12],[3,12],[9,11],[10,11],
      [2,9],[3,9],[4,9],[8,7],[9,7],[10,7],[2,4],[10,4],[2,5],[10,5]])stone(x,y);
    if(h%3===0){stone(1,15);stone(11,14);}
    else if(h%3===1){stone(3,14);stone(9,15);}
    else {stone(1,10);stone(11,9);}
    const enemies=[{x:5,y:1,species:8,name:'尖峰石域領主',boss:true,bossKind:'rock',weaponDungeonLord:true,
      trackingAttack:true,hpFactor:7+index*1.2,attackFactor:1+index*.12,moveSteps:1,level:definition.stage}];
    for(let row=0;row<4;row++)for(const x of [4,8])enemies.push({x,y:15-row*3,species:row%2?9:8,
      name:row%2?'尖峰石靈':'重甲巖獸',trackingAttack:true,hpFactor:2.5+index*.35,attackFactor:.65+index*.09,moveSteps:1,level:definition.stage});
    for(let i=0;i<index;i++)enemies.push({x:i%2?10:2,y:6+i*2,species:8,name:'石域守衛',trackingAttack:true,
      hpFactor:2.5+index*.35,attackFactor:.65+index*.09,moveSteps:1,level:definition.stage});
    const occupied=new Set(enemies.flatMap(a=>Array.from({length:a.boss?4:1},(_,i)=>(a.x+(a.boss?i%2:0))+','+(a.y+(a.boss?Math.floor(i/2):0)))));
    const safeBlocks=blocks.filter(p=>!occupied.has(p.x+','+p.y));
    return {id:'peak-stone',map:'peak-stone',seed,stage:definition.stage,layoutVersion:4,title:NAME+' · '+definition.realm,
      width,height,terrain:13,biome:'mountain',mode:'elimination',variant:'tracking-stone',structure:'three-stone-gates',
      attempt:0,layoutHash:'peak-stone:v2:'+index+':'+h.toString(16),
      blocks:safeBlocks.map(p=>({...p,kind:'rock'})),ground:Array(width*height).fill(13),spawn:{x:6,y:19},enemies,objective:{type:'boss',bossUid:'monster-0',completed:false},weaponDungeon:definition};
  }
  return Object.freeze({ID,NAME,DAILY_TICKETS,MAX_TICKETS,DIFFICULTIES,WEAPON_REALMS,CATALOG,day,progress,progressFor,recordClear,catalog,selection,layout});
});

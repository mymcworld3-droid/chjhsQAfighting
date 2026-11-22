/* Shared, deterministic weapon-dungeon definitions. Rewards are rolled server-side. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QAWeaponDungeons=api;})(globalThis,()=>{
  'use strict';
  const ID='peak-stone',NAME='尖峰石域',DAILY_TICKETS=3,MAX_TICKETS=5;
  const DIFFICULTIES=Object.freeze([
    ['foundation','築基',5],['golden','金丹',10],['nascent','元嬰',20],
    ['divine','化神',35],['unity','合體',80],['tribulation','渡劫',110]
  ].map(([id,name,stage],index)=>Object.freeze({id,name,stage,index,nextRealm:index===5?'真仙':null})));
  const WEAPON_REALMS=Object.freeze(['煉氣',...DIFFICULTIES.map(d=>d.name),'真仙']);
  const day=now=>Math.floor((Number(now)+8*3600000)/86400000);
  function progress(raw,now=Date.now()){
    const today=day(now),previous=Number.isSafeInteger(raw?.grantDay)?raw.grantDay:today-1;
    const saved=Math.max(0,Math.min(MAX_TICKETS,Math.trunc(Number(raw?.tickets)||0)));
    const elapsed=Math.max(0,today-previous);
    return {version:1,tickets:Math.min(MAX_TICKETS,saved+Math.min(2,elapsed)*DAILY_TICKETS),
      grantDay:Math.max(today,previous),unlocked:Math.max(0,Math.min(5,Math.trunc(Number(raw?.unlocked)||0))),
      clears:Array.from({length:6},(_,i)=>Math.max(0,Math.trunc(Number(raw?.clears?.[i])||0)))};
  }
  function selection(input){
    if(input?.dungeonId!==ID)throw Object.assign(Error('武器副本不存在'),{status:400});
    const difficulty=input.difficulty;
    if(!Number.isInteger(difficulty)||difficulty<0||difficulty>=6)throw Object.assign(Error('副本難度無效'),{status:400});
    return {id:ID,name:NAME,difficulty,realm:DIFFICULTIES[difficulty].name,stage:DIFFICULTIES[difficulty].stage,
      nextRealm:DIFFICULTIES[difficulty+1]?.name||'真仙',totemDamageMultiplier:1.15};
  }
  function layout(seed,index){
    const definition=selection({dungeonId:ID,difficulty:index}),width=13,height=21;
    let h=0;for(const c of String(seed))h=(Math.imul(h,31)+c.charCodeAt(0))>>>0;
    const blocks=[];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x===0||x===width-1||y===0||y===height-1)blocks.push({x,y});
    for(const y of [4,8,12,16])for(const x of [2+(h%2),9+(h%2)])blocks.push({x,y});
    const enemies=[{x:5,y:1,species:8,name:'尖峰石域領主',boss:true,bossKind:'rock',weaponDungeonLord:true,
      trackingAttack:true,hpFactor:10+index*2,attackFactor:1.35+index*.15,moveSteps:1,level:definition.stage}];
    for(let row=0;row<4;row++)for(const x of [4,8])enemies.push({x,y:15-row*3,species:row%2?9:8,
      name:row%2?'尖峰石靈':'重甲巖獸',trackingAttack:true,hpFactor:1.9+index*.3,attackFactor:.75+index*.12,moveSteps:1,level:definition.stage});
    for(let i=0;i<index;i++)enemies.push({x:i%2?10:2,y:6+i*2,species:8,name:'石域守衛',trackingAttack:true,
      hpFactor:1.9+index*.3,attackFactor:.75+index*.12,moveSteps:1,level:definition.stage});
    const occupied=new Set(enemies.flatMap(a=>Array.from({length:a.boss?4:1},(_,i)=>(a.x+(a.boss?i%2:0))+','+(a.y+(a.boss?Math.floor(i/2):0)))));
    const safeBlocks=blocks.filter(p=>!occupied.has(p.x+','+p.y));
    return {id:'peak-stone',map:'peak-stone',seed,stage:definition.stage,layoutVersion:4,title:NAME+' · '+definition.realm,
      width,height,terrain:13,biome:'mountain',mode:'elimination',variant:'tracking-stone',structure:'deep-lord',
      attempt:0,layoutHash:'peak-stone:'+index+':'+h.toString(16),
      blocks:safeBlocks.map(p=>({...p,kind:'rock'})),ground:Array(width*height).fill(13),spawn:{x:6,y:19},enemies,objective:{type:'elimination',completed:false},weaponDungeon:definition};
  }
  return Object.freeze({ID,NAME,DAILY_TICKETS,MAX_TICKETS,DIFFICULTIES,WEAPON_REALMS,day,progress,selection,layout});
});

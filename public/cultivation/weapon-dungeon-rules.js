/* Shared, deterministic weapon-dungeon definitions. Rewards are rolled server-side. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QAWeaponDungeons=api;})(globalThis,()=>{
  'use strict';
  const ID='peak-stone',NAME='尖峰石域',DAILY_TICKETS=3,MAX_TICKETS=5;
  // grid-world ground atlas: zero-based 16 = stone, 13 = desert.
  const STONE_TERRAIN=16,DESERT_TERRAIN=13,WILD_ID='beast-wilds',WILD_NAME='萬獸險域';
  const DIFFICULTIES=Object.freeze([
    ['foundation','築基',5],['golden','金丹',10],['nascent','元嬰',20],
    ['divine','化神',35],['unity','合體',80],['tribulation','渡劫',110]
  ].map(([id,name,stage],index)=>Object.freeze({id,name,stage,index})));
  // Provisional ranges; damage multipliers retain the previous stone attack.
  // All new rooms receive explicit immutable definitions, old saved rooms keep
  // their existing skill snapshots until the next dungeon is started.
  const PEAK_SKILLS=Object.freeze({
    line:Object.freeze({id:'peak-sword-line',name:'直線劍氣',shape:'line',range:5,power:1,warning:'tracking',animation:'peak-sword-line'}),
    sweep:Object.freeze({id:'peak-sword-sweep',name:'橫掃斬擊',shape:'cone',range:3,power:1,warning:'tracking',animation:'peak-sword-sweep'}),
    thrust:Object.freeze({id:'peak-sword-thrust',name:'穿刺突進',shape:'line',range:3,moveSteps:2,requiresPath:true,power:1,warning:'tracking',animation:'peak-sword-thrust'}),
    rain:Object.freeze({id:'peak-sword-rain',name:'劍雨',shape:'blast',range:4,radius:2,power:1,sight:true,lordOnly:true,warning:'tracking',animation:'peak-sword-rain'})
  });
  const peakSkills=role=>role==='lord'?[PEAK_SKILLS.rain,PEAK_SKILLS.thrust,PEAK_SKILLS.sweep,PEAK_SKILLS.line]:
    role==='spirit'?[PEAK_SKILLS.line,PEAK_SKILLS.sweep]:role==='guard'?[PEAK_SKILLS.thrust,PEAK_SKILLS.line]:[PEAK_SKILLS.sweep,PEAK_SKILLS.thrust];
  const CATALOG=Object.freeze([Object.freeze({id:ID,name:NAME,subtitle:'群峰深處 · 重甲之試',theme:'stone',rewardWeaponType:'sword',
    description:'穿過三重石陣擊敗深處領主即可通關，沿途守衛會持續追擊。',
    traits:['追蹤劍法','重甲靈獸','領主劍雨'],bonus:'圖騰攻擊傷害 +15%',
    tactics:['蓄勢中的劍法會追蹤站位；離開合法攻擊線或射程，或利用障礙物閃避。','成功擊退則會打斷蓄勢，撞牆未位移不算。','領主從開戰起即可攻擊，也能直接受到傷害及擊退，不必先清除守衛。','擊敗領主立即通關，剩餘守衛不必清除。'],totemDamageMultiplier:1.15}),
    Object.freeze({id:WILD_ID,name:WILD_NAME,hidden:true,subtitle:'赤砂荒原 · 群獸之試',theme:'desert',rewardWeaponType:'totem',
      description:'穿越赤砂荒原，擊敗中央領主即可通關。',traits:['鎖定衝撞','方形震波','重型靈獸'],
      bonus:'弦修技能傷害 +15%',tactics:['預告鎖定後不追蹤玩家；側移避開衝撞。','震地一次命中；連環震地逐層擊退，可能再次命中。','成功擊退可打斷；高階重型靈獸可能抵抗部分擊退。','擊敗領主立即通關。'],
      totemDamageMultiplier:1,bowDamageMultiplier:1.15})]);
  // Old rooms retain their saved development-only attack snapshots; no new
  // room uses them. Stage eight will tune the provisional combat values.
  // Stage eight will tune these provisional ranges and collision multiplier.
  const WILD_CHARGE=Object.freeze({
    guard:Object.freeze({id:'wild-charge',name:'蠻獸衝撞',shape:'charge',range:3,power:1,collisionPower:.5,warning:'locked',animation:'wild-charge'}),
    lord:Object.freeze({id:'wild-charge',name:'蠻獸衝撞',shape:'charge',range:4,power:1,collisionPower:.5,warning:'locked',animation:'wild-charge',lordOnly:true})
  });
  const WILD_SHOCK=Object.freeze({
    ground:Object.freeze({id:'wild-shock',name:'震地',shape:'square',range:2,power:.8,push:1,warning:'locked',animation:'wild-shock'}),
    echo:Object.freeze({id:'wild-echo',name:'連環震地',shape:'square',range:4,rings:4,power:.45,push:1,warning:'locked',animation:'wild-echo',lordOnly:true})
  });
  function wildSkills(role,index){
    const charge={...WILD_CHARGE[role==='lord'?'lord':'guard'],range:WILD_CHARGE[role==='lord'?'lord':'guard'].range+Math.floor(index/2)};
    const shock={...WILD_SHOCK.ground,power:.8+index*.03};
    const echo={...WILD_SHOCK.echo,power:.45+index*.03};
    if(role==='lord')return [charge,shock,echo];
    if(role==='charge')return [charge];
    return index>=4?[shock,charge]:[shock];
  }
  const wildResistance=(role,index)=>role==='lord'&&index>=3?(index>=5?2:3):role==='shock'&&index>=4?(index>=5?3:4):0;
  const WEAPON_REALMS=Object.freeze(['煉氣',...DIFFICULTIES.map(d=>d.name),'真仙']);
  // The drop ladder follows the six dungeon difficulties, with 煉氣 below 築基.
  const lowerRealm=realm=>WEAPON_REALMS[WEAPON_REALMS.indexOf(realm)-1]||null;
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
  function catalog(p,{allowHidden=false}={}){
    return CATALOG.filter(entry=>!entry.hidden||allowHidden===true).map(entry=>{const current=progressFor(p,entry.id);
      return {...entry,...current,difficulties:DIFFICULTIES.map(d=>({...d,locked:d.index>current.unlocked,nextRealm:lowerRealm(d.name),lowerRealm:lowerRealm(d.name)}))};});
  }
  function selection(input,{allowHidden=false}={}){
    const entry=CATALOG.find(d=>d.id===input?.dungeonId&&(!d.hidden||allowHidden===true));
    if(!entry)throw Object.assign(Error('武器副本不存在'),{status:400});
    const difficulty=input.difficulty;
    if(!Number.isInteger(difficulty)||difficulty<0||difficulty>=6)throw Object.assign(Error('副本難度無效'),{status:400});
    return {id:entry.id,name:entry.name,difficulty,realm:DIFFICULTIES[difficulty].name,stage:DIFFICULTIES[difficulty].stage,
      nextRealm:lowerRealm(DIFFICULTIES[difficulty].name),lowerRealm:lowerRealm(DIFFICULTIES[difficulty].name),totemDamageMultiplier:entry.totemDamageMultiplier,...(entry.bowDamageMultiplier?{bowDamageMultiplier:entry.bowDamageMultiplier}:{})};
  }
  function wildLayout(seed,index,definition){
    const width=11,height=15;
    let h=0;for(const ch of String(seed))h=(Math.imul(h,31)+ch.charCodeAt(0))>>>0;
    const mirror=x=>h%2?width-1-x:x;
    const spawn={x:5,y:13},blocks=[];
    const rock=(x,y)=>blocks.push({x:mirror(x),y,kind:'rock'});
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x===0||x===width-1||y===0||y===height-1)rock(x,y);
    // Open central arena; obstacles stay at the flanks and off the spawn exits.
    for(const [x,y] of [[2,3],[2,4],[8,3],[8,4],[1,7],[9,7],[2,11],[8,11]])rock(x,y);
    const variants=[[[1,9],[9,10]],[[2,1],[8,2]],[[1,5],[9,9]]];
    for(const [x,y] of variants[(h>>>1)%3])rock(x,y);
    const lordY=6-((h>>>3)%2);
    const enemies=[{x:h%2?width-2-5:5,y:lordY,species:8,name:WILD_NAME+'領主',boss:true,bossKind:'rock',weaponDungeonLord:true,
      dungeonRole:'lord',dungeonAiVersion:1,dungeonResistanceEvery:wildResistance('lord',index),dungeonSkills:wildSkills('lord',index),hpFactor:7+index*1.2,attackFactor:1+index*.12,moveSteps:1,level:definition.stage}];
    for(const [x,y,role] of [[3,5,'charge'],[8,6,'shock'],[2,9,'shock'],[8,9,'charge'],[3,12,'charge'],[7,12,'shock']]){
      const charge=role==='charge';
      enemies.push({x:mirror(x),y,species:charge?1:8,name:charge?'赤鬃蠻豬':'裂地蠻牛',
        dungeonRole:role,dungeonAiVersion:1,dungeonResistanceEvery:wildResistance(role,index),dungeonSkills:wildSkills(role,index),hpFactor:2.5+index*.35,attackFactor:.65+index*.09,moveSteps:1,level:definition.stage});
    }
    const occupied=new Set([spawn.x+','+spawn.y,...enemies.flatMap(a=>Array.from({length:a.boss?4:1},(_,i)=>(a.x+(a.boss?i%2:0))+','+(a.y+(a.boss?Math.floor(i/2):0))))]);
    return {id:WILD_ID,map:WILD_ID,seed,stage:definition.stage,layoutVersion:4,title:WILD_NAME+' · '+definition.realm,
      width,height,terrain:DESERT_TERRAIN,biome:'desert',mode:'elimination',variant:'locked-beasts',structure:'open-red-sand',
      attempt:0,layoutHash:WILD_ID+':v1:'+index+':'+h.toString(16),blocks:blocks.filter(p=>!occupied.has(p.x+','+p.y)),
      ground:Array(width*height).fill(DESERT_TERRAIN),spawn,enemies,objective:{type:'boss',bossUid:'monster-0',completed:false},weaponDungeon:definition};
  }
  function layout(seed,index,dungeonId=ID){
    // Internal room construction must support hidden saved rooms. Public entry
    // is checked separately by the authenticated server start endpoint.
    const definition=selection({dungeonId,difficulty:index},{allowHidden:true});
    if(dungeonId===WILD_ID)return wildLayout(seed,index,definition);
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
      trackingAttack:true,dungeonSkills:peakSkills('lord'),hpFactor:7+index*1.2,attackFactor:1+index*.12,moveSteps:1,level:definition.stage}];
    for(let row=0;row<4;row++)for(const x of [4,8])enemies.push({x,y:15-row*3,species:row%2?9:8,
      name:row%2?'尖峰石靈':'重甲巖獸',trackingAttack:true,dungeonSkills:peakSkills(row%2?'spirit':'heavy'),hpFactor:2.5+index*.35,attackFactor:.65+index*.09,moveSteps:1,level:definition.stage});
    for(let i=0;i<index;i++)enemies.push({x:i%2?10:2,y:6+i*2,species:8,name:'石域守衛',trackingAttack:true,dungeonSkills:peakSkills('guard'),
      hpFactor:2.5+index*.35,attackFactor:.65+index*.09,moveSteps:1,level:definition.stage});
    const occupied=new Set(enemies.flatMap(a=>Array.from({length:a.boss?4:1},(_,i)=>(a.x+(a.boss?i%2:0))+','+(a.y+(a.boss?Math.floor(i/2):0)))));
    const safeBlocks=blocks.filter(p=>!occupied.has(p.x+','+p.y));
    return {id:'peak-stone',map:'peak-stone',seed,stage:definition.stage,layoutVersion:4,title:NAME+' · '+definition.realm,
      width,height,terrain:STONE_TERRAIN,biome:'mountain',mode:'elimination',variant:'tracking-stone',structure:'three-stone-gates',
      attempt:0,layoutHash:'peak-stone:v2:'+index+':'+h.toString(16),
      blocks:safeBlocks.map(p=>({...p,kind:'rock'})),ground:Array(width*height).fill(STONE_TERRAIN),spawn:{x:6,y:19},enemies,objective:{type:'boss',bossUid:'monster-0',completed:false},weaponDungeon:definition};
  }
  function restoreTerrain(room){
    if(!room?.weaponDungeon||(room.weaponDungeon.id||ID)!==ID)return room;
    if(room.terrain===13)room.terrain=STONE_TERRAIN;
    if(Array.isArray(room.ground)&&room.ground.includes(13))room.ground=room.ground.map(t=>t===13?STONE_TERRAIN:t);
    return room;
  }
  return Object.freeze({ID,NAME,DAILY_TICKETS,MAX_TICKETS,STONE_TERRAIN,DESERT_TERRAIN,WILD_ID,WILD_NAME,PEAK_SKILLS,WILD_CHARGE,WILD_SHOCK,wildSkills,wildResistance,restoreTerrain,DIFFICULTIES,WEAPON_REALMS,CATALOG,lowerRealm,day,progress,progressFor,recordClear,catalog,selection,layout});
});

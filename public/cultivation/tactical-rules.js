/* Shared, deterministic stamina battlefield. Server owns every state transition. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QATactical=api;
})(globalThis,()=>{
  'use strict';
  const LIMITS=Object.freeze({stamina:10,correct:4,wrong:1,questions:2,attacks:2,actions:16,turns:60,turnMs:120000});
  const MAPS=Object.freeze([
    {id:'courtyard',name:'演武庭',width:7,height:7,terrain:2,description:'開闊石庭，練習近身與迂迴。'},
    {id:'bamboo',name:'青竹幽徑',width:9,height:7,terrain:0,description:'石障分隔通道，利用掩護接近。'},
    {id:'ruins',name:'古陣遺墟',width:11,height:9,terrain:16,description:'寬廣遺跡，適合遠程與範圍技能。'}
  ].map(Object.freeze));
  const skill=(id,name,cost,range,kind,power,description,extra={})=>Object.freeze({id,name,cost,range,kind,power,description,cooldown:2,...extra});
  const core=(name,color,branches)=>Object.freeze({name,color,branches:Object.freeze(branches.map(b=>Object.freeze(b)))});
  const CORES=Object.freeze({
    none:core('未結金丹','#d8d0b6',[
      {id:'breath',name:'養氣',skill:skill('breath','調息護元',3,0,'restore',.15,'回復 15% 生命，獲得 15% 生命護盾。',{shield:.15})}
    ]),
    ocean:core('大海無垠丹','#72cbd6',[
      {id:'surge',name:'逐浪',skill:skill('surge','千尺潮湧',4,4,'line',1.45,'直線攻擊至四格，將命中者推開兩格。',{push:2})},
      {id:'tide',name:'滄海',skill:skill('tide','滄海困陣',4,3,'area',1.1,'攻擊目標及相鄰格；命中者下次移動每格多耗 1 體力。',{slow:true,radius:1})}
    ]),
    taichu:core('太初回元丹','#9fdb9a',[
      {id:'renew',name:'生息',skill:skill('renew','太初生息',4,0,'restore',.32,'回復 32% 生命，需等待兩次自身回合才能再用。')},
      {id:'drain',name:'歸元',skill:skill('drain','歸元納氣',4,3,'hit',1.35,'遠距離攻擊，回復實際傷害的 65%。',{leech:.65})}
    ]),
    ningxin:core('凝心靜音丹','#9cbee8',[
      {id:'barrier',name:'凝障',skill:skill('barrier','道心壁壘',4,0,'restore',0,'獲得 40% 最大生命護盾，持續至被擊破。',{shield:.4})},
      {id:'focus',name:'靜念',skill:skill('focus','靜念穿雲',4,4,'hit',1.7,'凝聚神念攻擊四格內單一敵人。')}
    ]),
    pojing:core('破境衝仙丹','#e4b480',[
      {id:'execute',name:'斬關',skill:skill('execute','破妄斬關',4,2,'hit',1.35,'敵人生命低於 40% 時，傷害提升至 2.2 倍攻擊。',{execute:true})},
      {id:'breach',name:'踏陣',skill:skill('breach','踏陣破障',4,3,'blink',0,'躍至三格內空地，攻擊落點相鄰敵人。',{burst:1.2})}
    ]),
    xingchen:core('星辰吞月丹','#b5a1e7',[
      {id:'meteor',name:'星隕',skill:skill('meteor','隕星天降',4,4,'meteor',1.9,'標記目標及相鄰格，下次自身回合開始時落下隕石。',{radius:1})},
      {id:'orbit',name:'星軌',skill:skill('orbit','斗轉星移',3,4,'blink',0,'躍至四格內空地，獲得 15% 最大生命護盾。',{shield:.15})}
    ]),
    wugou:core('無垢清心丹','#e0e8c7',[
      {id:'purify',name:'破妄',skill:skill('purify','清光破妄',4,3,'hit',1.25,'清光穿透護盾與護身，造成真實傷害。',{pierce:true})},
      {id:'cleanse',name:'無塵',skill:skill('cleanse','無塵神光',4,0,'restore',.12,'移除緩速，回復 12% 生命並獲得 30% 護盾。',{shield:.3,cleanse:true})}
    ]),
    thunder:core('萬劫雷霆丹','#d8b8f0',[
      {id:'lightning',name:'奔雷',skill:skill('lightning','奔雷連鎖',4,3,'area',1.4,'雷擊目標及相鄰格，可同時攻擊聚集的怪物。',{radius:1})},
      {id:'counter',name:'雷返',skill:skill('counter','雷光護體',3,0,'counter',.8,'至下次自身回合前減傷 40%；第一次受擊時反擊 80% 攻擊。')}
    ]),
    reverse:core('陰陽反轉丹','#f1a1a1',[
      {id:'reversal',name:'逆命',skill:skill('reversal','逆命一擊',4,2,'hit',1.15,'依已損失生命提高傷害，最多 2.3 倍攻擊。',{missing:true})},
      {id:'exchange',name:'陰陽',skill:skill('exchange','陰陽換位',3,3,'swap',.65,'與視線內敵人交換位置並造成傷害。')}
    ]),
    sword:core('破鋒劍心丹','#eadb9c',[
      {id:'lunge',name:'劍遁',skill:skill('lunge','劍意突進',4,3,'lunge',1.45,'突進到敵人身旁並斬擊；需要可通行的接近路線。')},
      {id:'blades',name:'萬劍',skill:skill('blades','萬劍歸一',4,4,'line',1.6,'劍氣沿直線穿過敵人，遇石障停止。')}
    ])
  });
  const BASIC=skill('attack','普通攻擊',2,1,'hit',1,'攻擊相鄰敵人。',{cooldown:0});
  const num=v=>Number.isFinite(Number(v))?Math.max(0,Math.floor(Number(v))):0;
  const fail=message=>{throw Object.assign(new Error(message),{status:409});};
  const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const key=p=>p.x+','+p.y;
  const clone=s=>JSON.parse(JSON.stringify(s));
  const alive=a=>a&&a.hp>0;
  const current=s=>s.actors.find(a=>a.uid===s.turnUid);
  const mapFor=id=>MAPS.find(m=>m.id===id)||MAPS[0];
  function branchFor(a){const c=CORES[a.core]||CORES.none;return c.branches.find(b=>b.id===a.branch)||c.branches[0];}
  function inside(s,p){return Number.isInteger(p?.x)&&Number.isInteger(p?.y)&&p.x>=0&&p.y>=0&&p.x<s.width&&p.y<s.height;}
  function blocked(s,p){return !inside(s,p)||s.blocks.some(b=>b.x===p.x&&b.y===p.y);}
  function at(s,p){return s.actors.find(a=>alive(a)&&a.x===p.x&&a.y===p.y);}
  function neighbours(s,p){return [{x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1}].filter(n=>!blocked(s,n));}
  function path(s,from,to,ignoreUid=''){
    if(blocked(s,to)||(at(s,to)&&at(s,to).uid!==ignoreUid))return null;
    const queue=[{x:from.x,y:from.y}],seen=new Map([[key(from),null]]);
    for(let i=0;i<queue.length;i++){
      const p=queue[i];if(key(p)===key(to)){
        const route=[];let end=p;while(end){route.unshift(end);end=seen.get(key(end));}return route;
      }
      for(const n of neighbours(s,p))if(!seen.has(key(n))&&(!at(s,n)||at(s,n).uid===ignoreUid)){
        seen.set(key(n),p);queue.push(n);
      }
    }
    return null;
  }
  function sight(s,a,b){
    let x=a.x,y=a.y;const dx=Math.abs(b.x-x),dy=Math.abs(b.y-y),sx=x<b.x?1:-1,sy=y<b.y?1:-1;let err=dx-dy;
    while(x!==b.x||y!==b.y){
      const e=err*2;if(e>-dy){err-=dy;x+=sx;}if(e<dx){err+=dx;y+=sy;}
      if(blocked(s,{x,y}))return false;
    }
    return true;
  }
  function area(s,p,r=1){const cells=[];for(let y=p.y-r;y<=p.y+r;y++)for(let x=p.x-r;x<=p.x+r;x++)if(inside(s,{x,y})&&dist(p,{x,y})<=r&&!blocked(s,{x,y}))cells.push({x,y});return cells;}
  function line(s,a,p,range){
    if(a.x!==p.x&&a.y!==p.y)return [];
    if(a.x===p.x&&a.y===p.y)return [];
    const dx=Math.sign(p.x-a.x),dy=Math.sign(p.y-a.y),cells=[];
    for(let n=1;n<=range;n++){const c={x:a.x+dx*n,y:a.y+dy*n};if(blocked(s,c))break;cells.push(c);}return cells;
  }
  function actor(raw,pos){
    const type=CORES[raw.core]?raw.core:'none',branch=CORES[type].branches.find(b=>b.id===raw.branch)||CORES[type].branches[0];
    const maxHp=Math.max(1,num(raw.maxHp)||1000);
    return {uid:String(raw.uid),name:String(raw.name||'修士').slice(0,40),team:raw.team||'player',bot:!!raw.bot,
      gender:raw.gender==='female'?'female':'male',species:num(raw.species),core:type,branch:branch.id,
      atk:Math.max(1,num(raw.atk)||200),baseAtk:num(raw.baseAtk),baseMaxHp:num(raw.baseMaxHp),trainingAccessScore:num(raw.trainingAccessScore),
      maxHp,hp:maxHp,stamina:2,shield:num(raw.shield),
      turns:0,questions:0,answered:0,correct:0,attacks:0,actions:0,guard:0,counter:0,slow:0,cooldowns:{},...pos};
  }
  function create({id,mode='pve',map='courtyard',players,now=Date.now()}){
    const m=mapFor(map),mid=Math.floor(m.height/2);
    const s={version:1,id,mode,map:m.id,width:m.width,height:m.height,terrain:m.terrain,
      blocks:[],actors:[],status:mode==='pvp'&&players.length<2?'waiting':'active',revision:0,
      turn:1,turnUid:players[0].uid,turnStartedAtMs:now,deadlineMs:mode==='pvp'?now+LIMITS.turnMs:0,
      createdAtMs:now,updatedAtMs:now,winner:null,finishReason:'',effects:[],events:[],receipts:[],rewarded:[],turnTimeouts:{}};
    if(m.id!=='courtyard'){
      for(let y=1;y<m.height-1;y++)if(y!==mid)s.blocks.push({x:Math.floor(m.width/2),y});
      s.blocks.push({x:2,y:1},{x:m.width-3,y:m.height-2});
    }else s.blocks.push({x:3,y:1},{x:3,y:5});
    s.actors=players.map((p,i)=>actor({...p,team:mode==='pvp'?p.uid:'player'},{x:i?m.width-2:1,y:mid}));
    if(mode==='pve'){
      const count=m.id==='courtyard'?1:m.id==='bamboo'?2:3;
      for(let i=0;i<count;i++)s.actors.push(actor({uid:'monster-'+i,bot:true,team:'monster',
        name:['靈狼','巖甲獸','古陣守衛'][i],species:[0,8,18][i],
        atk:Math.round(s.actors[0].atk*(.55+i*.1)),maxHp:Math.round(s.actors[0].atk*(3+i*1.3))},
      {x:m.width-2,y:mid+(i===1?-2:i===2?2:0)}));
    }
    current(s).turns=1;prepareIntents(s);return s;
  }
  function join(state,player,now=Date.now()){
    const s=clone(state);if(s.status!=='waiting'||s.mode!=='pvp'||s.actors.some(a=>a.uid===player.uid))fail('此房間無法加入');
    s.actors.push(actor({...player,team:player.uid},{x:s.width-2,y:Math.floor(s.height/2)}));
    s.status='active';s.turnStartedAtMs=now;s.deadlineMs=now+LIMITS.turnMs;s.revision++;return s;
  }
  function log(s,text,type='info',extra={}){s.events.push({id:s.revision+':'+s.events.length,type,text,...extra});s.events=s.events.slice(-28);}
  function canAct(s,uid){if(s.status!=='active'||s.turnUid!==uid||!alive(current(s)))fail('目前不是你的行動回合');}
  function checkFinished(s){
    const human=s.actors.filter(a=>!a.bot),teams=[...new Set(s.actors.filter(alive).map(a=>a.team))];
    if(teams.length<2){s.status='finished';s.winner=teams[0]||'draw';s.finishReason='hp';}
    else if(s.turn>LIMITS.turns){
      s.status='finished';s.finishReason='turn-limit';
      if(s.mode==='pve')s.winner='monster';else{
        const [a,b]=human,delta=a.hp/a.maxHp-b.hp/b.maxHp;s.winner=Math.abs(delta)<1e-9?'draw':delta>0?a.team:b.team;
      }
    }
    if(s.status==='finished')s.deadlineMs=0;
  }
  function damage(s,source,target,raw,opts={}){
    if(!alive(source)||!alive(target))return 0;
    let amount=Math.max(0,Math.round(raw));if(!opts.pierce)amount=Math.round(amount*(1-(target.guard||0)));
    const absorbed=opts.pierce?0:Math.min(target.shield,amount);target.shield-=absorbed;amount-=absorbed;
    const dealt=Math.min(target.hp,amount);target.hp-=dealt;
    log(s,source.name+' → '+target.name+' −'+dealt+(absorbed?'（護盾 '+absorbed+'）':''),'damage',{actor:source.uid,target:target.uid,damage:dealt,skill:opts.skill||'attack',x:target.x,y:target.y});
    if(opts.leech&&dealt){const heal=Math.min(source.maxHp-source.hp,Math.round(dealt*opts.leech));source.hp+=heal;}
    if(target.counter&&alive(target)&&!opts.reflected){
      const reflect=target.counter;target.counter=0;damage(s,target,source,target.atk*reflect,{reflected:true,skill:'counter'});
    }
    return dealt;
  }
  function push(s,a,target,steps){
    const dx=Math.abs(target.x-a.x)>=Math.abs(target.y-a.y)?Math.sign(target.x-a.x):0,dy=dx?0:Math.sign(target.y-a.y);
    for(let i=0;i<steps;i++){const p={x:target.x+dx,y:target.y+dy};if(blocked(s,p)||at(s,p))break;target.x=p.x;target.y=p.y;}
  }
  function skillCells(s,a,sk,p){return sk.kind==='line'?line(s,a,p,sk.range):['area','meteor'].includes(sk.kind)?area(s,p,sk.radius||1):[p];}
  function validateSkill(s,a,sk,p){
    if(a.stamina<sk.cost)fail('體力不足，先答題補充');
    if(a.attacks>=LIMITS.attacks)fail('本回合已使用兩次攻擊／技能');
    if((a.cooldowns[sk.id]||0)>a.turns)fail('技能仍在冷卻');
    if(!inside(s,p)||blocked(s,p)||dist(a,p)>sk.range)fail('目標超出技能範圍');
    if(sk.range===0&&dist(a,p)!==0)fail('請選擇自己');
    if(sk.range>0&&!sight(s,a,p))fail('石障擋住了視線');
    if(sk.kind==='line'&&!line(s,a,p,sk.range).length)fail('請選擇同一行或同一列');
    const t=at(s,p);
    if(['hit','lunge','swap'].includes(sk.kind)&&(!t||t.team===a.team))fail('請選擇敵人');
    if(sk.kind==='blink'&&t)fail('落點必須是空地');
    if(sk.kind==='lunge'){
      const routes=neighbours(s,t).map(n=>path(s,a,n,a.uid)).filter(r=>r&&r.length-1<=sk.range);
      if(!routes.length)fail('無法突進至敵人身旁');
    }
  }
  function cast(s,a,sk,p){
    validateSkill(s,a,sk,p);a.stamina-=sk.cost;a.attacks++;
    if(sk.cooldown)a.cooldowns[sk.id]=a.turns+sk.cooldown;
    log(s,a.name+'施展「'+sk.name+'」','cast',{actor:a.uid,skill:sk.id,x:p.x,y:p.y});
    if(sk.kind==='restore'){
      a.hp=Math.min(a.maxHp,a.hp+Math.round(a.maxHp*sk.power));
      a.shield=Math.min(a.maxHp,Math.max(a.shield,Math.round(a.maxHp*(sk.shield||0))));
      if(sk.cleanse)a.slow=0;return;
    }
    if(sk.kind==='counter'){a.guard=.4;a.counter=sk.power;return;}
    if(sk.kind==='blink'){
      a.x=p.x;a.y=p.y;if(sk.shield)a.shield=Math.max(a.shield,Math.round(a.maxHp*sk.shield));
      if(sk.burst)for(const t of s.actors.filter(t=>alive(t)&&t.team!==a.team&&dist(a,t)<=1))damage(s,a,t,a.atk*sk.burst,{skill:sk.id});return;
    }
    if(sk.kind==='meteor'){
      s.effects.push({owner:a.uid,team:a.team,skill:sk.id,cells:skillCells(s,a,sk,p),power:a.atk*sk.power,due:a.turns+1});return;
    }
    const target=at(s,p);
    if(sk.kind==='lunge'){
      const routes=neighbours(s,target).map(n=>path(s,a,n,a.uid)).filter(r=>r&&r.length-1<=sk.range).sort((a,b)=>a.length-b.length);
      const end=routes[0].at(-1);a.x=end.x;a.y=end.y;
    }
    if(sk.kind==='swap'){const pos={x:a.x,y:a.y};a.x=target.x;a.y=target.y;target.x=pos.x;target.y=pos.y;}
    const targets=sk.kind==='swap'?[target]:s.actors.filter(t=>alive(t)&&t.team!==a.team&&skillCells(s,a,sk,p).some(c=>key(c)===key(t)));
    for(const t of targets){
      if(!alive(a))break;
      let power=sk.power;if(sk.execute&&t.hp/t.maxHp<=.4)power=2.2;if(sk.missing)power+=1.15*(1-a.hp/a.maxHp);
      damage(s,a,t,a.atk*power,{...sk,skill:sk.id});
      if(sk.slow&&alive(t)){t.slow=1;t.slowUntil=t.turns+1;}if(sk.push&&alive(t))push(s,a,t,sk.push);
    }
  }
  function prepareIntents(s){
    if(s.mode!=='pve')return;const hero=s.actors[0];
    for(const m of s.actors.filter(a=>a.bot&&alive(a))){
      const close=dist(m,hero)<=2;
      m.intent={kind:close?'strike':'advance',cells:close?area(s,hero,m.species===18?1:0):[],
        text:close?(m.species===18?'下次：轟擊標記區域':'下次：撲擊標記地格'):'下次：向你接近'};
    }
  }
  function begin(s,a,now){
    s.turnUid=a.uid;a.turns++;a.questions=0;a.attacks=0;a.actions=0;a.guard=0;a.counter=0;
    if((a.slowUntil||0)<a.turns)a.slow=0;
    s.turnStartedAtMs=now;s.deadlineMs=s.mode==='pvp'?now+LIMITS.turnMs:0;
    const due=s.effects.filter(e=>e.owner===a.uid&&e.due<=a.turns);
    s.effects=s.effects.filter(e=>!due.includes(e));
    for(const e of due)for(const t of s.actors.filter(t=>alive(t)&&t.team!==a.team&&e.cells.some(c=>key(c)===key(t))))damage(s,a,t,e.power,{skill:e.skill});
    checkFinished(s);
  }
  function end(s,now){
    if(s.mode==='pve'){
      const hero=s.actors[0];
      for(const m of s.actors.filter(a=>a.bot&&alive(a))){
        if(m.intent?.kind==='strike'){
          if(m.intent.cells.some(p=>key(p)===key(hero)))damage(s,m,hero,m.atk,{skill:'monster'});
          else log(s,hero.name+'避開了'+m.name+'的攻擊','dodge');
        }else{
          const routes=neighbours(s,hero).map(n=>path(s,m,n,m.uid)).filter(Boolean).sort((a,b)=>a.length-b.length);
          if(routes[0]){const p=routes[0][Math.min(2,routes[0].length-1)];m.x=p.x;m.y=p.y;}
        }
        if(!alive(hero))break;
      }
      s.turn++;checkFinished(s);if(s.status==='active'){begin(s,hero,now);prepareIntents(s);}
    }else{
      const next=s.actors.find(a=>a.uid!==s.turnUid);s.turn++;checkFinished(s);if(s.status==='active')begin(s,next,now);
    }
  }
  function apply(state,uid,command,now=Date.now()){
    const s=clone(state);canAct(s,uid);const a=current(s);
    if(s.mode==='pvp'&&now>=s.deadlineMs)fail('行動時間已結束，請同步戰場');
    if(a.actions>=LIMITS.actions&&command.type!=='end')fail('本回合行動已達上限，請結束回合');
    const p={x:command.x,y:command.y};
    if(command.type==='move'){
      const route=path(s,a,p,a.uid),cost=(route?.length-1)*(1+(a.slow||0));
      if(!route||route.length<2)fail('此地格無法到達');if(cost>a.stamina)fail('體力不足以走到這裡');
      a.stamina-=cost;a.x=p.x;a.y=p.y;a.slow=0;
      log(s,a.name+'移動 '+(route.length-1)+' 格，消耗 '+cost+' 體力','move',{actor:a.uid,path:route});
    }else if(command.type==='attack'||command.type==='skill'){
      cast(s,a,command.type==='attack'?BASIC:branchFor(a).skill,p);
    }else if(command.type==='guard'){
      if(a.attacks>=LIMITS.attacks)fail('本回合已使用兩次攻擊／技能');a.guard=Math.max(.4,a.guard);a.attacks++;log(s,a.name+'凝神護身，下次自身回合前減傷 40%','guard');
    }else if(command.type==='end'){end(s,now);}
    else fail('未知的戰場行動');
    a.actions++;s.turnTimeouts[uid]=0;s.revision++;s.updatedAtMs=now;checkFinished(s);return s;
  }
  function answer(state,uid,correct,now=Date.now()){
    const s=clone(state);canAct(s,uid);const a=current(s);
    if(s.mode==='pvp'&&now>=s.deadlineMs)fail('行動時間已結束');
    if(a.questions>=LIMITS.questions)fail('本回合已完成兩題，請行動或結束回合');
    const before=a.stamina;a.stamina=Math.min(LIMITS.stamina,a.stamina+(correct?LIMITS.correct:LIMITS.wrong));
    a.questions++;a.answered++;if(correct)a.correct++;
    log(s,a.name+(correct?'答對':'訂正')+'，體力 +'+(a.stamina-before),'answer',{actor:uid,correct,gain:a.stamina-before});
    s.turnTimeouts[uid]=0;s.revision++;s.updatedAtMs=now;return s;
  }
  function expire(state,now=Date.now()){
    if(state.status!=='active'||state.mode!=='pvp'||now<state.deadlineMs)return state;
    const s=clone(state),uid=s.turnUid;s.turnTimeouts[uid]=(s.turnTimeouts[uid]||0)+1;
    log(s,current(s).name+'行動逾時','timeout');
    if(s.turnTimeouts[uid]>=2){s.status='finished';s.winner=s.actors.find(a=>a.uid!==uid).team;s.finishReason='timeout';s.deadlineMs=0;}
    else end(s,now);
    s.revision++;s.updatedAtMs=now;return s;
  }
  function forfeit(state,uid,now=Date.now()){
    const s=clone(state);if(!s.actors.some(a=>a.uid===uid))fail('你不在此戰場');
    if(s.status==='finished')return s;
    s.status='finished';s.winner=s.mode==='pve'?'monster':s.actors.find(a=>a.uid!==uid)?.team||'draw';s.finishReason='forfeit';s.deadlineMs=0;s.revision++;s.updatedAtMs=now;
    log(s,s.actors.find(a=>a.uid===uid).name+'收法離場','forfeit');return s;
  }
  return Object.freeze({LIMITS,MAPS,CORES,BASIC,num,dist,key,alive,current,mapFor,branchFor,inside,blocked,at,neighbours,path,sight,area,line,actor,create,join,skillCells,validateSkill,apply,answer,expire,forfeit});
});

/* Shared, deterministic stamina battlefield. Server owns every state transition. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./weapon-system-rules.js'):root.QAWeapons);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QATactical=api;
})(globalThis,W=>{
  'use strict';
  const LIMITS=Object.freeze({stamina:10,correct:4,wrong:1,questions:2,attacks:2,actions:16,turns:60,turnMs:30000,answerMs:50000});
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
  const BASIC=skill('attack','普通攻擊',2,2,'line',1,'選擇上下左右一個方向，攻擊該方向兩格；遇障礙停止。',{cooldown:0});
  const basicFor=a=>W?.attackSkill(a?.weapon)||BASIC;
  // The existing spirit page remains the single branch-selection surface.
  const SPIRIT_BRANCHES=Object.freeze({ocean:{tide:'tide',surge:'surge'},taichu:{renew:'renew',devour:'drain'},
    ningxin:{focus:'focus',calm:'barrier'},pojing:{execute:'execute',momentum:'breach'},xingchen:{meteor:'meteor',moon:'orbit'},
    wugou:{clarity:'cleanse',purify:'purify'},thunder:{rebound:'counter',nourish:'lightning'},reverse:{defy:'reversal',balance:'exchange'},sword:{pursuit:'lunge',unity:'blades'}});
  function spiritBranch(type,id){return CORES[type]?.branches.find(b=>b.id===SPIRIT_BRANCHES[type]?.[id])||null;}
  function savedBranch(player,type){
    const c=CORES[type]||CORES.none,path=player?.innateAbilityGrowth?.version===1?player.innateAbilityGrowth.paths?.[type]:null;
    return (Number(path?.level)>0&&spiritBranch(type,path.branch))||c.branches.find(b=>b.id===player?.tacticalPreferences?.[type])||c.branches[0];
  }
  const num=v=>Number.isFinite(Number(v))?Math.max(0,Math.floor(Number(v))):0;
  const fail=message=>{throw Object.assign(new Error(message),{status:409});};
  const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const key=p=>p.x+','+p.y;
  const clone=s=>JSON.parse(JSON.stringify(s));
  const alive=a=>a&&a.hp>0;
  const current=s=>s.actors.find(a=>a.uid===s.turnUid);
  const mapFor=id=>MAPS.find(m=>m.id===id)||MAPS[0];
  function seeded(seed){
    let h=2166136261;for(const c of String(seed)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}
    return ()=>{h+=0x6D2B79F5;let t=Math.imul(h^h>>>15,1|h);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};
  }
  const monster=(name,unlockStage,attackName,attack,moveName,move,attackText,moveText,tip)=>({name,unlockStage,attackName,attack:Object.freeze(attack),moveName,move:Object.freeze(move),attackText,moveText,tip});
  const MONSTERS=Object.freeze([
    monster('靈狼',1,'撲咬',{shape:'point',range:1},'追獵',{kind:'chase',steps:2},'鎖定相鄰的一格，下回合撲咬該紅框。','沿通路追近，每回合最多走兩格。','在結束回合前離開紅框，可避開撲咬。'),
    monster('玄甲山豬',4,'直線衝撞',{shape:'charge',range:3,power:1.15},'對準衝線',{kind:'align',steps:1},'沿上下左右一個方向衝撞三格；紅框整條路徑都危險，遇障礙或角色停止。','每回合走一格，尋找能對準你的直線。','側移離開整條紅框，不要只沿衝撞方向後退。'),
    monster('竹林靈狼',3,'側身爪掃',{shape:'arc',range:1},'繞側疾走',{kind:'flank',steps:3},'掃擊正前與兩側斜前，共三格。','優先繞向側面，每回合最多走三格。','退到爪掃背面，或離開整排紅框。'),
    monster('青竹蛇',5,'穿竹毒牙',{shape:'line',range:2,slow:true},'交錯蛇行',{kind:'weave',steps:2},'直線刺穿兩格；命中後，下次移動每格消耗兩點體力。','交替優先橫向與縱向繞行，每回合最多兩格。','往側面移開毒牙直線，命中後先留足移動體力。'),
    monster('山魈',9,'躍擊',{shape:'pounce',range:3,power:1.1},'越障跳躍',{kind:'leap',steps:2},'鎖定三格內的一個落點；下回合躍到附近，砸擊原先標記的一格。','可跳過中間障礙，落在兩格內的空地。','離開原本的紅框即可，躍擊不會追蹤你移動後的位置。'),
    monster('妖藤',7,'纏根爆發',{shape:'blast',range:3,radius:1,slow:true},'盤根',{kind:'rooted',steps:0},'鎖定落點與四個相鄰格，形成五格十字；命中會使下次移動耗體力加倍。','固定原地，不會追趕。','一次移出整個十字，或利用射程外的位置整備。'),
    monster('沙蠍',6,'尾針射擊',{shape:'shot',range:3},'保持距離',{kind:'kite',steps:1,minDistance:2,ideal:3},'鎖定視線內三格的一格射出尾針。','每回合走一格；過近時會後退，優先維持遠射距離。','貼近可迫使牠重新拉開距離；射擊前先離開標記格。'),
    monster('荒漠蜥蜴',8,'扇形吐息',{shape:'cone',range:2},'游移',{kind:'strafe',steps:2,ideal:2},'朝前方吐息兩層：第一層一格、第二層三格。','每回合最多兩格，尋找能用吐息罩住你的角度。','向左右離開扇形，比沿吐息方向後退更安全。'),
    monster('巖甲獸',2,'震地',{shape:'cross',range:1,power:1.1},'重步',{kind:'heavy',steps:1},'同時震擊周身上下左右四格。','緩慢接近，每回合只走一格。','退到兩格外，別站在任一相鄰紅框。'),
    monster('石靈',17,'斜向石刺',{shape:'diagonal',range:2},'斜移',{kind:'diagonal',steps:1},'朝四條斜線各伸出兩格石刺，遇障礙停止。','優先斜向滑行一格，受阻時改走直格。','站在牠的同行或同列，可避開斜線石刺。'),
    monster('赤焰獸',18,'烈焰吐息',{shape:'cone',range:3,power:1.1},'疾進',{kind:'rush',steps:3},'向前方噴出三層扇形烈焰，最遠一層寬五格。','沿一個方向快速接近，最多三格；轉彎時停下。','靠近扇形側緣脫離，不要一路往最寬的外圈退。'),
    monster('熔岩蜥蜴',19,'熔岩光束',{shape:'line',range:4,power:1.1},'側步瞄準',{kind:'sidestep',steps:1,ideal:4},'朝一條直線貫穿四格，遇障礙停止。','每回合側移一格，優先尋找長距離直線。','移到相鄰的另一行或列，或利用石障截斷光束。'),
    monster('霜羽鷹',12,'俯衝翼斬',{shape:'dive',range:4,sight:false},'振翅越障',{kind:'fly',steps:3,minDistance:2,ideal:3},'鎖定落點及其左右兩格，俯衝斬擊整排三格；障礙無法遮住俯衝。','飛越中間障礙，最多移到三格內的空地。','往紅框排的前方或後方移開，別只沿紅框橫移。'),
    monster('雪狼',11,'霜牙',{shape:'point',range:1,slow:true},'踏雪奔行',{kind:'chase',steps:3},'咬擊相鄰一格；命中後，下次移動每格消耗兩點體力。','每回合最多追近三格。','看到霜牙紅框就先閃開，避免緩速後逃不出下一招。'),
    monster('毒蟾',13,'落毒環',{shape:'ring',range:4,sight:false,slow:true},'蛙躍',{kind:'hop',steps:2},'落毒形成八格方環；紅框有毒，環中央沒有紅框的一格安全。','可越過中間障礙，跳到兩格內的空地。','離開毒環，或移入中央安全格；障礙擋不住落毒。'),
    monster('澤蛇',14,'三岔毒刺',{shape:'fork',range:2,slow:true},'疾速蛇行',{kind:'weave',steps:3},'朝正前、左斜前與右斜前各刺出兩格；命中使下次移動耗體力加倍。','交替優先橫向與縱向，每回合最多走三格。','利用三條紅線之間的空格，或退到牠的身後。'),
    monster('潮汐蟹',15,'雙鉗橫掃',{shape:'sides',range:2,push:1},'橫行',{kind:'sideways',steps:2},'同時橫掃左右各兩格，命中會將你推開一格。','橫向最多走兩格；縱向調位每回合只走一格。','從上方或下方接近，避開牠所在的橫排。'),
    monster('海岸靈龜',16,'外圈震波',{shape:'shell',range:2,power:1.1},'退守',{kind:'kite',steps:1,minDistance:2,ideal:2},'攻擊周身第二圈方環；貼身第一圈和更遠處都不在紅框內。','每回合走一格，過近時退後，維持外圈距離。','可以貼身進內圈，也可以退出最外圈。'),
    monster('古陣守衛',10,'十字鎮壓／落石',{shape:'guardian',range:3,power:1.15},'鎮守調位',{kind:'sentinel',steps:1},'交替使用四向三格十字，以及鎖定落點的五格落石；每次以當前紅框為準。','每回合調位一格，尋找鎮壓軸線。','先確認這回合是十字還是落石，再移出全部紅框。'),
    monster('靈獸',20,'靈能爆發',{shape:'nova',range:4,radius:2,sight:false,power:1.2},'靈躍',{kind:'teleport',steps:2,ideal:3},'鎖定落點，下一回合引爆十三格菱形；不會追蹤你移動後的位置。','可越過中間障礙，靈躍到兩格內的空地。','先答題蓄足體力，一次移出整片菱形紅框。')
  ].map((p,species)=>Object.freeze({...p,species})));
  const monsterProfile=species=>MONSTERS[Number(species)]||MONSTERS[0];
  // Keep the original generator for retries of battles created before layout v2.
  const LEGACY_TRIAL_TERRAINS=Object.freeze([
    {name:'竹影溪谷',terrain:0,props:'tree',enemies:[2,3,4,5]},
    {name:'荒漠殘垣',terrain:13,props:'rock',enemies:[6,7,8,9]},
    {name:'雪嶺險徑',terrain:14,props:'rock',enemies:[12,13,8]},
    {name:'碧水庭苑',terrain:2,props:'rock',enemies:[0,1,16,17]},
    {name:'古陣遺墟',terrain:16,props:'rock',enemies:[8,9,18]}
  ]);
  const TRIAL_TERRAINS=Object.freeze(LEGACY_TRIAL_TERRAINS.map((t,i)=>Object.freeze({...t,enemies:Object.freeze([[0,2,3,4,5],[0,1,6,7,10,11],[0,8,9,12,13],[0,1,14,15,16,17],[0,8,9,10,18,19]][i])})));
  const TRIAL_ENEMIES=Object.freeze(MONSTERS.map(p=>p.name));
  function stageLayout(seed,stage=1,layoutVersion=2){
    stage=Math.max(1,Math.min(1000000,num(stage)));const random=seeded(seed+':stage:'+stage);
    const m=MAPS[Math.floor(random()*MAPS.length)],introduced=layoutVersion>=2?MONSTERS.find(p=>p.unlockStage===stage):null;
    const themes=layoutVersion<2?LEGACY_TRIAL_TERRAINS:introduced?TRIAL_TERRAINS.filter(t=>t.enemies.includes(introduced.species)):TRIAL_TERRAINS;
    const theme=themes[Math.floor(random()*themes.length)],pool=layoutVersion<2?theme.enemies:theme.enemies.filter(id=>MONSTERS[id].unlockStage<=stage);
    const width=m.width,height=m.height,spawn={x:1,y:1+Math.floor(random()*(height-2))},enemies=[],blocks=[];
    const count=Math.min(4,1+Math.floor((stage-1)/3)+(stage>1&&random()<.35?1:0));
    const spaces=[];for(let y=1;y<height-1;y++)for(let x=Math.floor(width/2)+1;x<width-1;x++)spaces.push({x,y});
    for(let i=spaces.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[spaces[i],spaces[j]]=[spaces[j],spaces[i]];}
    for(let i=0;i<count;i++){
      const species=layoutVersion<2?(stage%5===0&&i===count-1?18:pool[Math.floor(random()*pool.length)]):
        i===0&&introduced?introduced.species:stage>=10&&stage%5===0&&i===count-1&&introduced?.species!==18?18:pool[Math.floor(random()*pool.length)];
      enemies.push({...spaces[i],species,name:(stage%5===0&&species===18?'鎮關・':'')+TRIAL_ENEMIES[species],
        hpFactor:(species===8||species===18?3.8:2.8+random()*.6)*(1+Math.min(stage-1,30)*.035),
        attackFactor:(species===18?.7:.48+random()*.15)*(1+Math.min(stage-1,30)*.025),
        intentRange:[3,6,12,18].includes(species)?3:2,intentRadius:species===18?1:0,moveSteps:species===8||species===18?1:2,level:stage});
    }
    const protectedCells=[spawn,...enemies];
    const reachable=()=>{
      const occupied=new Set(blocks.map(key)),seen=new Set([key(spawn)]),q=[spawn];
      for(let i=0;i<q.length;i++)for(const p of [{x:q[i].x+1,y:q[i].y},{x:q[i].x-1,y:q[i].y},{x:q[i].x,y:q[i].y+1},{x:q[i].x,y:q[i].y-1}]){
        const k=key(p);if(p.x<0||p.y<0||p.x>=width||p.y>=height||occupied.has(k)||seen.has(k))continue;seen.add(k);q.push(p);
      }
      return seen.size===width*height-blocks.length;
    };
    const candidates=[];for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(protectedCells.every(p=>dist(p,{x,y})>1))candidates.push({x,y});
    for(let i=candidates.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
    const desired=Math.floor(width*height*(.1+random()*.07));
    for(const p of candidates){if(blocks.length>=desired)break;blocks.push({...p,kind:theme.terrain===13?'rock':random()<.2?'water':theme.props});if(!reachable())blocks.pop();}
    const ground=Array(width*height).fill(theme.terrain);for(const b of blocks)if(b.kind==='water')ground[b.y*width+b.x]=4;
    return {seed,stage,layoutVersion,map:m.id,width,height,title:theme.name,terrain:theme.terrain,ground,blocks,spawn,enemies};
  }
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
  function moveCells(s,a){
    if(!a||!alive(a)||a.actions>=LIMITS.actions)return [];
    const step=1+(a.slow||0),queue=[{x:a.x,y:a.y,cost:0}],seen=new Set([key(a)]),cells=[];
    for(let i=0;i<queue.length;i++){
      const p=queue[i],cost=p.cost+step;if(cost>a.stamina)continue;
      for(const n of neighbours(s,p))if(!seen.has(key(n))&&!at(s,n)){
        const cell={...n,cost};seen.add(key(n));cells.push(cell);queue.push(cell);
      }
    }
    return cells;
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
      ...(W?.get(raw.weapon?.type)?{weapon:{version:W.VERSION,type:raw.weapon.type,realm:W.realmIndex(raw.weapon)}}:{}),
      ...(num(raw.enemyScaleAttack)?{enemyScaleAttack:num(raw.enemyScaleAttack)}:{}),
      ...(raw.bot?{level:Math.max(1,num(raw.level)||1)}:{}),
      atk:Math.max(1,num(raw.atk)||200),baseAtk:num(raw.baseAtk),baseMaxHp:num(raw.baseMaxHp),trainingAccessScore:num(raw.trainingAccessScore),
      maxHp,hp:maxHp,stamina:2,shield:num(raw.shield),
      intentRange:num(raw.intentRange)||2,intentRadius:num(raw.intentRadius??(raw.species===18?1:0)),moveSteps:num(raw.moveSteps)||2,
      turns:0,questions:0,answered:0,correct:0,attacks:0,actions:0,guard:0,counter:0,slow:0,cooldowns:{},...pos};
  }
  function create({id,mode='pve',map='courtyard',players,trial=null,simultaneous=mode==='pvp',now=Date.now()}){
    const layout=mode==='pve'&&trial&&trial.layoutVersion!==0?stageLayout(trial.seed,trial.stage,trial.layoutVersion??2):null;
    const m=layout||mapFor(map),mid=Math.floor(m.height/2);
    const s={version:1,id,mode,map:m.id,width:m.width,height:m.height,terrain:m.terrain,
      blocks:[],actors:[],status:mode==='pvp'&&players.length<2?'waiting':'active',revision:0,
      turn:1,turnUid:players[0].uid,turnStartedAtMs:now,deadlineMs:mode==='pvp'?now+LIMITS.turnMs:0,
      createdAtMs:now,updatedAtMs:now,winner:null,finishReason:'',effects:[],events:[],receipts:[],rewarded:[],turnTimeouts:{}};
    if(layout){s.map=layout.map;s.trial={version:1,seed:layout.seed,stage:layout.stage,layoutVersion:layout.layoutVersion,title:layout.title};s.ground=layout.ground;s.blocks=layout.blocks;}
    else if(mode==='pve'&&trial)s.trial={version:1,seed:trial.seed,stage:trial.stage,layoutVersion:0,title:m.name};
    else if(m.id!=='courtyard'){
      for(let y=1;y<m.height-1;y++)if(y!==mid)s.blocks.push({x:Math.floor(m.width/2),y});
      s.blocks.push({x:2,y:1},{x:m.width-3,y:m.height-2});
    }else s.blocks.push({x:3,y:1},{x:3,y:5});
    s.actors=players.map((p,i)=>actor({...p,team:mode==='pvp'?p.uid:'player'},layout?layout.spawn:{x:i?m.width-2:1,y:mid}));
    const enemyScaleAttack=s.actors[0].enemyScaleAttack||s.actors[0].atk;
    if(layout){
      for(const [i,m]of layout.enemies.entries())s.actors.push(actor({...m,uid:'monster-'+i,bot:true,team:'monster',
        atk:Math.round(enemyScaleAttack*m.attackFactor),maxHp:Math.round(enemyScaleAttack*m.hpFactor)},{x:m.x,y:m.y}));
    }else if(mode==='pve'){
      const count=m.id==='courtyard'?1:m.id==='bamboo'?2:3;
      for(let i=0;i<count;i++)s.actors.push(actor({uid:'monster-'+i,bot:true,team:'monster',
        name:['靈狼','巖甲獸','古陣守衛'][i],species:[0,8,18][i],
        atk:Math.round(enemyScaleAttack*(.55+i*.1)),maxHp:Math.round(enemyScaleAttack*(3+i*1.3))},
      {x:m.width-2,y:mid+(i===1?-2:i===2?2:0)}));
    }
    current(s).turns=1;
    if(mode==='pvp'&&simultaneous){s.quizRound=0;questionRound(s,now);s.actors.forEach(a=>a.turns=0);}
    prepareIntents(s);return s;
  }
  function join(state,player,now=Date.now()){
    const s=clone(state);if(s.status!=='waiting'||s.mode!=='pvp'||s.actors.some(a=>a.uid===player.uid))fail('此房間無法加入');
    s.actors.push(actor({...player,team:player.uid},{x:s.width-2,y:Math.floor(s.height/2)}));
    s.status='active';s.turnStartedAtMs=now;s.deadlineMs=now+LIMITS.turnMs;
    if(s.quizRound){s.quizRound=0;questionRound(s,now);}
    s.revision++;return s;
  }
  function log(s,text,type='info',extra={}){
    // A bounded log still needs unique IDs when one turn produces many effects.
    s.eventSequence=(s.eventSequence||0)+1;
    const event={id:s.revision+':'+s.eventSequence,type,text,...extra};s.events.push(event);s.events=s.events.slice(-28);return event;
  }
  const point=a=>({x:a.x,y:a.y});
  const appearance=a=>({uid:a.uid,hp:a.hp,shield:a.shield,stamina:a.stamina,guard:a.guard,slow:a.slow});
  function motion(s,a,route,style='walk',text=a.name+'調整位置'){
    if(route.length<2||key(route[0])===key(route.at(-1)))return;
    log(s,text,'displace',{actor:a.uid,path:route,animation:{kind:'move',style}});
  }
  function recovery(s,a,hp,shield=0){
    if(!hp&&!shield)return;
    log(s,a.name+(hp?'回復 '+hp+' 生命':'')+(shield?' · 護盾 +'+shield:''),'restore',
      {actor:a.uid,animation:{kind:'restore',changes:[appearance(a)],numbers:[{uid:a.uid,heal:hp,shield}]}});
  }
  function canAct(s,uid){if(s.status!=='active'||s.turnUid!==uid||s.quizRound&&s.phase!=='action'||!alive(current(s)))fail('目前不是你的行動回合');}
  function canAnswer(s,uid,now=Date.now()){
    const a=s.actors.find(a=>a.uid===uid&&!a.bot);
    if(!s.quizRound){canAct(s,uid);if(s.mode==='pvp'&&now>=s.deadlineMs)fail('行動時間已結束');}
    else if(s.status!=='active'||!a||!alive(a)||a.quizExpired||s.actedUids.includes(uid)||s.answerDeadlineMs&&now>=s.answerDeadlineMs)fail('本輪答題時間已結束');
    if(a.questions>=LIMITS.questions)fail('本回合已完成兩題，請行動或結束回合');
    return a;
  }
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
    const shieldScale=opts.shieldMultiplier||1,absorbed=opts.pierce?0:Math.min(target.shield,Math.round(amount*shieldScale));target.shield-=absorbed;amount=Math.max(0,amount-Math.ceil(absorbed/shieldScale));
    const dealt=Math.min(target.hp,amount);target.hp-=dealt;
    log(s,source.name+' → '+target.name+' −'+dealt+(absorbed?'（護盾 '+absorbed+'）':''),'damage',{actor:source.uid,target:target.uid,damage:dealt,skill:opts.skill||'attack',x:target.x,y:target.y,
      animation:{kind:'damage',style:opts.skill||'attack',origin:point(source),target:point(target),changes:[appearance(target)],numbers:[{uid:target.uid,damage:dealt,absorbed}]}});
    if(opts.leech&&dealt){const heal=Math.min(source.maxHp-source.hp,Math.round(dealt*opts.leech));source.hp+=heal;recovery(s,source,heal);}
    if(target.counter&&alive(target)&&!opts.reflected){
      const reflect=target.counter;target.counter=0;damage(s,target,source,target.atk*reflect,{reflected:true,skill:'counter'});
    }
    return dealt;
  }
  function push(s,a,target,steps){
    const before=key(target),route=[point(target)];
    const dx=Math.abs(target.x-a.x)>=Math.abs(target.y-a.y)?Math.sign(target.x-a.x):0,dy=dx?0:Math.sign(target.y-a.y);
    for(let i=0;i<steps;i++){const p={x:target.x+dx,y:target.y+dy};if(blocked(s,p)||at(s,p))break;target.x=p.x;target.y=p.y;route.push(point(target));}
    motion(s,target,route,'push',target.name+'被擊退');
    if(target.bot&&key(target)!==before)interruptMonster(target);
  }
  // Geometric aiming range stays visible even while stamina/cooldown prevents a
  // cast. The server still validates the selected enemy, resources and turn.
  function attackDirection(a,p){const dx=p.x-a.x,dy=p.y-a.y;if(!dx&&!dy)return null;
    return Math.abs(dy)>=Math.abs(dx)?{x:0,y:Math.sign(dy)}:{x:Math.sign(dx),y:0};}
  function skillDistance(a,p,sk){return sk.metric==='square'?Math.max(Math.abs(p.x-a.x),Math.abs(p.y-a.y)):dist(a,p);}
  function rectangle(s,a,sk,p){const d=attackDirection(a,p);if(!d)return [];
    const depth=sk.depth||1,half=Math.floor((sk.width||3)/2),dx=p.x-a.x,dy=p.y-a.y,forward=dx*d.x+dy*d.y,side=-dx*d.y+dy*d.x;
    if(forward<1||forward>depth||Math.abs(side)>half)return [];
    const cells=[];for(let step=1;step<=depth;step++)for(let i=-half;i<=half;i++){
      const c={x:a.x+d.x*step-d.y*i,y:a.y+d.y*step+d.x*i};if(inside(s,c)&&!blocked(s,c)&&sight(s,a,c))cells.push(c);
    }return cells;
  }
  function ring(s,a){const cells=[];for(let y=a.y-1;y<=a.y+1;y++)for(let x=a.x-1;x<=a.x+1;x++){
    const p={x,y};if(key(p)!==key(a)&&inside(s,p)&&!blocked(s,p)&&sight(s,a,p))cells.push(p);
  }return cells;}
  function aimCells(s,a,sk){
    if(!a||!alive(a))return [];
    if(sk.kind==='ring')return ring(s,a);
    if(sk.kind==='cleave'){const cells=new Map();for(const d of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}])for(const p of rectangle(s,a,sk,{x:a.x+d.x,y:a.y+d.y}))cells.set(key(p),p);return [...cells.values()];}
    if(sk.kind==='line')return [{x:a.x+1,y:a.y},{x:a.x-1,y:a.y},{x:a.x,y:a.y+1},{x:a.x,y:a.y-1}].flatMap(p=>line(s,a,p,sk.range));
    const cells=[];
    for(let y=Math.max(0,a.y-sk.range);y<=Math.min(s.height-1,a.y+sk.range);y++)for(let x=Math.max(0,a.x-sk.range);x<=Math.min(s.width-1,a.x+sk.range);x++){
      const p={x,y};if(skillDistance(a,p,sk)>sk.range||skillDistance(a,p,sk)<(sk.minRange||0)||blocked(s,p)||!sight(s,a,p))continue;
      if(sk.kind==='blink'&&at(s,p))continue;
      if(['hit','lunge','swap'].includes(sk.kind)&&key(p)===key(a))continue;
      cells.push(p);
    }
    return cells;
  }
  function skillCells(s,a,sk,p){
    if(sk.kind==='cleave')return rectangle(s,a,sk,p);
    if(sk.kind==='ring')return ring(s,a);
    return sk.kind==='line'?line(s,a,p,sk.range):['area','meteor'].includes(sk.kind)||sk.kind==='blink'&&sk.burst?area(s,p,sk.radius||1):[p];
  }
  function validateSkill(s,a,sk,p){
    if(a.stamina<sk.cost)fail('體力不足，先答題補充');
    if(a.attacks>=LIMITS.attacks)fail('本回合已使用兩次攻擊／技能');
    if((a.cooldowns[sk.id]||0)>a.turns)fail('技能仍在冷卻');
    if(!inside(s,p)||blocked(s,p)||(sk.kind==='cleave'?!rectangle(s,a,sk,p).some(c=>key(c)===key(p)):skillDistance(a,p,sk)>sk.range))fail('目標超出技能範圍');
    if(skillDistance(a,p,sk)<(sk.minRange||0))fail('距離太近，弓需要至少兩格距離');
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
    const castEvent=log(s,a.name+'施展「'+sk.name+'」','cast',{actor:a.uid,skill:sk.id,x:p.x,y:p.y,
      animation:{kind:'cast',style:sk.kind,origin:point(a),target:point(p),cells:skillCells(s,a,sk,p),color:sk.color||(CORES[a.core]||CORES.none).color,changes:[appearance(a)]}});
    if(sk.kind==='restore'){
      const hp=a.hp,shield=a.shield;
      a.hp=Math.min(a.maxHp,a.hp+Math.round(a.maxHp*sk.power));
      a.shield=Math.min(a.maxHp,Math.max(a.shield,Math.round(a.maxHp*(sk.shield||0))));
      if(sk.cleanse)a.slow=0;recovery(s,a,a.hp-hp,a.shield-shield);return;
    }
    if(sk.kind==='counter'){a.guard=.4;a.counter=sk.power;castEvent.animation.changes=[appearance(a)];return;}
    if(sk.kind==='blink'){
      const origin=point(a),shield=a.shield;
      a.x=p.x;a.y=p.y;if(sk.shield)a.shield=Math.max(a.shield,Math.round(a.maxHp*sk.shield));
      motion(s,a,[origin,point(a)],'teleport');recovery(s,a,0,a.shield-shield);
      if(sk.burst)for(const t of s.actors.filter(t=>alive(t)&&t.team!==a.team&&dist(a,t)<=1))damage(s,a,t,a.atk*sk.burst,{skill:sk.id});return;
    }
    if(sk.kind==='meteor'){
      s.effects.push({owner:a.uid,team:a.team,skill:sk.id,cells:skillCells(s,a,sk,p),power:a.atk*sk.power,due:a.turns+1});return;
    }
    const target=at(s,p);
    if(sk.kind==='lunge'){
      const routes=neighbours(s,target).map(n=>path(s,a,n,a.uid)).filter(r=>r&&r.length-1<=sk.range).sort((a,b)=>a.length-b.length);
      const route=routes[0],end=route.at(-1);a.x=end.x;a.y=end.y;motion(s,a,route,'dash',a.name+'劍意突進');
    }
    if(sk.kind==='swap'){
      const pos=point(a),other=point(target);a.x=target.x;a.y=target.y;target.x=pos.x;target.y=pos.y;if(target.bot)interruptMonster(target);
      log(s,a.name+'與'+target.name+'交換位置','displace',{actor:a.uid,animation:{kind:'move',style:'teleport',moves:[{uid:a.uid,path:[pos,other]},{uid:target.uid,path:[other,pos]}]}});
    }
    const targets=sk.kind==='swap'?[target]:s.actors.filter(t=>alive(t)&&t.team!==a.team&&skillCells(s,a,sk,p).some(c=>key(c)===key(t)));
    for(const t of targets){
      if(!alive(a))break;
      let power=sk.power;if(sk.execute&&t.hp/t.maxHp<=.4)power=2.2;if(sk.missing)power+=1.15*(1-a.hp/a.maxHp);
      damage(s,a,t,a.atk*power,{...sk,skill:sk.id});
      if(sk.slow&&alive(t)){t.slow=1;t.slowUntil=t.turns+1;}if(sk.push&&alive(t))push(s,a,t,sk.push);
    }
  }
  function interruptMonster(m){m.intent={version:2,kind:'stagger',cells:[],text:'位移打斷：下回合重新蓄勢'};}
  function monsterCells(s,m,target,profile=monsterProfile(m.species)){
    const attack=profile.attack,range=attack.range;
    const dx=Math.abs(target.x-m.x)>=Math.abs(target.y-m.y)?Math.sign(target.x-m.x)||1:0,dy=dx?0:Math.sign(target.y-m.y)||1;
    const side={x:-dy,y:dx},point={x:target.x,y:target.y};let shape=attack.shape,cells=[];
    if(shape==='guardian')shape=s.turn%2===0?'guardian-cross':'guardian-blast';
    if(['point','shot','blast','pounce','dive','ring','nova','guardian-blast'].includes(shape)){
      if(dist(m,target)>range||attack.sight!==false&&!sight(s,m,target))return [];
    }
    if(['point','shot','pounce'].includes(shape))cells=[point];
    else if(['line','charge'].includes(shape))cells=line(s,m,target,range);
    else if(['cross','guardian-cross','sides'].includes(shape)){
      const dirs=shape==='sides'?[[1,0],[-1,0]]:[[1,0],[-1,0],[0,1],[0,-1]];
      cells=dirs.flatMap(([x,y])=>line(s,m,{x:m.x+x,y:m.y+y},range));
    }else if(shape==='diagonal'){
      for(const [x,y]of [[1,1],[1,-1],[-1,1],[-1,-1]])for(let n=1;n<=range;n++){
        const p={x:m.x+x*n,y:m.y+y*n};
        if(blocked(s,p)||blocked(s,{x:p.x-x,y:p.y})||blocked(s,{x:p.x,y:p.y-y}))break;cells.push(p);
      }
    }else if(['cone','fork','arc'].includes(shape)){
      for(let depth=1;depth<=range;depth++){
        const offsets=shape==='arc'?[-1,0,1]:shape==='fork'?[-depth,0,depth]:Array.from({length:depth*2-1},(_,i)=>i-depth+1);
        for(const offset of offsets)cells.push({x:m.x+dx*depth+side.x*offset,y:m.y+dy*depth+side.y*offset});
      }
    }else if(shape==='dive')cells=[-1,0,1].map(n=>({x:point.x+side.x*n,y:point.y+side.y*n}));
    else if(shape==='ring'){
      const center={x:point.x-dx,y:point.y-dy};
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)if(x||y)cells.push({x:center.x+x,y:center.y+y});
    }else if(shape==='shell'){
      for(let x=-range;x<=range;x++)for(let y=-range;y<=range;y++)if(Math.max(Math.abs(x),Math.abs(y))===range)cells.push({x:m.x+x,y:m.y+y});
    }else cells=area(s,point,attack.radius||1);
    cells=cells.filter(p=>!blocked(s,p)&&(attack.sight===false||sight(s,m,p)));
    if(shape==='charge'){
      const first=cells.findIndex(p=>at(s,p)&&at(s,p).uid!==m.uid);if(first>=0)cells=cells.slice(0,first+1);
    }
    return [...new Map(cells.map(p=>[key(p),p])).values()];
  }
  function monsterRoute(s,m,hero){
    const profile=monsterProfile(m.species),move=profile.move,budget=Math.floor(move.steps/(1+(m.slow||0))),origin={x:m.x,y:m.y};
    if(!budget||move.kind==='rooted')return [origin];
    const jumping=['leap','hop','fly','teleport'].includes(move.kind),parents=new Map([[key(origin),null]]),queue=[origin];
    const open=p=>!blocked(s,p)&&(!at(s,p)||at(s,p).uid===m.uid);
    function next(p){
      if(jumping){const result=[];
        for(let y=Math.max(0,p.y-budget);y<=Math.min(s.height-1,p.y+budget);y++)for(let x=Math.max(0,p.x-budget);x<=Math.min(s.width-1,p.x+budget);x++){
          const n={x,y},distance=move.kind==='fly'?Math.max(Math.abs(x-p.x),Math.abs(y-p.y)):dist(p,n);
          if(distance>0&&distance<=budget&&open(n))result.push(n);
        }return result;
      }
      let result=neighbours(s,p).filter(open);
      if(move.kind==='weave'&&(s.turn+m.species)%2)result.sort((a,b)=>Math.abs(b.y-p.y)-Math.abs(a.y-p.y));
      if(move.kind==='diagonal')result=[...[[1,1],[1,-1],[-1,1],[-1,-1]].map(([x,y])=>({x:p.x+x,y:p.y+y})).filter(n=>open(n)&&!blocked(s,{x:n.x,y:p.y})&&!blocked(s,{x:p.x,y:n.y})),...result];
      return result;
    }
    for(let i=0;i<queue.length;i++)for(const n of next(queue[i]))if(!parents.has(key(n))){parents.set(key(n),queue[i]);queue.push(n);}
    const routeTo=p=>{const route=[];while(p){route.unshift(p);p=parents.get(key(p));}return route;};
    const ranked=queue.map(p=>{
      const route=routeTo(p),distance=dist(p,hero),ready=distance>=(move.minDistance||0)&&monsterCells(s,{...m,...p},hero,profile).some(c=>key(c)===key(hero));
      const flank=move.kind==='flank'?(Math.abs(m.x-hero.x)>=Math.abs(m.y-hero.y)?Number(p.y===hero.y):Number(p.x===hero.x)):0;
      return {route,score:[ready?0:1,flank,move.ideal?Math.abs(distance-move.ideal):route.length,move.ideal?route.length:distance]};
    }).sort((a,b)=>{for(let i=0;i<a.score.length;i++)if(a.score[i]!==b.score[i])return a.score[i]-b.score[i];return 0;});
    let route=ranked[0]?.route||[origin];
    if(jumping)return route.slice(0,2);
    route=route.slice(0,budget+1);
    if(['rush','sideways'].includes(move.kind)&&route.length>1){
      const horizontal=route[1].x!==origin.x,limit=move.kind==='sideways'&&!horizontal?1:budget;
      const turn=route.findIndex((p,i)=>i>0&&(horizontal?p.y!==origin.y:p.x!==origin.x));
      route=route.slice(0,Math.min(turn<0?route.length:turn,limit+1));
    }
    return route;
  }
  function prepareIntents(s){
    if(s.mode!=='pve')return;const hero=s.actors[0];
    for(const m of s.actors.filter(a=>a.bot&&alive(a))){
      const profile=monsterProfile(m.species),cells=monsterCells(s,m,hero,profile),ready=dist(m,hero)>=(profile.move.minDistance||0)&&cells.some(p=>key(p)===key(hero));
      const name=profile.attack.shape==='guardian'?(s.turn%2===0?'天樞十字':'落石鎮壓'):profile.attackName;
      m.intent={version:2,kind:ready?'attack':profile.move.steps?'advance':'wait',cells:ready?cells:[],
        origin:{x:m.x,y:m.y},target:{x:hero.x,y:hero.y},shape:profile.attack.shape,
        power:profile.attack.power||1,slow:!!profile.attack.slow,push:profile.attack.push||0,
        text:ready?'下次：'+name:'下次：'+profile.moveName+(profile.move.steps?' '+profile.move.steps+' 格':'')};
    }
  }
  function monsterTurn(s,m,hero){
    const intent=m.intent;
    if(intent?.kind==='strike'){
      log(s,m.name+'發起攻擊','monster-attack',{actor:m.uid,animation:{kind:'cast',style:'point',origin:point(m),target:point(hero),cells:intent.cells,color:'#dda080'}});
      // Honor an already visible warning from a pre-v2 battle for this turn.
      if(intent.cells.some(p=>key(p)===key(hero)))damage(s,m,hero,m.atk,{skill:'monster'});
      else log(s,hero.name+'避開了'+m.name+'的攻擊','dodge',{actor:hero.uid,animation:{kind:'dodge'}});return;
    }
    if(intent?.kind==='attack'){
      if(intent.origin&&key(intent.origin)!==key(m))return;
      const profile=monsterProfile(m.species),shape=intent.shape==='guardian'?(s.turn%2===0?'cross':'blast'):intent.shape;
      log(s,m.name+'施展「'+profile.attackName+'」','monster-attack',{actor:m.uid,animation:{kind:'cast',style:shape,origin:point(m),target:intent.target,cells:intent.cells,color:profile.attack.slow?'#b8ca82':['cone','line'].includes(shape)?'#e4a06d':'#d9a080'}});
      let hit=intent.cells.some(p=>key(p)===key(hero));
      if(intent.shape==='charge'){
        const route=[point(m)];hit=false;for(const p of intent.cells){if(blocked(s,p))break;const occupant=at(s,p);
          if(occupant){hit=occupant.uid===hero.uid;break;}m.x=p.x;m.y=p.y;route.push(point(m));
        }
        motion(s,m,route,'dash',m.name+'衝撞');
      }
      if(hit){
        damage(s,m,hero,m.atk*(intent.power||1),{skill:'monster-'+m.species});
        if(alive(hero)&&intent.slow){hero.slow=1;hero.slowUntil=hero.turns+1;}
        if(alive(hero)&&intent.push)push(s,m,hero,intent.push);
      }else log(s,hero.name+'避開了'+m.name+'的攻擊','dodge',{actor:hero.uid,animation:{kind:'dodge'}});
      if(alive(m)&&['pounce','dive'].includes(intent.shape)){
        const spots=area(s,intent.target,1).filter(p=>!at(s,p)).sort((a,b)=>dist(a,intent.target)-dist(b,intent.target)||dist(m,a)-dist(m,b));
        if(spots[0]){const origin=point(m);m.x=spots[0].x;m.y=spots[0].y;motion(s,m,[origin,point(m)],intent.shape==='dive'?'fly':'leap');}
      }
      return;
    }
    if(intent?.kind==='stagger'||intent?.kind==='wait'){
      log(s,m.name+(intent.kind==='stagger'?'重新蓄勢':'等待時機'),'wait',{actor:m.uid,animation:{kind:'guard'}});return;
    }
    const route=monsterRoute(s,m,hero),end=route.at(-1);m.slow=0;
    if(route.length>1){m.x=end.x;m.y=end.y;log(s,m.name+'以'+monsterProfile(m.species).moveName+'移動','monster-move',{actor:m.uid,path:route,animation:{kind:'move',style:monsterProfile(m.species).move.kind}});}
    else log(s,m.name+'觀察戰局','wait',{actor:m.uid,animation:{kind:'guard'}});
  }
  function begin(s,a,now){
    s.turnUid=a.uid;a.turns++;if(!s.quizRound)a.questions=0;a.attacks=0;a.actions=0;a.guard=0;a.counter=0;
    if(s.quizRound){s.phase='action';s.actionRevision=s.revision+1;}
    if((a.slowUntil||0)<a.turns)a.slow=0;
    s.turnStartedAtMs=now;s.deadlineMs=s.mode==='pvp'?now+LIMITS.turnMs:0;
    const due=s.effects.filter(e=>e.owner===a.uid&&e.due<=a.turns);
    s.effects=s.effects.filter(e=>!due.includes(e));
    for(const e of due){
      log(s,'隕星落下','impact',{actor:a.uid,skill:e.skill,animation:{kind:'impact',style:'meteor',cells:e.cells,color:'#b5a1e7'}});
      for(const t of s.actors.filter(t=>alive(t)&&t.team!==a.team&&e.cells.some(c=>key(c)===key(t))))damage(s,a,t,e.power,{skill:e.skill});
    }
    checkFinished(s);
    if(s.status==='active')log(s,a.name+'的行動回合','turn',{actor:a.uid,animation:{kind:'turn',changes:[appearance(a)]}});
  }
  function questionRound(s,now){
    s.quizRound++;s.phase='answer';s.initiativeUid='';s.actedUids=[];s.answerDeadlineMs=0;s.deadlineMs=0;
    s.turnStartedAtMs=now;
    for(const a of s.actors){a.questions=0;a.quizExpired=false;}
    // Never carry an in-flight generation or an unanswered question into a new round.
    s.pending={};
  }
  function readyForAction(s,a){return a.questions>=LIMITS.questions||a.quizExpired;}
  function nextAction(s,now){
    const next=s.actors.find(a=>!s.actedUids.includes(a.uid));
    if(!next){questionRound(s,now);return;}
    if(readyForAction(s,next))begin(s,next,now);
    else{s.phase='waiting-answer';s.deadlineMs=0;}
  }
  function end(s,now){
    if(s.mode==='pve'){
      const hero=s.actors[0];
      for(const m of s.actors.filter(a=>a.bot&&alive(a))){
        monsterTurn(s,m,hero);
        if(!alive(hero))break;
      }
      s.turn++;checkFinished(s);if(s.status==='active'){begin(s,hero,now);prepareIntents(s);}
    }else if(s.quizRound){
      s.actedUids.push(s.turnUid);s.turn++;checkFinished(s);if(s.status==='active')nextAction(s,now);
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
      log(s,a.name+'移動 '+(route.length-1)+' 格，消耗 '+cost+' 體力','move',{actor:a.uid,path:route,animation:{kind:'move',style:'walk',changes:[appearance(a)]}});
    }else if(command.type==='attack'||command.type==='skill'){
      cast(s,a,command.type==='attack'?basicFor(a):branchFor(a).skill,p);
    }else if(command.type==='guard'){
      if(a.attacks>=LIMITS.attacks)fail('本回合已使用兩次攻擊／技能');a.guard=Math.max(.4,a.guard);a.attacks++;log(s,a.name+'凝神護身，下次自身回合前減傷 40%','guard',{actor:a.uid,animation:{kind:'guard',changes:[appearance(a)]}});
    }else if(command.type==='end'){
      log(s,s.mode==='pve'?'妖獸開始行動':a.name+'結束回合','turn',{actor:a.uid,animation:{kind:'turn'}});end(s,now);
    }
    else fail('未知的戰場行動');
    a.actions++;s.turnTimeouts[uid]=0;s.revision++;if(s.quizRound)s.actionRevision=s.revision;s.updatedAtMs=now;checkFinished(s);return s;
  }
  function answer(state,uid,correct,now=Date.now()){
    // A late response may arrive after the opponent's action clock. Resolve it
    // before accepting this answer so the second player still gets 30 seconds.
    const timed=state.quizRound?expire(state,now):state;
    if(state.quizRound&&timed.quizRound!==state.quizRound)fail('本輪答題時間已結束');
    const s=clone(timed),a=canAnswer(s,uid,now);
    const before=a.stamina;a.stamina=Math.min(LIMITS.stamina,a.stamina+(correct?LIMITS.correct:LIMITS.wrong));
    a.questions++;a.answered++;if(correct)a.correct++;
    log(s,a.name+(correct?'答對':'訂正')+'，體力 +'+(a.stamina-before),'answer',{actor:uid,correct,gain:a.stamina-before,
      animation:{kind:'answer',changes:[appearance(a)],numbers:[{uid,gain:a.stamina-before}]}});
    if(!s.quizRound)s.turnTimeouts[uid]=0;
    if(s.quizRound&&a.questions===LIMITS.questions){
      if(!s.initiativeUid){s.initiativeUid=uid;s.answerDeadlineMs=now+LIMITS.answerMs;begin(s,a,now);}
      else if(s.phase==='waiting-answer')begin(s,a,now);
    }
    s.revision++;s.updatedAtMs=now;return s;
  }
  function expire(state,now=Date.now()){
    if(state.status==='active'&&state.quizRound){
      let s=state;
      // Resolve both clocks in chronological order, even after reconnecting late.
      for(let i=0;i<4&&s.status==='active';i++){
        const quizDue=s.answerDeadlineMs&&s.actors.some(a=>!readyForAction(s,a))?s.answerDeadlineMs:Infinity;
        const actionDue=s.phase==='action'&&s.deadlineMs?s.deadlineMs:Infinity;
        const due=Math.min(quizDue,actionDue);if(now<due||!Number.isFinite(due))break;
        if(s===state)s=clone(state);
        if(quizDue<=actionDue){
          for(const a of s.actors.filter(a=>!readyForAction(s,a))){
            a.quizExpired=true;delete s.pending?.[a.uid];
            log(s,a.name+'答題倒數結束，未作答題目不獲得體力','quiz-timeout',{actor:a.uid});
          }
          if(s.phase==='waiting-answer')nextAction(s,due);
        }else{
          const uid=s.turnUid;s.turnTimeouts[uid]=(s.turnTimeouts[uid]||0)+1;
          log(s,current(s).name+'行動逾時','timeout',{actor:uid,animation:{kind:'turn'}});
          if(s.turnTimeouts[uid]>=2){s.status='finished';s.winner=s.actors.find(a=>a.uid!==uid).team;s.finishReason='timeout';s.deadlineMs=0;}
          else end(s,due);
        }
        s.revision++;s.updatedAtMs=now;
      }
      return s;
    }
    if(state.status!=='active'||state.mode!=='pvp'||now<state.deadlineMs)return state;
    const s=clone(state),uid=s.turnUid;s.turnTimeouts[uid]=(s.turnTimeouts[uid]||0)+1;
    log(s,current(s).name+'行動逾時','timeout',{actor:uid,animation:{kind:'turn'}});
    if(s.turnTimeouts[uid]>=2){s.status='finished';s.winner=s.actors.find(a=>a.uid!==uid).team;s.finishReason='timeout';s.deadlineMs=0;}
    else end(s,now);
    s.revision++;s.updatedAtMs=now;return s;
  }
  function forfeit(state,uid,now=Date.now()){
    const s=clone(state);if(!s.actors.some(a=>a.uid===uid))fail('你不在此戰場');
    if(s.status==='finished')return s;
    s.status='finished';s.winner=s.mode==='pve'?'monster':s.actors.find(a=>a.uid!==uid)?.team||'draw';s.finishReason='forfeit';s.deadlineMs=0;s.revision++;s.updatedAtMs=now;
    log(s,s.actors.find(a=>a.uid===uid).name+'收法離場','forfeit',{actor:uid,animation:{kind:'withdraw'}});return s;
  }
  return Object.freeze({LIMITS,MAPS,CORES,BASIC,basicFor,attackDirection,SPIRIT_BRANCHES,spiritBranch,savedBranch,seeded,stageLayout,MONSTERS,monsterProfile,monsterCells,monsterRoute,prepareIntents,TRIAL_TERRAINS,TRIAL_ENEMIES,num,dist,key,alive,current,mapFor,branchFor,inside,blocked,at,neighbours,path,moveCells,sight,area,line,actor,create,join,aimCells,skillCells,validateSkill,canAnswer,apply,answer,expire,forfeit});
});

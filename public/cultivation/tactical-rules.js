/* Shared, deterministic stamina battlefield. Server owns every state transition. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QATactical=api;
})(globalThis,()=>{
  'use strict';
  // Some pages load the shared rules before the manual catalog. Resolve the
  // browser catalog at use time so the first import cannot hide equipped skills.
  const manuals=()=>typeof module==='object'&&module.exports
    ?require('./manual-rules.js'):globalThis.QAManuals;
  const swordPaths=()=>typeof module==='object'&&module.exports
    ?require('./flying-sword-path.js'):globalThis.QAFlyingSwordPath;
  const weaponDungeons=()=>typeof module==='object'&&module.exports
    ?require('./weapon-dungeon-rules.js'):globalThis.QAWeaponDungeons;
  const gravity=()=>typeof module==='object'&&module.exports?require('./gravity-weapon-rules.js'):globalThis.QAGravityRules;
  const gravityLanding=(s,a,p)=>canOccupy(s,a,p)&&!a.immobilized&&!sealAt(s,p)&&!(s.objective?.shrine&&key(s.objective.shrine)===key(p));
  const gravityGeometry=(s,a,sk)=>gravity().plans(prism().boardForTrial(s),a,sk,s.weaponObjects,a.uid,s.actors,p=>gravityLanding(s,a,p));
  const gravitySelection=(s,a,sk,p)=>gravity().selected(prism().boardForTrial(s),a,sk,s.weaponObjects,a.uid,s.actors,p,q=>gravityLanding(s,a,q));
  const time=()=>typeof module==='object'&&module.exports?require('./time-weapon-rules.js'):globalThis.QATimeRules;
  const timeGeometry=(s,a,sk)=>time().plans(prism().boardForTrial(s),a,sk,s.weaponObjects,a.uid);
  const timeSelection=(s,a,sk,p)=>time().selected(prism().boardForTrial(s),a,sk,s.weaponObjects,a.uid,p);
  const mirror=()=>typeof module==='object'&&module.exports?require('./mirror-weapon-rules.js'):globalThis.QAMirrorRules;
  const mirrorGeometry=(s,a,sk)=>mirror().plans(prism().boardForTrial(s),a,sk,s.weaponObjects,a.uid,p=>canOccupy(s,a,p)&&!a.immobilized);
  const mirrorSelection=(s,a,sk,p)=>mirror().selected(prism().boardForTrial(s),a,sk,s.weaponObjects,a.uid,p,q=>canOccupy(s,a,q)&&!a.immobilized);
  const weave=()=>typeof module==='object'&&module.exports?require('./weave-weapon-rules.js'):globalThis.QAWeaveRules;
  const bell=()=>typeof module==='object'&&module.exports?require('./bell-weapon-rules.js'):globalThis.QABellRules;
  const prism=()=>typeof module==='object'&&module.exports?require('./prism-weapon-rules.js'):globalThis.QAPrismRules;
  const LIMITS=Object.freeze({stamina:10,correct:4,wrong:1,questions:2,attacks:2,actions:16,events:64,turns:60,turnMs:30000,answerMs:50000});
  const MAPS=Object.freeze([
    {id:'courtyard',name:'演武庭',width:7,height:7,terrain:2,description:'開闊石庭，練習近身與迂迴。'},
    {id:'bamboo',name:'青竹幽徑',width:9,height:7,terrain:0,description:'石障分隔通道，利用掩護接近。'},
    {id:'ruins',name:'古陣遺墟',width:11,height:9,terrain:16,description:'寬廣遺跡，適合遠程與範圍技能。'}
  ].map(Object.freeze));
  const skill=(id,name,cost,range,kind,power,description,extra={})=>Object.freeze({id,name,cost,range,kind,power,description,...extra,cooldown:0});
  const core=(name,color,branches)=>Object.freeze({name,color,branches:Object.freeze(branches.map(b=>Object.freeze(b)))});
  const CORES=Object.freeze({
    none:core('未結金丹','#d8d0b6',[
      {id:'breath',name:'養氣',skill:skill('breath','調息護元',3,0,'restore',.15,'回復 15% 生命，獲得 15% 生命護盾。',{shield:.15})}
    ]),
    ocean:core('大海無垠丹','#72cbd6',[
      {id:'surge',name:'逐浪',skill:skill('surge','千尺潮湧',4,4,'line',1.45,'直線攻擊至四格，將命中者推開兩格。',{push:2})},
      {id:'tide',name:'滄海',skill:skill('tide','滄海困陣',4,3,'area',1.1,'攻擊目標及相鄰格；命中者下次單次移動最多兩格。',{slow:true,radius:1})}
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
  const basicFor=()=>BASIC;
  const focusTurns=a=>a.fistFocusUntil?Math.max(0,Math.min(2,a.fistFocusUntil-a.turns+1)):0;
  const attackLimit=a=>focusTurns(a)?3:LIMITS.attacks;
  const techniqueCost=(a,sk)=>focusTurns(a)&&sk.school==='body'&&sk.kind!=='fist-focus'?Math.ceil(sk.cost/2):sk.cost;
  function validateAttackLimit(a){
    if(a.attacks>=attackLimit(a))fail(focusTurns(a)?'本回合已使用三次攻擊／技能':'本回合已使用兩次攻擊／技能');
  }
  function manualSkillFor(actor,id){
    if(!actor||!Array.isArray(actor.manualSkills)||!actor.manualSkills.includes(id))return null;
    const Manuals=manuals(),skill=Manuals?.BY_SKILL?.[id];
    return skill?Manuals.skillAtLevel(skill,actor.manualSkillLevels?.[id],actor.manualRefinements?.[skill.manualId]):null;
  }
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
  // Canonical v4 seal data. UI inspectors and range overlays should read these
  // same values rather than guessing a universal three-tile radius.
  const SEAL_MAX_DURABILITY=2;
  const SEAL_HIT_DAMAGE=1;
  const SEAL_TYPES=Object.freeze({
    shield:Object.freeze({
      id:'shield',label:'護',name:'護靈陣眼',color:'#65c6ec',shortEffect:'護：減傷',
      effect:'距離 3 格內的靈獸受到的非穿透傷害降低 35%。',
      range:Object.freeze({kind:'manhattan',radius:3,label:'曼哈頓距離 3 格'}),
      damageMultiplier:.65,
      onBreak:'此陣眼提供的減傷效果消失。',
      tactic:'先破除陣眼，再攻擊受到保護的靈獸。'
    }),
    hazard:Object.freeze({
      id:'hazard',label:'煞',name:'妖煞陣眼',color:'#d773bd',shortEffect:'煞：危險格',
      effect:'每逢指定回合，預告玩家所在的一格；若回合結束時仍在該格，受到最大生命值 12% 的傷害（至少 1 點）。',
      range:Object.freeze({kind:'warning',radius:null,label:'當前預告危險格（無固定半徑）'}),
      triggerEveryTurns:2,maxHpDamageRatio:.12,
      onBreak:'最後一座妖煞陣眼破除後，已預告的妖煞危險格也會消失。',
      tactic:'確認紅色預告格並移開；也能攻擊陣眼解除威脅。'
    }),
    rage:Object.freeze({
      id:'rage',label:'獸',name:'御獸陣眼',color:'#e9ad60',shortEffect:'獸：增攻',
      effect:'距離 3 格內的靈獸造成的傷害提高 25%。',
      range:Object.freeze({kind:'manhattan',radius:3,label:'曼哈頓距離 3 格'}),
      damageMultiplier:1.25,
      onBreak:'此陣眼提供的靈獸增傷效果消失。',
      tactic:'先破除陣眼，可降低附近靈獸的攻擊威脅。'
    }),
    maze:Object.freeze({
      id:'maze',label:'迷',name:'迷蹤陣眼',color:'#74c9aa',shortEffect:'迷：開路',
      effect:'維持與陣眼連動的石障；破除後會移除該石障（若本關配置了連動石障）。',
      range:Object.freeze({kind:'linked-block',radius:null,label:'連動石障（無固定半徑）'}),
      onBreak:'已連動的石障會被移除，開通道路。',
      tactic:'查看連動石障位置，破除陣眼以打開通路。'
    })
  });
  // Preserve the original deterministic type order; the generator and client
  // both derive it from this single catalog.
  const SEAL_KINDS=Object.freeze(Object.keys(SEAL_TYPES));
  const sealDefinition=kind=>Object.hasOwn(SEAL_TYPES,String(kind))?SEAL_TYPES[kind]:null;
  // Read-only, serializable per-battle snapshot; never modify or enrich the
  // persisted objective. Old layout-v3 seals have different activation rules.
  function sealInfo(state,position){
    if(state?.trial?.layoutVersion!==4||state.objective?.type!=='sealing'||
      !Number.isInteger(position?.x)||!Number.isInteger(position?.y))return null;
    const point=(state.objective.points||[]).find(p=>p.x===position.x&&p.y===position.y);
    const def=sealDefinition(point?.kind);
    if(!point||!def)return null;
    const maximum=Number.isFinite(point.maxHp)&&point.maxHp>0?point.maxHp:SEAL_MAX_DURABILITY;
    const durability=point.activated?0:Math.max(0,Math.min(maximum,Number.isFinite(point.hp)?point.hp:maximum));
    return {
      id:key(point),x:point.x,y:point.y,kind:def.id,label:def.label,name:def.name,
      color:def.color,shortEffect:def.shortEffect,effect:def.effect,range:{...def.range},onBreak:def.onBreak,tactic:def.tactic,
      attackable:!point.activated,active:!point.activated,broken:!!point.activated,
      hp:durability,maxHp:maximum,hitDamage:SEAL_HIT_DAMAGE,
      gate:point.gate?{x:point.gate.x,y:point.gate.y}:null
    };
  }
  function sealInfos(state){
    return state?.objective?.type==='sealing'?(state.objective.points||[])
      .map(p=>sealInfo(state,p)).filter(Boolean):[];
  }
  // Cells eligible for a current seal effect: auras use Manhattan distance
  // regardless of walls, matching damage(); hazards use live telegraph cells.
  // Maze links are presented through sealInfo().gate, not as an invented aura.
  function sealEffectCells(state,position){
    const info=sealInfo(state,position);
    if(!info?.active)return [];
    if(info.range.kind==='warning')
      return (state.objective.hazards||[]).filter(p=>inside(state,p))
        .map(p=>({x:p.x,y:p.y}));
    if(info.range.kind!=='manhattan')return [];
    const cells=[];
    for(let y=0;y<state.height;y++)for(let x=0;x<state.width;x++)
      if(dist(info,{x,y})<=info.range.radius)cells.push({x,y});
    return cells;
  }
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
    monster('青竹蛇',5,'穿竹毒牙',{shape:'line',range:2,slow:true},'交錯蛇行',{kind:'weave',steps:2},'直線刺穿兩格；命中後，下次單次移動最多兩格。','交替優先橫向與縱向繞行，每回合最多兩格。','往側面移開毒牙直線，命中後注意單次移動距離受限。'),
    monster('山魈',9,'躍擊',{shape:'pounce',range:3,power:1.1},'越障跳躍',{kind:'leap',steps:2},'鎖定三格內的一個落點；下回合躍到附近，砸擊原先標記的一格。','可跳過中間障礙，落在兩格內的空地。','離開原本的紅框即可，躍擊不會追蹤你移動後的位置。'),
    monster('妖藤',7,'纏根爆發',{shape:'blast',range:3,radius:1,slow:true},'盤根',{kind:'rooted',steps:0},'鎖定落點與四個相鄰格，形成五格十字；命中後下次單次移動最多兩格。','固定原地，不會追趕。','一次移出整個十字，或利用射程外的位置整備。'),
    monster('沙蠍',6,'尾針射擊',{shape:'shot',range:3},'保持距離',{kind:'kite',steps:1,minDistance:2,ideal:3},'鎖定視線內三格的一格射出尾針。','每回合走一格；過近時會後退，優先維持遠射距離。','貼近可迫使牠重新拉開距離；射擊前先離開標記格。'),
    monster('荒漠蜥蜴',8,'扇形吐息',{shape:'cone',range:2},'游移',{kind:'strafe',steps:2,ideal:2},'朝前方吐息兩層：第一層一格、第二層三格。','每回合最多兩格，尋找能用吐息罩住你的角度。','向左右離開扇形，比沿吐息方向後退更安全。'),
    monster('巖甲獸',2,'震地',{shape:'cross',range:1,power:1.1},'重步',{kind:'heavy',steps:1},'同時震擊周身上下左右四格。','緩慢接近，每回合只走一格。','退到兩格外，別站在任一相鄰紅框。'),
    monster('石靈',17,'斜向石刺',{shape:'diagonal',range:2},'斜移',{kind:'diagonal',steps:1},'朝四條斜線各伸出兩格石刺，遇障礙停止。','優先斜向滑行一格，受阻時改走直格。','站在牠的同行或同列，可避開斜線石刺。'),
    monster('赤焰獸',18,'烈焰吐息',{shape:'cone',range:3,power:1.1},'疾進',{kind:'rush',steps:3},'向前方噴出三層扇形烈焰，最遠一層寬五格。','沿一個方向快速接近，最多三格；轉彎時停下。','靠近扇形側緣脫離，不要一路往最寬的外圈退。'),
    monster('熔岩蜥蜴',19,'熔岩光束',{shape:'line',range:4,power:1.1},'側步瞄準',{kind:'sidestep',steps:1,ideal:4},'朝一條直線貫穿四格，遇障礙停止。','每回合側移一格，優先尋找長距離直線。','移到相鄰的另一行或列，或利用石障截斷光束。'),
    monster('霜羽鷹',12,'俯衝翼斬',{shape:'dive',range:4,sight:false},'振翅越障',{kind:'fly',steps:3,minDistance:2,ideal:3},'鎖定落點及其左右兩格，俯衝斬擊整排三格；障礙無法遮住俯衝。','飛越中間障礙，最多移到三格內的空地。','往紅框排的前方或後方移開，別只沿紅框橫移。'),
    monster('雪狼',11,'霜牙',{shape:'point',range:1,slow:true},'踏雪奔行',{kind:'chase',steps:3},'咬擊相鄰一格；命中後，下次單次移動最多兩格。','每回合最多追近三格。','看到霜牙紅框就先閃開，避免緩速後逃不出下一招。'),
    monster('毒蟾',13,'落毒環',{shape:'ring',range:4,sight:false,slow:true},'蛙躍',{kind:'hop',steps:2},'落毒形成八格方環；紅框有毒，環中央沒有紅框的一格安全。','可越過中間障礙，跳到兩格內的空地。','離開毒環，或移入中央安全格；障礙擋不住落毒。'),
    monster('澤蛇',14,'三岔毒刺',{shape:'fork',range:2,slow:true},'疾速蛇行',{kind:'weave',steps:3},'朝正前、左斜前與右斜前各刺出兩格；命中後下次單次移動最多兩格。','交替優先橫向與縱向，每回合最多走三格。','利用三條紅線之間的空格，或退到牠的身後。'),
    monster('潮汐蟹',15,'雙鉗橫掃',{shape:'sides',range:2,push:1},'橫行',{kind:'sideways',steps:2},'同時橫掃左右各兩格，命中會將你推開一格。','橫向最多走兩格；縱向調位每回合只走一格。','從上方或下方接近，避開牠所在的橫排。'),
    monster('海岸靈龜',16,'外圈震波',{shape:'shell',range:2,power:1.1},'退守',{kind:'kite',steps:1,minDistance:2,ideal:2},'攻擊周身第二圈方環；貼身第一圈和更遠處都不在紅框內。','每回合走一格，過近時退後，維持外圈距離。','可以貼身進內圈，也可以退出最外圈。'),
    monster('古陣守衛',10,'十字鎮壓／落石',{shape:'guardian',range:3,power:1.15},'鎮守調位',{kind:'sentinel',steps:1},'交替使用四向三格十字，以及鎖定落點的五格落石；每次以當前紅框為準。','每回合調位一格，尋找鎮壓軸線。','先確認這回合是十字還是落石，再移出全部紅框。'),
    monster('靈獸',20,'靈能爆發',{shape:'nova',range:4,radius:2,sight:false,power:1.2},'靈躍',{kind:'teleport',steps:2,ideal:3},'鎖定落點，下一回合引爆十三格菱形；不會追蹤你移動後的位置。','可越過中間障礙，靈躍到兩格內的空地。','先答題蓄足體力，一次移出整片菱形紅框。')
  ].map((p,species)=>Object.freeze({...p,species})));
  const monsterProfile=species=>MONSTERS[Number(species)]||MONSTERS[0];
  // Keep the original generator for retries of battles created before layout v2.
  function monsterProfileFor(m){
    const profile=monsterProfile(m.species);
    if(!m.trackingAttack)return profile;
    return {...profile,name:m.name,attackName:m.weaponDungeonLord?'尖峰崩裂':'追蹤落石',
      attack:{shape:'blast',range:m.weaponDungeonLord?4:3,radius:m.weaponDungeonLord?1:0,sight:false,power:1},
      move:{kind:'heavy',steps:1},moveName:'重步',
      attackText:'蓄勢落點會追蹤修士移動；退出射程可避開，成功擊退靈獸則會打斷蓄勢。',
      moveText:'每回合最多移動一格，不會突進、跳躍或擊退。',tip:'紅框會隨你調整；請退出射程，或以擊退打斷蓄勢。'};
  }
  function trackingCells(s,m,hero){
    const profile=monsterProfileFor(m),range=profile.attack.range;
    if(Math.min(...footprint(m).map(p=>dist(p,hero)))>range)return [];
    return area(s,hero,profile.attack.radius);
  }
  function trackingIntent(s,m,hero,armed=false){
    const cells=trackingCells(s,m,hero),ready=cells.some(p=>key(p)===key(hero));
    return {version:2,kind:ready||armed?'attack':'advance',cells,origin:point(m),target:point(hero),shape:'blast',
      power:1,tracking:true,slow:false,push:0,text:ready?'下次：'+monsterProfileFor(m).attackName+'（追蹤，請退出射程）':armed?'已離開射程，本次落石無法命中':'下次：重步 1 格'};
  }
  // Solo-only skill definitions. Live Peak Stone values are unchanged; later
  // dungeons can assign their own ordered definitions in the server layout.
  const DUNGEON_ENEMY_SKILLS=Object.freeze({
    stoneFall:Object.freeze({id:'stone-fall',name:'追蹤落石',shape:'blast',range:3,radius:0,power:1,sight:false,warning:'tracking',animation:'blast'}),
    stoneLord:Object.freeze({id:'stone-lord',name:'尖峰崩裂',shape:'blast',range:4,radius:1,power:1,sight:false,warning:'tracking',animation:'blast'})
  });
  const soloDungeonBeast=(s,m)=>s.mode==='pve'&&!!s.weaponDungeon&&m.bot;
  const dungeonSkillSet=(s,m)=>Array.isArray(m.dungeonSkills)?m.dungeonSkills:
    m.trackingAttack||(s.weaponDungeon?.id||'peak-stone')==='peak-stone'?[m.weaponDungeonLord?DUNGEON_ENEMY_SKILLS.stoneLord:DUNGEON_ENEMY_SKILLS.stoneFall]:[];
  const dungeonSkillAllowed=(s,m,sk)=>sk&&typeof sk.id==='string'&&typeof sk.name==='string'&&
    ['blast','point','line','cone','square'].includes(sk.shape)&&['tracking','locked'].includes(sk.warning)&&
    Number.isInteger(sk.range)&&sk.range>=0&&Number.isFinite(sk.power)&&sk.power>=0&&
    (!sk.lordOnly||m.weaponDungeonLord)&&
    (s.weaponDungeon.difficulty??0)>=(sk.minDifficulty??0)&&(s.weaponDungeon.difficulty??0)<=(sk.maxDifficulty??5);
  function dungeonSquareRing(s,m,r){
    const G=typeof module==='object'&&module.exports?require('./weapon-geometry.js'):globalThis.QAWeaponGeometry;
    const body=footprint(m),board={width:s.width,height:s.height,blocked:p=>blocked(s,p)};
    const cells=body.flatMap(p=>G.squareRing(board,p,r));
    return [...new Map(cells.filter(p=>Math.min(...body.map(q=>Math.max(Math.abs(p.x-q.x),Math.abs(p.y-q.y))))===r).map(p=>[key(p),p])).values()];
  }
  function dungeonSkillPlan(s,m,hero,sk){
    const body=footprint(m),target=point(hero);
    const nearest=body.slice().sort((a,b)=>dist(a,target)-dist(b,target))[0];
    const direction=attackDirection(nearest,target);
    const empty={cells:[],path:[],waves:[],direction,target};
    if(!dungeonSkillAllowed(s,m,sk))return empty;
    const range=sk.range,radius=sk.radius??0;
    let cells=[],waves=[];
    if(sk.shape==='square'){
      const rings=Number.isInteger(sk.rings)&&sk.rings>0?Math.min(sk.rings,range):0;
      const layers=Array.from({length:rings||range},(_,i)=>dungeonSquareRing(s,m,i+1));
      if(rings)waves=layers.map((cells,i)=>({layer:i+1,cells}));
      cells=layers.flat();
    }else if(sk.shape==='blast'||sk.shape==='point'){
      if(dist(nearest,target)>range||sk.sight!==false&&!sight(s,nearest,target))return empty;
      cells=area(s,target,sk.shape==='point'?0:radius);
    }else if(direction){
      // The leading edge is the full width of a large actor, not its anchor.
      const projection=p=>p.x*direction.x+p.y*direction.y;
      const front=Math.max(...body.map(projection));
      const edge=body.filter(p=>projection(p)===front);
      for(const p of edge){
        const aim={x:p.x+direction.x,y:p.y+direction.y};
        if(sk.shape==='line')cells.push(...line(s,p,aim,range));
        else cells.push(...monsterCells(s,p,aim,{attack:{shape:'cone',range,sight:sk.sight}}));
      }
    }
    cells=[...new Map(cells.filter(p=>!blocked(s,p)&&!covers(m,p)).map(p=>[key(p),p])).values()];
    if(!cells.some(p=>key(p)===key(hero)))return empty;
    // Generic skill displacement stores the legal route before the warning.
    // Charge/pushing through a target and collision damage are stage five.
    const path=[];
    if(direction&&Number.isInteger(sk.moveSteps)&&sk.moveSteps>0){
      let p=point(m);
      for(let i=0;i<Math.min(sk.moveSteps,range);i++){
        const next={x:p.x+direction.x,y:p.y+direction.y};
        if(!canOccupy(s,m,next))break;
        path.push(next);p=next;
      }
    }
    return {cells,path,waves,direction,target};
  }
  function dungeonIntent(s,m,hero,prior=null){
    const choices=dungeonSkillSet(s,m);
    // A tracking warning can move, but may never silently switch skills.
    const candidates=prior?[choices.find(sk=>sk.id===prior.skillId)||(!prior.skillId?choices[0]:null)].filter(Boolean):choices;
    for(const sk of candidates){
      if(!dungeonSkillAllowed(s,m,sk))continue;
      const plan=dungeonSkillPlan(s,m,hero,sk),ready=plan.cells.length>0;
      if(!ready&&!prior)continue;
      return {version:3,kind:'attack',skillId:sk.id,skillName:sk.name,origin:point(m),...plan,
        shape:sk.shape,power:sk.power,warning:sk.warning,tracking:sk.warning==='tracking',
        animation:sk.animation||sk.shape,slow:!!sk.slow,push:sk.push||0,interruptible:true,
        text:ready?'下次：'+sk.name+(sk.warning==='tracking'?'（追蹤，請退出射程）':'（鎖定）'):'已離開射程，本次'+sk.name+'無法命中'};
    }
    return {version:3,kind:'advance',cells:[],origin:point(m),target:point(hero),text:'下次：重步 1 格'};
  }
  function retargetTrackingIntents(s){
    if(!s.weaponDungeon||s.status!=='active')return;
    const hero=s.actors[0];
    for(const m of s.actors.filter(a=>soloDungeonBeast(s,a)&&alive(a))){
      const prior=m.intent;
      if(prior?.kind==='attack'&&(prior.warning==='tracking'||!prior.warning&&prior.tracking)){
        m.intent=dungeonIntent(s,m,hero,prior);
      }
    }
  }
  const LEGACY_TRIAL_TERRAINS=Object.freeze([
    {name:'竹影溪谷',terrain:0,props:'tree',enemies:[2,3,4,5]},
    {name:'荒漠殘垣',terrain:13,props:'rock',enemies:[6,7,8,9]},
    {name:'雪嶺險徑',terrain:14,props:'rock',enemies:[12,13,8]},
    {name:'碧水庭苑',terrain:2,props:'rock',enemies:[0,1,16,17]},
    {name:'古陣遺墟',terrain:16,props:'rock',enemies:[8,9,18]}
  ]);
  const TRIAL_TERRAINS=Object.freeze(LEGACY_TRIAL_TERRAINS.map((t,i)=>Object.freeze({...t,enemies:Object.freeze([[0,2,3,4,5],[0,1,6,7,10,11],[0,8,9,12,13],[0,1,14,15,16,17],[0,8,9,10,18,19]][i])})));
  const TRIAL_ENEMIES=Object.freeze(MONSTERS.map(p=>p.name));
  // The v3 generator is kept separate so older rooms and retries retain their layout.
  function stageLayoutV3(seed,stage=1){
    stage=Math.max(1,Math.min(1000000,num(stage)));
    const stream=name=>seeded(String(seed)+':stage:'+stage+':v3:'+name);
    const pick=(r,items)=>items[Math.floor(r()*items.length)];
    const shuffle=(r,items)=>{items=items.slice();for(let i=items.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items;};
    const schedule=['elimination','elimination','elimination','elimination','elimination','transport','elimination','sealing','elimination','boss','transport','sealing','elimination','transport','boss','transport','sealing','elimination','transport','boss'];
    let mode;
    if(stage<=20)mode=schedule[stage-1];
    else {
      const slot=(stage-21)%5,group=Math.floor((stage-21)/5);
      mode=slot===4?'boss':shuffle(seeded(String(seed)+':v3:group:'+group),['elimination','elimination','transport','sealing'])[slot];
    }
    const mr=stream('mode'),gr=stream('geometry'),br=stream('biome'),or=stream('objectives'),rr=stream('obstacles'),er=stream('monsters');
    const pickup=mode==='transport'&&(stage===11||stage===19||stage!==6&&stage!==14&&mr()<.5);
    const wantsBreakthrough=mode==='transport'&&(stage===14||stage===19||stage>=21&&mr()<.35);
    const sizes={elimination:[[7,7],[9,7]],transport:[[11,9],[13,9],[15,11]],sealing:[[9,7],[11,9],[13,9]],boss:[[11,9],[13,9]]};
    const [width,height]=pick(gr,wantsBreakthrough?sizes.transport.slice(1):sizes[mode]);
    const structures={elimination:['open','scatter','choke'],transport:['scatter','dual','choke','branch'],sealing:['branch','corridor','dual'],boss:['open','scatter']};
    const structure=pick(gr,structures[mode]);
    const introduced=MONSTERS.find(p=>p.unlockStage===stage);
    const possible=introduced?TRIAL_TERRAINS.filter(t=>t.enemies.includes(introduced.species)):TRIAL_TERRAINS;
    const theme=pick(br,possible),spawn={x:1,y:1+Math.floor(gr()*(height-2))};
    const objective=mode==='transport'?{type:mode,phase:pickup?'pickup':'delivery',carrying:!pickup,
      ...(pickup?{item:{x:Math.floor(width/2),y:1+Math.floor(or()*(height-2)),collected:false}}:{}),
      destination:{x:width-2,y:1+Math.floor(or()*(height-2))},completed:false}:
      mode==='sealing'?{type:mode,points:[{x:width-2,y:1},{x:width-2,y:height-2},...(stage>=17&&or()<.5?[{x:Math.floor(width/2),y:Math.floor(height/2)}]:[])].map(p=>({...p,activated:false})),completed:false}:
      mode==='boss'?{type:mode,bossUid:'monster-0',completed:false}:{type:mode,completed:false};
    const bossPos={x:width-4,y:Math.floor(height/2)-1};
    const bossCells=mode==='boss'?[bossPos,{x:bossPos.x+1,y:bossPos.y},{x:bossPos.x,y:bossPos.y+1},{x:bossPos.x+1,y:bossPos.y+1}]:[];
    const required=[spawn,...(objective.item?[objective.item]:[]),...(objective.destination?[objective.destination]:[]),...(objective.points||[]),...bossCells];
    const blocks=[],ground=Array(width*height).fill(theme.terrain);
    const all=[];for(let y=0;y<height;y++)for(let x=0;x<width;x++)all.push({x,y});
    function connected(extra=[]){
      const occupied=new Set([...blocks,...extra].map(key));
      if(required.some(p=>occupied.has(key(p))))return false;
      const seen=new Set([key(spawn)]),queue=[spawn];
      for(let i=0;i<queue.length;i++)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const p={x:queue[i].x+dx,y:queue[i].y+dy},k=key(p);
        if(p.x<0||p.y<0||p.x>=width||p.y>=height||occupied.has(k)||seen.has(k))continue;
        seen.add(k);queue.push(p);
      }
      return required.every(p=>seen.has(key(p)))&&seen.size===width*height-occupied.size;
    }
    const candidates=shuffle(rr,all.filter(p=>required.every(q=>dist(p,q)>1)));
    const midX=Math.floor(width/2),midY=Math.floor(height/2);
    function structurePriority(p){
      if(structure==='open')return Math.abs(p.x-midX)+Math.abs(p.y-midY);
      if(structure==='dual')return p.y===midY&&p.x>1&&p.x<width-2?100:0;
      if(structure==='choke')return p.x===midX&&p.y!==midY?100:0;
      if(structure==='branch')return (p.x===midX&&p.y!==midY||p.y===midY&&p.x>midX+1&&p.x<width-2)?100:0;
      if(structure==='corridor')return p.x>1&&p.x<width-2&&p.x%3===0&&p.y!==(Math.floor(p.x/3)%2?1:height-2)?100:0;
      return 0;
    }
    candidates.sort((a,b)=>structurePriority(b)-structurePriority(a));
    const bounds=mode==='sealing'?[.20,.30]:mode==='boss'?[.06,.14]:mode==='transport'?[.10,.18]:[.08,.16];
    const ratio=bounds[0]+rr()*(bounds[1]-bounds[0]);
    const desired=Math.min(Math.floor(width*height*bounds[1]),Math.max(Math.ceil(width*height*bounds[0]),Math.round(width*height*ratio)));
    for(const p of candidates){
      if(blocks.length>=desired)break;
      blocks.push({...p,kind:theme.terrain===13?'rock':rr()<.2?'water':theme.props});
      if(!connected())blocks.pop();
    }
    for(const b of blocks)if(b.kind==='water')ground[b.y*width+b.x]=4;
    const pool=theme.enemies.filter(id=>MONSTERS[id].unlockStage<=stage),enemyCells=[];
    const count=mode==='elimination'?Math.min(4,1+Math.floor((stage-1)/3)):mode==='transport'?(wantsBreakthrough?6+Math.floor(er()*4):3+Math.floor(er()*4)):mode==='sealing'?2+Math.floor(er()*4):1+Math.floor(er()*4);
    function routeBetween(start,end){
      const wall=new Set(blocks.map(key)),q=[start],parent=new Map([[key(start),null]]);
      for(let i=0;i<q.length&&!parent.has(key(end));i++)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const p={x:q[i].x+dx,y:q[i].y+dy},k=key(p);if(p.x<0||p.y<0||p.x>=width||p.y>=height||wall.has(k)||parent.has(k))continue;parent.set(k,q[i]);q.push(p);
      }
      const route=[];let p=end;while(p&&parent.has(key(p))){route.unshift(p);p=parent.get(key(p));}return route;
    }
    const mainRoute=mode==='transport'?routeBetween(pickup?objective.item:spawn,objective.destination):[];
    const spots=shuffle(er,all.filter(p=>dist(p,spawn)>=3&&required.every(q=>key(p)!==key(q))&&!blocks.some(b=>key(b)===key(p))));
    if(wantsBreakthrough)spots.sort((a,b)=>Math.min(...mainRoute.map(p=>dist(a,p)))-Math.min(...mainRoute.map(p=>dist(b,p))));
    const enemies=[];
    for(let i=0;i<count;i++){
      let p;
      if(mode==='boss'&&i===0)p=bossPos;
      else {
        const index=spots.findIndex(candidate=>!enemyCells.some(c=>key(c)===key(candidate))&&connected([...enemyCells,candidate].filter(c=>!bossCells.some(b=>key(b)===key(c)))));
        if(index<0)break;p=spots.splice(index,1)[0];
      }
      const species=i===0&&introduced?introduced.species:pick(er,pool);
      const boss=mode==='boss'&&i===0;
      enemyCells.push(...(boss?bossCells:[p]));
      const role=mode==='transport'?(wantsBreakthrough&&i<Math.ceil(count/2)?'guard':i%2?'patrol':'chase'):mode==='sealing'&&i%2?'guard':mode==='boss'&&!boss?'guard':'chase';
      enemies.push({...p,species,name:(boss?'鎮關・':'')+TRIAL_ENEMIES[species],role,home:{...p},...(boss?{boss:true,footprint:{width:2,height:2}}:{}),
        hpFactor:(species===8||species===18?3.8:2.8+er()*.6)*(1+Math.min(stage-1,30)*.035),
        attackFactor:(species===18?.7:.48+er()*.15)*(1+Math.min(stage-1,30)*.025),
        intentRange:[3,6,12,18].includes(species)?3:2,intentRadius:species===18?1:0,moveSteps:species===8||species===18?1:2,level:stage});
    }
    const pressure=mainRoute.length?mainRoute.filter(p=>enemies.some(e=>dist(e,p)<=2)).length/mainRoute.length:0;
    const breakthrough=wantsBreakthrough&&enemies.length>=6&&pressure>=.4&&enemies.some(e=>e.role==='guard'&&mainRoute.some(p=>dist(e,p)<=1));
    const variant=mode==='transport'?(pickup?'pickup':'carry')+(breakthrough?'-breakthrough':''):'';
    const layout={seed,stage,layoutVersion:3,attempt:0,map:'ruins',width,height,title:theme.name,biome:theme.name,structure,terrain:theme.terrain,ground,blocks,spawn,enemies,mode,variant,objective};
    let hash=2166136261;for(const c of JSON.stringify(layout)){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}
    layout.layoutHash=(hash>>>0).toString(16).padStart(8,'0');
    return layout;
  }
  const TUTORIAL_STAGE1=Object.freeze({spawn:Object.freeze({x:1,y:3}),
    move:Object.freeze({x:2,y:3}),enemy:Object.freeze({x:4,y:3})});
  function tutorialStageLayout(seed){
    const spawn={...TUTORIAL_STAGE1.spawn},enemy={...TUTORIAL_STAGE1.enemy};
    const layout={seed,stage:1,layoutVersion:4,attempt:0,map:'ruins',
      width:7,height:7,title:'初入問道 · 靈狼試煉',biome:'碧水庭苑',structure:'tutorial',
      terrain:2,ground:Array(49).fill(2),blocks:[{x:4,y:1,kind:'rock'},{x:4,y:5,kind:'rock'}],
      spawn,enemies:[{...enemy,species:0,name:'靈狼',role:'chase',home:{...enemy},
        hpFactor:3.2,attackFactor:.48,intentRange:2,intentRadius:0,moveSteps:2,level:1}],
      mode:'elimination',variant:'tutorial',objective:{type:'elimination',completed:false}};
    let hash=2166136261;
    for(const c of JSON.stringify({...layout,seed:'shared-first-stage-v1'})){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}
    layout.layoutHash=(hash>>>0).toString(16).padStart(8,'0');
    return layout;
  }
  function stageLayoutV4(seed,stage=1){
    stage=Math.max(1,Math.min(1000000,num(stage)));
    if(stage===1)return tutorialStageLayout(seed);
    const stream=name=>seeded(String(seed)+':stage:'+stage+':v4:'+name);
    const pick=(r,items)=>items[Math.floor(r()*items.length)];
    const shuffle=(r,items)=>{items=items.slice();for(let i=items.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items;};
    const schedule=['elimination','elimination','elimination','elimination','elimination','defense','elimination','sealing','elimination','boss','defense','sealing','elimination','defense','boss','elimination','sealing','elimination','defense','boss'];
    let mode;
    if(stage<=20)mode=schedule[stage-1];
    else {
      const slot=(stage-21)%5,group=Math.floor((stage-21)/5);
      mode=slot===4?'boss':shuffle(seeded(String(seed)+':v4:group:'+group),['elimination','elimination','defense','sealing'])[slot];
    }
    const gr=stream('geometry'),br=stream('biome'),or=stream('objectives'),rr=stream('obstacles'),er=stream('monsters');
    const sizes={elimination:[[7,7],[9,7]],defense:[[9,7],[11,9]],sealing:[[9,7],[11,9],[13,9]],boss:[[11,9],[13,9]]};
    const [width,height]=pick(gr,sizes[mode]);
    const structures={elimination:['open','scatter','choke','ring'],defense:['open','scatter','dual'],sealing:['branch','corridor','dual','ring'],boss:['open','scatter']};
    const structure=pick(gr,structures[mode]);
    const introduced=MONSTERS.find(p=>p.unlockStage===stage);
    const possible=introduced?TRIAL_TERRAINS.filter(t=>t.enemies.includes(introduced.species)):TRIAL_TERRAINS;
    const theme=pick(br,possible),spawn={x:1,y:1+Math.floor(gr()*(height-2))};
    const objective=mode==='defense'?{type:mode,shrine:{x:Math.floor(width/2),y:Math.floor(height/2)},rounds:4,completedRounds:0,hp:0,maxHp:0,spawnIndex:0,completed:false}:
      mode==='sealing'?{type:mode,points:[{x:Math.floor(width*.55),y:1},{x:width-3,y:height-2},...(stage>=17&&or()<.5?[{x:Math.floor(width/2),y:Math.floor(height/2)}]:[])].map((p,i)=>({...p,kind:SEAL_KINDS[(i+Math.floor((stage-8)/4))%SEAL_KINDS.length],hp:SEAL_MAX_DURABILITY,maxHp:SEAL_MAX_DURABILITY,activated:false})),completed:false}:
      mode==='boss'?{type:mode,bossUid:'monster-0',completed:false}:{type:mode,completed:false};
    const bossPos={x:width-4,y:Math.floor(height/2)-1};
    const bossCells=mode==='boss'?[bossPos,{x:bossPos.x+1,y:bossPos.y},{x:bossPos.x,y:bossPos.y+1},{x:bossPos.x+1,y:bossPos.y+1}]:[];
    const required=[spawn,...(objective.item?[objective.item]:[]),...(objective.destination?[objective.destination]:[]),...(objective.points||[]),...(objective.shrine?[objective.shrine]:[]),...bossCells];
    const blocks=[],ground=Array(width*height).fill(theme.terrain);
    const all=[];for(let y=0;y<height;y++)for(let x=0;x<width;x++)all.push({x,y});
    function connected(extra=[]){
      const occupied=new Set([...blocks,...extra].map(key));
      if(required.some(p=>occupied.has(key(p))))return false;
      const seen=new Set([key(spawn)]),queue=[spawn];
      for(let i=0;i<queue.length;i++)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const p={x:queue[i].x+dx,y:queue[i].y+dy},k=key(p);
        if(p.x<0||p.y<0||p.x>=width||p.y>=height||occupied.has(k)||seen.has(k))continue;
        seen.add(k);queue.push(p);
      }
      return required.every(p=>seen.has(key(p)))&&seen.size===width*height-occupied.size;
    }
    const candidates=shuffle(rr,all.filter(p=>required.every(q=>dist(p,q)>1)));
    const midX=Math.floor(width/2),midY=Math.floor(height/2);
    function structurePriority(p){
      if(structure==='open')return Math.abs(p.x-midX)+Math.abs(p.y-midY);
      if(structure==='ring')return Math.max(Math.abs(p.x-midX),Math.abs(p.y-midY))===2&&p.x!==midX&&p.y!==midY?100:0;
      if(structure==='dual')return p.y===midY&&p.x>1&&p.x<width-2?100:0;
      if(structure==='choke')return p.x===midX&&p.y!==midY?100:0;
      if(structure==='branch')return (p.x===midX&&p.y!==midY||p.y===midY&&p.x>midX+1&&p.x<width-2)?100:0;
      if(structure==='corridor')return p.x>1&&p.x<width-2&&p.x%3===0&&p.y!==(Math.floor(p.x/3)%2?1:height-2)?100:0;
      return 0;
    }
    candidates.sort((a,b)=>structurePriority(b)-structurePriority(a));
    const bounds=mode==='sealing'?[.20,.30]:mode==='boss'?[.06,.14]:mode==='defense'?[.10,.18]:[.08,.16];
    const ratio=bounds[0]+rr()*(bounds[1]-bounds[0]);
    const desired=Math.min(Math.floor(width*height*bounds[1]),Math.max(Math.ceil(width*height*bounds[0]),Math.round(width*height*ratio)));
    for(const p of candidates){
      if(blocks.length>=desired)break;
      blocks.push({...p,kind:theme.terrain===13?'rock':rr()<.2?'water':theme.props});
      const escape=mode!=='boss'||[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>bossCells.every(c=>{const q={x:c.x+dx,y:c.y+dy};return q.x>=0&&q.y>=0&&q.x<width&&q.y<height&&!blocks.some(b=>key(b)===key(q));}));
      if(!connected()||!escape)blocks.pop();
    }
    for(const b of blocks)if(b.kind==='water')ground[b.y*width+b.x]=4;
    const pool=theme.enemies.filter(id=>MONSTERS[id].unlockStage<=stage),enemyCells=[];
    const count=mode==='elimination'?Math.min(4,1+Math.floor((stage-1)/3)):mode==='defense'?3:mode==='sealing'?2+Math.floor(er()*4):1+Math.floor(er()*4);
    const spots=shuffle(er,all.filter(p=>dist(p,spawn)>=3&&required.every(q=>key(p)!==key(q))&&!blocks.some(b=>key(b)===key(p))));
    const enemies=[];
    for(let i=0;i<count;i++){
      let p;
      if(mode==='boss'&&i===0)p=bossPos;
      else {
        if(mode==='defense'){
          const entries=[{x:0,y:midY},{x:width-1,y:midY},{x:midX,y:0},{x:midX,y:height-1}];
          const entry=entries[(i+stage)%entries.length];
          spots.sort((a,b)=>dist(a,entry)-dist(b,entry));
        }
        const index=spots.findIndex(candidate=>!enemyCells.some(c=>key(c)===key(candidate))&&connected([...enemyCells,candidate].filter(c=>!bossCells.some(b=>key(b)===key(c)))));
        if(index<0)break;p=spots.splice(index,1)[0];
      }
      const bossSpecies=[8,5,10][(Math.floor(stage/5)-2)%3];
      const species=mode==='boss'&&i===0?bossSpecies:i===0&&introduced?introduced.species:pick(er,pool);
      const boss=mode==='boss'&&i===0;
      enemyCells.push(...(boss?bossCells:[p]));
      const role=mode==='defense'?'assault':mode==='sealing'&&i%2?'guard':mode==='boss'&&!boss?'guard':'chase';
      enemies.push({...p,species,name:boss?['巖甲巨獸','巨型妖藤','赤焰巨獸'][(Math.floor(stage/5)-2)%3]:TRIAL_ENEMIES[species],role,home:{...p},...(boss?{boss:true,bossKind:['rock','vine','flame'][(Math.floor(stage/5)-2)%3],footprint:{width:2,height:2}}:{}),
        hpFactor:(species===8||species===18?3.8:2.8+er()*.6)*(1+Math.min(stage-1,30)*.035),
        attackFactor:(species===18?.7:.48+er()*.15)*(1+Math.min(stage-1,30)*.025),
        intentRange:[3,6,12,18].includes(species)?3:2,intentRadius:species===18?1:0,moveSteps:species===8||species===18?1:2,level:stage});
    }
    const variant='';
    const maze=objective.points?.find(p=>p.kind==='maze');
    if(maze&&blocks.length){
      const gate=blocks.slice().sort((a,b)=>dist(a,{x:midX,y:midY})-dist(b,{x:midX,y:midY}))[0];
      maze.gate=point(gate);
    }
    const layout={seed,stage,layoutVersion:4,attempt:0,map:'ruins',width,height,title:theme.name,biome:theme.name,structure,terrain:theme.terrain,ground,blocks,spawn,enemies,mode,variant,objective};
    let hash=2166136261;for(const c of JSON.stringify(layout)){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}
    layout.layoutHash=(hash>>>0).toString(16).padStart(8,'0');
    return layout;
  }
  function stageLayout(seed,stage=1,layoutVersion=2){
    if(layoutVersion===3)return stageLayoutV3(seed,stage);
    if(layoutVersion===4)return stageLayoutV4(seed,stage);
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
  function footprint(a){const w=a.footprint?.width||1,h=a.footprint?.height||1,cells=[];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)cells.push({x:a.x+x,y:a.y+y});return cells;}
  function covers(a,p){return p.x>=a.x&&p.y>=a.y&&p.x<a.x+(a.footprint?.width||1)&&p.y<a.y+(a.footprint?.height||1);}
  function intersects(a,cells){return cells.some(p=>covers(a,p));}
  function at(s,p){return s.actors.find(a=>alive(a)&&covers(a,p));}
  function canOccupy(s,a,p){return footprint({...a,...p}).every(c=>!blocked(s,c)&&(!at(s,c)||at(s,c).uid===a.uid));}
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
    // One traversed cell always costs one stamina; slow caps the next move at 2 cells.
    const limit=(a.slow||0)>0?Math.min(a.stamina,2):a.stamina;
    const queue=[{x:a.x,y:a.y,cost:0}],seen=new Set([key(a)]),cells=[];
    for(let i=0;i<queue.length;i++){
      const p=queue[i],cost=p.cost+1;if(cost>limit)continue;
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
  const boardSpan=s=>Math.max(s.width,s.height);
  const lineRange=(s,sk)=>sk.unlimited?boardSpan(s):sk.range;
  function line(s,a,p,range){
    if(a.x!==p.x&&a.y!==p.y)return [];
    if(a.x===p.x&&a.y===p.y)return [];
    const dx=Math.sign(p.x-a.x),dy=Math.sign(p.y-a.y),cells=[];
    for(let n=1;n<=range;n++){const c={x:a.x+dx*n,y:a.y+dy*n};if(blocked(s,c))break;cells.push(c);}return cells;
  }
  function actor(raw,pos){
    const type=CORES[raw.core]?raw.core:'none',branch=CORES[type].branches.find(b=>b.id===raw.branch)||CORES[type].branches[0];
    const maxHp=Math.max(1,num(raw.maxHp)||1000);
    const catalog=manuals();
    const manualSkills=Array.isArray(raw.manualSkills)&&!raw.bot
      ?[...new Set(raw.manualSkills.filter(id=>Object.hasOwn(catalog?.BY_SKILL||{},id)))].slice(0,6):[];
    const manualSkillLevels=Object.fromEntries(manualSkills.map(id=>[id,catalog.skillLevel(raw.manualSkillLevels?.[id])])
      .filter(([,level])=>level>1));
    return {uid:String(raw.uid),name:String(raw.name||'修士').slice(0,40),team:raw.team||'player',bot:!!raw.bot,
      gender:raw.gender==='female'?'female':'male',species:num(raw.species),core:type,branch:branch.id,
      ...(num(raw.enemyScaleAttack)?{enemyScaleAttack:num(raw.enemyScaleAttack)}:{}),
      ...(raw.bot?{level:Math.max(1,num(raw.level)||1),...(raw.trackingAttack?{trackingAttack:true}:{}),...(raw.weaponDungeonLord?{weaponDungeonLord:true}:{})}:{}),
      ...(raw.bot&&Array.isArray(raw.dungeonSkills)?{dungeonSkills:clone(raw.dungeonSkills)}:{}),
      ...(raw.bot&&raw.role?{role:raw.role,home:raw.home}:{}),
      ...(raw.boss?{boss:true,footprint:{width:2,height:2},...(raw.bossKind?{bossKind:raw.bossKind}:{})}:{}),
      atk:Math.max(1,num(raw.atk)||200),baseAtk:num(raw.baseAtk),baseMaxHp:num(raw.baseMaxHp),trainingAccessScore:num(raw.trainingAccessScore),
      maxHp,hp:maxHp,stamina:2,shield:num(raw.shield),
      ...(Array.isArray(raw.manualSkills)&&!raw.bot?{manualSkills,manualSkillLevels,manualRefinements:Object.fromEntries(Object.entries(raw.manualRefinements||{}).filter(([id])=>catalog?.BY_BOOK?.[id]).map(([id,n])=>[id,catalog.refinement(n)]).filter(([,n])=>n))}:{}),
      ...(!raw.bot&&raw.manualWeaponMode?{manualWeaponMode:true,
        manualRulesVersion:2,manualWeaponIds:Array.from({length:2},(_,i)=>{
          const id=raw.manualWeaponIds?.[i];
          return typeof id==='string'&&catalog?.BY_BOOK?.[id]?id:null;
        })}:{}),
      ...(!raw.bot&&raw.manualLoadoutName?{manualLoadoutName:String(raw.manualLoadoutName).slice(0,40)}:{}),
      ...(!raw.bot&&Number.isInteger(raw.manualLoadoutIndex)?{manualLoadoutIndex:Math.max(0,Math.min(2,raw.manualLoadoutIndex))}:{}),
      intentRange:num(raw.intentRange)||2,intentRadius:num(raw.intentRadius??(raw.species===18?1:0)),moveSteps:num(raw.moveSteps)||2,
      turns:0,questions:0,answered:0,correct:0,attacks:0,actions:0,guard:0,counter:0,slow:0,cooldowns:{},...pos};
  }
  function trialMonsterHp(stage,species,scaledHp){
    const early=400+25*Math.min(8,stage-1);
    const base=early*(species===8||species===18?1.15:1);
    const scale=Math.max(0,Math.min(1,(stage-9)/21));
    return Math.round(base+Math.max(0,scaledHp-base)*scale);
  }
  function create({id,mode='pve',map='courtyard',players,trial=null,simultaneous=mode==='pvp',now=Date.now()}){
    const layout=mode==='pve'&&trial?.weaponDungeon?weaponDungeons().layout(trial.seed,trial.weaponDungeon.difficulty,trial.weaponDungeon.id||weaponDungeons().ID):
      mode==='pve'&&trial&&trial.layoutVersion!==0?stageLayout(trial.seed,trial.stage,trial.layoutVersion??2):null;
    const m=layout||mapFor(map),mid=Math.floor(m.height/2);
    const s={version:1,id,mode,map:m.id,width:m.width,height:m.height,terrain:m.terrain,
      blocks:[],actors:[],status:mode==='pvp'&&players.length<2?'waiting':'active',revision:0,
      turn:1,turnUid:players[0].uid,turnStartedAtMs:now,deadlineMs:mode==='pvp'?now+LIMITS.turnMs:0,
      createdAtMs:now,updatedAtMs:now,winner:null,finishReason:'',effects:[],events:[],receipts:[],rewarded:[],turnTimeouts:{}};
    if(layout){s.map=layout.map;s.trial={version:1,seed:layout.seed,stage:layout.stage,layoutVersion:layout.layoutVersion,title:layout.title,
      ...(layout.layoutVersion>=3?{mode:layout.mode,variant:layout.variant,biome:layout.biome,structure:layout.structure,attempt:layout.attempt,layoutHash:layout.layoutHash}:{} )};s.ground=layout.ground;s.blocks=layout.blocks;
      if(layout.layoutVersion>=3)s.objective=clone(layout.objective);}
    else if(mode==='pve'&&trial)s.trial={version:1,seed:trial.seed,stage:trial.stage,layoutVersion:0,title:m.name};
    else if(m.id!=='courtyard'){
      for(let y=1;y<m.height-1;y++)if(y!==mid)s.blocks.push({x:Math.floor(m.width/2),y});
      s.blocks.push({x:2,y:1},{x:m.width-3,y:m.height-2});
    }else s.blocks.push({x:3,y:1},{x:3,y:5});
    s.actors=players.map((p,i)=>actor({...p,team:mode==='pvp'?p.uid:'player'},layout?layout.spawn:{x:i?m.width-2:1,y:mid}));
    if(layout?.layoutVersion===4)s.pveMetrics={mode:layout.mode,answers:0,staminaSpent:0,manualCasts:{},loadout:[...(s.actors[0].manualSkills||[])]};
    if(layout?.weaponDungeon)s.weaponDungeon={...layout.weaponDungeon};
    const enemyScaleAttack=s.actors[0].enemyScaleAttack||s.actors[0].atk;
    if(s.trial?.layoutVersion===4&&s.objective?.type==='defense'){
      // Scale with the same trusted attack snapshot used for monster damage,
      // so defensive pressure does not disappear for high-health builds.
      s.objective.maxHp=Math.max(1,Math.round(enemyScaleAttack*2.5));
      s.objective.hp=s.objective.maxHp;
    }
    if(layout){
      for(const [i,m]of layout.enemies.entries())s.actors.push(actor({...m,uid:'monster-'+i,bot:true,team:'monster',
        atk:Math.round(enemyScaleAttack*m.attackFactor),maxHp:Math.max(1,Math.round(s.weaponDungeon?enemyScaleAttack*m.hpFactor:trialMonsterHp(m.level,m.species,enemyScaleAttack*m.hpFactor)*(m.boss?1.7:1)))},{x:m.x,y:m.y}));
    }else if(mode==='pve'){
      const count=m.id==='courtyard'?1:m.id==='bamboo'?2:3;
      for(let i=0;i<count;i++){
        const species=[0,8,18][i],level=trial?Math.max(1,num(trial.stage)):1,scaledHp=enemyScaleAttack*(3+i*1.3);
        s.actors.push(actor({uid:'monster-'+i,bot:true,team:'monster',
          name:['靈狼','巖甲獸','古陣守衛'][i],species,level,
          atk:Math.round(enemyScaleAttack*(.55+i*.1)),maxHp:trial?trialMonsterHp(level,species,scaledHp):Math.round(scaledHp)},
        {x:m.width-2,y:mid+(i===1?-2:i===2?2:0)}));
      }
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
  // Preview collectors belong only to private cloned states, never stored room data.
  const previewEvents=new WeakMap(),mirrorFrames=new WeakMap();
  function log(s,text,type='info',extra={}){
    // A bounded log still needs unique IDs when one turn produces many effects.
    s.eventSequence=(s.eventSequence||0)+1;
    const event={id:s.revision+':'+s.eventSequence,type,text,...extra};s.events.push(event);s.events=s.events.slice(-LIMITS.events);previewEvents.get(s)?.push(event);const frame=mirrorFrames.get(s);if(frame)frame.events.push({event,layer:frame.layer,avatar:frame.avatar});return event;
  }
  const point=a=>({x:a.x,y:a.y});
  const appearance=a=>({uid:a.uid,hp:a.hp,shield:a.shield,stamina:a.stamina,guard:a.guard,slow:a.slow,...(a.flyingSword?{flyingSword:a.flyingSword}:{})});
  function motion(s,a,route,style='walk',text=a.name+'調整位置',weaponGroup=null){
    if(route.length<2||key(route[0])===key(route.at(-1)))return;
    log(s,text,'displace',{actor:a.uid,path:route,animation:{kind:'move',style,...(weaponGroup?{weaponGroup}:{})}});
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
    if(s.status!=='active')return;
    if(s.mode==='pve'&&s.trial?.layoutVersion>=3&&s.objective){
      const hero=human[0],o=s.objective;
      if(!alive(hero)){s.status='finished';s.winner='monster';s.finishReason='hp';}
      else if(o.type==='defense'&&o.hp<=0){s.status='finished';s.winner='monster';s.finishReason='shrine';}
      else {
        // Weapon dungeons end the instant their unique lord falls, even if
        // guards remain alive or no quiz answer has been submitted. Other PvE
        // objective types retain their original completion/answer rules.
        if(s.weaponDungeon){
          const lord=s.actors.find(a=>a.bot&&a.weaponDungeonLord);
          o.completed=!!lord&&!alive(lord);
        }else if(o.type==='transport'){
          if(!o.carrying&&o.item&&key(hero)===key(o.item)){
            o.item.collected=true;o.carrying=true;o.phase='delivery';log(s,'已取得靈物，前往交付點','objective');
          }
          if(o.carrying&&o.destination&&key(hero)===key(o.destination))o.completed=true;
        }else if(o.type==='sealing'){
          if(s.trial.layoutVersion===3)for(const p of o.points||[])if(!p.activated&&key(hero)===key(p)){p.activated=true;log(s,'陣眼已啟動','objective');}
          o.completed=!!o.points?.length&&o.points.every(p=>p.activated);
        }else if(o.type==='defense')o.completed=o.completedRounds>=o.rounds;
        else if(o.type==='boss')o.completed=!!s.actors.find(a=>a.uid===o.bossUid&&!alive(a));
        else if(o.type==='elimination')o.completed=!s.actors.some(a=>a.bot&&alive(a));
        if(o.completed&&(s.weaponDungeon||hero.answered>0)){
          s.status='finished';s.winner=hero.team;s.finishReason='objective';
          if(s.weaponDungeon)log(s,'石域領主已被擊敗，武器副本通關','objective');
        }
        else if(o.completed&&!o.awaitingAnswer){o.awaitingAnswer=true;log(s,'目標已完成，請先完成一題作答','objective');}
      }
    }else if(teams.length<2){s.status='finished';s.winner=teams[0]||'draw';s.finishReason='hp';}
    if(s.status==='active'&&s.turn>LIMITS.turns){
      s.status='finished';s.finishReason='turn-limit';
      if(s.mode==='pve')s.winner='monster';else{
        const [a,b]=human,delta=a.hp/a.maxHp-b.hp/b.maxHp;s.winner=Math.abs(delta)<1e-9?'draw':delta>0?a.team:b.team;
      }
    }
    if(s.status==='finished'){
      if(s.weaponObjects)s.weaponObjects=weave().finish(s.weaponObjects);
      s.deadlineMs=0;
      if(s.pveMetrics&&!s.pveMetrics.outcome){
        s.pveMetrics.outcome=s.winner===human[0]?.team?'win':'loss';s.pveMetrics.reason=s.finishReason;
        s.pveMetrics.turns=human[0]?.turns||0;
      }
    }
  }
  function damage(s,source,target,raw,opts={}){
    if(!alive(source)||!alive(target))return 0;
    const manual=manuals()?.BY_BOOK?.[opts.manualId||manuals()?.BY_SKILL?.[opts.skill]?.manualId];
    if(s.weaponDungeon&&!source.bot&&target.bot&&manual?.weaponType==='totem')raw*=s.weaponDungeon.totemDamageMultiplier??1.15;
    const active=s.trial?.layoutVersion===4&&s.objective?.type==='sealing'?s.objective.points.filter(p=>!p.activated):[];
    if(source.bot&&active.some(p=>p.kind==='rage'&&dist(p,source)<=SEAL_TYPES.rage.range.radius))raw*=SEAL_TYPES.rage.damageMultiplier;
    if(target.bot&&active.some(p=>p.kind==='shield'&&dist(p,target)<=SEAL_TYPES.shield.range.radius)&&!opts.pierce)raw*=SEAL_TYPES.shield.damageMultiplier;
    let amount=Math.max(0,Math.round(raw));if(!opts.pierce)amount=Math.round(amount*(1-(target.guard||0)));
    const shieldScale=opts.shieldMultiplier||1,absorbed=opts.pierce?0:Math.min(target.shield,Math.round(amount*shieldScale));target.shield-=absorbed;amount=Math.max(0,amount-Math.ceil(absorbed/shieldScale));
    const dealt=Math.min(target.hp,amount);target.hp-=dealt;
    if(opts.weaponHit)opts.weaponHit.records.push({uid:target.uid,rayId:opts.weaponHit.rayId,damage:dealt,absorbed,
      cell:opts.reflected?point(target):opts.weaponHit.cell});
    log(s,source.name+' → '+target.name+' −'+dealt+(absorbed?'（護盾 '+absorbed+'）':''),'damage',{actor:source.uid,target:target.uid,damage:dealt,skill:opts.skill||'attack',x:target.x,y:target.y,
      animation:{kind:'damage',style:opts.skill||'attack',origin:point(source),target:point(target),changes:[appearance(target)],numbers:[{uid:target.uid,damage:dealt,absorbed}],
        ...(Number.isInteger(opts.strike)?{strike:opts.strike}:{}),...(opts.weaponHit?{weaponGroup:opts.weaponHit.group}:{})}});
    if(opts.leech&&dealt){const heal=Math.min(source.maxHp-source.hp,Math.round(dealt*opts.leech));source.hp+=heal;recovery(s,source,heal);}
    const Manuals=manuals();
    if(target.hp<=0&&target.bot&&source&&!source.bot&&opts.manualId&&Manuals?.BY_BOOK?.[opts.manualId]){
      const beastRealm=Manuals.realmForStage(target.level),exp=beastRealm.exp;
      s.manualExp||={};s.manualExp[source.uid]||={};
      s.manualExp[source.uid][opts.manualId]=(s.manualExp[source.uid][opts.manualId]||0)+exp;
      log(s,source.name+'以功法擊殺 '+beastRealm.name+'境 '+target.name+
        '，'+Manuals.BY_BOOK[opts.manualId].name+' 經驗 +'+exp+' EXP',
        'manual-mastery',{actor:source.uid,manualId:opts.manualId,skill:opts.skill,
          beastRealm:beastRealm.name,exp});
    }
    if(target.counter&&alive(target)&&!opts.reflected){
      const reflect=target.counter,manualId=target.counterManualId;
      target.counter=0;delete target.counterManualId;
      damage(s,target,source,target.atk*reflect,{reflected:true,skill:manualId?'manual-counter':'counter',manualId,strike:opts.strike,weaponHit:opts.weaponHit});
    }
    return dealt;
  }
  const sealAt=(s,p)=>s.trial?.layoutVersion===4&&s.objective?.type==='sealing'?(s.objective.points||[]).find(q=>!q.activated&&key(q)===key(p)):null;
  function strikeSeals(s,cells,seen=new Set()){
    if(s.trial?.layoutVersion!==4||s.objective?.type!=='sealing')return;
    for(const p of s.objective.points||[]){
      if(p.activated||seen.has(key(p))||!cells.some(c=>key(c)===key(p)))continue;
      seen.add(key(p));p.hp=Math.max(0,p.hp-SEAL_HIT_DAMAGE);
      if(!p.hp){
        p.activated=true;if(p.gate)s.blocks=s.blocks.filter(b=>key(b)!==key(p.gate));
        if(p.kind==='hazard'&&!s.objective.points.some(q=>!q.activated&&q.kind==='hazard'))s.objective.hazards=[];
      }
      const def=sealDefinition(p.kind),name=def?.name||'陣眼';
      const lingering=p.kind==='hazard'&&
        s.objective.points.some(q=>!q.activated&&q.kind==='hazard');
      const feedback=p.activated?
        name+'已破除'+(lingering?' · 仍有其他妖煞陣眼，危險預告尚未解除':
          def?.onBreak?' · '+def.onBreak:''):
        name+'受擊 · 耐久 '+p.hp+'/'+p.maxHp;
      log(s,feedback,'objective',
        {animation:{kind:'impact',style:'blast',cells:[point(p)],color:p.activated?'#9ef4dc':'#e9c677'}});
    }
  }
  function pushDirection(a,target){
    const dx=target.x-a.x,dy=target.y-a.y;
    if(dx&&Math.abs(dx)>=Math.abs(dy))return {x:Math.sign(dx),y:0};
    return dy?{x:0,y:Math.sign(dy)}:null;
  }
  function push(s,a,target,steps,direction=pushDirection(a,target),weaponGroup=null){
    if(!direction||target.boss&&!target.trackingAttack&&!soloDungeonBeast(s,target))return;
    const route=[point(target)],{x:dx,y:dy}=direction;
    for(let i=0;i<steps;i++){const p={x:target.x+dx,y:target.y+dy};if(!canOccupy(s,target,p))break;target.x=p.x;target.y=p.y;route.push(point(target));}
    motion(s,target,route,'push',target.name+'被擊退',weaponGroup);
    if(target.bot&&route.length>1)interruptMonster(target);
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
  const CARDINALS=[[1,0],[-1,0],[0,1],[0,-1]];
  const DIAGONALS=[[1,1],[1,-1],[-1,1],[-1,-1]];
  const diagonalIndex=(p,center)=>(p.x-center.x)*(p.y-center.y)>0?0:1;
  function crossedSwordLines(rays,center){
    return [0,1].map(axis=>{
      const sides=rays.filter(ray=>ray[0]&&diagonalIndex(ray[0],center)===axis);
      const left=sides.find(ray=>ray[0].x<center.x)||[];
      const right=sides.find(ray=>ray[0].x>center.x)||[];
      return [...left.slice().reverse(),center,...right];
    });
  }
  function swordArray(s,sk,center){
    const rays=[];
    for(const [directions,length] of [[CARDINALS,sk.orthogonal],[DIAGONALS,sk.diagonal]]){
      if(!length)continue;
      for(const [dx,dy] of directions){
        const cells=[];
        for(let step=1;step<=length;step++){
          const p={x:center.x+dx*step,y:center.y+dy*step};
          if(blocked(s,p)||dx&&dy&&(blocked(s,{x:p.x-dx,y:p.y})||blocked(s,{x:p.x,y:p.y-dy})))break;
          cells.push(p);
        }
        if(cells.length)rays.push(cells);
      }
    }
    return rays;
  }
  function dashRoute(s,a,sk,p){
    const route=[point(a)];
    const range=a.slow?Math.min(sk.range,2):sk.range;
    for(const cell of line(s,a,p,Math.min(range,dist(a,p)))){
      if(at(s,cell))break;
      route.push(cell);
    }
    return route;
  }
  function swordRoute(s,a,p){
    if(!a?.flyingSword||blocked(s,p))return null;
    return swordPaths().route({from:a.flyingSword,to:p,
      walkable:q=>!blocked(s,q),
      enemies:s.actors.filter(t=>alive(t)&&t.team!==a.team)
        .map(t=>({...t,position:point(t)}))});
  }
  function swordMoveCells(s,a){
    if(!a?.flyingSword||!alive(a)||a.actions>=LIMITS.actions)return [];
    const limit=a.stamina*2,paths=swordPaths();
    const distances=paths.distances(a.flyingSword,p=>!blocked(s,p),limit);
    const cells=[];
    for(const [where,length] of distances){
      if(length<2||length%2||at(s,(()=>{const [x,y]=where.split(',').map(Number);return {x,y};})()))continue;
      const [x,y]=where.split(',').map(Number);
      cells.push({x,y,cost:length/2});
    }
    return cells;
  }
  function techniquePath(s,a,sk,p){
    if(sk.kind==='dash-cleave')return dashRoute(s,a,sk,p);
    if(sk.kind==='flying-sword'){
      return a.flyingSword?swordRoute(s,a,p)||[]:[point(a),point(p)];
    }
    return [];
  }
  function validPathTarget(s,a,sk,p){
    if(sk.kind==='flying-sword'){
      if(!p||blocked(s,p)||at(s,p)||dist(a,p)<1||dist(a,p)>2)return false;
      return !a.flyingSword||Boolean(swordRoute(s,a,p)?.length>1);
    }
    const route=techniquePath(s,a,sk,p);
    return route.length>1&&key(route.at(-1))===key(p);
  }
  const fistDirectional=sk=>['fist-sweep','fist-throw','fist-chain'].includes(sk.kind);
  const offset=(a,d,forward,side=0)=>({x:a.x+d.x*forward-d.y*side,y:a.y+d.y*forward+d.x*side});
  function frontStrike(s,a,d,tShape){
    const row=tShape?2:1;
    const cells=[-1,0,1].map(side=>offset(a,d,row,side));
    if(tShape)cells.unshift(offset(a,d,1));
    return cells.filter(cell=>!blocked(s,cell)&&sight(s,a,cell));
  }
  function fistDirection(s,a,p,sk){
    if(!inside(s,p)||dist(a,p)!==1)return null;
    const d=attackDirection(a,p);
    return frontStrike(s,a,d,sk.tShape).length?d:null;
  }
  function throwLanding(s,target,d){
    const p=offset(target,d,-2);
    return !blocked(s,p)&&!at(s,p)?p:null;
  }
  function strikeTargets(s,a,cells){
    return [...new Map(cells.map(cell=>at(s,cell)).filter(target=>target&&target.team!==a.team).map(target=>[target.uid,target])).values()];
  }
  function chainFists(s,a,sk,d,animate=true,copy=null){
    const cells=new Map(),path=[point(a)];
    const sealsHit=new Set();
    for(let step=0;step<sk.steps&&alive(a);step++){
      const frame=mirrorFrames.get(s);if(frame)frame.layer=step+1;
      const row=frontStrike(s,a,d,false),targets=strikeTargets(s,a,row);
      if(!row.length)break;
      if(animate)strikeSeals(s,row,sealsHit);
      for(const cell of row)cells.set(key(cell),cell);
      if(animate&&step>0)log(s,a.name+'踏步連推 · 第 '+(step+1)+' 段','cast',{
        actor:a.uid,skill:sk.id,animation:{kind:'cast',style:sk.kind,origin:point(a),
          target:offset(a,d,1),cells:row,step:step+1,
          color:sk.color||(CORES[a.core]||CORES.none).color}});
      for(const target of targets){
        if(!alive(a))break;
        damage(s,a,target,a.atk*sk.power,{skill:sk.id,manualId:sk.manualId});
        if(alive(target)){
          const before=point(target);
          push(s,a,target,1,d);
          // A blocked shove is a wall-slam rather than a wasted chain hit.
          if(alive(target)&&target.x===before.x&&target.y===before.y&&sk.collisionPower>0)
            damage(s,a,target,a.atk*sk.collisionPower,{skill:sk.id,manualId:sk.manualId});
        }
      }
      if(copy)copy(point(a),{direction:d,power:sk.power,layer:step+1});
      const next=offset(a,d,1);
      if(!alive(a)||blocked(s,next)||at(s,next))break;
      const from=point(a);
      Object.assign(a,next);path.push(next);
      if(animate)motion(s,a,[from,next],'dash',a.name+'向前一步');
      if(!s.actors.some(target=>alive(target)&&target.team!==a.team))break;
    }
    return {cells:[...cells.values()],path,landings:[]};
  }
  function techniquePreview(s,a,sk,p){
    const d=fistDirectional(sk)?fistDirection(s,a,p,sk):null;
    if(sk.kind==='fist-chain'&&d){
      const simulated=clone(s),fighter=simulated.actors.find(actor=>actor.uid===a.uid);
      return chainFists(simulated,fighter,sk,d,false);
    }
    const cells=skillCells(s,a,sk,p);
    const landings=sk.kind==='fist-throw'&&d?strikeTargets(s,a,cells)
      .map(target=>throwLanding(s,target,d)).filter(Boolean):[];
    return {cells,path:techniquePath(s,a,sk,p),landings};
  }
  function aimCells(s,a,sk){
    if(!a||!alive(a))return [];
    if(gravity()?.supports(sk))return gravityGeometry(s,a,sk).aims;
    if(time()?.supports(sk))return timeGeometry(s,a,sk).aims;
    if(mirror()?.supports(sk))return mirrorGeometry(s,a,sk).aims;
    if(weave()?.supports(sk))return weave().plans(prism().boardForTrial(s),a,sk,s.weaponObjects,a.uid).aims;
    if(bell()?.supports(sk))return bell().plans(prism().boardForTrial(s),a,sk).aims;
    if(prism()?.supports(sk))return prism().plans(prism().boardForTrial(s),a,sk).aims;
    if(fistDirectional(sk))return CARDINALS.map(([x,y])=>offset(a,{x,y},1)).filter(p=>fistDirection(s,a,p,sk));
    if(sk.kind==='ring')return ring(s,a);
    if(sk.kind==='cleave'){const cells=new Map();for(const d of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}])for(const p of rectangle(s,a,sk,{x:a.x+d.x,y:a.y+d.y}))cells.set(key(p),p);return [...cells.values()];}
    if(sk.kind==='line')return CARDINALS.flatMap(([dx,dy])=>
      line(s,a,{x:a.x+dx,y:a.y+dy},lineRange(s,sk)));
    if(sk.kind==='flying-sword'){
      const cells=[];
      for(let y=a.y-2;y<=a.y+2;y++)for(let x=a.x-2;x<=a.x+2;x++){
        const p={x,y};if(dist(a,p)>=1&&dist(a,p)<=2&&validPathTarget(s,a,sk,p))cells.push(p);
      }
      return cells;
    }
    if(sk.kind==='dash-cleave')return CARDINALS.flatMap(([dx,dy])=>
      line(s,a,{x:a.x+dx,y:a.y+dy},sk.range)).filter(p=>validPathTarget(s,a,sk,p));
    const cells=[];
    for(let y=Math.max(0,a.y-sk.range);y<=Math.min(s.height-1,a.y+sk.range);y++)for(let x=Math.max(0,a.x-sk.range);x<=Math.min(s.width-1,a.x+sk.range);x++){
      const p={x,y};if(skillDistance(a,p,sk)>sk.range||skillDistance(a,p,sk)<(sk.minRange||0)||blocked(s,p)||!sight(s,a,p))continue;
      if(sk.kind==='blink'&&at(s,p))continue;
      if(['hit','lunge','swap'].includes(sk.kind)&&key(p)===key(a))continue;
      cells.push(p);
    }
    return cells;
  }
  function skillCells(s,a,sk,p,first=null){
    if(gravity()?.supports(sk))return gravitySelection(s,a,sk,p).plan?.cells||[];
    if(time()?.supports(sk))return timeSelection(s,a,sk,p).plan?.cells||[];
    if(mirror()?.supports(sk))return mirrorSelection(s,a,sk,p).plan?.cells||[];
    if(weave()?.supports(sk))return weave().selected(prism().boardForTrial(s),a,sk,s.weaponObjects,a.uid,p,first).plan?.cells||[];
    if(bell()?.supports(sk))return bell().selected(prism().boardForTrial(s),a,sk,p)?.cells||[];
    if(prism()?.supports(sk))return prism().selected(prism().boardForTrial(s),a,sk,p)?.cells||[];
    if(fistDirectional(sk)){
      const d=fistDirection(s,a,p,sk);
      return d?frontStrike(s,a,d,sk.tShape):[];
    }
    if(sk.kind==='cleave')return rectangle(s,a,sk,p);
    if(sk.kind==='ring')return ring(s,a);
    if(sk.kind==='line')return line(s,a,p,lineRange(s,sk));
    if(sk.kind==='sword-array')return [p,...swordArray(s,sk,p).flat()];
    if(sk.kind==='flying-sword')return a.flyingSword?techniquePath(s,a,sk,p).slice(1):[];
    if(sk.kind==='dash-cleave'){
      const direction=attackDirection(a,p);
      if(!direction||!validPathTarget(s,a,sk,p))return [];
      return frontStrike(s,p,direction,sk.tShape);
    }
    return ['area','meteor'].includes(sk.kind)||sk.kind==='blink'&&sk.burst?area(s,p,sk.radius||1):[p];
  }
  function validateSkill(s,a,sk,p,{geometryOnly=false,first=null}={}){
    if(!geometryOnly){
      if(a.stamina<techniqueCost(a,sk))fail('體力不足，先答題補充');
      validateAttackLimit(a);
    }
    if(gravity()?.supports(sk)){const selection=gravitySelection(s,a,sk,p);if(!selection.plan)fail(selection.reason);return;}
    if(time()?.supports(sk)){const selection=timeSelection(s,a,sk,p);if(!selection.plan)fail(selection.reason);return;}
    if(mirror()?.supports(sk)){
      const selection=mirrorSelection(s,a,sk,p);if(!selection.plan)fail(selection.reason);return;
    }
    if(weave()?.supports(sk)){
      const selection=weave().selected(prism().boardForTrial(s),a,sk,s.weaponObjects,a.uid,p,first);
      if(!selection.plan)fail(selection.reason);
      return;
    }
    if(bell()?.supports(sk)){
      if(!bell().selected(prism().boardForTrial(s),a,sk,p))fail('請選擇合法出拳方向或自身格');
      return;
    }
    if(prism()?.supports(sk)){
      if(!prism().selected(prism().boardForTrial(s),a,sk,p))fail('請選擇未受阻擋的八方向直線');
      return;
    }
    if(fistDirectional(sk)){
      if(!fistDirection(s,a,p,sk))fail('請選擇上下左右的出拳方向');
      return;
    }
    if(sk.kind==='flying-sword'){
      if(!validPathTarget(s,a,sk,p))fail('請選擇距離玩家兩格內、飛劍可到達的空地');
      return;
    }
    if(sk.kind==='dash-cleave'){
      if(!validPathTarget(s,a,sk,p))fail('請選擇直線上可突進的空地');
      return;
    }
    if(blocked(s,p)||(sk.kind==='cleave'?!rectangle(s,a,sk,p).some(c=>key(c)===key(p)):
      skillDistance(a,p,sk)>lineRange(s,sk)))fail('目標超出技能範圍');
    if(skillDistance(a,p,sk)<(sk.minRange||0))fail('距離太近，弓需要至少兩格距離');
    if(sk.range===0&&dist(a,p)!==0)fail('請選擇自己');
    if((sk.unlimited||sk.range>0)&&!sight(s,a,p))fail('石障擋住了視線');
    if(sk.kind==='line'&&!line(s,a,p,lineRange(s,sk)).length)fail('請選擇同一行或同一列');
    const t=at(s,p);
    if(['hit','lunge','swap'].includes(sk.kind)&&(!t||t.team===a.team)&&!sealAt(s,p))fail('請選擇敵人');
    if(sk.kind==='blink'&&t)fail('落點必須是空地');
    if(sk.kind==='lunge'&&t){
      const routes=neighbours(s,t).map(n=>path(s,a,n,a.uid)).filter(r=>r&&r.length-1<=sk.range);
      if(!routes.length)fail('無法突進至敵人身旁');
    }
  }
  // One private simulation per geometric aim; use the actual cast implementation
  // so repeated damage, shields, boss footprints and displacement stay authoritative.
  // The public server apply() never passes preview=true.
  function previewCast(s,a,sk,p,first=null){
    const aim=point(p),cost=techniqueCost(a,sk);
    validateSkill(s,a,sk,aim,{geometryOnly:true,first});
    const simulation=clone({...s,events:[]}),fighter=simulation.actors.find(t=>t.uid===a.uid);
    const events=[];
    previewEvents.set(simulation,events);
    try{cast(simulation,fighter,sk,aim,true,first);}finally{previewEvents.delete(simulation);}
    const cells=new Map(),hits=[],moves=[];
    const nonAttack=['restore','counter','fist-focus'].includes(sk.kind)||sk.kind==='blink'&&!sk.burst;
    for(const event of events){
      if(!nonAttack&&event.type==='cast'&&event.actor===a.uid){
        for(const cell of event.animation?.cells||[])cells.set(key(cell),point(cell));
      }
      if(event.type==='damage'&&event.actor===a.uid)
        hits.push({uid:event.target,damage:event.damage,absorbed:event.animation?.numbers?.[0]?.absorbed||0,
          cell:{x:event.x,y:event.y},...(Number.isInteger(event.animation?.strike)?{strike:event.animation.strike}:{})});
      if(event.animation?.kind==='move'){
        if(event.path?.length>1)moves.push({uid:event.actor,path:event.path.map(point)});
        for(const move of event.animation.moves||[])if(move.path?.length>1)
          moves.push({uid:move.uid,path:move.path.map(point)});
      }
    }
    // The hero's intended route is separate from the enemies' final positions.
    const path=techniquePath(s,a,sk,aim).map(point);
    if(sk.kind==='gravity-crash')for(const m of moves.filter(m=>m.uid===a.uid))path.push(...m.path);
    if(sk.kind==='mirror-swap')for(const m of moves.filter(m=>m.uid===a.uid))path.push(...m.path);
    if(sk.kind==='fist-chain'){
      for(const m of moves.filter(m=>m.uid===a.uid)){
        if(!path.length)path.push(m.path[0]);
        path.push(...m.path.slice(1));
      }
    }
    const finalPositions=simulation.actors.filter(t=>{
      const old=s.actors.find(v=>v.uid===t.uid);
      return old&&key(old)!==key(t);
    }).map(t=>({uid:t.uid,x:t.x,y:t.y}));
    let reason='';
    if(s.status!=='active'||s.turnUid!==a.uid||s.quizRound&&s.phase!=='action')reason='目前不是你的行動回合';
    else if((a.actions||0)>=LIMITS.actions)reason='本回合行動已達上限';
    else try{validateSkill(s,a,sk,aim,{first});}catch(e){reason=String(e.message||e);}
    const castAnimation=events.find(e=>e.type==='cast'&&e.actor===a.uid)?.animation;
    const mirrorSteps=castAnimation?.mirrorSteps;
    for(const step of mirrorSteps||[])for(const cell of step.cells)cells.set(key(cell),point(cell));
    const bellSteps=castAnimation?.bellSteps;
    const rayPlan=prism()?.supports(sk)?prism().selected(prism().boardForTrial(s),a,sk,aim):null;
    return {aim,cost,valid:!reason,reason,cells:[...cells.values()],path,hits,moves,finalPositions,
      ...(mirrorSteps?.length?{mirrorSteps,weaponTimeline:castAnimation.weaponTimeline}:{}),
      ...(gravity()?.supports(sk)?{weaponObjects:simulation.weaponObjects||null,gravityPlan:castAnimation?.gravityPlan,gravityBeat:castAnimation?.gravityBeat,weaponTimeline:castAnimation?.weaponTimeline}:{}),
      ...(time()?.supports(sk)?{weaponObjects:simulation.weaponObjects||null,timePlan:castAnimation?.timePlan,weaponTimeline:castAnimation?.weaponTimeline}:{}),
      ...(mirror()?.supports(sk)?{weaponObjects:simulation.weaponObjects||null,mirrorPlan:castAnimation?.mirrorPlan,weaponTimeline:castAnimation?.weaponTimeline}:{}),
      ...(weave()?.supports(sk)?{first:first?point(first):null,weaponObjects:simulation.weaponObjects,weavePlan:events.find(e=>e.type==='cast'&&e.actor===a.uid)?.animation?.weavePlan,weaponTimeline:events.find(e=>e.type==='cast'&&e.actor===a.uid)?.animation?.weaponTimeline}:{}),
      ...(bellSteps?{bellSteps,weaponTimeline:events.find(e=>e.type==='cast'&&e.actor===a.uid)?.animation?.weaponTimeline}:{}),
      ...(rayPlan?{rays:rayPlan.rays,weaponTimeline:events.find(e=>e.type==='cast'&&e.actor===a.uid)?.animation?.weaponTimeline}:{}),
      landings:finalPositions.filter(t=>t.uid!==a.uid).map(point)};
  }
  function skillPreviewPlan(s,a,sk){
    const result={aims:[],cells:[],byAim:{}};
    if(!alive(a)||!sk)return result;
    if(gravity()?.supports(sk)){
      const geometry=gravityGeometry(s,a,sk);result.aims=geometry.aims;result.cells=geometry.cells;result.reason=geometry.reason;
      for(const aim of geometry.aims)result.byAim[key(aim)]=previewCast(s,a,sk,aim);
      return result;
    }
    if(time()?.supports(sk)){
      const geometry=timeGeometry(s,a,sk);result.aims=geometry.aims;result.cells=geometry.cells;result.reason=geometry.reason;
      for(const aim of geometry.aims)result.byAim[key(aim)]=previewCast(s,a,sk,aim);
      return result;
    }
    if(mirror()?.supports(sk)){
      const geometry=mirrorGeometry(s,a,sk);result.aims=geometry.aims;result.cells=geometry.cells;result.reason=geometry.reason;
      for(const aim of geometry.aims)result.byAim[key(aim)]=previewCast(s,a,sk,aim);
      return result;
    }
    if(weave()?.supports(sk)){
      const geometry=weave().plans(prism().boardForTrial(s),a,sk,s.weaponObjects,a.uid);
      result.aims=geometry.aims;result.cells=geometry.cells;result.reason=geometry.reason;result.pairs=geometry.pairs;result.byPair={};
      for(const aim of Object.values(geometry.byAim))result.byAim[key(aim.aim)]=previewCast(s,a,sk,aim.aim);
      for(const pair of geometry.pairs)result.byPair[weave().pairKey(pair.first,pair.second)]=previewCast(s,a,sk,pair.second,pair.first);
      return result;
    }
    if(prism()?.supports(sk)){
      const geometry=prism().plans(prism().boardForTrial(s),a,sk);
      for(const rayPlan of Object.values(geometry.byDirection)){
        const scheme=previewCast(s,a,sk,rayPlan.aims[0]);
        for(const aim of rayPlan.aims){result.aims.push(point(aim));result.byAim[key(aim)]={...scheme,aim:point(aim)};}
      }
      result.cells=geometry.cells;return result;
    }
    const aims=aimCells(s,a,sk).slice();
    if(sk.kind==='ring'||sk.range===0)aims.push(point(a));
    const union=new Map(),seen=new Set();
    for(const aim of aims){
      const id=key(aim);if(seen.has(id))continue;seen.add(id);
      // aimCells intentionally preserves broad legacy selection hints; only
      // the same geometry validation as casting can admit a preview scheme.
      try{validateSkill(s,a,sk,aim,{geometryOnly:true});}catch(_){continue;}
      const scheme=previewCast(s,a,sk,aim);
      result.aims.push(point(aim));result.byAim[id]=scheme;
      for(const p of scheme.cells)union.set(key(p),p);
    }
    result.cells=[...union.values()];
    return result;
  }
  // Compatibility for old saves: old cooldown timestamps cannot prevent casting.
  function cooldownUntil(){return 0;}
  function cast(s,a,sk,p,preview=false,first=null){
    const needs=mirror()?.supports(sk)||(!bell()?.supports(sk)&&mirror()?.canCopy(sk)&&mirror().active(s.weaponObjects,a.uid));
    if(!needs)return castInternal(s,a,sk,p,preview,first);
    const frame={events:[],layer:1,avatar:false};mirrorFrames.set(s,frame);
    try{
      castInternal(s,a,sk,p,preview,first);
      const firstCast=frame.events.find(x=>x.event.type==='cast'&&x.event.actor===a.uid)?.event;
      if(!firstCast)return;
      const raw=firstCast.animation,hit=e=>({uid:e.target,damage:e.damage,absorbed:e.animation?.numbers?.[0]?.absorbed||0,cell:{x:e.x,y:e.y},part:e.animation?.strike||0});
      const motions=entries=>entries.filter(x=>x.event.animation?.kind==='move').flatMap(({event:e})=>{
        const style=e.animation.style==='teleport'?'swap':e.animation.style==='throw'?'arc':e.animation.style==='dash'&&sk.kind==='dash-cleave'?'dash':'slide';
        return (e.animation.moves||[{uid:e.actor,path:e.path}]).filter(m=>m.path?.length>1).map(m=>({...m,style}));
      });
      let beats=[];
      if(raw.mirrorPlan){
        beats=mirror().baseBeats(raw.mirrorPlan,sk,a.uid,frame.events.filter(x=>x.event.type==='damage').map(x=>hit(x.event)),motions(frame.events));
      }else if(raw.mirrorSteps?.length){
        beats=raw.mirrorSteps.map(step=>{
          const items=frame.events.filter(x=>x.layer===step.layer);
          const bodyCast=items.find(x=>x.event.type==='cast'&&x.event.actor===a.uid)?.event.animation||raw;
          const bodyHits=items.filter(x=>!x.avatar&&x.event.type==='damage').map(x=>hit(x.event));
          const shadowHits=items.filter(x=>x.avatar&&x.event.type==='damage').map(x=>hit(x.event));
          return {body:{source:bodyCast.origin,cells:bodyCast.cells||[],hits:bodyHits,moves:motions(items)},
            shadow:{...step,hits:shadowHits,moves:[]}};
        });
      }
      if(!beats.length)return;
      raw.weaponTimeline=mirror().timeline(sk,beats);raw.weaponGroup=firstCast.id;
      const affected=new Set([a.uid,...raw.weaponTimeline.segments.flatMap(q=>[...q.hits.map(h=>h.uid),...q.moves.map(m=>m.uid)])]);
      raw.changes=s.actors.filter(t=>affected.has(t.uid)).map(t=>({...appearance(t),x:t.x,y:t.y}));
      for(const {event} of frame.events)if(event!==firstCast&&['cast','damage','move','displace'].includes(event.type)&&event.animation)event.animation.weaponGroup=firstCast.id;
      if(!s.events.includes(firstCast)){s.events.unshift(firstCast);if(s.events.length>LIMITS.events)s.events.splice(1,1);}
    }finally{mirrorFrames.delete(s);}
  }
  function castInternal(s,a,sk,p,preview=false,first=null){
    validateSkill(s,a,sk,p,{geometryOnly:preview,first});const cost=techniqueCost(a,sk);a.stamina-=cost;a.attacks++;
    if(s.pveMetrics){s.pveMetrics.staminaSpent+=cost;if(sk.manualId)s.pveMetrics.manualCasts[sk.id]=(s.pveMetrics.manualCasts[sk.id]||0)+1;}
    const fixedTarget=sealAt(s,p);
    if(s.mode==='pve'&&s.trial?.layoutVersion>=3&&sk.manualId){s.manualUsed||={};s.manualUsed[a.uid]||={};s.manualUsed[a.uid][sk.manualId]=true;}
    const gravityPlan=gravity()?.supports(sk)?gravitySelection(s,a,sk,p).plan:null;
    const timePlan=time()?.supports(sk)?timeSelection(s,a,sk,p).plan:null;
    const mirrorPlan=mirror()?.supports(sk)?mirrorSelection(s,a,sk,p).plan:null;
    const weavePlan=weave()?.supports(sk)?weave().selected(prism().boardForTrial(s),a,sk,s.weaponObjects,a.uid,p,first).plan:null;
    const bellPlan=bell()?.supports(sk)?bell().selected(prism().boardForTrial(s),a,sk,p):null;
    const prismPlan=prism()?.supports(sk)?prism().selected(prism().boardForTrial(s),a,sk,p):null;
    const cells=gravityPlan?.cells||timePlan?.cells||mirrorPlan?.cells||weavePlan?.cells||prismPlan?.cells||skillCells(s,a,sk,p);
    const rays=sk.kind==='sword-array'?swordArray(s,sk,p):null;
    const cuts=rays&&!sk.orthogonal?crossedSwordLines(rays,p):null;
    const route=techniquePath(s,a,sk,p);
    if(sk.kind==='dash-cleave'){
      Object.assign(a,point(p));motion(s,a,route,'dash',a.name+'向前突進');
    }
    if(sk.kind==='flying-sword'){
      a.flyingSword=point(p);
      a.flyingSwordPower=sk.movePower;
      a.flyingSwordBalanceVersion=2;
      a.flyingSwordManualId=sk.manualId;
    }
    const origin=sk.kind==='flying-sword'?route[0]:point(a);
    const aim=sk.kind==='dash-cleave'?attackDirection(route[0],p):null;
    const targetPoint=aim?{x:p.x+aim.x,y:p.y+aim.y}:point(p);
    const castEvent=log(s,a.name+'施展「'+sk.name+'」','cast',{actor:a.uid,skill:sk.id,x:p.x,y:p.y,
      animation:{kind:'cast',style:sk.kind,origin,target:targetPoint,cells,
        ...(sk.kind==='fist-focus'?{focusActivated:true}:{}),
        ...(focusTurns(a)>0&&sk.school==='body'&&sk.kind!=='fist-focus'?{focusEmpowered:true}:{}),
        ...(sk.kind==='flying-sword'?{path:route}:{}),
        // A stored Firestore array cannot directly contain another array.
        ...(rays?{rays:rays.map(cells=>({cells}))}:{}),...(cuts?{cuts:cuts.map(cells=>({cells}))}:{}),...(sk.hits?{hits:sk.hits}:{}),...(sk.kind==='fist-chain'?{step:1}:{}),
        color:sk.color||(CORES[a.core]||CORES.none).color,changes:[appearance(a)]}});
    const mirrorSteps=[];
    const copy=mirror()?.canCopy(sk)&&mirror().active(s.weaponObjects,a.uid)?(from,beat,group=null,records=null)=>{
      const frame=mirrorFrames.get(s);if(frame)frame.avatar=true;
      const result=mirror().copyBeat(prism().boardForTrial(s),from,sk,beat,{
        targets:()=>s.actors.filter(t=>t.team!==a.team),alive,covers,canContinue:()=>alive(a),
        apply:(target,power,cell,layer)=>{
          const shield=target.shield;
          const dealt=damage(s,a,target,a.atk*power,{skill:sk.id,manualId:sk.manualId,strike:layer,
            ...(group?{weaponHit:{group,rayId:layer+100,cell,records}}:{})});
          return {damage:dealt,absorbed:shield-target.shield};
        },
        push:(target,d,count)=>push(s,a,target,count,d,group),
        throwTo:(target,d)=>{
          if(target.boss&&!target.trackingAttack&&!soloDungeonBeast(s,target))return true;
          const landing=offset(target,d,-2);
          if(!canOccupy(s,target,landing))return false;
          const from=point(target);Object.assign(target,landing);
          motion(s,target,[from,landing],'throw',target.name+'被蜃影翻摔',group);
          if(target.bot)interruptMonster(target);
          return true;
        },outward:bell().outward
      });
      if(frame)frame.avatar=false;mirrorSteps.push(result);castEvent.animation.mirrorSteps=mirrorSteps;
      return result;
    }:null;
    if(!['fist-chain','meteor','restore','counter','fist-focus'].includes(sk.kind)&&(sk.kind!=='blink'||sk.burst))strikeSeals(s,cells);
    // Fixed objectives can be hit by targeted techniques, but cannot be moved.
    if(fixedTarget&&!at(s,p)&&['hit','lunge','swap'].includes(sk.kind))return;
    if(gravityPlan){
      castEvent.animation.gravityPlan=gravityPlan;
      if(sk.kind==='gravity-core'){
        s.weaponObjects=gravity().place(s.weaponObjects,gravityPlan,{uid:a.uid,board:prism().boardForTrial(s),clock:2*s.turn,level:sk.level,refinement:a.manualRefinements?.[sk.manualId]||0});
        castEvent.animation.gravityBeat=gravityTrigger(s,a,2*s.turn,castEvent);
      }else{
        const records=[];
        if(gravityPlan.landing){
          const from=point(a);Object.assign(a,gravityPlan.landing);
          motion(s,a,[from,point(a)],'leap',a.name+'躍向星核',castEvent.id);
          s.weaponObjects=gravity().clear(s.weaponObjects,a.uid,'core');
        }
        gravity().attack(gravityPlan,sk,s.actors.filter(t=>t.team!==a.team),alive,
          (target,power,cell)=>damage(s,a,target,a.atk*power,{skill:sk.id,manualId:sk.manualId,weaponHit:{group:castEvent.id,rayId:0,cell,records}}),()=>alive(a));
        castEvent.animation.weaponTimeline=gravity().timeline(gravityPlan,sk,records,{uid:a.uid});
        castEvent.animation.weaponGroup=castEvent.id;
        castEvent.animation.changes=s.actors.filter(t=>t.uid===a.uid||records.some(h=>h.uid===t.uid)).map(t=>({...appearance(t),x:t.x,y:t.y}));
        if(!s.events.includes(castEvent)){s.events.unshift(castEvent);if(s.events.length>LIMITS.events)s.events.splice(1,1);}
        if(copy&&sk.kind==='gravity-strike')copy(origin,{direction:gravityPlan.direction,power:sk.power,layer:1});
      }
      return;
    }
    if(timePlan){
      castEvent.animation.timePlan=timePlan;
      s.weaponObjects=time().update(s.weaponObjects,timePlan,sk,{uid:a.uid,board:prism().boardForTrial(s),clock:s.eventSequence||0,level:sk.level,refinement:a.manualRefinements?.[sk.manualId]||0});
      const records=[];
      time().resolve(timePlan,s.actors.filter(t=>t.team!==a.team),covers,alive,(target,power,cell,index)=>damage(s,a,target,a.atk*power,{skill:sk.id,manualId:sk.manualId,strike:index,weaponHit:{group:castEvent.id,rayId:index,cell,records}}),()=>alive(a));
      castEvent.animation.weaponTimeline=time().timeline(timePlan,sk,records);
      castEvent.animation.weaponGroup=castEvent.id;
      castEvent.animation.changes=s.actors.filter(t=>t.uid===a.uid||records.some(h=>h.uid===t.uid)).map(appearance);
      if(!s.events.includes(castEvent)){s.events.unshift(castEvent);if(s.events.length>LIMITS.events)s.events.splice(1,1);}
      return;
    }
    if(mirrorPlan){
      castEvent.animation.mirrorPlan=mirrorPlan;
      if(mirrorPlan.summon)s.weaponObjects=mirror().activate(s.weaponObjects,mirrorPlan,{uid:a.uid,board:prism().boardForTrial(s),clock:s.eventSequence||0,level:sk.level,refinement:a.manualRefinements?.[sk.manualId]||0});
      if(mirrorPlan.landing){
        const from=point(a);Object.assign(a,mirrorPlan.landing);
        motion(s,a,[from,point(a)],'teleport',a.name+'與蜃影交換位置');
      }
      const hits=mirror().resolve(mirrorPlan,s.actors.filter(t=>t.team!==a.team),covers,alive,
        (target,power,cell,index,part)=>({damage:damage(s,a,target,a.atk*power,{skill:sk.id,manualId:sk.manualId,strike:index})}),()=>alive(a));
      castEvent.animation.mirrorHits=hits;
      return;
    }
    if(weavePlan){
      castEvent.animation.weavePlan=weavePlan;
      s.weaponObjects=weave().place(s.weaponObjects,weavePlan,{uid:a.uid,board:prism().boardForTrial(s),clock:s.eventSequence||0,level:sk.level,refinement:a.manualRefinements?.[sk.manualId]||0});
      const records=[];
      weave().resolve(weavePlan,s.actors.filter(t=>t.team!==a.team),covers,alive,
        (target,power,cell)=>damage(s,a,target,a.atk*power,{skill:sk.id,manualId:sk.manualId,
          weaponHit:{group:castEvent.id,rayId:0,cell,records}}),()=>alive(a));
      castEvent.animation.weaponTimeline=weave().timeline(weavePlan,sk,records);
      castEvent.animation.weaponGroup=castEvent.id;
      castEvent.animation.changes=s.actors.filter(t=>t.uid===a.uid||records.some(h=>h.uid===t.uid)).map(appearance);
      if(!s.events.includes(castEvent)){s.events.unshift(castEvent);if(s.events.length>LIMITS.events)s.events.splice(1,1);}
      return;
    }
    if(bellPlan){
      const records=[];
      const steps=bell().resolve(bellPlan,{
        targets:()=>s.actors.filter(t=>t.team!==a.team),alive,covers,
        canContinue:()=>alive(a),
        apply:(target,power,layer,cell)=>{
          const shield=target.shield||0;
          const dealt=damage(s,a,target,a.atk*power,{skill:sk.id,manualId:sk.manualId,strike:layer,
            weaponHit:{group:castEvent.id,rayId:layer,cell,records}});
          return {damage:dealt,absorbed:shield-(target.shield||0)};
        },
        push:(target,d)=>push(s,a,target,1,d,castEvent.id),
        afterStep:step=>{if(copy)copy(origin,{direction:attackDirection(origin,p),layer:step.layer,power:sk.power},castEvent.id,records);}
      });
      castEvent.animation.bellSteps=steps;
      castEvent.animation.weaponTimeline=bell().timeline(bellPlan,sk,steps,records,mirrorSteps);
      castEvent.animation.weaponGroup=castEvent.id;
      castEvent.animation.changes=s.actors.filter(t=>t.uid===a.uid||records.some(h=>h.uid===t.uid))
        .map(t=>({...appearance(t),x:t.x,y:t.y}));
      if(!s.events.includes(castEvent)){s.events.unshift(castEvent);if(s.events.length>LIMITS.events)s.events.splice(1,1);}
      return;
    }
    if(prismPlan){
      const targets=s.actors.filter(t=>alive(t)&&t.team!==a.team);
      const records=[];
      prism().resolve(prismPlan,sk,targets,h=>{
        const target=s.actors.find(t=>t.uid===h.uid);
        if(!alive(a)||!alive(target))return null;
        return {damage:damage(s,a,target,a.atk*h.power,{skill:sk.id,manualId:sk.manualId,strike:h.rayId,
          weaponHit:{group:castEvent.id,rayId:h.rayId,cell:h.cell,records}})};
      },covers);
      castEvent.animation.weaponTimeline=prism().timeline(prismPlan,sk,records);
      castEvent.animation.weaponGroup=castEvent.id;
      castEvent.animation.changes=s.actors.filter(t=>t.uid===a.uid||records.some(h=>h.uid===t.uid)).map(appearance);
      // The log is bounded; retain the summary when a large crowd evicts it.
      if(!s.events.includes(castEvent)){s.events.unshift(castEvent);if(s.events.length>LIMITS.events)s.events.splice(1,1);}
      return;
    }
    if(sk.kind==='fist-focus'){
      a.fistFocusUntil=a.turns+2;
      return;
    }
    if(sk.kind==='fist-chain'){
      chainFists(s,a,sk,attackDirection(a,p),true,copy);
      return;
    }
    if(sk.kind==='fist-throw'){
      const moves=[],thrown=[],d=attackDirection(a,p);
      for(const target of strikeTargets(s,a,cells)){
        if(target.boss){thrown.push(target);continue;}
        const landing=throwLanding(s,target,d);
        if(!landing)continue;
        moves.push({uid:target.uid,path:[point(target),landing]});
        thrown.push(target);
        Object.assign(target,landing);
        if(target.bot)interruptMonster(target);
      }
      if(moves.length)log(s,a.name+'將敵人翻摔至身後','displace',{
        actor:a.uid,animation:{kind:'move',style:'throw',moves}});
      for(const target of thrown)damage(s,a,target,a.atk*sk.power,{skill:sk.id,manualId:sk.manualId});
      if(copy)copy(point(a),{direction:d,power:sk.power,layer:1});
      return;
    }
    if(sk.kind==='restore'){
      const hp=a.hp,shield=a.shield;
      a.hp=Math.min(a.maxHp,a.hp+Math.round(a.maxHp*sk.power));
      a.shield=Math.min(a.maxHp,Math.max(a.shield,Math.round(a.maxHp*(sk.shield||0))));
      if(sk.cleanse)a.slow=0;recovery(s,a,a.hp-hp,a.shield-shield);return;
    }
    if(sk.kind==='counter'){a.guard=.4;a.counter=sk.power;a.counterManualId=sk.manualId||null;castEvent.animation.changes=[appearance(a)];return;}
    if(sk.kind==='blink'){
      const origin=point(a),shield=a.shield;
      a.x=p.x;a.y=p.y;if(sk.shield)a.shield=Math.max(a.shield,Math.round(a.maxHp*sk.shield));
      motion(s,a,[origin,point(a)],'teleport');recovery(s,a,0,a.shield-shield);
      if(sk.burst)for(const t of s.actors.filter(t=>alive(t)&&t.team!==a.team&&dist(a,t)<=1))damage(s,a,t,a.atk*sk.burst,{skill:sk.id,manualId:sk.manualId});return;
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
    const targets=sk.kind==='swap'?[target]:s.actors.filter(t=>alive(t)&&t.team!==a.team&&intersects(t,cells));
    if(sk.hits===2||cuts){
      // Finish the whole first sweep before beginning the second one.
      const activeCuts=cuts?.flatMap((cut,index)=>cut.length>1?[index]:[]);
      for(let strike=0;strike<2&&alive(a);strike++){
        const frame=mirrorFrames.get(s);if(frame)frame.layer=strike+1;
        for(const t of targets){
          if(!alive(a))break;
          if(!alive(t))continue;
          let power=sk.power/2;
          if(cuts){
            const centerHit=covers(t,p);
            const covered=centerHit?(activeCuts.length?activeCuts.includes(strike):strike===0):intersects(t,cuts[strike]);
            if(!covered)continue;
            power=centerHit?sk.centerPower/2:sk.power;
          }
          damage(s,a,t,a.atk*power,{...sk,skill:sk.id,strike});
        }
        if(copy)copy(point(a),{direction:aim||attackDirection(a,p),power:sk.power/2,layer:strike+1});
      }
      return;
    }
    if(sk.pushToEdge||sk.tShape&&sk.push)targets.sort((first,second)=>dist(a,second)-dist(a,first));
    const pushForward=sk.tShape&&sk.push?attackDirection(a,p):undefined;
    const hit=[];
    for(const t of targets){
      if(!alive(a))break;
      let power=sk.power;if(sk.execute&&t.hp/t.maxHp<=.4)power=2.2;if(sk.missing)power+=1.15*(1-a.hp/a.maxHp);
      let hits=sk.hits||1;
      if(rays&&covers(t,p)){
        hits=Math.max(1,rays.length);
        power=sk.centerPower*hits/8;
      }
      for(let i=0;i<hits&&alive(a)&&alive(t);i++)
        damage(s,a,t,a.atk*power/hits,{...sk,skill:sk.id,manualId:sk.manualId});
      hit.push(t);
      if(sk.slow&&alive(t)){t.slow=1;t.slowUntil=t.turns+1;}if(sk.push&&alive(t))push(s,a,t,sk.push,pushForward);
    }
    if(sk.pushToEdge)for(const t of hit)if(alive(t))push(s,a,t,boardSpan(s));
    if(copy)copy(point(a),{direction:aim||attackDirection(a,p),power:sk.power,layer:1});
  }
  function interruptMonster(m){m.intent={version:2,kind:'stagger',cells:[],text:'位移打斷：下回合重新蓄勢'};}
  function monsterCells(s,m,target,profile=monsterProfileFor(m)){
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
    // Weapon-dungeon beasts pursue even after an attack. The existing footprint
    // route handles both one-cell guards and large lords, with a one-step budget.
    const dungeonBeast=soloDungeonBeast(s,m);
    if(dungeonBeast&&m.slow)return [point(m)];
    if(m.boss||dungeonBeast){
      const origin=point(m),queue=[origin],parents=new Map([[key(origin),null]]);
      for(let i=0;i<queue.length;i++)for(const [dx,dy] of CARDINALS){
        const p={x:queue[i].x+dx,y:queue[i].y+dy};
        if(!parents.has(key(p))&&canOccupy(s,m,p)){parents.set(key(p),queue[i]);queue.push(p);}
      }
      const distance=p=>Math.min(...footprint({...m,...p}).map(c=>dist(c,hero)));
      queue.sort((a,b)=>distance(a)-distance(b)||dist(origin,a)-dist(origin,b));
      let p=queue[0],route=[];while(p){route.unshift(p);p=parents.get(key(p));}
      return route.slice(0,2);
    }
    if((m.role==='guard'||m.role==='patrol')&&m.home&&dist(m.home,hero)>(m.role==='guard'?4:5))hero=m.home;
    const profile=monsterProfileFor(m),move=profile.move,budget=Math.floor(move.steps/(1+(m.slow||0))),origin={x:m.x,y:m.y};
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
  // v4 boss patterns are computed once when the warning is shown. The saved
  // cells, not the player's later position, determine the next enemy attack.
  function bossPatternV4(s,m,hero){
    const phase=m.hp/m.maxHp<.5?2:1,alternate=s.turn%2===0;
    const center={x:m.x+.5,y:m.y+.5};
    const dx=Math.abs(hero.x-center.x)>=Math.abs(hero.y-center.y)?(hero.x<center.x?-1:1):0;
    const dy=dx?0:(hero.y<center.y?-1:1),side={x:-dy,y:dx};
    const cells=[];let name='',slow=false;
    const add=p=>{if(!covers(m,p)&&!blocked(s,p))cells.push(p);};
    if(m.bossKind==='vine'){
      name=alternate?'藤蔓封鎖':'纏根突襲';slow=true;
      if(dist(m,hero)>6)return {phase,cells:[],name,slow};
      const radius=alternate&&phase===2?2:1;
      for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++)
        if(Math.abs(x)+Math.abs(y)<=radius)add({x:hero.x+x,y:hero.y+y});
    }else if(m.bossKind==='flame'){
      name='烈焰吐息';const range=phase===2?4:3;
      const edge=dx?{x:dx>0?m.x+1:m.x,y:m.y}:{x:m.x,y:dy>0?m.y+1:m.y};
      for(let depth=1;depth<=range;depth++)for(let offset=-depth+1;offset<=depth;offset++)
        add({x:edge.x+dx*depth+side.x*offset,y:edge.y+dy*depth+side.y*offset});
    }else if(alternate){
      name='直線衝擊';const edge=dx?{x:dx>0?m.x+1:m.x,y:m.y}:{x:m.x,y:dy>0?m.y+1:m.y};
      for(let lane=0;lane<2;lane++)for(let depth=1;depth<=(phase===2?5:4);depth++){
        const p={x:edge.x+dx*depth+(dy?lane:0),y:edge.y+dy*depth+(dx?lane:0)};
        if(blocked(s,p))break;add(p);
      }
    }else{
      name='震地';const radius=phase===2?2:1;
      for(let y=m.y-radius;y<m.y+2+radius;y++)for(let x=m.x-radius;x<m.x+2+radius;x++)add({x,y});
    }
    return {phase,cells:[...new Map(cells.map(p=>[key(p),p])).values()],name,slow};
  }
  function prepareIntents(s,preserveDungeonIntents=false){
    if(s.mode!=='pve')return;const hero=s.actors[0];
    if(s.trial?.layoutVersion===4&&s.objective?.type==='sealing'){
      const active=s.objective.points.some(p=>!p.activated&&p.kind==='hazard');
      s.objective.hazards=active&&s.turn%SEAL_TYPES.hazard.triggerEveryTurns===0?[point(hero)]:[];
    }
    for(const m of s.actors.filter(a=>a.bot&&alive(a))){
      if(soloDungeonBeast(s,m)){
        // The preceding action (or start-of-window interruption) owns this warning.
        if(!preserveDungeonIntents||!m.intent)m.intent=dungeonIntent(s,m,hero);
        continue;
      }
      if(m.trackingAttack){m.intent=trackingIntent(s,m,hero);continue;}
      if(s.trial?.layoutVersion===4&&s.objective?.type==='defense'){
        const shrine=s.objective.shrine;
        const target=dist(m,hero)<=1?hero:dist(m,shrine)<=1?shrine:null;
        m.intent={version:2,kind:target?'defense-attack':'advance',cells:target?[point(target)]:[],origin:point(m),
          target:target?point(target):point(shrine),text:target?'下次：攻擊'+(target===hero?'修士':'靈陣'):'下次：逼近靈陣'};
        continue;
      }
      if(m.boss){
        if(s.trial?.layoutVersion===4&&m.bossKind){
          const pattern=bossPatternV4(s,m,hero),ready=pattern.cells.some(p=>key(p)===key(hero));
          if(m.phase===1&&pattern.phase===2)log(s,m.name+'進入第二階段','objective',
            {actor:m.uid,animation:{kind:'cast',style:'blast',origin:point(m),target:point(m),cells:footprint(m),color:'#f0a36a'}});
          m.phase=pattern.phase;
          m.intent={version:2,kind:ready?'boss-attack':'advance',cells:ready?pattern.cells:[],origin:point(m),target:point(hero),
            charge:pattern.name==='直線衝擊',slow:pattern.slow,power:1,text:ready?'下次：'+pattern.name+(pattern.phase===2?'（第二階段）':''):'下次：大型靈獸逼近'};
          continue;
        }
        const phase=m.hp/m.maxHp<.5?2:1,radius=phase===2&&s.turn%2===0?2:1;
        m.phase=phase;
        const cells=[];for(let y=m.y-radius;y<m.y+2+radius;y++)for(let x=m.x-radius;x<m.x+2+radius;x++){
          const p={x,y};if(!covers(m,p)&&!blocked(s,p))cells.push(p);
        }
        const ready=cells.some(p=>key(p)===key(hero));
        m.intent={version:2,kind:ready?'boss-attack':'advance',cells:ready?cells:[],origin:point(m),target:point(hero),
          power:1,text:ready?(radius===2?'下次：靈獸震地（第二階段）':'下次：靈獸爪擊'):'下次：大型靈獸逼近'};
        continue;
      }
      const profile=monsterProfileFor(m),cells=monsterCells(s,m,hero,profile),ready=dist(m,hero)>=(profile.move.minDistance||0)&&cells.some(p=>key(p)===key(hero));
      const name=profile.attack.shape==='guardian'?(s.turn%2===0?'天樞十字':'落石鎮壓'):profile.attackName;
      m.intent={version:2,kind:ready?'attack':profile.move.steps?'advance':'wait',cells:ready?cells:[],
        origin:{x:m.x,y:m.y},target:{x:hero.x,y:hero.y},shape:profile.attack.shape,
        power:profile.attack.power||1,slow:!!profile.attack.slow,push:profile.attack.push||0,
        text:ready?'下次：'+name:'下次：'+profile.moveName+(profile.move.steps?' '+profile.move.steps+' 格':'')};
    }
  }
  // The solo weapon-dungeon turn is one atomic attack (if previously warned),
  // followed by at most one ordinary move and preparation for the next window.
  // Never turn a newly prepared attack into damage in this same action.
  function weaponDungeonMonsterTurn(s,m,hero){
    if(s.status!=='active'||!alive(m)||!alive(hero))return;
    const intent=m.intent;
    if(intent?.kind==='attack'&&(!intent.origin||key(intent.origin)===key(m))){
      // Resolve only the published snapshot, including legacy v2 warnings.
      const cells=intent.cells||[],name=intent.skillName||monsterProfileFor(m).attackName;
      log(s,m.name+'施展「'+name+'」','monster-attack',{actor:m.uid,animation:{kind:'cast',style:intent.animation||intent.shape||'blast',origin:point(m),target:intent.target||point(hero),cells,color:'#d9a080'}});
      let hit=false;
      const waves=intent.waves?.length?intent.waves:[{cells,layer:1}];
      for(const wave of waves){
        if(!alive(m)||!alive(hero)||s.status!=='active')break;
        if(!wave.cells.some(p=>key(p)===key(hero)))continue;
        hit=true;
        damage(s,m,hero,m.atk*(intent.power??1),{skill:(!intent.skillId||intent.skillId==='stone-fall'||intent.skillId==='stone-lord')?'monster-'+m.species:intent.skillId});
        checkFinished(s);
        if(s.status!=='active'||!alive(m)||!alive(hero))break;
        if(intent.slow){hero.slow=1;hero.slowUntil=hero.turns+1;}
        if(intent.push)push(s,m,hero,intent.push);
      }
      if(!hit)log(s,hero.name+'避開了'+m.name+'的攻擊','dodge',{actor:hero.uid,animation:{kind:'dodge'}});
      // A saved skill route is bounded and rechecks full occupancy per step.
      if(s.status==='active'&&alive(m)&&alive(hero)&&intent.path?.length){
        const route=[point(m)];
        for(const p of intent.path){
          if(dist(m,p)!==1||!canOccupy(s,m,p))break;
          Object.assign(m,p);route.push(point(m));
        }
        motion(s,m,route,'dash',m.name+'施展位移');
      }
    }
    // Reflected damage may kill the lord during its own attack.
    checkFinished(s);
    if(s.status!=='active'||!alive(m)||!alive(hero))return;
    const route=monsterRoute(s,m,hero),end=route.at(-1);m.slow=0;
    if(route.length>1){
      Object.assign(m,end);
      log(s,m.name+'以'+monsterProfileFor(m).moveName+'移動','monster-move',{actor:m.uid,path:route,animation:{kind:'move',style:monsterProfileFor(m).move.kind}});
    }
    m.intent=dungeonIntent(s,m,hero);
  }
  function monsterTurn(s,m,hero){
    if(soloDungeonBeast(s,m))return weaponDungeonMonsterTurn(s,m,hero);
    const intent=m.trackingAttack&&m.intent?.kind==='attack'?trackingIntent(s,m,hero,true):
      m.weaponDungeonLord&&m.intent?.kind==='wait'?trackingIntent(s,m,hero):m.intent;
    if(intent?.kind==='defense-attack'){
      if(intent.origin&&key(intent.origin)!==key(m))return;
      const p=intent.target,o=s.objective;
      log(s,m.name+'發動攻擊','monster-attack',{actor:m.uid,animation:{kind:'cast',style:'point',origin:point(m),target:p,cells:intent.cells,color:'#e4a06d'}});
      if(key(p)===key(hero))damage(s,m,hero,m.atk,{skill:'monster-defense'});
      if(key(p)===key(o.shrine)){
        const dealt=Math.min(o.hp,m.atk);o.hp-=dealt;
        log(s,'靈陣受擊 −'+dealt+' · 耐久 '+o.hp+'/'+o.maxHp,'objective',
          {animation:{kind:'impact',style:'blast',cells:[point(o.shrine)],color:'#f39b78'}});
      }
      return;
    }
    if(s.trial?.layoutVersion===4&&s.objective?.type==='defense'&&intent?.kind==='advance'){
      const origin=point(m),goal=s.objective.shrine,queue=[origin],parents=new Map([[key(origin),null]]);
      for(let i=0;i<queue.length;i++)for(const p of neighbours(s,queue[i])){
        const k=key(p);if(parents.has(k)||blocked(s,p)||at(s,p)||k===key(goal))continue;
        parents.set(k,queue[i]);queue.push(p);
      }
      queue.sort((a,b)=>dist(a,goal)-dist(b,goal)||dist(a,origin)-dist(b,origin));
      let p=queue[0],route=[];while(p){route.unshift(p);p=parents.get(key(p));}
      route=route.slice(0,1+Math.max(1,Math.floor(2/(1+(m.slow||0)))));m.slow=0;
      if(route.length>1){Object.assign(m,route.at(-1));motion(s,m,route,'walk',m.name+'逼近靈陣');}
      return;
    }
    if(m.boss&&intent?.kind==='boss-attack'){
      if(intent.origin&&key(intent.origin)!==key(m))return;
      log(s,m.name+'發動蓄勢攻擊','monster-attack',{actor:m.uid,animation:{kind:'cast',style:'blast',origin:point(m),target:intent.target,cells:intent.cells,color:'#e4a06d'}});
      if(intent.cells.some(p=>key(p)===key(hero))){damage(s,m,hero,m.atk,{skill:'monster-boss'});if(alive(hero)&&intent.slow){hero.slow=1;hero.slowUntil=hero.turns+1;}}
      else log(s,hero.name+'避開了'+m.name+'的攻擊','dodge',{actor:hero.uid,animation:{kind:'dodge'}});
      if(intent.charge){
        const d=attackDirection({x:m.x+.5,y:m.y+.5},intent.target),route=[point(m)];
        for(let i=0;d&&i<2;i++){const p={x:m.x+d.x,y:m.y+d.y};if(!canOccupy(s,m,p))break;Object.assign(m,p);route.push(point(m));}
        motion(s,m,route,'dash',m.name+'向前衝撞');
      }
      return;
    }
    if(m.boss){
      const route=monsterRoute(s,m,hero),end=route.at(-1);
      if(route.length>1){m.x=end.x;m.y=end.y;motion(s,m,route,'walk',m.name+'逼近');}
      else log(s,m.name+'觀察戰局','wait',{actor:m.uid,animation:{kind:'guard'}});
      return;
    }
    if(intent?.kind==='strike'){
      log(s,m.name+'發起攻擊','monster-attack',{actor:m.uid,animation:{kind:'cast',style:'point',origin:point(m),target:point(hero),cells:intent.cells,color:'#dda080'}});
      // Honor an already visible warning from a pre-v2 battle for this turn.
      if(intent.cells.some(p=>key(p)===key(hero)))damage(s,m,hero,m.atk,{skill:'monster'});
      else log(s,hero.name+'避開了'+m.name+'的攻擊','dodge',{actor:hero.uid,animation:{kind:'dodge'}});return;
    }
    if(intent?.kind==='attack'){
      if(intent.origin&&key(intent.origin)!==key(m))return;
      const profile=monsterProfileFor(m),shape=intent.shape==='guardian'?(s.turn%2===0?'cross':'blast'):intent.shape;
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
    if(route.length>1){m.x=end.x;m.y=end.y;log(s,m.name+'以'+monsterProfileFor(m).moveName+'移動','monster-move',{actor:m.uid,path:route,animation:{kind:'move',style:monsterProfileFor(m).move.kind}});}
    else log(s,m.name+'觀察戰局','wait',{actor:m.uid,animation:{kind:'guard'}});
  }
  function gravityTrigger(s,a,step,existing=null){
    if(!alive(a)||!gravity()?.core(s.weaponObjects,a.uid))return null;
    const obj=gravity().core(s.weaponObjects,a.uid);
    if(obj.remainingTriggers<=0||obj.lastTrigger!==null&&obj.lastTrigger>=step)return null;
    const event=existing||log(s,a.name+'的引力星核共鳴','cast',{actor:a.uid,skill:'gravity-core',animation:{kind:'cast',style:'gravity-core',origin:point(a),target:obj.position,cells:gravity().area(prism().boardForTrial(s),obj.position,3)}});
    const records=[];
    const out=gravity().trigger(s.weaponObjects,a.uid,step,{
      board:prism().boardForTrial(s),actors:s.actors,targets:s.actors.filter(t=>t.team!==a.team),alive,
      forbidden:[...(s.objective?.shrine?[s.objective.shrine]:[]),...(s.objective?.points||[]).filter(q=>!q.activated)],
      canMove:t=>!t.boss||!!t.trackingAttack||soloDungeonBeast(s,t),
      move:(t,to,from)=>{Object.assign(t,to);motion(s,t,[from,to],'push',t.name+'受到引力牽引',event.id);if(t.bot)interruptMonster(t);},
      apply:(t,power,cell)=>{const shield=t.shield;const dealt=damage(s,a,t,a.atk*power,{skill:'gravity-core',manualId:'body-gravity',weaponHit:{group:event.id,rayId:0,cell,records}});return {damage:dealt,absorbed:shield-t.shield};}
    });
    s.weaponObjects=out.state;
    if(out.beat){event.animation.gravityBeat=out.beat;event.animation.gravityRecords=records;event.animation.weaponTimeline=gravity().timeline({cells:out.beat.cells},gravity().skillFor(obj),records,{uid:a.uid,beat:out.beat,automatic:!existing});event.animation.weaponGroup=event.id;event.animation.changes=s.actors.filter(t=>t.uid===a.uid||out.beat.moves.some(m=>m.uid===t.uid)).map(t=>({...appearance(t),x:t.x,y:t.y}));}
    if(!s.events.includes(event)){s.events.unshift(event);if(s.events.length>LIMITS.events)s.events.splice(1,1);}
    return out.beat;
  }
  function gravityRound(s,step){
    if(!s.weaponObjects)return;
    for(const a of s.actors.filter(a=>!a.bot&&alive(a)))gravityTrigger(s,a,step);
  }
  function begin(s,a,now){
    s.turnUid=a.uid;a.turns++;if(!s.quizRound)a.questions=0;a.attacks=0;a.actions=0;a.guard=0;a.counter=0;
    if(s.quizRound){s.phase='action';s.actionRevision=s.revision+1;}
    if(a.fistFocusUntil<a.turns)delete a.fistFocusUntil;
    if((a.slowUntil||0)<a.turns)a.slow=0;
    if(a.counterManualId&&!a.counter)delete a.counterManualId;
    s.turnStartedAtMs=now;s.deadlineMs=s.mode==='pvp'?now+LIMITS.turnMs:0;
    gravityRound(s,2*s.turn);
    const due=s.effects.filter(e=>e.owner===a.uid&&e.due<=a.turns);
    s.effects=s.effects.filter(e=>!due.includes(e));
    for(const e of due){
      log(s,'隕星落下','impact',{actor:a.uid,skill:e.skill,animation:{kind:'impact',style:'meteor',cells:e.cells,color:'#b5a1e7'}});
      strikeSeals(s,e.cells);
      for(const t of s.actors.filter(t=>alive(t)&&t.team!==a.team&&intersects(t,e.cells)))damage(s,a,t,e.power,{skill:e.skill});
    }
    checkFinished(s);
    if(s.status==='active')log(s,a.name+'的行動回合','turn',{actor:a.uid,animation:{kind:'turn',changes:[appearance(a)]}});
  }
  function questionRound(s,now){
    s.quizRound++;s.phase='answer';s.initiativeUid='';s.actedUids=[];s.answerDeadlineMs=0;s.deadlineMs=0;
    s.turnStartedAtMs=now;
    for(const a of s.actors){a.questions=0;a.quizExpired=false;}
    // Never carry an in-flight generation or an unanswered question into a new round.
    s.pending={};s.pendingFollowup={};
  }
  function readyForAction(s,a){return a.questions>=LIMITS.questions||a.quizExpired;}
  function nextAction(s,now){
    const next=s.actors.find(a=>!s.actedUids.includes(a.uid));
    if(!next){questionRound(s,now);return;}
    if(readyForAction(s,next))begin(s,next,now);
    else{s.phase='waiting-answer';s.deadlineMs=0;}
  }
  function end(s,now){
    if(s.weaponObjects)s.weaponObjects=gravity().endOwnerWindow(s.weaponObjects,s.turnUid,2*s.turn);
    if(s.mode==='pve'){
      const hero=s.actors[0];
      if(s.trial?.layoutVersion===4&&s.objective?.type==='sealing'&&s.objective.hazards?.some(p=>key(p)===key(hero))){
        const hit=Math.min(hero.hp,Math.max(1,Math.round(hero.maxHp*SEAL_TYPES.hazard.maxHpDamageRatio)));hero.hp-=hit;
        log(s,'妖煞陣爆發 −'+hit,'damage',{target:hero.uid,damage:hit,animation:{kind:'damage',changes:[appearance(hero)],numbers:[{uid:hero.uid,damage:hit}]}});
      }
      gravityRound(s,2*s.turn+1);
      if(s.weaponDungeon){checkFinished(s);if(s.status!=='active')return;}
      for(const m of s.actors.filter(a=>a.bot&&alive(a))){
        if(!alive(hero)||s.objective?.type==='defense'&&s.objective.hp<=0)break;
        if(s.weaponDungeon&&!alive(m))continue;
        monsterTurn(s,m,hero);
        if(s.weaponDungeon){checkFinished(s);if(s.status!=='active')return;}
        if(!alive(hero))break;
      }
      if(s.trial?.layoutVersion===4&&s.objective?.type==='defense'){
        const o=s.objective;o.completedRounds++;
        if(alive(hero)&&o.hp>0&&o.completedRounds<o.rounds&&s.actors.filter(a=>a.bot&&alive(a)).length<5){
          const entries=[{x:0,y:Math.floor(s.height/2)},{x:s.width-1,y:Math.floor(s.height/2)},{x:Math.floor(s.width/2),y:0},{x:Math.floor(s.width/2),y:s.height-1}];
          const entry=entries[o.spawnIndex%entries.length],options=[];
          for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){
            const p={x,y};if(!blocked(s,p)&&!at(s,p)&&dist(p,o.shrine)>=3)options.push(p);
          }
          options.sort((a,b)=>dist(a,entry)-dist(b,entry)||a.y-b.y||a.x-b.x);
          const originals=s.actors.filter(a=>a.bot&&/^monster-[0-9]+$/.test(a.uid)),template=originals[o.spawnIndex%originals.length];
          if(options[0]&&template){
            const uid='wave-'+o.spawnIndex++;const newcomer=actor({...template,uid,role:'assault'},options[0]);
            s.actors.push(newcomer);log(s,newcomer.name+'加入戰場','objective');
          }
        }
      }
      s.turn++;checkFinished(s);if(s.status==='active'){begin(s,hero,now);if(s.status==='active'||!s.weaponDungeon)prepareIntents(s,!!s.weaponDungeon);}
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
    let endsTurn=command.type==='end';
    if(command.type==='sword-move'){
      if(!a.flyingSword)fail('場上尚無飛劍');
      const route=swordRoute(s,a,p);
      const steps=route?route.length-1:0;
      if(!steps||steps%2)fail('飛劍只能沿最短路徑移動偶數格');
      if(at(s,p))fail('飛劍落點必須是空地');
      const cost=steps/2;
      if(cost>a.stamina)fail('移動飛劍的體力不足');
      const origin=point(a.flyingSword);
      a.stamina-=cost;a.flyingSword=point(p);
      if(s.pveMetrics)s.pveMetrics.staminaSpent+=cost;
      const cells=route.slice(1);
      const hits=s.actors.filter(t=>alive(t)&&t.team!==a.team&&intersects(t,cells));
      const movement=log(s,a.name+'御使飛劍移動 '+steps+' 格，消耗 '+cost+' 體力','cast',{
        actor:a.uid,skill:'flight-summon',x:p.x,y:p.y,
        animation:{kind:'cast',style:'flying-sword',origin,target:point(p),path:route,cells,
          changes:[appearance(a)]}});
      strikeSeals(s,cells);
      for(const target of hits){
        if(alive(target))damage(s,a,target,a.atk*(a.flyingSwordBalanceVersion===2?a.flyingSwordPower:(a.flyingSwordPower||1.1)*(.85/1.1)),{
          skill:'flight-summon',manualId:a.flyingSwordManualId||'sword-flight'});
      }
    }else if(command.type==='move'){
      const route=path(s,a,p,a.uid),cost=route?route.length-1:0;
      if(!route||route.length<2)fail('此地格無法到達');
      if(a.slow&&cost>2)fail('緩速中，本次最多移動 2 格');
      if(cost>a.stamina)fail('體力不足以走到這裡');
      a.stamina-=cost;a.x=p.x;a.y=p.y;a.slow=0;
      if(s.pveMetrics)s.pveMetrics.staminaSpent+=cost;
      log(s,a.name+'移動 '+(route.length-1)+' 格，消耗 '+cost+' 體力','move',{actor:a.uid,path:route,animation:{kind:'move',style:'walk',changes:[appearance(a)]}});
    }else if(command.type==='skill'){
      // Golden-core techniques are retired from tactical combat, including
      // clients still sending an old 'skill' command.
      fail('金丹技能已停用');
    }else if(command.type==='attack'||command.type==='manual'){
      // An equipped manual replaces basic attack rather than adding a second
      // independent attack button. The server enforces the same policy as UI.
      if(command.type==='attack'&&a.manualSkills?.length)fail('已裝備功法技能，普通攻擊已被替換');
      if(command.type==='manual'&&!a.manualSkills?.length)fail('尚未裝備功法技能');
      const selected=command.type==='attack'?basicFor(a):manualSkillFor(a,command.skillId);
      if(!selected)fail('尚未裝備或解鎖此功法技能');
      cast(s,a,selected,p,false,command.first||null);
      endsTurn=selected.kind==='fist-focus';
    }else if(command.type==='guard'){
      validateAttackLimit(a);a.guard=Math.max(.4,a.guard);a.attacks++;log(s,a.name+'凝神護身，下次自身回合前減傷 40%','guard',{actor:a.uid,animation:{kind:'guard',changes:[appearance(a)]}});
    }else if(!endsTurn)fail('未知的戰場行動');
    if(command.type!=='end')retargetTrackingIntents(s);
    a.actions++;(s.turnTimeouts||={})[uid]=0;
    // A displacement or the last hit can finish an objective before enemies act.
    if(s.mode==='pve'&&s.trial?.layoutVersion>=3)checkFinished(s);
    if(endsTurn&&s.status==='active'){
      log(s,s.mode==='pve'?'妖獸開始行動':a.name+'結束回合','turn',{actor:a.uid,animation:{kind:'turn'}});
      end(s,now);
    }
    s.revision++;if(s.quizRound)s.actionRevision=s.revision;s.updatedAtMs=now;checkFinished(s);return s;
  }
  function answer(state,uid,correct,now=Date.now()){
    // A late response may arrive after the opponent's action clock. Resolve it
    // before accepting this answer so the second player still gets 30 seconds.
    const timed=state.quizRound?expire(state,now):state;
    if(state.quizRound&&timed.quizRound!==state.quizRound)fail('本輪答題時間已結束');
    const s=clone(timed),a=canAnswer(s,uid,now);
    const before=a.stamina;a.stamina=Math.min(LIMITS.stamina,a.stamina+(correct?LIMITS.correct:LIMITS.wrong));
    a.questions++;a.answered++;if(correct)a.correct++;
    if(s.pveMetrics)s.pveMetrics.answers++;
    log(s,a.name+(correct?'答對':'訂正')+'，體力 +'+(a.stamina-before),'answer',{actor:uid,correct,gain:a.stamina-before,
      animation:{kind:'answer',changes:[appearance(a)],numbers:[{uid,gain:a.stamina-before}]}});
    if(!s.quizRound)(s.turnTimeouts||={})[uid]=0;
    if(s.quizRound&&a.questions===LIMITS.questions){
      if(!s.initiativeUid){s.initiativeUid=uid;s.answerDeadlineMs=now+LIMITS.answerMs;begin(s,a,now);}
      else if(s.phase==='waiting-answer')begin(s,a,now);
    }
    s.revision++;s.updatedAtMs=now;
    if(s.mode==='pve'&&s.trial?.layoutVersion>=3)checkFinished(s);
    return s;
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
            a.quizExpired=true;delete s.pending?.[a.uid];delete s.pendingFollowup?.[a.uid];
            log(s,a.name+'答題倒數結束，未作答題目不獲得體力','quiz-timeout',{actor:a.uid});
          }
          if(s.phase==='waiting-answer')nextAction(s,due);
        }else{
          const uid=s.turnUid;const timeouts=s.turnTimeouts||={};timeouts[uid]=(timeouts[uid]||0)+1;
          log(s,current(s).name+'行動逾時','timeout',{actor:uid,animation:{kind:'turn'}});
          if(s.turnTimeouts[uid]>=2){s.status='finished';s.winner=s.actors.find(a=>a.uid!==uid).team;s.finishReason='timeout';s.deadlineMs=0;}
          else end(s,due);
        }
        s.revision++;s.updatedAtMs=now;
      }
      return s;
    }
    if(state.status!=='active'||state.mode!=='pvp'||now<state.deadlineMs)return state;
    const s=clone(state),uid=s.turnUid;const timeouts=s.turnTimeouts||={};timeouts[uid]=(timeouts[uid]||0)+1;
    log(s,current(s).name+'行動逾時','timeout',{actor:uid,animation:{kind:'turn'}});
    if(s.turnTimeouts[uid]>=2){s.status='finished';s.winner=s.actors.find(a=>a.uid!==uid).team;s.finishReason='timeout';s.deadlineMs=0;}
    else end(s,now);
    s.revision++;s.updatedAtMs=now;return s;
  }
  function forfeit(state,uid,now=Date.now()){
    const s=clone(state);if(!s.actors.some(a=>a.uid===uid))fail('你不在此戰場');
    if(s.status==='finished')return s;
    s.status='finished';s.winner=s.mode==='pve'?'monster':s.actors.find(a=>a.uid!==uid)?.team||'draw';s.finishReason='forfeit';s.deadlineMs=0;s.revision++;s.updatedAtMs=now;
    if(s.pveMetrics)Object.assign(s.pveMetrics,{outcome:'loss',reason:'forfeit',turns:s.actors.find(a=>a.uid===uid)?.turns||0});
    if(s.weaponObjects)s.weaponObjects=weave().finish(s.weaponObjects);
    log(s,s.actors.find(a=>a.uid===uid).name+'收法離場','forfeit',{actor:uid,animation:{kind:'withdraw'}});return s;
  }
  return Object.freeze({SEAL_MAX_DURABILITY,SEAL_HIT_DAMAGE,SEAL_TYPES,SEAL_KINDS,sealDefinition,sealInfo,sealInfos,sealEffectCells,LIMITS,MAPS,CORES,BASIC,basicFor,manualSkillFor,attackDirection,SPIRIT_BRANCHES,spiritBranch,savedBranch,seeded,stageLayout,TUTORIAL_STAGE1,MONSTERS,monsterProfile,monsterProfileFor,trackingCells,DUNGEON_ENEMY_SKILLS,dungeonSkillPlan,dungeonIntent,retargetTrackingIntents,monsterCells,monsterRoute,prepareIntents,TRIAL_TERRAINS,TRIAL_ENEMIES,num,dist,key,alive,current,mapFor,branchFor,inside,blocked,at,footprint,covers,canOccupy,neighbours,path,moveCells,swordRoute,swordMoveCells,sight,area,line,actor,create,join,aimCells,skillCells,crossedSwordLines,techniquePath,techniquePreview,previewCast,skillPreviewPlan,focusTurns,attackLimit,techniqueCost,cooldownUntil,validateSkill,canAnswer,apply,answer,expire,forfeit});
});

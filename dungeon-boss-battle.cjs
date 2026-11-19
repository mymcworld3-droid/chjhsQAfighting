'use strict';
// Stage 15: fully server-owned cooperative boss room. The boss is a real 2x2
// collision creature, not four independently damageable NPCs or a client
// animation. Map generation is deterministic and separate from v1 exploration.
const {walkable}=require('./dungeon-map-generator.cjs');
const {dueTick,isRunning}=require('./dungeon-battle-clock.cjs');
const Combat=require('./dungeon-enemy-combat.cjs');
const {clampStamina}=require('./dungeon-stamina-rules.cjs');
const VERSION=1,ID='boss-1',KIND='boss',NAME='玄炎鎮殿獸',HP=900;
const SIZE=2,WIDTH=23,HEIGHT=17;
const SHIELD_MAX=180,COMBO_WINDOW_TICKS=5,GUARD_DURATION_TICKS=5;
const ALLY_GUARD_COST=3,SELF_GUARD_COST=6;
const STAGGER_TICKS=3,EXPOSED_TICKS=6;
const MAX_GUARD_SEQ=100000;
const ANCHOR=Object.freeze({x:11,y:6});
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const clamp=(n,low,high)=>Math.min(high,Math.max(low,n));
const key=p=>p.x+','+p.y;
const hash=text=>{
  let result=2166136261;
  for(let i=0;i<text.length;i++){result^=text.charCodeAt(i);result=Math.imul(result,16777619);}
  return (result>>>0).toString(16).padStart(8,'0');
};
function mapFor(seed){
  if(typeof seed!=='string'||seed.length<4||seed.length>160)
    throw fail('首領戰地圖種子無效',409);
  const tiles=Array(WIDTH*HEIGHT).fill(0);
  for(let y=1;y<HEIGHT-1;y++)for(let x=1;x<WIDTH-1;x++){
    // An open combat bowl with a scalloped outer wall and light ground
    // pattern. No narrow passages in which four friends can get trapped.
    if((x<=2||x>=WIDTH-3)&&(y<=2||y>=HEIGHT-3))continue;
    tiles[y*WIDTH+x]=((x+2*y)%5===0)?2:1;
  }
  // Seeded cover makes repeat visits distinct without corrupting the
  // broad, four-connected boss chamber. Pillars are always outside all
  // spawn pads and the genuine 2x2 enemy body.
  const variation=parseInt(hash(seed).slice(-4),16)%3;
  for(const p of [
    {x:4+variation,y:4},{x:WIDTH-5-variation,y:4},
    {x:4+variation,y:11},{x:WIDTH-5-variation,y:11},
    {x:6+variation,y:8},{x:WIDTH-7-variation,y:8}
  ])tiles[p.y*WIDTH+p.x]=0;
  const spawnPads=[{x:7,y:13},{x:9,y:13},{x:13,y:13},{x:15,y:13}];
  const spawn={...spawnPads[0]},bossSite={...ANCHOR};
  // The legacy camera contract expects these markers, even when the boss
  // painter deliberately hides the exploration-only entrance and portal.
  const map={mode:'dungeon',arena:'boss',layoutVersion:1,
    layoutId:'boss-v1-'+hash(seed),width:WIDTH,height:HEIGHT,tiles,
    seed:'boss:'+seed,biome:'ruins',title:'玄炎鎮殿',
    spawn,spawnPads,entrance:spawn,deepest:bossSite,
    guardianSite:bossSite,portalSite:spawn,
    bossSite,mainRoute:[],mainTurns:[],branches:[],branchCount:0,
    walkableCount:tiles.filter(x=>x!==0).length
  };
  for(const p of [...spawnPads,...cells({kind:KIND,position:ANCHOR})])
    if(!walkable(map,p))throw fail('首領戰場出生點生成失敗',409);
  return map;
}
function cells(enemy){
  if(enemy?.kind!==KIND)return enemy?.position?[enemy.position]:[];
  const p=enemy.position;
  if(!p||!Number.isSafeInteger(p.x)||!Number.isSafeInteger(p.y))return [];
  return [{x:p.x,y:p.y},{x:p.x+1,y:p.y},
    {x:p.x,y:p.y+1},{x:p.x+1,y:p.y+1}];
}
const occupies=(enemy,p)=>cells(enemy).some(q=>same(q,p));
const reach=(from,enemy)=>Math.min(...cells(enemy).map(p=>dist(from,p)),Infinity);
const phase=hp=>hp>HP*.7?1:hp>HP*.35?2:3;
const tickOf=room=>Number.isSafeInteger(room?.battleAppliedTick)?
  Math.max(0,room.battleAppliedTick):0;
const int=(value,otherwise=0)=>Number.isSafeInteger(value)&&value>=0?value:otherwise;
function comboReady(boss,uid,tick){
  return boss?.kind===KIND&&typeof uid==='string'&&uid.length>0&&
    typeof boss.lastContributorUid==='string'&&
    boss.lastContributorUid!==uid&&
    Number.isSafeInteger(boss.lastContributorTick)&&
    tick>=boss.lastContributorTick&&
    tick-boss.lastContributorTick<=COMBO_WINDOW_TICKS;
}
// Mutates ONLY the local enemy snapshot calculated inside the C transaction.
// One martial skill may hit the boss several times; the caller computes linked
// ONCE per skill, so its own repeated hits cannot manufacture teamwork.
function damage(boss,uid,amount,tick,linked=false){
  if(boss?.kind!==KIND||typeof uid!=='string'||!uid||
      !Number.isSafeInteger(tick)||tick<0||!Number.isFinite(amount))
    throw fail('首領傷害資料無效',409);
  const health=int(boss.battleHealth,HP);
  if(!health)return {damage:0,shieldDamage:0,combo:false,shieldBroken:false};
  const combo=linked===true;
  const attack=Math.max(1,Math.round(amount*(combo?1.2:1)));
  const shieldBefore=Math.min(SHIELD_MAX,int(boss.shield));
  const shieldDamage=Math.min(shieldBefore,attack);
  // Shield reduces HP damage, but never makes the boss invulnerable.
  const exposed=shieldBefore===0&&tick<=int(boss.exposedUntilTick,-1);
  const dealt=Math.min(health,Math.max(1,Math.round(attack*(
    shieldBefore>0?.7:exposed?1.25:1))));
  boss.battleHealth=health-dealt;
  boss.shield=shieldBefore-shieldDamage;
  const broken=shieldBefore>0&&boss.shield===0;
  if(broken){
    boss.exposedUntilTick=tick+EXPOSED_TICKS;
    // A shield break interrupts a wind-up once and opens a short counter window.
    boss.attack=null;boss.intent='staggered';boss.targetUid=null;
    boss.nextActionTick=Math.max(int(boss.nextActionTick),tick+STAGGER_TICKS);
  }
  boss.lastContributorUid=uid;boss.lastContributorTick=tick;
  boss.lastTeamHit={uid,tick,damage:dealt,shieldDamage,
    combo,shieldBroken:broken};
  return {...boss.lastTeamHit};
}
function guard(room,uid,map,{targetUid,seq}={}){
  if(room?.status!=='assembled'||room.dungeonArena!=='boss'||
    room.bossEncounter?.status!=='fighting')throw fail('目前無法使用首領掩護',409);
  if(typeof targetUid!=='string'||!Object.hasOwn(room.members||{},targetUid))
    throw fail('掩護對象不是目前的隊員',403);
  const source=room.members?.[uid],target=room.members[targetUid];
  if(!source)throw fail('你不是此副本的隊員',403);
  if(!Number.isSafeInteger(seq)||seq<1||seq>MAX_GUARD_SEQ)
    throw fail('掩護操作序號無效',400);
  const previous=int(source.guardSeq);
  if(seq===previous&&source.lastGuard?.targetUid===targetUid&&
      source.lastGuard?.seq===seq)
    return {duplicate:true,members:room.members};
  if(seq!==previous+1)throw fail('掩護序號不同步，請重新取得隊伍狀態',409);
  if(!Combat.isAlive(source)||!Combat.isAlive(target)||
      !walkable(map,source.position)||!walkable(map,target.position))
    throw fail('倒地或站位無效，無法進行掩護',409);
  if(dist(source.position,target.position)>2)
    throw fail('必須與隊友相距兩格以內才能掩護',409);
  const cost=targetUid===uid?SELF_GUARD_COST:ALLY_GUARD_COST;
  if(clampStamina(source.explorationStamina)<cost)
    throw fail('探索體力不足，無法掩護',409);
  const tick=tickOf(room);
  // Competing teammates must not spend energy on an already active guard.
  // The C transaction serializes simultaneous attempts across instances.
  const active=target.bossGuard;
  if(active&&Number.isSafeInteger(active.expiresAtTick)&&
      active.expiresAtTick>=tick&&
      Object.hasOwn(room.members,active.sourceUid||''))
    throw fail('隊友已有有效掩護，請等待掩護生效或結束',409);
  const protectedMember={...target,
    bossGuard:{sourceUid:uid,grantedAtTick:tick,
      expiresAtTick:tick+GUARD_DURATION_TICKS}};
  const lastGuard={seq,targetUid,cost,tick};
  const members={...room.members,[targetUid]:protectedMember};
  members[uid]={...members[uid],explorationStamina:
    clampStamina(source.explorationStamina)-cost,guardSeq:seq,lastGuard};
  return {duplicate:false,members,lastGuard};
}
function resolveGuardedAttack(boss,members,tick){
  const attack=boss.attack;
  if(!attack||tick<attack.resolvesAtTick)return {members,hits:[]};
  const hits=[];let next=members;
  for(const [uid,member]of Object.entries(members||{})){
    if(!Combat.isAlive(member)||!attack.cells.some(p=>same(p,member.position)))continue;
    const protection=member.bossGuard;
    const guarded=protection&&Object.hasOwn(members,protection.sourceUid||'')&&
      Number.isSafeInteger(protection.grantedAtTick)&&
      tick>=protection.grantedAtTick&&
      Number.isSafeInteger(protection.expiresAtTick)&&
      tick<=protection.expiresAtTick;
    const reduced=guarded?Math.max(1,Math.ceil(attack.damage/2)):attack.damage;
    const remaining=Math.max(0,Combat.clampHealth(member)-reduced);
    if(next===members)next={...members};
    next[uid]={...member,battleHealth:remaining,downed:remaining===0,
      bossGuard:null,lastDamage:{sourceId:boss.id,amount:reduced,tick,
        ...(guarded?{guardedByUid:protection.sourceUid,
          blockedAmount:attack.damage-reduced}:{})}};
    hits.push(uid);
  }
  return {members:next,hits};
}
function initialBoss(){
  return {id:ID,name:NAME,kind:KIND,position:{...ANCHOR},
    battleHealth:HP,battleMaxHealth:HP,shield:SHIELD_MAX,
    exposedUntilTick:-1,lastContributorUid:null,lastContributorTick:-1,
    lastTeamHit:null,
    footprint:SIZE,phase:1,cadence:4,aggroRange:20,
    intent:'waiting',targetUid:null,lastActionTick:0,
    attack:null,lastAttack:null,lastAttackTick:0,
    attackCount:0,nextActionTick:0};
}
function enter(room,uid,explorationMap,now,roomId=''){
  if(room?.status!=='assembled')throw fail('副本尚未集結',409);
  const member=room.members?.[uid];
  if(!member)throw fail('你不是此副本的隊員',403);
  if(room.dungeonArena==='boss'&&room.bossEncounter?.version===VERSION)
    return {duplicate:true,room};
  if(room.dungeonArena&&room.dungeonArena!=='exploration')
    throw fail('副本場景狀態無法識別',409);
  if(room.dungeonProgress?.portalStatus!=='open'||
      room.dungeonProgress?.keyAcquired!==true)
    throw fail('必須先擊敗守鑰靈獸並開啟共享傳送門',409);
  if(!Combat.isAlive(member))throw fail('倒地狀態無法引導全隊傳送',409);
  if(!walkable(explorationMap,member.position)||
      dist(member.position,explorationMap.portalSite)>1)
    throw fail('請走到已啟動的傳送陣或相鄰一格',409);
  const arena=mapFor(room.mapSeed||('legacy:'+roomId));
  const joined=Object.entries(room.members).sort(([,a],[,b])=>
    a.joinedAtMs-b.joinedAtMs||String(a.uid).localeCompare(String(b.uid)));
  const members={...room.members};
  joined.forEach(([id,record],i)=>{
    members[id]={...record,position:{...arena.spawnPads[i]},
      flyingSword:null,lastMove:null};
  });
  // Synchronize to the current server tick at the transition so old
  // exploration warnings cannot strike in the new room retrospectively.
  const tick=Math.max(Number(room.battleAppliedTick)||0,dueTick(room,now));
  const boss={...initialBoss(),nextActionTick:tick+2};
  const bossEncounter={version:VERSION,status:'fighting',
    enteredByUid:uid,enteredAtTick:tick,defeatedAtTick:null,
    defeatedByUid:null};
  const next={...room,dungeonArena:'boss',enemies:[boss],members,
    bossEncounter,battleAppliedTick:tick,battleAppliedAtMs:now};
  return {duplicate:false,room:next};
}
function attackCells(map,boss,kind,target){
  const origin=boss.position,body=cells(boss),out=[];
  if(kind==='quake'){
    for(let y=origin.y-3;y<=origin.y+4;y++)
      for(let x=origin.x-3;x<=origin.x+4;x++){
        const p={x,y};
        const separation=Math.min(...body.map(q=>dist(p,q)));
        if(separation>=1&&separation<=3)out.push(p);
      }
  }else if(kind==='charge'){
    // A fixed warning corridor crossing the boss chamber, not a teleport.
    const horizontal=Math.abs(target.x-(origin.x+.5))>=
      Math.abs(target.y-(origin.y+.5));
    if(horizontal){
      for(let x=1;x<map.width-1;x++)for(const y of [origin.y,origin.y+1])
        out.push({x,y});
    }else{
      for(let y=1;y<map.height-1;y++)for(const x of [origin.x,origin.x+1])
        out.push({x,y});
    }
  }else if(kind==='flame'){
    // Expanding arc towards the chosen target; all squares are committed
    // before the wind-up appears, allowing players to dodge.
    const dx=Math.sign(target.x-(origin.x+.5));
    const dy=Math.sign(target.y-(origin.y+.5));
    const horizontal=Math.abs(target.x-(origin.x+.5))>=
      Math.abs(target.y-(origin.y+.5));
    for(let n=1;n<=5;n++)for(let side=-Math.ceil(n/2);side<=Math.ceil(n/2);side++){
      const edge=horizontal?{x:dx>0?origin.x+1:origin.x,y:origin.y}:
        {x:origin.x,y:dy>0?origin.y+1:origin.y};
      out.push(horizontal?{x:edge.x+dx*n,y:edge.y+side}:
        {x:edge.x+side,y:edge.y+dy*n});
    }
  }
  const seen=new Set();
  return out.filter(p=>walkable(map,p)&&!occupies(boss,p)&&
    !seen.has(key(p))&&seen.add(key(p))).slice(0,110);
}
function plan(map,boss,members,tick){
  const living=Object.entries(members||{}).filter(([,m])=>
    Combat.isAlive(m)&&walkable(map,m.position))
    .sort(([a,x],[b,y])=>reach(x.position,boss)-reach(y.position,boss)||
      a.localeCompare(b));
  if(!living.length)return null;
  const [targetUid,target]=living[0],step=boss.attackCount||0;
  const p=phase(boss.battleHealth);
  const pattern=p===1?'quake':p===2?['quake','charge'][step%2]:
    ['quake','charge','flame'][step%3];
  const rules={quake:['震地裂環',11],charge:['玄甲衝鋒',13],
    flame:['玄炎扇焰',16]};
  const squares=attackCells(map,boss,pattern,target.position);
  if(!squares.length)return null;
  return {kind:pattern,label:rules[pattern][0],damage:rules[pattern][1],
    from:{...boss.position},cells:squares,targetUid,
    startedAtTick:tick,resolvesAtTick:tick+Combat.WINDUP_TICKS};
}
function advance(room,map,now){
  if(!isRunning(room)||room?.dungeonArena!=='boss'||!room.bossEncounter)
    return null;
  const applied=Number.isSafeInteger(room.battleAppliedTick)?
    room.battleAppliedTick:0;
  const due=Math.max(applied,dueTick(room,now));
  if(due<=applied)return null;
  // Once the shared boss is defeated there is no autonomous enemy left to
  // simulate. Stop per-second Firestore writes; the displayed elapsed clock
  // still advances from the original server timestamp without C mutations.
  if(room.bossEncounter.status!=='fighting')return null;
  const initial=room.enemies?.find(e=>e.id===ID);
  if(!initial)throw fail('首領戰資料異常，缺少有效 Boss',409);
  const safeCatchup=due-applied>Combat.SAFE_CATCHUP_TICKS;
  const start=safeCatchup?due:applied+1;
  let boss={...initial,...(safeCatchup?{attack:null}:{})},members=room.members;
  for(let tick=start;tick<=due;tick++){
    if(boss.attack&&tick>=boss.attack.resolvesAtTick){
      if(boss.attack.startedAtTick>applied){
        boss.attack={...boss.attack,resolvesAtTick:due+Combat.WINDUP_TICKS};
      }else{
        const result=resolveGuardedAttack(boss,members,tick);
        members=result.members;
        boss={...boss,attack:null,lastAttack:{
          tick,kind:boss.attack.kind,label:boss.attack.label,
          damage:boss.attack.damage,cells:boss.attack.cells,hits:result.hits
        },lastAttackTick:tick,intent:'recover',targetUid:null,
          lastActionTick:tick};
      }
    }else if(!boss.attack&&tick>=boss.nextActionTick){
      const warning=plan(map,boss,members,tick);
      if(warning){
        boss={...boss,attack:warning,intent:'windup',
          phase:phase(boss.battleHealth),targetUid:warning.targetUid,
          attackCount:(boss.attackCount||0)+1,
          nextActionTick:tick+(phase(boss.battleHealth)===3?3:4),
          lastActionTick:tick};
      }else boss.nextActionTick=tick+2;
    }
  }
  if(boss.attack&&boss.attack.startedAtTick>applied)
    boss.attack={...boss.attack,
      resolvesAtTick:Math.max(boss.attack.resolvesAtTick,
        due+Combat.WINDUP_TICKS)};
  return {enemies:[boss],members,
    battleAppliedTick:due,battleAppliedAtMs:now};
}
function onDefeat(room,enemies,uid){
  if(room?.dungeonArena!=='boss'||room?.bossEncounter?.status!=='fighting')
    return room?.bossEncounter||null;
  if(!room.enemies?.some(e=>e.id===ID)||
      enemies?.some(e=>e.id===ID))return room.bossEncounter;
  return {...room.bossEncounter,status:'defeated',
    defeatedByUid:uid,defeatedAtTick:room.battleAppliedTick||0};
}
function publicEncounter(state){
  if(state?.version!==VERSION)return null;
  return {version:VERSION,status:state.status,
    enteredByUid:state.enteredByUid||null,
    enteredAtTick:state.enteredAtTick||0,
    defeatedByUid:state.defeatedByUid||null,
    defeatedAtTick:state.defeatedAtTick??null};
}
module.exports={VERSION,ID,KIND,NAME,HP,SIZE,ANCHOR,WIDTH,HEIGHT,
  SHIELD_MAX,COMBO_WINDOW_TICKS,GUARD_DURATION_TICKS,ALLY_GUARD_COST,SELF_GUARD_COST,
  STAGGER_TICKS,EXPOSED_TICKS,comboReady,damage,guard,resolveGuardedAttack,
  mapFor,cells,occupies,reach,initialBoss,enter,phase,attackCells,plan,
  advance,onDefeat,publicEncounter};

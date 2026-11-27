'use strict';
// Only the committed server tick may advance a gravity core. One party-wide
// four-second pulse window, independent of enemy count and client activity.
// An idle catch-up produces at most one visible pulse, never a replay burst.
const Gravity=require('./public/cultivation/gravity-weapon-rules.js');
const Objects=require('./public/cultivation/weapon-special-objects.js');
const Prism=require('./public/cultivation/prism-weapon-rules.js');
const BossHit=require('./public/cultivation/dungeon-boss-hit.js');
const Combat=require('./dungeon-enemy-combat.cjs');
const ManualProgress=require('./dungeon-manual-progression.cjs');
const {recordedMax}=require('./dungeon-player-combat.cjs');
const Objectives=require('./dungeon-objectives.cjs');
const PULSE_TICKS=4,MAX_EVENTS=16;
const health=e=>Number.isSafeInteger(e.battleHealth)?Math.max(0,e.battleHealth):recordedMax(e);
const point=p=>({x:p.x,y:p.y});
function visualEnemy(e){return {id:e.id,kind:e.kind,name:e.name||'',position:point(e.position),battleHealth:health(e),battleMaxHealth:recordedMax(e),...(e.kind==='boss'?{footprint:2,shield:e.shield||0}:{}),attack:null};}
function create(room,map){
  if(!room.weaponObjects?.objects?.some(o=>o.type==='core'))return null;
  let state=Objects.normalize(room.weaponObjects),events=(room.gravityEvents||[]).slice(-MAX_EVENTS),progress=room.dungeonProgress,encounter=room.bossEncounter,manualExp=room.manualExp;
  let changed=false;
  const board=Prism.boardForDungeon(map);
  function beforeTick(enemies,members,tick){
    let next=enemies;
    for(const obj of state.objects.filter(o=>o.type==='core')){
      const uid=obj.ownerUid,owner=members[uid];
      if(!owner||!Combat.isAlive(owner)){
        state=Objects.clear(state,uid,'core');changed=true;continue;
      }
      if(obj.exhaustedAt!==null){
        if(tick>=obj.exhaustedAt+PULSE_TICKS){state=Objects.endOwnerWindow(state,uid,tick);changed=true;}
        continue;
      }
      if(tick<(obj.lastTrigger??obj.generatedAt)+PULSE_TICKS)continue;
      const attack=Number.isSafeInteger(owner.dungeonAttack)&&owner.dungeonAttack>0?owner.dungeonAttack:Number.isSafeInteger(owner.battleAttack)&&owner.battleAttack>0?owner.battleAttack:30;
      const previous=next,cloned=next.map(e=>({...e,position:point(e.position)}));
      const actors=[...cloned,...Object.entries(members).map(([id,m])=>({...m,uid:id}))],hits=[];
      const result=Gravity.trigger(state,uid,tick,{board,actors,targets:cloned,alive:e=>health(e)>0,canMove:e=>e.kind!=='boss',
        move:(e,to)=>{e.position=point(to);e.attack=null;e.intent='recover';e.targetUid=null;e.gravityStaggerTick=tick;},
        apply:(e,power,cell)=>{
          const raw=Math.max(1,Math.round(attack*power));
          const hit=e.kind==='boss'?BossHit.damage(e,uid,raw,tick,BossHit.comboReady(e,uid,tick)):{damage:Math.min(health(e),raw),shieldDamage:0};
          if(e.kind!=='boss'){e.battleHealth=health(e)-hit.damage;e.battleMaxHealth=recordedMax(e);}
          hits.push({enemyId:e.id,cell:point(cell),damage:hit.damage,shieldDamage:hit.shieldDamage||0,remainingHealth:e.battleHealth,defeated:e.battleHealth===0});
          return {damage:hit.damage,absorbed:hit.shieldDamage||0};
        }
      });
      if(!result.triggered)continue;
      state=result.state;changed=true;
      next=cloned.filter(e=>health(e)>0);
      const beat=result.beat,skill=Gravity.skillFor(obj),visualMoves=beat.moves.filter(m=>m.moved).map(m=>({enemyId:m.uid,from:m.from,to:m.to}));
      const hitIds=new Set(hits.map(h=>h.enemyId));
      const cast={skillId:'gravity-core',skillName:'引力星核',origin:point(owner.position),target:point(obj.position),cost:0,hits,visualMoves,
        totalDamage:hits.reduce((n,h)=>n+h.damage,0),gravityBeat:beat,effectCells:beat.cells,visualVersion:2,tick,
        weaponTimeline:Gravity.timeline({cells:beat.cells},skill,hits,{uid,beat,automatic:true})};
      events=[...events,{id:obj.id+':'+tick,uid,tick,result:cast,beforeEnemies:previous.filter(e=>hitIds.has(e.id)).map(visualEnemy)}].slice(-MAX_EVENTS);
      const before={...room,battleAppliedTick:tick,enemies:previous,members,dungeonProgress:progress,manualExp,bossEncounter:encounter};
      progress=Objectives.combatProgress(before,next,uid);
      const mastery=ManualProgress.recordKills(before,{enemies:next,result:cast},uid,'gravity-core');
      if(mastery)manualExp=mastery.ledger;
      if(encounter?.status==='fighting'&&previous.some(e=>e.kind==='boss')&&!next.some(e=>e.kind==='boss')){
        encounter={...encounter,status:'defeated',defeatedByUid:uid,defeatedAtTick:tick};
        state=Objects.finish(state);break;
      }
    }
    return next;
  }
  function patch(){
    if(!changed)return {};
    return {weaponObjects:state,gravityEvents:events,
      ...(progress!==room.dungeonProgress?{dungeonProgress:progress}:{}),
      ...(encounter!==room.bossEncounter?{bossEncounter:encounter}:{}),
      ...(manualExp!==room.manualExp?{manualExp,manualProgressSession:room.manualProgressSession||room.assembledAtMs}:{})};
  }
  return {beforeTick,patch};
}
module.exports={PULSE_TICKS,MAX_EVENTS,create};

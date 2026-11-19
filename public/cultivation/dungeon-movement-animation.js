// Presentation only: interpolate server-confirmed dungeon movement using
// the very same QATacticalAnimation.sample() used by 問道試煉.
// Never send interpolated coordinates to Firestore or game-rule methods.
const point=p=>Number.isSafeInteger(p?.x)&&Number.isSafeInteger(p?.y);
const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
const copy=p=>({x:p.x,y:p.y});
const step=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)===1;
const onMap=(map,p)=>point(p)&&p.x>=0&&p.y>=0&&
  p.x<map?.width&&p.y<map?.height&&map.tiles?.[p.y*map.width+p.x]>0;
const clamp=n=>Math.max(0,Math.min(1,n));
function routeFor(oldMember,newMember,map){
  const from=oldMember?.position,to=newMember?.position;
  if(!onMap(map,from)||!onMap(map,to)||same(from,to))return null;
  const oldSeq=Number.isSafeInteger(oldMember.moveSeq)?oldMember.moveSeq:0;
  const newSeq=Number.isSafeInteger(newMember.moveSeq)?newMember.moveSeq:0;
  if(newSeq<=oldSeq)return null;
  const route=newMember.lastRoute;
  if(typeof route?.key==='string'&&route.step===oldSeq+1){
    const vectors=route.key.split(';');
    if(vectors.length>=2&&vectors.length<=48&&
        newSeq===oldSeq+vectors.length){
      const path=[copy(from)];
      for(const vector of vectors){
        if(!/^-?[01],-?[01]$/.test(vector))return null;
        const [dx,dy]=vector.split(',').map(Number);
        if(Math.abs(dx)+Math.abs(dy)!==1)return null;
        const last=path[path.length-1],next={x:last.x+dx,y:last.y+dy};
        if(!onMap(map,next))return null;
        path.push(next);
      }
      if(same(path[path.length-1],to))return path;
    }
  }
  const move=newMember.lastMove;
  if(newSeq===oldSeq+1&&move?.step===newSeq&&
      Math.abs(move.dx)+Math.abs(move.dy)===1&&
      from.x+move.dx===to.x&&from.y+move.dy===to.y)
    return [copy(from),copy(to)];
  return null; // Missed revisions: snap instead of inventing a route through walls.
}
const travel=(key,path,style='walk',bot=false)=>{
  // Trial timing and easing are provided by the trial's shared sampler.
  const duration=style==='dash'||style==='push'?300:
    style==='throw'?420:Math.min(800,180+(path.length-1)*105);
  const uid=key;
  return {key,scene:{kind:'move',style,actor:uid,visualVersion:1,
    before:[{uid,x:path[0].x,y:path[0].y,bot,hp:100,shield:0}],
    after:[{uid,x:path.at(-1).x,y:path.at(-1).y,bot,hp:100,shield:0}],
    moves:[{uid,path}],numbers:[],duration}};
};
export function dungeonMovementEvents(previous,next,map){
  if(!previous||!next||previous.id!==next.id||!map||
    previous.status!=='assembled'||next.status!=='assembled'||
    previous.dungeonArena!==next.dungeonArena||
    previous.assembledAtMs!==next.assembledAtMs)return [];
  const events=[];
  for(const [uid,member] of Object.entries(next.members||{})){
    const old=previous.members?.[uid];
    if(!old)continue;
    const route=routeFor(old,member,map);
    if(route){events.push(travel('member:'+uid,route));continue;}
    // Server-approved dash/fist advance must move the actual sprite as
    // well as its already shared sword/fist VFX.
    const cast=member.lastSkill;
    if(point(old.position)&&point(member.position)&&
        onMap(map,old.position)&&onMap(map,member.position)&&
        !same(old.position,member.position)&&
        cast?.visualVersion===1&&Number.isSafeInteger(cast.seq)&&
        cast.seq>(Number(old.lastSkill?.seq)||0)&&
        same(cast.position,member.position))
      events.push(travel('member:'+uid,[copy(old.position),copy(member.position)],'dash'));
  }
  const oldEnemies=new Map((previous.enemies||[]).map(e=>[e.id,e]));
  const casts=Object.values(next.members||{}).flatMap(member=>{
    const old=previous.members?.[member.uid],cast=member.lastSkill;
    return cast?.visualVersion===1&&Number.isSafeInteger(cast.seq)&&
      cast.seq>(Number(old?.lastSkill?.seq)||0)&&
      Array.isArray(cast.visualMoves)?cast.visualMoves:[];
  });
  const advanced=(Number(next.battleAppliedTick)||0)>(Number(previous.battleAppliedTick)||0);
  for(const enemy of next.enemies||[]){
    if(enemy.kind==='boss')continue;
    const old=oldEnemies.get(enemy.id);
    if(!old||!onMap(map,old.position)||!onMap(map,enemy.position)||
        same(old.position,enemy.position))continue;
    const pushed=casts.find(m=>m.enemyId===enemy.id&&
      same(m.from,old.position)&&same(m.to,enemy.position));
    if(pushed){
      events.push(travel('enemy:'+enemy.id,
        [copy(old.position),copy(enemy.position)],'push',true));
    }else if(advanced&&step(old.position,enemy.position)){
      events.push(travel('enemy:'+enemy.id,
        [copy(old.position),copy(enemy.position)],'walk',true));
    }
  }
  return events;
}
export function sampleDungeonMovement(entry,now,shared=globalThis.QATacticalAnimation){
  const scene=entry?.scene;
  if(!scene)return null;
  const progress=clamp((now-entry.startedAt)/Math.max(1,scene.duration));
  const actor=shared?.sample?.(scene,progress)?.[0];
  if(!actor||!Number.isFinite(actor.x)||!Number.isFinite(actor.y))return null;
  return {position:{x:actor.x,y:actor.y},
    lift:Number.isFinite(actor.lift)?actor.lift:0,active:progress<1};
}
export function continueDungeonMovement(event,prior,now,shared=globalThis.QATacticalAnimation){
  const before=sampleDungeonMovement(prior,now,shared);
  if(!before?.active)return event;
  const path=[copy(before.position),...event.scene.moves[0].path.map(copy)];
  return travel(event.key,path,event.scene.style,event.scene.before[0].bot);
}

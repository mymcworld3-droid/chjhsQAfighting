'use strict';

// Firestore C snapshot listeners deliver the same authoritative room state to
// every authenticated co-op player, regardless of which Render instance served
// their HTTP request. No in-process room cache or player rewards live here.
const KEEPALIVE_MS=15000;
const STREAM_TTL_MS=4*60*1000;
const MAX_PENDING_BYTES=1024*1024;

function streamDungeonRoom({
  req,res,ref,uid,initialRoom,project,isActive,clock=()=>Date.now(),logger=console
}){
  if(req.aborted||res.destroyed||res.writableEnded)return;
  let stopped=false,unsubscribe=null,keepalive=null,renew=null;
  let lastRevision=-1,latestRoom=initialRoom;
  const stop=()=>{
    if(stopped)return;
    stopped=true;
    unsubscribe?.();
    clearInterval(keepalive);
    clearTimeout(renew);
    if(!res.writableEnded)res.end();
  };
  const send=packet=>{
    if(stopped||res.destroyed||res.writableEnded)return;
    if((res.writableLength||0)>MAX_PENDING_BYTES){stop();return;}
    res.write('data: '+JSON.stringify(packet)+'\n\n');
  };
  const fail=(status,error)=>{
    send({error,status});
    stop();
  };
  const deliver=room=>{
    if(stopped)return;
    if(!room||!room.members?.[uid])return fail(403,'你已離開合作副本隊伍');
    if(!isActive(room))return fail(410,'合作副本隊伍已關閉或過期');
    const revision=Number(room.revision)||0;
    if(revision<=lastRevision)return;
    lastRevision=revision;latestRoom=room;
    send({room:project(ref.id,room,clock())});
  };
  res.set?.({
    'Content-Type':'text/event-stream; charset=utf-8',
    'Cache-Control':'no-cache, no-transform',
    'X-Accel-Buffering':'no'
  });
  res.flushHeaders?.();
  res.write(': connected\n\n');
  res.on('close',stop);
  req.on('aborted',stop);
  deliver(initialRoom);
  if(stopped)return;
  const failure=error=>{
    logger.error('[Dungeon stream]',error?.message||error);
    fail(503,'合作副本即時連線中斷');
  };
  try{
    unsubscribe=ref.onSnapshot(snap=>{
      if(!snap.exists)return fail(404,'合作副本房間不存在');
      deliver(snap.data());
    },failure);
  }catch(error){failure(error);return;}
  if(stopped){unsubscribe?.();return;}
  keepalive=setInterval(()=>{
    if(!isActive(latestRoom))return fail(410,'合作副本隊伍已過期');
    if((res.writableLength||0)>MAX_PENDING_BYTES)return stop();
    res.write(': keepalive\n\n');
  },KEEPALIVE_MS);
  // The next connection reauthenticates against Firebase A with a fresh token.
  renew=setTimeout(stop,STREAM_TTL_MS);
  keepalive.unref?.();
  renew.unref?.();
}
module.exports={streamDungeonRoom};
module.exports.__test={KEEPALIVE_MS,STREAM_TTL_MS,MAX_PENDING_BYTES};

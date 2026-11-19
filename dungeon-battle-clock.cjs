'use strict';

// Dungeon battle clock v1. Server time is the sole source of tick truth.
// Writes only materialize a cursor for future autonomous AI; no client may
// supply a tick, elapsed duration, start instant, or pause flag.
const CLOCK_VERSION=1;
const TICK_MS=1000;
const MAX_CLOCK_MS=24*60*60*1000; // protective bound; room TTL is shorter
const safeTime=value=>Number.isSafeInteger(value)&&value>0?value:0;
const asTick=value=>Number.isSafeInteger(value)&&value>=0?value:0;
const isRunning=room=>room?.status==='assembled'&&room?.mode==='dungeon';
function epoch(room){
  // Rooms created before stage 8 can rejoin a clock anchored at their
  // server-persisted assembly timestamp, with no data migration.
  return safeTime(room?.battleStartedAtMs)||safeTime(room?.assembledAtMs);
}
function elapsed(room,now){
  const start=epoch(room);
  if(!isRunning(room)||!start)return 0;
  return Math.max(0,Math.min(MAX_CLOCK_MS,safeTime(now)-start));
}
function dueTick(room,now){
  return Math.floor(elapsed(room,now)/TICK_MS);
}
function projectClock(room,now){
  if(!isRunning(room))return null;
  const start=epoch(room),passed=elapsed(room,now);
  if(!start)return null;
  const stored=asTick(room.battleAppliedTick);
  return {
    version:CLOCK_VERSION,startedAtMs:start,tickMs:TICK_MS,
    serverNowMs:safeTime(now),elapsedMs:passed,
    tick:Math.max(stored,Math.floor(passed/TICK_MS)),
    appliedTick:stored,nextTickAtMs:start+(Math.max(stored,Math.floor(passed/TICK_MS))+1)*TICK_MS
  };
}
function initialClock(now){
  const startedAtMs=safeTime(now);
  if(!startedAtMs)throw new RangeError('invalid server clock');
  return {battleClockVersion:CLOCK_VERSION,battleStartedAtMs:startedAtMs,
    battleAppliedTick:0,battleAppliedAtMs:startedAtMs};
}
function advanceClock(room,now){
  const tick=dueTick(room,now);
  const current=asTick(room?.battleAppliedTick);
  // Advance is idempotent, including when multiple Render servers attempt
  // the same tick. A Firestore transaction handles the compare-and-write.
  if(!isRunning(room)||tick<=current)return null;
  return {battleAppliedTick:tick,battleAppliedAtMs:safeTime(now)};
}
module.exports={CLOCK_VERSION,TICK_MS,MAX_CLOCK_MS,epoch,elapsed,dueTick,
  projectClock,initialClock,advanceClock,isRunning};

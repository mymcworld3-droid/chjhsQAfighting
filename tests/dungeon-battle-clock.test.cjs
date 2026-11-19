'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const clock=require('../dungeon-battle-clock.cjs');
const START=1800000000000;
const assembled={mode:'dungeon',status:'assembled',assembledAtMs:START,
  ...clock.initialClock(START),battleClockVersion:1};

test('battle clock starts at assembly server epoch and never trusts client time',()=>{
  assert.equal(clock.TICK_MS,1000);
  assert.deepStrictEqual(clock.initialClock(START),{
    battleClockVersion:1,battleStartedAtMs:START,
    battleAppliedTick:0,battleAppliedAtMs:START
  });
  assert.throws(()=>clock.initialClock(-7),RangeError);
  assert.throws(()=>clock.initialClock('2026-01-01'),RangeError);
  assert.equal(clock.projectClock(assembled,START).tick,0);
  assert.equal(clock.projectClock(assembled,START).elapsedMs,0);
  assert.equal(clock.projectClock(assembled,START+999).tick,0);
  assert.equal(clock.projectClock(assembled,START+1000).tick,1);
  assert.equal(clock.projectClock(assembled,START+12345).tick,12);
});
test('server clock advances from elapsed wall time regardless of inactivity or question state',()=>{
  const after=START+27005;
  assert.equal(clock.elapsed(assembled,after),27005);
  assert.equal(clock.dueTick(assembled,after),27);
  assert.deepStrictEqual(clock.advanceClock(assembled,after),{
    battleAppliedTick:27,battleAppliedAtMs:after
  });
  const updated={...assembled,...clock.advanceClock(assembled,after)};
  assert.equal(clock.advanceClock(updated,after),null);
  assert.equal(clock.advanceClock(updated,after-3000),null);
  assert.equal(clock.projectClock(updated,after-3000).tick,27);
  assert.equal(clock.advanceClock(updated,after+3000).battleAppliedTick,30);
});
test('old assembled rooms regenerate the clock from existing assembledAtMs',()=>{
  const legacy={mode:'dungeon',status:'assembled',assembledAtMs:START};
  assert.equal(clock.epoch(legacy),START);
  assert.equal(clock.dueTick(legacy,START+5511),5);
  assert.equal(clock.projectClock(legacy,START+5511).startedAtMs,START);
  assert.equal(clock.projectClock(legacy,START+5511).tick,5);
  assert.equal(clock.advanceClock(legacy,START+5511).battleAppliedTick,5);
});
test('unassembled/closed rooms cannot tick or leak an active clock',()=>{
  for(const status of ['waiting','closed','invalid']){
    const room={...assembled,status};
    assert.equal(clock.projectClock(room,START+10000),null);
    assert.equal(clock.advanceClock(room,START+10000),null);
    assert.equal(clock.dueTick(room,START+10000),0);
  }
  assert.equal(clock.projectClock({...assembled,mode:'other'},START),null);
  assert.equal(clock.projectClock({mode:'dungeon',status:'assembled'},START),null);
});
test('negative drift, large server time, corrupted tick cursors cannot rewind time',()=>{
  assert.equal(clock.elapsed(assembled,START-10000),0);
  assert.equal(clock.dueTick(assembled,START-10000),0);
  assert.equal(clock.elapsed(assembled,START+2*clock.MAX_CLOCK_MS),
    clock.MAX_CLOCK_MS);
  const room={...assembled,battleAppliedTick:500};
  assert.equal(clock.advanceClock(room,START+250000),null);
  const projected=clock.projectClock(room,START+250000);
  assert.equal(projected.tick,500);
  assert.equal(projected.appliedTick,500);
  assert.equal(projected.nextTickAtMs,START+501000);
  assert.equal(clock.advanceClock({...assembled,battleAppliedTick:-1},START+3000).battleAppliedTick,3);
});
test('the immutable clock projection does not modify room/member resources',()=>{
  const room={...assembled,members:{a:{position:{x:4,y:7},explorationStamina:19,
    moveSeq:10}},battleAppliedTick:13};
  const before=structuredClone(room);
  for(let i=0;i<1000;i++){
    const now=START+i*1000;
    clock.projectClock(room,now);
    clock.advanceClock(room,now);
  }
  assert.deepStrictEqual(room,before);
});

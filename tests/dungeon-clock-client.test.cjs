'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,
  '../public/cultivation/dungeon-map-view.js'),'utf8')
  .replace(/^import .*$/gm,'').replace(/^export /gm,'');
let perfNow=400;
const Viewer=new Function('performance','Camera',
  source+'\nreturn DungeonMapView;')({
  now:()=>perfNow
},{initialCamera:()=>({zoom:1,panX:0,panY:0})});
function setup(start=1800000000000){
  const viewer=new Viewer(),output={textContent:'',title:''};
  viewer.$=selector=>selector==='[data-dm-clock]'?output:null;
  viewer.room={status:'assembled',expiresAtMs:start+2*3600*1000,
    battleClock:{version:1,startedAtMs:start,serverNowMs:start+5000,
      elapsedMs:5000,tick:5,appliedTick:4,tickMs:1000}};
  return {viewer,output};
}
test('view displays server elapsed time, not browser wall-clock or a forged local start',()=>{
  perfNow=400;
  const {viewer,output}=setup();
  viewer.syncClockAnchor(viewer.room);
  assert.equal(output.textContent,'戰場時鐘 00:05 · T5');
  assert.match(output.title,/伺服器時間校準/);
  assert.equal(viewer.clockAnchor.startedAtMs,1800000000000);
});
test('idle display advances across tab throttling and gaps without changing room data',()=>{
  perfNow=1000;
  const {viewer,output}=setup();
  const before=structuredClone(viewer.room);
  viewer.syncClockAnchor(viewer.room);
  perfNow+=61500;
  viewer.renderClock();
  assert.equal(output.textContent,'戰場時鐘 01:06 · T66');
  assert.deepStrictEqual(viewer.room,before);
});
test('late SSE corrections cannot display an earlier tick or earlier elapsed second',()=>{
  perfNow=1000;
  const {viewer,output}=setup();
  viewer.syncClockAnchor(viewer.room);
  perfNow+=2500;
  viewer.renderClock();
  assert.equal(output.textContent,'戰場時鐘 00:07 · T7');
  viewer.syncClockAnchor({...viewer.room,battleClock:{
    ...viewer.room.battleClock,elapsedMs:6400,tick:6
  }});
  assert.equal(output.textContent,'戰場時鐘 00:07 · T7');
  perfNow+=1050;viewer.renderClock();
  assert.match(output.textContent,/T7/);
});
test('cancelling assembly clears HUD and a new server epoch restarts display',()=>{
  perfNow=1000;
  const {viewer,output}=setup();
  viewer.syncClockAnchor(viewer.room);
  perfNow+=88000;viewer.renderClock();
  assert.match(output.textContent,/T93/);
  viewer.room={...viewer.room,status:'waiting',battleClock:null};
  viewer.syncClockAnchor(viewer.room);
  assert.equal(output.textContent,'等待集結');
  assert.equal(viewer.clockAnchor,null);
  const newEpoch=1800000500000;
  viewer.room={status:'assembled',expiresAtMs:newEpoch+7200000,
    battleClock:{version:1,startedAtMs:newEpoch,tickMs:1000,
      serverNowMs:newEpoch,elapsedMs:0,tick:0,appliedTick:0}};
  viewer.syncClockAnchor(viewer.room);
  assert.equal(output.textContent,'戰場時鐘 00:00 · T0');
});
test('client clock is presentation-only and does not call combat mutations',()=>{
  assert.match(source,/performance\.now\(\)/);
  assert.match(source,/clearInterval\(this\.clockTimer\)/);
  assert.match(source,/this\.syncClockAnchor\(room\)/);
  assert.match(source,/data-dm-clock/);
  assert.match(source,/receivedAt:performance\.now\(\)/);
  assert.match(source,/performance\.now\(\)-clock\.receivedAt/);
  // Wall-clock input suppresses wheel clicks, not the server-anchored clock.
  assert.doesNotMatch(source.slice(source.indexOf('  syncClockAnchor(room){'),source.indexOf('  renderClock(){')+700),/Date\.now\(\)/);
  assert.doesNotMatch(source,/battleAppliedTick\s*=/);
});

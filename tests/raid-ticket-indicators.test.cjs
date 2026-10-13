const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Rules = require('../public/cultivation/training-access-rules.js');
const read=name=>fs.readFileSync(path.join(__dirname,'../public/cultivation',name),'utf8');
const roomSource=read('raid-room.js').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');

function ticketRuntime(player = {uid:'a',stats:{totalScore:10}}) {
  let current=player, response={ticketState:{count:1,lastGrantDate:'2026-10-13'}}, stream;
  const events=[],requests=[];
  const context={CustomEvent:class {constructor(type,init){this.type=type;this.detail=init?.detail;}},console,
    localStorage:{setItem(){},removeItem(){}},setInterval,clearInterval,
    window:{getCurrentUserData:()=>current,dispatchEvent:event=>events.push(event)},
    raidRepository:{request:async action=>{requests.push(action);return typeof response==='function' ? response(action) : response;},
      subscribeRoom:(_id,next)=>{stream=next;return()=>{};}}};
  vm.runInNewContext(roomSource+'\nthis.operations={getRaidTicketState,startRaidRoom,subscribeRaidRoom};',context);
  return {api:context.operations,events,requests,current:()=>current,
    setResponse:value=>{response=value;},switchPlayer:value=>{current=value;},emit:value=>stream(value)};
}

test('ticket status and start responses mirror available tickets and publish changes once',async()=>{
  const f=ticketRuntime();await f.api.getRaidTicketState();
  assert.equal(f.current().raidTickets.count,1);assert.equal(f.events.length,1);
  assert.equal(f.events[0].type,'xiuxian:raid-tickets-updated');
  await f.api.getRaidTicketState();assert.equal(f.events.length,1,'same balance does not churn the indicators');
  f.setResponse({ticketState:{count:0,lastGrantDate:'2026-10-13'}});await f.api.startRaidRoom('room12345');
  assert.equal(f.current().raidTickets.count,0);assert.equal(f.events.length,2);
  f.setResponse({ticketState:{count:3,lastGrantDate:'2026-10-14'}});await f.api.getRaidTicketState();
  assert.equal(f.current().raidTickets.count,3,'the next daily grant restores the reminder');
});

test('an older in-flight status response cannot restore a ticket already consumed by start',async()=>{
  const f=ticketRuntime();let release;
  f.setResponse(action=>action==='ticket-status' ? new Promise(resolve=>{release=resolve;}) :
    {ticketState:{count:0,lastGrantDate:'2026-10-13'}});
  const old=f.api.getRaidTicketState();await f.api.startRaidRoom('room12345');
  release({ticketState:{count:1,lastGrantDate:'2026-10-13'}});await old;
  assert.equal(f.current().raidTickets.count,0);assert.equal(f.events.length,1);
});

test('a response from the previous account cannot alter ticket state after account switching',async()=>{
  const first={uid:'a',stats:{totalScore:10}},second={uid:'b',stats:{totalScore:10},raidTickets:{count:0}};
  const f=ticketRuntime(first);let release;
  f.setResponse(()=>new Promise(resolve=>{release=resolve;}));
  const pending=f.api.getRaidTicketState();f.switchPlayer(second);
  release({ticketState:{count:3,lastGrantDate:'2026-10-13'}});await pending;
  assert.equal(first.raidTickets,undefined);assert.equal(second.raidTickets.count,0);assert.equal(f.events.length,0);
});

test('a team member refreshes spent tickets once when a room push announces the reservation',async()=>{
  const f=ticketRuntime();f.setResponse({ticketState:{count:0,lastGrantDate:'2026-10-13'}});
  const stop=f.api.subscribeRaidRoom('room12345',()=>{},()=>{},{room:{id:'room12345',revision:1,status:'waiting'}});
  f.emit({room:{id:'room12345',revision:2,status:'active',ticketMemberUids:['a','b']}});
  f.emit({room:{id:'room12345',revision:3,status:'active',ticketMemberUids:['a','b']}});
  for(let i=0;i<5;i++)await Promise.resolve();
  assert.deepEqual(f.requests,['ticket-status']);assert.equal(f.current().raidTickets.count,0);
  stop();
});

test('both indicators require an authenticated unlocked realm and at least one ticket',()=>{
  const source=read('training-scene-map.js');
  const start=source.indexOf('function updateTicketIndicators()'),end=source.indexOf('\nfunction fit()',start);
  let uid='a',player={uid,stats:{totalScore:9},raidTickets:{count:3}};
  const makeHost=()=>({dot:null,querySelector(){return this.dot;},appendChild(dot){this.dot=dot;}});
  const hostA=makeHost(),hostB=makeHost();
  const button=host=>({querySelector:()=>host,setAttribute(){},removeAttribute(){}});
  const nav=button(hostA),building=button(hostB);
  const context={Rules,getMainUser:()=>uid ? {uid} : null,
    unlocked:place=>Rules.allows(player,place.threshold),
    plane:{querySelector:()=>building},document:{getElementById:()=>nav,createElement:()=>({setAttribute(){}})},
    window:{getCurrentUserData:()=>player}};
  vm.runInNewContext(source.slice(start,end)+'\nthis.update=updateTicketIndicators;',context);
  const check=visible=>{context.update();assert.equal(hostA.dot.hidden,!visible);assert.equal(hostB.dot.hidden,!visible);};
  check(false);player.stats.totalScore=10;check(true);
  player.raidTickets.count=0;check(false);player.raidTickets.count=1;check(true);
  player.trainingAccess=Rules.record(player);player.stats.totalScore=0;check(true);
  uid='b';check(false);uid=null;check(false);
});

test('daily ticket refresh runs at Taiwan midnight and waits for visibility when the page is hidden',()=>{
  const source=read('raid-mode.js'),start=source.indexOf('  function scheduleRaidTicketDay()'),end=source.indexOf('  function data()',start);
  let time=Date.parse('2026-10-13T15:59:59Z');
  const timers=[],requests=[],document={hidden:false};
  const context={ticketDayTimer:null,now:()=>time,document,clearTimeout(){},
    setTimeout(callback,delay){timers.push({callback,delay});return timers.length;},
    refreshRaidTickets:options=>requests.push(options)};
  vm.runInNewContext(source.slice(start,end)+'\nscheduleRaidTicketDay();',context);
  assert.equal(timers[0].delay,1100,'Taiwan midnight is 16:00 UTC');
  time+=1100;timers[0].callback();
  assert.equal(requests.length,1);assert.equal(requests[0].rerender,false);
  assert.equal(timers[1].delay,86400000);
  document.hidden=true;time+=86400000;timers[1].callback();
  assert.equal(requests.length,1,'a hidden tab does not perform a daily network request');
  assert.equal(timers.length,3,'the next midnight remains scheduled');
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/cultivation/daily-meditation.js'),'utf8').replace(/^import .*;\n/gm,'');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function runtime() {
  let date='2026-10-17',time=100000,actor='a',opened=false;
  const events=new Map(),calls=[],feedback=[];
  const player={uid:'a',stats:{},friends:[]};
  const status=()=>({ok:true,date,completed:false,record:{},stars:0,milestones:[]});
  let respond=async()=>status();
  const context={console:{info(){}},AbortController,setTimeout,clearTimeout,setInterval(){},
    Date:class extends Date{static now(){return time;}},navigator:{onLine:true},
    QADailyMeditationRules:{meditationDateKey:()=>date},QANascentGrowth:{},
    QAMeditationRewardFeedback:{show:options=>feedback.push(options),clear(){}},
    getMainUser:()=>actor?{uid:actor}:null,
    authenticatedMainFetch:async(url)=>{calls.push(url);return{ok:true,json:async()=>respond(url)};},
    document:{hidden:false,getElementById:id=>id==='daily-meditation-overlay'&&opened?{remove(){opened=false;}}:null,
      addEventListener:(name,fn)=>events.set(name,fn)},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
    window:{dispatchEvent(){},getCurrentUserData:()=>player,addEventListener:(name,fn)=>events.set(name,fn)}};
  const expose='window.audit={refresh,poll,foreground,reconcile,claim,finish,setState:value=>{state=value;},state:()=>state,setSession:value=>{session=value;},mutate:()=>{statusSequence++;}};';
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,expose+'\n})();'),context);
  return{...context.window.audit,calls,feedback,events,player,status,
    advance:ms=>{time+=ms;},date:value=>{date=value;},actor:value=>{actor=value;player.uid=value;},
    opened:value=>{opened=value;},respond:fn=>{respond=fn;}};
}

test('concurrent startup events share one status read and passive events reuse the sixty-second cache',async()=>{
  const f=runtime();let release;
  f.respond(()=>new Promise(resolve=>{release=resolve;}));
  f.events.get('xiuxian:user-data-ready')();f.events.get('xiuxian:user-ready')();f.foreground();
  await flush();assert.equal(f.calls.length,1);
  release(f.status());await flush();
  for(let i=0;i<10;i++)await f.refresh();
  f.foreground();await flush();assert.equal(f.calls.length,1);
  f.respond(async()=>f.status());await f.refresh({force:true});assert.equal(f.calls.length,2);
  f.date('2026-10-18');await f.refresh();assert.equal(f.calls.length,3,'midnight bypasses yesterday\'s cache');
});

test('answering a current question performs no passive status reads even when the panel is open',async()=>{
  const f=runtime();await f.refresh();f.opened(true);f.setSession({date:'2026-10-17'});
  f.advance(20*60*1000);
  for(let i=0;i<10;i++){f.foreground();f.poll();}
  await flush();assert.equal(f.calls.length,1);
  f.setSession(null);f.poll();await flush();assert.equal(f.calls.length,2,'dashboard polling resumes after answering ends');
});

test('closed-panel friend checks wait five minutes and do not read when the player has no friends',async()=>{
  const f=runtime();f.respond(async()=>({...f.status(),completed:true,stars:3,record:{lastDate:'2026-10-17'}}));
  await f.refresh();f.advance(60*60*1000);f.poll();f.foreground();await flush();assert.equal(f.calls.length,1);
  f.player.friends=['b'];f.poll();await flush();assert.equal(f.calls.length,2);
  f.advance(60000);f.foreground();await flush();assert.equal(f.calls.length,2);
  f.advance(240000);f.poll();await flush();assert.equal(f.calls.length,3);
});

test('a mutation or account switch prevents old pending status replies from replacing new state',async()=>{
  const f=runtime();let release;
  f.respond(()=>new Promise(resolve=>{release=resolve;}));
  const old=f.refresh();await flush();f.mutate();
  f.respond(async()=>({...f.status(),stars:6}));await f.refresh({force:true});
  release({...f.status(),stars:0});await old;assert.equal(f.state().stars,6);
  f.respond(()=>new Promise(resolve=>{release=resolve;}));const previousAccount=f.refresh({force:true});await flush();
  f.actor('b');f.reconcile();f.respond(async()=>({...f.status(),stars:9}));await f.refresh();
  release({...f.status(),stars:1});await assert.rejects(previousAccount,/帳號已切換/);assert.equal(f.state().stars,9);
});


test('only a newly awarded milestone shows its authoritative reward receipt',async()=>{
  const f=runtime();f.setState(f.status());
  f.respond(async()=>({...f.status(),claimedNow:true,reward:{gold:90,raidTickets:0,drawTickets:1,convertedRaidGold:60},economy:{gold:100,score:28,drawTickets:1}}));
  await f.claim(15);
  assert.equal(f.feedback.length,1);assert.equal(f.feedback[0].receiptId,'coop:2026-10-17:15');
  assert.equal(f.feedback[0].reward.gold,90);assert.equal(f.feedback[0].reward.raidTickets,0);
  assert.match(f.feedback[0].note,/60 靈石/);assert.equal(f.player.stats.gold,100);
  f.respond(async()=>({...f.status(),claimedNow:false,economy:{gold:100,score:28,drawTickets:1}}));
  await f.claim(15);assert.equal(f.feedback.length,1,'repeat claims do not celebrate another grant');
});

test('a failed milestone claim cannot show a success receipt',async()=>{
  const f=runtime();f.setState(f.status());
  f.respond(async()=>({ok:false,error:'領取未完成'}));await f.claim(3);
  assert.equal(f.feedback.length,0);
});

test('a committed personal reward is shown even when the following status refresh fails',async()=>{
  const f=runtime();f.setState(f.status());
  f.respond(async url=>url.endsWith('/finish')?{ok:true,record:{lastDate:'2026-10-17',streak:3,lastResult:{gold:45,cultivation:4,fragments:3,stars:3}},economy:{gold:145,score:32,drawTickets:0}}:{ok:false,error:'排行暫時離線'});
  await f.finish();assert.equal(f.feedback.length,1);
  assert.equal(f.feedback[0].receiptId,'personal:2026-10-17');
  assert.equal(f.feedback[0].reward.cultivation,4);assert.equal(f.player.stats.gold,145);
});

test('an account change cannot reveal a previous players pending reward',async()=>{
  const f=runtime();f.setState(f.status());let release;
  f.respond(()=>new Promise(resolve=>{release=resolve;}));const pending=f.claim(3);await flush();
  f.actor('b');f.reconcile();release({...f.status(),claimedNow:true,reward:{gold:30}});await pending;
  assert.equal(f.feedback.length,0);
});

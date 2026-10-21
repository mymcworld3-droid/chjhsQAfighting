const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/raid-mode.js'), 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const room = () => ({status:'active',bossHp:900,bossMaxHp:1000,bossBaseAttack:100,bossActionCount:0,members:{me:{uid:'me',hp:100,alive:true}}});

function snapshotHarness(status, view = 'question') {
  const calls = {begin:0,arena:0,finish:0,labels:0};
  const context = {
    PAGE_ID:'page-raid',
    state:{status,room:room(),player:{uid:'me',hp:100},boss:{hp:1000,maxHp:1000},bossStartedAtMs:1,lastBossActionSeen:0},
    document:{getElementById:id=>id === 'page-raid' ? {dataset:{raidView:view}} : null},
    shenPhaseForHp:()=>1,myRoomMember:()=>context.state.room.members.me,
    beginActiveRaid:()=>calls.begin++,renderArena:()=>calls.arena++,finishRaid:()=>calls.finish++,
    updateLiveLabels:()=>calls.labels++,applyRemoteBossAction(){},toast(){},resetRaid(){},renderHub(){},stopTick(){},renderLobby(){}
  };
  vm.runInNewContext(section('  function handleRoomSnapshot(', '  async function claimRaidReward(')+'\nthis.snapshot=handleRoomSnapshot;',context);
  return {context,calls,snapshot:context.snapshot};
}

test('ordinary room snapshots preserve the current question, review and submitting state', () => {
  for (const status of ['question','review','submitting']) {
    const h = snapshotHarness(status);
    for (let i=0;i<5;i++) h.snapshot({...room(),heartbeatAtMs:i});
    assert.equal(h.context.state.status,status);
    assert.equal(h.calls.begin,0,'an active room does not restart the raid on every poll');
    assert.equal(h.calls.arena,0,'room synchronization cannot replace the visible question');
    assert.equal(h.calls.labels,5);
  }
});

test('terminal snapshots wait for an in-flight answer or queued attack before showing results', () => {
  const submitting = snapshotHarness('submitting');
  submitting.snapshot({...room(),status:'won'});
  assert.equal(submitting.calls.finish,0);
  assert.equal(submitting.context.state.pendingFinishRoom.status,'won');
  const queued = snapshotHarness('review');
  queued.context.state.battleSceneTail = Promise.resolve();
  queued.snapshot({...room(),status:'lost'});
  assert.equal(queued.calls.finish,0);
  assert.equal(queued.context.state.pendingFinishRoom.status,'lost');
});

test('an existing arena updates labels without rebuilding its stage or rebinding controls', () => {
  let replacements=0,updates=0;
  const stage={};
  const arena={querySelector:selector=>selector==='.raid-stage'?stage:null,set innerHTML(value){replacements++;}};
  const context={state:{player:{hp:100},boss:{hp:900},room:room()},document:{body:{classList:{add(){}}},getElementById:()=>arena},
    show(){},syncRaidBottomClearance(){},currentBossClock:()=>null,currentIntent:()=>({}),updateLiveLabels:()=>updates++,renderHub(){}};
  vm.runInNewContext(section('  function renderArena(', '  function wait(')+'\nthis.render=renderArena;',context);
  context.render();context.render({transition:false});
  assert.equal(replacements,0);
  assert.equal(updates,2);
  assert.equal(arena.querySelector('.raid-stage'),stage);
});

test('submitting and returning from a Boss animation retain the question DOM, math and scroll position', () => {
  let replacements=0,typesets=0;
  const q={id:'q',opts:['A','B','C','D']};
  const buttons=Array.from({length:4},()=>({disabled:false}));
  const view={raidQuestion:q,dataset:{review:'false'},scrollTop:150,querySelectorAll:()=>buttons,set innerHTML(value){replacements++;}};
  const context={state:{question:q,status:'submitting',player:{hp:100}},document:{body:{classList:{add(){}}},getElementById:()=>view},
    show(){},syncRaidBottomClearance(){},updateLiveLabels(){},typeset:()=>typesets++};
  vm.runInNewContext(section('  function renderQuestion(', '  async function answer(')+'\nthis.render=renderQuestion;',context);
  context.render(false);
  assert.equal(buttons.every(b=>b.disabled),true);
  context.state.status='question';
  context.render(false);
  assert.equal(buttons.every(b=>!b.disabled),true);
  assert.equal(replacements,0);
  assert.equal(typesets,0);
  assert.equal(view.scrollTop,150);
});

function sceneHarness() {
  const notices=new Set(),waiting=[],restores=[],focus=[];
  let arenaRenders=0;
  const stage={classList:{add(){},remove(){}}};
  const arena={querySelector:selector=>selector==='.raid-stage'?stage:null,appendChild:node=>notices.add(node)};
  const context={now:()=>Date.now(),state:{status:'submitting',roomId:'room',room:room(),player:{hp:100},question:{id:'q'},battleSceneToken:0,battleSceneTail:null},
    document:{getElementById:()=>arena,createElement:()=>({remove(){notices.delete(this);}})},
    setRaidCombatFocus:value=>focus.push(value),renderArena:options=>{assert.equal(options.transition,false);arenaRenders++;},
    wait:()=>new Promise(resolve=>waiting.push(resolve)),escapeHtml:x=>String(x),renderQuestion:value=>restores.push(value),updateLiveLabels(){},finishRaid(){}};
  vm.runInNewContext(section('  async function playBattleScene(', '  async function prefetchQuestion(')+'\nthis.play=playBattleScene;',context);
  return {context,notices,waiting,restores,focus,renders:()=>arenaRenders};
}
test('meteor playback has separate timed HP deductions and sounds without mutating authoritative boss HP',async()=>{
  const h=sceneHarness(),ctx=h.context,hits=[
    {damage:48,beforeHp:3000,afterHp:2952,skill:'元嬰・星隕'},
    {damage:48,beforeHp:2952,afterHp:2904,skill:'元嬰・星隕'},
    {damage:180,beforeHp:2904,afterHp:2724,skill:'三星聚曜'}];
  let clock=0;const hp=[],sounds=[],visuals=[],shakes=[];
  ctx.state.boss={hp:2724,maxHp:3000};ctx.state.status='review';ctx.state.playerActionCount=3;
  ctx.now=()=>clock;ctx.wait=async ms=>{clock+=ms;};
  ctx.updateLiveLabels=()=>hp.push([clock,ctx.state.meteorReplayHp]);
  ctx.createInnateAbilityEffect=(_stage,args)=>{visuals.push([clock,args.kind]);return {dispose(){}};};
  ctx.shakeBattleScreen=(_surface,args)=>shakes.push([clock,args.kind]);
  ctx.QAGameAudio={play:(_sound,args)=>sounds.push([clock,args.key])};
  ctx.document.querySelector=()=>({});
  const arena=ctx.document.getElementById();arena.querySelector('.raid-stage').querySelector=()=>({});
  await ctx.play({attacker:'player',damage:276,meteorHits:hits});
  assert.deepEqual(hp,[[400,2952],[1300,2904],[2200,2724]]);
  assert.equal(sounds.length,3);assert.equal(new Set(sounds.map(x=>x[1])).size,3);
  assert.deepEqual(visuals,[[0,'meteor'],[900,'meteor'],[1800,'meteor']]);
  assert.equal(shakes.length,3);assert.equal(clock,2700);
  assert.equal(ctx.state.boss.hp,2724);assert.equal(ctx.state.meteorReplayHp,null);
});

test('simultaneous Boss and player settlements serialize feedback and restore the latest answer phase', async () => {
  const h=sceneHarness();
  const first=h.context.play({attacker:'boss',damage:50});
  const second=h.context.play({attacker:'player',damage:100});
  await flush();
  assert.equal(h.notices.size,1);
  assert.equal(h.waiting.length,1);
  h.context.state.status='review';
  h.waiting.shift()();await flush();
  assert.equal(h.notices.size,1,'the second notice replaces the completed first notice');
  assert.equal(h.restores.length,0,'question stays behind the battlefield until both attacks finish');
  h.waiting.shift()();await Promise.all([first,second]);
  assert.equal(h.notices.size,0);
  assert.deepEqual(h.restores,[true],'return to review, even though the first attack began while submitting');
  assert.equal(h.context.state.status,'review');
  assert.equal(h.context.state.battleScenePlaying,false);
  assert.equal(h.context.state.battleSceneTail,null);
});

test('leaving a room cancels queued visuals without restoring an old question over the next session', async () => {
  const h=sceneHarness();
  const first=h.context.play({attacker:'boss'}),second=h.context.play({attacker:'player'});
  await flush();
  Object.assign(h.context.state,{battleSceneToken:1,battleSceneTail:null,battleScenePlaying:false,status:'hub'});
  h.waiting.shift()();await Promise.all([first,second]);
  assert.equal(h.notices.size,0);
  assert.equal(h.restores.length,0);
  assert.equal(h.renders(),1,'cancelled second attack is never mounted');
});

test('the raid clock starts once instead of being restarted by each snapshot', () => {
  let starts=0;
  const context={state:{tickTimer:null},setInterval(){return ++starts;},updateLiveLabels(){}};
  vm.runInNewContext(section('  function startTick()', '  function stopTick()')+'\nstartTick();startTick();',context);
  assert.equal(starts,1);
});

test('an answer settling after room exit cannot replace the next session state', async () => {
  let resolve, renders=0;
  const context={state:{room:room(),roomId:'old',player:{hp:100},status:'question',question:{id:'q',ticket:'ticket'},playerActionCount:0,battleSceneToken:1},
    commitRaidPlayerAction:()=>new Promise(done=>{resolve=done;}),now:()=>1,renderQuestion:()=>renders++,updateHomeEntry(){},console};
  vm.runInNewContext(section('  async function answer(', '  async function applyRemoteBossAction(')+'\nthis.answer=answer;',context);
  const answer=context.answer(0);
  Object.assign(context.state,{roomId:'new',battleSceneToken:2,status:'hub'});
  resolve({room:{status:'won'},resolution:{correct:true,damage:100}});
  await answer;
  assert.equal(context.state.status,'hub');
  assert.equal(context.state.roomId,'new');
  assert.equal(renders,1,'only the initial submitting UI was rendered');
});

test('old room question generation cannot deposit a ticket or clear loading in a new room', async () => {
  let resolve;
  const context={state:{room:room(),roomId:'old',scope:{},player:{rankLevel:1},status:'active',history:[],battleSceneToken:1,playerActionCount:0},
    generateRaidQuestion:()=>new Promise(done=>{resolve=done;}),console,toast(){}};
  vm.runInNewContext(section('  async function prefetchQuestion()', '  async function openNextQuestion(')+'\nthis.prefetch=prefetchQuestion;',context);
  const pending=context.prefetch();
  Object.assign(context.state,{roomId:'new',battleSceneToken:2,questionLoading:true});
  resolve({id:'old-ticket'});await pending;
  assert.equal(context.state.pendingQuestion,undefined);
  assert.equal(context.state.questionLoading,true);
});

test('questions, arena and attack focus share document bounds despite keyboard and visual panning', () => {
  const props=new Map(),classes=new Set(['raid-session-active']);
  const page={dataset:{raidView:'question'},classList:{contains:name=>name==='active-page'},style:{setProperty:(key,value)=>props.set(key,value),removeProperty:key=>props.delete(key)}};
  const context={PAGE_ID:'page-raid',window:{innerHeight:1000,innerWidth:1600,visualViewport:{height:840,width:1300,offsetTop:12,offsetLeft:4}},
    document:{documentElement:{clientWidth:1440,clientHeight:900},body:{classList:{contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name)}},getElementById:id=>id==='page-raid'?page:{getBoundingClientRect:()=>({top:800})},querySelector:()=>({getBoundingClientRect:()=>({bottom:72})})}};
  vm.runInNewContext(section('  function syncRaidBottomClearance()', '  function setRaidCombatFocus(')+'\nthis.sync=syncRaidBottomClearance;',context);
  context.sync();const question=[...props];
  page.dataset.raidView='arena';classes.add('raid-combat-focus');context.sync();
  assert.deepEqual([...props],question);
  assert.equal(props.get('width'),'1440px');assert.equal(props.get('height'),'900px');assert.equal(props.get('top'),'0px');assert.equal(props.get('left'),'0px');
  Object.assign(context.window.visualViewport,{height:300,width:900,offsetTop:70,offsetLeft:20});context.sync();assert.deepEqual([...props],question);
  for (const view of ['hub','lobby','result']) {
    page.dataset.raidView=view;classes.delete('raid-session-active');context.sync();
    assert.equal(classes.has('raid-fullscreen'),false);
    assert.equal(props.has('width'),false,view+' regains its centered width');
    assert.equal(props.get('--raid-bottom-clearance'),'0px');
    assert.equal(props.get('height'),'828px',view+' does not reserve room for hidden navigation');
  }
});

test('battle CSS has one set of attack keyframes and app header themes do not style nested question headers', () => {
  const css=fs.readFileSync(path.join(__dirname,'../public/styles/raid-mode.css'),'utf8');
  assert.equal(css.split('{').length,css.split('}').length);
  for(const name of ['raidPlayerStrike','raidBossStrike','raidPlayerHit','raidBossHit']) assert.equal((css.match(new RegExp('@keyframes '+name+'\\{','g'))||[]).length,1);
  assert.doesNotMatch(css,/body\.raid-combat-focus #raid-arena/,'attack focus cannot change the grid rows or hide controls');
  for(const name of ['xianxia.css','xianxia-gold.css','xianxia-bright-accents.css']) {
    const theme=fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
    assert.doesNotMatch(theme,/body\.xianxia-theme header/);
    assert.match(theme,/body\.xianxia-theme > header/);
  }
});

test('a thrown sound effect releases the animation queue and restores answer controls', async () => {
  const h = sceneHarness();
  h.context.console = {warn(){}};
  h.context.QAGameAudio = {play(){throw Error('audio unavailable');}};
  h.context.state.status = 'review';
  await h.context.play({attacker:'player', damage:100});
  assert.equal(h.context.state.battleSceneTail, null);
  assert.equal(h.context.state.battleScenePlaying, false);
  assert.deepEqual(h.restores, [true]);
  h.context.QAGameAudio = null;
  const next = h.context.play({attacker:'boss'});
  await flush();
  assert.equal(h.waiting.length, 1, 'the next animation is not blocked behind a rejected visual');
  h.waiting.shift()(); await next;
});

function questionHarness() {
  let resolve, renders = 0, requests = 0;
  const context = {state:{room:room(), roomId:'r', player:{hp:100}, status:'review',
    battleSceneToken:1, history:[], pendingQuestion:null}, now:()=>1,
    prefetchQuestion(){requests++; return new Promise(done => {resolve = done;});},
    renderArena(){},renderQuestion(){renders++;}};
  vm.runInNewContext(section('  async function openNextQuestion()', '  function renderQuestion(')+'\nthis.open=openNextQuestion;', context);
  return {context, requests:()=>requests, renders:()=>renders,
    complete(q={id:'next'}){context.state.pendingQuestion=q;resolve();}};
}

test('repeated next taps while generation is pending consume exactly one question', async () => {
  const h=questionHarness();
  const first=h.context.open(), second=h.context.open(), third=h.context.open();
  assert.equal(h.requests(),1);
  h.complete(); await Promise.all([first,second,third]);
  assert.equal(h.context.state.question.id,'next');
  assert.equal(h.context.state.history.length,1);
  assert.equal(h.renders(),1);
  assert.equal(h.context.state.openingQuestion,false);
});

test('late next-question work cannot reopen a defeated, departed or replaced session', async () => {
  for (const change of [{room:{status:'lost'}},{player:{hp:0}},{roomId:'new',battleSceneToken:2,openingQuestion:false}]) {
    const h=questionHarness(), work=h.context.open();
    Object.assign(h.context.state,change);
    h.complete();await work;
    assert.equal(h.renders(),0);
    assert.equal(h.context.state.question,undefined);
    assert.equal(h.context.state.openingQuestion,false);
  }
});

function answerHarness() {
  const context={state:{room:room(),roomId:'r',player:{uid:'me',hp:100},boss:{hp:900,maxHp:1000},
    status:'question',question:{id:'q1',actionId:1,ticket:'t',opts:['a','b','c','d']},
    playerActionCount:0,battleSceneToken:1,history:[],questionIssuedAtMs:1},
    now:()=>2,renderQuestion(){},updateHomeEntry(){},prefetchQuestion(){},renderArena(){},
    playerRepository:{saveExamAnswer:()=>Promise.resolve()},window:{},console:{warn(){},error(){}},
    shenPhaseForHp:()=>1,toast(){},showCorrectAnswerFeedback(){},playBattleScene:async()=>{},finishRaid(){}};
  vm.runInNewContext(section('  async function answer(', '  async function applyRemoteBossAction(')+'\nthis.answer=answer;',context);
  return context;
}

test('lost replies retry the original question action and choice even when room count advanced', async () => {
  const h=answerHarness(), sent=[];
  h.commitRaidPlayerAction=async payload=>{sent.push(payload);throw Error('offline');};
  await h.answer(2);
  assert.equal(h.state.status,'question');
  h.state.playerActionCount=1; // Room push beat the HTTP response.
  h.commitRaidPlayerAction=async payload=>{sent.push(payload);return {resolution:{correct:false,correctIndex:0,explanation:'explanation'}};};
  await h.answer(3);
  assert.deepEqual(sent.map(row=>row.actionId),[1,1]);
  assert.deepEqual(sent.map(row=>row.choice),[2,2]);
  assert.equal(h.state.status,'review');
  assert.equal(h.state.playerActionCount,1);
});

test('room receipt recovers an answer when HTTP fails and optional history services throw', async () => {
  const h=answerHarness();
  h.playerRepository.saveExamAnswer=()=>{throw Error('history unavailable');};
  h.commitRaidPlayerAction=async()=>{
    h.state.room.members.me.lastPlayerResolution={questionId:'q1',actionId:1,correct:false,correctIndex:0,explanation:'settled'};
    throw Error('lost reply');
  };
  await h.answer(1);
  assert.equal(h.state.status,'review');
  assert.equal(h.state.question.exp,'settled');
});

test('expired tickets return to a usable battlefield instead of trapping retries on an invalid question', async () => {
  const h=answerHarness();let arenas=0;
  h.renderArena=()=>arenas++;
  h.commitRaidPlayerAction=async()=>{throw Object.assign(Error('團本題目已過期，請取得下一題'),{status:409});};
  await h.answer(1);
  assert.equal(h.state.status,'active');
  assert.equal(h.state.question,null);
  assert.equal(arenas,1);
});

test('heartbeats do not accumulate requests on a slow connection', async () => {
  let tick,resolve,calls=0;
  const context={state:{roomId:'r'},HEARTBEAT_MS:8000,stopHeartbeat(){},
    setInterval(fn){tick=fn;return 1;},heartbeatRaidRoom(){calls++;return new Promise(done=>{resolve=done;});}};
  vm.runInNewContext(section('  function startHeartbeat()', '  function stopHeartbeat()')+'\nstartHeartbeat();',context);
  tick();tick();tick();assert.equal(calls,1);
  resolve();await flush();tick();assert.equal(calls,2);
  context.state.roomId='new';tick();assert.equal(calls,2);
  resolve();await flush();
});

test('forty consecutive answers retain stable ticket numbers across reordered room pushes and replies', async () => {
  const h=answerHarness();
  for(let id=1;id<=40;id++) {
    Object.assign(h.state,{status:'question',question:{id:'q'+id,actionId:id,ticket:'t'+id,opts:['a','b','c','d']}});
    h.commitRaidPlayerAction=async payload=>{
      assert.equal(payload.actionId,id);
      assert.equal(payload.questionId,'q'+id);
      h.state.playerActionCount=id;
      const resolution={questionId:'q'+id,actionId:id,correct:false,correctIndex:0,explanation:'settled'};
      h.state.room.members.me.lastPlayerResolution=resolution;
      if(id%3===0)throw Error('HTTP reply lost after commit');
      return {resolution};
    };
    await h.answer(1);
    assert.equal(h.state.status,'review','answer '+id+' reaches review');
    assert.equal(h.state.playerActionCount,id);
  }
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js');
const api=require('../tactical-combat-api.cjs').__test;
const fixed=2000000000000;
const hero=(uid='u1',extra={})=>({uid,name:uid,atk:200,maxHp:1000,...extra});
const battle=(mode='pve',extra={})=>R.create({simultaneous:false,id:'arena-0123456789abcdef',mode,players:mode==='pvp'?[hero(),hero('u2')]:[hero()],now:fixed,...extra});
test('answer stamina is capped, persists between turns, and limits two questions',()=>{
  const initial=battle();let s=R.answer(initial,'u1',true,fixed);s=R.answer(s,'u1',true,fixed);
  assert.equal(s.actors[0].stamina,10);assert.equal(initial.actors[0].stamina,2);
  assert.throws(()=>R.answer(s,'u1',true,fixed),/兩題/);
  s=R.apply(s,'u1',{type:'end'},fixed);assert.equal(s.actors[0].stamina,10);assert.equal(s.actors[0].questions,0);
  s.actors[0].stamina=0;s=R.answer(s,'u1',false,fixed);assert.equal(s.actors[0].stamina,1);
});
test('BFS charges the actual traversable path and rejects blocked, occupied, diagonal-cost shortcuts',()=>{
  const s=battle();s.actors[0].stamina=10;s.blocks=[{x:2,y:3}];
  const route=R.path(s,s.actors[0],{x:3,y:3},'u1');assert.equal(route.length-1,4);
  const next=R.apply(s,'u1',{type:'move',x:3,y:3},fixed);assert.equal(next.actors[0].stamina,6);
  assert.equal(s.actors[0].x,1);assert.throws(()=>R.apply(s,'u1',{type:'move',x:2,y:3},fixed),/無法到達/);
  assert.throws(()=>R.apply(s,'u1',{type:'move',x:5,y:3},fixed),/無法到達/);
  assert.throws(()=>R.apply(s,'u1',{type:'move',x:0.5,y:0},fixed),/無法到達/);
  s.actors[0].stamina=1;assert.throws(()=>R.apply(s,'u1',{type:'move',x:3,y:3},fixed),/體力不足/);
});
test('attacks require range, sight, stamina and own turn; guard spends an action slot',()=>{
  let s=battle('pvp');assert.throws(()=>R.apply(s,'u2',{type:'end'},fixed),/不是你的/);
  assert.throws(()=>R.apply(s,'u1',{type:'attack',x:5,y:3},fixed),/範圍/);
  s.actors[1].x=2;s.actors[0].stamina=10;
  s=R.apply(s,'u1',{type:'guard'},fixed);s=R.apply(s,'u1',{type:'attack',x:2,y:3},fixed);
  assert.equal(s.actors[1].hp,800);assert.throws(()=>R.apply(s,'u1',{type:'attack',x:2,y:3},fixed),/兩次/);
  assert.equal(s.actors[0].stamina,8);
});
test('normal attacks choose exactly one cardinal direction and hit both cells for one cost',()=>{
  for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
    const s=battle();s.blocks=[];Object.assign(s.actors[0],{x:3,y:3,stamina:8});
    s.actors=[s.actors[0],...[1,2,3].map(n=>R.actor(hero('m'+n,{bot:true,team:'monster'}),{x:3+dx*n,y:3+dy*n}))];
    const next=R.apply(s,'u1',{type:'attack',x:3+dx,y:3+dy},fixed);
    assert.deepEqual(next.actors.slice(1).map(a=>a.hp),[800,800,1000]);
    assert.equal(next.actors[0].stamina,6);assert.equal(next.actors[0].attacks,1);assert.equal(next.actors[0].actions,1);
    assert.equal(next.turn,1);assert.equal(s.actors[1].hp,1000);
    const far=R.apply(s,'u1',{type:'attack',x:3+dx*2,y:3+dy*2},fixed);
    assert.deepEqual(far.actors,next.actors,'either red cell selects the same two-cell ray');
  }
});
test('directional attacks stop at walls and edges, exclude diagonals, and permit an empty ray',()=>{
  const s=battle();s.blocks=[{x:3,y:2}];Object.assign(s.actors[0],{x:3,y:3,stamina:8});
  Object.assign(s.actors[1],{x:3,y:1});
  assert.deepEqual(R.skillCells(s,s.actors[0],R.BASIC,{x:3,y:2}),[]);
  assert.throws(()=>R.apply(s,'u1',{type:'attack',x:3,y:1},fixed),/視線/);
  assert.throws(()=>R.apply(s,'u1',{type:'attack',x:4,y:4},fixed),/同一行|同一列/);
  assert.throws(()=>R.apply(s,'u1',{type:'attack',x:3,y:3},fixed),/同一行|同一列/);
  const miss=R.apply(s,'u1',{type:'attack',x:2,y:3},fixed);
  assert.equal(miss.actors[1].hp,s.actors[1].hp);assert.equal(miss.actors[0].stamina,6);
  s.actors[0].x=5;
  assert.deepEqual(R.skillCells(s,s.actors[0],R.BASIC,{x:6,y:3}),[{x:6,y:3}]);
  assert.ok(R.aimCells(s,s.actors[0],R.BASIC).every(p=>R.inside(s,p)));
});
test('move highlights match every legal server move, including detours, occupancy, stamina and slow',()=>{
  for(const slow of [0,1])for(const stamina of [0,1,3,6]){
    const s=battle();Object.assign(s.actors[0],{x:1,y:3,stamina,slow});s.blocks=[{x:2,y:3},{x:2,y:2}];
    const a=s.actors[0],cells=R.moveCells(s,a),byKey=new Map(cells.map(p=>[R.key(p),p]));
    assert.equal(cells.length,byKey.size);
    for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){
      if(x===a.x&&y===a.y)continue;
      let next;try{next=R.apply(s,'u1',{type:'move',x,y},fixed);}catch(_){}
      assert.equal(byKey.has(x+','+y),!!next,`slow=${slow}, stamina=${stamina}, cell=${x},${y}`);
      if(next)assert.equal(byKey.get(x+','+y).cost,stamina-next.actors[0].stamina);
    }
  }
  const s=battle();s.actors[0].stamina=10;s.actors[0].actions=R.LIMITS.actions;
  assert.deepEqual(R.moveCells(s,s.actors[0]),[]);
});
test('movement always charges one stamina per traversed cell, even under slow',()=>{
  const s=battle();s.blocks=[];Object.assign(s.actors[0],{x:1,y:3,stamina:7,slow:1});
  const cells=R.moveCells(s,s.actors[0]);
  assert(cells.some(cell=>cell.x===2&&cell.y===3&&cell.cost===1));
  assert(cells.some(cell=>cell.x===3&&cell.y===3&&cell.cost===2));
  assert(!cells.some(cell=>cell.x===4&&cell.y===3),'緩速只限制單次移動距離');
  assert.throws(()=>R.apply(s,'u1',{type:'move',x:4,y:3},fixed),/緩速/);
  const next=R.apply(s,'u1',{type:'move',x:3,y:3},fixed);
  assert.equal(next.actors[0].stamina,5);
  assert.equal(next.actors[0].slow,0,'移動後解除緩速');
});
test('core aim ranges follow their own line, area, teleport and self-cast shapes',()=>{
  const s=battle();s.blocks=[{x:3,y:2}];Object.assign(s.actors[0],{x:3,y:3,stamina:10});
  const a=s.actors[0],line=R.CORES.ocean.branches[0].skill,area=R.CORES.thunder.branches[0].skill;
  const rays=R.aimCells(s,a,line),diamond=R.aimCells(s,a,area);
  assert.ok(rays.every(p=>p.x===a.x||p.y===a.y));assert.ok(!rays.some(p=>p.x===3&&p.y<3));
  assert.ok(diamond.some(p=>p.x===4&&p.y===4));assert.ok(diamond.some(p=>R.key(p)===R.key(a)),'area skills may target the caster cell');
  for(const [type,c]of Object.entries(R.CORES))for(const branch of c.branches){
    const sk=branch.skill,range=R.aimCells(s,a,sk);
    assert.ok(range.every(p=>R.inside(s,p)&&!R.blocked(s,p)&&R.dist(a,p)<=sk.range),type+':'+branch.id);
    if(sk.range===0)assert.deepEqual(range,[{x:a.x,y:a.y}]);
    if(sk.kind==='blink')assert.ok(range.every(p=>!R.at(s,p)));
  }
});
test('blink burst preview covers the same adjacent enemies as the actual cast',()=>{
  const s=battle('pve',{players:[hero('u1',{core:'pojing',branch:'breach'})]});s.blocks=[];s.actors[0].stamina=10;
  const p={x:3,y:3};s.actors=[s.actors[0],R.actor(hero('m1',{bot:true,team:'monster'}),{x:4,y:3}),R.actor(hero('m2',{bot:true,team:'monster'}),{x:4,y:4})];
  const cells=R.skillCells(s,s.actors[0],R.branchFor(s.actors[0]).skill,p),next=R.apply(s,'u1',{type:'skill',...p},fixed);
  assert.ok(cells.some(c=>c.x===4&&c.y===3));assert.ok(!cells.some(c=>c.x===4&&c.y===4));
  assert.equal(next.actors[1].hp,760);assert.equal(next.actors[2].hp,1000);
});
test('all nine cores have two distinct executable branches and immutable cooldowns',()=>{
  let count=0;
  for(const [type,c]of Object.entries(R.CORES)){
    if(type==='none')continue;assert.equal(c.branches.length,2);
    for(const b of c.branches){
      let s=battle('pvp',{players:[hero('u1',{core:type,branch:b.id}),hero('u2')]});s.blocks=[];
      const a=s.actors[0];a.x=1;a.y=3;a.hp=500;a.stamina=10;s.actors[1].x=2;
      const sk=b.skill,p=sk.range===0?{x:a.x,y:a.y}:sk.kind==='blink'?{x:2,y:2}:{x:2,y:3};
      const next=R.apply(s,'u1',{type:'skill',...p},fixed);
      assert.equal(next.actors[0].stamina,10-sk.cost,type+':'+b.id);
      assert.equal(next.actors[0].cooldowns[sk.id],3);assert.equal(a.stamina,10);
      assert.throws(()=>R.apply(next,'u1',{type:'skill',...p},fixed),/冷卻|體力/);count++;
    }
  }
  assert.equal(count,18);
});
test('telegraphed monsters can be dodged, and delayed meteors resolve after opponent response',()=>{
  let s=battle();s.blocks=[];s.actors[1].x=2;s.actors[1].intent={kind:'strike',cells:[{x:1,y:3}]};
  s=R.apply(s,'u1',{type:'move',x:1,y:2},fixed);s=R.apply(s,'u1',{type:'end'},fixed);
  assert.equal(s.actors[0].hp,1000);assert.ok(s.events.some(e=>e.type==='dodge'));
  s=battle('pvp',{players:[hero('u1',{core:'xingchen',branch:'meteor'}),hero('u2')]});s.blocks=[];s.actors[0].stamina=10;s.actors[1].x=3;
  s=R.apply(s,'u1',{type:'skill',x:3,y:3},fixed);assert.equal(s.actors[1].hp,1000);assert.equal(s.effects.length,1);
  s=R.apply(s,'u1',{type:'end'},fixed);s=R.apply(s,'u2',{type:'end'},fixed);
  assert.equal(s.actors[1].hp,620);assert.equal(s.effects.length,0);
});
test('shield pierce, counter and slow have distinct tactical effects',()=>{
  let s=battle('pvp',{players:[hero('u1',{core:'wugou',branch:'purify'}),hero('u2')]});s.blocks=[];s.actors[1].x=2;s.actors[1].shield=999;s.actors[1].guard=.4;s.actors[0].stamina=10;
  s=R.apply(s,'u1',{type:'skill',x:2,y:3},fixed);assert.equal(s.actors[1].hp,750);assert.equal(s.actors[1].shield,999);
  s=battle('pvp',{players:[hero('u1',{core:'ocean',branch:'tide'}),hero('u2')]});s.blocks=[];s.actors[1].x=3;s.actors[0].stamina=10;
  s=R.apply(s,'u1',{type:'skill',x:3,y:3},fixed);s=R.apply(s,'u1',{type:'end'},fixed);assert.equal(s.actors[1].slow,1);
  s=R.apply(s,'u2',{type:'move',x:3,y:4},fixed);assert.equal(s.actors[1].stamina,1,'緩速不再增加每格體力消耗');
  s=battle('pvp');s.blocks=[];s.actors[1].x=2;s.actors[1].counter=.8;
  s=R.apply(s,'u1',{type:'attack',x:2,y:3},fixed);assert.equal(s.actors[0].hp,840);assert.equal(s.actors[1].counter,0);
});
test('PvP timeout advances the turn and two consecutive missed own turns forfeit',()=>{
  let s=battle('pvp');s=R.expire(s,fixed+R.LIMITS.turnMs);assert.equal(s.turnUid,'u2');
  s=R.apply(s,'u2',{type:'end'},fixed+R.LIMITS.turnMs+1);
  s=R.expire(s,fixed+R.LIMITS.turnMs*2+1);assert.equal(s.status,'finished');assert.equal(s.winner,'u2');
  assert.equal(s.finishReason,'timeout');
});
const {database}=require('./helpers/tactical-db.cjs');
test('server directional hits and stamina are idempotent and ignore forged range and damage',async()=>{
  const db=database(),s=await api.start(db,'u1',{mode:'pve'},fixed),raw=db.records.get(api.ROOMS+'/'+s.id);
  raw.blocks=[];Object.assign(raw.actors[0],{x:1,y:3,stamina:8});
  raw.actors=[raw.actors[0],...[2,3,4].map((x,i)=>R.actor(hero('m'+i,{bot:true,team:'monster'}),{x,y:3}))];
  const input={roomId:s.id,revision:s.revision,requestId:'direction-attack-01',type:'attack',x:2,y:3,range:99,damage:999999};
  const first=await api.command(db,'u1',input,fixed),retry=await api.command(db,'u1',input,fixed);
  assert.deepEqual(first.actors.slice(1).map(a=>a.hp),[800,800,1000]);
  assert.deepEqual(retry.actors,first.actors);assert.equal(retry.actors[0].stamina,6);assert.equal(retry.actors[0].attacks,1);
});
test('server hides pending answers, rejects out-of-turn generation and credits retried answers only once',async()=>{
  const db=database(),s=await api.start(db,'u1',{mode:'pve'},fixed);
  const expected=await api.prepareQuestion(db,'u1',s.id,fixed);
  const q=await api.commitQuestion(db,'u1',expected,{q:'計算 2 加 3 的結果為何？',correct:'5',wrong:['1','2','3'],exp:'二加三等於五。'},fixed);
  assert.equal('answerIndex'in q,false);
  assert.equal(JSON.stringify(await api.state(db,'u1',fixed)).includes('answerIndex'),false);
  const raw=db.records.get(api.ROOMS+'/'+s.id),answerIndex=raw.pending.u1.answerIndex;
  const request={roomId:s.id,questionId:q.id,choice:answerIndex};
  const [a,b]=await Promise.all([api.answer(db,'u1',request,fixed+1),api.answer(db,'u1',request,fixed+1)]);
  assert.equal(a.actors[0].stamina,6);assert.equal(b.actors[0].stamina,6);
  assert.equal(db.records.get('users/u1').stats.totalAnswered,1);assert.equal(db.records.get('users/u1').stats.totalScore,32);
  assert.equal(a.progress.stats.gold,30);assert.equal(b.progress.stats.gold,30);
  assert.equal([...db.records.keys()].filter(k=>k.startsWith('exam_logs/')).length,1);
  await assert.rejects(api.prepareQuestion(db,'u2',s.id,fixed),/參戰/);
  assert.equal((await api.state(db,'u1',fixed)).question,null);
});
test('tactical battle answers persist the very same solo adaptive footprint, reasoning metadata and reward rules',async()=>{
  const db=database(),user=db.records.get('users/u1');
  user.gameSettings={sourceMode:'focused',focusedUnits:[
    {path:'數學/高中二年級/第一學期/數學A',detail:'二項分布'}
  ]};
  user.profile.weakSubjects='數學';
  const s=await api.start(db,'u1',{mode:'pve'},fixed);
  const expected=await api.prepareQuestion(db,'u1',s.id,fixed);
  const q=await api.commitQuestion(db,'u1',expected,{
    q:'袋中共有五個球，如何計算抽到指定顏色的機率？',
    correct:'以符合條件情形數除以全部等可能情形數',
    wrong:['只計算總球數','只看袋子顏色','依抽取順序直接相加'],
    exp:'在每一結果等可能時，機率等於符合條件情形數除以全部可能結果數。',
    subject:'數學',sub_topic:'二項分布',
    concept_id:'probability',template_id:'ratio-probability',
    question_form:'direct-application',cognitive_level:2,reasoning_steps:1,
    knowledge_points:[{subject:'數學',id:'math-7',name:'機率與統計'}],
    adaptive:{questionId:'3a7e51d1-6a72-4ca5-ae8d-29d1a06f4b60',
      scopeId:'0123456789abcdef01234567',conceptId:'c_0123456789abcdef',
      facetId:'f_0123456789abcdef',difficulty:'hard',role:'diagnostic',
      scope:{path:'數學/高中二年級/第一學期/數學A',detail:'二項分布'}}
  },fixed);
  assert.equal(q.meta.question_form,'direct-application');
  assert.equal(q.learningDifficulty,'hard');
  assert.equal(q.adaptive.role,'diagnostic');
  assert.equal('answerIndex'in q,false);
  const correctIndex=db.records.get(api.ROOMS+'/'+s.id).pending.u1.answerIndex;
  const result=await api.answer(db,'u1',{
    roomId:s.id,questionId:q.id,choice:correctIndex,help:2,timeTaken:18.5
  },fixed+1000);
  const stats=db.records.get('users/u1').stats;
  assert.equal(stats.totalAnswered,1);
  assert.equal(stats.totalCorrect,1);
  assert.equal(stats.totalScore,34,'main base +2, hard +1, weak subject +1');
  assert.equal(stats.gold,50,'realm 30, hard 10, weak subject 10');
  assert.equal(stats.soloLearningV1.version,1);
  assert.equal(stats.knowledgePointMapV1.數學['math-7'].total,1);
  assert.equal(stats.knowledgeMap.數學['二項分布'].correct,1);
  assert.equal(stats.adaptiveLearningV1.scopes['0123456789abcdef01234567'].answered,1);
  const facet=stats.adaptiveLearningV1.scopes['0123456789abcdef01234567'].facets['f_0123456789abcdef'];
  assert.equal(facet.n,1);assert.equal(facet.h,1);assert.equal(facet.u,0);
  assert.equal(result.review.reward.cultivation,4);
  const logs=[...db.records].filter(([k])=>k.startsWith('exam_logs/'));
  assert.equal(logs.length,1);
  const log=logs[0][1];
  assert.equal(log.questionForm,'direct-application');
  assert.equal(log.conceptId,'probability');
  assert.equal(log.assistanceLevel,2);
  assert.equal(log.timeTaken,18.5);
  assert.equal(log.knowledgePointId,'math-7');
  await api.answer(db,'u1',{roomId:s.id,questionId:q.id,choice:correctIndex,help:0},fixed+1000);
  assert.equal(db.records.get('users/u1').stats.adaptiveLearningV1.scopes['0123456789abcdef01234567'].answered,1,'replay must not duplicate footprint');
});
test('tactical wrong answer uses main solo mistake ledger and records the last penalized answer',async()=>{
  const db=database(),s=await api.start(db,'u1',{mode:'pve'},fixed);
  const scope=await api.prepareQuestion(db,'u1',s.id,fixed);
  const q=await api.commitQuestion(db,'u1',scope,{
    q:'下列何者等於 2+3？',correct:'5',
    wrong:['4','6','8'],exp:'二加三等於五。',subject:'數學'
  },fixed);
  const answer=db.records.get(api.ROOMS+'/'+s.id).pending.u1.answerIndex;
  await api.answer(db,'u1',{roomId:s.id,questionId:q.id,choice:(answer+1)%4},fixed+1000);
  const stats=db.records.get('users/u1').stats;
  assert.equal(stats.totalScore,29);
  assert.equal(stats.soloLearningV1.mistakes[require('../public/cultivation/solo-learning-rules.js').key(q.q)].recovered,false);
  assert.equal(stats.lastQuizAnswer.penalty,1);
  assert.equal(stats.currentStreak,0);
});
test('parallel question API slots can commit out of order without leaking answers',async()=>{
  const db=database(),s=await api.start(db,'u1',{mode:'pve'},fixed);
  // Both scopes are prepared before either model/API has generated a result.
  const [firstScope,secondScope]=await Promise.all([
    api.prepareQuestion(db,'u1',s.id,fixed,0),
    api.prepareQuestion(db,'u1',s.id,fixed,1)
  ]);
  assert.equal(firstScope.batchSlot,0);
  assert.equal(secondScope.batchSlot,1);
  // The second API completes first; the server reserves it without exposing it
  // as the current answerable question.
  const followup=await api.commitQuestion(db,'u1',secondScope,{
    q:'圓周運動的向心加速度指向何處？',correct:'圓心',
    wrong:['切線方向','遠離圓心','與速度同向'],exp:'向心加速度朝向圓心。'
  },fixed);
  assert.equal('answerIndex' in followup,false);
  const beforeFirst=await api.state(db,'u1',fixed);
  assert.equal(beforeFirst.question,null);
  assert.equal(beforeFirst.questionFollowup,null,'normal polling cannot expose the second question first');
  const first=await api.commitQuestion(db,'u1',firstScope,{
    q:'二加三等於多少？',correct:'5',wrong:['2','3','4'],exp:'2+3=5。'
  },fixed);
  const before=await api.state(db,'u1',fixed);
  assert.equal(before.question.id,first.id);
  assert.equal(before.questionFollowup.id,followup.id);
  assert.equal('answerIndex' in before.questionFollowup,false);
  const answerIndex=db.records.get(api.ROOMS+'/'+s.id).pending.u1.answerIndex;
  const after=await api.answer(db,'u1',{
    roomId:s.id,questionId:first.id,choice:answerIndex
  },fixed+1);
  assert.equal(after.question.id,followup.id,'the already-generated second question is promoted');
  assert.equal(after.actors.find(actor=>actor.uid==='u1').questions,1);
  await assert.rejects(api.commitQuestion(db,'u1',secondScope,{
    q:'延遲到前一輪的舊題',correct:'是',wrong:['否','未知','都不對'],exp:'舊題不可覆蓋'
  },fixed+1),/回合已更新/);
});
test('tactical questions follow saved focused units, selected grade and high school math track',async()=>{
  const db=database(),player=db.records.get('users/u1');
  player.gameSettings={sourceMode:'focused',focusedUnits:[
    {path:'數學/高中二年級/第一學期/數學A/108課綱複習版',
      detail:'排列組合與機率',sub_topics:['二項分布','條件機率']},
    {path:'物理/高中二年級/第一學期/物理',
      detail:'鉛直圓周運動',sub_topics:['最低點的向心力']}
  ]};
  // The student profile is only 國一: explicitly selected 高二 content still wins.
  const session=await api.start(db,'u1',{mode:'pve'},fixed);
  const [first,second]=await Promise.all([
    api.prepareQuestion(db,'u1',session.id,fixed,0),
    api.prepareQuestion(db,'u1',session.id,fixed,1)
  ]);
  assert.equal(first.subject,'數學');
  assert.equal(first.level,'高中二年級');
  assert.match(first.topic,/數學A/);
  assert.match(first.topic,/條件機率/);
  assert.equal(second.subject,'物理');
  assert.equal(second.level,'高中二年級');
  assert.match(second.topic,/鉛直圓周運動/);
  assert.equal(first.scopeKey,second.scopeKey);
  assert(!first.bankSource&&!second.bankSource);
});
test('the selected use-bank mode is returned to tactical generation instead of random AI',async()=>{
  const db=database(),player=db.records.get('users/u1');
  player.gameSettings={sourceMode:'bank',source:'數學/國中二年級/代數.json'};
  const session=await api.start(db,'u1',{mode:'pve'},fixed);
  const prepared=await api.prepareQuestion(db,'u1',session.id,fixed);
  assert.equal(prepared.bankSource,player.gameSettings.source);
  assert.equal(prepared.level,'國中一年級');
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8'),
    /if \(tacticalContext\.bankSource\)/);
});
test('updating practice scope invalidates both old pending slots and rejects late model output',async()=>{
  const db=database(),user=db.records.get('users/u1');
  user.gameSettings={sourceMode:'focused',focusedUnits:[{path:'數學/七上.json',detail:'整數運算'}]};
  const session=await api.start(db,'u1',{mode:'pve'},fixed);
  const original=await api.prepareQuestion(db,'u1',session.id,fixed);
  const first=await api.commitQuestion(db,'u1',original,{
    q:'負數加法怎麼計算？',correct:'看正負號',
    wrong:['只取絕對值','一律相乘','一律加零'],exp:'整數加法依符號規則。'
  },fixed);
  const following=await api.prepareQuestion(db,'u1',session.id,fixed,1);
  await api.commitQuestion(db,'u1',following,{
    q:'負數乘法怎麼計算？',correct:'依負號個數判斷正負',
    wrong:['都是正數','都是負數','全部變零'],exp:'同號得正，異號得負。'
  },fixed);
  // The player changes the selected scope while the same battle remains active.
  db.records.get('users/u1').gameSettings={sourceMode:'focused',focusedUnits:[
    {path:'英文/國中二年級/第二學期',detail:'現在完成式'}
  ]};
  const next=await api.prepareQuestion(db,'u1',session.id,fixed);
  assert.equal(next.subject,'英文');
  assert.match(next.topic,/現在完成式/);
  assert.equal(next.pending,null);
  const raw=db.records.get(api.ROOMS+'/'+session.id);
  assert(!raw.pending?.u1&&!raw.pendingFollowup?.u1,'old questions must be purged');
  await assert.rejects(api.answer(db,'u1',{
    roomId:session.id,questionId:first.id,choice:0
  },fixed+1),/失效|結算/);
  await assert.rejects(api.commitQuestion(db,'u1',original,{
    q:'舊模型的結果不可寫回',correct:'a',wrong:['b','c','d'],exp:'old'
  },fixed),/修習範圍已變更/);
  const replacement=await api.commitQuestion(db,'u1',next,{
    q:'現在完成式是什麼？',correct:'have 加上過去分詞',
    wrong:['只有現在式','現在進行式','未來進行式'],exp:'現在完成式使用 have/has。'
  },fixed);
  assert.equal(replacement.subject,'英文');
});
test('an in-flight old scoped answer cannot give rewards after settings change',async()=>{
  const db=database(),user=db.records.get('users/u1');
  user.gameSettings={sourceMode:'focused',focusedUnits:[{path:'歷史/七上',detail:'古文明'}]};
  const session=await api.start(db,'u1',{mode:'pve'},fixed);
  const prepared=await api.prepareQuestion(db,'u1',session.id,fixed);
  const q=await api.commitQuestion(db,'u1',prepared,{
    q:'古埃及主要依靠哪條河？',correct:'尼羅河',
    wrong:['萊茵河','長江','亞馬遜河'],exp:'尼羅河定期氾濫提供肥沃土壤。'
  },fixed);
  db.records.get('users/u1').gameSettings={sourceMode:'focused',focusedUnits:[{path:'化學/高中一年級',detail:'氧化還原'}]};
  await assert.rejects(api.answer(db,'u1',{
    roomId:session.id,questionId:q.id,choice:0
  },fixed+1),/修習範圍已變更/);
  assert.equal(db.records.get('users/u1').stats.totalAnswered||0,0);
});
test('server commands reject stale revisions, ignore client damage, and replay movement without charging twice',async()=>{
  const db=database(),s=await api.start(db,'u1',{mode:'pve'},fixed);
  const pos=R.neighbours(s,s.actors[0]).find(p=>!R.at(s,p));
  const request={roomId:s.id,revision:s.revision,requestId:'move-0123456789',type:'move',...pos,damage:999999,stamina:100};
  const first=await api.command(db,'u1',request,fixed),again=await api.command(db,'u1',request,fixed);
  assert.equal(first.actors[0].stamina,1);assert.equal(again.actors[0].stamina,1);
  await assert.rejects(api.command(db,'u1',{...request,requestId:'move-abcdefgh',x:1,y:1},fixed),/戰場已更新/);
});
test('simultaneous matchmaking converges and a room never accepts a third player',async()=>{
  const db=database();const first=await api.start(db,'u1',{mode:'pvp',map:'bamboo'},fixed);
  const [second,third]=await Promise.all([api.start(db,'u2',{mode:'pvp',code:first.id},fixed),api.start(db,'u3',{mode:'pvp',code:first.id},fixed)] .map(p=>p.then(value=>({value}),error=>({error}))));
  assert.equal(second.value.status,'active');assert.ok(third.error);assert.equal(db.records.get(api.ROOMS+'/'+first.id).actors.length,2);
  assert.equal((await api.prepareQuestion(db,'u2',first.id,fixed)).quizRound,1);
});
test('finished battle rewards and quest counters are atomic and idempotent',async()=>{
  const db=database();let s=await api.start(db,'u1',{mode:'pve'},fixed);let raw=db.records.get(api.ROOMS+'/'+s.id);
  raw.blocks=[];raw.actors[0].x=1;raw.actors[0].y=3;raw.actors[0].stamina=4;raw.actors[0].correct=1;raw.actors[0].answered=1;raw.actors[1].x=2;raw.actors[1].y=3;raw.actors[1].hp=1;
  const request={roomId:s.id,revision:0,requestId:'kill-0123456789',type:'attack',x:2,y:3};
  const first=await api.command(db,'u1',request,fixed),retry=await api.command(db,'u1',request,fixed);
  assert.equal(first.status,'finished');assert.equal(first.rewards.u1.gold,35);assert.equal(retry.rewards.u1.gold,35);
  assert.equal(db.records.get('users/u1').stats.gold,35);assert.equal(db.records.get('users/u1').stats.totalScore,32);
  assert.equal(first.progress.stats.gold,35);assert.equal(retry.progress.stats.gold,35);
  assert.equal(first.nextStage,2);assert.equal(db.records.get(api.PLAYERS+'/u1').trial.stage,2);
  assert.equal(db.records.get('users/u1').tacticalTrialV1.best,1);
});
test('a generation finishing after turn change is discarded; the new turn cannot reuse the question',async()=>{
  const db=database(),s=await api.start(db,'u1',{mode:'pve'},fixed),expected=await api.prepareQuestion(db,'u1',s.id,fixed);
  await api.command(db,'u1',{roomId:s.id,revision:s.revision,requestId:'end-0123456789',type:'end'},fixed);
  await assert.rejects(api.commitQuestion(db,'u1',expected,{q:'延遲的題目',correct:'A',wrong:['B','C','D'],exp:'解析'},fixed),/回合已更新/);
  assert.equal((await api.state(db,'u1',fixed)).question,null);
});
test('player stats and equipped core come from the account, not the start request',async()=>{
  const db=database(),s=await api.start(db,'u1',{mode:'pve',core:'sword',atk:999999,maxHp:999999,branch:'lunge'},fixed);
  assert.equal(s.actors[0].core,'thunder');assert.equal(s.actors[0].atk,200);assert.equal(s.actors[0].maxHp,1100);
  assert.equal(s.actors[0].branch,'lightning');
});
test('all three PvE maps can be completed through the public action rules',()=>{
  for(const map of R.MAPS){
    let s=battle('pve',{map:map.id});
    while(s.status==='active'&&s.turn<=60){
      for(let i=0;i<2&&s.actors[0].stamina<10;i++)s=R.answer(s,'u1',true,fixed);
      const me=s.actors[0];
      let candidates=s.actors.filter(a=>a.bot&&R.alive(a));
      const routes=candidates.flatMap(t=>R.neighbours(s,t).map(n=>R.path(s,me,n,'u1')).filter(Boolean)).sort((a,b)=>a.length-b.length);
      if(routes[0]&&routes[0].length>1){const end=routes[0][Math.min(routes[0].length-1,Math.max(0,me.stamina-6))];if(R.dist(me,end)>0)s=R.apply(s,'u1',{type:'move',...end},fixed);}
      for(let i=0;i<2&&s.status==='active';i++){
        const target=s.actors.find(a=>a.bot&&R.alive(a)&&R.dist(a,s.actors[0])===1);
        if(!target||s.actors[0].stamina<2)break;s=R.apply(s,'u1',{type:'attack',x:target.x,y:target.y},fixed);
      }
      if(s.status==='active'){
        const dangers=s.actors.filter(a=>a.bot&&R.alive(a)).flatMap(a=>a.intent?.cells||[]),me=s.actors[0];
        if(dangers.some(p=>R.key(p)===R.key(me))){
          const safe=[];for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++)if(!dangers.some(p=>p.x===x&&p.y===y)){
            const route=R.path(s,me,{x,y},'u1');if(route&&route.length>1&&route.length-1<=me.stamina)safe.push(route);
          }
          safe.sort((a,b)=>a.length-b.length);if(safe[0])s=R.apply(s,'u1',{type:'move',...safe[0].at(-1)},fixed);
        }
        s=R.apply(s,'u1',{type:'end'},fixed);
      }
    }
    assert.equal(s.winner,'player',map.id);
  }
});

test('seeded stages vary terrain, enemies and obstacles while keeping every passable cell connected',()=>{
  const shapes=new Set(),terrains=new Set(),enemies=new Set();
  for(let stage=1;stage<=80;stage++){
    const layout=R.stageLayout('0123456789abcdef0123456789abcdef',stage);
    assert.deepEqual(layout,R.stageLayout('0123456789abcdef0123456789abcdef',stage));
    shapes.add(JSON.stringify(layout.blocks));terrains.add(layout.terrain);layout.enemies.forEach(m=>enemies.add(m.species));
    const room=R.create({id:'arena-test',players:[hero()],trial:{seed:layout.seed,stage},now:fixed});
    const occupied=new Set(room.blocks.map(R.key)),seen=new Set([R.key(layout.spawn)]),queue=[layout.spawn];
    for(let i=0;i<queue.length;i++)for(const n of R.neighbours(room,queue[i]))if(!seen.has(R.key(n))){seen.add(R.key(n));queue.push(n);}
    assert.equal(seen.size,room.width*room.height-occupied.size);
    for(const m of room.actors)assert.ok(seen.has(R.key(m)),'all spawns must be reachable');
    assert.equal(new Set(room.actors.map(R.key)).size,room.actors.length);
    assert.equal(layout.enemies.length<=4,true);
  }
  assert.equal(terrains.size,5);assert.ok(enemies.size>10);assert.equal(shapes.size,80);
});
test('trial victories advance exactly one stage, concurrent entry resumes it, and defeat cannot reroll',async()=>{
  const db=database(),first=await api.start(db,'u1',{mode:'pve',map:'ruins',stage:999,seed:'forged'},fixed);
  assert.equal(first.trial.stage,1);
  const raw=db.records.get(api.ROOMS+'/'+first.id),a=raw.actors[0],target=raw.actors[1];
  a.x=1;a.y=3;a.stamina=4;a.correct=1;a.answered=1;target.x=2;target.y=3;target.hp=1;raw.blocks=[];
  const input={roomId:first.id,revision:0,requestId:'campaign-kill-001',type:'attack',x:2,y:3};
  const result=await api.command(db,'u1',input,fixed);assert.equal(result.nextStage,2);
  await api.command(db,'u1',input,fixed);assert.equal(db.records.get(api.PLAYERS+'/u1').trial.stage,2);
  db.records.get('users/u1').tacticalTrialV1.stage=999; // Display mirror is never authoritative.
  const [next,duplicate]=await Promise.all([api.start(db,'u1',{mode:'pve'},fixed),api.start(db,'u1',{mode:'pve'},fixed)]);
  assert.equal(next.id,duplicate.id);assert.equal(next.trial.stage,2);assert.equal(next.trial.seed,first.trial.seed);
  await api.command(db,'u1',{roomId:next.id,type:'leave',requestId:'campaign-leave-001'},fixed);
  const retry=await api.start(db,'u1',{mode:'pve',map:'courtyard'},fixed);
  assert.equal(retry.trial.stage,2);assert.deepEqual(retry.blocks,next.blocks);
  assert.deepEqual(retry.actors.filter(a=>a.bot),next.actors.filter(a=>a.bot));
});
test('each existing spirit branch selects the matching tactical skill and request bodies cannot override it',async()=>{
  const Innate=require('../public/cultivation/innate-ability.js');
  for(const type of Object.keys(Innate.TYPES))for(const b of Innate.branches(type)){
    const user={cultivationTraining:{equippedCore:{type,grade:9}},stats:{totalScore:188},innateAbilityGrowth:{version:1,paths:{[type]:{branch:b.id,level:4}}}};
    assert.equal(R.savedBranch(user,type).id,R.spiritBranch(type,b.id).id);
    const fighter=api.playerActor(user,'u1',{branch:'forged'},{});assert.equal(fighter.branch,R.spiritBranch(type,b.id).id);
  }
  const db=database();db.records.get('users/u1').innateAbilityGrowth={version:1,paths:{thunder:{branch:'rebound',level:1}}};
  const state=await api.start(db,'u1',{mode:'pve',branch:'lightning'},fixed);
  assert.equal(state.actors[0].branch,'counter');
});

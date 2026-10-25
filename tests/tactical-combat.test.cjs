'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js');
const api=require('../tactical-combat-api.cjs').__test;
const fixed=2000000000000;
const hero=(uid='u1',extra={})=>({uid,name:uid,atk:200,maxHp:1000,...extra});
const battle=(mode='pve',extra={})=>R.create({id:'arena-0123456789abcdef',mode,players:mode==='pvp'?[hero(),hero('u2')]:[hero()],now:fixed,...extra});
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
  s=R.apply(s,'u2',{type:'move',x:3,y:4},fixed);assert.equal(s.actors[1].stamina,0);
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
  assert.equal(db.records.get('users/u1').stats.totalAnswered,1);assert.equal(db.records.get('users/u1').stats.totalScore,31);
  assert.equal(a.progress.stats.gold,30);assert.equal(b.progress.stats.gold,30);
  assert.equal([...db.records.keys()].filter(k=>k.startsWith('exam_logs/')).length,1);
  await assert.rejects(api.prepareQuestion(db,'u2',s.id,fixed),/參戰/);
  assert.equal((await api.state(db,'u1',fixed)).question,null);
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
  await assert.rejects(api.prepareQuestion(db,'u2',first.id,fixed),/自己的回合/);
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

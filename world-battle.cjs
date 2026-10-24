'use strict';
const crypto = require('node:crypto');
const BaseWorld = require('./public/world/world-core.js');
const worldFor=b=>BaseWorld.forDescriptor(b?.world||BaseWorld.descriptor);
const Authority = require('./raid-authority.cjs');
const fail = message => {throw Object.assign(new Error(message),{status:409});};
const SKILLS = Object.freeze({
  thunder:{name:'雷罡反擊',detail:'架盾減傷，反擊三格內的攻擊者',cost:2,range:0},
  xingchen:{name:'落星',detail:'標記四格內地點；敵人移動後，轟擊該格與相鄰格',cost:2,range:4},
  ocean:{name:'蓄潮推浪',detail:'三格內推退敵人，留下兩回合的減速潮域',cost:2,range:3},
  sword:{name:'劍心突進',detail:'沿三格內可行路線切入，斬擊相鄰敵人',cost:2,range:4},
  taichu:{name:'太初生息',detail:'回復最大生命的 20%；歸元納氣可將治療轉傷',cost:2,range:3},
  wugou:{name:'清心破陣',detail:'破盾、清除鄰近危險地格，並令目標停頓一回合',cost:2,range:3},
  reverse:{name:'陰陽流轉',detail:'依已失生命強化護體與反擊，回復已失生命的 30%',cost:2,range:0},
  basic:{name:'靈息破擊',detail:'攻擊三格內敵人，造成 140% 攻擊傷害',cost:2,range:3}
});
const skill = b => SKILLS[b.player.goldenCore?.type]||SKILLS.basic;
const living = b => b.enemies.filter(e=>e.hp>0);
function blocked(b,exclude='') {return new Set(living(b).filter(e=>e.id!==exclude).map(e=>BaseWorld.key(e.x,e.y)));}
function options(b,exclude='') {return {bounds:b.bounds,events:b.events,blocked:blocked(b,exclude)};}
function log(b,text) {b.log=[...(b.log||[]),text].slice(-8);}
function cellsIn(b,p,radius) {
  const W=worldFor(b);
  const out=[];for(let y=b.bounds.y;y<b.bounds.y+8;y++)for(let x=b.bounds.x;x<b.bounds.x+8;x++)
    if(W.distance(p,{x,y})<=radius)out.push({x,y});return out;
}
function planEnemies(b) {
  const W=worldFor(b);
  const occupied=blocked(b);occupied.add(W.key(b.player.x,b.player.y));
  for(const e of living(b)){
    const line=e.elite&&b.turn%2===1;
    const cells=line?cellsIn(b,e,10).filter(p=>Math.abs(e.x-b.player.x)>Math.abs(e.y-b.player.y)?p.y===e.y:p.x===e.x)
      :cellsIn(b,b.player,e.elite?1:0);
    e.intent={name:line?'劍氣貫列':e.elite?'震地陣波':'撲擊',cells,damage:e.atk};
    occupied.delete(W.key(e.x,e.y));
    const choices=W.DIRS.map(([dx,dy])=>({x:e.x+dx,y:e.y+dy})).filter(p=>W.walkable(p.x,p.y,{bounds:b.bounds,events:b.events,blocked:occupied}));
    choices.sort((a,c)=>W.distance(a,b.player)-W.distance(c,b.player));
    e.nextMove=choices.length&&W.distance(choices[0],b.player)<W.distance(e,b.player)?choices[0]:{x:e.x,y:e.y};
    occupied.add(W.key(e.nextMove.x,e.nextMove.y));
  }
}
function createBattle(position,object,player,events={},now=Date.now(),W=BaseWorld) {
  const bounds={x:Math.max(1,Math.min(W.SIZE-8,object.x-3)),y:Math.max(1,Math.min(W.SIZE-8,object.y-3)),w:8,h:8};
  const tiles={};for(let y=bounds.y;y<bounds.y+8;y++)for(let x=bounds.x;x<bounds.x+8;x++)tiles[W.key(x,y)]=W.terrain(x,y,events);
  events={bridge:events.bridge||0,array:events.array||0,tiles};
  const p={...structuredClone(player),...W.safePosition(position,{bounds,events}),mana:1,guard:false,ward:false};
  const first={id:'enemy-1',name:object.name,...W.safePosition(object,{bounds,events}),hp:object.hp,maxHp:object.hp,atk:object.atk,elite:!!object.elite,shield:object.id==='sentinel'?250:0};
  if(W.same(first,p)){const candidate=W.DIRS.map(([dx,dy])=>({x:first.x+dx,y:first.y+dy})).find(c=>W.walkable(c.x,c.y,{bounds,events}));if(candidate)Object.assign(first,candidate);}
  const b={id:crypto.randomUUID(),version:1,world:W.descriptor,revision:0,objectId:object.id,name:object.name,bounds,events:{...events},
    player:p,enemies:[first],turn:1,phase:'recharge',status:'active',moved:false,acted:false,questions:[],answered:0,correctThisTurn:0,
    meteors:[],tides:[],records:[],log:['留意紅色攻擊預告；移出範圍，或架盾反擊。'],startedAtMs:now};
  const area=W.reachable(p,{bounds,events,blocked:new Set([W.key(first.x,first.y)])}).cells;
  b.mechanism=area.filter(c=>W.distance(c,p)>1).sort((a,c)=>W.distance(a,first)-W.distance(c,first))[0]||null;
  if(b.mechanism)b.mechanism={...b.mechanism,active:true};
  planEnemies(b);return b;
}
function checkActive(b) {if(!b||b.status!=='active')fail('此戰鬥已結束');}
function checkAct(b) {checkActive(b);if(b.phase!=='command')fail('請先完成本回合的兩題補能，或選擇略過');}
function finish(b,now) {
  if(!living(b).length){b.status='won';b.phase='result';b.finishedAtMs=now;log(b,'妖氣散去，戰鬥勝利！');}
  else if(b.player.hp<=0){b.status='lost';b.phase='result';b.finishedAtMs=now;log(b,'暫退一步，整理後還能再來。');}
}
function damage(b,e,amount) {
  const hit=Math.max(0,Math.round(amount)),shield=Math.min(e.shield||0,hit);e.shield=Math.max(0,(e.shield||0)-shield);
  const dealt=Math.min(e.hp,hit-shield);e.hp-=dealt;log(b,e.name+' 受到 '+dealt+' 傷害'+(shield?'（護盾吸收 '+shield+'）':''));return dealt;
}
function targetEnemy(b,id) {const e=living(b).find(e=>e.id===id);if(!e)fail('請選擇仍在場上的敵人');return e;}
function endTurn(b,now) {
  const W=worldFor(b);
  checkAct(b);
  for(const e of living(b)){
    if(e.stunned){e.stunned=false;log(b,e.name+' 受到干擾，停止一回合');continue;}
    const hit=e.intent.cells.some(p=>W.same(p,b.player));
    if(hit){
      const incoming=Math.round(e.intent.damage*(b.player.guard?.45:1));
      const result=Authority.resolveBossDefense(b.player,{roomId:b.id,bossAction:{damage:incoming},bossHp:e.hp});
      Object.assign(b.player,result.member);log(b,e.name+' 施展'+e.intent.name+'，受到 '+result.damage+' 傷害');
      let reflected=result.reflectedDamage+result.shieldDamage+result.healingDamage;
      if(b.player.ward&&W.distance(b.player,e)<=3)reflected+=b.player.atk*(b.player.goldenCore?.type==='thunder'?1.2:1+(1-b.player.hp/b.player.maxHp)*.8);
      if(reflected)damage(b,e,reflected);
    }
    if(b.player.hp<=0)break;
    if(e.hp<=0)continue;
    const slow=b.tides.some(t=>t.cells.some(p=>W.same(p,e)));
    const occupied=blocked(b,e.id);occupied.add(W.key(b.player.x,b.player.y));
    if(!slow&&W.walkable(e.nextMove.x,e.nextMove.y,{bounds:b.bounds,events:b.events,blocked:occupied}))Object.assign(e,e.nextMove);
    if(b.tides.some(t=>t.cells.some(p=>W.same(p,e))))damage(b,e,b.player.atk*.25);
  }
  for(const mark of b.meteors)for(const e of living(b))if(W.distance(mark,e)<=1)damage(b,e,b.player.atk*1.8);
  b.meteors=[];b.tides=b.tides.map(t=>({...t,turns:t.turns-1})).filter(t=>t.turns>0);
  b.player.guard=false;b.player.ward=false;finish(b,now);
  if(b.status==='active'){
    b.turn++;if(b.turn>50){b.status='lost';b.phase='result';b.finishedAtMs=now;log(b,'交戰過久，先行撤離。');return;}
    b.moved=false;b.acted=false;b.phase='recharge';b.questions=[];b.answered=0;b.correctThisTurn=0;
    b.player.mana=Math.min(8,b.player.mana+1);planEnemies(b);
  }
}
function act(original,request,now=Date.now()) {
  const W=worldFor(original);
  const b=structuredClone(original);checkActive(b);
  if(Number(request.turn)!==b.turn||Number(request.revision)!==b.revision)fail('戰況已更新，請依目前畫面操作');
  const p=b.player;
  switch(request.command){
    case 'answer': {
      if(b.phase!=='recharge'||b.questions.length!==2||Number(request.index)!==b.answered)fail('此題已回答，或題目尚未就緒');
      const choice=Number(request.choice);if(!Number.isInteger(choice)||choice<0||choice>3)fail('請選擇一個答案');
      const q=b.questions[b.answered],correct=choice===q.answerIndex;
      b.lastReview={index:b.answered,correct,answerIndex:q.answerIndex,explanation:q.explanation};
      b.records.push({id:b.id+':'+b.turn+':'+b.answered,subject:q.subject,topic:q.topic,q:q.q,options:q.options,answerIndex:q.answerIndex,choice,correct,explanation:q.explanation,at:now});
      b.records=b.records.slice(-100);b.answered++;b.correctThisTurn+=Number(correct);if(correct)p.mana=Math.min(8,p.mana+1);
      if(b.answered===2)b.phase='command';break;
    }
    case 'skip': if(b.phase!=='recharge')fail('已完成本回合補能');b.answered=2;b.phase='command';log(b,'本回合略過剩餘補能，仍可自由移動、普攻或防守');break;
    case 'move': {
      checkAct(b);if(b.moved)fail('本回合已移動');
      const path=W.plan(p,request.target,{...options(b),maxSteps:2}).path;
      if(path.length<2||path.length>3)fail('每回合只能沿可通行路線移動兩格');
      Object.assign(p,path.at(-1));b.lastMove=path;b.moved=true;log(b,'移動 '+(path.length-1)+' 格');break;
    }
    case 'attack': {
      checkAct(b);if(b.acted)fail('本回合已使用主要行動');const e=targetEnemy(b,request.enemyId);
      if(W.distance(p,e)>1)fail('普攻需要站在敵人的相鄰格');
      // The existing trusted projection preserves realm, equipped artifacts, soul and divine branches.
      const charged=b.correctThisTurn>0;
      const hit=Authority.resolvePlayerAction(p,{roomId:b.id,actionId:b.turn,correct:charged,bossHp:e.hp,bossMaxHp:e.maxHp});
      Object.assign(p,hit.member);damage(b,e,hit.damage+(charged?0:p.atk));b.acted=true;break;
    }
    case 'guard': checkAct(b);if(b.acted)fail('本回合已使用主要行動');p.guard=true;b.acted=true;log(b,'凝神防守：本回合受到的傷害降低 55%');break;
    case 'mechanism':
      checkAct(b);if(b.acted)fail('本回合已使用主要行動');
      if(!b.mechanism?.active||W.distance(p,b.mechanism)>1)fail('請移動至陣眼旁');
      b.mechanism.active=false;for(const e of living(b)){e.shield=0;e.atk=Math.round(e.atk*.65);e.intent.damage=e.atk;}
      b.acted=true;log(b,'陣眼已解除，敵人的攻擊降低 35%，護盾消失');break;
    case 'skill': {
      checkAct(b);if(b.acted)fail('本回合已使用主要行動');const s=skill(b),type=p.goldenCore?.type||'basic';
      if(p.mana<s.cost)fail('靈力不足；仍可普攻或防守');
      if(type==='thunder'||type==='reverse'){
        p.guard=true;p.ward=true;if(type==='reverse')p.hp=Math.min(p.maxHp,p.hp+Math.round((p.maxHp-p.hp)*.3));
      }else if(type==='xingchen'){
        const t=request.target;if(!W.inside(t?.x,t?.y)||!cellsIn(b,p,4).some(c=>W.same(c,t)))fail('請選擇四格內的落星地點');
        b.meteors.push({...t});log(b,'落星已標記；敵人移動後落下');
      }else if(type==='taichu'){
        const heal=Math.min(p.maxHp-p.hp,Math.round(p.maxHp*.2));p.hp+=heal;log(b,'太初生息，回復 '+heal+' 生命');
        if(request.enemyId&&p.innateAbility?.branch==='devour'){const e=targetEnemy(b,request.enemyId);if(W.distance(p,e)<=3)damage(b,e,heal*Math.min(.3,.03*p.innateAbility.level));}
      }else{
        const e=targetEnemy(b,request.enemyId);if(W.distance(p,e)>s.range)fail('目標超出神通範圍');
        if(type==='sword'){
          const path=W.approach(p,e,{...options(b),maxSteps:3}).path;
          if(!path.length||path.length>4)fail('找不到三格內可突進的空位');Object.assign(p,path.at(-1));b.lastMove=path;
        }
        if(type==='wugou'){e.shield=0;e.stunned=true;b.tides=[];b.meteors=[];if(b.mechanism?.active&&W.distance(p,b.mechanism)<=3)b.mechanism.active=false;}
        damage(b,e,p.atk*(type==='sword'?1.7:type==='wugou'?1.2:1.4));
        if(type==='ocean'){
          const dx=e.x-p.x,dy=e.y-p.y,push=Math.abs(dx)>=Math.abs(dy)?{x:e.x+Math.sign(dx),y:e.y}:{x:e.x,y:e.y+Math.sign(dy)};
          if(W.walkable(push.x,push.y,options(b,e.id))&&!W.same(push,p))Object.assign(e,push);
          b.tides.push({cells:cellsIn(b,e,1),turns:2});
        }
      }
      p.mana-=s.cost;b.acted=true;log(b,'施展 '+s.name);break;
    }
    case 'end': endTurn(b,now);break;
    case 'retreat': b.status='retreated';b.phase='result';b.finishedAtMs=now;log(b,'已退出局部戰場，探索進度保留');break;
    default: fail('未知的戰棋操作');
  }
  finish(b,now);b.revision++;return b;
}
function view(b) {
  const W=worldFor(b);
  if(!b)return null;
  const out=structuredClone(b);out.questions=(out.questions||[]).map((q,i)=>({q:q.q,options:q.options,subject:q.subject,topic:q.topic,index:i}));
  out.records=undefined;out.skill=skill(b);out.reachable=b.status==='active'&&b.phase==='command'&&!b.moved?W.reachable(b.player,{...options(b),maxSteps:2}).cells:[];
  // Only the owner's battle response contains this view; never broadcast combat stats in presence.
  return out;
}
module.exports={SKILLS,skill,createBattle,act,view,planEnemies,options};

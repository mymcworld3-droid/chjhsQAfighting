const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../public/world/world-core.js'),B=require('../world-battle.cjs'),Q=require('../world-questions.cjs');
const {trustedRaidPlayerSnapshot}=require('../raid-authority.cjs');
function battle(type=''){
  const user={displayName:'修士',stats:{attack:200,maxHp:1000,totalScore:type?68:0},cultivationTraining:{equippedCore:type?{type,grade:3}:null,coreEnabled:true}};
  const b=B.createBattle({x:18,y:23},W.object('wolf'),trustedRaidPlayerSnapshot(user,'u1'),{},Date.now());
  b.questions=Q.fallback(b,{subject:'數學'});return b;
}
const action=(b,command,extra={})=>B.act(b,{command,turn:b.turn,revision:b.revision,...extra});
function commandReady(b,correct=false){for(let i=0;i<2;i++)b=action(b,'answer',{index:i,choice:correct?b.questions[i].answerIndex:(b.questions[i].answerIndex+1)%4});return b;}
test('two wrong answers still permit movement, a normal attack and defending, with no mana deduction',()=>{
  let b=commandReady(battle());assert.equal(b.player.mana,1);assert.equal(b.phase,'command');
  const p=B.view(b).reachable.find(p=>W.distance(p,b.player)===1&&!W.same(p,b.enemies[0]));assert.ok(p);
  const moved=action(b,'move',{target:p});assert.ok(moved.moved);assert.equal(moved.acted,false);
  const attacked=action(b,'attack',{enemyId:'enemy-1'});assert.ok(attacked.enemies[0].hp<b.enemies[0].hp);assert.ok(attacked.acted);
  assert.ok(action(b,'guard').player.guard);
});
test('correct answers provide extra mana; public questions never disclose correct answers',()=>{
  const original=battle(),view=B.view(original);assert.ok(!('answerIndex' in view.questions[0]));assert.equal(view.records,undefined);
  const b=commandReady(original,true);assert.equal(b.player.mana,3);assert.equal(b.records.length,2);
  assert.throws(()=>action(b,'answer',{index:0,choice:0}));
});
test('movement uses actual path cost, enforces occupancy and can occur before or after action',()=>{
  let b=commandReady(battle());assert.throws(()=>action(b,'move',{target:{x:b.player.x,y:b.player.y+3}}));
  assert.throws(()=>action(b,'move',{target:b.enemies[0]}));
  b=action(b,'guard');const dest=B.view(b).reachable.find(p=>W.distance(p,b.player)>0);b=action(b,'move',{target:dest});assert.ok(b.acted&&b.moved);
  assert.throws(()=>action(b,'move',{target:{x:18,y:23}}));assert.throws(()=>action(b,'guard'));
});
test('identical answers have different damage outcomes when the player dodges the announced strike',()=>{
  const b=commandReady(battle()),standing=action(b,'end');
  const safe=B.view(b).reachable.find(p=>!b.enemies[0].intent.cells.some(c=>W.same(c,p))&&W.distance(p,b.player)>0);
  const dodging=action(action(b,'move',{target:safe}),'end');assert.ok(standing.player.hp<dodging.player.hp);assert.equal(dodging.player.hp,b.player.hp);
});
test('starfall rewards predicting the enemy next tile rather than clicking anywhere',()=>{
  let b=commandReady(battle('xingchen'),true);const e=b.enemies[0],predicted={...e.nextMove};
  const hit=action(action(b,'skill',{target:predicted}),'end');
  const empty=B.view(b).reachable.find(p=>W.distance(p,predicted)>1&&W.distance(p,b.player)<=4);
  const miss=action(action(b,'skill',{target:empty}),'end');assert.ok(hit.enemies[0].hp<miss.enemies[0].hp);
});
test('all cultivators have the same basic mechanism solution; stale commands cannot replay',()=>{
  let b=commandReady(battle());b.mechanism={x:b.player.x+1,y:b.player.y,active:true};b.enemies[0].shield=200;
  const next=action(b,'mechanism');assert.equal(next.enemies[0].shield,0);assert.ok(next.enemies[0].atk<b.enemies[0].atk);
  assert.throws(()=>B.act(next,{command:'guard',turn:b.turn,revision:b.revision}));
});
test('reviewed fallback has four unique options, a valid answer and two distinct questions',()=>{
  for(const subject of ['數學','國文','英文','物理','化學','生物','歷史','公民']){
    const questions=Q.fallback(battle(),{subject});assert.notEqual(questions[0].q,questions[1].q);
    for(const q of questions){assert.equal(new Set(q.options).size,4);assert.ok(q.answerIndex>=0&&q.answerIndex<4);assert.ok(q.explanation);}
  }
});

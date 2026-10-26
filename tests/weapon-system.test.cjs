'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../public/cultivation/weapon-system-rules.js'),R=require('../public/cultivation/tactical-rules.js');
const api=require('../weapon-armory-api.cjs').__test,tactical=require('../tactical-combat-api.cjs').__test;
const {fakeDb}=require('./helpers/inventory-db.cjs');
const user=()=>({uid:'u1',stats:{totalScore:30,gold:100000,attack:200,maxHp:1000},soulboundDrawTickets:3,forgeFragments:1200});
const request=(id,extra={})=>({requestId:'weapon-operation-'+id,...extra});
const op=(db,action,id,extra={})=>api.transact(db,'u1',action,request(id,extra));
const draw=(db,id,{payment='free',types=['bow'],...body}={})=>{let i=0;return api.transact(db,'u1','draw',request(id,{payment,count:types.length,poolVersion:W.DRAW_VERSION,expectedCost:W.drawCost(payment,types.length),...body}),now,()=>{const type=types[i++%types.length];return W.TYPES.findIndex(t=>t.id===type)/5;});};
const armory=db=>db.docs.get('weaponArmories/u1');
const now=2000000000000;
function battlefield(type){const s=R.create({id:'weapons',players:[{uid:'u1',atk:200,maxHp:1000,weapon:{type,realm:0}}],now});s.width=s.height=9;s.blocks=[];s.actors=[s.actors[0]];Object.assign(s.actors[0],{x:4,y:4,stamina:10});return s;}
function target(s,x,y,extra={}){const a=R.actor({uid:'m'+s.actors.length,bot:true,team:'monster',atk:100,maxHp:2000,...extra},{x,y});s.actors.push(a);return a;}

test('ten named weapon realms migrate legacy levels without losing copies or attack investment',()=>{
  assert.deepEqual(W.TYPES.map(t=>t.label),['弓','槍','劍','刀','錘']);assert.equal(new Set(W.TYPES.map(t=>t.id)).size,5);
  const raw={equipped:'sword',weapons:{sword:{level:999,copies:2},forged:{level:99,copies:9}}},s=W.normalize(raw);
  assert.equal(s.version,2);assert.deepEqual(s.weapons.sword,{realm:9,copies:2});assert.equal(s.weapons.forged,undefined);assert.equal(W.attackMultiplier(W.snapshot(s)),1.225);
  assert.deepEqual(W.REALMS.map(r=>r.name),['煉氣','築基','金丹','元嬰','化神','煉虛','合體','渡劫','半仙','真仙']);
  assert.deepEqual([0,3,6].map(W.mergeCost),[1,2,3]);assert.equal(W.goldCost(2),2700);assert.equal(raw.weapons.sword.level,999);
  for(let level=1;level<=10;level++){
    const legacy={type:'sword',level},state=W.normalize({equipped:'sword',weapons:{sword:{level,copies:3}}});
    assert.equal(state.weapons.sword.realm,level-1);assert.equal(W.attackMultiplier(W.snapshot(state)),W.attackMultiplier(legacy));
    assert.equal(R.actor({uid:'u1',weapon:legacy},{x:0,y:0}).weapon.realm,level-1);
  }
  assert.equal(W.normalize({weapons:{bow:{realm:-5,copies:1}}}).weapons.bow.realm,0);
});
test('bow has a square five-cell range including corners and adjacent cells, and hits one enemy',()=>{
  const s=battlefield('bow');s.width=s.height=13;Object.assign(s.actors[0],{x:6,y:6});
  const near=target(s,7,6),far=target(s,11,11),outside=target(s,12,6),friend=target(s,6,7,{team:s.actors[0].team});
  const next=R.apply(s,'u1',{type:'attack',x:11,y:11},now);assert.equal(next.actors.find(a=>a.uid===far.uid).hp,1830);assert.equal(next.actors.find(a=>a.uid===near.uid).hp,2000);
  assert.equal(next.actors[0].stamina,8);assert.equal(R.aimCells(s,s.actors[0],R.basicFor(s.actors[0])).length,120);
  assert.equal(R.apply(s,'u1',{type:'attack',x:near.x,y:near.y},now).actors[1].hp,1830);
  assert.throws(()=>R.apply(s,'u1',{type:'attack',x:outside.x,y:outside.y},now),/範圍/);
  assert.throws(()=>R.apply(s,'u1',{type:'attack',x:friend.x,y:friend.y},now),/敵人/);
  s.blocks=[{x:8,y:8}];assert.throws(()=>R.apply(s,'u1',{type:'attack',x:11,y:11},now),/視線/);
});
test('spear pierces exactly four forward cells in all cardinal directions and stops at walls',()=>{
  for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
    const s=battlefield('spear');s.width=s.height=11;Object.assign(s.actors[0],{x:5,y:5});for(let i=1;i<=5;i++)target(s,5+dx*i,5+dy*i);
    const p={x:5+dx,y:5+dy},next=R.apply(s,'u1',{type:'attack',...p},now);
    assert.deepEqual(next.actors.slice(1).map(a=>2000-a.hp),[180,180,180,180,0]);assert.equal(next.actors[0].stamina,8);assert.equal(next.actors[0].attacks,1);
    assert.throws(()=>R.apply(s,'u1',{type:'attack',x:6,y:6},now),/同一行|範圍/);
    s.blocks=[{x:5+dx*2,y:5+dy*2}];assert.equal(R.skillCells(s,s.actors[0],R.basicFor(s.actors[0]),p).length,1);
  }
});
for(const [type,depth,width,hp,cost]of [['sword',3,3,1800,2],['saber',2,5,1770,3]])test(type+' hits its complete forward rectangle in each direction with one stamina charge',()=>{
  for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
    const s=battlefield(type),expected=[];
    for(let step=1;step<=depth;step++)for(let i=-(width-1)/2;i<=(width-1)/2;i++){const p={x:4+dx*step-dy*i,y:4+dy*step+dx*i};expected.push(R.key(p));target(s,p.x,p.y);}
    target(s,4-dx,4-dy);target(s,4+dx*(depth+1),4+dy*(depth+1));
    const p={x:4+dx,y:4+dy},cells=R.skillCells(s,s.actors[0],R.basicFor(s.actors[0]),p),next=R.apply(s,'u1',{type:'attack',...p},now);
    assert.deepEqual(cells.map(R.key).sort(),expected.sort());assert.equal(new Set(cells.map(R.key)).size,depth*width);
    assert.deepEqual(next.actors.slice(1).map(a=>a.hp),[...Array(depth*width).fill(hp),2000,2000]);assert.equal(next.actors[0].stamina,10-cost);assert.equal(next.actors[0].attacks,1);assert.equal(next.actors[0].hp,1000);
    const diagonal={x:4+dx*2-dy,y:4+dy*2+dx};assert.doesNotThrow(()=>R.validateSkill(s,s.actors[0],R.basicFor(s.actors[0]),diagonal));
    s.blocks=[p];assert.throws(()=>R.apply(s,'u1',{type:'attack',...p},now),/範圍/);
    const blockedCells=R.skillCells(s,s.actors[0],R.basicFor(s.actors[0]),p);assert.equal(blockedCells.some(c=>R.key(c)===R.key(p)),false);assert.equal(blockedCells.some(c=>c.x===4+dx*2&&c.y===4+dy*2),false);
  }
});
test('hammer hits all eight surrounding cells including diagonals, excluding self, at one stamina cost',()=>{
  const s=battlefield('hammer');for(let y=3;y<=5;y++)for(let x=3;x<=5;x++)if(x!==4||y!==4)target(s,x,y);target(s,6,4);
  const next=R.apply(s,'u1',{type:'attack',x:4,y:4},now);
  assert.deepEqual(next.actors.slice(1).map(a=>a.hp),[...Array(8).fill(1700),2000]);assert.equal(next.actors[0].hp,1000);assert.equal(next.actors[0].stamina,7);assert.equal(next.actors[0].attacks,1);
  assert.throws(()=>R.apply(s,'u1',{type:'attack',x:6,y:4},now),/範圍/);
});
test('hammer breaks shields faster without multiplying health damage',()=>{
  const s=battlefield('hammer');target(s,5,4,{shield:600});target(s,6,4);let next=R.apply(s,'u1',{type:'attack',x:5,y:4},now);
  assert.equal(next.actors[1].shield,150);assert.equal(next.actors[1].hp,2000);assert.equal(next.actors[0].stamina,7);
  next=R.apply(next,'u1',{type:'attack',x:5,y:4},now);assert.equal(next.actors[1].shield,0);assert.equal(next.actors[1].hp,1800);
});
test('preview aiming and server validation agree at map edges and behind obstacles for every weapon',()=>{
  for(const {id}of W.TYPES)for(const [x,y]of [[0,0],[4,4]]){
    const s=battlefield(id),a=s.actors[0];Object.assign(a,{x,y});s.blocks=[{x:x+1,y},{x:x+2,y:y+1}];
    for(let py=0;py<s.height;py++)for(let px=0;px<s.width;px++)if(px!==x||py!==y)target(s,px,py);
    const sk=R.basicFor(a),shown=new Set(R.aimCells(s,a,sk).map(R.key));
    for(let py=-1;py<=s.height;py++)for(let px=-1;px<=s.width;px++){
      const p={x:px,y:py};let allowed=true;try{R.validateSkill(s,a,sk,p);}catch(_){allowed=false;}
      assert.equal(allowed,shown.has(R.key(p))||id==='hammer'&&px===x&&py===y,id+' @ '+R.key(a)+' → '+R.key(p));
    }
  }
});
test('upgrading a weapon increases trial damage without inflating the same stage monsters',()=>{
  const create=realm=>R.create({id:'same-stage',players:[{uid:'u1',atk:Math.round(200*W.attackMultiplier({type:'sword',realm})),maxHp:1000,enemyScaleAttack:200,weapon:{type:'sword',realm}}],trial:{seed:'1234567890abcdef1234567890abcdef',stage:12},now});
  const first=create(0),upgraded=create(9);assert.equal(upgraded.actors[0].atk,245);assert.deepEqual(upgraded.actors.slice(1),first.actors.slice(1));
});
test('weapon view and random draws open at Foundation, including saved access after a deduction',async()=>{
  const player=user();player.stats.totalScore=5;
  const db=fakeDb(player),before=structuredClone([...db.docs]);
  await assert.rejects(api.transact(db,'u1'),error=>error.status===403);
  await assert.rejects(draw(db,'locked'),error=>error.status===403);
  assert.deepEqual([...db.docs],before);
  db.docs.get('users/u1').stats.totalScore=6;
  assert.equal((await api.transact(db,'u1')).playerRealmScore,6);
  assert.equal((await draw(db,'foundation')).state.weapons.bow.copies,1);
  Object.assign(db.docs.get('users/u1'),{stats:{...player.stats,totalScore:0},trainingAccess:{version:1,highestRealmScore:6}});
  assert.equal((await draw(db,'saved-foundation',{payment:'ticket'})).state.weapons.bow.copies,2);
});
test('free random draw, chest draws and equipment use server inventory, with exactly one equipped weapon',async()=>{
  const db=fakeDb(user());const before=await api.transact(db,'u1');assert.equal(before.state.starterClaimed,false);assert.equal(db.docs.size,1,'ordinary views do not initialize or mutate assets');
  await draw(db,'starter',{payment:'free',types:['bow']});assert.equal(armory(db).equipped,'bow');
  await assert.rejects(draw(db,'starter-2',{payment:'free',types:['sword']}),/已使用/);
  await assert.rejects(op(db,'equip','unowned',{type:'hammer'}),/尚未持有/);
  await op(db,'exchange-ticket','ticket');await draw(db,'open',{payment:'chest',types:['hammer']});await op(db,'equip','equip',{type:'hammer'});
  assert.equal(armory(db).equipped,'hammer');assert.deepEqual(Object.keys(armory(db).weapons).sort(),['bow','hammer']);assert.equal(db.docs.get('users/u1').soulboundDrawTickets,2);
});
test('promotion consumes both copies and gold; retries and concurrent requests cannot spend or promote twice',async()=>{
  const db=fakeDb(user());await draw(db,'starter',{payment:'free',types:['sword']});
  await op(db,'exchange-ticket','ticket-1');await draw(db,'open-1',{payment:'chest',types:['sword']});
  const req=request('promote',{type:'sword',expectedRealm:0,cost:1,realm:99,playerRealmScore:99999,copiesSpent:0});
  const first=await api.transact(db,'u1','upgrade',req),retry=await api.transact(db,'u1','upgrade',req);
  assert.equal(first.state.weapons.sword.realm,1);assert.equal(retry.state.weapons.sword.realm,1);assert.equal(retry.replayed,true);assert.equal(db.docs.get('users/u1').stats.gold,99700);assert.equal(armory(db).weapons.sword.copies,1);
  assert.deepEqual(first.result,{action:'upgrade',realm:1,type:'sword',copiesSpent:1,goldSpent:300});
  await assert.rejects(api.transact(db,'u1','upgrade',{...req,payment:'merge'}),/識別碼/);
  await op(db,'exchange-ticket','ticket');await draw(db,'open',{payment:'chest',types:['sword']});
  const attempts=await Promise.allSettled([op(db,'upgrade','promote-a',{type:'sword',expectedRealm:1}),op(db,'upgrade','promote-b',{type:'sword',expectedRealm:1})]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(armory(db).weapons.sword.realm,2);assert.equal(armory(db).weapons.sword.copies,1);assert.equal(db.docs.get('users/u1').stats.gold,98500);
});
test('insufficient copies, insufficient gold and old alternative payments leave every asset and receipt untouched',async()=>{
  const db=fakeDb(user());await draw(db,'starter',{payment:'free',types:['sword']});
  const unchanged=async(input,pattern)=>{const before=structuredClone([...db.docs]);await assert.rejects(op(db,'upgrade','rejected',input),pattern);assert.deepEqual([...db.docs],before);};
  await unchanged({type:'sword',expectedRealm:0},/副本|保留/);
  armory(db).weapons.sword.copies=2;db.docs.get('users/u1').stats.gold=299;
  await unchanged({type:'sword',expectedRealm:0},/靈石不足/);
  db.docs.get('users/u1').stats.gold=100000;
  for(const payment of ['gold','merge'])await unchanged({type:'sword',payment,expectedRealm:0},/改為境界/);
  await unchanged({type:'sword',payment:'gold',expectedLevel:1},/改為境界/);
  await unchanged({type:'sword',expectedRealm:1},/境界已更新/);
});
test('every target realm requires its attained player threshold and the exact server-priced resources',async()=>{
  for(let realm=0;realm<8;realm++){
    const next=W.REALMS[realm+1],u=user();u.stats.totalScore=next.need-1;
    const db=fakeDb(u);db.docs.set('weaponArmories/u1',{equipped:'sword',weapons:{sword:{realm,copies:20}}});
    const before=structuredClone([...db.docs]);
    await assert.rejects(op(db,'upgrade','gate',{type:'sword',expectedRealm:realm,playerRealmScore:99999,canAscendToImmortal:true}),/修為|需先達到/);
    assert.deepEqual([...db.docs],before);
    db.docs.get('users/u1').stats.totalScore=next.need;
    const promoted=await op(db,'upgrade','gate',{type:'sword',expectedRealm:realm,gold:0,copies:0});
    assert.equal(promoted.state.weapons.sword.realm,realm+1);assert.equal(promoted.state.weapons.sword.copies,20-W.mergeCost(realm));assert.equal(promoted.balance,100000-W.goldCost(realm));
  }
});
test('attained realm access survives current score reduction and legacy conversion preserves all investment',async()=>{
  const u=user();u.stats.totalScore=6;u.trainingAccess={version:1,highestRealmScore:28};
  const db=fakeDb(u);db.docs.set('weaponArmories/u1',{version:1,equipped:'bow',weapons:{bow:{level:2,copies:2}}});
  const view=await api.transact(db,'u1');assert.equal(view.playerRealmScore,28);assert.deepEqual(view.state.weapons.bow,{realm:1,copies:2});
  const result=await op(db,'upgrade','migration',{type:'bow',expectedRealm:1});assert.deepEqual(result.state.weapons.bow,{realm:2,copies:1});assert.equal(result.balance,98800);
});
test('true immortal promotion trusts the current cohort seat instead of client fields or an unrelated seat',async()=>{
  const u=user();u.stats.totalScore=1868;u.profile={educationLevel:'國中一年級'};
  const db=fakeDb(u);db.docs.set('weaponArmories/u1',{equipped:'hammer',weapons:{hammer:{realm:8,copies:4}}});
  const req={type:'hammer',expectedRealm:8,canAscendToImmortal:true};
  const denied=async()=>{const before=structuredClone([...db.docs]);await assert.rejects(op(db,'upgrade','immortal',req),/真仙席位/);assert.deepEqual([...db.docs],before);};
  assert.equal((await api.transact(db,'u1')).canAscendToImmortal,false);await denied();
  db.docs.set('worldImmortals/elementary__ru-xian',{uid:'u1',cohort:'elementary'});await denied();
  db.docs.set('worldImmortals/junior__ru-xian',{uid:'u1',cohort:'elementary'});await denied();
  db.docs.set('worldImmortals/junior__ru-xian',{uid:'u2',cohort:'junior'});await denied();
  db.docs.set('worldImmortals/junior__ru-xian',{uid:'u1',cohort:'junior'});
  const promoted=await op(db,'upgrade','immortal',req);assert.equal(promoted.canAscendToImmortal,true);assert.deepEqual(promoted.state.weapons.hammer,{realm:9,copies:1});assert.equal(promoted.balance,75700);
  await assert.rejects(op(db,'upgrade','maximum',{type:'hammer',expectedRealm:9}),/最高境界/);
});
test('already committed legacy upgrade receipts replay after migration without charging the new combined price',async()=>{
  const crypto=require('node:crypto'),db=fakeDb(user()),req=request('legacy-retry',{type:'sword',payment:'gold',expectedLevel:1});
  db.docs.set('weaponArmories/u1',{version:1,equipped:'sword',weapons:{sword:{level:2,copies:1}}});db.docs.get('users/u1').stats.gold=99700;
  db.docs.set('weaponArmoryReceipts/'+api.key('u1',req.requestId),{uid:'u1',signature:crypto.createHash('sha256').update(JSON.stringify(['upgrade','sword','gold',1])).digest('hex'),result:{action:'upgrade',type:'sword',level:2,goldSpent:300}});
  const before=structuredClone([...db.docs]),result=await api.transact(db,'u1','upgrade',req);assert.equal(result.replayed,true);assert.deepEqual(result.state.weapons.sword,{realm:1,copies:1});assert.deepEqual([...db.docs],before);
});
test('database failure and transaction retries leave no partial payment, receipt or upgrade',async()=>{
  const db=fakeDb(user());await draw(db,'starter',{payment:'free',types:['sword']});armory(db).weapons.sword.copies=2;const run=db.runTransaction,before=structuredClone([...db.docs]);
  db.runTransaction=fn=>run(async tx=>{const set=tx.set;tx.set=(ref,value)=>{if(ref.key.startsWith('weaponArmoryReceipts/'))throw Error('lost database');set(ref,value);};return fn(tx);});
  await assert.rejects(op(db,'upgrade','retry',{type:'sword',expectedRealm:0}),/lost database/);assert.deepEqual([...db.docs],before);
  db.runTransaction=run;db.retryNextTransaction();await op(db,'upgrade','retry',{type:'sword',expectedRealm:0});assert.equal(armory(db).weapons.sword.realm,1);assert.equal(armory(db).weapons.sword.copies,1);assert.equal(db.docs.get('users/u1').stats.gold,99700);
});
test('trial entitlements come from server progress and milestone bonuses are paid exactly once',async()=>{
  const db=fakeDb(user());db.docs.set('tacticalBattlePlayers/u1',{trial:{best:5}});
  const before=await api.transact(db,'u1');assert.equal(before.pendingTrialChests,6);
  await op(db,'claim-trial','trial',{stage:999});assert.equal(armory(db).chests,6);
  await assert.rejects(op(db,'claim-trial','again'),/待領/);await op(db,'claim-trial','trial');assert.equal(armory(db).chests,6);
  db.docs.get('tacticalBattlePlayers/u1').trial.best=6;await op(db,'claim-trial','next');assert.equal(armory(db).chests,7);
});
test('legacy transfer archives equipment and a pending job, preserves other items, refunds costs and cannot replay rewards',async()=>{
  const u=user();u.artifactSystem={inventory:{'soul-sword-golden-core':1,'consumable-unknown':2},equipped:{'本命法寶':'soul-sword-golden-core'}};
  u.materialSystem={inventory:{'qi-spirit-iron':3,'unknown-growth-resource':9}};
  u.refineryJobV1={id:'old-job',currency:'forgeFragments',fragmentCost:600,recipe:[{artifactId:'soul-sword-golden-core',quantity:1},{materialId:'qi-spirit-wood',quantity:2}]};
  const db=fakeDb(u),preview=await api.transact(db,'u1');assert.equal(preview.legacy.chests,2);assert.equal(preview.legacy.gold,50);
  const result=await op(db,'convert-legacy','legacy');assert.equal(result.state.chests,2);assert.equal(result.legacy.equipmentCopies,0);assert.equal(result.legacy.pendingJob,false);
  const saved=db.docs.get('users/u1');assert.equal(saved.stats.gold,100050);assert.equal(saved.forgeFragments,1800);assert.equal(saved.refineryJobV1,null);assert.equal(saved.materialSystem.inventory['unknown-growth-resource'],9);assert.equal(saved.artifactSystem.inventory['consumable-unknown'],2);
  assert.equal([...db.docs.keys()].filter(k=>k.startsWith('weaponLegacyArchives/')).length,1);
  await op(db,'convert-legacy','legacy');assert.equal(armory(db).chests,2);await assert.rejects(op(db,'convert-legacy','other'),/沒有可轉換/);
});
test('live tactical loadouts ignore forged client weapons and old equipment bonuses; upgrades apply only to new rooms',async()=>{
  const {database}=require('./helpers/tactical-db.cjs'),db=database();db.records.get('users/u1').stats.gold=100000;
  db.records.get('users/u1').artifactSystem={inventory:{'soul-sword-golden-core':1},equipped:{'本命法寶':'soul-sword-golden-core'}};
  await draw(db,'start',{types:['hammer']});db.records.get('weaponArmories/u1').weapons.hammer.copies=3;
  await api.transact(db,'u1','upgrade',request('upgrade',{type:'hammer',expectedRealm:0}));
  const s=await tactical.start(db,'u1',{mode:'pve',weapon:{type:'bow',realm:99},atk:99999},now);
  assert.equal(s.actors[0].weapon.type,'hammer');assert.equal(s.actors[0].weapon.realm,1);assert.equal(s.actors[0].atk,205);assert.equal(s.actors[0].shield,0);
  await api.transact(db,'u1','upgrade',request('upgrade-3',{type:'hammer',expectedRealm:1}));
  assert.equal((await tactical.state(db,'u1',now)).actors[0].weapon.realm,1,'in-progress room snapshots are immutable');
  db.records.get('users/u1').weaponSystemV1={equipped:'bow',weapons:{bow:{realm:99,copies:99}}};
  const trusted=await require('../raid-authority.cjs').loadTrustedRaidPlayer(db,'u1');assert.equal(trusted.weapon.type,'hammer');assert.equal(trusted.weapon.realm,2);assert.equal(trusted.atk,210);assert.equal(trusted.artifactShield,0);
});
test('trial victory commits milestone chests with progress and rewards, including lost-response retries',async()=>{
  const {database}=require('./helpers/tactical-db.cjs'),db=database(),s=await tactical.start(db,'u1',{mode:'pve'},now),raw=db.records.get(tactical.ROOMS+'/'+s.id);
  raw.trial.stage=5;db.records.get(tactical.PLAYERS+'/u1').trial.stage=5;raw.blocks=[];raw.actors[0].correct=1;raw.actors[0].answered=1;
  Object.assign(raw.actors[0],{x:1,y:3});
  Object.assign(raw.actors[1],{x:2,y:3,hp:1});
  const input={roomId:s.id,revision:raw.revision,type:'attack',x:2,y:3,requestId:'weapons-trial-kill'};
  const won=await tactical.command(db,'u1',input,now),retry=await tactical.command(db,'u1',input,now);
  assert.equal(won.weaponRewards.u1.chests,6);assert.equal(retry.weaponRewards.u1.chests,6);assert.equal(db.records.get('weaponArmories/u1').chests,6);assert.equal(db.records.get(tactical.PLAYERS+'/u1').trial.stage,6);
});
test('ordinary browser access cannot read or mutate authoritative weapons, receipts or legacy archives',()=>{
  const {mayRead,authorizeWrite}=require('../d1-browser-api.cjs');
  for(const col of ['weaponArmories','weaponArmoryReceipts','weaponLegacyArchives']){
    assert.equal(mayRead({role:'A',path:col+'/u1',data:{uid:'u1'},uid:'u1',admin:false}),false);
    assert.throws(()=>authorizeWrite({role:'A',path:col+'/u1',before:null,after:{uid:'u1'},operation:'set',context:{uid:'u1',admin:false}}),/無權/);
  }
});

test('draw pool maps five equal intervals to the five weapon types and rejects invalid random values',()=>{
  for(let i=0;i<5;i++){assert.equal(W.roll(()=>i/5).type,W.TYPES[i].id);assert.equal(W.roll(()=>(i+1)/5-1e-8).type,W.TYPES[i].id);}
  for(const value of [-1,1,NaN,Infinity])assert.throws(()=>W.roll(()=>value),/亂數/);
  assert.equal(W.drawCost('gold',5),2500);assert.equal(W.drawCost('fragments',1),600);assert.equal(W.drawCost('free',5),null);assert.equal(W.drawCost('__proto__',1),null);
  assert.equal(W.normalize({lastDraw:{action:'draw',requestId:'x',payment:'gold',count:1,results:'x'}}).lastDraw,null);
});
test('free draw is random, cannot be selected by the client, and is granted once per player',async()=>{
  const db=fakeDb(user());const payload=await draw(db,'free',{types:['spear'],type:'hammer',results:[{type:'hammer'}],seed:999});
  assert.deepEqual(payload.result.results,[{type:'spear',realm:0}]);assert.equal(payload.state.equipped,'spear');assert.equal(payload.balance,100000);assert.equal(payload.state.starterClaimed,true);
  const before=structuredClone([...db.docs]);await assert.rejects(draw(db,'free-again'),/免費抽取已使用/);assert.deepEqual([...db.docs],before);
  const legacy=fakeDb(user());legacy.docs.set('weaponArmories/u1',{starterClaimed:true,equipped:'bow',weapons:{bow:{level:2,copies:1}}});await assert.rejects(draw(legacy,'old-player-free'),/已使用/);
});
test('each draw payment atomically grants five server-rolled weapons and spends only the selected resource',async()=>{
  for(const payment of ['chest','ticket','gold','fragments']){
    const u=user();u.soulboundDrawTickets=10;u.forgeFragments=6000;const db=fakeDb(u);db.docs.set('weaponArmories/u1',{chests:10,equipped:'sword',weapons:{sword:{realm:3,copies:1}}});
    const payload=await draw(db,'five-'+payment,{payment,types:W.TYPES.map(t=>t.id)});
    assert.equal(payload.state.equipped,'sword');assert.deepEqual(payload.state.weapons.sword,{realm:3,copies:2});assert.equal(Object.keys(payload.state.weapons).length,5);
    assert.equal(payload.balance,payment==='gold'?97500:100000);assert.equal(payload.tickets,payment==='ticket'?5:10);assert.equal(payload.fragments,payment==='fragments'?3000:6000);assert.equal(payload.state.chests,payment==='chest'?5:10);
    assert.equal(payload.result.spent,W.drawCost(payment,5));assert.deepEqual(payload.state.lastDraw,payload.result);
    const view=await api.transact(db,'u1');assert.deepEqual(view.state.lastDraw,payload.result);
    await op(db,'equip','equip-after-draw',{type:'hammer'});assert.deepEqual(armory(db).lastDraw,payload.result,'last results survive other inventory operations');
  }
});
test('lost draw responses replay the same results without another random roll, resource payment or inventory grant',async()=>{
  const db=fakeDb(user()),body=request('retry-draw',{payment:'gold',count:5,poolVersion:W.DRAW_VERSION,expectedCost:2500});let rolls=0;
  const first=await api.transact(db,'u1','draw',body,now,()=>{rolls++;return .41;});const before=structuredClone([...db.docs]);
  const again=await api.transact(db,'u1','draw',body,now,()=>{throw Error('must not reroll');});assert.equal(again.replayed,true);assert.equal(rolls,5);assert.deepEqual(again.result,first.result);assert.deepEqual([...db.docs],before);assert.equal(armory(db).weapons.sword.copies,5);
  for(const patch of [{payment:'ticket'},{count:1},{expectedCost:1},{poolVersion:'old'}])await assert.rejects(api.transact(db,'u1','draw',{...body,...patch}),/識別碼/);
});
test('invalid draw requests, exhausted resources and retired selection routes cannot mutate assets',async()=>{
  const db=fakeDb({...user(),soulboundDrawTickets:0,forgeFragments:0});db.docs.get('users/u1').stats.gold=499;
  const denied=async(action,body,pattern)=>{const before=structuredClone([...db.docs]);await assert.rejects(op(db,action,'rejected-draw',body),pattern);assert.deepEqual([...db.docs],before);};
  for(const payment of ['ticket','gold','fragments','chest'])await denied('draw',{payment,count:1,poolVersion:W.DRAW_VERSION,expectedCost:W.drawCost(payment,1)},/不足/);
  for(const count of [0,2,10,'5',-5])await denied('draw',{payment:'gold',count,poolVersion:W.DRAW_VERSION,expectedCost:1},/單抽或五連抽/);
  await denied('draw',{payment:'free',count:5,poolVersion:W.DRAW_VERSION,expectedCost:0},/單抽或五連抽/);
  await denied('draw',{payment:'gold',count:1,poolVersion:'old',expectedCost:500},/已更新/);
  await denied('draw',{payment:'gold',count:1,poolVersion:W.DRAW_VERSION,expectedCost:0},/已更新/);
  for(const action of ['starter','open-chest'])await denied(action,{type:'sword'},/改為隨機抽取/);
});
test('concurrent draws cannot overspend and transaction failure leaves neither payment nor reward',async()=>{
  const db=fakeDb(user());db.docs.get('users/u1').stats.gold=500;
  const attempts=await Promise.allSettled([draw(db,'concurrent-a',{payment:'gold'}),draw(db,'concurrent-b',{payment:'gold'})]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(db.docs.get('users/u1').stats.gold,0);assert.equal(armory(db).weapons.bow.copies,1);
  const other=fakeDb(user()),run=other.runTransaction,before=structuredClone([...other.docs]);other.runTransaction=fn=>run(async tx=>{const set=tx.set;tx.set=(ref,value)=>{if(ref.key.startsWith('weaponArmoryReceipts/'))throw Error('database failed');set(ref,value);};return fn(tx);});
  await assert.rejects(draw(other,'failed',{payment:'gold'}),/database failed/);assert.deepEqual([...other.docs],before);
  other.runTransaction=run;other.retryNextTransaction();await draw(other,'failed',{payment:'gold'});assert.equal(other.docs.get('users/u1').stats.gold,99500);assert.equal(armory(other).weapons.bow.copies,1);
});
test('committed legacy selection receipts replay safely while uncommitted selections require random draws',async()=>{
  const crypto=require('node:crypto');for(const action of ['starter','open-chest']){
    const db=fakeDb(user()),body=request('old-selection',{type:'sword'});db.docs.set('weaponArmories/u1',{equipped:'sword',starterClaimed:true,weapons:{sword:{level:1,copies:1}}});
    const result={action,name:'青鋒劍'};db.docs.set('weaponArmoryReceipts/'+api.key('u1',body.requestId),{uid:'u1',signature:crypto.createHash('sha256').update(JSON.stringify([action,'sword','',null])).digest('hex'),result});
    const before=structuredClone([...db.docs]),replayed=await api.transact(db,'u1',action,body);assert.equal(replayed.replayed,true);assert.deepEqual(replayed.result,result);assert.deepEqual([...db.docs],before);
  }
});

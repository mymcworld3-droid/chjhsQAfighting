'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Manuals=require('../public/cultivation/manual-rules.js');
const Progress=require('../dungeon-manual-progression.cjs');
const Roll=require('../manual-reward-rules.cjs');
const Victory=require('../dungeon-victory-reward.cjs');
const Boss=require('../dungeon-boss-battle.cjs');
const Player=require('../dungeon-player-combat.cjs');
const fs=require('node:fs'),path=require('node:path');

const clone=value=>structuredClone(value);
function store(initial={}){
  const records=new Map(Object.entries(initial));
  let pending=Promise.resolve();
  const doc=(collection,id)=>({id,key:collection+'/'+id});
  return {
    records,collection:collection=>({doc:id=>doc(collection,id)}),
    runTransaction(fn){
      const run=pending.then(async()=>{
        const writes=new Map();let writing=false;
        const tx={
          get:async ref=>{
            assert.equal(writing,false,'read before write');
            return {exists:records.has(ref.key),
              data:()=>clone(records.get(ref.key))};
          },
          set(ref,value){writing=true;writes.set(ref.key,clone(value));},
          update(ref,value){
            writing=true;
            const state=clone(writes.get(ref.key)||records.get(ref.key)||{});
            for(const [field,entry] of Object.entries(value)){
              const keys=field.split('.');let obj=state;
              for(const key of keys.slice(0,-1))obj=obj[key]||={};
              obj[keys.at(-1)]=clone(entry);
            }
            writes.set(ref.key,state);
          }
        };
        const result=await fn(tx);
        for(const [key,value] of writes)records.set(key,value);
        return result;
      });
      pending=run.catch(()=>{});return run;
    }
  };
}
const book=()=>({version:2,school:'sword',
  books:{'sword-wind':{exp:0}},equipped:['wind-slash'],
  loadouts:[{name:'劍訣',skillIds:['wind-slash']}],
  activeLoadout:0,starterClaimed:true,dropMisses:0});
const session=1800000000000;
const room=(manualExp={})=>({mode:'dungeon',version:1,
  assembledAtMs:session,manualProgressSession:session,manualExp});
const key='sword-wind';

test('foundation dungeon uses EXACT trial beast realm and 35 EXP for a killing blow',()=>{
  assert.equal(Progress.STAGE,5);
  assert.equal(Progress.REALM,Manuals.realmForStage(5).name);
  assert.equal(Manuals.expForBeast(Progress.STAGE),35);
  const source={enemies:[
    {id:'beast-1',realmStage:5},{id:'beast-2',realmStage:5},
    {id:'guardian-1',realmStage:5}
  ]};
  const resolved={enemies:[source.enemies[1]],result:{hits:[
    {enemyId:'beast-1',defeated:true},
    {enemyId:'beast-1',defeated:true},
    {enemyId:'guardian-1',defeated:true}
  ]}};
  const award=Progress.recordKills(source,resolved,'a','wind-slash');
  assert.deepEqual(award.award.enemyIds,['beast-1','guardian-1']);
  assert.equal(award.award.exp,70);
  assert.equal(award.award.kills,2);
  assert.equal(award.award.bookId,key);
  assert.equal(award.ledger.a[key],70);
  assert.equal(source.manualExp,undefined,'C source room must remain immutable');
  assert.equal(Progress.recordKills(source,{...resolved,duplicate:true},'a','wind-slash'),null);
  assert.equal(Progress.recordKills(source,resolved,'a','forged-skill'),null);
  assert.equal(Progress.recordKills(source,
    {enemies:source.enemies,result:{hits:resolved.result.hits}},'a','wind-slash'),null);
});

test('account EXP receipt is retry-safe, concurrent-safe, incremental and personal',async()=>{
  const db=store({'tacticalManuals/a':book(),
    'tacticalManuals/b':book()});
  const r=room({a:{[key]:35},b:{[key]:70}});
  const [first,again]=await Promise.all([
    Progress.claim(db,'dungroomA123456',r,'a'),
    Progress.claim(db,'dungroomA123456',r,'a')
  ]);
  assert.deepEqual([first.credited[key]||0,again.credited[key]||0].sort((a,b)=>a-b),
    [0,35]);
  assert.equal(db.records.get('tacticalManuals/a').books[key].exp,35);
  assert.equal(db.records.get('tacticalManuals/b').books[key].exp,0);
  const higher=room({a:{[key]:105},b:{[key]:70}});
  assert.equal((await Progress.claim(db,'dungroomA123456',higher,'a')).credited[key],70);
  assert.equal(db.records.get('tacticalManuals/a').books[key].exp,105);
  assert.deepEqual((await Progress.claim(db,'dungroomA123456',r,'a')).credited,{});
  assert.equal(db.records.get('tacticalManuals/a').books[key].exp,105);
  assert.equal((await Progress.claim(db,'dungroomA123456',higher,'b')).credited[key],70);
  assert.equal(db.records.get('tacticalManuals/b').books[key].exp,70);
  assert.equal(db.records.get('tacticalManuals/a').books[key].exp,105);
});

test('manual credit can be reclaimed using stored C ledger after leaving a closed room',async()=>{
  const db=store({'tacticalManuals/a':book()});
  const left={...room({a:{[key]:35}}),status:'closed',assembledAtMs:null,members:{}};
  const result=await Progress.claim(db,'dungroomA123456',left,'a');
  assert.equal(result.credited[key],35);
  assert.equal(db.records.get('tacticalManuals/a').books[key].exp,35);
  await assert.rejects(
    Progress.claim(db,'dungroomA123456',left,'outsider'),
    error=>error.status===403&&/資格/.test(error.message));
  assert.equal(db.records.get('tacticalManuals/a').books[key].exp,35);
});

test('shared drop policy preserves trial pity and never duplicates already owned book',()=>{
  const state=book();
  const initial=Object.keys(state.books);
  let calls=0;
  const allMiss=()=>{calls++;return 99;};
  for(let n=1;n<=3;n++){
    const result=Roll.roll(null,'a',state,allMiss);
    assert.equal(result.drop,null);
    assert.equal(state.dropMisses,n);
  }
  const forced=Roll.roll(null,'a',state,()=>0);
  assert.ok(forced.drop);
  assert.equal(forced.dropName,Manuals.BY_BOOK[forced.drop].name);
  assert.ok(!initial.includes(forced.drop));
  assert.equal(state.dropMisses,0);
  assert.equal(state.books[forced.drop].exp,0);
  assert.equal(calls,3);
  const second=Roll.roll({},'a',state,()=>0);
  assert.ok(second.drop);
  assert.notEqual(second.drop,forced.drop);
});

function defeatedWitness(){
  return {...room({a:{[key]:70}}),
    status:'assembled',dungeonArena:'boss',
    members:{a:{uid:'a'}},enemies:[],
    dungeonProgress:{guardianStatus:'defeated',keyAcquired:true,portalStatus:'open'},
    bossEncounter:{version:Boss.VERSION,status:'defeated',
      enteredAtTick:2,defeatedAtTick:5,defeatedByUid:'a'}};
}
test('victory rolls one manuscript via same policy in one account transaction',async()=>{
  const raw=book();raw.dropMisses=3;
  const db=store({'users/a':{uid:'a',stats:{gold:10,totalScore:10}},
    'tacticalManuals/a':raw});
  const witness=defeatedWitness();
  const [first,repeat]=await Promise.all([
    Victory.claim(db,'dungroomA123456',witness,'a',session+1000),
    Victory.claim(db,'dungroomA123456',witness,'a',session+1000)
  ]);
  const awarded=[first,repeat].filter(r=>r.awarded);
  assert.equal(awarded.length,1);
  assert.ok(first.manualDrop?.id&&repeat.manualDrop?.id);
  assert.deepEqual(first.manualDrop,repeat.manualDrop);
  assert.equal(db.records.get('users/a').stats.gold,130);
  assert.equal(db.records.get('users/a').stats.totalScore,13);
  assert.equal(db.records.get('users/a').stats.dungeonBossWins,1);
  const equipped=db.records.get('tacticalManuals/a');
  assert.ok(equipped.books[first.manualDrop.id]);
  assert.equal(equipped.dropMisses,0);
  assert.equal(Object.keys(equipped.books).length,2);
  assert.equal((await Progress.claim(db,'dungroomA123456',
    Victory.makeArchive('dungroomA123456',witness),'a')).credited[key],70);
  assert.equal(db.records.get('tacticalManuals/a').books[key].exp,70);
  const duplicate=await Victory.claim(db,'dungroomA123456',witness,'a',session+2000);
  assert.equal(duplicate.awarded,false);
  assert.deepEqual(duplicate.manualDrop,first.manualDrop);
});

test('ordinary attack pierces two cells, hits both enemies and stops at walls',()=>{
  const map={width:8,height:8,tiles:Array(64).fill(1)};
  const hero={uid:'a',position:{x:2,y:3},explorationStamina:10,
    battleHealth:1000,battleMaxHealth:1000,battleAttack:200,strikeSeq:0};
  const creatures=[
    {id:'beast-1',kind:'wolf',position:{x:3,y:3},
      battleHealth:500,battleMaxHealth:500},
    {id:'beast-2',kind:'wolf',position:{x:4,y:3},
      battleHealth:500,battleMaxHealth:500}
  ];
  const original={status:'assembled',battleAppliedTick:0,
    members:{a:hero},enemies:creatures};
  const result=Player.strikeEnemy(original,'a',map,{enemyId:'beast-2',seq:1});
  assert.equal(result.hit.damage,200);
  assert.equal(result.hit.hits.length,2);
  assert.deepEqual(result.hit.cells,[{x:3,y:3},{x:4,y:3}]);
  assert.equal(result.enemies[0].battleHealth,300);
  assert.equal(result.enemies[1].battleHealth,300);
  assert.equal(result.members.a.explorationStamina,8);
  assert.equal(creatures[0].battleHealth,500);
  const retry=Player.strikeEnemy({...original,...result},'a',map,
    {enemyId:'beast-2',seq:1});
  assert.equal(retry.duplicate,true);
  const block={...map,tiles:[...map.tiles]};
  block.tiles[3*map.width+3]=0;
  assert.equal(Player.strikeLine(block,hero.position,creatures[1]),null);
  assert.throws(()=>Player.strikeEnemy(original,'a',block,
    {enemyId:'beast-2',seq:1}),/岩壁/);
  assert.equal(Player.strikeLine(map,hero.position,
    {...creatures[1],position:{x:5,y:3}}),null);
});

test('client basic attack preview matches 2-cell authoritative ray and wall',()=>{
  const source=fs.readFileSync(path.join(__dirname,
    '../public/cultivation/dungeon-map-actions.js'),'utf8')
    .replace(/^export /gm,'');
  const fn=new Function(source+'\nreturn dungeonAttackTiles;')();
  const map={width:8,height:8,tiles:Array(64).fill(1)};
  const center={x:2,y:3};
  const cells=fn(map,center,{kind:'attack',range:2});
  assert.ok(cells.some(p=>p.x===4&&p.y===3));
  map.tiles[3*8+3]=0;
  assert.ok(!fn(map,center,{kind:'attack',range:2})
    .some(p=>p.x===4&&p.y===3));
});

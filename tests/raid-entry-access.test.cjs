const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Rules = require('../public/cultivation/training-access-rules.js');
const { createHandler } = require('../raid-room-api.cjs').__test;

function store(initial = {}) {
  const docs = new Map(Object.entries(initial));
  let sequence = 0;
  const snapshot = ref => ({ id:ref.id, exists:docs.has(ref.key), data:()=>structuredClone(docs.get(ref.key)) });
  const reference = (collection, id) => {
    const ref = { id, key:collection+'/'+id, get:async()=>snapshot(ref), set:async value=>docs.set(ref.key,structuredClone(value)) };
    return ref;
  };
  return { docs,
    collection(name) {
      const filters = [];
      const query = {
        doc:id=>reference(name,id || 'created'+String(++sequence).padStart(6,'0')),
        where(field,_operator,value) { filters.push([field,value]);return query; },
        limit() { return query; },
        async get() {
          const rows = [...docs].filter(([key,value])=>key.startsWith(name+'/') && filters.every(([field,expected])=>value[field]===expected))
            .map(([key])=>snapshot(reference(name,key.slice(name.length+1))));
          return { empty:!rows.length, docs:rows };
        }
      };
      return query;
    },
    async runTransaction(worker) {
      const pending = new Map();
      const result = await worker({ get:async ref=>snapshot(ref),
        update:(ref,patch)=>pending.set(ref.key,{...(pending.get(ref.key)||docs.get(ref.key)),...structuredClone(patch)}),
        set:(ref,value)=>pending.set(ref.key,structuredClone(value)) });
      for (const [key,value] of pending) docs.set(key,value);
      return result;
    }
  };
}

function fixture(profile, partner) {
  const player = { uid:'a', displayName:'青雲修士', raidTickets:{count:3,lastGrantDate:'2099-01-01'}, ...profile };
  const a = store({'users/a':player,...(partner ? {'users/b':{uid:'b',displayName:'隊友',raidTickets:{count:3,lastGrantDate:'2099-01-01'},...partner}} : {})});
  const member = uid=>({uid,name:uid,ready:true,host:uid==='a',online:true,alive:true,hp:1000,maxHp:1000,atk:200,heartbeatAtMs:Date.now(),joinedAtMs:Date.now()});
  const c = store({'raidRooms/room12345':{version:2,revision:1,code:'ABC234',status:'waiting',hostUid:'a',createdAtMs:Date.now(),members:{a:member('a'),...(partner ? {b:member('b')} : {})}}});
  const handler = createHandler({resolveA:()=>({db:a,auth:{verifyIdToken:async()=>({uid:'a',aud:'question-learning',iss:'https://securetoken.google.com/question-learning'})}}),resolveC:()=>({db:c}),logger:{error(){}}});
  return { a,c, async request(action,extra={}) {
    let status=200,body;
    await handler({body:{action,roomId:'room12345',roomCode:'ABC234',...extra},get:()=> 'Bearer test-token'},
      {set(){},status(code){status=code;return this;},json(value){body=value;return this;}});
    return {status,body};
  }};
}

test('below Foundation the server rejects all entry routes, ready and legacy-room start without consuming tickets', async()=>{
  for (const action of ['create','quick','join-code','ready','start']) {
    const f=fixture({stats:{totalScore:9}}), beforeA=structuredClone([...f.a.docs]), beforeC=structuredClone([...f.c.docs]);
    const result=await f.request(action,{ready:true,totalScore:68,trainingAccessScore:68,player:{stats:{totalScore:68}}});
    assert.equal(result.status,403,action);
    assert.match(result.body.error,/築基期（10 修為）/);
    assert.deepEqual([...f.a.docs],beforeA,action+' cannot update or deduct ticket balances');
    assert.deepEqual([...f.c.docs],beforeC,action+' cannot create or change a party');
  }
});

test('exactly Foundation permits create, quick join and code join with the trusted player snapshot', async()=>{
  for (const action of ['create','quick','join-code']) {
    const f=fixture({stats:{totalScore:10}}), result=await f.request(action);
    assert.equal(result.status,200,JSON.stringify(result.body));
    assert.equal(result.body.room.members.a.trainingAccessScore,10);
    assert.equal(result.body.room.members.a.totalScore,10);
    assert.equal(f.a.docs.get('users/a').raidTickets.count,3,'joining a party does not spend tickets');
  }
});

test('permanent Foundation unlock survives a deduction in entry, readiness and battle start', async()=>{
  for (const action of ['create','quick','join-code','ready','start']) {
    const f=fixture({stats:{totalScore:0},trainingAccess:{version:1,highestRealmScore:10}});
    const result=await f.request(action,{ready:true});
    assert.equal(result.status,200,JSON.stringify(result.body));
    assert.equal(f.a.docs.get('users/a').stats.totalScore,0,'access never restores spent cultivation');
    assert.equal(f.a.docs.get('users/a').raidTickets.count,action==='start' ? 2 : 3);
  }
  const invalid=fixture({stats:{totalScore:0},trainingAccess:{version:9,highestRealmScore:68}});
  assert.equal((await invalid.request('create')).status,403,'unknown record versions cannot unlock the realm');
});

test('an ineligible teammate prevents battle start before any party ticket is deducted', async()=>{
  const f=fixture({stats:{totalScore:10}},{stats:{totalScore:9}});
  const result=await f.request('start');
  assert.equal(result.status,403);assert.match(result.body.error,/築基期/);
  assert.equal(f.a.docs.get('users/a').raidTickets.count,3);
  assert.equal(f.a.docs.get('users/b').raidTickets.count,3);
  assert.equal(f.c.docs.get('raidRooms/room12345').status,'waiting');
});

test('the trial catalog, raid engine and training map agree on the Foundation unlock', ()=>{
  const read=name=>fs.readFileSync(path.join(__dirname,'../public/cultivation',name),'utf8');
  const context={};
  vm.runInNewContext(read('raid-engine.js').replace(/^export /gm,'')+'\n'+
    read('raid-catalog.js').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+
    '\nthis.engine=RAID_MVP;this.trial=RAID_TRIALS[0];',context);
  const secret=Rules.PLACES.find(place=>place.id==='secret');
  assert.equal(context.engine.minimumScore,10);
  assert.equal(context.trial.minimumScore,secret.threshold);
  assert.equal(context.trial.minimumRealm,secret.realm);
});

test('hard/extreme rooms require their own trusted realm and quick matchmaking never downgrades tier',async()=>{
  const tooLow=fixture({stats:{totalScore:28}});
  const rejected=await tooLow.request('create',{difficulty:'extreme'});
  assert.equal(rejected.status,403);
  assert.match(rejected.body.error,/元嬰/);

  const eligible=fixture({stats:{totalScore:68}});
  const created=await eligible.request('quick',{difficulty:'extreme'});
  assert.equal(created.status,200);
  assert.notEqual(created.body.roomId,'room12345','normal waiting rooms are excluded');
  assert.equal(created.body.room.difficulty,'extreme');

  const invited=fixture({stats:{totalScore:10}});
  const old=invited.c.docs.get('raidRooms/room12345');
  invited.c.docs.set('raidRooms/room12345',{...old,difficulty:'hard'});
  const mismatch=await invited.request('join-code');
  assert.equal(mismatch.status,403);
  assert.match(mismatch.body.error,/金丹/);
});

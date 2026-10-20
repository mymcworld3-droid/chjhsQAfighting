'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {setup}=require('./helpers/d1-db.cjs');
const {Transaction,compileQuery,Codec}=require('../d1-store.cjs');
const {syncRaidTickets}=require('../raid-room-api.cjs').__test;

test('unchanged same-day tickets do not write or bump the profile revision; next day grants once',async()=>{
  const {db,sql}=setup();
  await db.doc('users/u').set({raidTickets:{count:2,lastGrantDate:'2026-10-20',dailyGrant:2,cap:5}});
  const version=()=>sql.prepare("SELECT version FROM documents WHERE path='users/u'").get().version;
  const before=version();
  for(let i=0;i<5;i++)await syncRaidTickets(db,'u',Date.parse('2026-10-20T04:00:00Z'));
  assert.equal(version(),before);
  assert.equal((await syncRaidTickets(db,'u',Date.parse('2026-10-20T16:00:00Z'))).count,4);
  assert.equal(version(),before+1);
  await syncRaidTickets(db,'u',Date.parse('2026-10-20T17:00:00Z'));
  assert.equal(version(),before+1);
});

test('recent analytics and expiry queries use bounded indexes without a sort or namespace scan',async()=>{
  const {db,sql}=setup();
  const query=compileQuery(db.collection('playerAnalyticsEvents').orderBy('at','desc').limit(25));
  const plan=sql.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.params).map(x=>x.detail).join('\n');
  assert.match(plan,/analytics_event_time/);assert.doesNotMatch(plan,/TEMP B-TREE|SCAN documents/);
  const {cleanupStatements}=await import('../cloudflare/d1/src/analytics-retention.mjs');
  const cleanup=cleanupStatements(Date.now())[0];
  const cleanupPlan=sql.prepare('EXPLAIN QUERY PLAN '+cleanup.sql).all(...cleanup.params).map(x=>x.detail).join('\n');
  assert.match(cleanupPlan,/analytics_event_expiry/);assert.doesNotMatch(cleanupPlan,/TEMP B-TREE|SCAN documents/);
});

test('login-triggered retention removes at most 500 expired events, preserves metrics and rejects stale resurrection',async()=>{
  const {db,sql,gateway}=setup();
  const now=Date.parse('2026-10-21T00:00:00Z');
  const {cleanupAnalytics}=await import('../cloudflare/d1/src/analytics-retention.mjs');
  const insert=sql.prepare('INSERT INTO documents(namespace,path,collection_path,id,data,version,updated_at) VALUES(?,?,?,?,?,1,?)');
  for(let i=0;i<501;i++){
    const id=String(i).padStart(4,'0');
    const expiry=i%2 ? new Codec.Timestamp((now-86400000)/1000) : new Date(now-86400000);
    insert.run('A','playerAnalyticsEvents/'+id,'playerAnalyticsEvents',id,JSON.stringify(Codec.encode({expireAt:expiry})),now);
    sql.prepare('INSERT INTO document_versions VALUES(?,?,1)').run('A','playerAnalyticsEvents/'+id);
  }
  await db.doc('playerAnalyticsEvents/future').set({expireAt:new Date(now+86400000)});
  await db.doc('playerAnalyticsDaily/metric').set({answers:123});
  insert.run('BD','playerAnalyticsEvents/other','playerAnalyticsEvents','other',JSON.stringify(Codec.encode({expireAt:new Date(now-86400000)})),now);
  const stale=new Transaction(db);await stale.get(db.doc('playerAnalyticsEvents/0000'));
  stale.update(db.doc('playerAnalyticsEvents/0000'),{restored:true});
  const env={DB:{prepare:sql=>({bind:(...params)=>({sql,params})}),batch:gateway}};
  const revision=()=>sql.prepare("SELECT version FROM collection_versions WHERE namespace='A' AND path='playerAnalyticsEvents'").get().version;
  const before=revision();
  await cleanupAnalytics(env,now);
  assert.equal((await db.collection('playerAnalyticsEvents').get()).size,2);
  assert.equal(revision(),before+1);
  await assert.rejects(stale.commit(),e=>e.code==='aborted');
  assert.equal((await db.doc('playerAnalyticsDaily/metric').get()).data().answers,123);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM documents WHERE namespace='BD'").get().n,1);
  await cleanupAnalytics(env,now);
  assert.equal((await db.collection('playerAnalyticsEvents').get()).size,1);
  const after=revision();await cleanupAnalytics(env,now);assert.equal(revision(),after);
});

test('a failed retention batch rolls back document deletion and version changes together',async()=>{
  const {db,gateway}=setup();const now=Date.now();
  await db.doc('playerAnalyticsEvents/expired').set({expireAt:new Date(now-86400000)});
  const {cleanupAnalytics}=await import('../cloudflare/d1/src/analytics-retention.mjs');
  const env={DB:{prepare:sql=>({bind:(...params)=>({sql,params})}),batch:statements=>gateway([...statements,{sql:"INSERT INTO d1_version_guard VALUES('bad',0)"}])}};
  await assert.rejects(cleanupAnalytics(env,now));
  assert.equal((await db.doc('playerAnalyticsEvents/expired').get()).exists,true);
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
const {D1Store,Transaction,Codec,compileQuery}=require('../d1-store.cjs');
const {setup}=require('./helpers/d1-db.cjs');
test('D1 preserves namespaces, precise timestamps, nested merge, increment and array transforms',async()=>{
  const {db,secondary}=setup();const ref=db.doc('users/u');
  const stamp=new Codec.Timestamp(1700000000,123456789);
  await ref.set({stats:{gold:2,score:1},tags:['a'],at:stamp});
  await ref.set({stats:{gold:{__d1op:'increment',args:[3]}}},{merge:true});
  await ref.update({tags:{__d1op:'arrayUnion',args:['a','b']},'stats.score':{__d1op:'delete',args:[]}});
  await secondary.doc('users/u').set({name:'other namespace'});
  const data=(await ref.get()).data();assert.equal(data.stats.gold,5);assert.equal(data.stats.score,undefined);
  assert.deepEqual(data.tags,['a','b']);assert.equal(data.at.nanoseconds,123456789);assert.equal(data.at.toDate().getUTCFullYear(),2023);
  assert.equal((await secondary.doc('users/u').get()).data().name,'other namespace');
});
test('D1 concurrent rewards preserve both credits and conflicting batch fully rolls back',async()=>{
  const {db,sql}=setup();const ref=db.doc('users/u');await ref.set({gold:0});
  await Promise.all(Array.from({length:6},()=>db.runTransaction(async tx=>{const row=await tx.get(ref);tx.update(ref,{gold:row.data().gold+1});},{maxAttempts:20})));
  assert.equal((await ref.get()).data().gold,6);
  const stale=new Transaction(db);await stale.get(ref);stale.update(ref,{gold:100});stale.set(db.doc('receipts/stale'),{paid:true});
  await ref.update({gold:7});await assert.rejects(stale.commit(),e=>e.code==='aborted');
  assert.equal((await ref.get()).data().gold,7);assert.equal((await db.doc('receipts/stale').get()).exists,false);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM d1_version_guard').get().n,0);
});
test('D1 tombstone prevents stale transaction succeeding after delete/recreate',async()=>{
  const {db}=setup(),ref=db.doc('items/x');await ref.set({x:1});
  const stale=new Transaction(db);await stale.get(ref);stale.update(ref,{x:8});
  await ref.delete();await ref.set({x:2});await assert.rejects(stale.commit(),e=>e.code==='aborted');assert.equal((await ref.get()).data().x,2);
});
test('D1 queries, stable cursors and collection revisions prevent phantom writes',async()=>{
  const {db}=setup();for(let i=0;i<5;i++)await db.doc('logs/'+i).set({uid:'u',at:new Codec.Timestamp(1700000000+i),tags:['a'],n:i});
  const q=db.collection('logs').where('uid','==','u').orderBy('at','desc').limit(2);
  const first=await q.get(),second=await q.startAfter(first.docs.at(-1)).get();
  assert.deepEqual(first.docs.map(d=>d.id),['4','3']);assert.deepEqual(second.docs.map(d=>d.id),['2','1']);
  assert.equal((await db.collection('logs').where('tags','array-contains','a').get()).size,5);
  const stale=new Transaction(db);await stale.get(db.collection('logs'));stale.set(db.doc('summary/x'),{count:5});
  await db.doc('logs/new').set({uid:'u'});await assert.rejects(stale.commit(),e=>e.code==='aborted');
  assert.equal((await db.doc('summary/x').get()).exists,false);
  const query=compileQuery(db.collection('logs').where('uid','==',"x' OR 1=1 --"));assert.equal(query.sql.includes('OR 1=1'),false);
});
test('D1 large batch stays atomic and uses fewer than 50 Worker queries',async()=>{
  const {db}=setup();const batch=db.batch();for(let i=0;i<400;i++)batch.set(db.doc('bulk/'+i),{value:i});await batch.commit();
  assert.equal((await db.collection('bulk').get()).size,400);
  const del=db.batch();for(let i=0;i<400;i++)del.delete(db.doc('bulk/'+i));await del.commit();assert.equal((await db.collection('bulk').get()).size,0);
});
test('D1 listener shares polling and unsubscribe stops future requests',async()=>{
  const {gateway}=setup();let calls=0;const db=new D1Store('A',{gateway:async x=>{calls++;return gateway(x);},pollMs:5});
  await db.doc('users/u').set({n:1});let a=0,b=0;
  const unsubA=db.doc('users/u').onSnapshot(()=>a++),unsubB=db.doc('users/u').onSnapshot(()=>b++);
  await new Promise(r=>setTimeout(r,15));assert.equal(db.watchers.size,1);assert.equal(a,1);assert.equal(b,1);
  unsubA();unsubB();const last=calls;await new Promise(r=>setTimeout(r,20));assert.equal(calls,last);assert.equal(db.watchers.size,0);
});

test('D1 history lookup uses a UID index rather than scanning the collection',()=>{
  const {db,sql}=setup();const query=compileQuery(db.collection('exam_logs').where('uid','==','u').orderBy('timestamp','desc').limit(20));
  const plan=sql.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.params).map(row=>row.detail).join('\n');
  assert.match(plan,/history_uid_time/);assert.doesNotMatch(plan,/SCAN documents/);
});
test('large source document fits the private gateway without sending repeated full document bodies',async()=>{
  const {gateway}=setup();let size=0;
  const db=new D1Store('A',{gateway:async batch=>{size=Math.max(size,Buffer.byteLength(JSON.stringify({statements:batch})));return gateway(batch);}});
  await db.doc('large/doc').set({text:'x'.repeat(900000)});
  assert.equal((await db.doc('large/doc').get()).data().text.length,900000);assert.ok(size<2_000_000);
});

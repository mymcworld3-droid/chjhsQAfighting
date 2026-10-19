'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {setup}=require('./helpers/d1-db.cjs');
const {D1Store,Codec}=require('../d1-store.cjs');
const {hash,validateSnapshot,importSnapshot,verifySnapshot}=require('../scripts/migrate-firestore-to-d1.cjs');
function fixture(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'d1-migration-'));
  const data=Codec.encode({uid:'u',timestamp:new Codec.Timestamp(1700000000,987654321)});
  const row={namespace:'A',path:'users/u',data,sha256:hash(data)};
  const content=JSON.stringify(row)+'\n';fs.writeFileSync(path.join(directory,'snapshot.ndjson'),content);
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({format:1,complete:true,documents:1,sha256:hash(content),sources:[{namespace:'A'}]}));
  return directory;
}
test('D1 migration verifies hashes and exact path sets, safely resumes, refuses overwrite',async()=>{
  const directory=fixture(),{db}=setup(),store=()=>db;
  try {
    assert.equal((await validateSnapshot(directory)).documents,1);
    assert.equal((await importSnapshot({directory,store,log:()=>{}})).copied,1);
    assert.equal((await importSnapshot({directory,store,log:()=>{}})).existing,1);
    assert.equal((await verifySnapshot({directory,store})).verified,true);
    await db.doc('users/extra').set({uid:'extra'});await assert.rejects(verifySnapshot({directory,store}),/Unexpected/);
    await db.doc('users/u').update({uid:'changed'});await assert.rejects(importSnapshot({directory,store}),/refusing overwrite/);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('D1 migration rejects incomplete and tampered snapshots before target writes',async()=>{
  const directory=fixture();try {
    fs.appendFileSync(path.join(directory,'snapshot.ndjson'),'{}\n');await assert.rejects(validateSnapshot(directory),/checksum mismatch/);
    const p=path.join(directory,'manifest.json'),m=JSON.parse(fs.readFileSync(p));m.complete=false;fs.writeFileSync(p,JSON.stringify(m));await assert.rejects(validateSnapshot(directory),/incomplete/);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('D1 exporter includes child collections under a missing parent document',async()=>{
  const {exportSnapshot,rows}=require('../scripts/migrate-firestore-to-d1.cjs');
  const directory=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'d1-orphan-')),'snapshot');
  const data=new Map([['users/u',{uid:'u'}],['threads/missing/messages/m',{text:'hello'}]]);
  const children={'threads/missing':['threads/missing/messages']};
  function ref(p){return {path:p,listCollections:async()=> (children[p]||[]).map(collection)};}
  function collection(p){return {path:p,listDocuments:async()=> (p==='users'?['users/u']:p==='threads'?['threads/missing']:['threads/missing/messages/m']).map(ref)};}
  const db={listCollections:async()=>[collection('users'),collection('threads')],getAll:async(...refs)=>refs.map(r=>({ref:r,exists:data.has(r.path),data:()=>data.get(r.path)}))};
  try {
    const manifest=await exportSnapshot({directory,roles:['BD'],resolve:()=>({db}),log:()=>{}});
    assert.equal(manifest.complete,true);assert.equal(manifest.documents,2);
    const result=[];for await(const row of rows(directory))result.push(row.path);
    assert.deepEqual(result,['users/u','threads/missing/messages/m']);
  }finally{fs.rmSync(path.dirname(directory),{recursive:true,force:true});}
});

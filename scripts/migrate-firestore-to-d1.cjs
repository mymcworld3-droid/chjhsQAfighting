#!/usr/bin/env node
'use strict';
// Offline snapshot -> D1. Never auto-runs on player login; never deletes Firestore.
require('dotenv').config();
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const {createHash}=require('node:crypto');
const {adminProject,PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const {getD1Store,Codec,validPath}=require('../d1-store.cjs');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(stable(v))).digest('hex');
async function exportSnapshot({directory,roles=['A','BD','C'],resolve=role=>adminProject(role,{env:{...process.env,GAME_DATA_BACKEND:'firestore'}}),log=console.log}) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'snapshot.ndjson'),manifestFile=path.join(directory,'manifest.json');
  // Exclusive create prevents accidental loss of the previous backup.
  const fd=fs.openSync(file,'wx',0o600),digest=createHash('sha256');
  const manifest={format:1,complete:false,createdAt:new Date().toISOString(),sources:[],documents:0,collections:{}};
  fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
  try {
    for(const role of roles){
      if(!PROJECT_IDS[role])throw Error('Invalid source role');
      const db=resolve(role).db;
      manifest.sources.push({namespace:role,projectId:PROJECT_IDS[role]});
      async function visit(collection){
        // listDocuments includes missing parent documents with live subcollections.
        const refs=await collection.listDocuments();
        let count=0;
        for(let i=0;i<refs.length;i+=100){
          const docs=await db.getAll(...refs.slice(i,i+100));
          for(const snap of docs){
            if(snap.exists){
              const data=Codec.encode(snap.data()),row={namespace:role,path:snap.ref.path,data,sha256:hash(data)};
              const line=JSON.stringify(row)+'\n';fs.writeSync(fd,line);digest.update(line);count++;manifest.documents++;
            }
            const children=await snap.ref.listCollections();
            for(const child of children)await visit(child);
          }
        }
        manifest.collections[role+':'+collection.path]=count;
        log(role+':'+collection.path+' '+count+' documents');
      }
      for(const collection of await db.listCollections())await visit(collection);
    }
    manifest.complete=true;manifest.sha256=digest.digest('hex');
    fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2),{mode:0o600});
    return manifest;
  }finally{fs.closeSync(fd);}
}
async function* rows(directory){
  const file=path.join(directory,'snapshot.ndjson');
  const stream=readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity});
  try {for await(const line of stream){if(!line)continue;const row=JSON.parse(line);if(!PROJECT_IDS[row.namespace])throw Error('Invalid namespace');validPath(row.path);if(hash(row.data)!==row.sha256)throw Error('Document checksum mismatch: '+row.namespace+':'+row.path);yield row;}}
  finally{stream.close();}
}
async function validateSnapshot(directory){
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
  if(manifest.format!==1||manifest.complete!==true)throw Error('Snapshot incomplete');
  const digest=createHash('sha256');for await(const chunk of fs.createReadStream(path.join(directory,'snapshot.ndjson')))digest.update(chunk);
  if(digest.digest('hex')!==manifest.sha256)throw Error('Snapshot file checksum mismatch');
  let count=0;const seen=new Set();for await(const row of rows(directory)){count++;const key=row.namespace+':'+row.path;if(seen.has(key))throw Error('Duplicate snapshot document');seen.add(key);}
  if(count!==manifest.documents)throw Error('Snapshot document count mismatch');
  return manifest;
}
async function importSnapshot({directory,store=role=>getD1Store(role),log=console.log}){
  const manifest=await validateSnapshot(directory);let copied=0,existing=0;
  // Idempotent: same data is skipped; differing target documents abort rather than overwrite.
  // No automatic retry on an ambiguous network failure: re-run and compare exact hashes.
  for await(const row of rows(directory)){
    const db=store(row.namespace),ref=db.doc(row.path);
    const outcome=await db.runTransaction(async tx=>{
      const current=await tx.get(ref);
      if(current.exists){if(hash(Codec.encode(current.data()))!==row.sha256)throw Error('Target differs; refusing overwrite: '+row.namespace+':'+row.path);return 'existing';}
      tx.create(ref,Codec.decode(row.data));return 'copied';
    });
    if(outcome==='copied')copied++;else existing++;
    if((copied+existing)%100===0)log('Checked '+(copied+existing)+' / '+manifest.documents);
  }
  return {copied,existing,documents:manifest.documents};
}
async function verifySnapshot({directory,store=role=>getD1Store(role)}){
  const manifest=await validateSnapshot(directory);let matched=0;const expected=new Set(),actual=new Set();
  for await(const row of rows(directory)){
    expected.add(row.namespace+':'+row.path);
    const target=await store(row.namespace).doc(row.path).get();
    if(!target.exists||hash(Codec.encode(target.data()))!==row.sha256)throw Error('Target missing or different: '+row.namespace+':'+row.path);
    matched++;
  }
  // Exact path-set comparison catches target leftovers, not only missing source rows.
  for(const source of manifest.sources){
    const db=store(source.namespace);let cursor='';
    for(;;){
      const [result]=await db.gateway([{sql:'SELECT path FROM documents WHERE namespace=? AND path>? ORDER BY path LIMIT 500',params:[source.namespace,cursor]}]);
      for(const row of result.results)actual.add(source.namespace+':'+row.path);
      if(result.results.length<500)break;cursor=result.results.at(-1).path;
    }
  }
  const extra=[...actual].filter(key=>!expected.has(key));
  if(extra.length)throw Error('Unexpected target documents ('+extra.length+'); verify a fresh staging target. First: '+extra[0]);
  return {verified:true,matched,sha256:manifest.sha256,collections:manifest.collections};
}
async function main(){
  const args=process.argv.slice(2),mode=args.find(x=>['--export','--import','--verify-only','--inspect'].includes(x))||'--inspect';
  const directory=path.resolve(args.find(x=>x.startsWith('--directory='))?.slice(12)||'.d1-migration/snapshot');
  const roles=(args.find(x=>x.startsWith('--roles='))?.slice(8)||'A,BD,C').split(',');
  if(mode==='--export'){
    if(!args.includes('--source-frozen'))throw Error('Freeze server and browser writes first, then pass --source-frozen');
    console.log(JSON.stringify(await exportSnapshot({directory,roles}),null,2));
  }else if(mode==='--import'){
    if(!args.includes('--target-frozen'))throw Error('Import only into an isolated D1 target; pass --target-frozen');
    console.log(await importSnapshot({directory}));
  }else if(mode==='--verify-only')console.log(JSON.stringify(await verifySnapshot({directory}),null,2));
  else {
    console.log('No remote reads or writes. Plan: A / BD / C -> one namespaced D1 database.');
    console.log('1. --export --source-frozen --directory=<new private folder>');
    console.log('2. --import --target-frozen --directory=<same folder>');
    console.log('3. --verify-only --directory=<same folder>');
    console.log('Includes every collection and nested subcollection; preserves UID/path and timestamp precision.');
    console.log('Authentication accounts and Storage objects are outside this Firestore migration.');
  }
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={exportSnapshot,importSnapshot,verifySnapshot,validateSnapshot,rows,hash,stable};

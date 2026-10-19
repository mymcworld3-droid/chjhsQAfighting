'use strict';
const {randomUUID} = require('node:crypto');
const Codec = require('./public/d1-codec.js');
const conflict = () => Object.assign(new Error('資料已更新，請重試'),{code:'aborted'});
function validPath(path,document=true) {
  if(typeof path!=='string' || path.length>1500 || path.split('/').some(x=>!x||x==='.'||x==='..') || path.split('/').length%2 !== (document?0:1)) throw Error('Invalid document/collection path');
  return path;
}
function fieldSql(field) {
  if(field==='__name__')return 'id';
  const parts=Codec.fieldParts(field);
  if(parts.some(p=>!/^[\w-]+$/.test(p)))throw Error('Unsupported query field');
  const path='$.'+parts.map(p=>'"'+p+'"').join('.');
  // SQL literal contains only whitelisted identifiers. All values use bindings.
  const jsonPath='$.'+parts.join('.');
  const expr=`json_extract(data,'${jsonPath}')`;
  return {expr,path};
}
function comparable(field) {
  if(field==='__name__')return 'id';
  const {expr}=fieldSql(field);
  return `CASE WHEN json_extract(data,'$.${field}.__d1type')='timestamp' THEN json_extract(data,'$.${field}.seconds')*1000+json_extract(data,'$.${field}.nanoseconds')/1000000.0 ELSE ${expr} END`;
}
function scalar(value){return value&&typeof value.toMillis==='function'?value.toMillis():typeof value==='boolean'?Number(value):value;}
function compileQuery(query) {
  const where=['namespace=?','collection_path=?'],params=[query.db.role,query.path];
  // SQLite only uses a partial index when its predicate is visible in the SQL.
  // These predicates are fixed source-code strings, never browser-supplied SQL.
  const predicates=[
    [ ['users'], "collection_path='users'" ],
    [ ['dongtians','dongtianIndex','dongtianReports'], "collection_path IN ('dongtians','dongtianIndex','dongtianReports')" ],
    [ ['dongtianIndex'], "collection_path='dongtianIndex'" ],
    [ ['dongtianReports'], "collection_path='dongtianReports'" ],
    [ ['exam_logs','dongtianPlays','dongtianRewardClaims'], "collection_path IN ('exam_logs','dongtianPlays','dongtianRewardClaims')" ],
    [ ['rooms','raidRooms'], "collection_path IN ('rooms','raidRooms')" ],
    [ ['raidRooms'], "collection_path='raidRooms'" ],
    [ ['rooms'], "collection_path='rooms'" ],
    [ ['worldImmortals'], "collection_path='worldImmortals'" ],
    [ ['marketListings'], "collection_path='marketListings'" ],
    [ ['playerAnalyticsDaily'], "collection_path='playerAnalyticsDaily'" ],
    [ ['playerAnalyticsVisitors','playerAnalyticsPlayers'], "collection_path IN ('playerAnalyticsVisitors','playerAnalyticsPlayers')" ],
    [ ['exam_logs'], "collection_path='exam_logs'" ],
    [ ['global_chat'], "collection_path='global_chat'" ]
  ];
  for(const [collections,predicate] of predicates)if(collections.includes(query.path))where.push(predicate);

  for(const [field,op,value] of query.filters) {
    const col=typeof value?.toMillis==='function'?comparable(field):(field==='__name__'?'id':fieldSql(field).expr);
    if(['==','!=','<','<=','>','>='].includes(op)) {
      if(value===null){where.push(`${col} IS ${op==='!='?'NOT ':''}NULL`);continue;}
      where.push(`${col} ${op==='=='?'=':op==='!='?'<>':op} ?`);params.push(scalar(value));
    } else if(op==='in') {
      if(!Array.isArray(value)||!value.length||value.length>30)throw Error('Invalid in query');
      where.push(`${col} IN (${value.map(()=>'?').join(',')})`);params.push(...value.map(scalar));
    } else if(op==='array-contains') {
      where.push(`EXISTS (SELECT 1 FROM json_each(${col}) WHERE value=?)`);params.push(scalar(value));
    } else throw Error('Unsupported query operator: '+op);
  }
  const orders=[...query.orders];
  if(!orders.some(([f])=>f==='__name__'))orders.push(['__name__',orders.at(-1)?.[1]||'asc']);
  // Firestore orderBy excludes documents missing that field.
  for(const [field] of query.orders)if(field!=='__name__')where.push(`${fieldSql(field).expr} IS NOT NULL`);
  if(query.cursor) {
    const cursor=query.cursor;
    const vals=orders.map(([f],i)=>Array.isArray(cursor)?cursor[i]:(f==='__name__'?cursor.id:Codec.get(cursor.data(),f)));
    if(vals.some(v=>v===undefined))throw Error('Incomplete query cursor');
    const clauses=[];
    orders.forEach(([field,dir],i)=>{
      const prefix=orders.slice(0,i).map(([f])=>`${comparable(f)} = ?`);
      clauses.push('('+[...prefix,`${comparable(field)} ${dir==='desc'?'<':'>'} ?`].join(' AND ')+')');
      params.push(...vals.slice(0,i+1).map(scalar));
    });
    where.push('('+clauses.join(' OR ')+')');
  }
  let sql='SELECT path,id,data,version FROM documents WHERE '+where.join(' AND ')+' ORDER BY '+orders.map(([f,dir])=>`${comparable(f)} ${dir==='desc'?'DESC':'ASC'}`).join(',');
  if(query.maximum!==null){sql+=' LIMIT ?';params.push(query.maximum);}
  if(params.length>100)throw Error('Too many query parameters');
  return {sql,params};
}
function createGateway(env=process.env,fetchFn=fetch) {
  const url=String(env.D1_WORKER_URL||'').replace(/\/$/,'');
  const token=env.D1_SERVICE_TOKEN;
  if(!url||!token||token.length<32)throw Error('Missing D1_WORKER_URL or D1_SERVICE_TOKEN (32+ characters)');
  const parsed=new URL(url);
  if(parsed.protocol!=='https:' && !(env.D1_ALLOW_LOCAL==='1' && ['localhost','127.0.0.1'].includes(parsed.hostname)))throw Error('D1 gateway requires HTTPS');
  return async statements=>{
    const response=await fetchFn(url+'/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({statements}),signal:AbortSignal.timeout(20000)});
    const payload=await response.json().catch(()=>({}));
    if(response.status===409)throw conflict();
    if(!response.ok || payload.success!==true || !Array.isArray(payload.result))throw Object.assign(Error('D1 gateway unavailable'),{code:'unavailable'});
    return payload.result;
  };
}
class Snapshot {
  constructor(ref,row,version){this.ref=ref;this.id=ref.id;this.exists=!!row;this.version=version??row?.version??0;this._data=row?JSON.parse(row.data):null;}
  data(){return this.exists?Codec.decode(this._data):undefined;}
  get(field){return Codec.get(this.data(),field);}
}
function querySnapshot(docs){return {docs,size:docs.length,empty:!docs.length,forEach:fn=>docs.forEach(fn),docChanges:()=>docs.map(doc=>({type:'added',doc}))};}
class Query {
  constructor(db,path,filters=[],orders=[],maximum=null,cursor=null){this.db=db;this.firestore=db;this.path=validPath(path,false);this.id=path.split('/').at(-1);this.filters=filters;this.orders=orders;this.maximum=maximum;this.cursor=cursor;}
  _copy(patch){return Object.assign(new Query(this.db,this.path,this.filters,this.orders,this.maximum,this.cursor),patch);}
  where(f,op,v){return this._copy({filters:[...this.filters,[f,op,v]]});}
  orderBy(f,dir='asc'){return this._copy({orders:[...this.orders,[typeof f==='string'?f:'__name__',dir]]});}
  limit(n){if(!Number.isInteger(n)||n<1||n>100000)throw Error('Invalid query limit');return this._copy({maximum:n});}
  startAfter(...values){return this._copy({cursor:values.length===1&&values[0] instanceof Snapshot?values[0]:values});}
  doc(id=randomUUID().replace(/-/g,'')){return this.db.doc(this.path+'/'+id);}
  async add(value){const ref=this.doc();await ref.create(value);return ref;}
  get(){return this.db._query(this);}
  onSnapshot(next,error){return this.db._watch(this,next,error);}
}
class Reference {
  constructor(db,path){this.db=db;this.firestore=db;this.path=validPath(path);this.id=path.split('/').at(-1);}
  get parent(){return new Query(this.db,this.path.split('/').slice(0,-1).join('/'));}
  collection(name){return new Query(this.db,this.path+'/'+name);}
  get(){return this.db._get(this);}
  set(data,options){return this.db.runTransaction(tx=>{tx.set(this,data,options);});}
  update(data){return this.db.runTransaction(tx=>{tx.update(this,data);});}
  create(data){return this.db.runTransaction(tx=>{tx.create(this,data);});}
  delete(){return this.db.runTransaction(tx=>{tx.delete(this);});}
  onSnapshot(next,error){return this.db._watch(this,next,error);}
  isEqual(other){return other?.path===this.path&&other?.db.role===this.db.role;}
}
class Transaction {
  constructor(db){this.db=db;this.reads=new Map();this.collections=new Map();this.writes=[];}
  async get(ref){
    if(ref instanceof Query){
      const [revision] = await this.db.gateway([{sql:'SELECT version FROM collection_versions WHERE namespace=? AND path=?',params:[this.db.role,ref.path]}]);
      const snapshot=await ref.get();
      const version=revision.results[0]?.version||0;
      if(this.collections.has(ref.path)&&this.collections.get(ref.path)!==version)throw conflict();
      this.collections.set(ref.path,version);
      for(const doc of snapshot.docs)this._read(doc);
      return snapshot;
    }
    if(ref.db!==this.db)throw Error('Cross-namespace transaction is unsupported');
    if(this.reads.has(ref.path))return this.reads.get(ref.path);
    const snap=await ref.get();this._read(snap);return snap;
  }
  _read(snap){const prev=this.reads.get(snap.ref.path);if(prev&&prev.version!==snap.version)throw conflict();this.reads.set(snap.ref.path,snap);}
  set(ref,data,options){this.writes.push({ref,type:'set',data,options});return this;}
  update(ref,data){this.writes.push({ref,type:'update',data});return this;}
  create(ref,data){this.writes.push({ref,type:'create',data});return this;}
  delete(ref){this.writes.push({ref,type:'delete'});return this;}
  async commit(){
    if(!this.writes.length)return;
    if(this.writes.length>500)throw Error('D1 batch exceeds 500 writes');
    for(const w of this.writes){if(w.ref.db!==this.db)throw Error('Cross-namespace write');await this.get(w.ref);}
    const prepared=this.preview();
    const guard=randomUUID(),role=this.db.role,now=Date.now();
    const docReads=JSON.stringify([...this.reads].map(([path,snap])=>({path,version:snap.version})));
    const collectionReads=JSON.stringify([...this.collections].map(([path,version])=>({path,version})));
    const rows=JSON.stringify([...prepared].map(([path,data])=>({path,id:this.db.doc(path).id,
      collection_path:this.db.doc(path).parent.path,data:data===null?null:JSON.stringify(Codec.encode(data)),
      version:this.reads.get(path).version+1})));
    if(Buffer.byteLength(rows,'utf8')>1_800_000)throw Error('D1 transaction payload too large; split the batch');
    const collections=JSON.stringify([...new Set([...prepared.keys()].map(p=>this.db.doc(p).parent.path))]);
    const statements=[
      {sql:`INSERT INTO d1_version_guard(id,valid) SELECT ?,CASE WHEN NOT EXISTS (
        SELECT 1 FROM json_each(?) r LEFT JOIN document_versions v ON v.namespace=? AND v.path=json_extract(r.value,'$.path')
        WHERE COALESCE(v.version,0) <> json_extract(r.value,'$.version')) THEN 1 ELSE 0 END`,params:[guard,docReads,role]},
      {sql:`INSERT INTO d1_version_guard(id,valid) SELECT ?,CASE WHEN NOT EXISTS (
        SELECT 1 FROM json_each(?) r LEFT JOIN collection_versions v ON v.namespace=? AND v.path=json_extract(r.value,'$.path')
        WHERE COALESCE(v.version,0) <> json_extract(r.value,'$.version')) THEN 1 ELSE 0 END`,params:[guard+':q',collectionReads,role]},
      {sql:`INSERT INTO document_versions(namespace,path,version)
        SELECT ?,json_extract(value,'$.path'),json_extract(value,'$.version') FROM json_each(?) WHERE true
        ON CONFLICT(namespace,path) DO UPDATE SET version=excluded.version`,params:[role,rows]},
      {sql:`DELETE FROM documents WHERE namespace=? AND path IN (
        SELECT json_extract(value,'$.path') FROM json_each(?) WHERE json_extract(value,'$.data') IS NULL)`,params:[role,rows]},
      {sql:`INSERT INTO documents(namespace,path,collection_path,id,data,version,updated_at)
        SELECT ?,json_extract(value,'$.path'),json_extract(value,'$.collection_path'),json_extract(value,'$.id'),
        json_extract(value,'$.data'),json_extract(value,'$.version'),? FROM json_each(?) WHERE json_extract(value,'$.data') IS NOT NULL
        ON CONFLICT(namespace,path) DO UPDATE SET data=excluded.data,version=excluded.version,updated_at=excluded.updated_at`,params:[role,now,rows]},
      {sql:`INSERT INTO collection_versions(namespace,path,version) SELECT ?,value,1 FROM json_each(?) WHERE true
        ON CONFLICT(namespace,path) DO UPDATE SET version=version+1`,params:[role,collections]},
      {sql:'DELETE FROM d1_version_guard WHERE id IN (?,?)',params:[guard,guard+':q']}
    ];
    if(!this.collections.size)statements.splice(1,1);
    await this.db.gateway(statements);
    this.db._notify();
  }
  preview(){const data=new Map();for(const w of this.writes){const old=data.has(w.ref.path)?data.get(w.ref.path):this.reads.get(w.ref.path).data()??null;data.set(w.ref.path,Codec.apply(old,w));}return data;}
}
class D1Store {
  constructor(role,{gateway=createGateway(),pollMs=5000}={}){if(!['A','BD','C'].includes(role))throw Error('Invalid namespace');this.role=role;this.gateway=gateway;this.pollMs=pollMs;this.isD1=true;this.watchers=new Map();}
  collection(path){return new Query(this,path);}
  doc(path){return new Reference(this,path);}
  async _get(ref){const [r]=await this.gateway([{sql:'SELECT d.data,v.version FROM document_versions v LEFT JOIN documents d ON d.namespace=v.namespace AND d.path=v.path WHERE v.namespace=? AND v.path=?',params:[this.role,ref.path]}]);const row=r.results[0];return new Snapshot(ref,row?.data?row:null,row?.version||0);}
  async _query(query){const [r]=await this.gateway([compileQuery(query)]);return querySnapshot(r.results.map(row=>new Snapshot(this.doc(row.path),row)));}
  async getAll(...refs){return Promise.all(refs.map(ref=>ref.get()));}
  async runTransaction(work,{maxAttempts=5}={}){for(let attempt=0;attempt<maxAttempts;attempt++){const tx=new Transaction(this);try{const result=await work(tx);await tx.commit();return result;}catch(e){if(e.code!=='aborted'||attempt===maxAttempts-1)throw e;await new Promise(r=>setTimeout(r,20+Math.random()*60*(attempt+1)));}}}
  batch(){const tx=new Transaction(this);return {set:(...args)=>{tx.set(...args);return tx;},update:(...args)=>{tx.update(...args);return tx;},delete:(...args)=>{tx.delete(...args);return tx;},create:(...args)=>{tx.create(...args);return tx;},commit:()=>tx.commit()};}
  _watch(ref,next,error){
    const key=ref instanceof Query?JSON.stringify(compileQuery(ref)):ref.path;
    let watcher=this.watchers.get(key);
    if(!watcher){
      watcher={listeners:new Set(),timer:null,running:false,last:null,snapshot:null,failures:0,stopped:false};
      const tick=async()=>{
        if(watcher.running||watcher.stopped)return;watcher.running=true;
        try {const snap=await ref.get();const signature=JSON.stringify(snap instanceof Snapshot?[snap.version,snap.exists]:snap.docs.map(d=>[d.id,d.version]));
          watcher.failures=0;if(signature!==watcher.last){watcher.last=signature;watcher.snapshot=snap;for(const l of watcher.listeners)try{l.next(snap);}catch(e){console.error('[D1 listener callback]',e.message);}}
        }catch(e){watcher.failures++;for(const l of watcher.listeners)l.error?.(e);}
        finally{watcher.running=false;if(!watcher.stopped){watcher.timer=setTimeout(tick,Math.min(60000,this.pollMs*2**Math.min(watcher.failures,4)));watcher.timer.unref?.();}}
      };watcher.tick=tick;this.watchers.set(key,watcher);
    }
    const listener={next,error};watcher.listeners.add(listener);
    if(watcher.snapshot)queueMicrotask(()=>{if(watcher.listeners.has(listener))next(watcher.snapshot);});else void watcher.tick();
    return ()=>{watcher.listeners.delete(listener);if(!watcher.listeners.size){watcher.stopped=true;clearTimeout(watcher.timer);this.watchers.delete(key);}};
  }
  _notify(){for(const w of this.watchers.values()){clearTimeout(w.timer);void w.tick();}}
}
const stores=new Map();
function getD1Store(role,env=process.env){const key=[role,env.D1_WORKER_URL,env.D1_SERVICE_TOKEN].join(':');if(!stores.has(key))stores.set(key,new D1Store(role,{gateway:createGateway(env),pollMs:Math.max(1000,Number(env.D1_POLL_MS)||5000)}));return stores.get(key);}
module.exports={D1Store,Transaction,Snapshot,Query,Reference,compileQuery,createGateway,getD1Store,Codec,validPath};

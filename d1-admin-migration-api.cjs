'use strict';
const {randomUUID}=require('node:crypto');
const {adminProject,PROJECT_IDS}=require('./firebase-admin-projects.cjs');
const {getD1Store,Transaction,Codec}=require('./d1-store.cjs');
const {hash}=require('./scripts/migrate-firestore-to-d1.cjs');
const ID='firestore-all-to-d1-v1',ROLES=['A','BD','C'],LEASE_MS=120000;
const failure=(code,message=code,status=503)=>Object.assign(Error(message),{code,status});
function autoMigrationEnabled(env=process.env){return env.D1_AUTO_MIGRATE_ON_ADMIN_LOGIN!=='0'&&!!env.D1_WORKER_URL&&String(env.D1_SERVICE_TOKEN||'').length>=32;}
function createController({env=process.env,source=role=>adminProject(role,{env:{...env,GAME_DATA_BACKEND:'firestore'}}),
  target=role=>getD1Store(role,env),now=Date.now,uuid=randomUUID,logger=console,schedule=(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref?.();return timer;}}={}){
  let working=null,retryTimer=null;
  const gateway=statements=>target('A').gateway(statements);
  const frozen=()=>env.GAME_DATA_MAINTENANCE==='1'&&env.D1_SOURCE_WRITES_FROZEN==='1';
  async function row(){const [r]=await gateway([{sql:'SELECT * FROM d1_admin_migration_jobs WHERE id=?',params:[ID]}]);return r.results[0]||null;}
  function publicState(record){
    if(!record)return {status:'pending',message:'管理員登入後將自動開始搬遷。'};
    const s=JSON.parse(record.state);
    return {status:s.status,phase:s.final?'final':'copy',verified:s.verified===true,
      processed:Number(s.processed)||0,discovered:Number(s.discovered)||0,copied:Number(s.copied)||0,
      unchanged:Number(s.unchanged)||0,missing:Number(s.missing)||0,pass:Number(s.pass)||1,
      retryAfterMs:Number(s.retryAfterMs)||0,updatedAtMs:record.updated_at,
      errorCode:s.errorCode||'',message:{pending:'正在準備搬遷…',running:s.final?'正在執行停寫後的最終核對…':'正在後端分批複製所有玩家及相關資料…',
        copied:'資料已複製；正式切換前仍需停止來源寫入並完成最終核對。',ready:'所有來源資料已完成最終核對，可切換 D1。',
        paused:s.errorCode==='resource-exhausted'?'來源或 D1 配額不足，已保存進度，稍後自動續傳。':'連線暫時中斷，已保存進度，稍後自動續傳。',
        blocked:'目標資料有差異，已停止以避免覆蓋；請檢查後重試。'}[s.status]||'正在確認搬遷狀態…'};
  }
  function guard(owner){
    const id=uuid(),at=now();
    return {before:[{sql:`INSERT INTO d1_version_guard(id,valid) SELECT ?,CASE WHEN EXISTS (
      SELECT 1 FROM d1_admin_migration_jobs WHERE id=? AND lease_owner=? AND lease_until>?) THEN 1 ELSE 0 END`,params:[id,ID,owner,at]}],
      after:[{sql:'UPDATE d1_admin_migration_jobs SET lease_until=?,updated_at=? WHERE id=? AND lease_owner=?',params:[at+LEASE_MS,at,ID,owner]},
        {sql:'DELETE FROM d1_version_guard WHERE id=?',params:[id]}]};
  }
  async function guarded(owner,statements){const g=guard(owner);await gateway([...g.before,...statements,...g.after]);}
  const stateUpdate=(patch)=>({sql:'UPDATE d1_admin_migration_jobs SET state=json_patch(state,?) WHERE id=?',params:[JSON.stringify(patch),ID]});
  function enqueue(role,kind,paths){
    const priority=kind==='collection'?(role==='A'?0:2):(role==='A'?1:3);
    return {sql:`INSERT INTO d1_admin_migration_tasks(job_id,namespace,kind,path,status,priority)
      SELECT ?,?,?,value,'pending',? FROM json_each(?) WHERE true ON CONFLICT DO NOTHING`,params:[ID,role,kind,priority,JSON.stringify(paths)]};
  }
  async function initializeRoots(owner){
    for(const role of ROLES){
      const current=JSON.parse((await row()).state);
      if(current.roots?.[role])continue;
      const project=source(role);
      if(project.app?.options?.projectId!==PROJECT_IDS[role])throw failure('source-project-mismatch');
      const collections=await project.db.listCollections();
      await guarded(owner,[enqueue(role,'collection',collections.map(c=>c.path)),{
        sql:`UPDATE d1_admin_migration_jobs SET state=json_set(state,'$.roots.${role}',json('true')) WHERE id=?`,params:[ID]}]);
    }
  }
  async function prepareFinal(owner){
    await guarded(owner,[{sql:"UPDATE d1_admin_migration_tasks SET status='pending' WHERE job_id=?",params:[ID]},
      {sql:`UPDATE d1_admin_migration_jobs SET state=json_set(state,'$.status','running','$.final',json('true'),
        '$.pass',json_extract(state,'$.pass')+1,'$.processed',0,'$.copied',0,'$.unchanged',0,'$.missing',0,
        '$.discovered',(SELECT count(*) FROM d1_admin_migration_tasks WHERE job_id=? AND kind='document'),
        '$.roots',json('{}'),'$.errorCode','','$.retryAfterMs',0) WHERE id=?`,params:[ID,ID]}]);
  }
  async function collectionStep(owner,task){
    // Metadata only: listDocuments includes orphan subcollections' missing parents.
    // Player document bodies are subsequently read one at a time by documentStep.
    const refs=await source(task.namespace).db.collection(task.path).listDocuments();
    refs.sort((a,b)=>a.path.localeCompare(b.path));
    for(let i=0;i<refs.length;i+=100){
      await guarded(owner,[enqueue(task.namespace,'document',refs.slice(i,i+100).map(r=>r.path)),{
        sql:"UPDATE d1_admin_migration_jobs SET state=json_set(state,'$.discovered',json_extract(state,'$.discovered')+changes()) WHERE id=?",params:[ID]}]);
    }
    await guarded(owner,[{sql:"UPDATE d1_admin_migration_tasks SET status='done' WHERE job_id=? AND namespace=? AND kind='collection' AND path=?",params:[ID,task.namespace,task.path]}]);
  }
  async function documentStep(owner,task,state){
    const role=task.namespace,ref=source(role).db.doc(task.path);
    const snap=await ref.get();
    const children=await ref.listCollections();
    const encoded=snap.exists?Codec.encode(snap.data()):null,digest=snap.exists?hash(encoded):null;
    const db=target(role),targetRef=db.doc(task.path);
    // Retry ONLY a definite atomic rollback, never an ambiguous network failure.
    for(let attempt=0;attempt<4;attempt++){
      const tx=new Transaction(db),current=await tx.get(targetRef);
      const [ledger]=await gateway([{sql:'SELECT * FROM d1_admin_migration_documents WHERE job_id=? AND namespace=? AND path=?',params:[ID,role,task.path]}]);
      const previous=ledger.results[0],currentHash=current.exists?hash(Codec.encode(current.data())):null;
      let changed=false;
      if(snap.exists){
        if(previous&&current.version!==previous.target_version&&currentHash!==digest)throw failure('TARGET_CONFLICT');
        if(current.exists&&currentHash!==digest&&(!previous||previous.sha256!==currentHash||previous.target_version!==current.version))throw failure('TARGET_CONFLICT');
        if(!current.exists||currentHash!==digest){tx.set(targetRef,Codec.decode(encoded));changed=true;}
      }else if(state.final&&current.exists){
        if(!previous||previous.sha256!==currentHash||previous.target_version!==current.version)throw failure('TARGET_CONFLICT');
        tx.delete(targetRef);changed=true;
      }else if(current.exists){throw failure('TARGET_CONFLICT');}
      const version=current.version+(changed?1:0),g=guard(owner),counter=!snap.exists?'missing':changed?'copied':'unchanged';
      const updateTime=snap.updateTime?String(snap.updateTime.seconds)+':'+String(snap.updateTime.nanoseconds||0):null;
      const statements=[enqueue(role,'collection',children.map(c=>c.path)),{
        sql:`INSERT INTO d1_admin_migration_documents(job_id,namespace,path,sha256,target_version,source_exists,source_update_time,pass)
          VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(job_id,namespace,path) DO UPDATE SET sha256=excluded.sha256,
          target_version=excluded.target_version,source_exists=excluded.source_exists,source_update_time=excluded.source_update_time,pass=excluded.pass`,
        params:[ID,role,task.path,digest,version,Number(snap.exists),updateTime,state.pass]},
        {sql:"UPDATE d1_admin_migration_tasks SET status='done' WHERE job_id=? AND namespace=? AND kind='document' AND path=?",params:[ID,role,task.path]},
        {sql:`UPDATE d1_admin_migration_jobs SET state=json_set(state,'$.processed',json_extract(state,'$.processed')+1,
          '$.${counter}',json_extract(state,'$.${counter}')+1) WHERE id=?`,params:[ID]}];
      try{await tx.commit({before:g.before,after:[...statements,...g.after]});return;}
      catch(e){if(e.code!=='aborted'||attempt===3)throw e;}
    }
  }
  async function finish(owner,state){
    if(state.final){
      if(!frozen())throw failure('SOURCE_NOT_FROZEN');
      const [extra,missing]=await gateway([{
        sql:`SELECT count(*) AS n FROM documents d LEFT JOIN d1_admin_migration_documents l
          ON l.job_id=? AND l.namespace=d.namespace AND l.path=d.path
          WHERE l.path IS NULL OR l.source_exists<>1 OR l.pass<>? OR l.target_version<>d.version`,params:[ID,state.pass]},
        {sql:`SELECT count(*) AS n FROM d1_admin_migration_documents l LEFT JOIN documents d
          ON d.namespace=l.namespace AND d.path=l.path WHERE l.job_id=? AND l.pass=? AND l.source_exists=1 AND d.path IS NULL`,params:[ID,state.pass]}]);
      if(extra.results[0].n||missing.results[0].n)throw failure('TARGET_CONFLICT');
    }
    // Release and terminal status are guarded in one transaction. Do not renew
    // after releasing; the last statement intentionally clears the lease.
    const g=guard(owner);
    await gateway([...g.before,stateUpdate({status:state.final?'ready':'copied',verified:state.final===true,finishedAtMs:now(),errorCode:'',retryAfterMs:0}),
      ...g.after,{sql:"UPDATE d1_admin_migration_jobs SET lease_owner='',lease_until=0 WHERE id=? AND lease_owner=?",params:[ID,owner]}]);
    if(!state.final&&frozen())planRetry(1000);
  }
  function planRetry(ms){clearTimeout(retryTimer);retryTimer=schedule(()=>{void resume().catch(()=>{});},Math.max(1000,ms));}
  async function pump(owner,initial){
    try{
      if(initial.status==='copied')await prepareFinal(owner);
      await guarded(owner,[stateUpdate({status:'running',errorCode:'',retryAfterMs:0})]);
      await initializeRoots(owner);
      for(;;){
        if(env.GAME_DATA_BACKEND==='d1')throw failure('D1_ALREADY_ACTIVE');
        const record=await row(),state=JSON.parse(record.state);
        if(record.lease_owner!==owner||record.lease_until<=now())throw failure('LEASE_LOST');
        if(state.final&&!frozen())throw failure('SOURCE_NOT_FROZEN');
        const [result]=await gateway([{sql:"SELECT namespace,kind,path FROM d1_admin_migration_tasks WHERE job_id=? AND status='pending' ORDER BY priority,namespace,path LIMIT 1",params:[ID]}]);
        const task=result.results[0];
        if(!task){await finish(owner,state);return;}
        if(task.kind==='collection')await collectionStep(owner,task);else await documentStep(owner,task,state);
        await new Promise(resolve=>setImmediate(resolve));
      }
    }catch(error){
      logger.warn('[D1 admin migration]',error.code||'unavailable');
      const code=String(error.code||'unavailable'),blocked=['TARGET_CONFLICT','SOURCE_NOT_FROZEN','D1_ALREADY_ACTIVE','source-project-mismatch'].includes(code);
      const quota=['8','resource-exhausted'].includes(code);
      const next=now()+(quota?60*60*1000:60000); // Firestore and D1 reset at different times; retry slowly without guessing.
      // A stale worker may not change the successor's progress or status.
      await gateway([{sql:`UPDATE d1_admin_migration_jobs SET state=json_patch(state,?),lease_owner='',lease_until=0,updated_at=?
        WHERE id=? AND lease_owner=?`,params:[JSON.stringify({status:blocked?'blocked':'paused',errorCode:code,retryAfterMs:blocked?0:next}),now(),ID,owner]}]).catch(()=>{});
      if(!blocked)planRetry(next-now());
    }
  }
  async function start(adminUid,{create=true,allowBlocked=true}={}){
    if(!autoMigrationEnabled(env))return {status:'disabled',message:'請先設定 D1 Worker 與服務密鑰。'};
    if(env.GAME_DATA_BACKEND==='d1')return {status:'active',message:'正式資料已使用 D1，不再從舊來源匯入。'};
    if(create){const initial={status:'pending',pass:1,final:frozen(),verified:false,processed:0,discovered:0,copied:0,unchanged:0,missing:0,roots:{}};
      await gateway([{sql:'INSERT INTO d1_admin_migration_jobs(id,admin_uid,state,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING',params:[ID,adminUid,JSON.stringify(initial),now()]}]);}
    const existing=await row();if(!existing)return publicState(null);
    const state=JSON.parse(existing.state);
    if(state.status==='ready'||state.status==='copied'&&!frozen()||state.status==='blocked'&&!allowBlocked)return publicState(existing);
    if(state.retryAfterMs>now()){planRetry(state.retryAfterMs-now());return publicState(existing);}
    if(existing.lease_until>now()){if(!working)planRetry(existing.lease_until-now()+100);return publicState(existing);}
    const owner=uuid();
    const [claimed]=await gateway([{sql:'UPDATE d1_admin_migration_jobs SET lease_owner=?,lease_until=?,updated_at=? WHERE id=? AND lease_until<=? RETURNING state',params:[owner,now()+LEASE_MS,now(),ID,now()]}]);
    if(claimed.results.length){
      const task=pump(owner,JSON.parse(claimed.results[0].state));working=task;
      task.finally(()=>{if(working===task)working=null;}).catch(()=>{});
    }
    return publicState(await row());
  }
  async function resume(){
    try{return await start('',{create:false,allowBlocked:false});}
    catch(error){if(autoMigrationEnabled(env)&&env.GAME_DATA_BACKEND!=='d1')planRetry(60*60*1000);throw error;}
  }
  async function status(){if(!autoMigrationEnabled(env))return {status:'disabled'};if(env.GAME_DATA_BACKEND==='d1')return {status:'active'};return publicState(await row());}
  return {start,resume,status,drain:async()=>{await working;},stop(){clearTimeout(retryTimer);},publicState};
}
async function verifiedAdmin(req,resolve){
  const bearer=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization')||''));
  if(!bearer)throw failure('unauthenticated','請先登入。',401);
  const a=resolve('A');let token;
  try{token=await a.auth.verifyIdToken(bearer[1],true);}catch(_){throw failure('unauthenticated','登入已失效。',401);}
  if(!token.uid||token.aud!==PROJECT_IDS.A||token.iss!=='https://securetoken.google.com/'+PROJECT_IDS.A)throw failure('unauthenticated','身分不符。',401);
  const profile=await a.db.collection('users').doc(token.uid).get();
  if(!profile.exists||profile.data()?.isAdmin!==true)throw failure('permission-denied','僅限管理員。',403);
  return token.uid;
}
function register(app,options={}){
  const env=options.env||process.env;
  const source=options.source||(role=>adminProject(role,{env:{...env,GAME_DATA_BACKEND:'firestore'}}));
  const controller=createController({...options,env,source});
  app.post('/api/admin/d1-migration',async(req,res)=>{
    res.set('Cache-Control','no-store');
    let administrator=false;
    try{
      const uid=await verifiedAdmin(req,source);administrator=true;
      const action=req.body?.action||'start';
      if(!['start','status'].includes(action))return res.status(400).json({error:'未知操作。'});
      const state=action==='start'?await controller.start(uid):await controller.status();
      res.json({ok:true,...state});
    }catch(error){const status=error.status||503;
      res.status(status).json({error:status>=500?'搬遷服務尚未就緒，請確認 D1 migrations 與連線設定。':error.message,code:error.code||'unavailable',administrator});}
  });
  return controller;
}
module.exports=register;
module.exports.__test={ID,LEASE_MS,createController,verifiedAdmin,autoMigrationEnabled};

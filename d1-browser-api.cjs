'use strict';
const {adminProject,PROJECT_IDS}=require('./firebase-admin-projects.cjs');
const {getD1Store,Transaction,Query,Codec,validPath}=require('./d1-store.cjs');
const fail=(message='無權存取這筆資料',status=403,code='permission-denied')=>Object.assign(Error(message),{status,code});
const same=(a,b)=>JSON.stringify(Codec.encode(a??null))===JSON.stringify(Codec.encode(b??null));
const changed=(a,b)=>[...new Set([...Object.keys(a||{}),...Object.keys(b||{})])].filter(k=>!same(a?.[k],b?.[k]));
const only=(keys,allowed)=>keys.every(k=>allowed.includes(k));
const PUBLIC=new Set(['users','worldImmortals','products','gameConfig','system','global_chat','marketListings','rooms','raidRooms','dongtianIndex']);
function publicPlayer(data) {
  const keys=['uid','displayName','photoURL','friendCode','equipped','lastActive','createdAt'];
  const result=Object.fromEntries(keys.filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));
  result.profile={educationLevel:data.profile?.educationLevel||''};
  result.stats=Object.fromEntries(['totalScore','rankLevel','gold','totalAnswered','totalCorrect','attack','maxHp','bestStreak'].filter(k=>data.stats?.[k]!==undefined).map(k=>[k,data.stats[k]]));
  result.cultivationTraining={coreEnabled:data.cultivationTraining?.coreEnabled!==false,...(data.cultivationTraining?.equippedCore?{equippedCore:data.cultivationTraining.equippedCore}:{})};
  const equipped=data.artifactSystem?.equipped||{};
  result.artifactSystem={equipped,inventory:Object.fromEntries(Object.values(equipped).filter(Boolean).map(id=>[id,data.artifactSystem?.inventory?.[id]||0]))};
  return result;
}
function mayRead({role,path,data,uid,admin}) {
  if(admin)return true;
  const [col,id,...nested]=path.split('/');
  if(nested.length)return false; // Private chat is served by its authenticated domain API.
  if(col==='playerProfiles')return id===uid;
  if(col==='dongtians')return data?.ownerUid===uid || data?.status==='active';
  if(col==='dongtianReports')return data?.ownerUid===uid || data?.reporterUid===uid;
  if(['exam_logs','dongtianPlays'].includes(col))return data?.uid===uid;
  return PUBLIC.has(col) && (role==='A' || (role==='BD'&&col==='dongtianIndex') || (role==='C'&&['rooms','raidRooms'].includes(col)));
}
function buildTarget(db,target) {
  if(target?.role!==db.role)throw fail('資料區不符',400,'invalid-argument');
  if(target.kind==='doc')return db.doc(validPath(target.path));
  let query=db.collection(validPath(target.path,false));
  if(!Array.isArray(target.constraints)||target.constraints.length>12)throw fail('查詢條件過多',400,'invalid-argument');
  for(const c of target.constraints) {
    if(!['where','orderBy','limit','startAfter'].includes(c.type)||!Array.isArray(c.args))throw fail('查詢格式不符',400,'invalid-argument');
    if(c.type==='startAfter') {
      const [arg]=c.args;
      query=arg?.id&&arg?.data?query._copy({cursor:{id:arg.id,data:()=>Codec.decode(arg.data)}}):query.startAfter(...c.args.map(Codec.decode));
    }else query=query[c.type](...c.args.map(Codec.decode));
  }
  return query.limit(Math.min(1000,query.maximum||1000));
}
function requireScopedQuery(query,context) {
  const col=query.path;
  if(context.admin)return;
  if(col.includes('/'))throw fail();
  if(['exam_logs','dongtianPlays'].includes(col) && !query.filters.some(([f,op,v])=>f==='uid'&&op==='=='&&v===context.uid))throw fail();
  if(col==='dongtianReports'&&!query.filters.some(([f,op,v])=>['ownerUid','reporterUid'].includes(f)&&op==='=='&&v===context.uid))throw fail();
  if(col==='dongtians'&&!query.filters.some(([f,op,v])=>(f==='ownerUid'&&v===context.uid||f==='status'&&v==='active')&&op==='=='))throw fail();
  if(!PUBLIC.has(col)&&!['dongtians','dongtianReports','exam_logs','dongtianPlays'].includes(col))throw fail();
}
function authorizeWrite({role,path,before,after,operation,context,tx,preview}) {
  const {uid,admin,decoded}=context;
  const [col,id,...nested]=path.split('/');
  if(nested.length)throw fail();
  if(admin)return; // role was read from the authoritative profile BEFORE the transaction.
  const keys=changed(before,after);
  if(role==='A'&&col==='users') {
    if(id===uid) {
      if(after===null)return;
      if(after.uid!==undefined&&after.uid!==uid)throw fail();
      for(const field of ['isAdmin','roles','role','permissions','admin']) {
        if(!same(before?.[field],after[field]) && !(before===null&&field==='isAdmin'&&after[field]===false))throw fail();
      }
      if(after.email!==undefined && after.email!==before?.email && after.email!==(decoded.email||''))throw fail();
      // Friendships and invitation preferences are changed only by the trusted API.
      if(!same(before?.friends||[],after.friends||[]) ||
        Boolean(before?.friendInvitesDisabled)!==Boolean(after.friendInvitesDisabled))throw fail();
      return;
    }
    if(operation.type==='update'&&Object.keys(operation.data||{}).length===1) {
      const own=preview.get('users/'+uid);
      // A purchase may credit exactly one seller. The listing and buyer debit must
      // be in this same guarded SQL transaction; arbitrary peer gold writes fail.
      if(Object.hasOwn(operation.data,'stats.gold')) {
        for(const [listingPath,next] of preview) {
          if(!listingPath.startsWith('marketListings/')||next?.sellerUid!==id||next?.buyerUid!==uid||next?.status!=='sold')continue;
          const old=tx.reads.get(listingPath)?.data();
          const buyer=tx.reads.get('users/'+uid)?.data();
          if(old?.status==='active'&&Number.isSafeInteger(old.price)&&old.price>0&&own&&
            same({...old,status:'sold',buyerUid:uid,completedAtMs:next.completedAtMs},next)&&
            after.stats?.gold===(Number(before?.stats?.gold)||0)+old.price&&
            own.stats?.gold===(Number(buyer?.stats?.gold)||0)-old.price&&own.stats.gold>=0)return;
        }
      }
    }
    throw fail();
  }
  if(role==='A'&&col==='exam_logs') {
    if(before===null&&after?.uid===uid)return;
    if(before?.uid===uid&&after===null)return;
    throw fail();
  }
  if(role==='A'&&col==='global_chat') {
    if(before===null&&after?.uid===uid&&typeof after.text==='string'&&after.text.length<=4000)return;
    if(before?.uid===uid&&after===null)return;
    throw fail();
  }
  if(['A','BD'].includes(role)&&['dongtians','dongtianIndex'].includes(col)) {
    if(before===null&&after?.ownerUid===uid)return;
    if(before?.ownerUid===uid&&(after===null||after.ownerUid===uid))return;
    const moderation=['status','moderationStatus','activeReportId','flaggedQuestionId','flaggedQuestionIndex','flaggedReason','aiReviewSummary','suspendedAt','suspendedAtMs'];
    if(before?.status==='active'&&after?.status==='suspended'&&only(keys,moderation)) {
      const report=preview.get('dongtianReports/'+after.activeReportId);
      if(report?.reporterUid===uid&&report.dongtianId===id&&report.status==='confirmed')return;
    }
    throw fail();
  }
  if(['A','BD'].includes(role)&&col==='dongtianReports') {
    if(before===null&&after?.reporterUid===uid)return;
    if(before?.ownerUid===uid&&after?.ownerUid===uid&&only(keys,['status','resolvedAt','resolvedAtMs','resolution']))return;
    if((before?.reporterUid===uid||before?.ownerUid===uid)&&after===null)return;
    throw fail();
  }
  if(role==='A'&&col==='worldImmortals') {
    if(before?.uid===uid && (after===null||only(keys,['displayName'])))return;
    const player=tx.reads.get('users/'+uid)?.data();
    if(after?.uid===uid&&Number(player?.stats?.totalScore)>=1268&&Number.isSafeInteger(after.challengeScore)&&after.challengeScore>Math.max(0,Number(before?.challengeScore)||0))return;
    throw fail();
  }
  if(role==='A'&&col==='marketListings') {
    if(before===null&&after?.sellerUid===uid&&after.status==='active'&&Number.isSafeInteger(after.price)&&after.price>0)return;
    if(before?.status==='active'&&after&&only(keys,['status','buyerUid','completedAtMs'])&&
      (before.sellerUid===uid&&after.status==='cancelled'||after.buyerUid===uid&&after.status==='sold'))return;
    throw fail();
  }
  if(['A','C'].includes(role)&&col==='rooms') {
    if(before===null&&after?.host?.uid===uid&&after.guest==null&&after.status==='waiting')return;
    if(before?.host?.uid===uid&&before.status==='waiting'&&before.guest==null&&after===null)return;
    if(after&&before) {
      const member=[before.host?.uid,before.guest?.uid].includes(uid);
      if(member&&after.host?.uid===before.host?.uid&&after.guest?.uid===before.guest?.uid)return;
      const joinFields=['host','guest','knowledgeScope','status','matchedAt','matchedAtMs','introUntilMs','answerWindowStartedAt','answerWindowStartedAtMs','firstAnswerUid','updatedAt'];
      if(before.status==='waiting'&&before.guest==null&&after.guest?.uid===uid&&after.host?.uid===before.host?.uid&&['intro','ready'].includes(after.status)&&only(keys,joinFields))return;
    }
    throw fail();
  }
  // Receipts, claims, provisioning, analytics, config and raid authority are server-owned.
  throw fail();
}
async function executeCommit(db,input,context) {
  const writes=input.writes,reads=input.reads||[];
  if(!Array.isArray(writes)||!writes.length||writes.length>500||!Array.isArray(reads)||reads.length>500)throw fail('交易過大',400,'invalid-argument');
  const tx=new Transaction(db);
  // Validate every target before dispatch, then coalesce the documents needed by
  // this commit. The normal checks below still authorize every read and write.
  const targets=new Map();
  for(const row of reads){
    const ref=buildTarget(db,row.target);
    if(ref instanceof Query)throw fail('交易讀取必須是單一文件',400,'invalid-argument');
    targets.set(ref.path,ref);
  }
  for(const row of writes){
    if(!['set','update','delete'].includes(row.type))throw fail('未知的寫入類型',400,'invalid-argument');
    const ref=buildTarget(db,row.target);
    if(ref instanceof Query)throw fail('寫入必須是單一文件',400,'invalid-argument');
    targets.set(ref.path,ref);
  }
  if(db.role==='A')targets.set('users/'+context.uid,db.doc('users/'+context.uid));
  await Promise.all([...targets.values()].map(ref=>tx.get(ref)));
  for(const row of reads) {
    const ref=buildTarget(db,row.target);
    if(ref instanceof Query)throw fail('交易讀取必須是單一文件',400,'invalid-argument');
    const snap=await tx.get(ref);
    if(snap.version!==row.version)throw fail('資料已更新，請重試',409,'aborted');
    // Do not let a version guess confer access to private documents.
    if(snap.exists&&!mayRead({...context,role:db.role,path:ref.path,data:snap.data()}))throw fail();
  }
  for(const row of writes) {
    if(!['set','update','delete'].includes(row.type))throw fail('未知的寫入類型',400,'invalid-argument');
    const ref=buildTarget(db,row.target);
    if(ref instanceof Query)throw fail('寫入必須是單一文件',400,'invalid-argument');
    await tx.get(ref);
    tx.writes.push({ref,type:row.type,data:row.data?Codec.decode(row.data):undefined,options:row.options?.merge===true?{merge:true}:undefined});
  }
  // These reads also protect authorization from concurrent role revocation.
  if(db.role==='A') {
    const own=await tx.get(db.doc('users/'+context.uid));
    context={...context,admin:own.data()?.isAdmin===true};
  }
  const preview=tx.preview();
  for(const op of tx.writes)authorizeWrite({role:db.role,path:op.ref.path,before:tx.reads.get(op.ref.path).data()??null,after:preview.get(op.ref.path),operation:op,context,tx,preview});
  await tx.commit();
}
function registerD1BrowserApi(app,{env=process.env,resolve=role=>adminProject(role),store=role=>getD1Store(role,env)}={}) {
  app.get('/api/data-config',(_req,res)=>res.set('Cache-Control','no-store').json({backend:env.GAME_DATA_BACKEND||'firestore',pollMs:Math.max(1000,Number(env.D1_POLL_MS)||5000),autoMigration:env.D1_AUTO_MIGRATE_ON_ADMIN_LOGIN!=='0'&&!!env.D1_WORKER_URL&&String(env.D1_SERVICE_TOKEN||'').length>=32}));
  app.post('/api/data',async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(env.GAME_DATA_BACKEND!=='d1')return res.status(404).json({error:'資料服務未啟用'});
    if(env.GAME_DATA_MAINTENANCE==='1')return res.status(503).json({error:'資料搬遷中，請稍後再試',code:'unavailable'});
    try {
      const header=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get('authorization')||''));
      if(!header)throw fail('請先登入',401,'unauthenticated');
      let decoded;
      try {decoded=await resolve('A').auth.verifyIdToken(header[1],true);}catch(_){throw fail('登入已失效',401,'unauthenticated');}
      if(!decoded.uid||decoded.aud!==PROJECT_IDS.A||decoded.iss!=='https://securetoken.google.com/'+PROJECT_IDS.A)throw fail('身分不符',401,'unauthenticated');
      if(req.aborted||res.destroyed||res.writableEnded)return;
      const input=req.body||{},role=input.target?.role||input.role;
      if(!['A','BD','C'].includes(role))throw fail('資料區不符',400,'invalid-argument');
      if(!['read','watch','commit'].includes(input.action))throw fail('未知操作',400,'invalid-argument');
      const db=store(role),target=input.action==='commit'?null:buildTarget(db,input.target);
      let own,initialSnapshot;
      // A-store commits re-read and guard the authoritative role inside executeCommit.
      if(!(input.action==='commit'&&role==='A')){
        const ownRead=store('A').doc('users/'+decoded.uid).get();
        // Share the same fresh snapshot for own-profile reads. Other document reads
        // can travel alongside auth data; serialization still enforces permissions.
        const targetRead=target&&!(target instanceof Query)
          ?role==='A'&&target.path==='users/'+decoded.uid?ownRead:target.get():null;
        [own,initialSnapshot]=await Promise.all([ownRead,targetRead]);
      }
      const context={uid:decoded.uid,admin:own?.data()?.isAdmin===true,decoded};
      if(input.action==='commit'){
        for(let attempt=0;;attempt++){
          try{await executeCommit(db,input,context);break;}
          catch(e){if(e.code!=='aborted'||input.reads?.length||attempt>=4)throw e;}
        }
        return res.json({ok:true});
      }
      const serialize=snap=>{
        if(!snap.exists)return {exists:false,version:snap.version};
        let data=snap.data();
        if(!mayRead({...context,role,path:snap.ref.path,data}))throw fail();
        if(role==='A'&&snap.ref.parent.path==='users'&&snap.id!==context.uid&&!context.admin)data=publicPlayer(data);
        return {exists:true,id:snap.id,path:snap.ref.path,version:snap.version,data:Codec.encode(data)};
      };
      if(target instanceof Query)requireScopedQuery(target,context);
      const format=snap=>{
        if(target instanceof Query)return {docs:snap.docs.map(serialize)};
        // A missing server-only document must not leak its version/existence.
        if(!snap.exists&&!PUBLIC.has(target.parent.path)&&!['dongtians','dongtianReports','exam_logs','dongtianPlays'].includes(target.parent.path)&&!(target.parent.path==='playerProfiles'&&target.id===context.uid)&&!context.admin)throw fail();
        return serialize(snap);
      };
      if(input.action==='read')return res.json(format(initialSnapshot||await target.get()));
      // Validate initial authorization BEFORE opening an SSE response.
      const initial=format(initialSnapshot||await target.get());
      if(req.aborted||res.destroyed||res.writableEnded)return;
      res.set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});
      res.flushHeaders();
      let stopped=false,unsubscribe,heartbeat,renew,last='';
      function stop(){if(stopped)return;stopped=true;unsubscribe?.();clearInterval(heartbeat);clearTimeout(renew);res.end();}
      function send(payload){if(stopped)return;if(res.writableLength>1024*1024){stop();return;}const line=JSON.stringify(payload);if(line!==last){last=line;res.write('data: '+line+'\n\n');}}
      res.on('close',stop);req.on('aborted',stop);
      send(initial);
      unsubscribe=target.onSnapshot(snap=>{try{send(format(snap));}catch(_){stop();}},()=>stop());
      if(stopped){unsubscribe();return;}
      heartbeat=setInterval(()=>{if(!stopped)res.write(': keepalive\n\n');},15000);
      // Refresh identity and authorization every five minutes.
      renew=setTimeout(stop,5*60*1000);heartbeat.unref?.();renew.unref?.();

    }catch(error){
      if(req.aborted||res.destroyed||res.writableEnded)return;
      const code=error.code||'unavailable',status=error.status||(code==='aborted'?409:503);
      if(status>=500)console.error('[D1 browser]',code);
      res.status(status).json({error:status>=500?'資料服務暫時無法使用':error.message,code});
    }
  });
}
module.exports={registerD1BrowserApi,authorizeWrite,mayRead,publicPlayer,executeCommit,buildTarget};

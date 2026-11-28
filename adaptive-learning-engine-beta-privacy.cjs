'use strict';
// Account deletion is independent of the preview/release flag.
const {PROJECT_IDS,adminProject}=require('./firebase-admin-projects.cjs');
const {getD1Store}=require('./d1-store.cjs');
const {purgeOwnerBatch,requireD1,createStore}=require('./adaptive-learning-engine-beta-store.cjs');
const {isUid}=require('./adaptive-learning-engine-beta-contract.cjs');
const {betaEnabled}=require('./adaptive-learning-engine-beta-api.cjs');
const error=(status)=>Object.assign(Error('Beta cleanup unavailable'),{status});
async function verifyDeletionIdentity(req,{resolve=()=>adminProject('A'),now=Date.now}={}){
  const bearer=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization')||''));
  if(!bearer)throw error(401);
  const {auth}=resolve();
  let token,user;
  try{
    token=await auth.verifyIdToken(bearer[1],true);
    if(!isUid(token?.uid)||token.aud!==PROJECT_IDS.A||token.iss!=='https://securetoken.google.com/'+PROJECT_IDS.A)throw error(401);
    user=await auth.getUser(token.uid);
  }catch(_){throw error(401);}
  if(user.uid!==token.uid||user.disabled)throw error(401);
  const unbound=token.firebase?.sign_in_provider==='anonymous'&&!user.providerData?.length;
  // Match existing guest policy; bound accounts must have freshly reauthenticated.
  const age=Math.floor(now()/1000)-token.auth_time;
  if(!unbound&&(!Number.isFinite(age)||age< -60||age>300))throw error(403);
  return token.uid;
}
function resolveCleanupStore(env=process.env,store=getD1Store){
  // Once any production Beta persistence is enabled, this sticky configuration
  // must remain 1 even during rollback to the legacy Firestore backend.
  const required=env.ADAPTIVE_LEARNING_ENGINE_STORAGE_REQUIRED==='1'||env.GAME_DATA_BACKEND==='d1';
  if(!required)return null; // pre-persistence Firestore-only deployment, including staged D1 credentials
  if(!env.D1_WORKER_URL||!env.D1_SERVICE_TOKEN||String(env.D1_SERVICE_TOKEN).length<32)throw error(503);
  const db=store('A',env);requireD1(db);return db;
}
function createProductionStore({env=process.env,verify,store=getD1Store}={}){
  // Do not write to Firestore A even if the old game still uses it.
  if(!betaEnabled(env)||env.GAME_DATA_BACKEND!=='d1'||env.ADAPTIVE_LEARNING_ENGINE_STORAGE_REQUIRED!=='1')throw error(503);
  const db=resolveCleanupStore(env,store);
  return createStore({db,verify});
}
function createCleanupHandler({env=process.env,verify=req=>verifyDeletionIdentity(req,{resolve:()=>adminProject('A',{env})}),store=getD1Store,purge=purgeOwnerBatch}={}){
  return async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    try{
      if(req.body!=null&&(typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length))throw error(400);
      const owner=await verify(req);
      if(!isUid(owner))throw error(401);
      const db=resolveCleanupStore(env,store);
      if(!db)return res.json({ok:true,complete:true,storage:'not-configured'});
      const result=await purge(db,owner);
      return res.json({ok:true,complete:result.complete,storage:'d1'});
    }catch(e){
      const status=[400,401,403].includes(e?.status)?e.status:503;
      return res.status(status).json({ok:false,complete:false,error:status===403?'請重新驗證帳號身分':'學習資料尚未完成清除，請重試'});
    }
  };
}
function register(app,options){app.post('/api/adaptive-learning-engine-beta/delete-my-data',createCleanupHandler(options));}
module.exports={register,createCleanupHandler,verifyDeletionIdentity,resolveCleanupStore,createProductionStore};

'use strict';
// Separate preview gate; production release is deliberately locked until stage 26.
const RELEASE_ADAPTIVE_LEARNING_ENGINE_BETA = false;
function betaEnabled(env=process.env){
  return env.ADAPTIVE_LEARNING_ENGINE_BETA==='1' &&
    (RELEASE_ADAPTIVE_LEARNING_ENGINE_BETA || ['development','test'].includes(env.NODE_ENV));
}
function createStatusHandler({env=process.env,verify=req=>require('./raid-question-ticket.cjs').verifyMainIdentity(req)}={}){
  return async (req,res)=>{
    res.set('Cache-Control','private, no-store');
    if(!betaEnabled(env))return res.status(404).json({ok:false,enabled:false});
    try{
      const uid=await verify(req);
      if(typeof uid!=='string'||!uid)return res.status(401).json({ok:false,enabled:false});
      if(!betaEnabled(env))return res.status(404).json({ok:false,enabled:false});
      return res.json({ok:true,enabled:true,phase:'preview-shell'});
    }catch(error){
      return res.status(error?.status===401||error?.status===403?error.status:503).json({ok:false,enabled:false});
    }
  };
}
function register(app,options){
  app.get('/api/adaptive-learning-engine-beta/status',createStatusHandler(options));
}
module.exports={register,betaEnabled,createStatusHandler};

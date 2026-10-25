'use strict';
const crypto=require('node:crypto');
const W=require('./public/cultivation/weapon-system-rules.js');
const {playerRepository}=require('./server-repositories.cjs');
const {verifyMainIdentity}=require('./raid-question-ticket.cjs');
const access=require('./public/cultivation/training-access-rules.js');
const {educationCohort,ROLE_IDS}=require('./world-immortals-cleanup-api.cjs').__test;
const {artifactCatalog}=require('./raid-authority.cjs');
const ARMORIES='weaponArmories',RECEIPTS='weaponArmoryReceipts';
const fail=(message,status=409)=>Object.assign(Error(message),{status});
const exists=s=>s?.exists?s.data():null;
const actions=new Set(['draw','starter','equip','upgrade','open-chest','claim-trial','exchange-ticket','exchange-fragments','convert-legacy']);
const LEGACY_MATERIALS=new Set(['qi-spirit-iron','foundation-refined-iron','golden-purple-iron','qi-spirit-wood','foundation-century-wood','golden-lightning-wood','nascent-star-iron','nascent-soul-wood','raid-refine-key-ii','raid-refine-key-iii']);
function key(uid,requestId){if(!/^[A-Za-z0-9_-]{8,100}$/.test(String(requestId||'')))throw fail('操作識別碼無效',400);return crypto.createHash('sha256').update(uid+'\n'+requestId).digest('hex');}
function legacyPreview(user,catalog){
  const byId=new Map(artifactCatalog(catalog).map(item=>[item.id,item])),artifacts={};
  for(const [id,n]of Object.entries(user.artifactSystem?.inventory||{}))if(byId.get(id)?.effects?.some(e=>String(e.type).startsWith('equip_'))&&W.num(n))artifacts[id]=W.num(n);
  const materials=Object.fromEntries(Object.entries(user.materialSystem?.inventory||{}).map(([id,n])=>[id,W.num(n)]).filter(([id,n])=>LEGACY_MATERIALS.has(id)&&n));
  const job=user.refineryJobV1?.id?user.refineryJobV1:null,returnedArtifacts={},returnedMaterials={};
  if(job){
    for(const ingredient of Array.isArray(job.recipe)?job.recipe:[]){const qty=W.num(ingredient.quantity),id=ingredient.artifactId||ingredient.materialId;if(!id||!qty)continue;
      const into=ingredient.artifactId?(byId.get(id)?.effects?.some(e=>String(e.type).startsWith('equip_'))?artifacts:returnedArtifacts):(LEGACY_MATERIALS.has(id)?materials:returnedMaterials);into[id]=W.num((into[id]||0)+qty);}
    const key=job.keyRequirement;if(key?.materialId&&W.num(key.quantity)){const into=LEGACY_MATERIALS.has(key.materialId)?materials:returnedMaterials;into[key.materialId]=W.num((into[key.materialId]||0)+W.num(key.quantity));}
  }
  const equipmentCopies=Object.values(artifacts).reduce((s,n)=>s+n,0),materialCount=Object.values(materials).reduce((s,n)=>s+n,0);
  return {artifacts,materials,returnedArtifacts,returnedMaterials,job,equipmentCopies,materialCount,chests:equipmentCopies,
    gold:materialCount*10+(job&&job.currency!=='forgeFragments'?W.num(job.goldCost):0),refundFragments:job?.currency==='forgeFragments'?W.num(job.fragmentCost):0};
}
function response(user,raw,pointer,catalog,extra={}){
  const state=W.normalize(raw),best=W.num(pointer?.trial?.best),trial=W.grantTrial(state,best),legacy=legacyPreview(user,catalog);
  return {ok:true,state,balance:W.num(user.stats?.gold),fragments:W.num(user.forgeFragments),tickets:W.num(user.soulboundDrawTickets),
    playerRealmScore:access.score(user),canAscendToImmortal:false,
    pendingTrialChests:trial.earned,trialBest:best,legacy:{equipmentCopies:legacy.equipmentCopies,materialCount:legacy.materialCount,chests:legacy.chests,gold:legacy.gold,pendingJob:!!legacy.job,refundFragments:legacy.refundFragments},...extra};
}
async function transact(db,uid,action='view',body={},now=Date.now(),random=()=>crypto.randomInt(0,0x100000000)/0x100000000){
  if(action!=='view'&&!actions.has(action))throw fail('未知兵器操作',400);
  const request=action==='view'?null:key(uid,body.requestId),signature=crypto.createHash('sha256').update(JSON.stringify(action==='draw'?[action,body.count,body.payment,body.poolVersion,body.expectedCost]:[action,body.type||'',body.payment||'',body.expectedRealm??body.expectedLevel??null])).digest('hex');
  return db.runTransaction(async tx=>{
    const userRef=db.collection('users').doc(uid),armoryRef=db.collection(ARMORIES).doc(uid),receiptRef=request?db.collection(RECEIPTS).doc(request):null;
    const [u,a,r,p,c]=await Promise.all([tx.get(userRef),tx.get(armoryRef),receiptRef?tx.get(receiptRef):null,
      tx.get(db.collection('tacticalBattlePlayers').doc(uid)),tx.get(db.collection('gameConfig').doc('artifactCatalogV1'))]);
    const user=exists(u);if(!user||user.uid&&user.uid!==uid)throw fail('玩家資料不存在',404);
    if(access.score(user)<6)throw fail('築基後開放兵器，請先修煉至 6 修為',403);
    const group=educationCohort(user.profile?.educationLevel);
    const seats=group&&access.score(user)>=1868?await Promise.all([...ROLE_IDS].map(role=>tx.get(db.collection('worldImmortals').doc(group+'__'+role)))):[];
    const immortal=seats.some(s=>s.exists&&s.data()?.uid===uid&&s.data()?.cohort===group);
    const original=exists(a),s=W.normalize(original),receipt=exists(r),pointer=exists(p),catalog=exists(c)||{};
    const reply=(profile,state,extra={})=>response(profile,state,pointer,catalog,{canAscendToImmortal:immortal,...extra});
    if(receipt){if(receipt.signature!==signature)throw fail('相同操作識別碼不能用於不同請求');return reply(user,s,{result:receipt.result,replayed:true});}
    if(action==='view')return reply(user,s);
    if(['starter','open-chest'].includes(action))throw fail('尋器已改為隨機抽取，請重新同步後抽取',400);
    const patch={};let result={action};
    const type=String(body.type||'');
    if(['equip','upgrade'].includes(action)&&!W.get(type))throw fail('兵器類型無效',400);
    if(action==='draw'){
      const {count,payment}=body,cost=W.drawCost(payment,count);
      if(cost===null||payment==='free'&&count!==1)throw fail('請選擇單抽或五連抽及有效支付方式',400);
      if(body.poolVersion!==W.DRAW_VERSION||body.expectedCost!==cost)throw fail('尋器費用或獎池已更新，請重新同步');
      if(payment==='free'){
        if(s.starterClaimed)throw fail('首次免費抽取已使用');s.starterClaimed=true;
      }else if(payment==='chest'){
        if(s.chests<cost)throw fail('兵器匣不足');s.chests-=cost;
      }else{
        const field={ticket:'soulboundDrawTickets',gold:'stats.gold',fragments:'forgeFragments'}[payment];
        const balance=W.num(payment==='gold'?user.stats?.gold:user[field]);if(balance<cost)throw fail(W.PAYMENTS[payment].label+'不足');patch[field]=balance-cost;
      }
      const results=Array.from({length:count},()=>W.roll(random));for(const row of results)W.add(s,row.type);
      result={action,requestId:body.requestId,payment,count,spent:cost,poolVersion:W.DRAW_VERSION,results};s.lastDraw=result;
    }else if(action==='equip'){
      if(!s.weapons[type]?.copies)throw fail('尚未持有這把兵器');s.equipped=type;
    }else if(action==='upgrade'){
      const row=s.weapons[type];if(!row?.copies)throw fail('尚未持有這把兵器');
      if(!Number.isInteger(body.expectedRealm)||body.payment)throw fail('兵器已改為境界進階，請重新同步後確認',400);
      if(body.expectedRealm!==row.realm)throw fail('兵器境界已更新，請重新確認進階費用');
      const fee=W.promotion(row,access.score(user),immortal),balance=W.num(user.stats?.gold);
      if(!fee.next)throw fail('兵器已達最高境界');
      if(!fee.eligible)throw fail(fee.next.requiresImmortal?'玩家需達半仙並持有相應學段的真仙席位':'玩家需先達到'+fee.next.name+'境（'+fee.next.need+' 修為）');
      if(row.copies-1<fee.copies)throw fail('同款兵器數量不足，需要 '+fee.copies+' 把副本並保留主武器');
      if(balance<fee.gold)throw fail('靈石不足，需要 '+fee.gold+' 靈石');
      row.copies-=fee.copies;patch['stats.gold']=balance-fee.gold;row.realm=fee.next.index;
      Object.assign(result,{realm:row.realm,type,copiesSpent:fee.copies,goldSpent:fee.gold});
    }else if(action==='claim-trial'){
      const reward=W.grantTrial(s,W.num(pointer?.trial?.best));if(!reward.earned)throw fail('目前沒有待領的試煉兵器匣');Object.assign(s,reward.state);result.chests=reward.earned;
    }else if(action==='exchange-ticket'){
      const tickets=W.num(user.soulboundDrawTickets);if(!tickets)throw fail('沒有可兌換的契器券');patch.soulboundDrawTickets=tickets-1;s.chests++;result.chests=1;
    }else if(action==='exchange-fragments'){
      const fragments=W.num(user.forgeFragments);if(fragments<W.FRAGMENTS_PER_CHEST)throw fail('煉器碎片不足');patch.forgeFragments=fragments-W.FRAGMENTS_PER_CHEST;s.chests++;result.chests=1;
    }else if(action==='convert-legacy'){
      const legacy=legacyPreview(user,catalog);
      if(!legacy.equipmentCopies&&!legacy.materialCount&&!legacy.job)throw fail('目前沒有可轉換的舊裝備或材料');
      const inventory={...(user.artifactSystem?.inventory||{})};for(const id of Object.keys(legacy.artifacts))delete inventory[id];
      const remainingMaterials={...(user.materialSystem?.inventory||{})};for(const id of Object.keys(legacy.materials))delete remainingMaterials[id];
      for(const [id,n]of Object.entries(legacy.returnedArtifacts))inventory[id]=W.num((inventory[id]||0)+n);
      for(const [id,n]of Object.entries(legacy.returnedMaterials))remainingMaterials[id]=W.num((remainingMaterials[id]||0)+n);
      patch['artifactSystem.inventory']=inventory;patch['artifactSystem.equipped']={};patch['materialSystem.inventory']=remainingMaterials;patch['stats.gold']=W.num(user.stats?.gold)+legacy.gold;
      if(legacy.job){patch.refineryJobV1=null;patch.forgeFragments=W.num(user.forgeFragments)+legacy.refundFragments;}
      s.chests=W.num(s.chests+legacy.chests);s.legacyConverted=true;
      tx.set(db.collection('weaponLegacyArchives').doc(request),{uid,version:1,convertedAtMs:now,artifacts:legacy.artifacts,materials:legacy.materials,equipped:user.artifactSystem?.equipped||{},job:legacy.job,chests:legacy.chests,gold:legacy.gold,refundFragments:legacy.refundFragments});
      result={action,chests:legacy.chests,gold:legacy.gold,refundFragments:legacy.refundFragments};
    }
    s.revision++;s.updatedAtMs=now;
    // The mirror is display-only. Combat reads ARMORIES directly.
    patch.weaponSystemV1=W.normalize(s);
    tx.set(armoryRef,s);tx.update(userRef,patch);tx.set(receiptRef,{uid,signature,result,createdAtMs:now});
    const updated=JSON.parse(JSON.stringify(user));
    for(const [field,value]of Object.entries(patch)){const parts=field.split('.');let at=updated;for(const part of parts.slice(0,-1))at=at[part]||={};at[parts.at(-1)]=value;}
    return reply(updated,s,{result});
  });
}
function register(app,{resolve=()=>playerRepository.resolve(),verify=verifyMainIdentity,random,logger=console}={}){
  const handler=action=>async(req,res)=>{res.set?.('Cache-Control','no-store');try{const uid=await verify(req);res.json(await transact(resolve().db,uid,action,req.body||{},Date.now(),random));}
    catch(e){if(!e.status)logger.error('[Weapon armory]',e.message);res.status(e.status||503).json({ok:false,error:e.status?e.message:'兵器同步失敗，可安全重試同一操作'});}};
  app.get('/api/weapons',handler('view'));
  for(const action of actions)app.post('/api/weapons/'+action,handler(action));
}
module.exports=register;module.exports.__test={ARMORIES,RECEIPTS,key,legacyPreview,response,transact};

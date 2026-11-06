'use strict';
const crypto = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const { playerRepository } = require('./server-repositories.cjs');
const { PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const pool = require('./public/cultivation/soulbound-pool.js');
const fragments = require('./public/cultivation/forge-fragments.js');
const fail = (message, status = 409) => Object.assign(new Error(message), {status});
const count = fragments.integer;
const copySystem = system => ({...(system || {}), inventory:{...(system?.inventory || {})}});
// The sole historical built-in soulbound item, used only while an old catalog
// has not been migrated. Keep this in sync with the built-in artifact catalog.
const LEGACY_DEFAULT = {id:'void-sword',name:'太虛劍',icon:'劍',realm:'元嬰',category:'裝備法寶',equipSlot:'本命法寶',description:'以太虛劍意加持鬥法攻擊。',craft:{gold:520,yield:1},effects:[{type:'equip_attack_flat',value:180}]};
function catalogItems(catalog) {
  const remote=Array.isArray(catalog?.items)?catalog.items:[];
  const fallback=count(catalog?.artifactCatalogSchemaVersion)>=2 ? [] : [LEGACY_DEFAULT];
  return new Map([...fallback,...remote,...pool.ITEMS].map(item=>[item.id,item]));
}
const keyFor = (stage,id) => `refine-${stage}-${crypto.createHash('sha256').update(id).digest('hex').slice(0,32)}`;
function depth(id, recipes, visiting = new Set(), catalog = null) {
  if (visiting.has(id)) throw fail('舊法器配方資料異常，請聯絡管理員');
  if (pool.get(id)) return 0;
  const recipe = recipes[id];
  const item = pool.get(id) || catalog?.get(id);
  if (catalog && !item) throw fail('舊法器所需的配方資料不完整，請聯絡管理員核對');
  if (item?.generatedByAI === true && (!Array.isArray(recipe) || !recipe.length)) throw fail('此舊法器缺少煉製紀錄，請聯絡管理員核對');
  if (!Array.isArray(recipe) || !recipe.length) return 0;
  visiting.add(id);
  let result = 0;
  for (const row of recipe) if (row?.artifactId) result = Math.max(result, 1 + depth(row.artifactId, recipes, visiting, catalog));
  visiting.delete(id); return result;
}
function stageOf(item, recipes, catalog = null) {
  if ([2,3].includes(item.simpleRefinementStage)) return item.simpleRefinementStage;
  if (pool.get(item.id)) return 1;
  if (item.generatedByAI === true && (!Array.isArray(recipes[item.id]) || !recipes[item.id].length)) throw fail('此舊法器缺少煉製紀錄，請聯絡管理員核對');
  return Math.min(3, 1 + depth(item.id, recipes, new Set(), catalog));
}
function upgrade(source, targetStage) {
  const effects = (source.effects || []).map(effect => {
    const next = {...effect};
    if (!Object.hasOwn(effect,'value') || !Number.isFinite(Number(effect.value))) return next;
    const value = Number(effect.value), inverse = effect.type === 'equip_damage_cap_percent';
    const bounds = pool.EFFECT_BOUNDS[effect.type];
    let upgraded = inverse ? value * .85 : value * 1.15;
    if (effect.type.endsWith('_flat')) upgraded = Math.ceil(upgraded);
    else upgraded = Math.round(upgraded * 10000) / 10000;
    if (bounds) upgraded = Math.min(bounds.max, Math.max(bounds.min, upgraded));
    next.value = upgraded; return next;
  });
  if (!effects.some((effect,i) => effect.value !== source.effects[i].value)) throw fail('此法器的數值已達上限，無法再提升');
  return {...source,id:keyFor(targetStage,source.id),name:source.name, effects,
    simpleRefinementStage:targetStage,simpleRefinementSource:source.id,
    description:`${source.name}，${targetStage === 2 ? '二次' : '三次'}煉製。保留原有效果並提升數值。`,
    generatedByAI:false,reviewStatus:'approved'};
}
function requirement(source, stage) {
  const order = Math.max(1, fragments.order(source.realm));
  return {stage,stone:stage === 2 ? 'raid-refine-key-ii':'raid-refine-key-iii',
    quantity:stage === 2 ? Math.ceil(order/2) : Math.ceil(order*2/3),
    fragments:fragments.baseCost(source.realm)};
}
async function transaction(db,uid,action,body={}) {
  if (!['upgrade','refund'].includes(action)) throw fail('未知操作',400);
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(String(body.requestId||''))) throw fail('請求編號無效',400);
  const userRef=db.collection('users').doc(uid), catalogRef=db.collection('gameConfig').doc('artifactCatalogV1'), recipeRef=db.collection('gameConfig').doc('materialCatalogV1');
  // Reuse the existing server-owned economy receipt collection and namespace
  // these IDs so they cannot collide with a dismantle operation.
  const receiptRef=db.collection('inventoryDismantleReceipts').doc(crypto.createHash('sha256').update('simple-forge:'+uid+':'+body.requestId).digest('hex'));
  const signature=JSON.stringify({action,itemId:body.itemId||'',jobId:body.jobId||'',expected:body.expected||null});
  return db.runTransaction(async tx=>{
    const [us,cs,rs,receipt]=await Promise.all([tx.get(userRef),tx.get(catalogRef),tx.get(recipeRef),tx.get(receiptRef)]);
    if(!us.exists)throw fail('玩家資料不存在',404);
    const user=us.data()||{}, catalog=cs.data()||{}, recipes=rs.data()?.recipes||{};
    if(user.uid && user.uid!==uid)throw fail('玩家身分不符',403);
    if(receipt.exists){const saved=receipt.data();if(saved.uid!==uid || saved.signature!==signature)throw fail('此請求編號已用於其他操作');return {...saved.result,replayed:true};}
    let result,patch;
    if(action==='refund'){
      const job=user.refineryJobV1;
      if(!job?.id || job.id!==body.jobId || !Array.isArray(job.recipe))throw fail('舊煉製工作已變更，請重新整理');
      const material=copySystem(user.materialSystem),artifact=copySystem(user.artifactSystem);
      for(const row of job.recipe){
        if(!row || Boolean(row.artifactId)===Boolean(row.materialId) || !Number.isSafeInteger(row.quantity) || row.quantity<1 || row.quantity>8)throw fail('舊煉製資料異常，請聯絡管理員');
        if(row.materialId && user.isAdmin===true)continue;
        const inv=row.artifactId?artifact.inventory:material.inventory,id=row.artifactId||row.materialId;
        if(typeof id!=='string'||!id||id.includes('.')||id==='__proto__')throw fail('舊煉製資料異常，請聯絡管理員');
        inv[id]=count(inv[id])+row.quantity;
      }
      if(user.isAdmin!==true && job.keyRequirement?.materialId){const key=job.keyRequirement;if(!Number.isSafeInteger(key.quantity)||key.quantity<0||key.quantity>20||!['raid-refine-key-ii','raid-refine-key-iii'].includes(key.materialId))throw fail('舊煉製升階石資料異常，請聯絡管理員');material.inventory[key.materialId]=count(material.inventory[key.materialId])+key.quantity;}
      patch={materialSystem:material,artifactSystem:artifact,refineryJobV1:null};
      if(job.currency==='forgeFragments')patch.forgeFragments=fragments.balance(user)+count(job.fragmentCost);
      else patch['stats.gold']=count(user.stats?.gold)+count(job.goldCost);
      result={kind:'refund',jobId:job.id};
    }else{
      if(user.refineryJobV1?.id)throw fail('請先退還進行中的舊煉製');
      const id=String(body.itemId||'');
      const catalogMap=catalogItems(catalog), rawSource=catalogMap.get(id);
      const source=rawSource && pool.balanceArtifact(rawSource);
      if(!source || source.equipSlot!=='本命法寶')throw fail('找不到此本命法器');
      const stage=stageOf(source,recipes,catalogMap)+1;if(stage>3)throw fail('此法器已達三次煉製');
      const req=requirement(source,stage),artifact=copySystem(user.artifactSystem),material=copySystem(user.materialSystem);
      if(!body.expected || body.expected.stage!==req.stage || body.expected.stone!==req.stone || body.expected.quantity!==req.quantity || body.expected.fragments!==req.fragments)throw fail('升階條件已更新，請重新確認');
      artifact.equipped={...(artifact.equipped||{})};
      if(count(artifact.inventory[id])<2)throw fail('需要兩件完全相同的法器');
      if(fragments.balance(user)<req.fragments)throw fail('煉器碎片不足');
      if(count(material.inventory[req.stone])<req.quantity)throw fail('對應等階的升階石不足');
      const target=upgrade(source,stage),items=Array.isArray(catalog.items)?catalog.items:[];
      const existing=items.find(row=>row.id===target.id);
      if(existing && (existing.simpleRefinementSource!==source.id || existing.simpleRefinementStage!==stage || existing.realm!==target.realm || !isDeepStrictEqual(existing.effects,target.effects)))throw fail('法器效果已更新，請聯絡管理員確認');
      artifact.inventory[id]-=2;if(!artifact.inventory[id])delete artifact.inventory[id];
      artifact.inventory[target.id]=count(artifact.inventory[target.id])+1;
      if(artifact.equipped['本命法寶']===id)artifact.equipped['本命法寶']=target.id;
      material.inventory[req.stone]-=req.quantity;if(!material.inventory[req.stone])delete material.inventory[req.stone];
      patch={artifactSystem:artifact,materialSystem:material,forgeFragments:fragments.balance(user)-req.fragments};
      result={kind:'upgrade',item:existing||target,requirement:req};
      if(!existing){const nextCatalog={...catalog,items:[target,...items]};if(cs.exists)tx.update(catalogRef,{items:nextCatalog.items});else tx.set(catalogRef,nextCatalog);}
    }
    tx.update(userRef,patch);tx.create(receiptRef,{uid,signature,result});return result;
  });
}
async function view(db, uid) {
  return db.runTransaction(async tx=>{
    const [us,cs,rs]=await Promise.all([tx.get(db.collection('users').doc(uid)),tx.get(db.collection('gameConfig').doc('artifactCatalogV1')),tx.get(db.collection('gameConfig').doc('materialCatalogV1'))]);
    if(!us.exists)throw fail('玩家資料不存在',404);
    const user=us.data()||{}, catalog=cs.data()||{}, recipes=rs.data()?.recipes||{};
    if(user.uid && user.uid!==uid)throw fail('玩家身分不符',403);
    const items=catalogItems(catalog);
    const weapons=[];
    for(const [id,quantity] of Object.entries(user.artifactSystem?.inventory||{})){
      const raw=items.get(id), item=raw && pool.balanceArtifact(raw);if(!item || item.equipSlot!=='本命法寶'||count(quantity)<1)continue;
      let stage,req,error='';try{stage=stageOf(item,recipes,items);if(stage<3){req=requirement(item,stage+1);upgrade(item,stage+1);}}catch(e){error=e.message;}
      weapons.push({item,quantity:count(quantity),stage,requirement:req||null,error});
    }
    return {weapons,job:user.refineryJobV1||null,fragments:fragments.balance(user),artifactSystem:user.artifactSystem||{},materialSystem:user.materialSystem||{},gold:count(user.stats?.gold)};
  });
}
function createHandler({resolveA=()=>playerRepository.resolve(),logger=console,read=false}={}){return async(req,res)=>{
  res.set?.('Cache-Control','no-store');try{
    const token=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization')||''));if(!token)throw fail('請先登入',401);
    const repo=resolveA();let identity;try{identity=await repo.auth.verifyIdToken(token[1],true);}catch(_){throw fail('登入狀態已失效',401);}
    if(!identity?.uid||identity.aud!==PROJECT_IDS.A||identity.iss!=='https://securetoken.google.com/'+PROJECT_IDS.A)throw fail('登入身分驗證失敗',401);
    return res.json({ok:true,...await (read?view(repo.db,identity.uid):transaction(repo.db,identity.uid,req.body?.action,req.body||{}))});
  }catch(error){if(!error.status)logger.error('[Simple forge]',error);return res.status(error.status||503).json({ok:false,error:error.status?error.message:'操作結果尚未確認，請重試'});}
};}
module.exports=app=>{app.get('/api/simple-forge',createHandler({read:true}));app.post('/api/simple-forge',createHandler());};
module.exports.__test={transaction,view,upgrade,stageOf,depth,requirement,createHandler};

'use strict';
const crypto = require('node:crypto');
const { playerRepository } = require('./server-repositories.cjs');
const { PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const fragments = require('./public/cultivation/forge-fragments.js');
const pool = require('./public/cultivation/soulbound-pool.js');
const fail = (message, status = 409) => Object.assign(new Error(message), {status});
const count = fragments.integer;
function selections(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 100) throw fail('請選擇 1 至 100 種材料或法寶', 400);
  const seen = new Set();
  return raw.map(row => {
    const type = row?.type, id = row?.id, quantity = row?.quantity;
    if (!['artifact','material'].includes(type) || typeof id !== 'string' || !id || id.length > 160 ||
        /[\u0000-\u001f/]/.test(id) || ['__proto__','constructor','prototype'].includes(id) ||
        !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) throw fail('分解品項或數量無效', 400);
    const key = type + ':' + id;
    if (seen.has(key)) throw fail('分解清單有重複品項', 400);
    seen.add(key); return {type,id,quantity};
  }).sort((a,b) => (a.type+':'+a.id).localeCompare(b.type+':'+b.id));
}
function catalog(config) {
  const remote = Array.isArray(config?.items) ? config.items.filter(x => x && typeof x.id === 'string') : [];
  const fallback = remote.length && count(config.artifactCatalogSchemaVersion) >= 2 ? [] : fragments.DEFAULT_ARTIFACTS;
  return new Map([...fallback,...remote,...pool.ITEMS].map(item => [item.id,item]));
}
function availableItems(user, config) {
  const artifacts = catalog(config), materials = new Map(fragments.MATERIALS.map(item => [item.id,item]));
  const reserved = new Map();
  for (const id of Object.values(user.artifactSystem?.equipped || {})) reserved.set(id,(reserved.get(id)||0)+1);
  const rows = [];
  for (const type of ['material','artifact']) {
    const inventory = user[type === 'artifact' ? 'artifactSystem' : 'materialSystem']?.inventory || {};
    for (const [id, value] of Object.entries(inventory)) {
      const item = (type === 'artifact' ? artifacts : materials).get(id), owned = count(value);
      const unitFragments = fragments.unitValue(type,item);
      if (!item || !owned || !unitFragments) continue;
      const equipped = type === 'artifact' ? reserved.get(id)||0 : 0;
      rows.push({type,id,name:String(item.name||id),realm:String(item.realm||'凡人'),owned,
        available:Math.max(0,owned-equipped),reserved:equipped,unitFragments,equipSlot:item.equipSlot||''});
    }
  }
  return rows;
}
async function transaction(db, uid, action = 'view', body = {}) {
  const userRef = db.collection('users').doc(uid), configRef = db.collection('gameConfig').doc('artifactCatalogV1');
  let chosen = null, signature = '', receiptRef = null;
  if (action === 'dismantle') {
    if (body.confirmed !== true) throw fail('請先確認分解品項與數量', 400);
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(String(body.requestId||''))) throw fail('分解請求編號無效', 400);
    chosen = selections(body.items);
    if (!Number.isSafeInteger(body.expectedFragments) || body.expectedFragments < 1) throw fail('請先確認可得碎片',400);
    signature = JSON.stringify({items:chosen,expectedFragments:body.expectedFragments});
    const key = crypto.createHash('sha256').update(uid+':'+body.requestId).digest('hex');
    receiptRef = db.collection('inventoryDismantleReceipts').doc(key);
  } else if (action !== 'view') throw fail('未知分解操作',400);
  return db.runTransaction(async tx => {
    const [userSnap,configSnap,receiptSnap] = await Promise.all([tx.get(userRef),tx.get(configRef),receiptRef?tx.get(receiptRef):null]);
    if (!userSnap.exists) throw fail('玩家資料不存在',404);
    const user = userSnap.data()||{}, config = configSnap.data()||{};
    if (user.uid && user.uid !== uid) throw fail('玩家身分不符',403);
    let result = null;
    if (receiptSnap?.exists) {
      const saved = receiptSnap.data();
      if (saved.uid !== uid || saved.signature !== signature) throw fail('此請求編號已用於其他分解內容');
      result = saved.result;
    } else if (chosen) {
      const choices = new Map(availableItems(user,config).map(row=>[row.type+':'+row.id,row]));
      const rows = chosen.map(row => {
        const item = choices.get(row.type+':'+row.id);
        if (!item || item.available < row.quantity) throw fail('物品數量已變更或正在裝備，請重新選擇');
        return {...row,name:item.name,unitFragments:item.unitFragments};
      });
      const total = rows.reduce((sum,row)=>sum+row.quantity*row.unitFragments,0);
      if (!Number.isSafeInteger(total) || total !== body.expectedFragments) throw fail('分解碎片數已更新，請重新確認');
      const nextFragments = fragments.balance(user)+total;
      if (!Number.isSafeInteger(nextFragments)) throw fail('碎片餘額超過可保存範圍');
      const patch = {'forgeFragments':nextFragments};
      for (const type of ['material','artifact']) {
        const field = type === 'artifact' ? 'artifactSystem' : 'materialSystem';
        const inventory = {...user[field]?.inventory};
        for (const row of rows.filter(r=>r.type===type)) {
          const remain = count(inventory[row.id])-row.quantity;
          if (remain) inventory[row.id]=remain; else delete inventory[row.id];
        }
        if (rows.some(r=>r.type===type)) {patch[field+'.inventory']=inventory;user[field]||={};user[field].inventory=inventory;}
      }
      user.forgeFragments=nextFragments;
      result = {requestId:body.requestId,fragments:total,items:rows,createdAtMs:Date.now()};
      tx.update(userRef,patch);tx.create(receiptRef,{uid,signature,result});
    }
    return {ok:true,result,fragments:fragments.balance(user),version:fragments.VERSION,
      artifactInventory:user.artifactSystem?.inventory||{},materialInventory:user.materialSystem?.inventory||{},items:availableItems(user,config)};
  });
}
function createHandler({action='view',resolveA=()=>playerRepository.resolve(),logger=console}={}) {
  return async(req,res)=>{
    res.set?.('Cache-Control','no-store');
    try {
      const token=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization')||''));
      if(!token)throw fail('請先登入',401);
      const a=resolveA();let identity;
      try{identity=await a.auth.verifyIdToken(token[1],true);}catch(_){throw fail('登入狀態已失效，請重新登入',401);}
      if(!identity?.uid||identity.aud!==PROJECT_IDS.A||identity.iss!=='https://securetoken.google.com/'+PROJECT_IDS.A)throw fail('登入身分驗證失敗',401);
      return res.json(await transaction(a.db,identity.uid,action,req.body||{}));
    }catch(e){if(!e.status)logger.error('[Inventory dismantle]',e.code||e.message);return res.status(e.status||503).json({ok:false,error:e.status?e.message:'分解結果尚未確認，請重試原操作'});}
  };
}
module.exports=app=>{app.get('/api/inventory/dismantle',createHandler());app.post('/api/inventory/dismantle',createHandler({action:'dismantle'}));};
module.exports.__test={transaction,createHandler,selections,availableItems,catalog};

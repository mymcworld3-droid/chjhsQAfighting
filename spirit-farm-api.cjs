'use strict';
const crypto=require('node:crypto');
const {playerRepository}=require('./server-repositories.cjs');
const {verifyMainIdentity}=require('./raid-question-ticket.cjs');
const Rules=require('./public/cultivation/spirit-farm-rules.js');
const Access=require('./public/cultivation/training-access-rules.js');
const Quests=require('./public/cultivation/quest-rules.js');
const fail=(message,status=409)=>Object.assign(Error(message),{status});
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const dateKey=ms=>Quests.dateKey(new Date(ms));
const timestamp=value=>typeof value?.toMillis==='function'?value.toMillis():typeof value?.toDate==='function'?value.toDate().getTime():value instanceof Date?value.getTime():typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
function operation(body={}) {
  if(!/^[A-Za-z0-9_-]{16,80}$/.test(String(body.requestId||''))||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)throw fail('操作資料已更新，請重新同步靈田',400);
  const actions=['plant','water','fertilize','purify','harvest','harvest-all','seed','expand','channel','exchange','study'];
  if(!actions.includes(body.action))throw fail('未知的田務操作',400);
  const op={action:body.action,requestId:body.requestId,expectedRevision:body.expectedRevision};
  if(['plant','water','fertilize','purify','harvest'].includes(op.action)){
    if(!Number.isInteger(body.index)||body.index<0||body.index>8)throw fail('請選擇有效田地',400);op.index=body.index;
  }
  if(['plant','seed','exchange'].includes(op.action)){
    if(!Rules.crop(body.cropId))throw fail('請選擇有效靈草',400);op.cropId=body.cropId;
  }
  if(op.action!=='plant'&&['water','fertilize','purify','harvest'].includes(op.action)){
    if(typeof body.plantId!=='string'||body.plantId.length<8||body.plantId.length>80)throw fail('植株已變更，請重新選擇',400);op.plantId=body.plantId;
  }
  return op;
}
function createService({db,now=Date.now,random=Math.random,uuid=crypto.randomUUID}={}) {
  async function transact(uid,body) {
    const op=body?operation(body):null,signature=op?hash(JSON.stringify(op)):'';
    // Retried database callbacks reuse the same entropy; refresh cannot reroll a harvest.
    const entropy=op?.action==='plant'?{id:uuid(),pest:random()<.12,mutationRoll:random()}:null;
    return db.runTransaction(async tx=>{
      const userRef=db.collection('users').doc(uid),farmRef=db.collection('spiritFarms').doc(uid);
      const [u,s]=await Promise.all([tx.get(userRef),tx.get(farmRef)]);
      if(!u.exists)throw fail('玩家資料不存在',404);
      const user=u.data()||{};if(user.uid&&user.uid!==uid)throw fail('玩家身分不符',403);
      const time=now(),date=dateKey(time),farm=Rules.normalize(s.exists?s.data():null,time);
      const publicView=(result=null,replayed=false)=>({ok:true,farm:Rules.view(farm,time,date,Access.score(user)),result,replayed,materialInventory:user.materialSystem?.inventory||{}});
      if(!op){if(!s.exists)tx.set(farmRef,farm);return publicView();}
      const previous=farm.operations.find(x=>x.id===op.requestId);
      if(previous){if(previous.signature!==signature)throw fail('此操作編號已用於其他田務');return publicView(previous.result,true);}
      if(farm.revision!==op.expectedRevision)throw fail('靈田已有新的變化，請重新同步後再操作');
      let logs=null;
      if(op.action==='study')logs=await tx.get(db.collection('exam_logs').where('uid','==',uid).orderBy('timestamp','desc').limit(80));
      const c=Rules.crop(op.cropId),p=Number.isInteger(op.index)?farm.plots[op.index]:null;
      if(Number.isInteger(op.index)&&op.index>=farm.openPlots)throw fail('這排田地尚未開墾');
      if(['water','fertilize','purify','harvest'].includes(op.action)&&(!p||p.id!==op.plantId))throw fail('植株已採收或變更，請重新選擇');
      const result={action:op.action,message:'田務已完成'};
      const spend=cost=>{for(const [key,n]of Object.entries(cost))if(farm.harvest[key]<n)throw fail('收成不足，請先採收所需靈草');for(const [key,n]of Object.entries(cost))farm.harvest[key]-=n;};
      const energy=n=>{if(farm.energy<n)throw fail('靈氣不足，可從今日作答紀錄納取靈氣');farm.energy-=n;};
      const boost=(plant,fraction)=>{plant.readyAt=Math.max(time,plant.readyAt-plant.originalMs*fraction);};
      if(op.action==='plant'){
        if(p)throw fail('這畦已有靈草');if(!farm.seeds[c.id])throw fail('種子不足，可到種子袋換取');
        farm.seeds[c.id]--;const irrigated=farm.channel&&op.index%3===0;
        farm.plots[op.index]={...entropy,cropId:c.id,plantedAt:time,readyAt:time+c.minutes*Rules.MINUTE*(irrigated?.75:1),originalMs:c.minutes*Rules.MINUTE,
          watered:irrigated,channelBonus:irrigated,fertilized:false,cleared:false};
        result.message='已種下'+c.name+(irrigated?'，水渠已自動灌溉':'');
      }else if(['water','fertilize','purify'].includes(op.action)){
        if(time>=p.readyAt)throw fail('靈草已成熟，現在可以採收');
        if(op.action==='water'){if(p.watered)throw fail('這株已灌溉');p.watered=true;boost(p,.1);result.message='清泉潤田，生長時間縮短，品質提升';}
        if(op.action==='fertilize'){if(p.fertilized)throw fail('這株已施肥');energy(2);p.fertilized=true;boost(p,.15);result.message='已消耗 2 點靈氣施肥，生長時間縮短，品質提升';}
        if(op.action==='purify'){if(!p.pest||p.cleared)throw fail('這株目前沒有靈蟲');energy(1);p.pest=false;p.cleared=true;result.message='已消耗 1 點靈氣驅散靈蟲，品質提升';}
      }else if(op.action==='harvest'||op.action==='harvest-all'){
        const indices=op.action==='harvest'?[op.index]:farm.plots.map((plant,i)=>plant&&i<farm.openPlots&&plant.readyAt<=time?i:-1).filter(i=>i>=0);
        if(!indices.length||indices.some(i=>!farm.plots[i]||farm.plots[i].readyAt>time))throw fail('靈草尚未成熟');
        // Compute every companion bonus before removing any plant in a bulk harvest.
        result.items=indices.map(i=>Rules.harvestResult(farm,i));
        for(const item of result.items){farm.harvest[item.cropId]+=item.quantity;farm.seeds[item.cropId]+=item.seeds;farm.totalHarvest+=item.quantity;if(item.mutated)farm.mutations[item.cropId]++;farm.plots[item.index]=null;}
        result.message=result.items.map(x=>`${x.quality}${x.name} ×${x.quantity}`).join('、')+'；已留下種子';
      }else if(op.action==='seed'){
        if(farm.seeds[c.id]>=9999)throw fail('種子袋已滿');spend(c.seedCost);farm.seeds[c.id]++;result.message='已換取'+c.name+'種子 ×1';
      }else if(op.action==='expand'){
        const cost=Rules.EXPANSION_COSTS[farm.openPlots/3-1];if(!cost)throw fail('九畦靈田已全部開墾');spend(cost);farm.openPlots+=3;result.message='已開墾一排田地，共 '+farm.openPlots+' 畦可種植';
      }else if(op.action==='channel'){
        if(farm.channel)throw fail('水渠已修復');spend(Rules.CHANNEL_COST);farm.channel=true;
        for(const i of [0,3,6]){const plant=farm.plots[i];if(plant&&i<farm.openPlots&&plant.readyAt>time){const reduction=(plant.watered?0:.1)+(plant.channelBonus?0:.15);plant.watered=true;plant.channelBonus=true;boost(plant,reduction);}}
        result.message='水渠已修復，左側田地自動灌溉，生長時間縮短 25%';
      }else if(op.action==='exchange'){
        if(Access.score(user)<c.minScore)throw fail(c.materialName+'兌換需達'+(c.minScore===28?'金丹境':'築基初期'));
        spend({[c.id]:c.exchange});const materialInventory={...(user.materialSystem?.inventory||{})};
        const quantity=Number(materialInventory[c.material])||0;if(!Number.isSafeInteger(quantity)||quantity<0||quantity>=1000000)throw fail('材料數量異常，請先整理背包');
        materialInventory[c.material]=quantity+1;user.materialSystem={...user.materialSystem,inventory:materialInventory};tx.update(userRef,{'materialSystem.inventory':materialInventory});
        result.message='已將 '+c.exchange+' 株'+c.name+'換成'+c.materialName+' ×1，存入背包';
      }else if(op.action==='study'){
        if(farm.study.date!==date)farm.study={date,count:0,seen:[]};
        if(farm.study.count>=Rules.STUDY_CAP)throw fail('今日修習靈氣已納滿，明日可再納取');
        const room=Math.min(Rules.STUDY_CAP-farm.study.count,Rules.ENERGY_CAP-farm.energy);
        if(room<=0)throw fail('靈氣已滿，可先施肥或驅蟲');
        const seen=new Set(farm.study.seen),eligible=[];
        for(const log of logs.docs){const data=log.data(),at=timestamp(data.timestamp);if(data.uid!==uid||typeof data.isCorrect!=='boolean'||!Number.isInteger(data.userIdx)||data.userIdx<0||!Number.isFinite(at)||at>time||dateKey(at)!==date||typeof data.question!=='string'||!data.question.trim())continue;
          const key=hash(data.question.normalize('NFC').replace(/\s+/g,' ').trim()).slice(0,24);if(seen.has(key))continue;seen.add(key);eligible.push(key);if(eligible.length>=room)break;}
        if(!eligible.length)throw fail('尚無新的已保存作答紀錄，修習後再回來納取');
        farm.study.seen.push(...eligible);farm.study.count+=eligible.length;farm.energy+=eligible.length;
        result.energy=eligible.length;result.message='已納取修習靈氣 +'+eligible.length+'，答對與答錯皆計入';
      }
      farm.revision++;farm.operations.push({id:op.requestId,signature,result});farm.operations=farm.operations.slice(-64);tx.set(farmRef,farm);
      return publicView(result);
    });
  }
  return {view:uid=>transact(uid,null),act:transact};
}
function register(app,{resolve=()=>playerRepository.resolve(),verify=verifyMainIdentity,now=Date.now,random=Math.random,logger=console}={}) {
  const handler=action=>async(req,res)=>{
    res.set?.('Cache-Control','no-store');
    try{const uid=await verify(req),{db}=resolve(),service=createService({db,now,random});return res.json(await(action?service.act(uid,req.body||{}):service.view(uid)));}
    catch(error){if(!error.status)logger.error('[Spirit farm]',error.code||error.message);return res.status(error.status||503).json({ok:false,error:error.status?error.message.replace('後再進行團本答題','後再進入靈田'):'田務結果尚未確認，請重試原操作'});}
  };
  app.get('/api/spirit-farm',handler(false));app.post('/api/spirit-farm',handler(true));
}
module.exports=register;module.exports.__test={createService,operation,dateKey,timestamp};

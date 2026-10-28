'use strict';
const crypto=require('node:crypto');
const aiRouter=require('./ai-router');
const {playerRepository}=require('./server-repositories.cjs');
const {verifyMainIdentity}=require('./raid-question-ticket.cjs');
const Rules=require('./public/cultivation/adaptive-learning-rules.js');
const {QUESTION_FORMS}=require('./quiz-generation-tasks.cjs');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const clean=(value,max=100)=>String(value||'').trim().slice(0,max);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const labelKey=value=>clean(value).replace(/[\s的，。、：:（）()]/g,'');
function selection(raw={}){return {path:clean(raw.path,240),detail:clean(raw.detail,120),sub_topics:[...new Set((Array.isArray(raw.sub_topics)?raw.sub_topics:[]).map(x=>clean(x,100)).filter(Boolean))].sort().slice(0,24)};}
function scopeFor(unit,profile={}){
  const selected=selection(unit),parts=selected.path.split('/'),grade=parts[1]||'';
  const level=/^[七7](?:上|下|年級)/.test(grade)?'國中一年級':/^[八8](?:上|下|年級)/.test(grade)?'國中二年級':/^[九9](?:上|下|年級)/.test(grade)?'國中三年級':/^(國小|國中|高中)[一二三四五六]年級/.test(grade)?grade:clean(profile.educationLevel,32)||'國中一年級';
  const subject=clean(parts[0],40),topic=selected.detail||selected.path;
  if(!subject||!topic)throw fail('出題範圍不完整');
  return {...selected,subject,level,topic,scopeId:hash(JSON.stringify([subject,level,selected])).slice(0,24)};
}
function vertical(scope){return scope.subject==='物理'&&/(鉛直|垂直).{0,8}圓(周|面)/.test(scope.topic);}
function seedConcepts(scope){
  if(vertical(scope))return ['最高點','水平位置（中點）','最低點'].flatMap(position=>['速率','張力'].map(quantity=>({
    name:position+quantity,methods:[{name:quantity==='速率'?'由本點張力求'+position+'速率':'由本點速率求'+position+'張力',forms:['direct-application','inverse-reasoning']},
      {name:'由其他位置的已知條件求'+position+quantity,forms:['scenario-modeling','comparison','multi-step']}]
  })));
  return ['定義與適用條件','關係與直接應用','案例比較'].map(name=>({name,methods:[{name:scope.topic+'：'+name,forms:['direct-application','comparison','error-analysis']}]}));
}
function normalizePlan(raw,scope,source='ai'){
  const entries=Array.isArray(raw?.concepts)?raw.concepts:[];
  if(source==='ai'&&(entries.length<2||entries.length>20))throw fail('AI 範圍分析的觀念數量不符');
  let concepts=entries.map(c=>({name:clean(c?.name,80),methods:(Array.isArray(c?.methods)?c.methods:[]).slice(0,4).map(m=>({name:clean(m?.name,100),forms:[...new Set((Array.isArray(m?.forms)?m.forms:[]).filter(f=>QUESTION_FORMS.includes(f)))]}))}));
  if(source==='ai'&&concepts.some(c=>!c.name||!c.methods.length||c.methods.some(m=>!m.name||!m.forms.length)))throw fail('AI 範圍分析缺少細觀念或考法');
  if(vertical(scope)){
    for(const c of concepts)if(/^(中點|水平點|水平位置)(速率|張力)$/.test(labelKey(c.name)))c.name='水平位置（中點）'+labelKey(c.name).match(/(速率|張力)$/)[0];
    const seeds=seedConcepts(scope);
    for(const seed of seeds){const found=concepts.find(c=>labelKey(c.name)===labelKey(seed.name));if(found)seed.methods=[...found.methods,...seed.methods].slice(0,4);}
    concepts=[...seeds,...concepts.filter(c=>!seeds.some(s=>labelKey(s.name)===labelKey(c.name)))];
  }
  const unique=new Map();for(const c of concepts){if(c.name&&!unique.has(labelKey(c.name)))unique.set(labelKey(c.name),c);}
  const result=[],facets=[];
  for(const c of [...unique.values()].slice(0,16)){
    const id='c_'+hash(labelKey(c.name)).slice(0,16),methods=[];
    for(const m of c.methods){
      if(!m.name||!m.forms.length||methods.some(x=>labelKey(x.name)===labelKey(m.name)))continue;
      const facet={id:'f_'+hash(id+'\n'+labelKey(m.name)).slice(0,16),conceptId:id,concept:c.name,name:m.name,forms:m.forms};methods.push(facet);facets.push(facet);
      if(methods.length>=3||facets.length>=48)break;
    }
    if(methods.length)result.push({id,name:c.name,methods});if(facets.length>=48)break;
  }
  if(facets.length<3)throw fail('範圍分析必須提供至少三個可輪替考法');
  const version=hash(JSON.stringify(result)).slice(0,16);
  return {schema:1,scopeId:scope.scopeId,version,source,provisional:source!=='ai',concepts:result,facets};
}
function analysisPrompt(scope){return '你是台灣課綱習作編輯。分析以下學生已選範圍，不出測驗題，只拆解範圍內應練習的細觀念與習作考法。\n'+JSON.stringify(scope)+
  '\n不同位置、對象、物理量、條件必須分開；不要只列「基本應用、比較題」等空泛題型。每個細觀念提供 2～3 種不同的求解目標、已知條件或表示方式，不要以換數字假冒不同考法。只保留指定年級與範圍所需的內容。'+
  '\n例如鉛直圓周運動：最高點速率、最高點張力、水平位置速率、水平位置張力、最低點速率、最低點張力分成六個觀念，再考慮跨位置能量、臨界條件等適用考法。張力題須明示輕繩等物理條件，不混用桿或軌道的條件。'+
  '\n回傳純 JSON {"concepts":[{"name":"精確細觀念名稱","methods":[{"name":"具體考法（指出已知與所求或判斷目標）","forms":["direct-application"]}]}]}。2～16 個觀念，每個 1～3 個考法，考法總數至少三個。forms 只能使用：'+JSON.stringify(QUESTION_FORMS);}
function createAdaptiveLearning({resolve=()=>playerRepository.resolve(),verify=verifyMainIdentity,generate=aiRouter.generateJSON,now=Date.now,logger=console}={}){
  const cache=new Map(),pending=new Map(),lessons=new Map();
  async function planFor(db,scope){
    const key=scope.scopeId,known=cache.get(key);if(known&&known.until>now())return known.plan;
    if(pending.has(key))return pending.get(key);
    const work=(async()=>{
      const ref=db.collection('adaptiveScopePlans').doc(key);
      try{
        const stored=await ref.get();
        if(stored.exists&&stored.data()?.schema===1){const p=normalizePlan(stored.data().outline,scope);cache.set(key,{plan:p,until:now()+86400000});return p;}
        const result=await generate(analysisPrompt(scope),{timeoutMs:12000,validate:value=>normalizePlan(value,scope)});
        const plan=normalizePlan(result.data,scope);
        await ref.set({schema:1,scopeId:key,scope,outline:{concepts:plan.concepts.map(c=>({name:c.name,methods:c.methods.map(m=>({name:m.name,forms:m.forms}))}))},createdAtMs:now()});
        cache.set(key,{plan,until:now()+86400000});return plan;
      }catch(error){
        logger.warn('[Adaptive scope] analysis unavailable:',error.code||error.status||'unavailable');
        const plan=normalizePlan({concepts:seedConcepts(scope)},scope,'rules');cache.set(key,{plan,until:now()+60000});return plan;
      }
    })();pending.set(key,work);
    try{return await work;}finally{pending.delete(key);while(cache.size>160)cache.delete(cache.keys().next().value);}
  }
  async function context(req,body=req.body||{}){
    const uid=await verify(req),{db}=resolve();
    const snap=await db.collection('users').doc(uid).get();if(!snap.exists)throw fail('玩家資料不存在',404);
    const user=snap.data()||{},unit=selection(body.adaptiveScope),settings=user.gameSettings||{};
    if(settings.sourceMode!=='focused'||!Array.isArray(settings.focusedUnits)||!settings.focusedUnits.some(x=>JSON.stringify(selection(x))===JSON.stringify(unit)))throw fail('此範圍已變更，請重新開啟問道試煉',409);
    const scope=scopeFor(unit,user.profile),plan=await planFor(db,scope);
    return {uid,db,user,scope,plan};
  }
  async function prepare(req,body=req.body||{}){
    const c=await context(req,body);
    const conceptId=clean(body.adaptiveConceptId,40);
    if(conceptId&&!c.plan.concepts.some(x=>x.id===conceptId))throw fail('訂正觀念不在目前範圍內');
    const decision=Rules.decide(c.plan,c.user.stats?.adaptiveLearningV1,{now:now(),pending:Array.isArray(body.adaptivePending)?body.adaptivePending.slice(0,8):[],manualDifficulty:c.user.gameSettings?.difficulty||'auto',conceptId});
    return {...c,decision,target:index=>decision.targets[index%decision.targets.length]};
  }
  function validate(c,data,index){const f=c.target(index);if(data.adaptive_scope_id!==c.scope.scopeId||data.adaptive_facet_id!==f.id||data.adaptive_difficulty!==f.difficulty)throw fail('題目不符合分派的範圍細觀念、考法或難度');return true;}
  function prompt(c,index){const f=c.target(index),state=Rules.scopeState(c.user.stats?.adaptiveLearningV1,c.scope.scopeId);return '\n[範圍細觀念與考法]\n'+JSON.stringify({scope:c.scope,concept:f.concept,method:f.name,role:c.decision.role,adaptive_scope_id:c.scope.scopeId,adaptive_facet_id:f.id,adaptive_difficulty:f.difficulty})+
    '\n只考這個細觀念與考法，具體已知與所求必須符合指定目標，不可換成其他位置、物理量或另一個考法。題幹要足以獨立解題，不假設學生讀過前題。JSON 必須回傳以上三個 adaptive_ 欄位。'+
    (c.decision.role==='challenge'?'挑戰題使用範圍內的新應用、表示方式或遷移情境；仍遵守指定難度與推理步數上限，不得藉挑戰之名超綱。':'診斷與補強題用清楚、充分的條件辨識一個核心觀念，避免刻意設陷阱。')+
    (Rules.row(state.concepts[f.conceptId]).w>=2?'這是概念補給後的新情境練習。保持指定細觀念與考法，使用新的情境或表示方式，不能只替換舊題數字。':'')+
    (vertical(c.scope)?'最高點、水平位置、最低點與各點速率、張力各自分開。明示繩／桿／軌道及忽略阻力等適用條件。':'');}
  function metadata(c,data){const f=c.plan.facets.find(x=>x.id===data.adaptive_facet_id);if(!f||data.adaptive_scope_id!==c.scope.scopeId)throw fail('範圍考法已失效');return {questionId:crypto.randomUUID(),scopeId:c.scope.scopeId,planVersion:c.plan.version,scope:selection(c.scope),subject:c.scope.subject,topic:c.scope.topic,conceptId:f.conceptId,facetId:f.id,concept:f.concept,method:f.name,difficulty:data.adaptive_difficulty,role:c.decision.role,provisional:c.plan.provisional,
    outline:c.plan.concepts.map(x=>({id:x.id,name:x.name,methods:x.methods.map(m=>({id:m.id,name:m.name}))}))};}
  async function lesson(req){
    const c=await context(req),concept=c.plan.concepts.find(x=>x.id===req.body?.conceptId),state=Rules.scopeState(c.user.stats?.adaptiveLearningV1,c.scope.scopeId);
    if(!concept||!Rules.needsLesson(state,concept.id))throw fail('目前沒有需要補強的連續錯題',409);
    const key=c.scope.scopeId+':'+c.plan.version+':'+concept.id;
    if(!lessons.has(key)){
      const work=generate('你是台灣課綱教師。只講解下列已選範圍中的一個細觀念。提供短講解與一個簡單、完整可核對的示範例題（含解題過程與答案），讓學生再練另一道新情境題。不出選擇題、不跨範圍、不猜測學生錯因。數學使用成對 TeX。\n'+JSON.stringify({scope:c.scope,concept:concept.name,methods:concept.methods.map(m=>m.name)})+'\n只回傳 JSON {"explanation":"80～250字概念講解","example":"簡單示例、步驟與答案"}。',
        {timeoutMs:15000,validate:value=>{if(typeof value.explanation!=='string'||value.explanation.trim().length<10||typeof value.example!=='string'||value.example.trim().length<10)throw fail('觀念講解未完成');}})
        .then(result=>({explanation:result.data.explanation.slice(0,1800),example:result.data.example.slice(0,2200)}));
      lessons.set(key,work);work.catch(()=>lessons.delete(key));while(lessons.size>160)lessons.delete(lessons.keys().next().value);
    }
    return {...await lessons.get(key),conceptId:concept.id,concept:concept.name,scopeId:c.scope.scopeId,through:Rules.row(state.concepts[concept.id]).n};
  }
  return {prepare,validate,prompt,metadata,lesson,context};
}
function register(app,options){
  const api=createAdaptiveLearning(options);
  for(const [path,work]of [['plan',async req=>{const c=await api.context(req);return {plan:c.plan};}],['lesson',req=>api.lesson(req)]])app.post('/api/adaptive-learning/'+path,async(req,res)=>{
    res.set('Cache-Control','no-store');try{return res.json({ok:true,...await work(req)});}catch(error){return res.status(error.status||503).json({ok:false,error:error.status?error.message:'學習分析暫未完成，稍後會再嘗試'});}
  });
  return api;
}
module.exports=register;module.exports.__test={selection,scopeFor,seedConcepts,normalizePlan,analysisPrompt,createAdaptiveLearning};

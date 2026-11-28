'use strict';
// Stage 3A: real provider contract, bounded server-only discovery and retrieval.
// No public route, no source approval, no raw user input or player identity sent.
const {createHash,randomUUID}=require('node:crypto');
const T=require('./adaptive-learning-engine-beta-fetch.cjs');
const C=require('./adaptive-learning-engine-beta-contract.cjs');
const {betaEnabled}=require('./adaptive-learning-engine-beta-api.cjs');
const ENDPOINT='https://api.search.brave.com/res/v1/web/search';
const intents=Object.freeze({curriculum:'教材 目錄 課程',reference:'試題 答案'});
function publicQuery(terms={}){
  if(!terms||typeof terms!=='object'||Array.isArray(terms)||Object.keys(terms).some(k=>!['subject','grade','concept','publisher','intent'].includes(k)))T.fail('invalid-public-search-terms',400);
  const {subject,grade,concept,publisher,intent}=terms;
  // Trusted caller must supply public catalog labels, never raw scope text,
  // names, class identifiers, contact details, uploaded contents or history.
  const term=v=>typeof v==='string'&&v.length<=80&&/^[\p{L}\p{N}（）()、・．－\- ]+$/u.test(v)&&v.trim().length>0&&!/\d{6,}/.test(v);
  if(!term(subject)||!term(grade)||!term(concept)||(publisher!==undefined&&!term(publisher))||!Object.hasOwn(intents,intent))T.fail('invalid-public-search-terms',400);
  const q=[subject,grade,publisher,concept,intents[intent]].filter(Boolean).join(' ').trim();
  if(q.length>250)T.fail('invalid-public-search-terms',400);
  return q;
}
function hash(v){return createHash('sha256').update(v).digest('hex');}
function quota({now=Date.now,maxConcurrent=3,maxOwners=2000,searchDaily=100,fetchDaily=300,ownerSearchDaily=10,ownerFetchDaily=40,searchPerMinute=15,fetchPerMinute=30}={}){
  const limits={search:searchDaily,fetch:fetchDaily},perOwner={search:ownerSearchDaily,fetch:ownerFetchDaily},perMinute={search:searchPerMinute,fetch:fetchPerMinute};
  if([maxConcurrent,maxOwners,...Object.values(limits),...Object.values(perOwner),...Object.values(perMinute)].some(v=>!Number.isSafeInteger(v)||v<1))T.fail('invalid-quota',400);
  let day=-1,minute=-1,globalDay={search:0,fetch:0},globalMinute={search:0,fetch:0},inFlight=0,searchBlockedUntil=0;
  const owners=new Map(),active=new Set();
  function clock(){
    const t=now();if(!Number.isFinite(t))T.fail('invalid-clock');
    const d=Math.floor(t/86400000),m=Math.floor(t/60000);
    // Clock moving backwards must not restore quota.
    if(d>day){day=d;globalDay={search:0,fetch:0};owners.clear();}
    if(m>minute){minute=m;globalMinute={search:0,fetch:0};}
    return t;
  }
  function spend(owner,kind){
    const t=clock();
    if(kind==='search'&&t<searchBlockedUntil)T.fail('provider-cooldown',429);
    let user=owners.get(owner);
    if(!user){if(owners.size>=maxOwners)T.fail('quota-exhausted',429);user={search:0,fetch:0};owners.set(owner,user);}
    if(globalDay[kind]>=limits[kind]||globalMinute[kind]>=perMinute[kind]||user[kind]>=perOwner[kind])T.fail('quota-exhausted',429);
    globalDay[kind]++;globalMinute[kind]++;user[kind]++;
  }
  return Object.freeze({
    async run(ownerId,fn){
      if(!C.isUid(ownerId))T.fail('invalid-owner',400);
      const owner=hash(ownerId);clock();
      if(inFlight>=maxConcurrent||active.has(owner))T.fail('concurrency-limit',429);
      active.add(owner);inFlight++;
      try{return await fn(kind=>spend(owner,kind));}finally{active.delete(owner);inFlight--;}
    },
    coolDown(ms){searchBlockedUntil=Math.max(searchBlockedUntil,clock()+ms);},
    snapshot(){clock();return {globalDay:{...globalDay},globalMinute:{...globalMinute},inFlight,trackedOwners:owners.size};}
  });
}
function retryDelay(value,now=Date.now()){
  const s=String(value||'').trim();
  let ms=/^\d+$/.test(s)?Number(s)*1000:Date.parse(s)-now;
  if(!Number.isFinite(ms)||ms<0)ms=60000;
  return Math.min(86400000,Math.max(1000,ms));
}
function displayText(v,max){
  if(typeof v!=='string')return '';
  // Provider snippets are untrusted, NOT the document. No HTML rendering.
  return v.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
}
function createBraveProvider({apiKey,transport=T.requestBytes,timeoutMs=10000}={}){
  if(typeof apiKey!=='string'||apiKey.length<16||apiKey.length>512||/\s|[\u0000-\u001f\u007f]/.test(apiKey))T.fail('search-provider-unconfigured',503);
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)T.fail('invalid-search-timeout',400);
  return Object.freeze({name:'brave-web-v1',async search(query,{count=8}={}){
    if(typeof query!=='string'||!query.trim()||query.length>250||!Number.isSafeInteger(count)||count<1||count>20)T.fail('invalid-search-query',400);
    const u=new URL(ENDPOINT);
    for(const [k,v] of Object.entries({q:query,count:String(count),country:'TW',search_lang:'zh-hant',safesearch:'strict',spellcheck:'false',text_decorations:'false',result_filter:'web'}))u.searchParams.set(k,v);
    const signal=AbortSignal.timeout(timeoutMs);
    const response=await T.abortable(transport(T.safeURL(u.href,{query:true}),{
      signal,maxBytes:512*1024,headers:{Accept:'application/json','X-Subscription-Token':apiKey}
    }),signal);
    if(response.status===429)throw Object.assign(T.error('rate-limited',429),{retryAfterMs:retryDelay(response.headers['retry-after'])});
    if(response.status!==200)T.statusError(response.status); // no credential-bearing redirects
    if(!/^application\/json(?:;|$)/i.test(String(response.headers['content-type']||'')))T.fail('provider-invalid-response');
    let payload;try{payload=JSON.parse(response.bytes.toString('utf8'));}catch(_){T.fail('provider-invalid-response');}
    if(payload?.type!=='search')T.fail('provider-invalid-response');
    const results=payload.web==null?[]:payload.web.results;
    if(!Array.isArray(results)||results.length>100)T.fail('provider-invalid-response');
    const hits=[],seen=new Set();
    for(const [position,result] of results.entries()){
      if(hits.length>=count)break;
      if(typeof result?.url!=='string'||typeof result?.title!=='string')continue;
      // Strip only the fragment; skip unsafe/query-bearing links entirely.
      if(/[\\\u0000-\u0020\u007f]/.test(result.url))continue;
      let u;try{u=new URL(result.url);u.hash='';u=T.safeURL(u.href,{query:true});}catch(_){continue;}
      if(seen.has(u.href)||!displayText(result.title,300))continue;
      // Never keep query values in candidate metadata: do not strip them and
      // pretend the resulting different page is the source. Skip these hits.
      if(u.search)continue;
      seen.add(u.href);
      hits.push({url:u.href,title:displayText(result.title,300),rank:position+1,provider:'brave-web-v1',
        discoveryStatus:'candidate',humanProvenanceStatus:'unverified',answerEvidenceStatus:'unknown'});
    }
    return {hits,provider:'brave-web-v1',searchedAt:Date.now(),returnedCount:results.length};
  }});
}
function sourceCandidate(document,hit){
  // Discovery title is untrusted; human/answer evidence and permission are NOT inferred.
  return C.validate('source',{schemaVersion:C.VERSION,createdAt:document.retrievedAt,sourceId:'web-'+hash(document.canonicalURL).slice(0,40),
    canonicalURL:document.canonicalURL,documentTitle:hit.title,organization:'unknown',year:null,locator:'document bytes; page not parsed',
    retrievedAt:document.retrievedAt,contentHash:document.contentHash,sourceType:'unknown',humanProvenanceStatus:'unverified',
    extractionQuality:'partial',license:'unknown',usePolicy:'unknown',answerEvidenceStatus:'unknown',revision:1});
}
function createService({env=process.env,transport=T.requestBytes,budget=quota(),fetchHosts,searchProvider}={}){
  // Explicit opt-in for developer diagnostic only; no route is installed.
  if(env.NODE_ENV==='production'||env.ADAPTIVE_LEARNING_ENGINE_SEARCH_ENABLED!=='1'||!betaEnabled(env))T.fail('search-disabled',503);
  if(env.ADAPTIVE_LEARNING_ENGINE_SEARCH_PROVIDER!=='brave')T.fail('search-provider-unconfigured',503);
  const provider=searchProvider||createBraveProvider({apiKey:env.BRAVE_SEARCH_API_KEY,transport});
  const configuredHosts=fetchHosts??String(env.ADAPTIVE_LEARNING_ENGINE_FETCH_HOSTS||'').split(',').map(v=>v.trim()).filter(Boolean);
  T.createFetchProvider({allowedHosts:configuredHosts}); // validate policy before spending provider quota
  const allowedHosts=Object.freeze([...configuredHosts]);
  // Opaque, bounded, per-service search result capability. No fetching raw URL
  // supplied by a client or later changed after discovery.
  const leases=new Map(),ttl=5*60*1000,maxLeases=256;
  function checkGate(){if(env.NODE_ENV==='production'||env.ADAPTIVE_LEARNING_ENGINE_SEARCH_ENABLED!=='1'||!betaEnabled(env))T.fail('search-disabled',503);}
  function sweep(){const now=Date.now();for(const [k,v] of leases)if(v.expires<=now)leases.delete(k);}
  return Object.freeze({
    async search(ownerId,terms){
      checkGate();const query=publicQuery(terms),traceId=randomUUID();
      return budget.run(ownerId,async spend=>{
        spend('search');
        let result;try{result=await provider.search(query);}catch(e){if(e?.code==='rate-limited')budget.coolDown(e.retryAfterMs||60000);throw e;}
        checkGate();sweep();
        if(leases.size>=maxLeases)T.fail('discovery-capacity',429);
        const hits=result.hits.map(h=>Object.freeze({...h,fetchEligible:allowedHosts.includes(new URL(h.url).hostname)}));
        const leaseId=randomUUID();leases.set(leaseId,{owner:hash(ownerId),expires:Date.now()+ttl,hits,traceId});
        return {traceId,leaseId,provider:result.provider,searchedAt:result.searchedAt,returnedCount:result.returnedCount,hits:[...hits]};
      });
    },
    async fetch(ownerId,leaseId,index){
      checkGate();sweep();
      if(!C.isUid(ownerId)||typeof leaseId!=='string'||!Number.isSafeInteger(index)||index<0)T.fail('invalid-discovery',400);
      const lease=leases.get(leaseId),hit=lease?.hits[index];
      if(!lease||lease.owner!==hash(ownerId)||!hit||!hit.fetchEligible)T.fail('discovery-not-authorized',403);
      return budget.run(ownerId,async spend=>{
        const fetcher=T.createFetchProvider({allowedHosts,transport:(u,opts)=>{checkGate();spend('fetch');return transport(u,opts);}});
        const document=await fetcher.fetchDocument(hit.url);checkGate();
        return {traceId:lease.traceId,provider:hit.provider,source:sourceCandidate(document,hit),document};
      });
    },
    usage:()=>budget.snapshot()
  });
}
module.exports={publicQuery,quota,retryDelay,createBraveProvider,sourceCandidate,createService};

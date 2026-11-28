'use strict';
// Stage 3A: server-only transport. No browser routes, no model execution,
// no credentials/cookies on public documents, no IPv6 or plain HTTP fallback.
const https=require('node:https');
const dns=require('node:dns').promises;
const net=require('node:net');
const {createHash}=require('node:crypto');
const AGENT='QingyunLearningBot/1.0';
const error=(code,status=502)=>Object.assign(Error(code),{code,status});
const fail=(code,status)=>{throw error(code,status);};
function safeURL(input,{query=false}={}){
  if(typeof input!=='string'||input.length>2048||/[\\\u0000-\u0020\u007f]/.test(input))fail('unsafe-url',400);
  let u;try{u=new URL(input);}catch(_){fail('unsafe-url',400);}
  const host=u.hostname;
  if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||(!query&&u.search)||
     net.isIP(host)||host.startsWith('[')||host.endsWith('.')||host.length>253||
     !host.includes('.')||!host.split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x))||
     /(?:^|\.)(?:localhost|local|internal|intranet|test|invalid|example|onion|home|lan)$/.test(host))fail('unsafe-url',400);
  return u;
}
function publicIPv4(address){
  if(net.isIP(address)!==4)return false;
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||
    (a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||
    (a===192&&(b===168||(b===0&&(c===0||c===2))||(b===88&&c===99)))||
    (a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
}
async function abortable(promise,signal){
  if(signal.aborted)fail('timeout',504);
  let listener;
  try{return await Promise.race([promise,new Promise((_,reject)=>{
    listener=()=>reject(error('timeout',504));signal.addEventListener('abort',listener,{once:true});
    if(signal.aborted)listener();
  })]);}finally{if(listener)signal.removeEventListener('abort',listener);}
}
async function pin(host,{resolve=dns.lookup,signal}){
  let addresses;
  try{addresses=await abortable(Promise.resolve().then(()=>resolve(host,{family:4,all:true,verbatim:true})),signal);}
  catch(e){if(e?.code==='timeout')throw e;fail('dns-failure');}
  if(!Array.isArray(addresses)||addresses.length===0||addresses.length>64||addresses.some(a=>a?.family!==4||!publicIPv4(a.address)))fail('unsafe-dns',400);
  return addresses[0].address;
}
// All sockets are opened with a validated address pinned to DNS lookup.
// TLS still verifies the original hostname. No agent, proxy or automatic redirect.
async function requestBytes(u,{headers={},maxBytes,signal,resolve=dns.lookup,request=https.request}){
  u=safeURL(u.href,{query:true});
  for(const key of Object.keys(headers)){
    if(key==='Accept')continue;
    if(key==='X-Subscription-Token'&&u.origin==='https://api.search.brave.com'&&u.pathname==='/res/v1/web/search')continue;
    fail('unsafe-header',400);
  }
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>8*1024*1024)fail('invalid-byte-limit',400);
  const address=await pin(u.hostname,{resolve,signal});
  if(signal.aborted)fail('timeout',504);
  return new Promise((resolveResult,reject)=>{
    let req;
    const bad=e=>reject(signal.aborted?error('timeout',504):e?.code&&['too-large','unsupported-encoding','invalid-length','truncated-response','timeout'].includes(e.code)?e:error('network-failure'));
    try{
      req=request(u,{method:'GET',agent:false,family:4,autoSelectFamily:false,servername:u.hostname,rejectUnauthorized:true,
        lookup(host,options,callback){
          if(host!==u.hostname)return callback(error('unsafe-dns',400));
          if(options?.all)return callback(null,[{address,family:4}]);
          callback(null,address,4);
        },headers:{'User-Agent':AGENT,'Accept-Encoding':'identity',...headers},signal},res=>{
          const status=res.statusCode,head=res.headers;
          if(status!==200){res.destroy();return resolveResult({status,headers:head,bytes:Buffer.alloc(0)});}
          const encoding=String(head['content-encoding']||'identity').toLowerCase();
          if(encoding!=='identity'){res.destroy();return bad(error('unsupported-encoding'));}
          const length=head['content-length'];
          if(length!==undefined&&(!/^\d+$/.test(String(length))||!Number.isSafeInteger(Number(length)))){res.destroy();return bad(error('invalid-length'));}
          if(Number(length)>maxBytes){res.destroy();return bad(error('too-large',413));}
          let total=0;const chunks=[];
          res.on('data',chunk=>{
            total+=chunk.length;
            if(total>maxBytes){res.destroy();bad(error('too-large',413));return;}
            chunks.push(chunk);
          });
          res.on('aborted',()=>bad(error('truncated-response')));
          res.on('error',bad);
          res.on('end',()=>{
            if(!res.complete||(length!==undefined&&Number(length)!==total))return bad(error('truncated-response'));
            resolveResult({status,headers:head,bytes:Buffer.concat(chunks,total)});
          });
        });
      req.on('error',bad);req.end();
    }catch(e){bad(e);}
  });
}
// Conservative robots policy, not a permissive full parser. Any applicable
// Disallow prefix blocks; allow exceptions are intentionally NOT used.
// Wildcards, encoded/non-ASCII rules and crawl-delay require manual review.
// All groups are treated conservatively as applicable, including unknown agents.
function robotsPermit(bytes,path){
  let body;
  try{body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(_){return false;}
  if(/<html|<!doctype|\u0000/i.test(body))return false;
  for(const raw of body.split(/\r?\n/)){
    const line=raw.replace(/#.*/,'').trim();
    if(!line)continue;
    const match=/^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if(!match)return false;
    const key=match[1].toLowerCase(),rule=match[2].trim();
    if(key==='crawl-delay'||key==='request-rate')return false;
    if(key!=='disallow'||!rule)continue;
    if(!rule.startsWith('/')||/[^\x20-\x7e]|[*$%\\]/.test(rule))return false;
    if(path.startsWith(rule)||decodeURIComponentSafe(path).startsWith(rule))return false;
  }
  return true;
}
function decodeURIComponentSafe(path){try{return decodeURIComponent(path);}catch(_){return path;}}
function statusError(status){
  if(status===429)fail('rate-limited',429);
  if(status===401||status===403)fail('access-denied',403);
  if(status>=500)fail('upstream-unavailable',503);
  fail('http-status');
}
function allowedHost(u,hosts){if(!hosts.has(u.hostname))fail('host-not-approved',403);}
function createFetchProvider({allowedHosts=[],transport=requestBytes,timeoutMs=15000,maxBytes=4*1024*1024}={}){
  if(!Array.isArray(allowedHosts)||allowedHosts.length>200||allowedHosts.some(h=>typeof h!=='string'||safeURL('https://'+h+'/').hostname!==h))fail('invalid-host-policy',400);
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>8*1024*1024)fail('invalid-fetch-limits',400);
  const hosts=new Set(allowedHosts);
  return Object.freeze({async fetchDocument(input){
    let u=safeURL(input);const initial=u.href,redirects=[],visited=new Set(),signal=AbortSignal.timeout(timeoutMs);
    // Recheck permission and DNS on EVERY redirect. Credentials never forwarded.
    for(let hop=0;hop<=3;hop++){
      allowedHost(u,hosts);
      if(visited.has(u.href))fail('redirect-loop');
      visited.add(u.href);
      // Encoded paths are ambiguous for robots rules; fail closed.
      if(/%/.test(u.pathname))fail('ambiguous-path',400);
      const robots=await abortable(transport(new URL('/robots.txt',u),{signal,maxBytes:512*1024,headers:{Accept:'text/plain'}}),signal);
      if(robots.status===200){
        if(!/^text\/plain(?:;|$)/i.test(String(robots.headers['content-type']||''))||!robotsPermit(robots.bytes,u.pathname))fail('robots-denied',403);
      }else if(![404,410].includes(robots.status)){if(robots.status===429)statusError(429);fail('robots-unavailable',403);}
      const result=await abortable(transport(u,{signal,maxBytes,headers:{Accept:'application/pdf,text/html,text/plain'}}),signal);
      if([301,302,303,307,308].includes(result.status)){
        if(hop===3||typeof result.headers.location!=='string'||/[\\\u0000-\u0020\u007f]/.test(result.headers.location))fail('unsafe-redirect',400);
        let destination;try{destination=new URL(result.headers.location,u).href;}catch(_){fail('unsafe-redirect',400);}
        const next=safeURL(destination);allowedHost(next,hosts);redirects.push(next.href);u=next;continue;
      }
      if(result.status!==200)statusError(result.status);
      const mime=String(result.headers['content-type']||'').split(';')[0].trim().toLowerCase();
      if(!['application/pdf','text/html','text/plain'].includes(mime)||!result.bytes.length||result.bytes.length>maxBytes)fail('unsupported-document');
      if(mime==='application/pdf'&&!result.bytes.subarray(0,5).equals(Buffer.from('%PDF-')))fail('invalid-pdf');
      if(/\b(?:noarchive|noai|noindex|none)\b/i.test(String(result.headers['x-robots-tag']||'')))fail('source-use-restricted',403);
      return {requestedURL:initial,canonicalURL:u.href,redirects,contentType:mime,byteLength:result.bytes.length,
        retrievedAt:Date.now(),contentHash:createHash('sha256').update(result.bytes).digest('hex'),bytes:result.bytes,
        // Bytes retrieved, not parsed, licensed, approved or fact-checked.
        extractionQuality:'partial',humanProvenanceStatus:'unverified',answerEvidenceStatus:'unknown',usePolicy:'unknown'};
    }
    fail('unsafe-redirect',400);
  }});
}
module.exports={safeURL,publicIPv4,pin,requestBytes,robotsPermit,createFetchProvider,error,fail,abortable,statusError};

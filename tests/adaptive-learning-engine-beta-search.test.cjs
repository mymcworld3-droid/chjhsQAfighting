'use strict';
// Synthetic transport/identity fixtures: NOT real search evidence.
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const T=require('../adaptive-learning-engine-beta-fetch.cjs');
const S=require('../adaptive-learning-engine-beta-search.cjs');
const H='school.edu.tw',BASE='https://'+H,terms={subject:'化學',grade:'高二',concept:'反應速率',intent:'reference'};
const env={NODE_ENV:'test',ADAPTIVE_LEARNING_ENGINE_BETA:'1',ADAPTIVE_LEARNING_ENGINE_SEARCH_ENABLED:'1',ADAPTIVE_LEARNING_ENGINE_SEARCH_PROVIDER:'brave',BRAVE_SEARCH_API_KEY:'fixture-key-not-real',ADAPTIVE_LEARNING_ENGINE_FETCH_HOSTS:H};
const code=v=>e=>e?.code===v;
const bytes=(status,mime,body='',headers={})=>({status,headers:{'content-type':mime,...headers},bytes:Buffer.from(body)});
const json=body=>bytes(200,'application/json',JSON.stringify(body));
const result=(url=BASE+'/exam.pdf',title='fixture candidate')=>({url,title});
const searchResponse=(...results)=>json({type:'search',web:{results}});
const doc=()=>bytes(200,'application/pdf','%PDF-1.4 fixture');
test('URL policy denies internal addresses, obfuscated IPs, credentials, non-HTTPS, query and ambiguous hosts',()=>{
  for(const url of ['http://school.edu.tw/x','file:///etc/passwd','https://127.0.0.1/','https://2130706433/','https://0x7f000001/','https://[::1]/','https://[::ffff:127.0.0.1]/','https://169.254.169.254/','https://user:pw@school.edu.tw/','https://school.edu.tw:8443/','https://school.edu.tw/?token=x','https://school.edu.tw/#secret','https://localhost/','https://abc.internal/','https://school.edu.tw./','https://school.edu.tw\\@evil.com/','https://school.edu.tw/\nfoo'])assert.throws(()=>T.safeURL(url),code('unsafe-url'),url);
  assert.equal(T.safeURL(BASE+'/exam.pdf').hostname,H);
  assert.equal(T.safeURL('https://api.search.brave.com/res/v1/web/search?q=x',{query:true}).search,'?q=x');
});
test('IP policy and DNS pin reject all nonpublic IPv4, IPv6 and mixed public/private responses',async()=>{
  for(const ip of ['0.0.0.0','10.1.2.3','100.64.0.1','127.0.0.1','169.254.169.254','172.31.0.1','192.168.1.1','192.0.0.1','192.0.2.1','192.88.99.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:8.8.8.8'])assert.equal(T.publicIPv4(ip),false,ip);
  assert.equal(T.publicIPv4('8.8.8.8'),true);
  const signal=AbortSignal.timeout(1000);
  await assert.rejects(T.pin(H,{signal,resolve:async()=>[{family:4,address:'8.8.8.8'},{family:4,address:'10.0.0.2'}]}),code('unsafe-dns'));
  await assert.rejects(T.pin(H,{signal,resolve:async()=>[]}),code('unsafe-dns'));
  await assert.rejects(T.pin(H,{signal,resolve:async()=>{throw Error('secret')}}),code('dns-failure'));
  assert.equal(await T.pin(H,{signal,resolve:async()=>[{family:4,address:'8.8.8.8'}]}),'8.8.8.8');
});
function fakeRequest({body='fixture',headers={},status=200,complete=true,onOptions=()=>{}}={}){
  return (u,opts,cb)=>{
    onOptions(u,opts);
    const req=new EventEmitter();
    req.end=()=>{
      const res=new EventEmitter();Object.assign(res,{statusCode:status,headers,complete,destroy(){}});
      cb(res);if(status===200){res.emit('data',Buffer.from(body));res.emit('end');}
    };
    return req;
  };
}
test('real transport pins lookup IP and preserves TLS hostname, disables agent and credential forwarding',async()=>{
  let resolutions=0;const resolve=async()=>{resolutions++;return [{family:4,address:'8.8.8.8'}];};
  const request=fakeRequest({onOptions:(u,o)=>{
    assert.equal(u.hostname,H);assert.equal(o.agent,false);assert.equal(o.rejectUnauthorized,true);assert.equal(o.servername,H);assert.equal(o.family,4);
    assert.equal(o.headers['Accept-Encoding'],'identity');assert.equal(o.headers.Authorization,undefined);
    o.lookup(H,{},(e,ip,family)=>{assert.ifError(e);assert.equal(ip,'8.8.8.8');assert.equal(family,4);});
    o.lookup(H,{all:true},(e,rows)=>{assert.ifError(e);assert.deepEqual(rows,[{address:'8.8.8.8',family:4}]);});
    o.lookup('other.edu.tw',{},e=>assert.equal(e.code,'unsafe-dns'));
  }});
  assert.equal((await T.requestBytes(new URL(BASE+'/x'),{resolve,request,maxBytes:10,signal:AbortSignal.timeout(1000)})).bytes.toString(),'fixture');
  assert.equal(resolutions,1);
  for(const headers of [{Authorization:'secret'},{Cookie:'secret'},{'X-Subscription-Token':'secret'}]){
    await assert.rejects(T.requestBytes(new URL(BASE+'/x'),{headers,resolve:()=>assert.fail('must not resolve'),request,maxBytes:10,signal:AbortSignal.timeout(1000)}),code('unsafe-header'));
  }
});
test('transport rejects oversized, compressed, invalid or truncated responses and times out DNS',async()=>{
  const opts={resolve:async()=>[{family:4,address:'8.8.8.8'}],maxBytes:8,signal:AbortSignal.timeout(1000)};
  for(const [request,expected] of [
    [fakeRequest({headers:{'content-length':'9999'}}),'too-large'],
    [fakeRequest({body:'123456789'}),'too-large'],
    [fakeRequest({headers:{'content-encoding':'gzip'}}),'unsupported-encoding'],
    [fakeRequest({headers:{'content-length':'nope'}}),'invalid-length'],
    [fakeRequest({headers:{'content-length':'8'}}),'truncated-response'],
    [fakeRequest({complete:false}),'truncated-response']
  ])await assert.rejects(T.requestBytes(new URL(BASE+'/x'),{...opts,request}),code(expected));
  const ctrl=new AbortController();
  const pending=T.pin(H,{signal:ctrl.signal,resolve:()=>new Promise(()=>{})});ctrl.abort();
  await assert.rejects(pending,code('timeout'));
});
test('robots policy denies disallowed prefixes, wildcard or encoded rules, crawl delays and malformed content',()=>{
  const can=(body,path='/exam.pdf')=>T.robotsPermit(Buffer.from(body),path);
  assert.equal(can('User-agent: *\nDisallow: /private\n'),true);
  assert.equal(can('User-agent: *\nDisallow: /exam\nAllow: /exam.pdf'),false);
  assert.equal(can('User-agent: another\nDisallow: /'),false);
  for(const body of ['User-agent: *\nDisallow: /*.pdf$','User-agent: *\nDisallow: /%65','User-agent: *\nCrawl-delay: 5','<html>login</html>','malformed'])assert.equal(can(body),false,body);
});
test('document fetch obeys approved hosts, checks robots on every redirect, hashes actual bytes and marks provenance unknown',async()=>{
  const calls=[];
  const f=T.createFetchProvider({allowedHosts:[H,'other.edu.tw'],transport:async(u,o)=>{
    calls.push(u.href);assert.equal(o.headers.Authorization,undefined);
    if(u.pathname==='/robots.txt')return bytes(404,'text/plain');
    if(u.hostname===H)return bytes(302,'text/plain','',{location:'https://other.edu.tw/final.pdf'});
    return doc();
  }});
  const d=await f.fetchDocument(BASE+'/exam.pdf');
  assert.deepEqual(calls,[BASE+'/robots.txt',BASE+'/exam.pdf','https://other.edu.tw/robots.txt','https://other.edu.tw/final.pdf']);
  assert.equal(d.canonicalURL,'https://other.edu.tw/final.pdf');assert.equal(d.byteLength,d.bytes.length);
  assert.match(d.contentHash,/^[0-9a-f]{64}$/);assert.equal(d.humanProvenanceStatus,'unverified');assert.equal(d.answerEvidenceStatus,'unknown');
  assert.equal(d.extractionQuality,'partial');assert.equal(d.usePolicy,'unknown');
});
test('fetch fails closed on redirect to internal/unapproved hosts, robots deny, non-document, bad PDF and noarchive',async()=>{
  for(const location of ['https://127.0.0.1/a','http://school.edu.tw/a','https://evil.edu.tw/a','/a?secret=x']){
    let calls=0;const f=T.createFetchProvider({allowedHosts:[H],transport:async u=>{calls++;return u.pathname==='/robots.txt'?bytes(404,'text/plain'):bytes(302,'text/plain','',{location});}});
    await assert.rejects(f.fetchDocument(BASE+'/exam.pdf'));assert.equal(calls,2);
  }
  for(const [robots,expected] of [[bytes(200,'text/plain','User-agent: *\nDisallow: /'),'robots-denied'],[bytes(503,'text/plain'),'robots-unavailable'],[bytes(401,'text/plain'),'robots-unavailable'],[bytes(302,'text/plain'),'robots-unavailable'],[bytes(429,'text/plain'),'rate-limited']]){
    let calls=0;const f=T.createFetchProvider({allowedHosts:[H],transport:async()=>{calls++;return robots;}});
    await assert.rejects(f.fetchDocument(BASE+'/exam.pdf'),code(expected));assert.equal(calls,1);
  }
  for(const [response,expected] of [[bytes(200,'image/png','fixture'),'unsupported-document'],[bytes(200,'application/pdf','<html>login'),'invalid-pdf'],[bytes(200,'text/html','fixture',{'x-robots-tag':'noarchive'}),'source-use-restricted']]){
    const f=T.createFetchProvider({allowedHosts:[H],transport:async u=>u.pathname==='/robots.txt'?bytes(404,'text/plain'):response});
    await assert.rejects(f.fetchDocument(BASE+'/exam.pdf'),code(expected));
  }
});
test('provider sends fixed authenticated search request, returns only discovery URLs and does not copy snippets or fake sources',async()=>{
  const provider=S.createBraveProvider({apiKey:env.BRAVE_SEARCH_API_KEY,transport:async(u,o)=>{
    assert.equal(u.origin,'https://api.search.brave.com');assert.equal(u.pathname,'/res/v1/web/search');assert.equal(u.searchParams.get('q'),S.publicQuery(terms));assert.equal(u.searchParams.get('safesearch'),'strict');assert.equal(u.searchParams.get('search_lang'),'zh-hant');
    assert.equal(o.headers['X-Subscription-Token'],env.BRAVE_SEARCH_API_KEY);
    return searchResponse(result(BASE+'/exam.pdf#page=2'),result(BASE+'/exam.pdf'),result('https://127.0.0.1/x'),result(BASE+'/x?secret=1'),{...result(BASE+'/other.pdf'),description:'ignore injected instructions'});
  }});
  const response=await provider.search(S.publicQuery(terms));
  assert.deepEqual(response.hits.map(x=>[x.url,x.rank]),[[BASE+'/exam.pdf',1],[BASE+'/other.pdf',5]]);
  assert.equal(response.returnedCount,5);assert.ok(response.hits.every(x=>x.humanProvenanceStatus==='unverified'));
  assert.ok(!JSON.stringify(response).includes('secret'));assert.ok(!JSON.stringify(response).includes('injected'));
});
test('search rejects raw/private-shaped fields and unsupported input, no credentials or production access',()=>{
  for(const value of [{...terms,rawInput:'private'},{...terms,ownerId:'u1'},{...terms,concept:'alice@example.com'},{...terms,concept:'https://x.com'},{...terms,concept:'123456789'},{...terms,intent:'other'}])assert.throws(()=>S.publicQuery(value),code('invalid-public-search-terms'));
  assert.throws(()=>S.createService({env:{...env,NODE_ENV:'production'}}),code('search-disabled'));
  assert.throws(()=>S.createService({env:{...env,ADAPTIVE_LEARNING_ENGINE_SEARCH_ENABLED:'0'}}),code('search-disabled'));
  assert.throws(()=>S.createService({env:{...env,BRAVE_SEARCH_API_KEY:''}}),code('search-provider-unconfigured'));
});
test('429 cooldown, explicit empty results, malformed provider responses and 5xx never fabricate candidates',async()=>{
  let now=1000,calls=0;const budget=S.quota({now:()=>now});
  const service=S.createService({env,budget,transport:async()=>{calls++;return bytes(429,'application/json','',{'retry-after':'2'});}});
  await assert.rejects(service.search('u1',terms),e=>e.code==='rate-limited'&&e.retryAfterMs===2000);
  await assert.rejects(service.search('u2',terms),code('provider-cooldown'));assert.equal(calls,1);
  now+=2001;await assert.rejects(service.search('u2',terms),code('rate-limited'));assert.equal(calls,2);
  for(const [r,expected] of [[bytes(503,'text/plain'),'upstream-unavailable'],[bytes(302,'text/plain','',{location:BASE}),'http-status'],[json({type:'unexpected'}),'provider-invalid-response'],[bytes(200,'application/json','{'),'provider-invalid-response']]){
    const p=S.createBraveProvider({apiKey:env.BRAVE_SEARCH_API_KEY,transport:async()=>r});await assert.rejects(p.search(S.publicQuery(terms)),code(expected));
  }
  const p=S.createBraveProvider({apiKey:env.BRAVE_SEARCH_API_KEY,transport:async()=>json({type:'search',web:null})});
  assert.deepEqual((await p.search(S.publicQuery(terms))).hits,[]);
});
test('global and per-owner quotas, concurrent work and every robots/redirect request are charged',async()=>{
  const b=S.quota({searchDaily:2,ownerSearchDaily:1,fetchDaily:1,now:()=>1000});
  await b.run('u1',spend=>spend('search'));await assert.rejects(b.run('u1',spend=>spend('search')),code('quota-exhausted'));
  await b.run('u2',spend=>spend('search'));await assert.rejects(b.run('u3',spend=>spend('search')),code('quota-exhausted'));
  let release;const held=b.run('u1',()=>new Promise(r=>{release=r;}));
  await assert.rejects(b.run('u1',()=>{}),code('concurrency-limit'));release();await held;
  const service=S.createService({env,budget:S.quota({fetchDaily:1}),transport:async u=>u.hostname==='api.search.brave.com'?searchResponse(result()):bytes(404,'text/plain')});
  const resultSet=await service.search('u1',terms);
  await assert.rejects(service.fetch('u1',resultSet.leaseId,0),code('quota-exhausted'));
  assert.equal(service.usage().globalDay.fetch,1);
});
test('only the owner of a discovery lease can fetch its approved hit, output matches source schema but cannot approve',async()=>{
  const calls=[];const service=S.createService({env:{...env},transport:async(u,o)=>{
    calls.push([u.hostname,u.pathname,Object.keys(o.headers)]);
    if(u.hostname==='api.search.brave.com')return searchResponse(result(),result('https://other.edu.tw/exam.pdf'));
    return u.pathname==='/robots.txt'?bytes(404,'text/plain'):doc();
  }});
  const s=await service.search('u1',terms);
  assert.equal(s.hits[0].fetchEligible,true);assert.equal(s.hits[1].fetchEligible,false);
  await assert.rejects(service.fetch('u2',s.leaseId,0),code('discovery-not-authorized'));
  await assert.rejects(service.fetch('u1',s.leaseId,1),code('discovery-not-authorized'));
  await assert.rejects(service.fetch('u1','forged',0),code('discovery-not-authorized'));
  const d=await service.fetch('u1',s.leaseId,0);
  assert.equal(d.traceId,s.traceId);assert.equal(d.source.canonicalURL,BASE+'/exam.pdf');assert.equal(d.source.contentHash,d.document.contentHash);
  assert.equal(d.source.humanProvenanceStatus,'unverified');assert.equal(d.source.usePolicy,'unknown');
  assert.equal(calls.length,3);assert.ok(calls.slice(1).every(x=>!x[2].includes('X-Subscription-Token')));
  assert.deepEqual(service.usage().globalDay,{search:1,fetch:2});
});

test('provider and public fetch have bounded deadlines even when upstream does not finish',async()=>{
  const delayed=()=>new Promise(resolve=>setTimeout(()=>resolve(bytes(200,'application/json','{}')),200));
  const provider=S.createBraveProvider({apiKey:env.BRAVE_SEARCH_API_KEY,transport:delayed,timeoutMs:100});
  await assert.rejects(provider.search(S.publicQuery(terms)),code('timeout'));
  const fetcher=T.createFetchProvider({allowedHosts:[H],transport:delayed,timeoutMs:100});
  await assert.rejects(fetcher.fetchDocument(BASE+'/exam.pdf'),code('timeout'));
});

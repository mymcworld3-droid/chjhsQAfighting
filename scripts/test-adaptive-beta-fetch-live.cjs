'use strict';
// Independent transport smoke probe: a successful fixed URL download is NOT
// search-provider verification. No credentials, no database, no raw body saved.
const {randomUUID,createHash}=require('node:crypto');
const {createFetchProvider}=require('../adaptive-learning-engine-beta-fetch.cjs');
const {sourceCandidate}=require('../adaptive-learning-engine-beta-search.cjs');
const sources=Object.freeze([
  {kind:'technical-control',title:'RFC 9309 — Robots Exclusion Protocol',url:'https://www.rfc-editor.org/rfc/rfc9309.txt',host:'www.rfc-editor.org',rights:'https://trustee.ietf.org/license-info',mime:'text/plain'},
  {kind:'public-curriculum',title:'十二年國民基本教育課程綱要 自然科學領域',url:'https://stv.naer.edu.tw/data/course_outline/pta_18538_240851_60502.pdf',host:'stv.naer.edu.tw',rights:'https://stv.naer.edu.tw/about/copyright.jsp',mime:'application/pdf'}
]);
if(process.argv.slice(2).join(' ')!=='--live'){console.error('Explicit --live required.');process.exit(2);}
(async()=>{
  const report={kind:'real-public-document-probe',traceId:randomUUID(),testedAt:new Date().toISOString(),searchVerified:false,stage3Approval:false,results:[]};
  for(const s of sources){
    const result={kind:s.kind,requestedURL:s.url,rightsPolicyURL:s.rights,verified:false};
    try{
      const provider=createFetchProvider({allowedHosts:[s.host]});
      const doc=await provider.fetchDocument(s.url);
      if(doc.contentType!==s.mime||doc.byteLength!==doc.bytes.length||
        doc.contentHash!==createHash('sha256').update(doc.bytes).digest('hex'))throw Object.assign(Error('unexpected-document'),{code:'unexpected-document'});
      const candidate=sourceCandidate(doc,{title:s.title});
      Object.assign(result,{verified:true,canonicalURL:candidate.canonicalURL,retrievedAt:candidate.retrievedAt,
        contentHash:candidate.contentHash,contentType:doc.contentType,byteLength:doc.byteLength,
        humanProvenanceStatus:candidate.humanProvenanceStatus,usePolicy:candidate.usePolicy,extractionQuality:candidate.extractionQuality});
    }catch(e){result.blocker=typeof e?.code==='string'&&/^[a-z][a-z0-9-]{1,60}$/.test(e.code)?e.code:'live-fetch-failed';}
    report.results.push(result);
  }
  report.transportVerified=report.results.some(r=>r.verified);
  report.curriculumFetchVerified=report.results.some(r=>r.kind==='public-curriculum'&&r.verified);
  console.log(JSON.stringify(report,null,2));
  if(!report.transportVerified||!report.curriculumFetchVerified)process.exitCode=2;
})().catch(()=>{console.error('Independent live fetch probe did not complete.');process.exitCode=2;});

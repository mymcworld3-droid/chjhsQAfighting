'use strict';
// Explicit opt-in. A real Brave request spends provider quota. No DB writes,
// no player data, no public HTTP endpoint. Output never prints key/raw content.
if(process.argv.slice(2).join(' ')!=='--live'||process.env.ADAPTIVE_LEARNING_ENGINE_LIVE_SEARCH!=='1'){
  console.error('Opt in with ADAPTIVE_LEARNING_ENGINE_LIVE_SEARCH=1 and --live.');process.exit(2);
}
try{require('dotenv').config({quiet:true});}catch{}
const S=require('../adaptive-learning-engine-beta-search.cjs');
const safeCode=e=>typeof e?.code==='string'&&/^[a-z][a-z0-9-]{1,60}$/.test(e.code)?e.code:'live-probe-failed';
(async()=>{
  const report={kind:'real-network-probe',provider:'brave-web-v1',searchVerified:false,fetchVerified:false,humanProvenanceVerified:false,stage3Approval:false};
  try{
    // Force development-only gate in this standalone diagnostic; do not
    // change server env, feature flag, account or production configuration.
    const env={...process.env,NODE_ENV:'test',ADAPTIVE_LEARNING_ENGINE_BETA:'1'};
    const service=S.createService({env});
    const s=await service.search('live-diagnostic',{subject:'化學',grade:'高二',concept:'反應速率',intent:'reference'});
    report.searchVerified=true;report.traceId=s.traceId;report.searchedAt=s.searchedAt;
    report.returnedCount=s.returnedCount;report.safeCandidateCount=s.hits.length;
    report.eligibleCount=s.hits.filter(h=>h.fetchEligible).length;
    // At most two attempts; never evade robots or access restrictions.
    let attempts=0;report.fetchErrors=[];
    for(let i=0;i<s.hits.length&&attempts<2;i++){
      if(!s.hits[i].fetchEligible)continue;
      attempts++;
      try{
        const fetched=await service.fetch('live-diagnostic',s.leaseId,i);
        report.fetchVerified=true;report.source={canonicalURL:fetched.source.canonicalURL,contentHash:fetched.source.contentHash,
          retrievedAt:fetched.source.retrievedAt,contentType:fetched.document.contentType,byteLength:fetched.document.byteLength,
          extractionQuality:fetched.source.extractionQuality,humanProvenanceStatus:fetched.source.humanProvenanceStatus};
        break;
      }catch(e){report.fetchErrors.push(safeCode(e));}
    }
    report.usage=service.usage();
    if(!report.fetchVerified)report.blocker=report.eligibleCount?'no-permitted-document-fetched':'no-approved-host-candidate';
  }catch(e){report.blocker=safeCode(e);}
  console.log(JSON.stringify(report,null,2));if(!report.searchVerified||!report.fetchVerified)process.exitCode=2;
})().catch(()=>{console.error('Live probe unavailable');process.exitCode=2;});

"use strict";
function buildQueue(batches) {
  const sources=new Map(), records=new Map(), drafts=new Set(), answerChecks=new Set();
  for(const [batch,doc] of batches){
    for(const source of doc.sources||[]) {
      if(sources.has(source.id)) throw Error("Duplicate source: "+source.id);
      sources.set(source.id,source);
    }
    for(const record of doc.records||[]){
      if(records.has(record.id)) throw Error("Duplicate record: "+record.id);
      records.set(record.id,{...record,batch});
      if(record.originalQuestion) drafts.add(record.id);
    }
    for(const upgrade of doc.upgrades||[]){
      if(!records.has(upgrade.id)||drafts.has(upgrade.id)||!upgrade.originalQuestion) throw Error("Invalid upgrade: "+upgrade.id);
      drafts.add(upgrade.id);
    }
    for(const a of doc.answerRechecks||[]) if(a.match===true) answerChecks.add(a.id);
  }
  const queue=[];
  for(const r of records.values()){
    if(!sources.has(r.sourceId)) throw Error("Missing source: "+r.sourceId);
    if(drafts.has(r.id)) continue;
    queue.push({id:r.id,sourceId:r.sourceId,batch:r.batch,questionNumber:r.questionNumber,locator:r.originalQuestionNumberOrLocator,type:r.originalQuestionType,optionCount:r.optionCount??null,answerMarks:r.officialAnswerMarks,answerRechecked:answerChecks.has(r.id),pageHint:r.questionPdfPage??null,flags:r.flags||[],status:"pending-human-review"});
  }
  queue.sort((a,b)=>Number(b.answerRechecked)-Number(a.answerRechecked)||a.sourceId.localeCompare(b.sourceId)||a.questionNumber-b.questionNumber||a.id.localeCompare(b.id));
  const sourceList=[...sources.values()].filter(s=>queue.some(r=>r.sourceId===s.id)).map(s=>s.id==="PTTSH-113-1-final-physics"?{...s,originalSourceUrl:"https://www.pttsh.ttct.edu.tw/paper/113-1/期末考/高二/113-1-2物理3.pdf",officialAnswerUrl:"https://www.pttsh.ttct.edu.tw/paper/113-1/期末考/高二/113-1-2物理3.pdf"}:s);
  return {schema:1,status:"isolated-review-worklist",counts:{structured:records.size,drafts:drafts.size,pending:queue.length,pendingAnswerRechecked:queue.filter(x=>x.answerRechecked).length},sources:sourceList,queue};
}

function extractBlocks(pages) {
  const out=[];
  const marker=/^\s*(?:[（(]\s*[）)]\s*)?(\d{1,3})[.．、]\s*(?=\S)/u;
  for(let p=0;p<pages.length;p++){
    const lines=pages[p].split(/\r?\n/);
    const starts=[];
    for(let i=0;i<lines.length;i++){const m=lines[i].match(marker);if(m)starts.push({i,number:Number(m[1])});}
    for(let i=0;i<starts.length;i++){
      const start=starts[i];
      const raw=lines.slice(start.i,starts[i+1]?.i??lines.length).join("\n").trimEnd();
      const labels=[...new Set(Array.from(raw.matchAll(/[（(]\s*([A-EＡ-Ｅ1-5１-５])\s*[）)]/gu),m=>m[1].normalize("NFKC")))];
      out.push({page:p+1,line:start.i+1,number:start.number,raw,labels,possiblyContinuesOnNextPage:i===starts.length-1&&p<pages.length-1});
    }
  }
  return out;
}

function selfTest(){
  const a={sources:[{id:"s",originalSourceUrl:"https://example.invalid"}],records:[{id:"one",sourceId:"s",questionNumber:1},{id:"two",sourceId:"s",questionNumber:2,originalQuestion:{q:"fixture"}},{id:"three",sourceId:"s",questionNumber:3}]};
  const b={upgrades:[{id:"three",originalQuestion:{q:"fixture"}}],answerRechecks:[{id:"one",match:true}]};
  const q=buildQueue([[3,a],[4,b]]);
  if(q.counts.structured!==3||q.counts.drafts!==2||q.counts.pending!==1||q.queue[0].id!=="one"||!q.queue[0].answerRechecked)throw Error("queue fixture failed");
  const blocks=extractBlocks(["( ) 1. fixture (A) a (Ｂ) b\n2. （ ） fixture\n(A) a","1. fixture (1) a (2) b"]);
  if(blocks.length!==3||blocks[0].labels.join()!=="A,B"||!blocks[1].possiblyContinuesOnNextPage||blocks[2].page!==2)throw Error("block fixture failed");
  let rejected=false;try{buildQueue([[3,a],[4,{records:[a.records[0]]}]])}catch{rejected=true}if(!rejected)throw Error("duplicates accepted");
  return "3 self-checks passed (queue, extraction, duplicate rejection)";
}

const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const crypto=require("node:crypto");
const {execFileSync}=require("node:child_process");
const root=path.resolve(__dirname,"..");
function sha(bytes){return crypto.createHash("sha256").update(bytes).digest("hex");}
function writeJson(file,obj){fs.writeFileSync(file,JSON.stringify(obj,null,2)+"\n");}
function safeId(id){if(!/^[A-Za-z0-9_-]+$/.test(id))throw Error("Invalid source ID");return id;}
function pdfBytes(bytes){return bytes.length>5&&bytes.subarray(0,5).toString()==="%PDF-";}
function parseArgs(argv){
 const args={out:path.join(os.tmpdir(),"qingyun-human-reference-review"),pdfDir:null,download:false,render:false,selfTest:false,manifestOnly:false};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];if(a==="--download")args.download=true;else if(a==="--render")args.render=true;else if(a==="--self-test")args.selfTest=true;else if(a==="--manifest-only")args.manifestOnly=true;else if(a==="--out"||a==="--pdf-dir"){const v=argv[++i];if(!v||v.startsWith("--"))throw Error("Missing value "+a);args[a==="--out"?"out":"pdfDir"]=path.resolve(v);}else throw Error("Unknown argument "+a);
 }
 args.pdfDir=args.pdfDir||path.join(args.out,"pdf");
 const realCandidate=path.join(root,"question-references");
 if(args.out===root||args.out.startsWith(root+path.sep)||args.pdfDir===realCandidate||args.pdfDir.startsWith(realCandidate+path.sep))throw Error("Output must be outside repository; never write to the official question bank");
 return args;
}
async function obtainPdf(sourceUrl,filename,allowDownload){
 if(fs.existsSync(filename)){const b=fs.readFileSync(filename);if(!pdfBytes(b))throw Error("Local file is not a PDF");return b;}
 if(!allowDownload)throw Error("Missing local PDF: "+filename);
 const u=new URL(sourceUrl);if(u.protocol!=="https:"||!(/(^|\.)edu\.tw$/i.test(u.hostname)))throw Error("Unapproved download host "+u.hostname);
 const response=await fetch(u,{redirect:"error",signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Error("HTTP "+response.status);
 const len=Number(response.headers.get("content-length")||0);if(len>40*1024*1024)throw Error("PDF too large");
 const reader=response.body.getReader();const chunks=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>40*1024*1024)throw Error("PDF too large");chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 const bytes=Buffer.concat(chunks);if(!pdfBytes(bytes))throw Error("Response is not a PDF");
 fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,bytes,{flag:"wx"});return bytes;
}
function processPdf(file,dir,render){
 const bytes=fs.readFileSync(file);if(!pdfBytes(bytes))throw Error("Not a PDF");
 fs.mkdirSync(dir,{recursive:true});
 const textFile=path.join(dir,"layout.txt");
 execFileSync("pdftotext",["-layout","-enc","UTF-8",file,textFile],{timeout:60000,stdio:"pipe"});
 const pages=fs.readFileSync(textFile,"utf8").split("\f");if(pages.at(-1)==="")pages.pop();
 const blocks=extractBlocks(pages);writeJson(path.join(dir,"raw-blocks.json"),blocks);
 if(render)execFileSync("pdftoppm",["-r","120","-png",file,path.join(dir,"page")],{timeout:120000,stdio:"pipe"});
 return {sha256:sha(bytes),pages:pages.length,textPages:pages.filter(p=>p.trim()).length,blocks:blocks.length,rawBlocks:blocks,rendered:render};
}
async function main(){
 const args=parseArgs(process.argv.slice(2));
 if(args.selfTest){console.log(selfTest());return;}
 const dir=path.join(root,"docs","reference-candidates");
 const batches=fs.readdirSync(dir).filter(f=>/^high-school-2-batch-\d+\.json$/.test(f)).sort().map(f=>[Number(f.match(/(\d+)\.json$/)[1]),JSON.parse(fs.readFileSync(path.join(dir,f),"utf8"))]);
 const work=buildQueue(batches);
 fs.mkdirSync(args.out,{recursive:true});writeJson(path.join(args.out,"worklist.json"),work);
 if(args.manifestOnly){console.log(JSON.stringify(work.counts));return;}
 const results=[];const rawCandidates=[];
 for(const source of work.sources){
  const id=safeId(source.id);const base=path.join(args.out,"evidence",id);const file=path.join(args.pdfDir,id+".pdf");
  const report={sourceId:id,status:"pending",questionSource:source.originalSourceUrl,answerSource:source.officialAnswerUrl};
  try{
   await obtainPdf(source.originalSourceUrl,file,args.download);
   const question=processPdf(file,path.join(base,"question"),args.render);
   report.question={...question,rawBlocks:undefined};
   const same=source.originalSourceUrl===source.officialAnswerUrl;
   if(same)report.answer=report.question;else if(source.officialAnswerUrl){
    try{const answerFile=path.join(args.pdfDir,id+".answers.pdf");await obtainPdf(source.officialAnswerUrl,answerFile,args.download);const answer=processPdf(answerFile,path.join(base,"answer"),args.render);report.answer={...answer,rawBlocks:undefined};}catch(e){report.answerError=String(e.message);}
   }
   for(const r of work.queue.filter(x=>x.sourceId===id)){
    const candidates=question.rawBlocks.filter(b=>b.number===r.questionNumber);
    rawCandidates.push({id:r.id,sourceId:id,questionSha256:question.sha256,pageHint:r.pageHint,answerMarks:r.answerMarks,blocks:candidates,status:"raw-extraction-needs-human-comparison",originalQuestion:null,originalTextAndOptionsMatched:false,answerVerified:false,sourceRightsVerified:false,reviewer:null,referenceHash:null});
   }
   report.status="extracted-unverified";
  }catch(e){report.status="blocked";report.error=String(e.message);}
  results.push(report);
 }
 writeJson(path.join(args.out,"raw-candidates.json"),rawCandidates);
 writeJson(path.join(args.out,"extraction-report.json"),{status:"not-approved",counts:{...work.counts,sourceCount:results.length,sourcesExtracted:results.filter(r=>r.status==="extracted-unverified").length,rawCandidateRecords:rawCandidates.length,withRawBlocks:rawCandidates.filter(r=>r.blocks.length>0).length,fullTranscriptions:0,approved:0},results});
 console.log(JSON.stringify({work:work.counts,extractedSources:results.filter(r=>r.status==="extracted-unverified").length,blocked:results.filter(r=>r.status==="blocked").length}));
 if(!results.some(r=>r.status==="extracted-unverified"))process.exitCode=2;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

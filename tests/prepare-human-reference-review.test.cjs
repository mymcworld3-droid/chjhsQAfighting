"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const t=require("../scripts/prepare-human-reference-review.cjs");
test("existing queue, extraction and duplicate checks",()=>assert.match(t.selfTest(),/3 self-checks passed/));
test("sources with previously rechecked answers are processed first",()=>{
 const sources=[{id:"a"},{id:"b"},{id:"c"}];
 const queue=[{sourceId:"a",answerMarks:["A"]},{sourceId:"b",answerMarks:["A"],answerRechecked:true},{sourceId:"c",answerMarks:[]}];
 assert.deepEqual(t.prioritizeSources(sources,queue).map(s=>s.id),["b","a","c"]);
});
test("prefer a known page without discarding ambiguous matches",()=>{
 const blocks=[{page:1,number:2},{page:2,number:2},{page:3,number:4}];
 assert.deepEqual(t.candidateBlocks(blocks,{questionNumber:2,pageHint:2}),{blocks:[blocks[1]],alternatives:[blocks[0]],pageHintMatched:true});
 assert.deepEqual(t.candidateBlocks(blocks,{questionNumber:2,pageHint:3}),{blocks:blocks.slice(0,2),alternatives:[],pageHintMatched:false});
});
test("official-host redirect URL validation",()=>{
 const hosts=new Set(["school.edu.tw"]);
 assert.equal(t.validatedDownloadUrl("https://school.edu.tw/test.pdf",hosts).hostname,"school.edu.tw");
 for(const u of ["http://school.edu.tw/test.pdf","https://school.edu.tw.example.org/x","https://user@school.edu.tw/x","https://school.edu.tw:8443/x"])assert.throws(()=>t.validatedDownloadUrl(u,hosts));
});
test("both verified direct school PDF overrides",()=>{
 for(const id of ["PTTSH-113-1-final-physics","PTTSH-112-2-2-physics"]){
  const s=t.sourceOverrides({id});assert.match(s.originalSourceUrl,/\.pdf$/);assert.equal(s.originalSourceUrl,s.officialAnswerUrl);assert.doesNotMatch(s.originalSourceUrl,/index\.php/);
 }
});
test("output path must not be in repository, including directory aliases",()=>{
 const root=path.resolve(__dirname,"..");assert.throws(()=>t.parseArgs(["--out",root]),/outside repository/);
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"ref-review-test-"));try{
  const alias=path.join(tmp,"alias");fs.symlinkSync(root,alias,"dir");assert.throws(()=>t.parseArgs(["--out",alias]),/outside repository/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test("local cache validates PDF magic and never downloads unless requested",async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"ref-review-test-"));try{
  const p=path.join(tmp,"a.pdf");fs.writeFileSync(p,"<html>fixture</html>");
  await assert.rejects(t.obtainPdf(null,p,false,new Set()),/not a PDF/);
  await assert.rejects(t.obtainPdf(null,path.join(tmp,"missing.pdf"),false,new Set()),/Missing local PDF/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
function fixturePdf(){
 const stream="BT /F1 12 Tf 60 720 Td (1. FIXTURE \\(A\\) ONE \\(B\\) TWO) Tj ET\n";
 const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Length "+Buffer.byteLength(stream)+" >>\nstream\n"+stream+"endstream"];
 let body="%PDF-1.4\n";const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(body));body+=(i+1)+" 0 obj\n"+objects[i]+"\nendobj\n";}
 const start=Buffer.byteLength(body);body+="xref\n0 "+offsets.length+"\n0000000000 65535 f \n"+offsets.slice(1).map(x=>String(x).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size "+offsets.length+" /Root 1 0 R >>\nstartxref\n"+start+"\n%%EOF\n";return Buffer.from(body);
}
test("real Poppler extraction and rendering on synthetic evidence fixture, not an exam question",{skip:process.env.RUN_POPPLER_TEST!=="1"},async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"ref-review-test-"));try{
  const f=path.join(tmp,"fixture.pdf");fs.writeFileSync(f,fixturePdf());
  assert.equal((await t.obtainPdf(null,f,false,new Set())).origin,"local-cache");
  const result=t.processPdf(f,path.join(tmp,"out"),true);
  assert.equal(result.pages,1);assert.equal(result.textPages,1);assert.equal(result.blocks,1);assert.deepEqual(result.rawBlocks[0].labels,["A","B"]);assert.equal(result.rendered,true);
  assert.ok(fs.existsSync(path.join(tmp,"out","page-1.png")));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test("question markers preserve school answer-sheet circles and full-width numbering",()=>{
 const blocks=t.extractBlocks(["( ○1 )1. fixture (A) a (B) b\n（②）２．fixture (1) a (2) b\n3. (③) fixture"]);
 assert.deepEqual(blocks.map(b=>b.number),[1,2,3]);
 assert.deepEqual(blocks[0].labels,["A","B"]);
 assert.deepEqual(t.extractBlocks(["(1) option, not a question\n2. test\n（ ）3. fixture"]).map(b=>b.number),[2,3]);
});

test("source acquisition by batch never adds question locators or reprocesses the old queue",()=>{
 const w=t.buildQueue([[23,{sources:[{id:"old"}],records:[{id:"old1",sourceId:"old",questionNumber:1}]}],[24,{sources:[{id:"new",acquisitionOnly:true}],records:[]}],[25,{sources:[{id:"later",acquisitionOnly:true}],records:[]}]]);
 assert.equal(w.counts.structured,1);assert.equal(w.counts.pending,1);assert.equal(w.counts.drafts,0);
 assert.deepEqual(t.selectSources(w,{sourceIds:[],acquisitionBatch:null}).map(s=>s.id),["old"]);
 assert.deepEqual(t.selectSources(w,{sourceIds:[],acquisitionBatch:24}).map(s=>s.id),["new"]);
 assert.throws(()=>t.selectSources(w,{sourceIds:["old"],acquisitionBatch:24}),/Unknown/);
 assert.throws(()=>t.selectSources(w,{sourceIds:[],acquisitionBatch:99}),/No acquisition sources/);
});
test("acquisition batch argument validation",()=>{
 assert.equal(t.parseArgs(["--acquisition-batch","24"]).acquisitionBatch,24);
 for(const argv of [["--acquisition-batch"],["--acquisition-batch","0"],["--acquisition-batch","1.5"],["--acquisition-batch","foo"]])assert.throws(()=>t.parseArgs(argv),/Invalid acquisition batch/);
});

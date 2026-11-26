#!/usr/bin/env node
'use strict';
// Build-time only: runtime reads one grade/subject shard, never scans question files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {buildInventory} = require('./audit-curriculum-inventory.cjs');
const ROOT = path.join(__dirname,'..');
const normalized = value => String(value || '').normalize('NFKC').replace(/\s+/g,'');
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0,20);
const canonical = subject => /^數學[AＢB甲乙]$/.test(subject) ? '數學' : subject === '國語' ? '國文' : subject;
const middleSubject = (grade,term,index) => grade === '國中一年級' ? '生物' : grade === '國中二年級'
  ? ((term === '第一學期' ? [0,2,3,4] : [5]).includes(index) ? '物理' : '化學')
  : ((term === '第一學期' ? [0,1,2] : [0,1]).includes(index) ? '物理' : '地球科學');

function build(root=ROOT) {
  const inventory=buildInventory(root);
  const curated=JSON.parse(fs.readFileSync(path.join(root,'concept-registry/curated.json'),'utf8'));
  const byFile=new Map(curated.concepts.flatMap(c=>c.references.map(file=>[file,c])));
  const candidates=inventory.referenceGroups.filter(g=>!byFile.has(g.file)).map(g=>({
    conceptId:'legacy-'+hash(JSON.stringify([g.subject,g.grade,g.name])),name:g.name,
    subject:g.subject,grades:[g.grade],status:'legacy-candidate',aliases:[],prerequisites:[],
    allowedContent:[],excludedContent:g.exclusions,scopeReviewStatus:'pending',
    references:[g.file],legacyConceptIds:g.legacyConceptIds,curriculumMappings:[]
  }));
  const registry=[...curated.concepts,...candidates];
  const labels=new Map();
  for(const group of inventory.referenceGroups) {
    const concept=byFile.get(group.file)||candidates.find(c=>c.references[0]===group.file);
    for(const link of inventory.indexLinks.filter(l=>l.file===group.file))
      labels.set(JSON.stringify([link.subject,link.grade,normalized(link.name)]),concept);
  }
  const shards=new Map();
  for(const catalog of inventory.catalogs) {
    const unitsBySubject=new Map();
    catalog.units.forEach((unit,i)=>{
      const subject=catalog.subject==='自然科學'&&catalog.stage==='middle-school'
        ?middleSubject(catalog.grade,catalog.term,i):catalog.subject;
      if(subject==='資訊科技')return;
      if(!unitsBySubject.has(subject))unitsBySubject.set(subject,[]);
      unitsBySubject.get(subject).push({...unit,concepts:unit.details.map(name=>{
        const c=labels.get(JSON.stringify([canonical(subject),catalog.grade,normalized(name)]));
        return {name,conceptId:c?.conceptId||null,status:c?.status||'unmapped'};
      })});
    });
    for(const [subject,units] of unitsBySubject) {
      const id='book-'+hash(JSON.stringify([catalog.file,catalog.subject,catalog.grade,catalog.term,catalog.edition,subject]));
      const key=catalog.grade+'/'+subject;
      if(!shards.has(key))shards.set(key,{schema:1,grade:catalog.grade,subject,books:[]});
      shards.get(key).books.push({bookId:id,subject,grade:catalog.grade,edition:catalog.edition,
        term:catalog.term,bookLabel:catalog.term,schoolYear:null,verifiedAt:null,
        verificationStatus:catalog.verificationStatus,releaseStatus:'legacy',
        legacyVisible:catalog.active,sourceFile:catalog.file,sources:[],units});
    }
  }
  const outputs=new Map();
  const add=(file,data)=>outputs.set(file,JSON.stringify(data,null,2)+'\n');
  add('concept-registry/legacy-candidates.json',{schema:1,concepts:candidates});
  const entries=[];
  for(const [key,shard] of shards) {
    const file='public/curriculum-data/'+key+'.json';
    add(file,shard);
    entries.push({grade:shard.grade,subject:shard.subject,path:file.slice(7),
      books:shard.books.length,legacyVisible:shard.books.some(b=>b.legacyVisible)});
  }
  for(const filename of fs.readdirSync(path.join(root,'curriculum-data/books')).sort()) {
    if(!filename.endsWith('.json'))continue;
    const book=JSON.parse(fs.readFileSync(path.join(root,'curriculum-data/books',filename),'utf8'));
    for(const unit of book.units)for(const item of unit.concepts) {
      const name=item.name.replace(/^\d+\s*[-－–]\s*\d+\s+/, '');
      const concept=curated.concepts.find(c=>c.subject===canonical(book.subject)&&c.grades.includes(book.grade)&&
        [c.name,...c.aliases].some(alias=>normalized(alias)===normalized(name)));
      if(concept){item.conceptId=concept.conceptId;item.status=concept.status;}
    }
    const key=book.grade+'/'+book.subject;
    if(!shards.has(key))throw Error('Official book has unknown grade/subject: '+key);
    shards.get(key).books.push(book);
  }
  // Source-verified scope selection is separate from full reference-content certification.
  for(const [key,shard] of shards)add('public/curriculum-data/'+key+'.json',shard);
  for(const entry of entries)entry.books=shards.get(entry.grade+'/'+entry.subject).books.length;
  const referenceRevision=hash(inventory.referenceGroups.map(g=>fs.readFileSync(path.join(root,g.file),'utf8')).join('\n'));
  const revision=hash(JSON.stringify([...outputs])+referenceRevision);
  add('public/curriculum-data/index.json',{schema:1,revision,schoolYearTarget:115,entries});
  add('concept-registry/index.json',{schema:1,revision,files:['curated.json','legacy-candidates.json'],
    counts:{reviewed:curated.concepts.length,candidates:candidates.length},
    byId:Object.fromEntries(registry.map(c=>[c.conceptId,byFile.has(c.references[0])?'curated.json':'legacy-candidates.json']))});
  return outputs;
}
function main() {
  const check=process.argv.includes('--check'),outputs=build();
  for(const [file,content] of outputs) {
    const absolute=path.join(ROOT,file);
    if(check) {
      if(!fs.existsSync(absolute)||fs.readFileSync(absolute,'utf8')!==content){console.error(file+' 已過期');process.exitCode=1;}
    } else {fs.mkdirSync(path.dirname(absolute),{recursive:true});fs.writeFileSync(absolute,content);}
  }
  // Stale generated shards must not leave a retired subject selectable.
  const walk=dir=>fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]):[];
  for(const file of walk(path.join(ROOT,'public/curriculum-data'))) {
    const relative=path.relative(ROOT,file).split(path.sep).join('/');
    if(!outputs.has(relative)){if(check){console.error(relative+' 為失效產物');process.exitCode=1;}else fs.unlinkSync(file);}
  }
  console.log(`${check?'Checked':'Built'} ${outputs.size} curriculum/registry files`);
}
if(require.main===module)main();
module.exports={build,normalized};

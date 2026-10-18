'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Art=require('../public/cultivation/golden-core-art.js');
const root=path.join(__dirname,'../public');
test('all nine core identities have exactly three artwork tiers with grade one being best',()=>{
  const training=fs.readFileSync(path.join(root,'cultivation/cultivation-training-v4.js'),'utf8');
  const types=training.slice(training.indexOf('  const CORE_TYPES = ['),training.indexOf('  function coreType('));
  assert.deepEqual(Art.TYPES,[...types.matchAll(/id: '([^']+)'/g)].map(match=>match[1]));
  assert.equal(new Set(Art.all()).size,27);
  for(const type of Art.TYPES)for(let grade=1;grade<=9;grade++){
    assert.equal(Art.source(type,grade),`assets/golden-cores/${type}-${grade<=3?'high':grade<=6?'mid':'low'}.webp`);
  }
  assert.equal(Art.source('unknown',NaN),'assets/golden-cores/taichu-low.webp');
});
test('27 project images are small transparent WebP assets at mobile-friendly dimensions',()=>{
  let bytes=0;
  for(const src of Art.all()){
    const image=fs.readFileSync(path.join(root,src));bytes+=image.length;
    assert.equal(image.toString('ascii',0,4),'RIFF');assert.equal(image.toString('ascii',8,12),'WEBP');
    assert.equal(image.toString('ascii',12,16),'VP8X');assert.ok(image[20]&16,'preserve genuine alpha');
    assert.equal(image.readUIntLE(24,3)+1,384);assert.equal(image.readUIntLE(27,3)+1,384);
  }
  assert.ok(bytes<2*1024*1024,'the entire startup core collection must stay under 2 MB');
});
test('washing changes only the candidate image and keeps failure fallback reversible',()=>{
  function stage(type,grade){const attrs={src:Art.source(type,grade)},image={hidden:false,complete:false,getAttribute:key=>attrs[key],setAttribute:(key,value)=>attrs[key]=value},fallback={hidden:true};return {dataset:{},image,fallback,attrs,querySelector:selector=>selector==='.golden-core-art'?image:fallback};}
  const candidate=stage('taichu',9),equipped=stage('ocean',4);
  Art.update(candidate,{type:'sword',grade:1,name:'破鋒劍心丹'});
  assert.equal(candidate.attrs.src,Art.source('sword',1));assert.equal(candidate.image.alt,'破鋒劍心丹');
  assert.equal(candidate.dataset.coreVisualGrade,'1');assert.equal(candidate.dataset.coreVisualType,'sword');
  assert.equal(equipped.attrs.src,Art.source('ocean',4));
  candidate.image.onerror();assert.equal(candidate.image.hidden,true);assert.equal(candidate.fallback.hidden,false);
  Art.update(candidate,{type:'sword',grade:8});candidate.image.onload();
  assert.equal(candidate.attrs.src,Art.source('sword',8));assert.equal(candidate.fallback.hidden,true);
  assert.match(Art.markup('ocean',9,'<unsafe>'),/alt="&lt;unsafe&gt;"/);
});

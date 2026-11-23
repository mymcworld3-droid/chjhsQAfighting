'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Pool=require('../public/cultivation/soulbound-pool.js');
const Access=require('../public/cultivation/training-access-rules.js');
const Layouts=require('../public/cultivation/training-scene-layouts.js');
const CoreArt=require('../public/cultivation/golden-core-art.js');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const main=read('public/main.js');
const legacy=read('public/main-legacy.js');
const artifactSync=read('public/cultivation/artifact-catalog-sync.js');
const materialSync=read('public/cultivation/material-catalog-sync.js');
const preload=read('public/cultivation/startup-resource-preloader.js');

test('startup resource warming occurs before the current weapon training interface',()=>{
  const preloader=main.indexOf("'./cultivation/startup-resource-preloader.js'");
  const training=main.indexOf("'./cultivation/manual-training-page.js'");
  assert(preloader>=0&&training>preloader);
  assert.doesNotMatch(main, /'\.\/cultivation\/unified-inventory-grid\.js'/);
  assert.match(preload,/export const featureReady = prepareStartupResources\(\)/);
  assert.match(preload,/xiuxian:startup-resource-progress/);
  assert.match(legacy,/xiuxian:startup-resource-progress/);
});

test('startup warmup is bounded and does not schedule a background catalog sweep',()=>{
  assert.match(preload,/STARTUP_IMAGE_LIMIT = 6/);
  assert.match(preload,/IMAGE_CONCURRENCY = 2/);
  assert.doesNotMatch(preload,/function warmRemainingInBackground\(/);
  assert.doesNotMatch(preload,/\.\.\.art\.all\(\)/);
  assert.doesNotMatch(preload,/\.\.\.definitionImageUrls\(MATERIAL_CATALOG\)/);
});
function imagePlan(player,portrait=false,profile='balanced'){
  const materials=Array.from({length:40},(_,i)=>({
    id:'material-'+i,realm:'築基',imageUrl:'/material-'+i+'.webp'
  }));
  const context={
    ARTIFACT_CATALOG:Pool.ITEMS,MATERIAL_CATALOG:materials,ARTIFACT_RECIPES:{},
    getArtifactById:Pool.get,getMaterialById:id=>materials.find(m=>m.id===id),
    realmOrderByName:name=>['凡人','練氣','築基','金丹','元嬰','化神','煉虛','合體','渡劫','半仙','真仙'].indexOf(name),
    materialRealmOrderByName:()=>2,trainingRenderProfile:()=>profile,
    QATrainingAccessRules:Access,QASoulboundPool:Pool,
    QATrainingSceneLayouts:Layouts,QAGoldenCoreArt:CoreArt,
    window:{getCurrentUserData:()=>player,matchMedia:()=>({matches:portrait})}
  };
  const source=preload.slice(0,preload.indexOf('function warmImage('))
    .replace(/^import[\s\S]*?;\s*/gm,'');
  return vm.runInNewContext(source+'\ncollectStartupImageUrls();',context);
}
test('only the currently visible orientation is considered at startup',()=>{
  const landscape=imagePlan({stats:{totalScore:28}});
  const portrait=imagePlan({stats:{totalScore:28}},true);
  assert.deepEqual(Array.from(landscape.startup),[
    'assets/scenes/mountains-landscape-ai.webp',
    'assets/scenes/loading-landscape-ai.webp'
  ]);
  assert.deepEqual(Array.from(portrait.startup),[
    'assets/scenes/mountains-portrait-ai.webp',
    'assets/scenes/loading-portrait-ai.webp'
  ]);
  assert.deepEqual(Array.from(landscape.remaining),[]);
  assert.deepEqual(Array.from(portrait.remaining),[]);
});
test('unrelated materials, hidden scenes, all other gold cores and weapon art are never warmed',()=>{
  const core={type:'sword',grade:1};
  const player={stats:{totalScore:28,rankLevel:3},
    cultivationTraining:{equippedCore:core,core},
    materialSystem:{inventory:Object.fromEntries(Array.from({length:40},(_,i)=>['material-'+i,1]))},
    artifactSystem:{inventory:{[Pool.ITEMS[0].id]:1},equipped:{slot:Pool.ITEMS[0].id}}};
  const p=imagePlan(player);
  assert.equal(p.coreImageCount,1);
  assert.equal(p.startup[0],CoreArt.source(core.type,core.grade));
  assert.equal(p.startup.length,3);
  assert(p.startup.length<=6);
  for(const asset of CoreArt.all().filter(src=>src!==p.startup[0]))
    assert(!p.startup.includes(asset));
  assert(!p.startup.some(url=>
    url.includes('material-')||url.includes('/cutouts/')||
    url.includes('cultivation-landscape')||url.includes('cultivation-portrait')||
    url.includes('/assets/weapons/')||url.includes('portrait-ai.webp')));
  for(const item of Pool.ITEMS)assert(!p.startup.includes(item.imageUrl));
});
test('both relevant current gold cores are kept; duplicates are removed',()=>{
  const p=imagePlan({cultivationTraining:{
    equippedCore:{type:'sword',grade:1},core:{type:'thunder',grade:5}
  }});
  assert.equal(p.startup[0],CoreArt.source('sword',1));
  assert.equal(p.startup[1],CoreArt.source('thunder',5));
  assert.equal(p.startup.filter(url=>url===p.startup[0]).length,1);
  assert(p.startup.length<=6);
});
test('do not select images until the rendering-profile decision has completed',async()=>{
  let resolve,collected=0;
  const context={
    trainingRenderReady:new Promise(done=>{resolve=done;}),
    dispatchProgress(){},ARTIFACT_CATALOG:[],MATERIAL_CATALOG:[],ARTIFACT_RECIPES:{},
    window:{},collectStartupImageUrls(){
      collected++;return {startup:[],remaining:[],priority:{
        ownedArtifactIds:[],ownedMaterialIds:[],equippedArtifactIds:[]}};
    }
  };
  const start=preload.indexOf('async function prepareStartupResources()');
  const end=preload.indexOf('\nexport const featureReady',start);
  vm.runInNewContext(preload.slice(start,end)+'\nthis.ready=prepareStartupResources();',context);
  assert.equal(collected,0);
  resolve('safe');
  assert.equal((await context.ready).ok,true);
  assert.equal(collected,1);
});

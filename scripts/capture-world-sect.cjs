/* Review the expanded sect with the production renderer, no account or database. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const runtime=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules';
let canvasRuntime;try{canvasRuntime=require('@napi-rs/canvas');}catch{canvasRuntime=require(path.join(runtime,'@napi-rs/canvas'));}
const {createCanvas,loadImage}=canvasRuntime,root=path.resolve(__dirname,'..');
const output=path.resolve(process.env.SECT_OUTPUT||path.join(root,'docs/design/world-sect'));fs.mkdirSync(output,{recursive:true});
const W=require('../public/world/world-core.js'),A=require('../public/world/world-art.js'),S=require('../public/world/world-scenery.js'),G=require('../public/world/world-ground.js'),Aura=require('../public/world/world-aura.js');
const document={createElement:()=>createCanvas(80,80)},context={document,QAGridWorld:W,QAGridWorldArt:A,QAGridWorldScenery:S,QAGridWorldGround:G,QAGridWorldAura:Aura,Date:class extends Date{static now(){return 100000;}}};
global.document=document;
vm.runInNewContext(fs.readFileSync(root+'/public/world/world-renderer.js','utf8').replace(/^import .*;\n/gm,'').replace('export class WorldRenderer','this.Renderer=class WorldRenderer'),context);
async function main(){
  const images={};for(const[id,url]of Object.entries({...A.sources,male:'/assets/world-map/players/player-male.webp',female:'/assets/world-map/players/player-female.webp'}))images[id]=await loadImage(root+'/public'+url);
  const world=W.createWorld(),fixtures=[
    {name:'overview',x:500,y:500,width:1720,height:1720,zoom:.65,player:{x:500,y:502}},
    {name:'main-hall',x:500,y:485,width:1100,height:720,zoom:1.45,player:{x:500,y:489}},
    {name:'water-garden',x:514,y:502,width:1100,height:760,zoom:1.25,player:{x:514,y:506}},
    {name:'phone',x:500,y:497,width:390,height:740,zoom:1,dpr:2,player:{x:500,y:497}},
    {name:'shopping-street',x:500,y:524,width:1440,height:720,zoom:.85,player:{x:500,y:525}},
    {name:'phone-market',x:482,y:524,width:390,height:740,zoom:1.25,dpr:2,player:{x:482,y:525}},
    {name:'library-quarter',x:477,y:481,width:1000,height:720,zoom:1.4,player:{x:477,y:483}}
  ],report=[];
  for(const f of fixtures){
    const dpr=f.dpr||1,canvas=createCanvas(f.width*dpr,f.height*dpr),r=Object.create(context.Renderer.prototype);
    Object.assign(r,{ctx:canvas.getContext('2d'),canvas,mini:createCanvas(96,96),width:f.width,height:f.height,dpr,world,camera:{x:f.x+.5,y:f.y+.5,zoom:f.zoom,follow:false},effects:[],hitRegions:[],hitMasks:new Map(),images,data:{uid:'review',state:{position:f.player,explored:world.fullExplored(),claims:{}},players:[{uid:'review',gender:'male',route:{path:[f.player],startedAtMs:100000,stepMs:W.STEP_MS}}],events:{}}});
    // Native runtime lacks a CJK font; map art and all draw order are production.
    r.label=()=>{};r.draw();const first=canvas.toBuffer('image/png');r.draw();assert.ok(first.equals(canvas.toBuffer('image/png')),'static repeated render');
    const times=[];for(let i=0;i<6;i++){const start=performance.now();r.draw();times.push(performance.now()-start);}
    fs.writeFileSync(path.join(output,f.name+'.webp'),canvas.toBuffer('image/webp',92));
    const props=r.sceneryItems.filter(p=>p.owner==='wendao-gardens');
    report.push({name:f.name,width:f.width,height:f.height,dpr,zoom:f.zoom,props:props.length,tileCache:r.ground.cachedTiles,medianDrawMs:times.sort((a,b)=>a-b)[3]});
    assert.ok(r.ground.cachedTiles<=r.ground.maxCachedTiles);assert.ok(props.length>0);
    // Walking below a roof keeps its entire silhouette; under the roof the
    // local player is protected by the same fade used by the live renderer.
    const draws=[];r.imageSprite=(sprite,x,y,alpha)=>draws.push({sprite,alpha});
    r.playerSilhouette={x:500.5*40-18,y:484.5*40-48,w:36,h:48,foot:484.5};
    const palace=S.create(world).sect().find(p=>p.prop==='sect-palace');r.drawScenery(palace);assert.equal(draws[0].alpha,.22);
  }
  const summary={renderer:'production WorldRenderer via native Canvas',seed:world.descriptor.seed,sectSize:world.CITY_RADIUS*2+1,facilities:world.SECT_FACILITIES.length,assets:Object.keys(images).length,repeatable:true,fixtures:report};
  fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}
main().catch(e=>{console.error(e);process.exitCode=1;});

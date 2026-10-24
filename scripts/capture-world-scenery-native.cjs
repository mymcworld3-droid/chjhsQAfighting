/* Optional native Canvas verification when browser tooling is unavailable. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
let canvasRuntime;try{canvasRuntime=require('@napi-rs/canvas');}catch{canvasRuntime=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','@napi-rs/canvas'));}
const {createCanvas,loadImage}=canvasRuntime;
const root=path.resolve(__dirname,'..'),output=path.resolve(process.env.SCENERY_OUTPUT||path.join(root,'docs/design/world-scenery/native'));
fs.mkdirSync(output,{recursive:true});
const W=require(root+'/public/world/world-core.js'),A=require(root+'/public/world/world-art.js'),S=require(root+'/public/world/world-scenery.js'),G=require(root+'/public/world/world-ground.js');
const context={QAGridWorld:W,QAGridWorldArt:A,QAGridWorldScenery:S,QAGridWorldGround:G,document:{createElement:()=>createCanvas(80,80)},Date:class extends Date{static now(){return 100000;}}};
global.document=context.document;
vm.runInNewContext(fs.readFileSync(root+'/public/world/world-renderer.js','utf8').replace(/^import .*;\n/gm,'').replace('export class WorldRenderer','this.Renderer=class WorldRenderer'),context);
(async()=>{const images={};for(const[id,url]of Object.entries({...A.sources,male:'/assets/world-map/players/player-male.webp',female:'/assets/world-map/players/player-female.webp'}))images[id]=await loadImage(root+'/public'+url);
const world=W.createWorld(),scene=S.create(world),objects=world.objectsIn({x:0,y:0,w:1000,h:1000});
const site=type=>objects.find(o=>o.subtype===type&&o.x>80&&o.x<920&&o.y>80&&o.y<920&&world.baseTerrain(o.x,o.y)==='grass'&&scene.site(o).length>=(type==='camp'?12:7));
const biome=type=>{for(let y=90;y<910;y+=12)for(let x=90;x<910;x+=12)if([-6,0,6].every(dy=>[-8,0,8].every(dx=>world.baseTerrain(x+dx,y+dy)===type)))return{x,y};throw Error(type);};
const fixtures=[{...site('camp'),name:'CAMP / CONNECTED FENCES'},{...site('ruins'),name:'RUINS / STONE DEBRIS'},{name:'BAMBOO / SEEDED CLEARINGS',...biome('bamboo')},{name:'STONE FIELD / SPARSE ROCKS',...biome('stone')},{name:'WENDAO SECT / ORIGINAL BUILDINGS',...world.SPAWN},{name:'RIVER / BRIDGE CONNECTION',...world.starterPoint(26,17)}];
const render=(p,width,height,zoom=1.15)=>{const canvas=createCanvas(width,height),r=Object.create(context.Renderer.prototype),position={x:p.x,y:p.y+1};Object.assign(r,{ctx:canvas.getContext('2d'),canvas,mini:createCanvas(96,96),width,height,dpr:1,world,camera:{x:p.x+.5,y:p.y+.5,zoom,follow:false},effects:[],hitRegions:[],hitMasks:new Map(),images,data:{uid:'qa',state:{position,explored:world.fullExplored(),claims:{},travelMode:'walk'},players:[{uid:'qa',name:'',gender:'male',route:{path:[position],startedAtMs:100000,stepMs:W.STEP_MS}}],events:{bridge:1,array:0}}});r.label=()=>{};r.draw();const a=canvas.toBuffer('image/png');r.draw();assert.ok(a.equals(canvas.toBuffer('image/png')));assert.ok(r.ground.cachedTiles<=512);return{canvas,r};};
const contact=createCanvas(1200,1044),c=contact.getContext('2d');c.fillStyle='#17261d';c.fillRect(0,0,1200,1044);const report=[];
for(let i=0;i<fixtures.length;i++){const p=fixtures[i],{canvas,r}=render(p,590,300),x=i%2*600+5,y=Math.floor(i/2)*348+40;c.drawImage(canvas,x,y);c.fillStyle='#e7ddc4';c.font='bold 14px sans-serif';c.fillText(p.name+'  ('+p.x+', '+p.y+')',x+10,y-14);report.push({name:p.name,x:p.x,y:p.y,props:r.sceneryItems.length,cache:r.ground.cachedTiles});}
fs.writeFileSync(path.join(output,'overview.webp'),contact.toBuffer('image/webp',90));
fs.writeFileSync(path.join(output,'phone.webp'),render(fixtures[0],390,640,1).canvas.toBuffer('image/webp',90));
const base={terrain:'grass',neighbours:Array(8).fill('grass'),mask:0,underlay:'grass',bridgeDirection:'east'},ground=G.create(A,()=>createCanvas(80,80));let seam=0;
const tile=(x,y)=>ground.compose({...base,x,y,key:x+','+y},images).getContext('2d');const compare=(a,b)=>{for(let i=0;i<a.length;i++)seam=Math.max(seam,Math.abs(a[i]-b[i]));};
for(let n=0;n<8;n++){compare(tile(3,n).getImageData(79,0,1,80).data,tile(4,n).getImageData(0,0,1,80).data);compare(tile(n,3).getImageData(0,79,80,1).data,tile(n,4).getImageData(0,0,80,1).data);}assert.ok(seam<=1);
const result={renderer:'production WorldRenderer via native Canvas',labels:'suppressed in fixture; no CJK font in native runtime',seed:world.descriptor.seed,images:Object.keys(images).length,repeatable:true,seamMaxDifference:seam,fixtures:report};fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;});

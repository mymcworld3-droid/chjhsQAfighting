'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const W=require('../public/world/world-core.js'),A=require('../public/world/world-art.js');
const Scenery=require('../public/world/world-scenery.js'),Ground=require('../public/world/world-ground.js');
function renderer(){
  const context={QAGridWorld:W,QAGridWorldArt:A,QAGridWorldScenery:Scenery,QAGridWorldGround:Ground};
  const source=fs.readFileSync(path.join(__dirname,'../public/world/world-renderer.js'),'utf8').replace(/^import .*;\n/gm,'').replace('export class WorldRenderer','this.Renderer=class WorldRenderer');
  vm.runInNewContext(source,context);return Object.create(context.Renderer.prototype);
}
test('every building has its own small bitmap and all live world objects have mapped artwork',()=>{
  assert.equal(A.buildings.length,15);assert.equal(new Set(A.buildings.map(id=>A.sources[id])).size,15);
  const objects=[...W.OBJECTS,...W.objectsIn({x:64,y:64,w:192,h:192})];
  for(const o of objects){const s=A.object(o);assert.ok(A.sources[s.image]||['male','female'].includes(s.image));assert.ok(s.w<=(['building','structure','realm'].includes(o.kind)?116:80)&&s.h<=(['building','structure','realm'].includes(o.kind)?116:80));assert.ok(s.w>0&&s.h>0);}
  assert.ok(W.TYPES.every(t=>A.terrain.includes(t)));
  for(const species of A.creatures){const s=A.monster({species});assert.equal(s.image,'creatures-atlas');assert.ok(s.sx+s.sw<=640&&s.sy+s.sh<=512);}
});
test('all shipped AI images exist, match the size manifest, preserve cutout alpha and fit a small download budget',()=>{
  const root=path.join(__dirname,'../public/assets/world-map/ai'),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  // Includes the three additional monster directions, boat directions and ambient props.
  assert.equal(manifest.assets.length,Object.keys(A.sources).length);assert.ok(manifest.totalBytes<1600000);
  assert.equal(new Set(manifest.assets.filter(a=>A.buildings.includes(a.id)).map(a=>a.sourceSha256)).size,15,'each building comes from its own generated image');
  for(const[id,url]of Object.entries(A.sources)){
    const asset=manifest.assets.find(a=>a.id===id);assert.ok(asset,id);const bytes=fs.readFileSync(path.join(root,path.basename(url)));
    assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.equal(bytes.length,asset.bytes);
    assert.ok(asset.width<=640&&asset.height<=640);assert.ok(asset.bytes<220000);assert.match(asset.sourceSha256,/^[a-f0-9]{64}$/);
    if(id!=='ground-atlas')assert.equal(asset.alpha,true,id);
  }
});
test('roof overhang selects the building anchor, while transparent pixels leave adjacent ground clickable',()=>{
  const r=renderer(),object=W.object('forge'),sprite=A.object(object),bounds=A.bounds(object),mask=new Uint8Array(64*64*4),key=[sprite.image,sprite.sx,sprite.sy].join(':');
  r.images={};r.hitMasks=new Map([[key,mask]]);r.hitRegions=[{object,sprite,bounds}];
  const p={x:(bounds.x+bounds.w*.5)/40,y:(bounds.y+bounds.h*.2)/40},u=32,v=12;mask[(v*64+u)*4+3]=255;
  assert.deepEqual({...r.pickPoint(p)},{x:object.x,y:object.y});assert.notEqual(Math.floor(p.y),object.y,'test point is on a different grid row');
  mask.fill(0);assert.deepEqual({...r.pickPoint(p)},{x:Math.floor(p.x),y:Math.floor(p.y)});
});
test('overlapping opaque sprites use the same foreground order as drawing',()=>{
  const r=renderer(),a=W.object('forge'),b={...a,id:'other',y:a.y+1},s=A.object(a),bounds=A.bounds(a),mask=new Uint8Array(64*64*4).fill(255);
  r.images={};r.hitMasks=new Map([[[s.image,s.sx,s.sy].join(':'),mask]]);r.hitRegions=[{object:a,sprite:s,bounds},{object:b,sprite:s,bounds}];
  assert.deepEqual({...r.pickPoint({x:(bounds.x+30)/40,y:(bounds.y+30)/40})},{x:b.x,y:b.y});
});
test('all terrain and decorative illustration paths use AI bitmap cells with valid atlas bounds',()=>{
  const r=renderer(),draws=[];r.world=W;r.data={events:{}};r.images=Object.fromEntries(Object.keys(A.sources).map(id=>[id,{id,complete:true,naturalWidth:640}]));
  r.ctx={globalAlpha:1,save(){},restore(){},drawImage(...args){draws.push(args);}};
  for(let i=0;i<W.TYPES.length;i++){r.tile(50+i,50,W.TYPES[i],1234);r.decoration(50+i,50,W.TYPES[i]);}
  for(const direction of A.directions)for(const prop of [...A.sceneryProps,'boat'])r.imageSprite(A.directional(prop,direction),0,0);
  for(const prop of A.ambientProps)r.imageSprite(A.ambientProp(prop),0,0);
  for(const prop of ['fence','wall'])for(let mask=0;mask<16;mask++)r.drawScenery({prop,mask,x:0,y:0});
  assert.ok(draws.length>=W.TYPES.length);for(const[image,x,y,w,h]of draws){assert.ok(x>=0&&y>=0&&w>0&&h>0);const width=image.id.startsWith('creatures-')?640:image.id.endsWith('-atlas')?512:256;const height=image.id.startsWith('scenery-')?256:image.id.startsWith('creatures-')?512:image.id==='boats-atlas'?128:image.id.endsWith('-atlas')?640:256;assert.ok(x+w<=width&&y+h<=height);}
});

test('Qingyun Sect gates use an independent four-view gate cutout without changing camp entrances',()=>{
  const gates=A.directions.map(d=>A.directional('sect-gate',d,100));
  assert.ok(gates.every(s=>s.image==='sect-gates'&&s.sw===104&&s.sh===104&&s.w===118&&s.h===118));
  assert.equal(new Set(gates.map(s=>s.sx+':'+s.sy)).size,4);
  assert.deepEqual(gates.map(s=>[s.sx,s.sy]),[[104,0],[104,104],[0,0],[0,104]]);
  assert.ok(A.directions.every(d=>A.directional('gate',d).image.startsWith('scenery-')),'camp gateways preserve their original sprites');
});

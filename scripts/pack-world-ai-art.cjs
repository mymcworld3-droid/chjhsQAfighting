'use strict';
// Downsample generated originals into small, transparent, versioned game sprites.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
let sharp;try{sharp=require('sharp');}catch{sharp=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','sharp'));}
const output=path.resolve(__dirname,'../public/assets/world-map/ai');
async function pack(source){
  const meta=await sharp(source.path).metadata(),id=source.id;let pipeline;
  if(id.endsWith('-atlas')||id.startsWith('creatures-')||source.gridColumns){
    const creature=id.startsWith('creatures-'),columns=source.gridColumns||(creature?5:4),rows=source.gridRows||(id.startsWith('scenery-')?2:creature?4:5);
    const edges=source.rows||Array.from({length:rows+1},(_,i)=>Math.round(i*meta.height/rows));
    const xs=source.columns||Array.from({length:columns+1},(_,i)=>Math.round(i*meta.width/columns)),tiles=[];
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
      const inset=source.inset||0;
      const crop={left:xs[col]+inset,top:edges[row]+inset,width:xs[col+1]-xs[col]-inset*2,height:edges[row+1]-edges[row]-inset*2};
      let image=sharp(await sharp(source.path).extract(crop).png().toBuffer());
      if(id==='ground-atlas'||source.opaque)image=image.removeAlpha().resize(128,128,{fit:'fill'});
      // Connector parts use their entire frame: padding at a rail tip would
      // produce a gap between adjacent cells. Runtime supplies the part geometry.
      else if(source.componentParts)image=image.trim({threshold:12}).resize(128,128,{fit:'fill'});
      else{const padding=id.startsWith('scenery-')?4:8,size=128-padding*2;image=image.trim({threshold:12}).resize(size,size,{fit:'contain',background:'#00000000'}).extend({top:padding,bottom:padding,left:padding,right:padding,background:'#00000000'});}
      tiles.push({input:await image.png().toBuffer(),left:col*128,top:row*128});
    }
    pipeline=sharp({create:{width:columns*128,height:rows*128,channels:4,background:'#00000000'}}).composite(tiles);
  }else pipeline=sharp(source.path).trim({threshold:12}).resize(240,240,{fit:'contain',background:'#00000000'}).extend({top:8,bottom:8,left:8,right:8,background:'#00000000'});
  const quality=source.quality??(id==='ground-atlas'?84:88);
  const file=source.file||id+'.webp',target=path.join(output,file);await pipeline.webp({quality,alphaQuality:100,effort:6}).toFile(target);
  const final=await sharp(target).metadata();return{id,file,width:final.width,height:final.height,bytes:fs.statSync(target).size,alpha:!!final.hasAlpha,...(source.componentParts?{componentParts:true}:{}),...(source.quality?{quality}:{}),...(source.rows?{sourceRows:source.rows}:{}),...(source.columns?{sourceColumns:source.columns}:{}),source: path.basename(source.path),sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(source.path)).digest('hex')};
}
async function main(){
  const input=process.argv[2];if(!input)throw Error('Usage: node scripts/pack-world-ai-art.cjs /path/to/source-manifest.json');
  const sources=JSON.parse(fs.readFileSync(input,'utf8')).assets;fs.mkdirSync(output,{recursive:true});
  const previous=process.argv.includes('--merge')?JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8')).assets:[],assets=previous.filter(a=>!sources.some(s=>s.id===a.id));
  for(const source of sources)assets.push(await pack(source));
  const manifest={version:2,tool:'built-in image_gen',cellSize:128,buildingSize:256,totalBytes:assets.reduce((n,a)=>n+a.bytes,0),assets};
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
}
main().catch(error=>{console.error(error);process.exitCode=1;});

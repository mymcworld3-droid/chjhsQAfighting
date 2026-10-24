/* Render the production map with isolated, fully revealed local fixtures. */
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const W=require('../public/world/world-core.js'),S=require('../public/world/world-scenery.js');
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','playwright')));}
const root=path.resolve(__dirname,'../public'),output=path.resolve(process.env.SCENERY_OUTPUT||'docs/design/world-scenery');
async function main(){
  const world=W.createWorld(),scene=S.create(world),objects=world.objectsIn({x:0,y:0,w:1000,h:1000});
  const site=type=>objects.find(o=>o.subtype===type&&o.x>80&&o.x<920&&o.y>80&&o.y<920&&world.baseTerrain(o.x,o.y)==='grass'&&scene.site(o).length>=(type==='camp'?12:7));
  const biome=type=>{
    for(let y=90;y<910;y+=12)for(let x=90;x<910;x+=12)if([-6,0,6].every(dy=>[-8,0,8].every(dx=>world.baseTerrain(x+dx,y+dy)===type)))return {x,y};
    throw Error('No broad '+type+' fixture');
  };
  const fixtures=[{name:'營地・柵欄與物資',...site('camp')},{name:'遺跡・斷牆與碎石',...site('ruins')},{name:'竹林・種子疏密',...biome('bamboo')},{name:'石域・留白與散石',...biome('stone')},{name:'問道宗・道路轉接',...world.SPAWN},{name:'青溪・橋面銜接',...world.starterPoint(26,17)}];
  assert.ok(fixtures.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
  const html=`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>地圖生態細節</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#171e19;color:#e7ddc4;font:16px sans-serif}h1{font-size:24px;margin:0 0 8px}p{color:#b8bda9;margin:0 0 20px;font-size:13px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}section{overflow:hidden;border:1px solid #69715a;border-radius:8px;background:#25372a}h2{font-size:15px;padding:12px 16px;margin:0}canvas.map{display:block;width:100%;height:330px;touch-action:none}.mini{display:none}@media(max-width:600px){body{padding:12px}.grid{grid-template-columns:1fr}canvas.map{height:380px}}</style><h1>青雲問道・地圖生態細節</h1><p>種子 qingyun-2026 ｜ 正式地圖繪製器 ｜ 實際生成區域</p><div class="grid">${fixtures.map((p,i)=>`<section><h2>${p.name} (${p.x}, ${p.y})</h2><canvas class="map" id="map-${i}"></canvas><canvas class="mini" id="mini-${i}" width="96" height="96"></canvas></section>`).join('')}</div><script type="module">
    import {WorldRenderer} from '/world/world-renderer.js';
    window.renderers=[];const fixtures=${JSON.stringify(fixtures)};
    for(let i=0;i<fixtures.length;i++){
      const p=fixtures[i],r=new WorldRenderer(document.getElementById('map-'+i),document.getElementById('mini-'+i),()=>{}),world=QAGridWorld.createWorld();
      r.world=world;r.camera={x:p.x+.5,y:p.y+.5,zoom:1.15,follow:false};r.set({uid:'preview',state:{position:p,explored:world.fullExplored()},events:{},players:[{uid:'preview',gender:'male',name:'行者',route:{path:[{x:p.x,y:p.y+1}],stepMs:220,startedAtMs:0}}]});
      await Promise.all(Object.values(r.images).map(img=>img.decode()));r.draw();renderers.push(r);
    }
    window.ready=true;
  </script></html>`;
  const server=http.createServer(async(req,res)=>{
    try{if(req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(html);}
      const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.webp')?'image/webp':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(await fs.readFile(file));
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],...(process.env.WORLD_CHROMIUM_PATH?{executablePath:process.env.WORLD_CHROMIUM_PATH}:{})});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1250},deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
    if(process.env.SCENERY_FONT_ROOT){
      const fontRoot=path.resolve(process.env.SCENERY_FONT_ROOT);
      await page.route('**/preview-font/**',async route=>{
        const relative=new URL(route.request().url()).pathname.split('/preview-font/')[1],file=path.resolve(fontRoot,relative);
        if(!file.startsWith(fontRoot+path.sep))return route.abort();
        await route.fulfill({body:await fs.readFile(file),contentType:file.endsWith('.css')?'text/css':'font/woff2'});
      });
      await page.addStyleTag({content:"@import url('/preview-font/400.css');body{font-family:'Noto Sans TC',sans-serif}"});
      await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>{for(const r of renderers)r.draw();});
    }
    assert.deepEqual(errors,[]);
    const report=await page.evaluate(()=>{
      const times=[];for(let i=0;i<12;i++){const at=performance.now();for(const r of renderers)r.draw();times.push((performance.now()-at)/renderers.length);}
      return {fixtures:renderers.map(r=>({camera:r.camera,props:r.sceneryItems.length,cache:r.ground.cachedTiles,assetErrors:r.assetErrors})),medianDrawMs:times.sort((a,b)=>a-b)[Math.floor(times.length/2)]};
    });
    for(const r of report.fixtures){assert.deepEqual(r.assetErrors,[]);assert.ok(r.cache<=512);}
    // The larger texture blocks meet continuously at both mirrored boundaries.
    const seam=await page.evaluate(()=>{
      const r=renderers[0],base={terrain:'grass',neighbours:Array(8).fill('grass'),mask:0,underlay:'grass',bridgeDirection:'east'};
      const tile=(x,y)=>r.ground.compose({...base,x,y,key:'seam:'+x+':'+y},r.images).getContext('2d');
      let difference=0;
      const compare=(a,b)=>{for(let i=0;i<a.length;i++)difference=Math.max(difference,Math.abs(a[i]-b[i]));};
      const size=r.ground.tileSize;
      for(let n=0;n<8;n++){
        compare(tile(3,n).getImageData(size-1,0,1,size).data,tile(4,n).getImageData(0,0,1,size).data);
        compare(tile(n,3).getImageData(0,size-1,size,1).data,tile(n,4).getImageData(0,0,size,1).data);
      }
      return difference;
    });assert.ok(seam<=1,'same terrain textures meet continuously');
    await page.screenshot({path:path.join(output,'overview.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{for(const r of renderers){r.resize();r.draw();}resolve();}))));
    await page.screenshot({path:path.join(output,'phone.png')});
    await fs.writeFile(path.join(output,'validation.json'),JSON.stringify({seed:world.descriptor.seed,fixtures,errors,seamMaxDifference:seam,...report},null,2)+'\n');
    console.log(JSON.stringify({errors,medianDrawMs:report.medianDrawMs,seamMaxDifference:seam,output}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

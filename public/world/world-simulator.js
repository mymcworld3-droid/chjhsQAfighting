(function(){
  'use strict';
  const Core=globalThis.QAGridWorld,$=id=>document.getElementById(id),canvas=$('map'),context=canvas.getContext('2d');
  const app=$('sim-app'),stage=$('sim-stage'),tierColors=['#a0b57c','#b4bd7c','#d2b877','#cd9467','#b5829e','#927fb6','#647eaa','#b66367'];
  const markerColors={realm:'#e1b2ed',structure:'#f2d393',monster:'#d67a69',vein:'#d3b75a'};
  let model=null,world=null,worker=null,task=0,view={x:500,y:500,scale:1},width=1,height=1,drag=null,selected=null,overview=null,overviewLayer='',patches={},revisions={},renderQueued=false;
  const workerURL=URL.createObjectURL(new Blob([$('world-core-source').textContent,'\n',$('world-worker-source').textContent],{type:'text/javascript'}));
  const format=n=>Number(n||0).toLocaleString('zh-TW');
  const status=text=>{$('status').textContent=text;};
  function fitApp(){
    const portrait=innerWidth<innerHeight,w=portrait?360:1280,h=portrait?640:720,scale=Math.min(innerWidth/w,innerHeight/h);
    stage.classList.toggle('portrait',portrait);Object.assign(stage.style,{left:(innerWidth-w*scale)/2+'px',top:(innerHeight-h*scale)/2+'px',width:w*scale+'px',height:h*scale+'px'});
    Object.assign(app.style,{width:w+'px',height:h+'px',transform:'scale('+scale+')'});resize();
  }
  function resize(){width=canvas.clientWidth;height=canvas.clientHeight;const dpr=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);context.setTransform(dpr,0,0,dpr,0,0);if(model&&view.fit)fitMap();draw();}
  function fitMap(){view={x:500,y:500,scale:Math.min(width/1000,height/1000)*.96,fit:true};draw();}
  const colorParts=hex=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
  const palette=Core.TYPES.map(t=>colorParts(Core.COLORS[t])),dangerPalette=tierColors.map(colorParts);
  function pixelColor(type,x,y,layer){
    const code=Core.TYPES.indexOf(type),sea=type==='ocean'||type==='water';
    if(layer==='danger'&&!sea)return dangerPalette[world.tierAt(x,y)];
    const rgb=palette[code]||[0,0,0];return layer==='resources'||layer==='sites'?rgb.map(v=>Math.round(v*.48)):rgb;
  }
  function makeOverview(){
    if(!model)return;const layer=$('layer').value;if(overview&&overviewLayer===layer)return;overviewLayer=layer;
    overview=document.createElement('canvas');overview.width=1000;overview.height=1000;const c=overview.getContext('2d'),data=c.createImageData(1000,1000);
    for(let i=0;i<model.tiles.length;i++){const rgb=pixelColor(Core.TYPES[model.tiles[i]],i%1000,(i/1000)|0,layer),j=i*4;data.data[j]=rgb[0];data.data[j+1]=rgb[1];data.data[j+2]=rgb[2];data.data[j+3]=255;}
    c.putImageData(data,0,0);
  }
  function visiblePoint(x,y){return {x:width/2+(x-view.x)*view.scale,y:height/2+(y-view.y)*view.scale};}
  function worldPoint(event){const r=canvas.getBoundingClientRect(),x=(event.clientX-r.left)*width/r.width,y=(event.clientY-r.top)*height/r.height;return{x:(x-width/2)/view.scale+view.x,y:(y-height/2)/view.scale+view.y,screenX:x,screenY:y};}
  function paintDeltas(c,scale=1,origin={x:0,y:0}){
    if(!$('show-changes').checked)return;
    for(const[k,chunk]of Object.entries(patches)){const[cx,cy]=k.split(',').map(Number);for(const[i,v]of Object.entries(chunk.tiles)){const n=Number(i),x=cx*32+n%32,y=cy*32+Math.floor(n/32),rgb=pixelColor(v.terrain,x,y,$('layer').value);c.fillStyle='rgb('+rgb.join(',')+')';c.fillRect(origin.x+x*scale,origin.y+y*scale,Math.max(1,scale+.1),Math.max(1,scale+.1));}}
  }
  function drawNow(){
    renderQueued=false;context.clearRect(0,0,width,height);context.fillStyle='#10181b';context.fillRect(0,0,width,height);if(!model)return;makeOverview();
    const origin=visiblePoint(0,0);context.imageSmoothingEnabled=false;context.drawImage(overview,origin.x,origin.y,1000*view.scale,1000*view.scale);paintDeltas(context,view.scale,origin);
    if(view.scale>=7){context.strokeStyle='#eee4d01c';context.lineWidth=1;const left=Math.max(0,Math.floor(view.x-width/view.scale/2)),right=Math.min(1000,Math.ceil(view.x+width/view.scale/2)),top=Math.max(0,Math.floor(view.y-height/view.scale/2)),bottom=Math.min(1000,Math.ceil(view.y+height/view.scale/2));
      context.beginPath();for(let x=left;x<=right;x++){const p=visiblePoint(x,top),q=visiblePoint(x,bottom);context.moveTo(p.x,p.y);context.lineTo(q.x,q.y);}for(let y=top;y<=bottom;y++){const p=visiblePoint(left,y),q=visiblePoint(right,y);context.moveTo(p.x,p.y);context.lineTo(q.x,q.y);}context.stroke();}
    const enabled=new Set([...document.querySelectorAll('[data-marker]:checked')].map(n=>n.dataset.marker)),layer=$('layer').value;
    for(const o of model.objects){const kind=o.veinId?'vein':o.kind;if(!enabled.has(kind)&&!(layer==='resources'&&(kind==='vein'||kind==='gather'))&&!(layer==='sites'&&(kind==='realm'||kind==='structure')))continue;
      if(kind==='vein'&&view.scale<4&&!o.veinAnchor)continue;
      const p=visiblePoint(o.x+.5,o.y+.5);if(p.x<0||p.y<0||p.x>width||p.y>height)continue;context.fillStyle=markerColors[kind]||'#a9d281';const radius=view.scale<1?(kind==='realm'?1.6:kind==='structure'?1.2:.8):(kind==='realm'?3:kind==='structure'?2.5:1.5);
      context.beginPath();if(kind==='vein')context.rect(p.x-1.3,p.y-1.3,2.6,2.6);else context.arc(p.x,p.y,Math.max(radius,Math.min(5,view.scale*.24)),0,Math.PI*2);context.fill();
      if(view.scale>=12){context.font='10px sans-serif';context.textAlign='center';context.lineWidth=3;context.strokeStyle='#111c';const text=o.name+(o.level?' Lv.'+o.level:'');context.strokeText(text,p.x,p.y-9);context.fillStyle='#eee4d0';context.fillText(text,p.x,p.y-9);}
    }
    const spawn=visiblePoint(Core.SPAWN.x+.5,Core.SPAWN.y+.5);context.strokeStyle='#fff1bb';context.lineWidth=1.5;context.strokeRect(spawn.x-4,spawn.y-4,8,8);
    context.font='12px sans-serif';context.textAlign='center';context.lineWidth=3;context.strokeStyle='#14211dcc';context.strokeText('問道宗',spawn.x,spawn.y-10);context.fillStyle='#fff1bb';context.fillText('問道宗',spawn.x,spawn.y-10);
    if(selected){const p=visiblePoint(selected.x,selected.y);context.strokeStyle='#fff0af';context.lineWidth=2;context.strokeRect(p.x,p.y,Math.max(3,view.scale),Math.max(3,view.scale));}
  }
  function draw(){if(!renderQueued){renderQueued=true;requestAnimationFrame(drawNow);}}
  function setBusy(value,label='正在生成世界'){ $('loading').hidden=!value;$('loading-label').textContent=label;$('progress').value=0;}
  function launch(kind,payload){
    worker?.terminate();worker=new Worker(workerURL);const id=++task;setBusy(true,kind==='compare'?'正在比較四個種子':'正在生成一百萬格世界');
    worker.onmessage=event=>{
      const data=event.data;if(data.id!==task)return;
      if(data.type==='progress'){$('progress').value=data.pct;status('生成中 '+data.pct+'%');if(kind==='compare')$('compare-dialog').querySelector('p').textContent='正在生成與分析 '+data.pct+'%';return;}
      setBusy(false);worker.terminate();worker=null;
      if(data.type==='error'){status(data.message);return;}
      if(data.type==='comparison'){showComparison(data.results);status('四個種子比較完成');return;}
      model=data;world=Core.createWorld(data.world);patches={};revisions={};overview=null;selected=null;
      if(payload.patches){try{world.installPatches(payload.patches);patches=structuredClone(payload.patches);revisions=world.patchVersions();}catch(error){patches={};status('變更檔無效：'+error.message);}}
      $('seed').value=data.world.seed;updateStats();updateStorage();fitMap();inspect(Core.SPAWN);status('種子 '+data.world.seed+' · 指紋 '+data.stats.fingerprint);
    };
    worker.onerror=event=>{if(id===task){setBusy(false);status('生成未完成：'+event.message);}};
    worker.postMessage({id,kind,...payload});
  }
  function generate(seed=$('seed').value,changes=null){const d=Core.validateDescriptor({seed});launch('generate',{seed:d.seed,...(changes?{patches:changes}:{})});}
  function updateStats(){
    const s=model.stats,entries=[['陸地比例',(s.landRatio*100).toFixed(1),'%'],['海洋比例',((1-s.landRatio)*100).toFixed(1),'%'],['秘境',s.kinds.realm||0,'處'],['結構',s.kinds.structure||0,'處'],['妖獸',s.kinds.monster||0,'隻'],['連續礦脈',s.veins,'條'],['主要陸塊',s.islands,'片'],['宗門可步行',format(s.spawnConnected),'格']];
    $('stats').replaceChildren(...entries.map(([name,value,unit])=>{const n=document.createElement('div');n.className='stat';const small=document.createElement('small');small.textContent=name;const b=document.createElement('b');b.textContent=typeof value==='number'?format(value):value;const span=document.createElement('span');span.textContent=' '+unit;b.append(span);n.append(small,b);return n;}));
    $('generation-time').textContent=(s.milliseconds/1000).toFixed(2)+' 秒';const max=Math.max(...s.tiers,1);
    $('tier-stats').replaceChildren(...s.tiers.map((count,i)=>{const row=document.createElement('div');row.className='tier-row';const name=document.createElement('span');name.textContent=Core.TIERS[i].name;const bar=document.createElement('i'),fill=document.createElement('em');fill.style.width=count/max*100+'%';fill.style.background=tierColors[i];bar.append(fill);const value=document.createElement('span');value.textContent=count;row.append(name,bar,value);return row;}));
  }
  function updateStorage(){const count=Object.values(patches).reduce((n,c)=>n+Object.keys(c.tiles).length,0),bytes=new Blob([JSON.stringify({world:world?.descriptor,patches})]).size;$('storage').textContent='變更 '+count+' 格 · '+format(bytes)+' bytes';}
  function inspect(p){
    if(!model||!Core.inside(p.x,p.y))return;selected={x:p.x,y:p.y};const base=Core.TYPES[model.tiles[p.y*1000+p.x]],actual=$('show-changes').checked?world.terrain(p.x,p.y):base,o=world.objectAt(p.x,p.y),tier=Core.TIERS[world.tierAt(p.x,p.y)];
    $('tile-coordinate').textContent=p.x+'，'+p.y;const title=document.createElement('strong');title.textContent=Core.LABELS[actual]+' · '+tier.name+'域';const body=document.createElement('div');body.textContent=o?o.name+(o.level?' · Lv.'+o.level:''):'此格沒有固定互動物件';const extra=document.createElement('small');extra.textContent='區塊 '+Core.chunkKey(p.x,p.y)+(actual!==base?' · 已修改（原為'+Core.LABELS[base]+'）':' · 種子生成');
    const nodes=[title,body,extra];if(o?.species){const n=document.createElement('small');n.textContent=(Core.LABELS[o.biome]||'野外')+'棲地 · '+o.species+'群聚';nodes.push(n);}if(Core.inSafeArea(p.x,p.y)){const n=document.createElement('small');n.textContent=world.zone(p)+' · 安全區，沒有野生妖獸';nodes.push(n);}if(o?.veinId){const n=document.createElement('small');n.textContent='連續礦脈 · '+o.veinLength+' 格 · '+o.realm+'資源';nodes.push(n);}if(o?.kind==='realm'){const n=document.createElement('small');n.textContent=o.subtype==='guardian'?'守衛挑戰秘境':'陣紋探索秘境';nodes.push(n);}$('tile-info').replaceChildren(...nodes);draw();
  }
  function changeTile(p,type){
    if(!model||!Core.inside(p.x,p.y))return;
    const previously=world.terrain(p.x,p.y),updates=new Map(),protectedTerrain=new Set(['water','ocean','bridge','broken-bridge','lava','sealed']);
    // Stage every new road tile and its enclosed interior, then apply each
    // affected chunk once so large enclosed courts do not redraw per cell.
    function stageTile(cell,terrain){
      const k=Core.chunkKey(cell.x,cell.y),i=(cell.y%32)*32+cell.x%32,base=Core.TYPES[model.tiles[cell.y*1000+cell.x]];
      if(!updates.has(k))updates.set(k,{...(patches[k]?.tiles||{})});
      const tiles=updates.get(k);
      if(terrain==='restore'||terrain===base)delete tiles[i];else tiles[i]={terrain};
    }
    stageTile(p,type);
    const stagedTerrain=(x,y)=>{
      if(!Core.inside(x,y))return 'rock';
      const k=Core.chunkKey(x,y),i=(y%32)*32+x%32,tiles=updates.get(k);
      return tiles?tiles[i]?.terrain||Core.TYPES[model.tiles[y*1000+x]]:world.terrain(x,y);
    };
    let filled=0;
    if(type==='road'&&previously!=='road'){
      const interior=world.enclosedRoadCells(p,{terrainAt:stagedTerrain});
      for(const cell of interior){
        const k=Core.chunkKey(cell.x,cell.y),i=(cell.y%32)*32+cell.x%32;
        // Keep waterways, bridge surfaces, existing structures, and manually
        // painted non-road terrain instead of erasing garden landmarks.
        if(Core.sectBlocked(cell.x,cell.y)||world.objectAt(cell.x,cell.y)||protectedTerrain.has(world.terrain(cell.x,cell.y))||
          patches[k]?.tiles?.[i]&&patches[k].tiles[i].terrain!=='road')continue;
        if(stagedTerrain(cell.x,cell.y)==='road')continue;
        stageTile(cell,'road');filled++;
      }
    }
    const changes={};
    for(const[k,tiles]of updates){
      const revision=(revisions[k]||0)+1,data={revision,tiles};revisions[k]=revision;changes[k]=data;
      if(Object.keys(tiles).length)patches[k]=data;else delete patches[k];
    }
    world.installPatches(changes);updateStorage();inspect(p);
    status(filled?'道路已封閉，自動填滿 '+filled+' 格（僅保存在本機模擬中）':'此格變更保存在本機模擬中');draw();
  }
  function zoom(factor,point={screenX:width/2,screenY:height/2}){if(!model)return;const x=(point.screenX-width/2)/view.scale+view.x,y=(point.screenY-height/2)/view.scale+view.y;view.scale=Math.max(Math.min(width/1000,height/1000)*.6,Math.min(40,view.scale*factor));view.x=x-(point.screenX-width/2)/view.scale;view.y=y-(point.screenY-height/2)/view.scale;view.fit=false;draw();}
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function showComparison(results){
    $('compare-dialog').querySelector('p').textContent='選擇一張地圖，載入該種子繼續查看。';
    $('compare-grid').replaceChildren(...results.map(result=>{const button=document.createElement('button');button.className='compare-card';button.type='button';const preview=document.createElement('canvas');preview.width=200;preview.height=200;const c=preview.getContext('2d'),data=c.createImageData(200,200);for(let i=0;i<result.mini.length;i++){const rgb=palette[result.mini[i]],j=i*4;data.data[j]=rgb[0];data.data[j+1]=rgb[1];data.data[j+2]=rgb[2];data.data[j+3]=255;}c.putImageData(data,0,0);const name=document.createElement('strong');name.textContent=result.world.seed;const stats=document.createElement('small'),s=result.stats;stats.textContent='陸地 '+(s.landRatio*100).toFixed(1)+'% · 秘境 '+(s.kinds.realm||0)+'\n結構 '+(s.kinds.structure||0)+' · 妖獸 '+(s.kinds.monster||0)+'\n礦脈 '+s.veins+' · 主要陸塊 '+s.islands;stats.style.whiteSpace='pre-line';button.append(preview,name,stats);button.onclick=()=>{$('compare-dialog').close();generate(result.world.seed);};return button;}));
  }
  $('seed-form').onsubmit=event=>{event.preventDefault();generate();};
  $('random').onclick=()=>{const seed='青雲-'+crypto.getRandomValues(new Uint32Array(1))[0].toString(36);$('seed').value=seed;generate(seed);};
  $('compare').onclick=()=>{const seeds=[...new Set([$('seed').value,'海上有仙山','竹影與星河','314159','qingyun-2026'])].slice(0,4);$('compare-grid').textContent='正在生成四個世界…';$('compare-dialog').showModal();launch('compare',{seeds});};
  $('close-compare').onclick=()=>{$('compare-dialog').close();if(worker){worker.terminate();worker=null;task++;setBusy(false);status('已停止比較');}};
  $('layer').onchange=()=>{overview=null;draw();};$('show-changes').onchange=()=>{if(selected)inspect(selected);draw();};document.querySelectorAll('[data-marker]').forEach(n=>n.onchange=draw);
  $('zoom-in').onclick=()=>zoom(1.8);$('zoom-out').onclick=()=>zoom(1/1.8);$('fit').onclick=fitMap;$('spawn').onclick=()=>{if(!model)return;view={x:Core.SPAWN.x,y:Core.SPAWN.y,scale:8,fit:false};inspect(Core.SPAWN);draw();};
  $('export-json').onclick=()=>{if(!world)return;download(new Blob([JSON.stringify({format:'qingyun-world-delta-v1',world:world.descriptor,patches},null,2)],{type:'application/json'}),'qingyun-world-'+world.descriptor.worldId+'.json');};
  $('import-json').onclick=()=>$('import-file').click();$('import-file').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>16*1024*1024)throw Error('檔案超過 16 MB');const data=JSON.parse(await file.text());if(data.format!=='qingyun-world-delta-v1')throw Error('變更檔格式不相容');const d=Core.validateDescriptor(data.world),check=Core.createWorld(d);check.installPatches(data.patches||{});generate(d.seed,data.patches||{});}catch(error){status('匯入失敗：'+error.message);}event.target.value='';};
  $('export-png').onclick=()=>{if(!model)return;makeOverview();const out=document.createElement('canvas');out.width=1000;out.height=1000;const c=out.getContext('2d');c.drawImage(overview,0,0);paintDeltas(c);out.toBlob(blob=>download(blob,'qingyun-world-'+world.descriptor.worldId+'.png'));};
  canvas.onpointerdown=event=>{canvas.setPointerCapture(event.pointerId);const p=worldPoint(event);drag={x:p.screenX,y:p.screenY,lastX:p.screenX,lastY:p.screenY,moved:false};};
  canvas.onpointermove=event=>{if(!drag)return;const p=worldPoint(event);if(Math.hypot(p.screenX-drag.x,p.screenY-drag.y)>4)drag.moved=true;if(drag.moved){view.x-=(p.screenX-drag.lastX)/view.scale;view.y-=(p.screenY-drag.lastY)/view.scale;view.x=Math.max(-100,Math.min(1100,view.x));view.y=Math.max(-100,Math.min(1100,view.y));view.fit=false;draw();}drag.lastX=p.screenX;drag.lastY=p.screenY;};
  canvas.onpointerup=event=>{if(drag&&!drag.moved){const p=worldPoint(event),tile={x:Math.floor(p.x),y:Math.floor(p.y)};if($('paint').value==='inspect')inspect(tile);else changeTile(tile,$('paint').value);}drag=null;};canvas.onpointercancel=()=>{drag=null;};
  canvas.addEventListener('wheel',event=>{event.preventDefault();zoom(event.deltaY<0?1.25:.8,worldPoint(event));},{passive:false});
  canvas.onkeydown=event=>{if(!model)return;const dirs={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};if(dirs[event.key]){event.preventDefault();const[dx,dy]=dirs[event.key];view.x+=dx*32;view.y+=dy*32;view.fit=false;draw();}if(event.key==='+'||event.key==='=')zoom(1.8);if(event.key==='-')zoom(1/1.8);};
  for(const t of ['ocean','water','beach','grass','forest','mountain','desert','snow','swamp','rock']){const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.background=Core.COLORS[t];item.append(swatch,document.createTextNode(Core.LABELS[t]));$('legend').append(item);}
  window.WorldSeedSimulator=Object.freeze({generate,getState:()=>({world:world?.descriptor,stats:model?.stats,patches:structuredClone(patches),selected,view:{...view},busy:!!worker}),inspect,changeTile});
  new ResizeObserver(resize).observe(canvas);window.addEventListener('resize',fitApp);fitApp();
  const requested=new URLSearchParams(location.search).get('seed');generate(requested||Core.DEFAULT_SEED);
})();

/* Pure generation/analysis: no network, account, game save or database. */
(function(){
  'use strict';
  const Core=typeof module==='object'&&module.exports?require('./world-core.js'):self.QAGridWorld;
  function generate(seed,progress=()=>{}){
    const started=performance.now(),world=Core.createWorld(seed),size=world.SIZE,tiles=new Uint8Array(size*size),objects=[];
    for(let cy=0;cy<world.CHUNK_COUNT;cy++){
      for(let cx=0;cx<world.CHUNK_COUNT;cx++){
        const chunk=world.chunk(cx,cy),w=Math.min(32,size-cx*32),h=Math.min(32,size-cy*32);
        for(let y=0;y<h;y++)tiles.set(chunk.tiles.subarray(y*32,y*32+w),(cy*32+y)*size+cx*32);
        objects.push(...chunk.objects);
      }
      if(cy%4===0)progress(Math.round((cy+1)/world.CHUNK_COUNT*75));
    }
    const counts=Object.fromEntries(world.TYPES.map(t=>[t,0])),tiers=Array(8).fill(0),kinds={},veins=new Set();let fingerprint=2166136261;
    const blocked=new Set(['water','ocean','rock','lava','broken-bridge','sealed'].map(t=>world.TYPES.indexOf(t))),visited=new Uint8Array(size*size),queue=new Uint32Array(size*size);
    for(const code of tiles){counts[world.TYPES[code]]++;fingerprint=Math.imul(fingerprint^code,16777619);}
    for(const o of objects){kinds[o.kind]=(kinds[o.kind]||0)+1;if(o.kind==='monster')tiers[o.tier||0]++;if(o.veinId)veins.add(o.veinId);}
    let islands=0,largest=0,spawnConnected=0,walkable=0;
    for(let i=0;i<tiles.length;i++){
      if(visited[i]||blocked.has(tiles[i]))continue;let head=0,tail=1,spawn=false;queue[0]=i;visited[i]=1;
      while(head<tail){const n=queue[head++],x=n%size,y=(n/size)|0;if(x===world.SPAWN.x&&y===world.SPAWN.y)spawn=true;
        for(const next of [x? n-1:-1,x<size-1?n+1:-1,y?n-size:-1,y<size-1?n+size:-1])if(next>=0&&!visited[next]&&!blocked.has(tiles[next])){visited[next]=1;queue[tail++]=next;}
      }
      if(tail>=16)islands++;if(tail>largest)largest=tail;if(spawn)spawnConnected=tail;walkable+=tail;
    }
    progress(95);
    return {world:world.descriptor,tiles,objects,stats:{counts,tiers,kinds,veins:veins.size,islands,largestLand:largest,spawnConnected,walkable,
      landRatio:1-(counts.water+counts.ocean)/(size*size),fingerprint:(fingerprint>>>0).toString(16).padStart(8,'0'),milliseconds:Math.round(performance.now()-started),chunks:world.CHUNK_COUNT**2}};
  }
  if(typeof module==='object'&&module.exports){module.exports={generate};return;}
  self.onmessage=event=>{
    const {id,kind,seeds,seed}=event.data||{};
    try{
      if(kind==='compare'){
        const results=[];for(let i=0;i<seeds.length;i++){
          const result=generate(seeds[i],pct=>self.postMessage({type:'progress',id,pct:Math.round((i+pct/100)/seeds.length*100)}));
          const mini=new Uint8Array(200*200);for(let y=0;y<200;y++)for(let x=0;x<200;x++)mini[y*200+x]=result.tiles[y*5*1000+x*5];
          results.push({world:result.world,stats:result.stats,mini});
        }
        self.postMessage({type:'comparison',id,results},results.map(r=>r.mini.buffer));
      }else{
        const result=generate(seed,pct=>self.postMessage({type:'progress',id,pct}));self.postMessage({type:'world',id,...result},[result.tiles.buffer]);
      }
    }catch(error){self.postMessage({type:'error',id,message:error.message});}
  };
})();

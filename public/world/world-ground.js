/* Compose the AI textures through neighbour masks; cache the resulting small tiles. */
(function(root){
  'use strict';
  // Each 128px material is an edge-matched lossless texture. Read all of its
  // pixels at every zoom level: a 32px crop stretched on a HiDPI screen looked hazy.
  function textureFrame(Art,t,x=0,y=0){
    const cell=Math.max(0,Art.terrain.indexOf(t));
    let variant=Math.imul(x|0,73856093)^Math.imul(y|0,19349663)^Math.imul(cell+1,83492791);
    variant=Math.imul(variant^(variant>>>16),0x7feb352d);
    variant=Math.imul(variant^(variant>>>15),0x846ca68b);
    variant^=variant>>>16;
    return {sx:cell%4*128,sy:Math.floor(cell/4)*128,sw:128,sh:128,flipX:!!(variant&1),flipY:!!(variant&2)};
  }
  function roadAlpha(mask,u,v){
    // A fully surrounded road cell is solid paving, not a narrow crossroads.
    // Without this the courtyard underlay shows through as a square checkerboard
    // even after the enclosed cells have correctly become road terrain.
    if((mask&15)===15)return 1;
    let distance=Math.hypot(u-.5,v-.5);
    if(mask&1)distance=Math.min(distance,Math.hypot(u-.5,v-Math.min(.5,v)));
    if(mask&2)distance=Math.min(distance,Math.hypot(u-Math.max(.5,u),v-.5));
    if(mask&4)distance=Math.min(distance,Math.hypot(u-.5,v-Math.max(.5,v)));
    if(mask&8)distance=Math.min(distance,Math.hypot(u-Math.min(.5,u),v-.5));
    return Math.max(0,Math.min(1,(.31-distance)/.1));
  }
  function transitionAlpha(direction,u,v){
    const distances=[v,1-u,1-v,u,Math.hypot(u,v),Math.hypot(1-u,v),Math.hypot(1-u,1-v),Math.hypot(u,1-v)];
    return Math.max(0,1-distances[direction]/.12)*.5;
  }
  function create(Art,canvasFactory=()=>document.createElement('canvas')){
    const tiles=new Map(),masks=new Map(),materials=new Map();let SIZE=80;
    function setScale(scale){
      if(!Number.isFinite(scale)||scale<=0)return;
      const size=Math.max(26,Math.min(144,Math.round(40*scale)));
      if(size===SIZE)return;SIZE=size;tiles.clear();masks.clear();
    }
    const canvas=()=>{const c=canvasFactory();c.width=SIZE;c.height=SIZE;return c;};
    function mask(key,alpha){
      if(masks.has(key))return masks.get(key);
      const target=canvas(),c=target.getContext('2d'),data=c.createImageData(SIZE,SIZE);
      for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
        const i=(y*SIZE+x)*4;data.data[i]=data.data[i+1]=data.data[i+2]=255;data.data[i+3]=Math.round(alpha((x+.5)/SIZE,(y+.5)/SIZE)*255);
      }
      c.putImageData(data,0,0);masks.set(key,target);return target;
    }
    function compose(info,images){
      // Many cells share a topology key, while their texture flips depend on
      // complete coordinates. Include every visible material's actual flips.
      const active=info.terrain==='road'
        ?[(info.mask&15)===15?'road':info.underlay,'road']
        :['bridge','broken-bridge'].includes(info.terrain)
          ?[info.neighbours.includes('ocean')?'ocean':'water']
          :[info.terrain,...info.neighbours.filter(t=>t!==info.terrain&&!['road','bridge','broken-bridge','sealed'].includes(t))];
      const variants=[...new Set(active)].map(t=>{
        const frame=textureFrame(Art,t,info.x,info.y);
        return t+':'+Number(frame.flipX)+Number(frame.flipY);
      }).join('|');
      const key=info.key+'|'+variants;
      if(tiles.has(key))return tiles.get(key);
      const atlas=images['ground-atlas'];if(!atlas?.complete||!atlas.naturalWidth)return null;
      const target=canvas(),c=target.getContext('2d');
      const texture=(context,t)=>{
        const s=textureFrame(Art,t,info.x,info.y);context.save();
        // Lossless atlas + edge-locked cells: copy the entire 128px source
        // without cropping its border or sampling into the neighbouring cell.
        if(!materials.has(t)){
          const cell=canvas();cell.width=cell.height=128;
          cell.getContext('2d').drawImage(atlas,s.sx,s.sy,128,128,0,0,128,128);materials.set(t,cell);
        }
        context.translate(s.flipX?SIZE:0,s.flipY?SIZE:0);context.scale(s.flipX?-1:1,s.flipY?-1:1);
        context.drawImage(materials.get(t),0,0,128,128,0,0,SIZE,SIZE);context.restore();
      };
      const overlay=(t,m)=>{
        const layer=canvas(),context=layer.getContext('2d');texture(context,t);context.globalCompositeOperation='destination-in';context.drawImage(m,0,0);c.drawImage(layer,0,0);
      };
      if(info.terrain==='road'){
        if((info.mask&15)===15){
          // Adjacent road tiles own all four edges, so paint the complete
          // tile. This makes a newly enclosed court genuinely seamless.
          texture(c,'road');
        }else{
          texture(c,info.underlay);
          overlay('road',mask('road:'+info.mask,(u,v)=>roadAlpha(info.mask,u,v)));
        }
      }else if(['bridge','broken-bridge'].includes(info.terrain)){
        texture(c,info.neighbours.includes('ocean')?'ocean':'water');
        const s=Art.directional('bridge',info.bridgeDirection),img=images[s.image];
        if(!img?.complete||!img.naturalWidth)return null;
        if(info.terrain==='broken-bridge'){
          c.beginPath();if(info.bridgeDirection==='east'){c.rect(0,0,SIZE*.39,SIZE);c.rect(SIZE*.61,0,SIZE*.39,SIZE);}else{c.rect(0,0,SIZE,SIZE*.39);c.rect(0,SIZE*.61,SIZE,SIZE*.39);}c.clip();
        }
        c.drawImage(img,s.sx,s.sy,s.sw,s.sh,-4,-4,SIZE+8,SIZE+8);
      }else{
        texture(c,info.terrain);
        info.neighbours.forEach((t,i)=>{
          if(t!==info.terrain&&!['road','bridge','broken-bridge','sealed'].includes(t))overlay(t,mask('edge:'+i,(u,v)=>transitionAlpha(i,u,v)));
        });
      }
      // A zoomed-out garden exposes many shoreline/junction variants at once.
      // Small rasters can retain more variants without exceeding the existing
      // high-DPI memory budget (1024 x 52px RGBA is about 11 MB).
      tiles.set(key,target);if(tiles.size>(SIZE<=52?1024:512))tiles.delete(tiles.keys().next().value);return target;
    }
    return Object.freeze({compose,setScale,get tileSize(){return SIZE;},get maxCachedTiles(){return SIZE<=52?1024:512;},get cachedTiles(){return tiles.size;}});
  }
  const api=Object.freeze({create,roadAlpha,transitionAlpha,textureFrame});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QAGridWorldGround=api;
})(globalThis);

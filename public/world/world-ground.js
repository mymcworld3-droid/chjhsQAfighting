/* Compose the AI textures through neighbour masks; cache the resulting small tiles. */
(function(root){
  'use strict';
  const SIZE=80,SPAN=4;
  function textureFrame(Art,t,x=0,y=0){
    const cell=Math.max(0,Art.terrain.indexOf(t)),step=128/SPAN;
    const phase=n=>((n%(SPAN*2))+SPAN*2)%(SPAN*2),px=phase(x),py=phase(y);
    const flipX=px>=SPAN,flipY=py>=SPAN;
    return {sx:cell%4*128+(flipX?SPAN*2-1-px:px)*step,sy:Math.floor(cell/4)*128+(flipY?SPAN*2-1-py:py)*step,sw:step,sh:step,flipX,flipY};
  }
  function roadAlpha(mask,u,v){
    let distance=Math.hypot(u-.5,v-.5);
    if(mask&1)distance=Math.min(distance,Math.hypot(u-.5,v-Math.min(.5,v)));
    if(mask&2)distance=Math.min(distance,Math.hypot(u-Math.max(.5,u),v-.5));
    if(mask&4)distance=Math.min(distance,Math.hypot(u-.5,v-Math.max(.5,v)));
    if(mask&8)distance=Math.min(distance,Math.hypot(u-Math.min(.5,u),v-.5));
    return Math.max(0,Math.min(1,(.31-distance)/.1));
  }
  function transitionAlpha(direction,u,v){
    const distances=[v,1-u,1-v,u,Math.hypot(u,v),Math.hypot(1-u,v),Math.hypot(1-u,1-v),Math.hypot(u,1-v)];
    return Math.max(0,1-distances[direction]/.24)*.5;
  }
  function create(Art,canvasFactory=()=>document.createElement('canvas')){
    const tiles=new Map(),masks=new Map(),materials=new Map();
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
      if(tiles.has(info.key))return tiles.get(info.key);
      const atlas=images['ground-atlas'];if(!atlas?.complete||!atlas.naturalWidth)return null;
      const target=canvas(),c=target.getContext('2d');
      const texture=(context,t)=>{
        const s=textureFrame(Art,t,info.x,info.y);context.save();
        // Isolate atlas cells before enlarging, so filtering cannot pick up another material.
        if(!materials.has(t)){
          const cell=canvas();cell.width=cell.height=128;
          // Ignore the two-pixel rim affected by WebP chroma subsampling at atlas joins.
          cell.getContext('2d').drawImage(atlas,Math.floor(s.sx/128)*128+2,Math.floor(s.sy/128)*128+2,124,124,0,0,128,128);materials.set(t,cell);
        }
        context.translate(s.flipX?SIZE:0,s.flipY?SIZE:0);context.scale(s.flipX?-1:1,s.flipY?-1:1);
        context.drawImage(materials.get(t),s.sx%128,s.sy%128,s.sw,s.sh,0,0,SIZE,SIZE);context.restore();
      };
      const overlay=(t,m)=>{
        const layer=canvas(),context=layer.getContext('2d');texture(context,t);context.globalCompositeOperation='destination-in';context.drawImage(m,0,0);c.drawImage(layer,0,0);
      };
      if(info.terrain==='road'){
        texture(c,info.underlay);overlay('road',mask('road:'+info.mask,(u,v)=>roadAlpha(info.mask,u,v)));
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
      tiles.set(info.key,target);if(tiles.size>512)tiles.delete(tiles.keys().next().value);return target;
    }
    return Object.freeze({compose,get cachedTiles(){return tiles.size;}});
  }
  const api=Object.freeze({create,roadAlpha,transitionAlpha,textureFrame});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QAGridWorldGround=api;
})(globalThis);

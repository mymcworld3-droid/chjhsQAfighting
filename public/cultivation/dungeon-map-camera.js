// Presentation-only camera for deterministic cooperative dungeon blueprints.
// No movement, collision, combat or server state is modified by this module.
const MIN_ZOOM=1;
const MAX_ZOOM=6;
const MARGIN=20;
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const finite=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const validMap=map=>Number.isInteger(map?.width)&&Number.isInteger(map?.height)&&
  map.width>0&&map.height>0;
const viewport=(width,height)=>({width:Math.max(1,finite(width,1)),
  height:Math.max(1,finite(height,1))});
export function initialCamera(){return {zoom:1,panX:0,panY:0};}
// The player is ALWAYS the exact center of the visible battlefield, even
// near the edge of an irregular map. No edge clamp may move this anchor.
// A tile has a responsive pixel size independent from the overall map size.
export function lockToPlayer(point,map,width,height){
  if(!validMap(map))throw new TypeError('副本地圖尺寸無效');
  return {locked:true,
    target:{x:clamp(finite(point?.x),0,map.width-1),
      y:clamp(finite(point?.y),0,map.height-1)}};
}
export function geometry(camera,map,width,height){
  if(!validMap(map))throw new TypeError('副本地圖尺寸無效');
  const view=viewport(width,height);
  if(camera?.locked===true){
    const target=lockToPlayer(camera.target,map,width,height).target;
    const size=clamp(Math.min(view.width,view.height)/9,22,56);
    const ox=view.width/2-(target.x+.5)*size;
    const oy=view.height/2-(target.y+.5)*size;
    return {width:view.width,height:view.height,zoom:1,cell:size,
      ox,oy,panX:0,panY:0,totalX:size*map.width,
      totalY:size*map.height,locked:true,target};
  }
  const cell=Math.max(.1,Math.min(
    Math.max(1,view.width-2*MARGIN)/map.width,
    Math.max(1,view.height-2*MARGIN)/map.height));
  const zoom=clamp(finite(camera?.zoom,1),MIN_ZOOM,MAX_ZOOM);
  const size=cell*zoom;
  const totalX=size*map.width,totalY=size*map.height;
  const centerX=(view.width-totalX)/2,centerY=(view.height-totalY)/2;
  const origin=(center,total,span,pan)=>{
    if(total<=span-2*MARGIN)return center;
    return clamp(center+finite(pan),span-MARGIN-total,MARGIN);
  };
  const ox=origin(centerX,totalX,view.width,camera?.panX);
  const oy=origin(centerY,totalY,view.height,camera?.panY);
  return {width:view.width,height:view.height,zoom,cell:size,ox,oy,
    panX:ox-centerX,panY:oy-centerY,totalX,totalY};
}
export function normalized(camera,map,width,height){
  if(camera?.locked===true)
    return lockToPlayer(camera.target,map,width,height);
  const g=geometry(camera,map,width,height);
  return {zoom:g.zoom,panX:g.panX,panY:g.panY};
}
export function pan(camera,dx,dy,map,width,height){
  if(camera?.locked===true)return lockToPlayer(camera.target,map,width,height);
  return normalized({zoom:camera?.zoom??1,
    panX:finite(camera?.panX)+finite(dx),
    panY:finite(camera?.panY)+finite(dy)},map,width,height);
}
export function zoomAt(camera,zoom,pixelX,pixelY,map,width,height){
  if(camera?.locked===true)return lockToPlayer(camera.target,map,width,height);
  const old=geometry(camera,map,width,height);
  const anchorX=finite(pixelX,old.width/2),anchorY=finite(pixelY,old.height/2);
  const worldX=(anchorX-old.ox)/old.cell,worldY=(anchorY-old.oy)/old.cell;
  const tentative=geometry({zoom,panX:0,panY:0},map,width,height);
  return normalized({zoom:tentative.zoom,
    panX:anchorX-worldX*tentative.cell-(tentative.width-tentative.totalX)/2,
    panY:anchorY-worldY*tentative.cell-(tentative.height-tentative.totalY)/2
  },map,width,height);
}
export function focusOn(camera,point,map,width,height){
  if(camera?.locked===true)return lockToPlayer(point,map,width,height);
  const g=geometry(camera,map,width,height);
  const x=clamp(finite(point?.x),0,map.width-1)+.5;
  const y=clamp(finite(point?.y),0,map.height-1)+.5;
  return normalized({zoom:g.zoom,
    panX:g.width/2-x*g.cell-(g.width-g.totalX)/2,
    panY:g.height/2-y*g.cell-(g.height-g.totalY)/2
  },map,width,height);
}
export function fitMap(){return initialCamera();}
export function mapPoint(camera,p,map,width,height){
  const g=geometry(camera,map,width,height);
  return {x:g.ox+(finite(p?.x)+.5)*g.cell,
    y:g.oy+(finite(p?.y)+.5)*g.cell};
}
export function screenTile(camera,x,y,map,width,height){
  const g=geometry(camera,map,width,height);
  const tile={x:Math.floor((x-g.ox)/g.cell),y:Math.floor((y-g.oy)/g.cell)};
  return tile.x<0||tile.y<0||tile.x>=map.width||tile.y>=map.height?null:tile;
}
export function visibleTiles(camera,map,width,height){
  const g=geometry(camera,map,width,height);
  const x0=clamp(Math.floor(-g.ox/g.cell)-1,0,map.width-1);
  const y0=clamp(Math.floor(-g.oy/g.cell)-1,0,map.height-1);
  const x1=clamp(Math.ceil((g.width-g.ox)/g.cell)+1,0,map.width-1);
  const y1=clamp(Math.ceil((g.height-g.oy)/g.cell)+1,0,map.height-1);
  return {x0,y0,x1,y1};
}
export function resizePreservingCenter(camera,map,fromWidth,fromHeight,toWidth,toHeight){
  if(camera?.locked===true)return lockToPlayer(camera.target,map,toWidth,toHeight);
  const old=geometry(camera,map,fromWidth,fromHeight);
  const point={x:(old.width/2-old.ox)/old.cell,
    y:(old.height/2-old.oy)/old.cell};
  const fresh=geometry({zoom:old.zoom,panX:0,panY:0},map,toWidth,toHeight);
  return normalized({zoom:old.zoom,
    panX:fresh.width/2-point.x*fresh.cell-(fresh.width-fresh.totalX)/2,
    panY:fresh.height/2-point.y*fresh.cell-(fresh.height-fresh.totalY)/2
  },map,toWidth,toHeight);
}
export const LIMITS=Object.freeze({MIN_ZOOM,MAX_ZOOM,MARGIN});

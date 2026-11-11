/* Presentation-only battlefield camera. All game rules continue to use
   server-authoritative integer map coordinates. Also runnable in Node tests. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QATacticalCamera=api;
})(globalThis,()=>{
  'use strict';
  const MIN_ZOOM=.75,MAX_ZOOM=3.2;
  const clamp=(value,low,high)=>Math.min(high,Math.max(low,value));
  const finite=(value,otherwise=0)=>Number.isFinite(Number(value))?Number(value):otherwise;
  const create=()=>({zoom:1,panX:0,panY:0});
  function geometry(camera,w,h,view){
    const width=Math.max(1,finite(w,1)),height=Math.max(1,finite(h,1));
    const vx=Math.max(1,finite(view?.width,1)),vy=Math.max(1,finite(view?.height,1));
    const zoom=clamp(finite(camera?.zoom,1),MIN_ZOOM,MAX_ZOOM);
    const cell=Math.max(1,Math.min((width-20)/vx,(height-24)/vy))*zoom;
    const centerX=Math.round((width-cell*vx)/2)-finite(view?.x)*cell;
    const centerY=Math.round((height-cell*vy)/2)-finite(view?.y)*cell;
    // Keep map in view even at maximum zoom, while allowing a little drag
    // at the default fully fitted zoom.
    const limitX=Math.max(24,(cell*vx-width)/2+24);
    const limitY=Math.max(24,(cell*vy-height)/2+24);
    const panX=clamp(finite(camera?.panX),-limitX,limitX);
    const panY=clamp(finite(camera?.panY),-limitY,limitY);
    return {cell,ox:centerX+panX,oy:centerY+panY,width,height,zoom,panX,panY,limitX,limitY};
  }
  function normalize(camera,w,h,view){
    const g=geometry(camera,w,h,view);
    return {zoom:g.zoom,panX:g.panX,panY:g.panY};
  }
  function pan(camera,dx,dy,w,h,view){
    return normalize({...camera,panX:finite(camera?.panX)+finite(dx),
      panY:finite(camera?.panY)+finite(dy)},w,h,view);
  }
  function zoomAt(camera,newZoom,x,y,w,h,view){
    const before=geometry(camera,w,h,view);
    const worldX=(finite(x,w/2)-before.ox)/before.cell;
    const worldY=(finite(y,h/2)-before.oy)/before.cell;
    const next=geometry({zoom:clamp(finite(newZoom,1),MIN_ZOOM,MAX_ZOOM)},w,h,view);
    return normalize({zoom:next.zoom,
      panX:finite(x,w/2)-worldX*next.cell-next.ox,
      panY:finite(y,h/2)-worldY*next.cell-next.oy},w,h,view);
  }
  function tileAt(camera,x,y,w,h,view){
    const g=geometry(camera,w,h,view);
    return {x:Math.floor((x-g.ox)/g.cell),y:Math.floor((y-g.oy)/g.cell)};
  }
  return Object.freeze({MIN_ZOOM,MAX_ZOOM,create,geometry,normalize,pan,zoomAt,tileAt});
});

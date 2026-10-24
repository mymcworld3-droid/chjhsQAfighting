/* AI bitmap catalogue. Coordinates and interactions remain in world-core. */
(function(root){
  'use strict';
  const base='/assets/world-map/ai/';
  const buildings=['meditation','forge','contract','vault','rank','duel','raid','watchtower','shrine','ruins','camp','realm-spring','realm-array','realm-sword','realm-star'];
  const directions=Object.freeze(['north','east','south','west']);
  const sources=Object.freeze(Object.fromEntries([...buildings,'ground-atlas','props-atlas','creatures-atlas',...directions.map(d=>'scenery-'+d+'-atlas')].map(id=>[id,base+id+'.webp'])));
  const sceneryProps=Object.freeze(['fence','gate','wall','broken-wall','pillar','rubble','bridge','supplies']);
  const props=['bamboo','tree','rock','volcano','flowers','shrub','reeds','herb','ore','chest','lantern','wall-h','wall-v','gate','garden','boat','meteor','shield','altar','sealed'];
  const creatures=['靈狼','玄甲山豬','竹林靈狼','青竹蛇','山魈','妖藤','沙蠍','荒漠蜥蜴','巖甲獸','石靈','赤焰獸','熔岩蜥蜴','霜羽鷹','雪狼','毒蟾','澤蛇','潮汐蟹','海岸靈龜','古陣守衛','靈獸'];
  const terrain=['grass','road','courtyard','mountain','water','bridge','broken-bridge','bamboo','rock','sealed','ocean','beach','forest','desert','snow','swamp','stone','volcano','lava','plaza'];
  const sheet=(image,cell,columns,w=40,h=w)=>({image,sx:cell%columns*128,sy:Math.floor(cell/columns)*128,sw:128,sh:128,w,h,anchor:.87});
  const prop=(name,w=40,h=w)=>sheet('props-atlas',Math.max(0,props.indexOf(name)),4,w,h);
  function directional(name,direction='south',size=40){
    const sprite=sheet('scenery-'+(directions.includes(direction)?direction:'south')+'-atlas',Math.max(0,sceneryProps.indexOf(name)),4,size,size);
    sprite.anchor=['fence','wall','broken-wall','bridge','rubble'].includes(name)?.55:name==='gate'?.8:.87;return sprite;
  }
  const scenery=p=>p.direction?directional(p.prop,p.direction,p.size):prop(p.prop,p.size);
  function monster(o){
    if((o.name||'').includes('大師姐'))return {image:'female',sx:0,sy:0,sw:112,sh:112,w:48,h:48,anchor:.93};
    const name=/秘境|遺窟|洞天|石窟/.test(o.name||'')?'古陣守衛':o.species||o.name||'',index=creatures.findIndex(s=>name===s||name.endsWith('・'+s));
    return sheet('creatures-atlas',index<0?19:index,5,44,44);
  }
  function object(o){
    if(o.kind==='monster')return monster(o);
    let id=o.kind==='building'?o.id:o.kind==='structure'?o.subtype:null;
    if(o.kind==='realm')id=['靈泉洞天','古陣秘境','藏劍遺窟','星隕石窟'].includes(o.name)?['realm-spring','realm-array','realm-sword','realm-star'][['靈泉洞天','古陣秘境','藏劍遺窟','星隕石窟'].indexOf(o.name)]:'realm-array';
    if(buildings.includes(id)){const size=id==='watchtower'?80:id==='duel'?76:72;return{image:id,sx:0,sy:0,sw:256,sh:256,w:size,h:size,anchor:.89};}
    if(o.kind==='npc')return {image:'female',sx:0,sy:0,sw:112,sh:112,w:44,h:44,anchor:.93};
    if(o.kind==='chest')return prop('chest',38);
    if(o.kind==='gather')return prop(o.veinId||/iron/.test(o.material||'')?'ore':'herb',o.veinId?38:34);
    return prop(o.id==='bridge'?'altar':'sealed',44);
  }
  function bounds(o,sprite=object(o)){
    return{x:(o.x+.5)*40-sprite.w/2,y:(o.y+.5)*40-sprite.h*sprite.anchor,w:sprite.w,h:sprite.h};
  }
  const api=Object.freeze({sources,directions,sceneryProps,buildings:Object.freeze(buildings),props:Object.freeze(props),creatures:Object.freeze(creatures),terrain:Object.freeze(terrain),sheet,prop,directional,scenery,monster,object,bounds});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QAGridWorldArt=api;
})(globalThis);

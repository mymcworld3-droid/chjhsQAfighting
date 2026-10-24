/* AI bitmap catalogue. Coordinates and interactions remain in world-core. */
(function(root){
  'use strict';
  const base='/assets/world-map/ai/';
  const buildings=['meditation','forge','contract','vault','rank','duel','raid','watchtower','shrine','ruins','camp','realm-spring','realm-array','realm-sword','realm-star'];
  const directions=Object.freeze(['north','east','south','west']);
  const sources=Object.freeze(Object.fromEntries([...buildings,'ground-atlas','props-atlas','creatures-atlas',...directions.map(d=>'scenery-'+d+'-atlas'),'ambient-atlas','boats-atlas','creatures-north','creatures-east','creatures-west','fence-connectors-atlas','wall-connectors-atlas','sect-gates','bamboo-upright-atlas'].map(id=>[id,base+id+'.webp'])));
  const sceneryProps=Object.freeze(['fence','gate','wall','broken-wall','pillar','rubble','bridge','supplies']);
  const props=['bamboo','tree','rock','volcano','flowers','shrub','reeds','herb','ore','chest','lantern','wall-h','wall-v','gate','garden','boat','meteor','shield','altar','sealed'];
  const creatures=['靈狼','玄甲山豬','竹林靈狼','青竹蛇','山魈','妖藤','沙蠍','荒漠蜥蜴','巖甲獸','石靈','赤焰獸','熔岩蜥蜴','霜羽鷹','雪狼','毒蟾','澤蛇','潮汐蟹','海岸靈龜','古陣守衛','靈獸'];
  const terrain=['grass','road','courtyard','mountain','water','bridge','broken-bridge','bamboo','rock','sealed','ocean','beach','forest','desert','snow','swamp','stone','volcano','lava','plaza'];
  const sheet=(image,cell,columns,w=40,h=w)=>({image,sx:cell%columns*128,sy:Math.floor(cell/columns)*128,sw:128,sh:128,w,h,anchor:.87});
  const prop=(name,w=40,h=w)=>sheet('props-atlas',Math.max(0,props.indexOf(name)),4,w,h);
  const ambientProps=Object.freeze(['rubble','blocks','broken-wall','logs','crates','sacks','fire','weapons','bamboo-0','bamboo-1','bamboo-2','stone-0','stone-1','stone-2','scrolls','post','crystals','obelisk','banner','bonsai']);
  const ambientProp=(name,size=30)=>sheet('ambient-atlas',Math.max(0,ambientProps.indexOf(name)),4,size,size);
  const compass=d=>({N:'north',E:'east',S:'south',W:'west',up:'north',right:'east',down:'south',left:'west'}[d]||d||'south');
  function directional(name,direction='south',size=40){
    direction=compass(direction);
    // Qingyun Sect uses its own four-view, two-column cutout atlas. The
    // narrow east/west profiles are painted independently, never rotated.
    if(name==='sect-gate'){
      const index=({south:0,north:1,west:2,east:3})[direction]??0;
      return {image:'sect-gates',sx:index%2*512,sy:Math.floor(index/2)*512,sw:512,sh:512,w:118,h:118,anchor:.8};
    }
    if(name==='boat')return sheet('boats-atlas',Math.max(0,['south','north','east','west'].indexOf(direction)),4,size,size);
    if(name==='fence'||name==='wall')return sheet(name+'-connectors-atlas',1+Math.max(0,directions.indexOf(direction)),3,size,size);
    const sprite=sheet('scenery-'+(directions.includes(direction)?direction:'south')+'-atlas',Math.max(0,sceneryProps.indexOf(name)),4,size,size);
    sprite.anchor=['fence','wall','broken-wall','bridge','rubble'].includes(name)?.55:name==='gate'?.8:.87;return sprite;
  }
  function barrierParts(p){
    const wall=p.prop==='wall',image=p.prop+'-connectors-atlas',mask=(p.mask||0)&15,parts=[];
    const add=(cell,dx,dy,w,h)=>{const sprite=sheet(image,cell,3,w,h);sprite.anchor=0;parts.push({sprite,dx,dy});};
    // E/W tips overlap by one pixel at the shared cell edge; N/S also overlap
    // the projected height of the wall/rails. No end-post is baked into an arm.
    if(mask&1)add(1,0,wall?-34:-32,wall?10:7,wall?34:32);
    if(mask&8)add(4,-10,wall?-15:-14,22,wall?15:10);
    if(mask&2)add(2,10,wall?-15:-14,22,wall?15:10);
    if(mask&4)add(3,0,wall?-14:-12,wall?10:7,wall?34:32);
    const post=!wall||mask!==5&&mask!==10;
    add(post?0:5,0,wall?(post?-24:-14):-24,wall?(post?12:10):9,wall?(post?25:15):25);
    return parts;
  }
  const scenery=p=>{
    // Four generated upright bamboo cutouts. Preserve their 1:2 source aspect
    // ratio at every seeded size; each rises roughly four cells above its foot.
    if(/^bamboo-tall-[0-3]$/.test(p.prop)){
      const index=Number(p.prop.slice(-1));
      const w=p.size||84;
      return {image:'bamboo-upright-atlas',sx:index%2*384,sy:Math.floor(index/2)*768,sw:384,sh:768,w,h:w*2,anchor:.98};
    }
    return ambientProps.includes(p.prop)&&!p.direction?ambientProp(p.prop,p.size):p.direction?directional(p.prop,p.direction,p.size):prop(p.prop,p.size);
  };
  function monster(o){
    const direction=compass(o.direction);
    if((o.name||'').includes('大師姐'))return {image:'female',sx:0,sy:['south','east','west','north'].indexOf(direction)*112,sw:112,sh:112,w:48,h:48,anchor:.93};
    const name=/秘境|遺窟|洞天|石窟/.test(o.name||'')?'古陣守衛':o.species||o.name||'',index=creatures.findIndex(s=>name===s||name.endsWith('・'+s));
    return sheet(direction==='south'?'creatures-atlas':'creatures-'+direction,index<0?19:index,5,44,44);
  }
  function object(o){
    if(o.kind==='monster')return monster(o);
    let id=o.kind==='building'?o.id:o.kind==='structure'?o.subtype:null;
    if(o.kind==='realm')id=['靈泉洞天','古陣秘境','藏劍遺窟','星隕石窟'].includes(o.name)?['realm-spring','realm-array','realm-sword','realm-star'][['靈泉洞天','古陣秘境','藏劍遺窟','星隕石窟'].indexOf(o.name)]:'realm-array';
    if(buildings.includes(id)){const size=({meditation:104,forge:102,contract:100,vault:100,rank:110,duel:108,raid:116,watchtower:96,shrine:112,ruins:98,camp:92,'realm-spring':110,'realm-array':114,'realm-sword':108,'realm-star':110})[id]||100;return{image:id,sx:0,sy:0,sw:256,sh:256,w:size,h:size,anchor:.89};}
    if(o.kind==='npc')return {image:'female',sx:0,sy:['south','east','west','north'].indexOf(compass(o.direction))*112,sw:112,sh:112,w:44,h:44,anchor:.93};
    if(o.kind==='chest')return prop('chest',38);
    if(o.kind==='gather')return prop(o.veinId||/iron/.test(o.material||'')?'ore':'herb',o.veinId?38:34);
    return prop(o.id==='bridge'?'altar':'sealed',44);
  }
  function bounds(o,sprite=object(o)){
    return{x:(o.x+.5)*40-sprite.w/2,y:(o.y+.5)*40-sprite.h*sprite.anchor,w:sprite.w,h:sprite.h};
  }
  const api=Object.freeze({sources,directions,sceneryProps,ambientProps,ambientProp,compass,buildings:Object.freeze(buildings),props:Object.freeze(props),creatures:Object.freeze(creatures),terrain:Object.freeze(terrain),sheet,prop,directional,barrierParts,scenery,monster,object,bounds});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QAGridWorldArt=api;
})(globalThis);

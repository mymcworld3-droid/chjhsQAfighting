/* The browser, simulator and authority share this versioned deterministic world. */
(function(root){
  'use strict';
  const SIZE=1000,CHUNK_SIZE=32,CHUNK_COUNT=Math.ceil(SIZE/CHUNK_SIZE),STEP_MS=220;
  const GENERATOR_VERSION='qingyun-seeded-v1',DEFAULT_SEED='qingyun-2026';
  const SPAWN=Object.freeze({x:9,y:36}),DIRS=Object.freeze([[0,1],[1,0],[0,-1],[-1,0]]);
  const TYPES=Object.freeze(['grass','road','courtyard','mountain','water','bridge','broken-bridge','bamboo','rock','sealed','ocean','beach','forest','desert','snow','swamp']);
  const COLORS=Object.freeze({grass:'#719955',road:'#c4b485',courtyard:'#b2ac8e',mountain:'#829074',water:'#518f9c',bridge:'#b59464','broken-bridge':'#577e83',bamboo:'#638347',rock:'#7e887b',sealed:'#627e78',ocean:'#254c70',beach:'#d1c18b',forest:'#426c46',desert:'#b99a65',snow:'#c5d4d6',swamp:'#637963'});
  const LABELS=Object.freeze({grass:'草原',road:'道路',courtyard:'宗門',mountain:'山地',water:'淺海／湖泊',bridge:'橋樑','broken-bridge':'斷橋',bamboo:'竹林',rock:'岩壁',sealed:'封印',ocean:'深海',beach:'海岸',forest:'森林',desert:'荒漠',snow:'雪原',swamp:'濕地'});
  const TIERS=Object.freeze([
    {name:'煉氣',level:1,iron:'qi-spirit-iron',wood:'qi-spirit-wood'},
    {name:'築基',level:10,iron:'foundation-refined-iron',wood:'foundation-century-wood'},
    {name:'金丹',level:20,iron:'golden-purple-iron',wood:'golden-lightning-wood'},
    {name:'元嬰',level:30,iron:'nascent-star-iron',wood:'nascent-soul-wood'},
    {name:'化神',level:40,iron:'nascent-star-iron',wood:'nascent-soul-wood'},
    {name:'煉虛',level:50,iron:'nascent-star-iron',wood:'nascent-soul-wood'},
    {name:'合體',level:60,iron:'nascent-star-iron',wood:'nascent-soul-wood'},
    {name:'大乘',level:70,iron:'nascent-star-iron',wood:'nascent-soul-wood'}
  ].map(Object.freeze));
  const key=(x,y)=>x+','+y,index=(x,y)=>y*SIZE+x;
  const inside=(x,y)=>Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<SIZE&&y<SIZE;
  const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y),same=(a,b)=>!!a&&!!b&&a.x===b.x&&a.y===b.y;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function seedHash(value){let h=2166136261;for(const c of String(value)){h^=c.codePointAt(0);h=Math.imul(h,16777619);}return h>>>0;}
  function mix(x,y,salt){let h=(Math.imul(x|0,0x1f123bb5)^Math.imul(y|0,0x5f356495)^salt)>>>0;h=Math.imul(h^(h>>>16),0x7feb352d);h=Math.imul(h^(h>>>15),0x846ca68b);return(h^(h>>>16))>>>0;}
  function descriptor(input={}){
    if(typeof input==='string'||typeof input==='number')input={seed:String(input)};
    if(input.generatorVersion&&input.generatorVersion!==GENERATOR_VERSION)throw Error('地圖生成器版本不相容');
    if(input.size&&input.size!==SIZE||input.chunkSize&&input.chunkSize!==CHUNK_SIZE)throw Error('地圖尺寸不相容');
    const seed=String(input.seed??DEFAULT_SEED).trim().slice(0,128)||DEFAULT_SEED;
    return Object.freeze({seed,size:SIZE,chunkSize:CHUNK_SIZE,generatorVersion:GENERATOR_VERSION,worldId:GENERATOR_VERSION+'-'+seedHash(seed).toString(16).padStart(8,'0')});
  }
  const STARTER_OBJECTS = Object.freeze([
    {id:'meditation',x:5,y:31,kind:'building',name:'修煉室',icon:'修',entry:'core'},
    {id:'forge',x:13,y:32,kind:'building',name:'鍛造坊',icon:'煉',entry:'refinery'},
    {id:'contract',x:14,y:39,kind:'building',name:'契器閣',icon:'契',entry:'contract'},
    {id:'vault',x:5,y:39,kind:'building',name:'寶庫',icon:'庫',entry:'bag'},
    {id:'rank',x:4,y:35,kind:'building',name:'仙榜',icon:'榜',entry:'rank'},
    {id:'quest',x:11,y:34,kind:'npc',name:'宗門執事',icon:'任'},
    {id:'duel',x:16,y:35,kind:'building',name:'論道台',icon:'鬥',entry:'duel'},
    {id:'raid',x:17,y:31,kind:'building',name:'秘境之門',icon:'境',entry:'raid'},
    {id:'herb-a',x:12,y:26,kind:'gather',name:'青靈木',material:'qi-spirit-wood',icon:'木'},
    {id:'ore-a',x:21,y:23,kind:'gather',name:'玄鐵礦',material:'qi-spirit-iron',icon:'鐵'},
    {id:'herb-b',x:23,y:13,kind:'gather',name:'青靈木',material:'qi-spirit-wood',icon:'木'},
    {id:'ore-b',x:34,y:14,kind:'gather',name:'玄鐵礦',material:'qi-spirit-iron',icon:'鐵'},
    {id:'chest-a',x:19,y:26,kind:'chest',name:'林間遺箱',icon:'寶'},
    {id:'chest-b',x:33,y:27,kind:'chest',name:'溪畔遺箱',icon:'寶'},
    {id:'chest-array',x:39,y:4,kind:'chest',name:'古陣秘藏',icon:'寶'},
    {id:'wolf',x:18,y:22,kind:'monster',name:'竹林靈狼',icon:'狼',hp:700,atk:150},
    {id:'boar',x:22,y:18,kind:'monster',name:'玄甲山豬',icon:'獸',hp:850,atk:170},
    {id:'sister',x:20,y:29,kind:'monster',name:'大師姐・試劍',icon:'劍',hp:1600,atk:210,elite:true},
    {id:'sentinel',x:37,y:12,kind:'monster',name:'古陣守衛',icon:'衛',hp:1400,atk:200,elite:true},
    {id:'bridge',x:25,y:27,kind:'event',name:'修復青溪橋',icon:'橋'},
    {id:'array',x:39,y:8,kind:'event',name:'共破古陣',icon:'陣'}
  ].map(Object.freeze));
  const legacyHash=(x,y)=>((Math.imul(x+91,73856093)^Math.imul(y+17,19349663))>>>0);
  const STARTER_TERRAIN=(()=>{const SIZE=48,OBJECTS=STARTER_OBJECTS,hash=legacyHash,index=(x,y)=>y*48+x,inside=(x,y)=>x>=0&&y>=0&&x<48&&y<48;
  function makeTerrain() {
    const cells = Array.from({length:SIZE*SIZE},(_,i)=>{
      const x=i%SIZE,y=Math.floor(i/SIZE),h=hash(x,y);
      if(!x||!y||x===47||y===47)return 'rock';
      if(x>=26&&x<=27&&y<=33)return 'water';
      if(x>30&&y<19)return h%9===0?'rock':'mountain';
      if(y<30&&x<26)return h%7===0?'bamboo':'grass';
      return h%43===0?'rock':'grass';
    });
    const set=(x,y,t)=>{if(inside(x,y))cells[index(x,y)]=t;};
    const rect=(x,y,w,h,t)=>{for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)set(i,j,t);};
    rect(2,30,16,15,'courtyard');
    function road(a,b){let x=a.x,y=a.y;set(x,y,'road');while(x!==b.x||y!==b.y){if(x!==b.x)x+=Math.sign(b.x-x);else y+=Math.sign(b.y-y);set(x,y,'road');}}
    const waypoints=[SPAWN,{x:9,y:28},{x:18,y:28},{x:18,y:17},{x:32,y:17},{x:32,y:9},{x:42,y:9}];
    waypoints.slice(1).forEach((p,i)=>road(waypoints[i],p));
    road({x:9,y:36},{x:16,y:36});road({x:9,y:36},{x:9,y:42});
    road({x:18,y:27},{x:35,y:27});
    // The north crossing is always open; repairing the south bridge adds a shortcut.
    rect(26,17,2,1,'bridge');rect(26,27,2,1,'broken-bridge');
    for(const o of OBJECTS){
      // Interactions always have a clear approach. This is shared terrain, not random per login.
      for(let y=o.y-1;y<=o.y+1;y++)for(let x=o.x-1;x<=o.x+1;x++){
        if(['bamboo','rock'].includes(cells[index(x,y)]))set(x,y,o.y<19&&x>30?'mountain':'grass');
      }
      set(o.x,o.y,o.kind==='building'?'courtyard':o.y<19&&o.x>30?'mountain':'grass');
    }
    // Completing the shared array opens the only entrance to its optional treasure court.
    rect(36,2,7,5,'mountain');rect(36,2,7,1,'rock');rect(36,6,7,1,'rock');
    rect(36,2,1,5,'rock');rect(42,2,1,5,'rock');set(39,6,'sealed');
    return Object.freeze(cells);
  }
  const TERRAIN = makeTerrain();
return TERRAIN;})();
  const HEX='0123456789abcdef',fogValue=c=>HEX.indexOf(c);
  const validChunk=k=>typeof k==='string'&&/^\d{1,2},\d{1,2}$/.test(k)&&k.split(',').every(n=>Number(n)<CHUNK_COUNT)&&k.split(',').map(Number).join(',')===k;
  const chunkKey=(x,y)=>key(Math.floor(x/CHUNK_SIZE),Math.floor(y/CHUNK_SIZE));
  function normalizeExplored(raw){
    if(raw?.version===2&&raw.chunks&&typeof raw.chunks==='object'){
      const chunks={};for(const[k,v]of Object.entries(raw.chunks).slice(0,CHUNK_COUNT**2))if(validChunk(k)&&typeof v==='string'&&/^[0-9a-f]{256}$/.test(v))chunks[k]=v;
      return {version:2,chunks,revision:Number(raw.revision)||0,...(raw.all===true?{all:true}:{})};
    }
    let fog={version:2,chunks:{},revision:0};
    // Preserve the original onboarding fog without expanding it into a million-character string.
    if(typeof raw==='string'&&raw.length===2304){for(let y=0;y<48;y++)for(let x=0;x<48;x++)if(raw[y*48+x]==='1')fog=reveal(fog,{x,y},0);}
    return fog;
  }
  function known(fog,x,y){
    if(!inside(x,y))return false;if(fog?.all)return true;
    const s=fog?.chunks?.[chunkKey(x,y)],i=(y%32)*32+x%32;
    return !!s&&(fogValue(s[i>>2])&(1<<(i&3)))!==0;
  }
  function reveal(raw,p,radius=5){
    const fog=raw?.version===2?raw:normalizeExplored(raw);if(fog.all)return fog;
    const chunks={...fog.chunks},changed=new Map();let dirty=false;
    for(let y=Math.max(0,p.y-radius);y<=Math.min(SIZE-1,p.y+radius);y++)for(let x=Math.max(0,p.x-radius);x<=Math.min(SIZE-1,p.x+radius);x++){
      if(Math.hypot(x-p.x,y-p.y)>radius+.3)continue;
      const k=chunkKey(x,y),cells=changed.get(k)||chunks[k]?.split('')||Array(256).fill('0');changed.set(k,cells);
      const i=(y%32)*32+x%32,n=i>>2,bits=fogValue(cells[n]),next=bits|(1<<(i&3));if(bits!==next){cells[n]=HEX[next];dirty=true;}
    }
    if(!dirty)return fog;for(const[k,v]of changed)chunks[k]=v.join('');return {version:2,chunks,revision:(fog.revision||0)+1};
  }
  function mergeExplored(a,b){
    a=normalizeExplored(a);b=normalizeExplored(b);if(a.all||b.all)return {version:2,chunks:{},all:true,revision:Math.max(a.revision,b.revision)+1};
    const chunks={...a.chunks};for(const[k,v]of Object.entries(b.chunks))chunks[k]=!chunks[k]?v:[...v].map((c,i)=>HEX[fogValue(c)|fogValue(chunks[k][i])]).join('');
    return {version:2,chunks,revision:Math.max(a.revision,b.revision)+1};
  }
  function initialExplored(){let fog=normalizeExplored();for(let y=29;y<=46;y++)for(let x=1;x<=18;x++)fog=reveal(fog,{x,y},0);return reveal(fog,SPAWN);}
  const fullExplored=()=>({version:2,chunks:{},all:true,revision:1});
  function sample(route,at=Date.now()){
    const path=route?.path?.length?route.path:[SPAWN],stepMs=route?.stepMs||STEP_MS;
    const progress=Math.max(0,(at-(route?.startedAtMs||0))/stepMs),i=Math.min(path.length-1,Math.floor(progress)),a=path[i],b=path[Math.min(i+1,path.length-1)],f=Math.min(1,progress-i);
    const from=i<path.length-1?a:path[Math.max(0,i-1)],to=i<path.length-1?b:a;
    return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,tile:{...a},next:{...b},fraction:f,index:i,moving:i<path.length-1,direction:to.x>from.x?'right':to.x<from.x?'left':to.y<from.y?'up':'down'};
  }
  class Heap{
    constructor(){this.a=[];}
    push(v){const a=this.a;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p].f<=v.f)break;a[i]=a[p];i=p;}a[i]=v;}
    pop(){const a=this.a,first=a[0],v=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1].f<a[j].f)j++;if(a[j].f>=v.f)break;a[i]=a[j];i=j;}a[i]=v;}return first;}
  }
  function pathTo(target,parents){if(!parents.has(key(target.x,target.y)))return [];const path=[];for(let p=target;p;p=parents.get(key(p.x,p.y)))path.push({x:p.x,y:p.y});return path.reverse();}
  function createWorld(input={}){
    const config=descriptor(input),salt=seedHash(config.seed),seedHex=salt.toString(16).padStart(8,'0'),cache=new Map(),patches=new Map();let patchRevision=0;
    const hash=(x,y,layer=0)=>mix(x,y,salt^Math.imul(layer,0x9e3779b9));
    function noise(x,y,scale,layer){const X=x/scale,Y=y/scale,ix=Math.floor(X),iy=Math.floor(Y);let u=X-ix,v=Y-iy;u=u*u*(3-2*u);v=v*v*(3-2*v);
      const h=(a,b)=>hash(a,b,layer)/4294967295,a=h(ix,iy),b=h(ix+1,iy),c=h(ix,iy+1),d=h(ix+1,iy+1);return(a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;}
    function climate(x,y){
      let elevation=.57*noise(x,y,190,1)+.27*noise(x,y,77,2)+.11*noise(x,y,29,3)+.05*noise(x,y,11,4);
      const start=Math.hypot(x-30,y-35);elevation=Math.max(elevation,.68-start*.0018);
      const edge=Math.min(x,y,SIZE-1-x,SIZE-1-y);if(edge<12&&x>100&&y>100)elevation-=.15*(1-edge/12);
      return {elevation,humidity:noise(x,y,105,5),temperature:noise(x,y,210,6)*.65+(y/SIZE)*.35};
    }
    function baseTerrain(x,y){
      if(!inside(x,y))return 'rock';
      if(x<48&&y<48){if(x>=45&&y===36)return 'road';return STARTER_TERRAIN[y*48+x];}
      if(x>=48&&x<80&&Math.abs(y-36)<=1)return y===36?'road':'grass';
      const {elevation:e,humidity:h,temperature:t}=climate(x,y);
      if(e<.405)return 'ocean';if(e<.46)return 'water';if(e<.49)return 'beach';
      if(e>.76)return 'rock';if(e>.65)return t<.35?'snow':'mountain';
      if(t<.22)return 'snow';if(h<.29&&t>.45)return 'desert';if(h>.72&&e<.56)return 'swamp';if(h>.53)return 'forest';return 'grass';
    }
    const tierAt=(x,y)=>clamp(Math.floor(Math.hypot(x-SPAWN.x,y-SPAWN.y)/155),0,TIERS.length-1);
    function chunk(cx,cy){
      if(!Number.isInteger(cx)||!Number.isInteger(cy)||cx<0||cy<0||cx>=CHUNK_COUNT||cy>=CHUNK_COUNT)throw Error('區塊座標無效');
      const k=key(cx,cy);if(cache.has(k)){const found=cache.get(k);cache.delete(k);cache.set(k,found);return found;}
      const x0=cx*32,y0=cy*32,tiles=new Uint8Array(1024),objects=[],occupied=new Set();
      for(let y=0;y<32;y++)for(let x=0;x<32;x++)tiles[y*32+x]=TYPES.indexOf(baseTerrain(x0+x,y0+y));
      const place=o=>{if(!inside(o.x,o.y)||occupied.has(key(o.x,o.y)))return false;occupied.add(key(o.x,o.y));objects.push(Object.freeze(o));return true;};
      for(const o of STARTER_OBJECTS)if(o.x>=x0&&o.x<x0+32&&o.y>=y0&&o.y<y0+32)place(o);
      const dry=(x,y)=>inside(x,y)&&!['water','ocean','rock'].includes(baseTerrain(x,y));
      const make=(slot,kind,x,y,extra={})=>{
        const tier=tierAt(x,y),level=TIERS[tier].level+hash(x,y,12)%9;
        return {id:'g:'+seedHex+':'+cx+':'+cy+':'+slot,x,y,kind,tier,level,realm:TIERS[tier].name,...extra};
      };
      for(let slot=0;slot<12;slot++){
        const h=hash(cx*13+slot,cy,20),x=x0+2+h%28,y=y0+2+(h>>>9)%28;if(x<50&&y<50||!dry(x,y))continue;
        if(!DIRS.every(([dx,dy])=>dry(x+dx,y+dy)))continue;
        const tier=tierAt(x,y),t=TIERS[tier],hp=Math.round(650*(1+tier*.65)**2),atk=Math.round(140*(1+tier*.48));
        if(slot===0&&h%10<7){const variants=['靈泉洞天','古陣秘境','藏劍遺窟','星隕石窟'],variant=(h>>>19)%4;
          place(make(slot,'realm',x,y,{name:variants[variant],icon:'境',subtype:variant===2?'guardian':'puzzle',hp:hp*2,atk:Math.round(atk*1.2),elite:true}));
        }else if(slot===1&&h%10<7){const variants=[['watchtower','古代望樓','望'],['shrine','山神祭壇','壇'],['ruins','殘破仙府','遺'],['camp','行腳營地','營']],v=variants[(h>>>18)%4];
          place(make(slot,'structure',x,y,{subtype:v[0],name:v[1],icon:v[2]}));
        }else if(slot>=2&&slot<=5){const v=['山魈','靈狼','巖甲獸','妖藤','霜羽鷹'][(h>>>20)%5];place(make(slot,'monster',x,y,{name:t.name+'・'+v,icon:'獸',hp,atk,elite:h%13===0}));
        }else if(slot===6||slot===7){place(make(slot,'gather',x,y,{name:t.name+'靈木',material:t.wood,icon:'木'}));
        }else if(slot===8){place(make(slot,'chest',x,y,{name:'散修遺藏',icon:'寶'}));}
      }
      // Contiguous ore veins are generated from one anchor and direction per vein.
      for(let vein=0;vein<2;vein++){
        const h=hash(cx,cy,40+vein),sx=2+h%23,sy=2+(h>>>8)%23,length=3+(h>>>19)%5,vertical=!!(h&256);
        const nodes=[];
        for(let n=0;n<length;n++){
          const lx=sx+(vertical?0:n),ly=sy+(vertical?n:0),x=x0+lx,y=y0+ly;
          if(lx>=31||ly>=31||x<50&&y<50||!dry(x,y)||occupied.has(key(x,y))||!DIRS.some(([dx,dy])=>dry(x+dx,y+dy))){if(nodes.length)break;continue;}
          const t=TIERS[tierAt(x,y)];nodes.push(make(80+vein*8+n,'gather',x,y,{name:t.name+'礦脈',icon:'礦',material:t.iron,veinId:'vein:'+seedHex+':'+cx+':'+cy+':'+vein}));
        }
        nodes.forEach((o,i)=>place({...o,veinLength:nodes.length,veinAnchor:i===0}));
      }
      const value=Object.freeze({cx,cy,key:k,tiles,objects:Object.freeze(objects)});cache.set(k,value);if(cache.size>192)cache.delete(cache.keys().next().value);return value;
    }
    function objectsIn(bounds){
      const out=[],x0=clamp(Math.floor(bounds.x/32),0,CHUNK_COUNT-1),y0=clamp(Math.floor(bounds.y/32),0,CHUNK_COUNT-1),x1=clamp(Math.floor((bounds.x+bounds.w-1)/32),0,CHUNK_COUNT-1),y1=clamp(Math.floor((bounds.y+bounds.h-1)/32),0,CHUNK_COUNT-1);
      for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++)for(const o of chunk(cx,cy).objects)if(o.x>=bounds.x&&o.x<bounds.x+bounds.w&&o.y>=bounds.y&&o.y<bounds.y+bounds.h)out.push(o);
      return out;
    }
    function objectAt(x,y){return inside(x,y)?chunk(Math.floor(x/32),Math.floor(y/32)).objects.find(o=>o.x===x&&o.y===y):undefined;}
    function object(id){
      const starter=STARTER_OBJECTS.find(o=>o.id===id);if(starter)return starter;
      const m=/^g:([0-9a-f]{8}):(\d{1,2}):(\d{1,2}):(\d{1,3})$/.exec(String(id));if(!m||m[1]!==seedHex||Number(m[2])>=CHUNK_COUNT||Number(m[3])>=CHUNK_COUNT)return undefined;
      return chunk(Number(m[2]),Number(m[3])).objects.find(o=>o.id===id);
    }
    function installPatches(changes={}){
      for(const[k,data]of Object.entries(changes)){
        if(!validChunk(k)||!Number.isSafeInteger(data?.revision)||data.revision<0)throw Error('區塊變更版本無效');
        const clean={},[cx,cy]=k.split(',').map(Number);for(const[i,v]of Object.entries(data.tiles||{})){
          if(!/^\d{1,4}$/.test(i)||String(Number(i))!==i||Number(i)>=1024||!inside(cx*32+Number(i)%32,cy*32+Math.floor(Number(i)/32))||!TYPES.includes(v?.terrain))throw Error('地格變更無效');clean[i]={terrain:v.terrain};
        }
        if((patches.get(k)?.revision??-1)>data.revision)continue;
        patches.set(k,{revision:data.revision,tiles:clean});patchRevision++;
      }
    }
    function terrain(x,y,events={}){
      if(!inside(x,y))return 'rock';if(events.tiles?.[key(x,y)])return events.tiles[key(x,y)];
      const patch=patches.get(chunkKey(x,y))?.tiles[(y%32)*32+x%32];
      let t=patch?.terrain||TYPES[chunk(Math.floor(x/32),Math.floor(y/32)).tiles[(y%32)*32+x%32]];
      if(t==='sealed'&&events.array>=60)t='road';if(t==='broken-bridge'&&events.bridge>=20)t='bridge';return t;
    }
    function walkable(x,y,{events={},bounds=null,blocked=null,ignoreObjects=false,mode='walk'}={}){
      if(!inside(x,y)||bounds&&(x<bounds.x||y<bounds.y||x>=bounds.x+bounds.w||y>=bounds.y+bounds.h)||blocked?.has(key(x,y)))return false;
      const t=terrain(x,y,events),sea=['water','ocean'];
      if(mode==='sail'){
        if(!sea.includes(t)&&t!=='beach'&&!DIRS.some(([dx,dy])=>sea.includes(terrain(x+dx,y+dy,events))))return false;
        if(['rock','bamboo','sealed','broken-bridge'].includes(t))return false;
      }else if([...sea,'rock','bamboo','broken-bridge','sealed'].includes(t))return false;
      const o=objectAt(x,y);return !(!ignoreObjects&&o?.kind==='building');
    }
    function reachable(start,options={}){
      const queue=[{x:start.x,y:start.y}],parents=new Map([[key(start.x,start.y),null]]),cost=new Map([[key(start.x,start.y),0]]),max=options.maxNodes||20000;
      for(let n=0;n<queue.length&&n<max;n++){
        const p=queue[n],depth=cost.get(key(p.x,p.y));if(depth>=(options.maxSteps??512))continue;
        for(const[dx,dy]of DIRS){const x=p.x+dx,y=p.y+dy,k=key(x,y);if(parents.has(k)||!walkable(x,y,options)||options.explored&&!known(options.explored,x,y)||queue.length>=max)continue;
          const next={x,y};parents.set(k,p);cost.set(k,depth+1);queue.push(next);}
      }
      return {cells:queue,parents,cost};
    }
    function plan(start,target,options={}){
      if(!inside(target?.x,target?.y))return {path:[],reason:'目的地不在地圖內'};
      const open=new Heap(),parents=new Map([[key(start.x,start.y),null]]),cost=new Map([[key(start.x,start.y),0]]),unknown=options.explored&&!known(options.explored,target.x,target.y);
      if(!unknown&&!same(start,target)&&!walkable(target.x,target.y,options))return {path:[],reason:'目的地無法通行'};
      let best=start,frontier=null,visited=0;const maxNodes=options.maxNodes||12000,maxSteps=options.maxSteps??512;open.push({...start,f:distance(start,target),g:0});
      while(open.a.length&&visited<maxNodes){
        const p=open.pop(),k=key(p.x,p.y);if(cost.get(k)!==p.g)continue;visited++;
        if(distance(p,target)<distance(best,target))best=p;
        if(same(p,target))return {path:pathTo(p,parents),partial:false,visited};
        if(unknown&&DIRS.some(([dx,dy])=>inside(p.x+dx,p.y+dy)&&!known(options.explored,p.x+dx,p.y+dy))&&(!frontier||distance(p,target)<distance(frontier,target)||distance(p,target)===distance(frontier,target)&&p.g<frontier.g))frontier=p;
        if(p.g>=maxSteps)continue;
        for(const[dx,dy]of DIRS){const x=p.x+dx,y=p.y+dy,n=key(x,y),g=p.g+1;
          if(!walkable(x,y,options)||options.explored&&!known(options.explored,x,y)||(cost.get(n)??Infinity)<=g)continue;
          cost.set(n,g);parents.set(n,{x:p.x,y:p.y});open.push({x,y,g,f:g+distance({x,y},target)});
        }
      }
      if(frontier)return {path:pathTo(frontier,parents),partial:true,visited};
      if(options.explored&&options.maxSteps===undefined&&(visited>=maxNodes||cost.get(key(best.x,best.y))>=maxSteps)&&!same(best,start))return {path:pathTo(best,parents),partial:true,limited:true,visited};
      return {path:[],visited,reason:'此處無法通行，請選擇道路、空地或合適的航行路線'};
    }
    function approach(start,target,options={}){
      if(!target)return {path:[],reason:'目標不存在'};if(distance(start,target)<=1)return {path:[{x:start.x,y:start.y}],partial:false};
      const choices=DIRS.map(([dx,dy])=>({x:target.x+dx,y:target.y+dy})).filter(p=>walkable(p.x,p.y,options)).map(p=>plan(start,p,options)).filter(p=>p.path.length);
      choices.sort((a,b)=>Number(a.partial)-Number(b.partial)||a.path.length-b.path.length);return choices[0]||{path:[],reason:'找不到可接近的道路'};
    }
    function safePosition(p,options={}){
      if(inside(p?.x,p?.y)&&walkable(p.x,p.y,options))return {x:p.x,y:p.y};const origin=inside(p?.x,p?.y)?p:SPAWN,b=options.bounds;
      for(let d=0;d<=64;d++)for(let dy=-d;dy<=d;dy++){const dx=d-Math.abs(dy);for(const sign of dx?[1,-1]:[1]){const x=origin.x+dx*sign,y=origin.y+dy;if(walkable(x,y,options))return {x,y};}}
      if(b){for(let y=b.y;y<b.y+b.h;y++)for(let x=b.x;x<b.x+b.w;x++)if(walkable(x,y,options))return {x,y};throw Error('此區域沒有安全地格');}
      return {...SPAWN};
    }
    function redirect(route,target,at,options={}){
      const p=sample(route,at),start=p.moving?p.next:p.tile,result=target?.objectId?approach(start,object(target.objectId),options):plan(start,target,options);
      if(!result.path.length)return result;const path=p.moving?[p.tile,...result.path]:result.path;
      return {...result,route:{path,stepMs:STEP_MS,startedAtMs:at-(p.moving?p.fraction*STEP_MS:0)}};
    }
    const zone=p=>p.x<48&&p.y<48?(p.y>=30&&p.x<19?'問道宗':p.x>29&&p.y<20?'古陣山口':'青竹林'):LABELS[terrain(Math.floor(p.x),Math.floor(p.y))]+' · '+TIERS[tierAt(p.x,p.y)].name+'域';
    const api={SIZE,CHUNK_SIZE,CHUNK_COUNT,GENERATOR_VERSION,DEFAULT_SEED,VERSION:config.worldId,descriptor:config,STEP_MS,SPAWN,DIRS,TYPES,COLORS,LABELS,TIERS,OBJECTS:STARTER_OBJECTS,
      key,index,inside,distance,same,hash,seedHash,chunkKey,validChunk,normalizeExplored,mergeExplored,fullExplored,known,reveal,initialExplored,sample,pathTo,climate,baseTerrain,tierAt,chunk,objectsIn,objectAt,object,terrain,walkable,reachable,plan,approach,safePosition,redirect,zone,installPatches,
      patchVersions:()=>Object.fromEntries([...patches].map(([k,v])=>[k,v.revision])),get patchRevision(){return patchRevision;},get cachedChunks(){return cache.size;}};
    return Object.freeze(api);
  }
  const worlds=new Map();
  function forDescriptor(input){const d=descriptor(input);if(!worlds.has(d.worldId)){worlds.set(d.worldId,createWorld(d));if(worlds.size>8)worlds.delete(worlds.keys().next().value);}return worlds.get(d.worldId);}
  const defaultWorld=createWorld();
  const api=Object.freeze({...defaultWorld,createWorld,forDescriptor,validateDescriptor:descriptor,get patchRevision(){return defaultWorld.patchRevision;},get cachedChunks(){return defaultWorld.cachedChunks;}});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QAGridWorld=api;
})(globalThis);

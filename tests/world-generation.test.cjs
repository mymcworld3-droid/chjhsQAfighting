const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const W=require('../public/world/world-core.js'),Simulator=require('../public/world/world-simulator-worker.js'),Battle=require('../world-battle.cjs');
const P=W.starterPoint,C=W.townPoint;
const fingerprint=chunk=>crypto.createHash('sha256').update(chunk.tiles).update(JSON.stringify(chunk.objects)).digest('hex');
test('seeded generation is identical in browser and server, independent of chunk visit order',()=>{
  const seed='測試・相同種子',a=W.createWorld(seed),b=W.createWorld(seed),sandbox={};vm.runInNewContext(fs.readFileSync(require.resolve('../public/world/world-core.js'),'utf8'),sandbox);
  const browser=sandbox.QAGridWorld.createWorld(seed),coordinates=[[5,6],[31,31],[7,12],[15,15],[16,13],[16,9]],saved=coordinates.map(([x,y])=>fingerprint(a.chunk(x,y)));
  coordinates.toReversed().forEach(([x,y])=>b.chunk(x,y));
  coordinates.forEach(([x,y],i)=>{assert.equal(fingerprint(b.chunk(x,y)),saved[i]);assert.equal(fingerprint(browser.chunk(x,y)),saved[i]);});
  assert.notEqual(fingerprint(W.createWorld('另一個種子').chunk(5,6)),saved[0]);
});
test('chunks match coordinate sampling at seams and partial world edges; generated ids are stable and scoped to the seed',()=>{
  const world=W.createWorld('boundary-test');
  for(const [cx,cy]of [[0,0],[1,1],[6,9],[31,31]]){
    const chunk=world.chunk(cx,cy);for(let y=0;y<32;y++)for(let x=0;x<32;x++)assert.equal(world.TYPES[chunk.tiles[y*32+x]],world.baseTerrain(cx*32+x,cy*32+y));
    for(const object of chunk.objects){assert.ok(world.inside(object.x,object.y));assert.equal(world.objectAt(object.x,object.y).id,object.id);assert.equal(world.object(object.id).name,object.name);if(object.id.startsWith('g:'))assert.equal(W.createWorld('other').object(object.id),undefined);}
  }
  assert.throws(()=>world.chunk(32,0));assert.throws(()=>W.createWorld({generatorVersion:'unknown-version'}));
});
test('million-tile worlds contain abundant secrets, level bands, structures, oceans and contiguous ore veins',()=>{
  const samples=['qingyun-2026','海上有仙山','竹影與星河'].map(seed=>Simulator.generate(seed));
  for(const map of samples){assert.equal(map.tiles.length,1000000);assert.equal(Object.values(map.stats.counts).reduce((a,b)=>a+b,0),1000000);assert.ok(map.stats.landRatio>.25&&map.stats.landRatio<.9);
    assert.ok(map.stats.kinds.realm>150);assert.ok(map.stats.kinds.structure>150);assert.ok(map.stats.kinds.monster>1000);assert.ok(map.stats.veins>500);assert.ok(map.stats.tiers.every(n=>n>0));assert.ok(map.stats.spawnConnected>200);
    const groups=new Map();for(const o of map.objects)if(o.veinId){const group=groups.get(o.veinId)||[];group.push(o);groups.set(o.veinId,group);}
    const continuous=[...groups.values()].filter(g=>g.length>=3&&g.every((o,i)=>i===0||W.distance(o,g[i-1])===1));assert.ok(continuous.length>100);
    for(const group of groups.values()){assert.ok(group.every((o,i)=>o.veinLength===group.length&&(i===0||W.distance(o,group[i-1])===1)));assert.equal(group.filter(o=>o.veinAnchor).length,1);}
    assert.ok(['grass','bamboo','forest','beach','mountain','snow','desert','stone','volcano','lava','ocean'].every(t=>map.stats.counts[t]>0));
    const packs=new Map(),habitats=new Map();for(const o of map.objects.filter(o=>o.packId)){
      assert.ok(!W.inSafeArea(o.x,o.y));assert.equal(o.biome,W.TYPES[map.tiles[o.y*1000+o.x]]);
      const pack=packs.get(o.packId)||[];pack.push(o);packs.set(o.packId,pack);
      const species=habitats.get(o.habitatId);if(species)assert.equal(o.species,species);habitats.set(o.habitatId,o.species);
    }
    assert.ok(packs.size>200);assert.ok([...packs.values()].filter(p=>p.length>=2).length/packs.size>.8);
    for(const pack of packs.values())assert.ok(pack.every(o=>o.species===pack[0].species&&W.distance(o,pack[0])<=12));
  }
  assert.equal(new Set(samples.map(s=>s.stats.fingerprint)).size,3);
});
test('every seed starts in the central sect with a clear plain, no hostile spawns and four walkable exits',()=>{
  assert.deepEqual(W.SPAWN,{x:500,y:500});
  for(const seed of ['qingyun-2026','海上有仙山','竹影與星河','0','中央出生測試']){
    const world=W.createWorld(seed),s=world.SPAWN,r=world.SAFE_RADIUS;assert.equal(world.zone(s),'問道宗');assert.equal(world.tierAt(s.x,s.y),0);
    for(let y=s.y-r;y<=s.y+r;y++)for(let x=s.x-r;x<=s.x+r;x++){
      assert.ok(['grass','road','courtyard'].includes(world.baseTerrain(x,y)),seed+' '+x+','+y);
      const object=world.objectAt(x,y);assert.ok(!object||['building','npc'].includes(object.kind));
    }
    for(const[dx,dy]of world.DIRS){const target={x:s.x+dx*60,y:s.y+dy*60},route=world.plan(s,target);assert.equal(route.path.length,61);assert.deepEqual(route.path.at(-1),target);}
    assert.ok(world.OBJECTS.filter(o=>o.kind==='monster').every(o=>!world.inSafeArea(o.x,o.y)));
    assert.equal(world.known(world.initialExplored(),s.x,s.y),true);assert.equal(world.known(world.initialExplored(),9,36),false);
  }
});
test('chunk caches stay bounded and eviction does not change regenerated content',()=>{
  const world=W.createWorld('bounded-cache'),before=fingerprint(world.chunk(5,6));
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)world.chunk(x,y);
  assert.ok(world.cachedChunks<=192);assert.equal(fingerprint(world.chunk(5,6)),before);
});
test('fog uses sparse packed chunks and merges independent discoveries including the far world edge',()=>{
  const initial=W.initialExplored(),a=W.reveal(initial,{x:997,y:997}),b=W.reveal(initial,{x:510,y:511}),merged=W.mergeExplored(a,b);
  assert.ok(JSON.stringify(initial).length<2048);assert.ok(JSON.stringify(merged).length<5000);assert.ok(W.known(merged,999,999));assert.ok(W.known(merged,510,511));assert.ok(!W.known(initial,999,999));
  const old=Array(2304).fill('0');old[27*48+18]='1';assert.ok(W.known(W.normalizeExplored(old.join('')),P(18,27).x,P(18,27).y));assert.equal(W.known(merged,-1,0),false);
});
test('long routes cross fog in bounded segments while explicit battle movement remains strict',()=>{
  const world=W.createWorld('long-fog-route'),tiles={};
  // Controlled clear corridor across the million-tile map, including chunk seams.
  for(let x=500;x<1000;x++){const k=W.chunkKey(x,500);tiles[k]||={revision:1,tiles:{}};tiles[k].tiles[(500%32)*32+x%32]={terrain:'road'};}
  world.installPatches(tiles);const fog=world.initialExplored(),target={x:999,y:500},result=world.plan(world.SPAWN,target,{explored:fog,maxNodes:100});
  assert.ok(result.partial);assert.ok(result.visited<=100);assert.ok(result.path.some(p=>!world.known(fog,p.x,p.y)));
  const rest=world.plan(result.path.at(-1),target,{explored:fog});assert.equal(rest.partial,false);assert.deepEqual(rest.path.at(-1),target);
  assert.equal(world.plan(world.SPAWN,{x:503,y:500},{maxSteps:2}).path.length,0);assert.deepEqual(world.plan(world.SPAWN,{x:1000,y:0}).path,[]);
});
test('sparse terrain patches do not mutate the procedural base and reject incompatible cells or stale versions',()=>{
  const world=W.createWorld('delta'),p={x:520,y:520},k=world.chunkKey(p.x,p.y),i=(p.y%32)*32+p.x%32,base=world.baseTerrain(p.x,p.y);
  const changed=base==='road'?'grass':'road';world.installPatches({[k]:{revision:2,tiles:{[i]:{terrain:changed}}}});assert.equal(world.terrain(p.x,p.y),changed);assert.equal(world.baseTerrain(p.x,p.y),base);
  world.installPatches({[k]:{revision:1,tiles:{[i]:{terrain:'rock'}}}});assert.equal(world.terrain(p.x,p.y),changed);assert.throws(()=>world.installPatches({'99,0':{revision:1,tiles:{}}}));assert.throws(()=>world.installPatches({[k]:{revision:3,tiles:{1024:{terrain:'rock'}}}}));
  assert.throws(()=>world.installPatches({'31,31':{revision:1,tiles:{1023:{terrain:'road'}}}}));assert.throws(()=>world.installPatches({'00,1':{revision:1,tiles:{}}}));
});
test('distant tactical encounters use their seed and local bounds rather than the original 48-cell area',()=>{
  const world=W.createWorld('far-battle'),object=world.objectsIn({x:600,y:600,w:64,h:64}).find(o=>o.kind==='monster');assert.ok(object);
  const p=world.DIRS.map(([dx,dy])=>({x:object.x+dx,y:object.y+dy})).find(p=>world.walkable(p.x,p.y));assert.ok(p);
  const b=Battle.createBattle(p,object,{uid:'u',hp:2000,maxHp:2000,atk:200}, {},Date.now(),world);
  assert.equal(b.world.seed,'far-battle');assert.ok(b.bounds.x>500&&b.bounds.y>500);assert.ok(b.player.x>=b.bounds.x&&b.player.x<b.bounds.x+8);assert.equal(b.enemies[0].x,object.x);
  assert.equal(b.events.tiles[W.key(object.x,object.y)],world.terrain(object.x,object.y));assert.ok(Battle.view(b));
  assert.equal(Object.keys(b.events.tiles).length,64);
  const edge={x:998,y:998,id:'edge',name:'邊界守衛',hp:1000,atk:100},k='31,31',tiles={};
  for(let y=992;y<1000;y++)for(let x=992;x<1000;x++)tiles[(y%32)*32+x%32]={terrain:'road'};
  world.installPatches({[k]:{revision:1,tiles}});const far=Battle.createBattle({x:998,y:997},edge,{hp:2000,maxHp:2000,atk:200},{},Date.now(),world);
  assert.equal(Object.keys(far.events.tiles).length,64);assert.equal(far.events.tiles['992,992'],'road');assert.equal(far.events.tiles['999,999'],'road');
});

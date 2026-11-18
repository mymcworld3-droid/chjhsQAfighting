'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {generateDungeonLayout,walkable,WALL,CORRIDOR,CHAMBER,LAYOUT_VERSION}=require('../dungeon-map-generator.cjs');

const adjacent=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)===1;
function explore(map){
  const q=[map.spawn],seen=new Set([map.spawn.y*map.width+map.spawn.x]);
  const distance=new Map([[map.spawn.y*map.width+map.spawn.x,0]]);
  for(let i=0;i<q.length;i++){
    const p=q[i],prior=distance.get(p.y*map.width+p.x);
    for(const [dx,dy]of [[0,1],[0,-1],[1,0],[-1,0]]){
      const n={x:p.x+dx,y:p.y+dy},id=n.y*map.width+n.x;
      if(!walkable(map,n)||seen.has(id))continue;
      q.push(n);seen.add(id);distance.set(id,prior+1);
    }
  }
  return {seen,distance};
}
test('map v1 is deterministic, pure and resistant to invalid seeds',()=>{
  const a=generateDungeonLayout('0123456789abcdef01234567');
  const b=generateDungeonLayout('0123456789abcdef01234567');
  const c=generateDungeonLayout('0123456789abcdef01234568');
  assert.deepStrictEqual(a,b);
  assert.notDeepStrictEqual(a.tiles,c.tiles);
  assert.notEqual(a.layoutId,c.layoutId);
  assert.equal(a.layoutVersion,LAYOUT_VERSION);
  assert.equal(a.mode,'dungeon');
  assert.throws(()=>generateDungeonLayout(''),TypeError);
  assert.throws(()=>generateDungeonLayout('../../../foo'),TypeError);
  assert.throws(()=>generateDungeonLayout('a'.repeat(129)),TypeError);
  assert.throws(()=>generateDungeonLayout(null),TypeError);
});
test('1200 different seeds have 2-4 real branches, a winding main path and exactly one connected accessible map',()=>{
  const counts={2:0,3:0,4:0},biomes=new Set(),shapes=new Set();
  for(let i=0;i<1200;i++){
    const map=generateDungeonLayout('quality-seed-'+i);
    assert.equal(map.tiles.length,map.width*map.height);
    assert.ok(map.width>=45&&map.width<=51);
    assert.ok(map.height>=39&&map.height<=43);
    assert.ok(map.tiles.every(tile=>[WALL,CORRIDOR,CHAMBER].includes(tile)));
    assert.ok(map.mainTurns>=5);
    assert.ok(map.mainRoute.length>=89);
    assert.equal(map.branchCount,map.branches.length);
    assert.ok(map.branchCount>=2&&map.branchCount<=4);
    assert.equal(map.mainRoute[0].x,map.entrance.x);
    assert.equal(map.mainRoute[0].y,map.entrance.y);
    assert.deepStrictEqual(map.mainRoute.at(-1),map.deepest);
    assert.deepStrictEqual(map.deepest,map.guardianSite);
    assert.ok(map.mainRoute.every(point=>walkable(map,point)));
    assert.ok(map.mainRoute.slice(1).every((p,index)=>adjacent(map.mainRoute[index],p)));
    const mainKeys=new Set(map.mainRoute.map(p=>p.x+','+p.y));
    const branchOrigins=new Set(),branchEnds=new Set();
    for(const branch of map.branches){
      assert.ok(mainKeys.has(branch.entrance.x+','+branch.entrance.y));
      assert.ok(!branchOrigins.has(branch.originIndex));
      assert.ok(!branchEnds.has(branch.end.x+','+branch.end.y));
      branchOrigins.add(branch.originIndex);
      branchEnds.add(branch.end.x+','+branch.end.y);
      assert.deepStrictEqual(branch.route[0],branch.entrance);
      assert.deepStrictEqual(branch.route.at(-1),branch.end);
      assert.ok(branch.route.length>=13&&branch.route.length<=21);
      assert.ok(branch.route.every(p=>walkable(map,p)));
      assert.ok(branch.route.slice(1).every((p,index)=>adjacent(branch.route[index],p)));
    }
    assert.deepStrictEqual(map.mainRoute.at(-5),map.portalSite);
    assert.notDeepStrictEqual(map.deepest,map.portalSite);
    assert.equal(map.spawnPads.length,4);
    assert.equal(new Set(map.spawnPads.map(p=>p.x+','+p.y)).size,4);
    assert.ok(map.spawnPads.every(p=>walkable(map,p)));
    assert.ok(map.walkableCount>200&&map.walkableCount<700);
    // There may be long side corridors and chambers, but no inaccessible
    // isolated floor islands. The full boundary is always a solid wall.
    for(let x=0;x<map.width;x++){
      assert.equal(map.tiles[x],WALL);
      assert.equal(map.tiles[(map.height-1)*map.width+x],WALL);
    }
    for(let y=0;y<map.height;y++){
      assert.equal(map.tiles[y*map.width],WALL);
      assert.equal(map.tiles[y*map.width+map.width-1],WALL);
    }
    const {seen,distance}=explore(map);
    assert.equal(seen.size,map.walkableCount);
    const getDistance=p=>distance.get(p.y*map.width+p.x);
    const deepestDistance=getDistance(map.deepest);
    for(const branch of map.branches){
      assert.ok(getDistance(branch.end)<deepestDistance,
        'branch must not surpass guardian: seed '+i);
    }
    // Alternate 2-wide corridors and chambers, never a simple rectangle.
    assert.ok(map.tiles.includes(CHAMBER));
    assert.ok(map.tiles.includes(CORRIDOR));
    counts[map.branchCount]++;
    biomes.add(map.biome);
    shapes.add(map.layoutId);
  }
  assert.ok(Object.values(counts).every(n=>n>=100));
  assert.equal(biomes.size,4);
  assert.ok(shapes.size>=1190);
});
test('four-player spawn cells and critical anchors remain usable for different map sizes',()=>{
  for(const seed of ['small-spawn','big-spawn','same-party','different-party','legacy:dungroom123456']){
    const map=generateDungeonLayout(seed);
    for(const anchor of [map.spawn,map.entrance,map.deepest,map.guardianSite,map.portalSite,
      ...map.spawnPads])assert.equal(walkable(map,anchor),true);
    assert.equal(walkable(map,{x:-1,y:0}),false);
    assert.equal(walkable(map,{x:map.width,y:1}),false);
    assert.equal(walkable(map,{x:0,y:0}),false);
    assert.equal(walkable(map,{x:1.2,y:1}),false);
  }
});

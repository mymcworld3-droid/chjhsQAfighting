'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../public/world/world-core.js'),A=require('../public/world/world-art.js');
function view(){
  const context={QAGridWorld:W};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/world/world-view.js'),'utf8').replace(/^import .*;\n/gm,'').replace('export class WorldView','this.View=class WorldView'),context);
  return Object.assign(Object.create(context.View.prototype),{world:W,battle:()=>null,panel(title,html){this.lastPanel={title,html};},message(text){this.lastMessage=text;}});
}
function entry(window={},nodes={}){
  const source=fs.readFileSync(require.resolve('../public/world/world-entry.js'),'utf8'),context={window,document:{getElementById:id=>nodes[id]},view:{facilityPanel(value){context.room=value;},sectGuide(){context.guide=true;}}};
  vm.runInNewContext(source.slice(source.indexOf('async function openEntry'),source.indexOf('function ensureView'))+'\nthis.open=openEntry;',context);
  return context;
}
test('all new facilities have a reachable entrance, a solid base and an atlas sprite at native phone resolution',()=>{
  assert.equal(W.SECT_FACILITIES.length,14);const occupied=new Set();
  for(const o of W.SECT_FACILITIES){
    assert.equal(W.object(o.id),o);assert.equal(W.objectAt(o.x,o.y),o);assert.ok(W.inSafeArea(o.x,o.y));
    const approach=W.approach(W.SPAWN,o);assert.ok(approach.path.length,o.id);assert.equal(approach.partial,false);
    assert.equal(W.distance(approach.path.at(-1),o),1);assert.ok(approach.path.every(p=>W.walkable(p.x,p.y)));
    const f=o.footprint;for(let y=f.y;y<f.y+f.h;y++)for(let x=f.x;x<f.x+f.w;x++){
      assert.equal(W.walkable(500+x,500+y),false,o.id);const key=W.key(x,y);assert.ok(!occupied.has(key));occupied.add(key);
    }
    const s=A.object(o);assert.equal(s.image,'sect-town-atlas');assert.ok(s.sx+s.sw<=1248&&s.sy+s.sh<=1248);assert.ok(s.sw>=s.w*1.8*2);
  }
  assert.equal(new Set(W.SECT_FACILITIES.map(o=>o.artCell)).size,9);
});
test('the commercial street has six shops with four architectural styles and the old garden remains intact',()=>{
  const market=W.SECT_DISTRICTS.find(d=>d.id==='market');assert.equal(market.places.length,6);
  const shops=market.places.map(id=>W.object(id));assert.equal(new Set(shops.map(o=>o.artCell)).size,4);
  assert.ok(shops.every(o=>o.y===524));assert.match(W.zone(shops[0]),/雲間商街/);
  for(const p of W.SECT_LANDMARKS)assert.ok(W.sectBlocked(500+p.footprint.x,500+p.footprint.y));
  for(const side of [-1,1])for(const dy of [-7,0,6]){
    const x=500+side*(13+Math.round(Math.sin((dy+4)/7)*1.4));assert.equal(W.terrain(x,500+dy),'bridge');assert.ok(W.walkable(x,500+dy));
  }
  assert.equal(W.terrain(497,486),'courtyard');assert.equal(W.GENERATOR_VERSION,'qingyun-seeded-v2');
});
test('the directory lists each facility and navigating to a shop uses normal movement and deferred interaction',async()=>{
  const v=view();v.sectGuide();assert.equal(v.lastPanel.title,'問道宗導覽');
  const places=W.SECT_DISTRICTS.flatMap(d=>d.places);assert.equal(new Set(places).size,places.length);
  for(const id of places){assert.ok(W.object(id),id);assert.ok(v.lastPanel.html.includes('data-place="'+id+'"'));}
  for(const o of W.SECT_FACILITIES)assert.ok(places.includes(o.id));
  let target;v.move=async(o,id,after)=>{target={o,id,after};};await v.action('visit-place',{place:'market-hall'});
  assert.equal(target.id,'market-hall');assert.equal(target.o,W.object('market-hall'));assert.equal(target.after,true);
  v.battle=()=>({status:'active'});await v.action('visit-place',{place:'material-shop'});assert.equal(target.id,'market-hall');assert.match(v.lastMessage,/戰鬥/);
});
test('facility menus offer working service destinations without pretending to grant items or healing',()=>{
  const v=view(),services={market:['store','market-all','market-mine'],library:['core','history','practice'],alchemy:['bag','core','refinery'],dining:['meditation','practice','commissions'],residence:['bag','settings','friends']};
  for(const [id,entries]of Object.entries(services)){
    assert.equal(v.facilityPanel(id),true);for(const item of entries)assert.ok(v.lastPanel.html.includes('data-entry="'+item+'"'),id+':'+item);
  }
  assert.equal(v.facilityPanel('unknown'),false);
});
test('shop destinations select the existing store or the correct player-market filter',async()=>{
  const calls=[],ctx=entry({switchToPage:async p=>calls.push(p),openPlayerMarketplace:filter=>calls.push(filter)}, {'pm-view-shop':{click:()=>calls.push('shop')}});
  ctx.document.querySelector=selector=>({click:()=>calls.push(selector)});
  for(const [name,filter]of [['all','all'],['material','material'],['artifact','artifact'],['recipe','recipe'],['mine','mine']]){await ctx.open('market-'+name);assert.equal(calls.at(-1),filter);}
  await ctx.open('store');assert.deepEqual(calls.slice(-2),['page-store','shop']);
  await ctx.open('store-avatar');assert.equal(calls.at(-1),'[data-i18n="tab_avatar"]');
  await ctx.open('store-frame');assert.equal(calls.at(-1),'[data-i18n="tab_frame"]');
  await ctx.open('library');assert.equal(ctx.room,'library');await ctx.open('sect-guide');assert.equal(ctx.guide,true);
});
test('commission, meditation and record services open their existing interfaces',async()=>{
  const calls=[],ctx=entry({switchToPage:async p=>calls.push(p),openDailyMeditation:()=>calls.push('meditation')}, {'quest-panel':{},'quest-open':{click:()=>calls.push('quests')},'quest-tab-daily':{click:()=>calls.push('daily')}});
  await ctx.open('commissions');assert.deepEqual(calls,['quests','daily']);await ctx.open('meditation');assert.equal(calls.at(-1),'meditation');
  await ctx.open('history');assert.equal(calls.at(-1),'page-history');
  const missing=entry({showToast:text=>calls.push(text)});await missing.open('commissions');assert.match(calls.at(-1),/正在準備/);
});

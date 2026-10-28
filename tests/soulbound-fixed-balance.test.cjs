'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const pool=require('../public/cultivation/soulbound-pool.js');
const api=require('../artifact-generation-api.js'),router=require('../ai-router.js');
const authority=require('../raid-authority.cjs');
const strip=source=>source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
function catalogRuntime(){return vm.runInNewContext(strip(fs.readFileSync('public/cultivation/artifact-catalog.js','utf8'))+'\n({normalizeArtifactDefinition,validateArtifactCatalog,getArtifactById});',{QASoulboundPool:pool});}
const current=item=>({...item,soulboundBalanceVersion:pool.BALANCE_VERSION,soulboundRefinementVersion:pool.REFINEMENT_VERSION});

test('every permanent weapon gains fourfold flat stats and double percent effects without changing ownership IDs',()=>{
  for(let rank=0;rank<8;rank++)for(const type of pool.TYPES){
    const item=pool.get('soul-'+type.id+'-'+pool.REALMS[rank].id);
    const values=Object.fromEntries(item.effects.map(e=>[e.type,e.value]));
    assert.equal(values.equip_attack_flat,4*(25+rank*15));assert.equal(values.equip_hp_flat,4*(80+rank*45));
    assert.equal(values[type.effect],Number(((type.base+type.step*rank)*(type.effect.endsWith('_flat')?4:2)).toFixed(4)));
    for(const effect of item.effects){const bounds=pool.EFFECT_BOUNDS[effect.type];assert.ok(effect.value>=bounds.min&&effect.value<=bounds.max);}
  }
});

test('all fixed ranges and hostile model outputs stay bounded across realms, depths and ingredient counts',()=>{
  for(let order=1;order<=10;order++)for(let stage=1;stage<=3;stage++)for(let count=2;count<=8;count++) {
    for(const [type,bounds] of Object.entries(pool.EFFECT_BOUNDS)) {
      const range=pool.effectRange(type,order,stage,count);if(!range)continue;
      assert.ok(Number.isFinite(range.min)&&Number.isFinite(range.max));
      assert.ok(bounds.min<=range.min&&range.min<=range.max&&range.max<=bounds.max,type);
      for(const value of [-1e20,1e20,NaN]) {
        const result=api.sanitizeEffect({type,value},order,stage,{}, {'3':{[type]:{min:999999,max:999999}}},count,true);
        assert.ok(result.value>=range.min&&result.value<=range.max,type);
        if(type.endsWith('_flat'))assert.equal(Number.isInteger(result.value),true);
      }
    }
  }
});

test('higher realms, deeper refinements and additional ingredients cannot weaken the available range',()=>{
  for(const type of Object.keys(pool.EFFECT_BOUNDS))for(const dimension of ['realm','stage','count']) {
    let previous;
    const values=dimension==='realm'?[3,4,5,6,7,8,9,10]:dimension==='stage'?[1,2,3]:[2,3,4,5,6,7,8];
    for(const value of values) {
      const range=pool.effectRange(type,dimension==='realm'?value:10,dimension==='stage'?value:3,dimension==='count'?value:3);
      if(!range)continue;
      if(previous)for(const key of ['min','max'])assert.ok(type==='equip_damage_cap_percent'?range[key]<=previous[key]:range[key]>=previous[key],type+':'+dimension);
      previous=range;
    }
  }
});

test('legacy refined items migrate exactly once and browser and server derive the same upgraded stats',()=>{
  const old={id:'legacy-refined',name:'舊精煉器',realm:'金丹',equipSlot:'本命法寶',soulboundRefinementVersion:2,
    effects:[{type:'equip_attack_flat',value:50},{type:'equip_hp_flat',value:200},{type:'equip_combo_chance',value:.05}]};
  const before=structuredClone(old),rebased=pool.balanceArtifact(old);
  assert.deepEqual(rebased.effects.map(e=>e.value),[200,800,.1]);
  assert.deepEqual(pool.balanceArtifact(rebased),rebased);assert.deepEqual(old,before);
  const catalog=catalogRuntime(),saved=JSON.parse(JSON.stringify(catalog.normalizeArtifactDefinition(old)));
  assert.deepEqual(JSON.parse(JSON.stringify(catalog.normalizeArtifactDefinition(saved))),saved);
  const user={stats:{attack:200,maxHp:1000,totalScore:10},artifactSystem:{inventory:{[old.id]:1},equipped:{本命法寶:old.id,護身法寶:'armor'}}};
  const snap=authority.trustedRaidPlayerSnapshot(user,'u',{artifactCatalogSchemaVersion:2,items:[old,{id:'armor',equipSlot:'護身法寶',effects:[{type:'equip_attack_flat',value:999999}]}]});
  assert.equal(snap.atk,400);assert.equal(snap.maxHp,1800);
  assert.equal(snap.artifactBattle.effects.find(e=>e.type==='equip_combo_chance').value,.1);
  assert.equal(saved.effects[0].value,snap.atk-user.stats.attack);
  assert.deepEqual(user.artifactSystem.inventory,{[old.id]:1});
});

test('every original tier retains all affixes with at least 15 percent gains through both refinements',()=>{
  for(const source of pool.ITEMS) {
    let previous=source;
    for(const stage of [2,3]) {
      const result=api.sanitizeGeneratedArtifact({name:'測試成品',effects:[{type:'equip_attack_flat',value:0}]},source.realm,stage,{}, {},2,{primaryArtifacts:[previous]});
      for(const base of previous.effects)assert.ok(result.effects.find(e=>e.type===base.type).value>=Number((base.value*1.15).toFixed(4)),source.id+':'+base.type);
      pool.assertRefinementImproves(result,[previous]);previous={...result,id:'refined-'+source.id};
    }
  }
});

test('hard caps and inverse damage caps reject impossible upgrades before consuming anything',()=>{
  for(const [type,bounds]of Object.entries(pool.EFFECT_BOUNDS)) {
    const source=current({id:'at-cap-'+type,equipSlot:'本命法寶',effects:[{type,value:type==='equip_damage_cap_percent'?bounds.min:bounds.max}]});
    assert.throws(()=>pool.refineEffects([], [source]),/已達上限/);
  }
  const source=current({id:'inverse',equipSlot:'本命法寶',effects:[{type:'equip_damage_cap_percent',value:.4}]});
  const effect=pool.refineEffects([], [source])[0];assert.equal(effect.value,.34);
  assert.throws(()=>pool.assertRefinementImproves({...source,effects:[{type:effect.type,value:.39}]},[source]),/必須保留並提升/);
});

test('API disregards malformed stored-style bounds and the prompt and output remain system-owned',async()=>{
  let handler,prompt;
  api({get(){},post(_path,fn){handler=fn;}});
  const source=pool.ITEMS[0];
  const payload={selectedIngredients:[{id:source.id,type:'artifact',quantity:1},{id:'iron',type:'material',quantity:1}],existingArtifacts:[source],allMaterials:[{id:'iron',name:'玄鐵',realm:'金丹'}]};
  const original=router.generateJSON;
  try {
    router.generateJSON=async text=>{prompt=text;return {data:{name:'系統精煉',effects:[{type:'equip_attack_flat',value:1e20}]}};};
    const invoke=async bounds=>{const res={set(){},status(code){this.code=code;return this;},json(body){this.body=body;}};await handler({body:{...payload,effectBoundsV2:bounds},get:()=>''},res);return res;};
    const regular=await invoke({}),malicious=await invoke({'2':{equip_attack_flat:{min:99999999,max:99999999}}}),invalid=await invoke('corrupted');
    assert.deepEqual(regular.body.artifact,malicious.body.artifact);assert.deepEqual(regular.body.artifact,invalid.body.artifact);
    assert.equal(regular.body.artifact.soulboundBalanceVersion,pool.BALANCE_VERSION);
    assert.match(prompt,/不可變更的系統硬上下限/);assert.doesNotMatch(prompt,/99999999/);
    pool.assertRefinementImproves(regular.body.artifact,[source]);
  } finally {router.generateJSON=original;}
});

test('editing an item cannot restore the obsolete 12 percent combo cap or exceed fixed numeric limits',()=>{
  const source=fs.readFileSync('public/cultivation/admin-artifact-manager.js','utf8');
  const start=source.indexOf('  function readEffects(modal) {'),end=source.indexOf('\n  function ',start+10);
  assert.ok(start>0&&end>start);
  const context={QASoulboundPool:pool,effectUsesValue:()=>true};
  vm.runInNewContext(source.slice(start,end)+'\nthis.read=readEffects;',context);
  const effects=[['equip_combo_chance',.25],['equip_attack_flat',99999],['equip_hp_percent',99999]];
  const rows=effects.map(([type,value])=>({querySelector:selector=>({value:selector==='[data-aam-effect-type]'?type:String(value)})}));
  const result=context.read({querySelector:()=>({value:'本命法寶'}),querySelectorAll:()=>rows});
  assert.deepEqual(Array.from(result,e=>e.value),[.25,3000,2]);
});

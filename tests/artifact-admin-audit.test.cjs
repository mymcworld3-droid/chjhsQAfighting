'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const pool=require('../public/cultivation/soulbound-pool.js'),audit=require('../public/cultivation/artifact-admin-rules.js');
const read=f=>fs.readFileSync('public/cultivation/'+f,'utf8');
function catalog(){return vm.runInNewContext(read('artifact-catalog.js').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\n({normalizeArtifactDefinition,getDefaultArtifactCatalog});',{QASoulboundPool:pool,QAArtifactAdminRules:audit});}
const custom=(id='custom-sword',value=500)=>({id,name:'自定劍',realm:'金丹',category:'裝備法寶',equipSlot:'本命法寶',effects:[{type:'equip_attack_flat',value}]});
test('manual and AI custom artifacts precede all official items, even official pending items',()=>{
 const defaults=['official'];const original=[{id:'official',reviewStatus:'pending',generatedAtMs:999999},pool.ITEMS[0],{...custom('manual',100),customArtifact:true},{...custom('ai',100),generatedByAI:true}];
 const result=audit.ordered(original,defaults);
 assert.deepEqual(result.slice(0,2).map(i=>i.id),['manual','ai']);assert.deepEqual(original.map(i=>i.id),['official',pool.ITEMS[0].id,'manual','ai']);
 assert.equal(audit.custom(pool.ITEMS[0],[]),false);
});
test('within custom items warnings take priority, then pending review and newest creation',()=>{
 const items=[{...custom('approved',100),generatedAtMs:30},{...custom('pending',100),reviewStatus:'pending',generatedAtMs:1},custom('warning',500),{...custom('newer',100),generatedAtMs:40}];
 assert.deepEqual(audit.ordered(items).map(i=>i.id),['warning','pending','newer','approved']);
});
test('raw, inverse and duplicate numeric limits are diagnosed without weakening gameplay clamps',()=>{
 const raw=custom();raw.effects.push({type:'equip_damage_cap_percent',value:.1},{type:'equip_hp_flat',value:500},{type:'equip_hp_flat',value:500});
 const before=structuredClone(raw),warnings=audit.warnings(raw);
 assert.ok(warnings.some(w=>w.type==='equip_attack_flat'&&w.value===500&&w.max===200));
 assert.ok(warnings.some(w=>w.type==='equip_damage_cap_percent'&&w.min===.35));
 assert.ok(warnings.some(w=>w.type==='equip_hp_flat'&&w.value===1000&&w.max===800));
 assert.deepEqual(raw,before);
 const normalized=catalog().normalizeArtifactDefinition(raw);
 assert.deepEqual(Array.from(normalized.effects,e=>e.value),[200,.35,500]);
 assert.equal(normalized.statLimitWarnings.length,3);
});
test('original violation values survive normalization, saves and reloads, and explicit corrected saves clear warnings',()=>{
 const C=catalog(),raw={...custom(),customArtifact:true,customUpdatedAtMs:123};
 const saved=JSON.parse(JSON.stringify(C.normalizeArtifactDefinition(raw)));
 assert.equal(saved.effects[0].value,200);assert.equal(saved.statLimitWarnings[0].value,500);
 assert.deepEqual(JSON.parse(JSON.stringify(C.normalizeArtifactDefinition(saved))),saved);
 const corrected=C.normalizeArtifactDefinition({...saved,effects:[{type:'equip_attack_flat',value:150}],statLimitWarnings:[]});
 assert.equal(corrected.statLimitWarnings,undefined);assert.equal(corrected.customArtifact,true);assert.equal(corrected.customUpdatedAtMs,123);
});
test('ordinary percentage diagnostics use their own limits, and nonnumeric input is reported',()=>{
 assert.equal(audit.warnings({...custom(),equipSlot:'護身法寶',effects:[{type:'equip_combo_chance',value:.2}]}).length,1);
 assert.equal(audit.warnings(custom('valid',100)).length,0);
 assert.equal(audit.warnings(custom('bad','Infinity'))[0].value,'Infinity');
});
test('management warnings escape item content and describe the submitted value and actual cap',()=>{
 const source=read('admin-artifact-manager.js'),start=source.indexOf('  function artifactWarningsMarkup('),end=source.indexOf('  function render()',start);
 const ctx={QAArtifactAdminRules:audit,EFFECT_GUIDE:{equip_attack_flat:{title:'固定攻擊'}},escapeHtml:x=>String(x).replaceAll('<','&lt;')};
 vm.runInNewContext(source.slice(start,end)+'\nthis.markup=artifactWarningsMarkup;',ctx);
 const html=ctx.markup(custom());assert.match(html,/原始數值超出限制/);assert.match(html,/500/);assert.match(html,/1～200/);assert.match(html,/role="status"/);
});

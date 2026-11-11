#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8'),save=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const patch=(p,fn)=>save(p,fn(read(p)));
const one=(s,a,b='')=>{const n=s.indexOf(a);assert(n>=0,'Missing anchor '+a);assert(s.indexOf(a,n+a.length)===-1,'Repeated anchor '+a);return s.slice(0,n)+b+s.slice(n+a.length)};
const ln=(s,a,b='')=>one(s,a+'\n',b?b+'\n':'');
const cut=(s,a,b,to='')=>{let i=s.indexOf(a),j=s.indexOf(b,i+a.length);assert(i>=0&&j>i,'Missing span '+a);return s.slice(0,i)+to+s.slice(j)};
const lines=(s,when,newLine)=>s.split('\n').map(x=>when(x)?newLine:x).join('\n');
const tr=s=>s.replace(/\n+$/,'')+'\n';
patch('server.js',s=>{
  s=ln(s,"const registerWeaponArmoryApi = require('./weapon-armory-api.cjs');");
  return ln(s,"registerWeaponArmoryApi(app);","app.use('/api/weapons',(_req,res)=>res.status(410).json({ok:false,error:'武器系統已停用，不再提供抽取、升階或裝備。'}));");
});
patch('public/cultivation/tactical-rules.js',s=>{
  s=one(s,"  const api=factory(typeof module==='object'&&module.exports?require('./weapon-system-rules.js'):root.QAWeapons);","  const api=factory();");
  s=one(s,"})(globalThis,W=>{","})(globalThis,()=>{");
  s=one(s,"  const basicFor=a=>W?.attackSkill(a?.weapon)||BASIC;","  const basicFor=()=>BASIC;");
  return ln(s,"      ...(W?.get(raw.weapon?.type)?{weapon:{version:W.VERSION,type:raw.weapon.type,realm:W.realmIndex(raw.weapon)}}:{}),");
});
patch('tactical-combat-api.cjs',s=>{
  s=ln(s,"const Weapons=require('./public/cultivation/weapon-system-rules.js');");
  const disarm=[
    "// Legacy in-progress battles had snapshot weapon multipliers; remove them once.",
    "function disarm(s){",
    "  if(!s)return s;",
    "  for(const a of s.actors||[]){",
    "    const w=a.weapon;",
    "    if(w&&!a.bot){",
    "      const n=Number(w.realm),mult=Number.isFinite(n)?1+.025*Math.max(0,Math.min(9,Math.floor(n))):1;",
    "      if(mult>1){a.atk=Math.max(1,Math.round(a.atk/mult));if(a.baseAtk)a.baseAtk=Math.max(1,Math.round(a.baseAtk/mult));}",
    "    }",
    "    delete a.weapon;",
    "  }",
    "  delete s.weaponRewards;",
    "  return s;",
    "}",
    ""
  ].join('\n');
  s=one(s,"function member(s,uid){",disarm+"function member(s,uid){");
  s=one(s,"  const out=copy(s);delete out.pending;","  const out=disarm(copy(s));delete out.pending;");
  s=one(s,"function playerActor(user,uid,selection,catalog,armory){","function playerActor(user,uid,selection,catalog){");
  s=cut(s,
    "  const weapon=Weapons.snapshot(armory),multiplier=Weapons.attackMultiplier(weapon);\n",
    "    core:type,branch,gender:",
    "  return {...trusted,enemyScaleAttack:trusted.atk,\n");
  s=one(s,"  const [users,pointers,armories]=await Promise.all([","  const [users,pointers]=await Promise.all([");
  s=one(s,
    "    Promise.all(people.map(a=>tx.get(db.collection(PLAYERS).doc(a.uid)))),\n    Promise.all(people.map(a=>tx.get(db.collection('weaponArmories').doc(a.uid))))",
    "    Promise.all(people.map(a=>tx.get(db.collection(PLAYERS).doc(a.uid))))");
  s=cut(s,
    "      if(a.correct>0){const earned=Weapons.grantTrial(exists(armories[i]),campaign.stage);\n",
    "    }\n    if(reward){");
  s=one(s,"    const [pointerSnap,userSnap,catalogSnap,armorySnap]=await Promise.all([tx.get(pointerRef),tx.get(userRef),tx.get(db.collection('gameConfig').doc('artifactCatalogV1')),tx.get(db.collection('weaponArmories').doc(uid))]);",
      "    const [pointerSnap,userSnap,catalogSnap]=await Promise.all([tx.get(pointerRef),tx.get(userRef),tx.get(db.collection('gameConfig').doc('artifactCatalogV1'))]);");
  s=one(s,"    const prior=stored?.mode===mode?stored:null;","    const prior=stored?.mode===mode?disarm(stored):null;");
  s=one(s,"    const a=playerActor(user,uid,selection,exists(catalogSnap)||{},exists(armorySnap));",
      "    const a=playerActor(user,uid,selection,exists(catalogSnap)||{});");
  s=one(s,"  const stored=exists(await db.collection(ROOMS).doc(id).get());if(!stored||mode&&stored.mode!==mode)return null;",
      "  const stored=disarm(exists(await db.collection(ROOMS).doc(id).get()));if(!stored||mode&&stored.mode!==mode)return null;");
  s=one(s,"  const s=exists(await tx.get(db.collection(ROOMS).doc(id)));if(!s)throw error('戰場不存在',404);member(s,uid);return s;",
      "  const s=disarm(exists(await tx.get(db.collection(ROOMS).doc(id))));if(!s)throw error('戰場不存在',404);member(s,uid);return s;");
  s=one(s,"  const s=exists(await db.collection(ROOMS).doc(id).get()),a=member(s,uid);",
      "  const s=disarm(exists(await db.collection(ROOMS).doc(id).get())),a=member(s,uid);");
  return s;
});
patch('raid-authority.cjs',s=>cut(s,"async function loadTrustedRaidPlayer(db,uid){","\nfunction memberSnapshotFromTrusted(",[
  "async function loadTrustedRaidPlayer(db,uid){",
  "  const [userSnap,catalogSnap]=await Promise.all([",
  "    db.collection('users').doc(String(uid)).get(),",
  "    db.collection('gameConfig').doc('artifactCatalogV1').get().catch(()=>null)",
  "  ]);",
  "  if(!userSnap.exists)throw Object.assign(new Error('玩家資料不存在'),{status:404});",
  "  const user=userSnap.data()||{};",
  "  return trustedRaidPlayerSnapshot({...user,artifactSystem:{...(user.artifactSystem||{}),equipped:{}}},uid,catalogSnap?.exists?(catalogSnap.data()||{}):{});",
  "}",
  ""
].join('\n')));
patch('public/cultivation/tactical-combat.js',s=>{
  s=ln(s,"import './weapon-system-rules.js';");
  s=one(s,"||a.weapon&&a.uid===uid","");
  s=one(s,",a.weapon&&a.uid===uid?esc(globalThis.QAWeapons.get(a.weapon.type).label)+' · '+globalThis.QAWeapons.realmFor(a.weapon).name+'境':''","");
  s=lines(s,l=>l.includes("$('[data-combat-info]').innerHTML=state.actors.filter"),
    "  $('[data-combat-info]').innerHTML=state.actors.filter(a=>a.hp>0&&a.intent).map(a=>'<p><b>'+esc(a.name)+'</b><span>'+esc(a.intent.text)+'</span></p>').join('');");
  s=lines(s,l=>l.includes("$('[data-action=\"attack\"]').textContent="),
    "  $('[data-action=\"attack\"]').textContent='攻擊 · '+basic.cost;");
  // Eliminate weapon-only victory reward text, preserving gold and cultivation.
  const rewardLine=s.split('\n').find(l=>l.includes("state.weaponRewards?.[uid]?.chests"));
  assert(rewardLine,'Missing legacy weapon reward label');
  const cleaned=rewardLine.replace(/\$\{state\.weaponRewards\?\.\[uid\]\?\.chests\?' · 兵器匣 ×'\+state\.weaponRewards\[uid\]\.chests\+'（尋器頁開啟）':''\}/,'');
  assert.notEqual(cleaned,rewardLine,'Unable to remove legacy reward');
  return one(s,rewardLine,cleaned);
});
patch('public/cultivation/tactical-renderer.js',s=>ln(s,"import './weapon-system-rules.js';"));
patch('public/main.js',s=>{
  s=ln(s,"window.QA_WEAPON_SYSTEM_ENABLED = true;","window.QA_WEAPON_SYSTEM_ENABLED = false;");
  s=ln(s,"if(document.body)document.body.dataset.weaponSystem = '1';");
  return ln(s,"  './cultivation/weapon-forge.js',");
});
patch('public/index.html',s=>{
  return ln(s,'    <link rel="stylesheet" href="styles/weapon-forge.css">');
});
patch('public/cultivation/training-access-rules.js',s=>
  ln(s,"    { id: 'contract', name: '尋器', threshold: 6, realm: '築基期', tab: 'contract' },")
);
patch('public/cultivation/training-scene-layouts.js',s=>{
  const next=s.replace(/^.*\bcontract: place\('contract'.*\n/gm,'');
  assert.notEqual(next,s,'Missing weapon-draw map places');
  return next;
});
patch('public/cultivation/training-scene-map.js',s=>{
  s=one(s,"const tabPlace = { core: 'meditation', 'nascent-soul': 'meditation', refinery: 'forge', bag: 'vault', equipment: 'vault', contract: 'contract', status: 'status' };",
    "const tabPlace = { core: 'meditation', 'nascent-soul': 'meditation', refinery: 'forge', bag: 'vault', equipment: 'vault', status: 'status' };");
  return ln(s,"  { id: 'contract', name: '尋器', icon: 'fa-dharmachakra', threshold: 6, unlock: '築基期解鎖' },");
});
patch('public/cultivation/foundation-training-page.js',s=>{
  s=cut(s,"    if (window.QA_WEAPON_SYSTEM_ENABLED && tabs && !tabs.querySelector('[data-training-tab=\"contract\"]')) {",
    "    page.querySelectorAll('[data-training-tab]').forEach((tab) => {");
  s=cut(s,"    page.querySelector('[data-training-tab=\"contract\"]')?.addEventListener('click', () => {",
    "    page.querySelector('[data-training-tab=\"refinery\"]')?.addEventListener('click', () => {");
  s=cut(s,"      if(window.QA_WEAPON_SYSTEM_ENABLED){",
    "      // 同一個入口交給煉器模組負責狀態、內容與事件，避免兩個 click handler");
  s=ln(s,"      if(window.QA_WEAPON_SYSTEM_ENABLED){window.openWeaponForge?.();return;}");
  return one(s,"    page.classList.add('foundation-training-page', 'training-page', 'training-page-v3');",
    "    page.classList.add('foundation-training-page', 'training-page', 'training-page-v3');\n    page.querySelectorAll('[data-training-tab=\"contract\"]').forEach(button=>button.remove());");
});
patch('public/cultivation/cultivation-training-v4.js',s=>{
  s=cut(s,"    if(window.QA_WEAPON_SYSTEM_ENABLED&&['refinery','equipment','contract'].includes(activeTab)){",
    "    if (activeTab === 'refinery') {",
    "    if(activeTab==='contract')activeTab='bag';\n");
  s=ln(s,"           <button type=\"button\" class=\"training-subtab-v3\" data-training-tab=\"contract\" aria-selected=\"false\"><i class=\"fa-solid fa-dharmachakra\"></i><span>尋器</span></button>");
  s=cut(s,"    if (!tabs.querySelector('[data-training-tab=\"contract\"]')) {",
    "    if (page.dataset.trainingV4Bound !== '1') {");
  s=one(s,"    page.classList.add('training-page', 'training-page-v3');",
    "    page.classList.add('training-page', 'training-page-v3');\n    page.querySelectorAll('[data-training-tab=\"contract\"]').forEach(button=>button.remove());");
  s=one(s,"activeTab = ['bag', 'refinery', 'equipment', 'contract'].includes(requested) || (requested === 'nascent-soul' && nascentUnlocked()) ? requested : 'core';",
    "activeTab = ['bag','refinery','equipment'].includes(requested) || (requested === 'nascent-soul' && nascentUnlocked()) ? requested : 'core';");
  return ln(s,"    window.addEventListener('xiuxian:contract-page-opened', () => { activeTab = 'contract'; });");
});
for(const p of [
'weapon-armory-api.cjs',
'public/cultivation/weapon-system-rules.js','public/cultivation/weapon-forge.js',
'public/cultivation/weapon-showcase.js','public/cultivation/weapon-draw-reveal.js',
'public/styles/weapon-forge.css',
'public/assets/weapons/bow.webp','public/assets/weapons/hammer.webp',
'public/assets/weapons/saber.webp','public/assets/weapons/spear.webp',
'public/assets/weapons/sword.webp',
'tests/weapon-system.test.cjs','scripts/test-weapon-forge-browser.cjs'
]){assert(fs.existsSync(p),'Missing weapon file '+p);fs.rmSync(p);}
patch('tests/training-scene-map.test.cjs',s=>{
  s=one(s,"['forge', 'contract', 'vault', 'secret', 'status', 'rank']","['forge', 'vault', 'secret', 'status', 'rank']");
  s=cut(s,"test('compact contract entrance sits beside the forge and opens its existing tab', () => {",
    "test('entrance unlocks are monotonic through deductions and remote account restores', () => {",[
      "test('weapon-draw altar is removed but normal artifact forge is preserved',()=>{",
      "  assert.equal(Rules.PLACES.some(place=>place.id==='contract'),false);",
      "  assert.equal(Rules.PLACES.some(place=>place.id==='forge'),true);",
      "  for(const layout of Object.values(Layouts)){",
      "    assert.equal(layout.places.contract,undefined);",
      "    assert.ok(layout.places.forge);",
      "  }",
      "});",
      ""
    ].join('\n'));
  return tr(s);
});
save('tests/no-weapon-system.test.cjs',[
"'use strict';",
"const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');",
"const path=require('node:path');",
"const R=require('../public/cultivation/tactical-rules.js');",
"const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');",
"test('ordinary tactical attacks do not use weapon profiles',()=>{",
"  const a=R.actor({uid:'u',weapon:{type:'bow',realm:9}},{x:1,y:1});",
"  assert.equal(a.weapon,undefined);",
"  const basic=R.basicFor(a);",
"  assert.equal(basic.id,'attack');assert.equal(basic.cost,2);assert.equal(basic.range,2);assert.equal(basic.kind,'line');",
"  const s=R.create({id:'weaponless',players:[{uid:'u',maxHp:1000,atk:200,weapon:{type:'hammer',realm:8}}]});",
"  assert.equal(s.actors[0].weapon,undefined);",
"});",
"test('backend has no weapon inventory reads or effect grants',()=>{",
"  for(const p of ['tactical-combat-api.cjs','raid-authority.cjs'])",
"    assert.doesNotMatch(read(p),/weaponArmories|Weapons\\.|QAWeapons|weaponSystemV1/);",
"  assert.match(read('server.js'),/app\\.use\\('\\/api\\/weapons'.*410/);",
"  assert.doesNotMatch(read('server.js'),/registerWeaponArmoryApi/);",
"});",
"test('weapon pages and scripts no longer load',()=>{",
"  const main=read('public/main.js'),html=read('public/index.html');",
"  assert.doesNotMatch(main,/weapon-forge\\.js|QA_WEAPON_SYSTEM_ENABLED = true/);",
"  assert.doesNotMatch(html,/<button[^>]+data-training-tab=\"contract\"/);",
"  assert.doesNotMatch(read('public/cultivation/tactical-combat.js'),/QAWeapons|weaponRewards/);",
"  assert.doesNotMatch(read('public/cultivation/tactical-renderer.js'),/weapon-system-rules/);",
"  const access=require('../public/cultivation/training-access-rules.js');",
"  assert.equal(access.PLACES.some(x=>x.id==='contract'),false);",
"  assert.equal(access.PLACES.some(x=>x.id==='forge'),true);",
"});",
""
].join('\n'));
console.log('Retired five-weapon draw, forging and battle buffs; retained ordinary artifacts and saved inventory.');

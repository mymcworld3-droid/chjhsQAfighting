'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module');
const filename=require.resolve('../public/cultivation/manual-rules.js'),regular=require(filename);
const candidate=new Module(filename,module);candidate.filename=filename;candidate.paths=module.paths;
candidate._compile(fs.readFileSync(filename,'utf8').replace('const RELEASE_NEW_WEAPONS=false;','const RELEASE_NEW_WEAPONS=true;'),filename);
require.cache[filename].exports=candidate.exports;
const M=require(filename),D=require('../public/cultivation/new-weapon-drafts.js'),O=require('../public/cultivation/weapon-special-objects.js'),R=require('../public/cultivation/tactical-rules.js'),C=require('../public/cultivation/dungeon-skill-resolution.js'),Skills=require('../dungeon-skill-combat.cjs'),Drops=require('../weapon-dungeon-rewards.cjs');
const Animation=require('../public/cultivation/tactical-animation.js'),Effects=require('../public/cultivation/tactical-skill-effects.js');
const p=(x,y)=>({x,y}),origin=p(5,6),board={width:13,height:13,blocked:()=>false},map={width:13,height:13,tiles:Array(169).fill(1)},now=2000000000000;
const raw=b=>({school:b.school,books:{[b.id]:{exp:M.totalExpForLevel(10),refinement:2}},weaponIds:[b.id,null],skillLevels:Object.fromEntries(b.skills.map(s=>[s.id,3]))});
function objects(id){
 let state;
 const add=(type,position)=>{state=O.add(state,{type,position,board,ownerUid:'u',generatedAt:1,level:3,refinement:2});};
 if(id.startsWith('weave-')){add('mark',p(6,5));add('mark',p(8,5));add('mark',p(7,8));}
 if(id==='mirror-swap'||id==='mirror-strike')add('mirror');
 if(id.startsWith('time-')){add('echo',p(5,3));add('echo',p(8,6));}
 if(id==='gravity-crash')add('core',p(6,6));
 return state;
}
test('release candidate canonical catalog, growth, ownership and two equipped weapons',()=>{
 assert.equal(M.RELEASE_NEW_WEAPONS,true);assert.equal(M.BOOKS.length,12);assert.equal(Object.keys(M.BY_SKILL).length,36);
 for(const b of D.BOOKS){
  assert.equal(M.BY_BOOK[b.id],b);
  if(!regular.RELEASE_NEW_WEAPONS)assert.equal(regular.BY_BOOK[b.id],undefined);
  for(const level of [1,5,10,20]){
   const record=raw(b);record.books[b.id].exp=M.totalExpForLevel(level);
   assert.equal(M.normalize(record).equipped.length,level>=10?3:level>=5?2:1);
  }
  for(const s of b.skills){const scaled=M.skillAtLevel(s,5,5);assert.ok(Math.abs(scaled.power-s.power*1.75)<1e-9);assert.ok(M.descriptionWithDamage(100,scaled).length>0);}
 }
 const a=raw(D.BOOKS[0]),b=raw(D.BOOKS[1]);
 const both=M.normalize({...a,books:{...a.books,...b.books},weaponIds:[D.BOOKS[0].id,D.BOOKS[1].id]});
 assert.equal(both.equipped.length,6);
 assert.equal(M.normalize({...a,books:{}}).equipped.length,0);
});
for(const b of D.BOOKS)for(const sk of b.skills)test('candidate authorized casts in four modes: '+sk.id,()=>{
 const record=raw(b),normalized=M.normalize(record),id=sk.id;
 for(const mode of ['pve','pvp','weapon-dungeon']){
  const s=R.create({id:'release-test',mode:mode==='pvp'?'pvp':'pve',simultaneous:false,players:[{uid:'u',name:'u',atk:100,maxHp:10000,manualSkills:normalized.equipped,manualSkillLevels:record.skillLevels,manualRefinements:{[b.id]:2}},...(mode==='pvp'?[{uid:'v',name:'v',atk:100,maxHp:10000}]:[])],now});
  Object.assign(s,{width:13,height:13,blocks:[],objective:null,actors:s.actors.slice(0,2),...(objects(id)?{weaponObjects:objects(id)}:{})});
  Object.assign(s.actors[0],origin,{atk:100,stamina:10});Object.assign(s.actors[1],p(8,6),{hp:10000,maxHp:10000,shield:0,guard:0,counter:0,boss:false,footprint:{width:1,height:1}});
  if(mode==='weapon-dungeon')s.weaponDungeon={totemDamageMultiplier:1.15};
  const plan=R.skillPreviewPlan(s,s.actors[0],M.skillAtLevel(sk,3,2)),opts=id==='weave-thread'?Object.values(plan.byPair):Object.values(plan.byAim);
  assert.ok(opts.length,id+' '+mode);const best=opts.sort((a,b)=>b.hits.reduce((n,h)=>n+h.damage,0)-a.hits.reduce((n,h)=>n+h.damage,0))[0];
  const before=JSON.stringify(s),out=R.apply(s,'u',{type:'manual',skillId:id,x:best.aim.x,y:best.aim.y,first:best.first||null},now+1);
  assert.equal(JSON.stringify(s),before);assert.equal(out.actors[0].stamina,10-best.cost);assert.equal(out.actors[1].hp,10000-best.hits.reduce((n,h)=>n+h.damage,0));
  const scenes=Animation.plan(s,out,'u');const cast=scenes.find(scene=>scene.skill===id&&scene.weaponTimeline);assert.ok(cast,id+' committed V2 animation');
  const view={cell:40,ox:0,oy:0,width:13,height:13},snapshot=JSON.stringify(cast);let count=0;const ctx=new Proxy({}, {get:(o,k)=>o[k]||((...args)=>{count++;assert.ok(args.every(v=>typeof v!=='number'||Number.isFinite(v)),String(k));return k==='createLinearGradient'||k==='createRadialGradient'?{addColorStop(){}}:undefined;}),set:(o,k,v)=>{o[k]=v;return true;}});
  for(const above of [false,true])assert.equal(Effects.draw(ctx,cast,.5,view,above),true,id);assert.ok(count>0);assert.equal(JSON.stringify(cast),snapshot);
 }
 const baseMember={uid:'u',position:origin,battleAttack:100,battleHealth:10000,explorationStamina:10};
 const member={...baseMember,...Skills.initialCombatLoadout(baseMember,record)};
 const room={status:'assembled',battleAppliedTick:1,members:{u:member},enemies:[{id:'e',kind:'wolf',position:p(8,6),battleHealth:10000,battleMaxHealth:10000}],...(objects(id)?{weaponObjects:objects(id)}:{})};
 const plan=C.previewPlan(room,'u',map,member.dungeonSkills.find(s=>s.id===id)),opts=id==='weave-thread'?Object.values(plan.byPair):Object.values(plan.byAim);
 assert.ok(plan.exact&&opts.length,id);const best=opts.sort((a,b)=>b.totalDamage-a.totalDamage)[0];
 const cmd={skillId:id,target:best.aim,first:best.first||null,seq:1},out=Skills.castSkill(room,'u',map,record,cmd);
 assert.equal(out.result.totalDamage,best.totalDamage);assert.equal(out.members.u.explorationStamina,10-best.cost);
 assert.deepEqual(out.result.hits,best.hits);assert.deepEqual(best.landings,out.result.visualMoves.map(m=>m.to));assert.deepEqual(best.cells,[...new Map(out.cells.map(p=>[p.x+','+p.y,p])).values()]);
 assert.equal(Skills.castSkill({...room,...out},'u',map,record,cmd).duplicate,true);
 assert.throws(()=>Skills.castSkill(room,'u',map,{...record,books:{}},cmd),/尚未解鎖/);
});
test('each new weapon can drop from its native tier and refine duplicate copies',()=>{
 for(const b of D.BOOKS){
  const record={books:{},dropMisses:0,school:b.school},pool=M.BOOKS.filter(x=>x.tierRealm===b.tierRealm);
  const room={weaponDungeon:{realm:b.tierRealm,nextRealm:'真仙'}},rng=max=>max===100?0:pool.findIndex(x=>x.id===b.id);
  Drops.roll(room,'u',record,rng);assert.ok(record.books[b.id]);
  Drops.roll(room,'u',record,rng);assert.equal(M.refinementFor(record.books[b.id]),1);
 }
});
test('all 24 transparent candidate assets exist and are mapped',()=>{
 const path=require('node:path'),root=path.join(__dirname,'../public');
 const artSource=fs.readFileSync(path.join(root,'cultivation/manual-art.js'),'utf8');
 for(const b of D.BOOKS){
  const weapon='assets/weapons/'+b.id+'-hd.svg';assert.ok(fs.existsSync(path.join(root,weapon)),weapon);
  for(const sk of b.skills){const file='assets/skills/'+sk.id+'.svg';assert.ok(fs.existsSync(path.join(root,file)),file);assert.ok(artSource.includes(sk.id));}
 }
});

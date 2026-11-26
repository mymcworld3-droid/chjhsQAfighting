'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/cultivation/manual-rules.js'),W=require('../public/cultivation/weapon-presentation.js'),R=require('../weapon-dungeon-rewards.cjs');
test('fixed realm, legacy copies count, maximum five stars and no XP loss',()=>{
 const raw={books:{'sword-flight':{exp:180,tierRealm:'真仙',copies:{築基:2,真仙:2}}}};
 const n=M.weaponize(raw),b=n.books['sword-flight'];
 assert.equal(b.tierRealm,'築基');assert.equal(b.refinement,3);assert.equal(b.copies['築基'],4);assert.equal(b.exp,180);
 const room={weaponDungeon:{realm:'築基',nextRealm:'金丹'}};
 const drop=R.roll(room,'u',n,()=>0);assert.equal(drop.previousRefinement,3);assert.equal(drop.refinement,4);
 R.roll(room,'u',n,()=>0);R.roll(room,'u',n,()=>0);
 assert.equal(M.refinementFor(n.books['sword-flight']),5);assert.equal(M.copyCount(n.books['sword-flight']),7);
 assert.equal(n.books['sword-flight'].exp,180);
 assert.equal(R.roll({weaponDungeon:{realm:'真仙'}},'u',n,()=>0),null);
});
test('only achieved stars rendered and newly gained stars marked',()=>{
 assert.equal(W.refinementStars({refinement:0}),'');
 const s=W.refinementStars({refinement:3},{previous:2});assert.equal((s.match(/★/g)||[]).length,3);assert.equal((s.match(/is-new/g)||[]).length,1);
});
test('refinement buffs only that weapon damage and preserves focus cost',()=>{
 const s=M.BY_SKILL['wind-slash'];assert.equal(M.singleHitDamage(200,M.skillAtLevel(s,1,2)).damage,276);
 assert.equal(M.singleHitDamage(200,M.skillAtLevel(s,1)).damage,230);
 assert.equal(M.skillAtLevel(M.BY_SKILL['dragon-roar'],1,5).cost,7);
});
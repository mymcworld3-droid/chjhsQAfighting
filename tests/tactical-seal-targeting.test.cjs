'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const R=require('../public/cultivation/tactical-rules.js');
const Guide=require('../public/cultivation/tactical-seal-targeting.js');
const root=path.join(__dirname,'..');
const renderer=fs.readFileSync(path.join(root,'public/cultivation/tactical-renderer.js'),'utf8');
const combat=fs.readFileSync(path.join(root,'public/cultivation/tactical-combat.js'),'utf8');
const quarter=fs.readFileSync(path.join(root,'public/styles/tactical-quarter-controls.css'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles/tactical-combat.css'),'utf8');
const now=2000000000000;
function setup(points=[{x:3,y:2,kind:'shield',hp:2,maxHp:2,activated:false}]){
 const s=R.create({id:'seal-stage4',players:[{uid:'u',atk:100,maxHp:500}],
   trial:{seed:'seal-stage4',stage:8,layoutVersion:4},now});
 const hero=s.actors.find(a=>a.uid==='u');
 Object.assign(hero,{x:2,y:2,stamina:10,attacks:0,actions:0,answered:1,correct:1});
 s.turnUid='u';s.status='active';s.blocks=[];
 s.objective={type:'sealing',points,hazards:[],completed:false};
 return s;
}
const one=plan=>plan.seals[0];
test('attackable seal uses exact rules geometry and cost, move only invites attack',()=>{
 const s=setup(),attack=one(Guide.derive(s,'u','attack',R));
 assert.equal(Guide.active(s,R),true);
 assert.equal(attack.status,'ready');assert.equal(attack.hp,2);
 assert.deepEqual(attack.hitAim,{x:3,y:2});assert.match(attack.reason,/可命中/);
 assert.match(Guide.summary(attack,'attack'),/耐久 2\/2/);
 assert.equal(one(Guide.derive(s,'u','move',R)).status,'choose-attack');
 assert.equal(Guide.currentSkill(s.actors[0],'move',R),null);
});
test('resource, attack, action and waiting limits produce distinct messages',()=>{
 const s=setup(),hero=s.actors[0];
 hero.stamina=0;
 assert.equal(one(Guide.derive(s,'u','attack',R)).status,'stamina');
 assert.match(one(Guide.derive(s,'u','attack',R)).reason,/體力不足/);
 hero.stamina=10;hero.attacks=R.attackLimit(hero);
 assert.equal(one(Guide.derive(s,'u','attack',R)).status,'attack-limit');
 hero.attacks=0;hero.actions=R.LIMITS.actions;
 assert.equal(one(Guide.derive(s,'u','attack',R)).status,'action-limit');
 hero.actions=0;s.turnUid='monster-0';
 assert.equal(one(Guide.derive(s,'u','attack',R)).status,'wait');
});
test('range, sight, non-damaging skills and broken seals never promise hits',()=>{
 const s=setup([{x:8,y:2,kind:'rage',hp:2,maxHp:2,activated:false}]);
 assert.equal(one(Guide.derive(s,'u','attack',R)).status,'out-of-reach');
 assert.match(one(Guide.derive(s,'u','attack',R)).reason,/無法命中/);
 s.objective.points[0].x=4;s.blocks=[{x:3,y:2,kind:'rock'}];
 const blocked=one(Guide.derive(s,'u','attack',R));
 assert.equal(blocked.status,'out-of-reach');assert.match(blocked.reason,/石障/);
 const target=s.objective.points[0],hero=s.actors[0];
 assert.equal(Guide.reaches(s,hero,{kind:'meteor',range:4},target,R),null);
 assert.equal(Guide.reaches(s,hero,{kind:'restore',range:4},target,R),null);
 assert.equal(Guide.reaches(s,hero,{kind:'fist-focus',range:0},target,R),null);
 s.objective.points[0].activated=true;
 assert.equal(Guide.derive(s,'u','attack',R).seals[0].status,'broken');
});
test('no v4 tutorial or attack statuses for legacy and nonsealing modes',()=>{
 const s=setup();s.trial.layoutVersion=3;
 assert.equal(Guide.active(s,R),false);
 assert.deepEqual(Guide.derive(s,'u','attack',R).seals,[]);
 s.trial.layoutVersion=4;s.objective.type='elimination';
 assert.equal(Guide.active(s,R),false);
 s.objective.type='sealing';s.mode='pvp';
 assert.equal(Guide.active(s,R),false);
});
test('real attacks reduce endurance and log named seal damage and broken effects',()=>{
 let s=setup();s=R.apply(s,'u',{type:'attack',x:3,y:2},now);
 assert.equal(s.objective.points[0].hp,1);
 assert(s.events.some(e=>/護靈陣眼受擊 · 耐久 1\/2/.test(e.text)));
 s=R.apply(s,'u',{type:'attack',x:3,y:2},now);
 assert.equal(s.objective.points[0].activated,true);
 assert(s.events.some(e=>/護靈陣眼已破除/.test(e.text)));
 assert.equal(s.status,'finished');
});
test('renderer caches targeting and paints objective badges behind characters',()=>{
 assert(renderer.includes("import './tactical-seal-targeting.js"));
 assert(renderer.includes('this.sealTargetPlan=SealTargets.derive(state,uid,mode,R)'));
 assert(renderer.includes("this.onSealPeek(seal,'pin')"));
 const draw=renderer.slice(renderer.indexOf('  draw(){'));
 const art=draw.indexOf("this.sprite('seals'");
 const aim=draw.indexOf("for(const seal of this.sealTargetPlan.seals)");
 const actors=draw.indexOf('const positions=actors.filter(R.alive).sort((a,b)=>a.y-b.y);');
 assert(art>=0&&aim>art&&actors>aim);
 assert.equal(draw.indexOf('SealTargets.derive('),-1);
 assert(renderer.includes("ready?'#173f34ec'"));
});
test('guide and target selection are safe in touch wheel and keyboard',()=>{
 assert(combat.includes('data-seal-guide-dismiss'));
 assert(combat.includes('data-seal-guide-help'));
 assert(combat.includes('localStorage.setItem(key'));
 assert(combat.includes("if((action==='move'||action==='sword-move')&&selectedSeal?.active)"));
 assert(combat.includes("!(selectedSeal?.active&&(action==='move'||action==='sword-move'))"));
 assert(combat.includes('if(!error&&!affected.some(p=>'));
 assert(combat.includes("guidance.status!=='ready'"));
 assert(combat.includes('refreshSealTargetGuidance()'));
 assert(css.includes('.tc-seal-guide[hidden]'));
 assert(quarter.includes('.tc-arena>.tc-seal-guide:not([hidden])'));
});

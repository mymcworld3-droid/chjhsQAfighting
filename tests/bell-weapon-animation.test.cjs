'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../public/cultivation/bell-weapon-rules.js'),D=require('../public/cultivation/new-weapon-drafts.js'),R=require('../public/cultivation/tactical-rules.js'),C=require('../public/cultivation/dungeon-skill-resolution.js'),W=require('../public/cultivation/weapon-effects.js'),A=require('../public/cultivation/tactical-animation.js');
const p=(x,y)=>({x,y}),origin=p(6,6),sk=id=>D.skillAtLevel(id,1,0);
const map={width:13,height:13,tiles:Array(169).fill(1)};
const room=()=>({status:'assembled',battleAppliedTick:0,members:{u:{uid:'u',position:origin,battleHealth:10000,explorationStamina:10}},enemies:[{id:'e',kind:'wolf',position:p(7,6),battleHealth:1000,battleMaxHealth:1000}]});
test('four committed echo waves drive consecutive motion, numbers and sound without final-position jumps',()=>{
  const out=C.resolveCast(room(),'u',map,sk('bell-echo'),{target:origin,seq:1,base:100});
  const t=W.normalize(out.result.weaponTimeline);assert.ok(t);assert.equal(out.result.visualVersion,2);
  assert.deepEqual(t.segments.map(s=>[s.start,s.impact,s.end,s.waveFrom,s.radius]),[[0,110,220,0,1],[110,220,330,1,2],[220,330,440,2,3],[330,440,600,3,4]]);
  assert.deepEqual(t.segments.map(s=>s.moves[0].path),[[p(7,6),p(8,6)],[p(8,6),p(9,6)],[p(9,6),p(10,6)],[p(10,6),p(11,6)]]);
  assert.equal(W.numberFrames(t,109/600).length,0);
  for(let i=0;i<4;i++){
    assert.equal(W.motionPose(t,'e',(110*(i+1))/600).x,7+i);
    const mid=110*(i+1)+(i===3?80:55);
    assert.ok(W.motionPose(t,'e',mid/600).x>7+i&&W.motionPose(t,'e',mid/600).x<8+i);
    assert.ok(W.numberFrames(t,(110*(i+1)+1)/600).some(h=>h.uid==='e'&&h.damage===65));
  }
  assert.equal(W.motionPose(t,'e',1).x,11);
  assert.deepEqual(W.bellSoundCues(t,'bell-echo').map(c=>c.at),[110,220,330,440]);
  const played=new Set(),calls=[];
  for(let ms=0;ms<600;ms++)W.advanceBellSound(t,'bell-echo',ms,played,(id,opts)=>calls.push([id,opts.key]),'cast');
  assert.deepEqual(calls,Array.from({length:4},(_,i)=>['bell-wave','cast:bell:'+i]));
  const late=[];W.advanceBellSound(t,'bell-echo',445,new Set(),id=>late.push(id),'late');assert.deepEqual(late,['bell-wave']);
});
test('trial echo groups damage and displacements without duplicating a counter or overriding final position',()=>{
  const s=R.create({id:'bell-vfx',mode:'pve',players:[{uid:'u',name:'u',atk:100,maxHp:10000,manualSkills:[]}],now:2000000000000});
  Object.assign(s,{width:13,height:13,blocks:[],objective:null,actors:s.actors.slice(0,2)});
  Object.assign(s.actors[0],{...origin,atk:100,stamina:10,shield:0});
  const enemy=s.actors[1];Object.assign(enemy,{x:7,y:6,hp:1000,maxHp:1000,shield:20,guard:0,counter:.1,atk:100,boss:false,footprint:{width:1,height:1}});
  const saved=JSON.stringify(s),out=R.previewCast(s,s.actors[0],sk('bell-echo'),origin);
  assert.equal(JSON.stringify(s),saved);
  const t=W.normalize(out.weaponTimeline);assert.ok(t);
  const hits=t.segments.flatMap(s=>s.hits);
  assert.equal(hits.filter(h=>h.uid==='u').length,1);assert.equal(hits.find(h=>h.uid==='u').damage,10);
  assert.equal(hits.filter(h=>h.uid===enemy.uid).reduce((n,h)=>n+h.damage,0),240);
  const previous={...s,events:[],revision:1},changes=[{uid:'u',hp:s.actors[0].hp-10},{uid:enemy.uid,hp:760,shield:0,x:11,y:6}];
  const next={...previous,revision:2,events:[{id:'2:1',actor:'u',type:'cast',skill:'bell-echo',animation:{kind:'cast',style:'bell-echo',weaponGroup:'g',weaponTimeline:t,changes}},{id:'2:2',actor:'u',type:'damage',animation:{kind:'damage',weaponGroup:'g'}},{id:'2:3',actor:enemy.uid,type:'displace',path:[p(7,6),p(8,6)],animation:{kind:'move',weaponGroup:'g'}}]};
  const scenes=A.plan(previous,next,'u');assert.equal(scenes.length,1);
  const end=A.sample(scenes[0],1).find(a=>a.uid===enemy.uid);
  assert.equal(end.x,11);assert.equal(end.hp,760);
});
test('bell render is bounded, finite and read-only in both normal and reduced layers',()=>{
  for(const [id,target,duration] of [['bell-strike',p(7,6),260],['bell-shock',origin,350],['bell-echo',origin,600]]){
    const result=C.resolveCast(room(),'u',map,sk(id),{target,seq:1,base:100}).result;
    const t=W.normalize(result.weaponTimeline);assert.ok(t);assert.equal(t.durationMs,duration);
    const saved=JSON.stringify(t);
    for(const reduced of [false,true])for(const above of [false,true]){
      let depth=0,draws=0;
      const ctx=new Proxy({},{
        get(o,k){if(k in o)return o[k];return (...args)=>{if(k==='save')depth++;if(k==='restore')depth--;if(k==='stroke'||k==='fillRect'||k==='strokeRect')draws++;for(const v of args)if(typeof v==='number')assert.ok(Number.isFinite(v));}},
        set(o,k,v){if(typeof v==='number')assert.ok(Number.isFinite(v));o[k]=v;return true;}
      });
      for(let ms=0;ms<=duration;ms+=10){
        assert.equal(W.draw(ctx,t,ms/duration,{ox:0,oy:0,cell:36},above,{reduced}),true);
        if(above)W.drawNumbers(ctx,t,ms/duration,{ox:0,oy:0,cell:36},[{uid:'e',x:7,y:6}]);
        assert.equal(depth,0);
      }
      assert.ok(draws>0);
    }
    assert.equal(JSON.stringify(t),saved);
  }
});

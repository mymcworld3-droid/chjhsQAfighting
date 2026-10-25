/* Local training snapshots, computed with the same rules as real combat. */
(function(root,factory){
  const common=typeof module==='object'&&module.exports;
  const api=factory(common?require('./tactical-rules.js'):root.QATactical,common?require('./tactical-animation.js'):root.QATacticalAnimation);
  if(common)module.exports=api;else root.QATacticalDemo=api;
})(globalThis,(R,A)=>{
  'use strict';
  const HERO='demo-hero',NOW=2000000000000,clone=v=>JSON.parse(JSON.stringify(v));
  function base(species,turn=1){
    const p=R.monsterProfile(species),s=R.create({id:'enemy-demo-'+p.species,players:[{uid:HERO,name:'示範修士',atk:30,maxHp:1000}],now:NOW});
    s.width=9;s.height=7;s.blocks=[];s.turn=turn;s.terrain=2;
    Object.assign(s.actors[0],{x:5,y:3,stamina:10});
    Object.assign(s.actors[1],{x:3,y:3,species:p.species,name:p.name,atk:110,hp:1000,maxHp:1000});return s;
  }
  function escape(s){
    const hero=s.actors[0],cells=new Set(s.actors[1].intent.cells.map(R.key)),routes=[];
    for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){
      const p={x,y};if(cells.has(R.key(p))||R.at(s,p)||R.blocked(s,p))continue;
      const route=R.path(s,hero,p,HERO);if(route?.length>1&&route.length-1<=hero.stamina)routes.push(route);
    }
    return routes.sort((a,b)=>a.length-b.length||R.dist(a.at(-1),{x:4,y:3})-R.dist(b.at(-1),{x:4,y:3}))[0];
  }
  function attackState(species,turn){
    const s=base(species,turn),p=R.monsterProfile(species),hero=s.actors[0],monster=s.actors[1],candidates=[];
    for(let y=1;y<s.height-1;y++)for(let x=1;x<s.width-1;x++){
      if(x===monster.x&&y===monster.y)continue;Object.assign(hero,{x,y});R.prepareIntents(s);
      if(monster.intent.kind!=='attack')continue;
      const route=escape(s);if(!route)continue;
      candidates.push({x,y,score:monster.intent.cells.length*100-R.dist(hero,{x:5,y:3})*4+Math.min(p.attack.range,3)*R.dist(hero,monster)});
    }
    candidates.sort((a,b)=>b.score-a.score);if(!candidates.length)throw Error('No legal monster demonstration: '+species);
    Object.assign(hero,{x:candidates[0].x,y:candidates[0].y});R.prepareIntents(s);return s;
  }
  function quiet(state){const s=clone(state);for(const a of s.actors)if(a.bot)a.intent={kind:'wait',cells:[],text:''};return s;}
  function build(species){
    const profile=R.monsterProfile(species),beats=[];
    const hold=(state,label,phase,duration=1200)=>beats.push({state:clone(state),scene:null,label,phase,duration});
    const action=(before,after,phase,label)=>{
      for(const scene of A.plan(before,after,HERO).filter(s=>s.kind!=='turn')){
        beats.push({state:clone(before),scene,label:label||scene.label,phase,duration:Math.max(650,scene.duration*1.7)});
      }
    };
    const moving=base(profile.species);Object.assign(moving.actors[1],{x:1,y:3});Object.assign(moving.actors[0],{x:6,y:3});
    if(profile.move.minDistance)Object.assign(moving.actors[0],{x:2,y:3});
    if(['leap','hop','fly','teleport'].includes(profile.move.kind)){
      Object.assign(moving.actors[0],{x:6,y:3});moving.blocks=[{x:2,y:3,kind:'rock'}];
    }
    R.prepareIntents(moving);
    hold(moving,'移動示範 · '+profile.moveName,'movement',700);
    const moved=R.apply(moving,HERO,{type:'end'},NOW);action(moving,moved,'movement','移動示範 · '+profile.moveName);
    hold(quiet(moved),profile.moveText,'movement',1000);
    for(const turn of profile.attack.shape==='guardian'?[1,2]:[1]){
      const first=beats.length;
      const warning=attackState(profile.species,turn),cells=warning.actors[1].intent.cells;
      const name=warning.actors[1].intent.text.replace(/^下次：/,'');
      hold(warning,name+' · 站在紅框內會被命中','warning',1600);
      const hit=R.apply(warning,HERO,{type:'end'},NOW);action(warning,hit,'hit');
      hold(quiet(hit),'命中示範 · 生命 −'+(warning.actors[0].hp-hit.actors[0].hp),'hit',1000);
      hold(warning,'閃避示範 · 先離開所有紅框','dodge-warning',1400);
      const route=escape(warning),destination=route.at(-1),dodged=R.apply(warning,HERO,{type:'move',...destination},NOW);
      action(warning,dodged,'escape','移至沒有紅框的安全格');
      hold(dodged,'紅框仍鎖定原位置，現在結束回合','safe',1000);
      const missed=R.apply(dodged,HERO,{type:'end'},NOW);action(dodged,missed,'miss');
      hold(quiet(missed),'成功閃避 · 生命不減','success',1500);
      // Retain the exact warning footprint for accessible/manual demonstrations.
      for(const beat of beats.slice(first))beat.warning=cells.map(p=>({...p}));
    }
    let elapsed=0;for(const beat of beats){beat.start=elapsed;elapsed+=beat.duration;}
    // Keep all real routes and warning cells visible while using the compact
    // introduction canvas efficiently. This only crops the camera, not rules.
    const points=beats.flatMap(b=>[...b.state.actors,...b.state.blocks,...b.state.actors.flatMap(a=>a.intent?.cells||[]),
      ...(b.warning||[]),...(b.scene?.cells||[]),...(b.scene?.before||[]),...(b.scene?.after||[]),...(b.scene?.moves||[]).flatMap(m=>m.path)]);
    const x=Math.max(0,Math.min(...points.map(p=>p.x))-1),y=Math.max(0,Math.min(...points.map(p=>p.y))-1);
    const right=Math.min(8,Math.max(...points.map(p=>p.x))+1),bottom=Math.min(6,Math.max(...points.map(p=>p.y))+1);
    return {species:profile.species,hero:HERO,beats,duration:elapsed,view:{x,y,width:right-x+1,height:bottom-y+1}};
  }
  return Object.freeze({build,escape,attackState});
});

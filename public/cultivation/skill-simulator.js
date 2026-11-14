import './manual-rules.js';
import './tactical-rules.js';
import {TacticalRenderer} from './tactical-renderer.js';

const R=globalThis.QATactical,Manuals=globalThis.QAManuals;
const uid='practice-player',canvas=document.getElementById('battle');
const $=selector=>document.querySelector(selector);
const controls=['#school','#skill','#reset','#reset-view','#next-turn','#cast-self','#free-cast'];
const hints={
  cast:'點擊紅色或金色格子施放招式。飛劍可再次施放來移動。',
  hero:'點擊空格放置角色。',
  monster:'點擊空格放置靈獸，再點靈獸可移除。',
  block:'點擊空格放置障礙，再點障礙可移除。'
};
const techniques=[];
for(const book of Manuals.BOOKS)for(const skill of book.skills){
  if(!techniques.some(item=>item.moveId===skill.moveId))techniques.push(skill);
}
let chosen=techniques[0],tool='cast',state,renderer,nextBeast=0;
const hero=()=>state.actors.find(actor=>actor.uid===uid);
const announce=text=>{$('#message').textContent=text;};
function newBattle(){
  const battle=R.create({id:'manual-practice-'+Date.now(),mode:'pve',players:[{
    uid,name:'修士',atk:200,maxHp:20000,trainingAccessScore:1868,manualSkills:[chosen.id]
  }]});
  battle.width=11;battle.height=9;battle.ground=Array(99).fill(0);battle.blocks=[];
  const player=battle.actors[0];Object.assign(player,{x:3,y:4,stamina:10});
  battle.actors=[player,...[[6,3],[6,4],[6,5],[8,4]].map(([x,y],index)=>
    R.actor({uid:'practice-beast-'+index,name:'靈獸',team:'monster',bot:true,
      species:index%2?8:0,atk:50,maxHp:5000,level:1},{x,y}))];
  R.prepareIntents(battle);
  return battle;
}
function refreshControls(){
  if(!state)return;
  const player=hero(),busy=renderer?.isAnimating||false;
  for(const selector of controls)$(selector).disabled=busy;
  document.querySelectorAll('[data-tool]').forEach(button=>{
    button.disabled=busy;
    button.setAttribute('aria-pressed',String(button.dataset.tool===tool));
  });
  const focus=R.focusTurns(player);
  $('#actor-status').textContent=`體力 ${player.stamina} / ${R.LIMITS.stamina} · 出手 ${player.attacks} / ${R.attackLimit(player)}`+
    (focus?` · 蓄勢 ${focus} 回合`:'');
  $('#battle-status').textContent=state.status==='finished'?'本場演武已結束，請重置戰場':hints[tool];
  $('#tool-hint').textContent=hints[tool];
  $('#cast-self').hidden=chosen.range!==0||tool!=='cast';
  $('#cast-self').disabled=busy||state.status!=='active';
  $('#next-turn').disabled=busy||state.status!=='active';
  $('#glyph').textContent=chosen.school==='sword'?'劍':'拳';
  $('#skill-name').textContent=chosen.name;
  $('#skill-stats').textContent=`${chosen.cost} 體力 · ${chosen.unlimited?'無固定射程':chosen.range===0?'自身':chosen.range+' 格'}`;
  $('#skill-description').textContent=chosen.description;
}
function render(selection=null){
  if(!state||!renderer)return;
  renderer.update(state,uid,tool==='cast'?'manual:'+chosen.id:'inspect',selection);
  refreshControls();
}
function setSkill(id){
  const next=techniques.find(skill=>skill.id===id);
  if(!next)return;
  chosen=next;
  const copy=structuredClone(state);
  copy.actors.find(actor=>actor.uid===uid).manualSkills=[chosen.id];
  copy.revision++;
  state=copy;
  setTool('cast');
  announce('');
}
function updateSkillOptions(){
  const school=$('#school').value,select=$('#skill');
  const available=techniques.filter(item=>item.school===school);
  select.replaceChildren(...available.map(skill=>{
    const option=document.createElement('option');option.value=skill.id;option.textContent=skill.name;return option;
  }));
  $('#skill-count').textContent=available.length+' 招';
  setSkill(available[0].id);
}
function setTool(value){
  tool=value;
  render();
}
function prepareCast(){
  const current=structuredClone(state),player=current.actors.find(actor=>actor.uid===uid);
  if($('#free-cast').checked){
    player.stamina=R.LIMITS.stamina;player.attacks=0;player.actions=0;player.cooldowns={};
  }
  return current;
}
function castAt(point){
  if(state.status!=='active'){announce('請先重置戰場。');return;}
  try{
    const current=prepareCast();
    state=R.apply(current,uid,{type:'manual',skillId:chosen.id,...point});
    announce('');
    render();
  }catch(error){announce(error.message);}
}
function editAt(point){
  const copy=structuredClone(state),player=copy.actors.find(actor=>actor.uid===uid);
  const actor=R.at(copy,point),block=copy.blocks.find(item=>R.key(item)===R.key(point));
  if(tool==='hero'){
    if(block||actor&&actor.uid!==uid){announce('此格已有靈獸或障礙。');return;}
    Object.assign(player,point);
  }else if(tool==='monster'){
    if(block||actor?.uid===uid){announce('此格已有角色或障礙。');return;}
    if(actor)copy.actors=copy.actors.filter(item=>item.uid!==actor.uid);
    else copy.actors.push(R.actor({uid:'placed-beast-'+(++nextBeast),name:'靈獸',
      team:'monster',bot:true,species:0,atk:50,maxHp:5000,level:1},point));
  }else if(tool==='block'){
    if(actor){announce('此格已有角色或靈獸。');return;}
    if(block)copy.blocks=copy.blocks.filter(item=>R.key(item)!==R.key(point));
    else copy.blocks.push({...point,kind:'stone'});
  }
  copy.revision++;
  if(copy.status==='active')R.prepareIntents(copy);
  state=copy;announce('');render();
}
function onTile(point){
  if(tool==='cast')castAt(point);
  else editAt(point);
}
function start(){
  state=newBattle();
  renderer=new TacticalRenderer(canvas,onTile,refreshControls);
  $('#school').addEventListener('change',updateSkillOptions);
  $('#skill').addEventListener('change',event=>setSkill(event.target.value));
  document.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>setTool(button.dataset.tool)));
  $('#cast-self').addEventListener('click',()=>castAt({x:hero().x,y:hero().y}));
  $('#reset').addEventListener('click',()=>{
    state=newBattle();announce('');render();
  });
  $('#reset-view').addEventListener('click',()=>renderer.resetView());
  $('#next-turn').addEventListener('click',()=>{
    try{state=R.apply(state,uid,{type:'end'});announce('');render();}
    catch(error){announce(error.message);}
  });
  updateSkillOptions();
}
start();

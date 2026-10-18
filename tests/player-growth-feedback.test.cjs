const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Rules = require('../public/cultivation/player-growth-rules.js');
const Contribution = require('../public/cultivation/combat-contribution.js');
const Difficulty = require('../public/cultivation/raid-difficulty.js');
const Learning = require('../public/cultivation/solo-learning-rules.js');
const Authority = require('../raid-authority.cjs');
const {advanceRaidClock} = require('../raid-clock.cjs');

test('goal recipe access follows public, owner and purchased-guide permissions', () => {
  const sealed = {id:'sword',recipeOwnerUid:'owner',recipeSaleLocked:true};
  assert.equal(Rules.canReadRecipe({},sealed,'visitor'),false);
  assert.equal(Rules.canReadRecipe({},sealed,'owner'),true);
  assert.equal(Rules.canReadRecipe({recipeLicenses:{sword:true}},sealed,'visitor'),true);
  assert.equal(Rules.canReadRecipe({isAdmin:true},sealed,'visitor'),true);
  assert.equal(Rules.canReadRecipe({}, {id:'public'}, 'visitor'),true);
  assert.equal(Rules.canReadRecipe({}, {id:'locked',recipeSaleLocked:true}, 'visitor'),false);
  assert.equal(Rules.canReadRecipe({}, null, 'owner'),false);
});

test('material goals aggregate duplicate rows and reserve equipped artifacts', () => {
  const player = {materialSystem:{inventory:{iron:2}},artifactSystem:{inventory:{blade:2},equipped:{本命法寶:'blade'}}};
  const recipe = [{materialId:'iron',quantity:2},{materialId:'iron',quantity:3},{artifactId:'blade',quantity:2}];
  const original = structuredClone(player);
  const rows = Rules.ingredients(player,recipe,{getMaterial:()=>({name:'玄鐵'}),getArtifact:()=>({name:'劍'})});
  assert.deepEqual(rows.map(row=>[row.name,row.need,row.have,row.missing]),[['玄鐵',5,2,3],['劍',2,1,1]]);
  assert.deepEqual(player,original,'planning cannot consume or grant stock');
  const admin = Rules.ingredients({...player,isAdmin:true},recipe);
  assert.equal(admin[0].missing,0,'admin material privilege remains virtual');
  assert.equal(admin[1].missing,1,'admin cannot mint artifact ingredients');
});

test('resource shortcuts choose a difficulty that can actually drop the requested material', () => {
  assert.equal(Rules.materialSource('qi-spirit-wood',Difficulty.TIERS,68).difficulty,'normal');
  assert.equal(Rules.materialSource('golden-purple-iron',Difficulty.TIERS,68).difficulty,'hard');
  const locked = Rules.materialSource('nascent-star-iron',Difficulty.TIERS,28);
  assert.equal(locked.difficulty,'extreme'); assert.equal(locked.locked,true); assert.equal(locked.minRealm,'元嬰期');
});

test('stat comparisons include decreases and activation without inventing a zero baseline', () => {
  const before = {attack:{label:'攻擊',value:200},chance:{label:'機率',value:10,unit:'%'}};
  const after = {attack:{label:'攻擊',value:180},chance:{label:'機率',value:12.5,unit:'%'},crit:{label:'暴傷',value:150,unit:'%'}};
  const rows = Rules.statChanges(before,after);
  assert.equal(rows.find(row=>row.key==='attack').delta,-20);
  assert.equal(rows.find(row=>row.key==='chance').delta,2.5);
  assert.equal(rows.find(row=>row.key==='crit').before,null);
  assert.equal(rows.find(row=>row.key==='crit').delta,null);
  assert.equal(Rules.statChanges(after,after).length,0);
});

function growthFeedbackHarness() {
  const state = {uid:'u',power:1000,attack:200,hp:1000}, nodes = new Map(), frames = [];
  const window = {getCurrentUserData:()=>({uid:state.uid}),getCombatPower:()=>({total:state.power}),
    getCombatStats:()=>({attack:state.attack,maxHp:state.hp})};
  const document = {getElementById:id=>nodes.get(id),activeElement:null,
    createElement:()=>({setAttribute(){},querySelector:()=>({}),querySelectorAll:()=>[],remove(){nodes.delete(this.id);}}),
    body:{appendChild(node){nodes.set(node.id,node);}}};
  const context = {window,document,getMainUser:()=>({uid:state.uid}),Intl,setTimeout:()=>1,clearTimeout(){},
    requestAnimationFrame:fn=>frames.push(fn),performance:{now:()=>100},QAPlayerGrowth:Rules,QANascentGrowth:{}};
  const source = fs.readFileSync(require.resolve('../public/cultivation/player-growth-feedback.js'),'utf8')
    .replace(/^import .*;\n/gm,'').replace(/if \(document.readyState === 'loading'\)[\s\S]*$/,'');
  vm.runInNewContext(source+'\nrender = () => {}; this.api = {capture,observePower,schedule,resetObservation,animateComparison};',context);
  return {state,window,api:context.api,popup:()=>nodes.get('growth-comparison'),flush:()=>{while(frames.length)frames.shift()();},frames};
}

test('one strengthening card lists only changed values with power first and signed deltas, without action headings', () => {
  const h = growthFeedbackHarness(), before = h.api.capture();
  h.state.power=1200; h.state.attack=220;
  h.window.showGrowthComparison({uid:'u',title:'法器裝備後的變化',before,after:h.api.capture(),
    extra:[{label:'未變分支',before:{value:1},after:{value:1}}]});
  const html=h.popup().innerHTML;
  assert.match(html,/戰力/); assert.match(html,/1,000/); assert.match(html,/1,200/); assert.match(html,/\+200/);
  assert.match(html,/攻擊力/); assert.match(html,/\+20/);
  assert.ok(html.indexOf('戰力')<html.indexOf('攻擊力'));
  assert.doesNotMatch(html,/法器裝備後的變化|<header|生命上限|未變分支/);
  h.state.power=800; h.state.attack=180;
  h.window.showGrowthComparison({uid:'u',before:h.api.capture(),after:{combatPower:{label:'戰力',value:600,unit:''}}});
  assert.match(h.popup().innerHTML,/growth-decrease">-200/);
});

test('power watcher coalesces updates with explicit feedback, ignores login and tracks increases and decreases', () => {
  const h=growthFeedbackHarness();
  h.api.observePower(); assert.equal(h.popup(),undefined,'initial load is a baseline');
  const before=h.api.capture(); h.state.power=1500; h.state.attack=250;
  h.api.schedule(); h.api.schedule(); assert.equal(h.frames.length,1);
  h.window.showGrowthComparison({uid:'u',before,after:h.api.capture(),extra:[{label:'分支等級',before:{value:1},after:{value:2}}]});
  const explicit=h.popup(); h.flush(); assert.equal(h.popup(),explicit,'queued events cannot replace the explicit upgrade card');
  assert.match(h.popup().innerHTML,/分支等級/);
  h.state.power=500; h.api.schedule(); h.flush();
  assert.match(h.popup().innerHTML,/-1,000/);
  h.popup().remove(); h.state.uid='other'; h.state.power=9000; h.api.observePower();
  assert.equal(h.popup(),undefined,'account changes cannot compare different players');
  h.state.power=10000; h.api.resetObservation(); h.flush(); assert.equal(h.popup(),undefined,'hydration does not announce upgrades');
  h.window.showGrowthComparison({uid:'u',before,after:h.api.capture()}); assert.equal(h.popup(),undefined,'stale responses cannot show feedback');
});

test('unchanged stats do not create feedback and percent changes retain units', () => {
  const h=growthFeedbackHarness(), snapshot=h.api.capture();
  h.window.showGrowthComparison({uid:'u',before:snapshot,after:snapshot}); assert.equal(h.popup(),undefined);
  h.window.showGrowthComparison({uid:'u',before:{crit:{label:'暴擊率',value:10,unit:'%'}},after:{crit:{label:'暴擊率',value:12.5,unit:'%'}}});
  assert.match(h.popup().innerHTML,/\+2.5%/); assert.doesNotMatch(h.popup().innerHTML,/戰力/);
});

test('animated values use elapsed time, preserve units and settle exactly even after a suspended frame', () => {
  const h=growthFeedbackHarness();
  const nodes=[0,1].map(index=>({dataset:{growthValue:String(index)}}));
  const popup={isConnected:true,querySelectorAll:()=>nodes};
  const changes=[{before:{value:1000},after:{value:1500}},{before:{value:12.5},after:{value:10,unit:'%'}}];
  h.api.animateComparison(popup,changes);
  assert.equal(nodes[0].textContent,'1,000'); assert.equal(nodes[1].textContent,'12.5%');
  h.frames.shift()(550); // 450 ms since start: cubic easing is 87.5% complete.
  assert.equal(nodes[0].textContent,'1,438'); assert.equal(nodes[1].textContent,'10.31%');
  h.frames.shift()(5100);
  assert.equal(nodes[0].textContent,'1,500'); assert.equal(nodes[1].textContent,'10%');
  assert.equal(h.frames.length,0);
  h.api.animateComparison(popup,changes); popup.isConnected=false; h.frames.shift()(600);
  assert.equal(h.frames.length,0,'closed or replaced cards stop requesting frames');
  h.window.matchMedia=()=>({matches:true}); popup.isConnected=true;
  h.api.animateComparison(popup,changes);
  assert.equal(h.frames.length,0,'reduced motion keeps final markup and skips counting');
});

test('duel statistics use actual HP loss and exclude guarded reveal steps and overkill', () => {
  const outcome = {startHostHp:1000,startGuestHp:300,steps:[
    {actorRole:'host',type:'attack',damage:200,critical:true,hostHp:1000,guestHp:100},
    {actorRole:'guest',type:'counter',damage:50,hostHp:950,guestHp:100},
    {actorRole:'host',type:'attack',combo:true,damage:60,hostHp:950,guestHp:40},
    {actorRole:'host',type:'attack',combo:true,damage:90,hostHp:950,guestHp:0},
    {actorRole:'guest',type:'counter',guarded:true,damage:999,hostHp:950,guestHp:0}
  ]};
  const result = Contribution.battleRound(null,outcome);
  assert.equal(result.host.comboHits,2); assert.equal(result.host.comboDamage,100);
  assert.equal(result.host.criticalHits,1); assert.equal(result.guest.reflectedDamage,50);
  let accumulated = result;
  for(let round=1;round<15;round++) accumulated = Contribution.battleRound(accumulated,outcome);
  assert.equal(accumulated.host.comboHits,30); assert.equal(accumulated.host.comboDamage,1500);
  assert.equal(accumulated.host.rounds,15,'whole-match counters are independent of the 20-entry battle log cap');
  assert.match(Contribution.markup(accumulated.host,15),/30 次/);
  assert.match(Contribution.markup(result.host,2),/部分戰鬥紀錄/);
  assert.doesNotMatch(Contribution.markup(undefined),/0 次/,'unknown old-match counters are not presented as zero');
});

function member(uid='a') {
  return {uid,atk:200,hp:1000,maxHp:1000,totalScore:68,comboChance:.75,
    online:true,alive:true,heartbeatAtMs:100000,joinedAtMs:100000,lastBossActionSeen:0,
    artifactBattle:{version:1,effects:[]},artifactShield:0,coreShield:false,combatContribution:Contribution.normalize()};
}
test('server raid combo statistics cap overkill without changing combat resolution', () => {
  const original = member(); let result;
  for(let id=1;id<=50;id++) {
    result = Authority.resolvePlayerAction(original,{roomId:'growth-test',actionId:id,correct:true,bossHp:250});
    if(result.comboHits.length) break;
  }
  assert.equal(result.comboHits.length,1);
  assert.equal(result.damage,260,'the original combat damage is unchanged');
  assert.equal(result.member.combatContribution.comboDamage,50,'only 50 boss HP remained for the extra hit');
  assert.equal(result.member.combatContribution.comboHits,1);
  assert.equal(original.combatContribution.comboHits,0,'the pure resolver cannot mutate its input');
});

test('server boss ticks retain each player reflection contribution across retries and cap shared overkill', () => {
  const a = member('a'), b = member('b');
  for(const player of [a,b]) player.artifactBattle.effects=[{type:'equip_reflect_percent',value:.5}];
  const room = {status:'active',hostUid:'a',startedAtMs:100000,createdAtMs:100000,bossHp:50,bossMaxHp:2000,
    bossBaseAttack:70,bossActionCount:0,members:{a,b}};
  const result = advanceRaidClock(room,'growth-test',118000);
  assert.equal(result.bossHp,0);
  const first = Math.min(room.bossHp,result.members.a.lastBossResolution.reflectedDamage);
  assert.equal(result.members.a.combatContribution.reflectedDamage,first);
  assert.equal(result.members.b.combatContribution.reflectedDamage,room.bossHp - first);
  assert.equal(advanceRaidClock(result,'growth-test',118000),null,'a repeated tick cannot credit reflection twice');
  assert.equal(a.combatContribution.reflectedDamage,0);
});

const question = (text,extra={}) => ({data:{q:text},answerSelectedIndex:0,learningSubject:'數學',learningTopic:'二次函數',...extra});
test('correction progress identifies the real concept and counts each original mistake once', () => {
  const stats = {};
  for(const name of ['原題一','原題二']) {
    stats.soloLearningV1 = Learning.reward(stats,question(name),false).progress;
    const corrected = Learning.reward(stats,question(name+'變式',{recoveryOrigin:name}),true);
    stats.soloLearningV1 = corrected.progress;
    assert.equal(corrected.recoveryFeedback.subject,'數學');
    assert.equal(corrected.recoveryFeedback.topic,'二次函數');
    const replay = Learning.reward(stats,question(name+'變式',{recoveryOrigin:name}),true);
    assert.equal(replay.recoveryFeedback,null); assert.equal(replay.recovery,false);
  }
  assert.equal(Object.values(stats.soloLearningV1.concepts)[0].corrected,2);
  assert.deepEqual(Learning.context({badge:'📝 訂正練習 | 數學 · 二次函數'}),{subject:'數學',topic:'二次函數'});
  assert.deepEqual(Learning.context({badge:'🎯 英語 | 閱讀'}),{subject:'英文',topic:'閱讀'});
  assert.deepEqual(Learning.context(question('題目',{badge:'📝 訂正練習 | 錯誤科目 · 錯誤單元'})),{subject:'數學',topic:'二次函數'});
  assert.deepEqual(Learning.context({learningSubject:'__proto__',learningTopic:'constructor'}),{subject:'綜合',topic:'本題概念'});
});

test('old correction records migrate, concept history remains bounded, and wrong or skipped variants never mark progress', () => {
  const stats = {soloLearningV1:{version:1,mistakes:{[Learning.key('原題')]:{recovered:false}},
    concepts:Object.fromEntries(Array.from({length:50},(_,i)=>['c:'+i,{subject:'數學',topic:'單元'+i,corrected:1}]))}};
  const variant = question('新題',{recoveryOrigin:'原題'});
  assert.equal(Learning.reward(stats,variant,false).recoveryFeedback,null);
  assert.equal(Learning.reward(stats,{...variant,answerSelectedIndex:-1},false).recoveryFeedback,null);
  const correct = Learning.reward(stats,variant,true);
  assert.equal(correct.recoveryFeedback.corrected,1);
  assert.equal(Object.keys(correct.progress.concepts).length,50);
  assert.equal(Object.hasOwn(correct.progress.concepts,'c:0'),false);
  assert.equal(stats.soloLearningV1.mistakes[Learning.key('原題')].recovered,false);
});

test('correction celebration fires only after a successful saved reward and never for a replay', async () => {
  const source = fs.readFileSync(require.resolve('../public/main-legacy.js'),'utf8');
  const start=source.indexOf('    const persistAnswer = () => runTransaction('),end=source.indexOf('    try {\n        const p1 = shouldSaveAnswer',start);
  for(const scenario of ['success','failed','replay']) {
    const quiz=question('訂正變式',{recoveryOrigin:'原題'}), events=[];
    const remote={stats:{gold:10,totalScore:68,soloLearningV1:{version:1,mistakes:{[Learning.key('原題')]:{recovered:scenario==='replay'}}}}};
    const stats=structuredClone(remote.stats), auth={currentUser:{uid:'u'}}, learningReward=Learning.reward(stats,quiz,true);
    const context={db:{},doc:()=>({}),auth,answerUser:{uid:'u'},currentUserData:{stats},stats,
      isCorrect:true,trialAnswerId:'',learningRules:Learning,learningReward,quiz,correctionFeedback:null,
      cultivationDelta:2,recoveryCoreGain:0,originalGoldenMessage:'',cultivationReward:{},scoreGain:0,
      calculateRankFromScore:()=>0,updateUIStats(){},showCultivationFeedback(){},cultivationFeedback:null,fbTitle:{},t:()=> '答對',
      CustomEvent:class {constructor(type,{detail}={}){this.type=type;this.detail=detail;}},
      window:{currentActiveQuiz:quiz,QAAnswerGoldRules:require('../public/cultivation/answer-gold-rules.js'),
        QAKnowledgePoints:require('../public/cultivation/knowledge-points.js'),
        XianxiaQuestRules:{recordEvent:()=>({})},dispatchEvent:event=>events.push(event)},
      runTransaction:async(_,worker)=>{if(scenario==='failed')throw Error('offline');return worker({get:async()=>({exists:()=>true,data:()=>remote}),update(){}});}};
    vm.runInNewContext(source.slice(start,end)+'\nthis.save=persistAnswer;',context);
    if(scenario==='failed') await assert.rejects(context.save(),/offline/); else await context.save();
    assert.equal(events.filter(event=>event.type==='xiuxian:learning-progress').length,scenario==='success'?1:0);
    if(scenario==='success')assert.equal(events.find(event=>event.type==='xiuxian:learning-progress').detail.topic,'二次函數');
  }
});

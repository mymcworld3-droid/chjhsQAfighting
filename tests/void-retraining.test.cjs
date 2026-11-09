'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Rules=require('../public/cultivation/void-retraining-rules.js');
const Access=require('../public/cultivation/training-access-rules.js');
const Draw=require('../public/cultivation/soulbound-pool.js');
const Daily=require('../public/cultivation/daily-meditation-rules.js');
const Gold=require('../public/cultivation/answer-gold-rules.js');
const read=file=>fs.readFileSync(file,'utf8');
const legacy=read('public/main-legacy.js');
const tableSource=legacy.match(/const REALMS = (\[[\s\S]*?\n\]);/)[1];
const REALMS=vm.runInNewContext(tableSource);
function rank(score){return REALMS.findLastIndex(row=>score>=row.need&&row.name!=='真仙');}
const progress=(score,cursor)=>Rules.progress(score,REALMS,cursor?.index??rank(score),cursor);

test('Void retraining costs half the original 428 and reaches Fusion at cumulative 642',()=>{
 assert.equal(Rules.START,428);assert.equal(Rules.REQUIRED,428/2);assert.equal(Rules.FUSION,642);
 for(const [index,original]of [0,6,28,68,188].entries())assert.equal((Rules.PHASES[index].need-Rules.START)*2,original);
 assert.equal(Rules.COMPLETE.need-Rules.START,214);
});
test('each cumulative boundary displays the requested retraining realm and preserves stable major indices',()=>{
 const rows=[[427,'化神'],[428,'煉氣期（煉虛）'],[430,'煉氣期（煉虛）'],[431,'築基期（煉虛）'],
  [441,'築基期（煉虛）'],[442,'金丹期（煉虛）'],[461,'金丹期（煉虛）'],[462,'元嬰期（煉虛）'],
  [521,'元嬰期（煉虛）'],[522,'化神期（煉虛）'],[641,'化神期（煉虛）'],[642,'合體'],[1268,'渡劫'],[1868,'半仙']];
 for(const [score,name]of rows){const state=progress(score);assert.equal(state.realm.name,name,score);if(score>=428&&score<642)assert.equal(state.index,12);}
 for(const bad of [-50,NaN,Infinity])assert.equal(Rules.phase(bad),-1);
});
test('retraining progress measures the current segment and also reports the complete 214-point journey',()=>{
 for(const [score,earned,required,next]of [[428,0,3,'築基期（煉虛）'],[430,2,3,'築基期（煉虛）'],
  [431,0,11,'金丹期（煉虛）'],[450,8,20,'元嬰期（煉虛）'],[500,38,60,'化神期（煉虛）'],[641,119,120,'合體']]){
   const p=progress(score);assert.equal(p.earned,earned);assert.equal(p.required,required);assert.equal(p.next.name,next);
   assert.equal(p.cycleEarned,score-428);assert.ok(p.ratio>=0&&p.ratio<=1);
 }
});
test('absorption finishes its original retraining segment before carrying excess into the next one',()=>{
 const before=progress(430),filled=progress(445,before.cursor),after=progress(445);
 assert.equal(filled.realm.name,'煉氣期（煉虛）');assert.equal(filled.earned,3);assert.equal(filled.ratio,1);
 assert.equal(after.realm.name,'金丹期（煉虛）');assert.equal(after.earned,3);assert.notEqual(after.step,before.step);
 const huashen=progress(640),full=progress(650,huashen.cursor);assert.equal(full.ratio,1);assert.equal(full.realm.name,'化神期（煉虛）');
 assert.equal(progress(650).realm.name,'合體');
});
test('all active realm tables use 642 for Fusion and retain existing Tribulation and Immortal gates',()=>{
 for(const file of ['public/main-legacy.js','public/cultivation/cultivation-theme.js','public/cultivation/xiuxian-live-sync.js',
  'public/cultivation/realm-breakthrough-feedback.js','public/cultivation/cultivation-progression-v2.js']){
  const table=vm.runInNewContext(read(file).match(/const (?:FALLBACK_)?REALMS = (\[[\s\S]*?\n\s*\]);/)[1]);
  for(const [name,need]of [['煉虛',428],['合體',642],['渡劫',1268],['半仙',1868],['真仙',1868]])assert.equal(table.find(row=>row.name===name).need,need,file+name);
 }
});
test('rank names, markup and base realm icons use the same dynamic projection',()=>{
 const functions=legacy.slice(legacy.indexOf('function getRankName('),legacy.indexOf('// Linking a provider'));
 const api=vm.runInNewContext('const REALMS='+tableSource+';\n'+functions+'\n({getRankName,getRankMarkup,calculateRankFromScore});',
  {window:{QAVoidRetraining:Rules,limitImmortalRank:index=>index,getRealmIconMarkup:name=>'['+name+']'}});
 for(const score of [428,431,442,462,522,641,642]){
  const state=progress(score);assert.ok(api.getRankName(0,'player',score).startsWith(state.realm.name));
  const markup=api.getRankMarkup(0,'player',score);assert.ok(markup.includes(state.realm.name));
  assert.ok(markup.startsWith('['+(state.realm.baseName||state.realm.name)+']'));
 }
});
test('live home refresh and theme progress follow retraining boundaries without reverting to the old label',()=>{
 const nodes=new Map(['xiuxian-score','xiuxian-realm','xiuxian-sub','xiuxian-progress','xiuxian-next','xiuxian-progress-label'].map(id=>[id,{style:{},textContent:''}]));
 const window={QAVoidRetraining:Rules,limitImmortalRank:index=>index,addEventListener(){}};
 const document={readyState:'loading',addEventListener(){},getElementById:id=>nodes.get(id)};
 vm.runInNewContext(read('public/cultivation/xiuxian-live-sync.js'),{window,document});
 window.refreshXiuxianLiveSync(430);assert.equal(nodes.get('xiuxian-realm').textContent,'煉氣期（煉虛）');
 assert.equal(nodes.get('xiuxian-next').textContent,'1 修為');assert.ok(Math.abs(parseFloat(nodes.get('xiuxian-progress').style.width)-200/3)<.01);
 window.refreshXiuxianLiveSync(642);assert.equal(nodes.get('xiuxian-realm').textContent,'合體');
 const source=read('public/cultivation/cultivation-theme.js').replace(/\}\)\(\);\s*$/,'window.audit={progressFor,nextRealm,pct};})();');
 vm.runInNewContext(source,{window,document});assert.equal(window.audit.nextRealm(461).name,'元嬰期（煉虛）');
 assert.equal(window.audit.progressFor(442).realm.name,'金丹期（煉虛）');assert.ok(window.audit.pct(461)<100);
});
test('solo animation sees a retraining phase change even though the stored major rank remains 12',()=>{
 const source=read('public/cultivation/solo-cultivation-feedback.js').replace(/^export /gm,'');
 const api=vm.runInNewContext(source+'\n({cultivationProgress});',{window:{QAVoidRetraining:Rules,limitImmortalRank:index=>index}});
 const before=api.cultivationProgress(430,REALMS),fill=api.cultivationProgress(433,REALMS,before.cursor),next=api.cultivationProgress(433,REALMS);
 assert.equal(before.index,next.index);assert.notEqual(before.step,next.step);assert.equal(fill.ratio,1);assert.equal(next.realm.name,'築基期（煉虛）');
});
test('retraining retains the attained realm gates independently of combat HP', () => {
 for (const score of [428,431,442,462,522,641]) assert.equal(Access.realmScore(score),428);
 assert.equal(Access.realmScore(642),642);
 const saved={stats:{totalScore:500},trainingAccess:{version:1,highestRealmScore:788}};
 assert.equal(Access.score(saved),642);
});

test('Fusion rewards, draw tier and path quest become available at 642 on the server and in shared rules',()=>{
 assert.equal(Draw.REALMS[Draw.rankFor(641)].name,'煉虛');assert.equal(Draw.REALMS[Draw.rankFor(642)].name,'合體');
 assert.equal(Daily.meditationReward(641,1,5).realm,'煉虛');assert.equal(Daily.meditationReward(642,1,5).realm,'合體');
 assert.equal(Gold.realm(641).bonus,40);assert.equal(Gold.realm(642).bonus,50);
 const quests=require('../public/cultivation/quest-rules.js');assert.ok(read('public/cultivation/quest-rules.js').includes("'score', 642"));
 assert.ok(quests);
});

test('solo, duel and authoritative raid bottleneck skills use identical retraining windows',()=>{
 const battle=read('public/cultivation/battle-engine-v2.js'),raid=read('raid-authority.cjs'),training=read('public/cultivation/cultivation-training-v4.js');
 const grade=g=>Math.min(9,Math.max(1,Number(g)||9));
 const battleSource=battle.match(/const NEXT_REALM_THRESHOLDS = .*;/)[0]+'\n'+battle.slice(battle.indexOf('function nearBreakthrough('),battle.indexOf('// 所有鬥法技能'))+'\nnearBreakthrough;';
 const raidSource=raid.match(/const NEXT_REALM_THRESHOLDS = .*;/)[0]+'\n'+raid.match(/function nearBreakthrough\(score,grade\)\{[\s\S]*?\n\}/)[0]+'\nnearBreakthrough;';
 const a=vm.runInNewContext(battleSource,{clampGrade:grade});
 const b=vm.runInNewContext(raidSource,{positive:n=>Math.max(0,Number(n)||0),clampGrade:grade});
 const soloSource='const GOLDEN_CORE_SCORE=28;\n'+training.match(/const REALM_THRESHOLDS = .*;/)[0]+'\n'+training.match(/function inBreakthroughZone\(score, grade\) \{[\s\S]*?\n  \}/)[0]+'\ninBreakthroughZone;';
 const c=vm.runInNewContext(soloSource,{breakthroughPercent:g=>20+(9-grade(g))*5});
 for(const score of [428,430,431,435,440,442,455,461,462,500,521,522,600,641,642])for(const g of [1,5,9]){
  assert.equal(a(score,g),b(score,g),score+':'+g);assert.equal(b(score,g),c(score,g),score+':'+g);
 }
 assert.equal(a(440,9),true);assert.equal(a(431,9),false);
});

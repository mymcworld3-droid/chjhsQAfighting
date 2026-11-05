'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Scope=require('../trial-tower-scope.cjs');
const legacy=fs.readFileSync('public/main-legacy.js','utf8');
async function freeRequest(player){
 const requests=[],context=vm.createContext({currentUserData:player,currentLang:'zh',window:{},console:{log(){},error(){}},
  getRankName:()=> '金丹',getSmartDifficulty:()=> 'medium',quizMetaFromRaw:()=>({}),recentSoloQuestionContext:()=>({}),adaptiveQuestionContext:()=>({}),shuffleArray:v=>v,
  fetch:async(_,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({text:JSON.stringify({q:'何者正確？',correct:'A',wrong:['B','C','D'],exp:'說明'})})};}});
 const start=legacy.indexOf('async function fetchOneQuestion() {'),end=legacy.indexOf('async function handleAnswer',start);
 vm.runInContext(legacy.slice(start,end)+'\nthis.fetchQuiz=fetchOneQuestion;',context);await context.fetchQuiz();return requests[0];
}
test('selected tower scope matches actual free-study subject, curriculum grade, chapter, details and course track',async()=>{
 const units=[
  {path:'數學/八上',detail:'一元一次方程式',sub_topics:['等量公理','移項']},
  {path:'物理/高中二年級/自訂/物理',detail:'鉛直圓周運動',sub_topics:['最高點速率','最低點張力']},
  {path:'數學/高中二年級/第一學期/數學A',detail:'指數與對數函數',sub_topics:['指數律']},
  {path:'數學/高中三年級/第二學期/數學甲',detail:'微積分',sub_topics:[]},
  {path:'國文/國小三年級/第一學期/國語',detail:'生活中的故事',sub_topics:['段落大意']},
  ...['自然科學','社會','生活','藝術','健康與體育','本土語文','綜合活動','資訊科技','地球科學','綜合'].map(subject=>({path:subject+'/國小四年級/自訂/'+subject,detail:'觀察與生活應用',sub_topics:['應用']})),
  {path:'化學/九下.json',detail:'',sub_topics:[]}
 ];
 for(const unit of units){
  const player={profile:{educationLevel:'國中一年級',weakSubjects:'英文'},stats:{rankLevel:0},gameSettings:{sourceMode:'focused',difficulty:'hard',focusedUnits:[unit]}};
  const free=await freeRequest(player),tower=Scope.pick(Scope.snapshot(player),player,0);
  for(const field of ['subject','level','difficulty','specificTopic'])assert.equal(tower[field],free[field],unit.path+' '+field);
 }
});
test('multiple selected units remain eligible regardless of profile grade or weak subjects; random mode ignores stored focused units',()=>{
 const player={profile:{educationLevel:'國小一年級',weakSubjects:'英文'},gameSettings:{sourceMode:'focused',difficulty:'medium',focusedUnits:[
  {path:'物理/高中二年級/自訂/物理',detail:'牛頓運動定律'},
  {path:'地球科學/高中三年級/第二學期/地球科學',detail:'大氣與海洋'},
  {path:'數學/九下',detail:'圓形'}]}};
 const scope=Scope.snapshot(player),picked=Array.from({length:6},(_,i)=>Scope.pick(scope,player,i));
 assert.deepEqual([...new Set(picked.map(p=>p.subject))],['物理','地球科學','數學']);
 assert.equal(picked[0].level,'高中二年級');assert.equal(picked[2].level,'國中三年級');
 const reordered={...player,gameSettings:{...player.gameSettings,focusedUnits:[...player.gameSettings.focusedUnits].reverse()}};
 assert.equal(Scope.key(scope),Scope.key(Scope.snapshot(reordered)));
 player.gameSettings.sourceMode='random';assert.deepEqual(Scope.snapshot(player).units,[]);
 assert.equal(new Set(Array.from({length:9},(_,i)=>Scope.pick(Scope.snapshot(player),player,i).subject)).size,9);
 player.gameSettings.sourceMode='focused';player.gameSettings.focusedUnits=[];assert.throws(()=>Scope.snapshot(player),/儲存有效/);
 player.gameSettings.focusedUnits=[{path:'未知科目/八上',detail:'範圍'}];assert.throws(()=>Scope.snapshot(player),/儲存有效/);
});
test('automatic difficulty follows free-study rank/streak and explicit hard never weakens',()=>{
 const user={stats:{rankLevel:5,currentStreak:0},profile:{weakSubjects:'物理'},gameSettings:{sourceMode:'focused',difficulty:'auto',focusedUnits:[{path:'物理/高中二年級/自訂/物理',detail:'圓周運動'}]}};
 assert.equal(Scope.pick(Scope.snapshot(user),user).difficulty,'medium');user.gameSettings.difficulty='hard';assert.equal(Scope.pick(Scope.snapshot(user),user).difficulty,'hard');
 user.gameSettings={sourceMode:'random',difficulty:'auto'};user.stats={rankLevel:0,currentStreak:3};assert.equal(Scope.pick(Scope.snapshot(user),user).difficulty,'medium');
});
test('saved bank file/directory is used directly, filters difficulty, avoids seen items and cycles only after exhaustion',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tower-bank-'));test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'選定','國文'),{recursive:true});fs.mkdirSync(path.join(root,'其他'),{recursive:true});
 const item=(q,difficulty='easy')=>({q,correct:'A',wrong:['B','C','D'],exp:'題庫解析',difficulty});
 fs.writeFileSync(path.join(root,'選定','國文','一.json'),JSON.stringify([item('範圍內第一題'),item('範圍內第二題'),item('範圍內難題','hard')]));
 fs.writeFileSync(path.join(root,'選定','國文','二.json'),JSON.stringify([item('範圍內第三題')]));
 fs.writeFileSync(path.join(root,'其他','外.json'),JSON.stringify([item('範圍外不得出現')]));
 const context={bankSource:'選定/國文/一.json',subject:'國文',difficulty:'easy',history:[]};
 assert.equal((await Scope.bankQuestion(context,{root,random:()=>0})).q,'範圍內第一題');
 context.history=['範圍內第一題'];assert.equal((await Scope.bankQuestion(context,{root,random:()=>0})).q,'範圍內第二題');
 context.history.push('範圍內第二題');assert.equal((await Scope.bankQuestion(context,{root,random:()=>0})).q,'範圍內第一題');
 context.bankSource='選定/國文';context.history=['範圍內第一題','範圍內第二題'];assert.equal((await Scope.bankQuestion(context,{root,random:()=>0})).q,'範圍內第三題');
 context.difficulty='hard';assert.equal((await Scope.bankQuestion(context,{root,random:()=>0})).q,'範圍內難題');
 for(const bankSource of ['../outside','/etc/passwd','選定/../其他','不存在'])await assert.rejects(Scope.bankQuestion({...context,bankSource},{root}));
 fs.symlinkSync(os.tmpdir(),path.join(root,'escape'));await assert.rejects(Scope.bankQuestion({...context,bankSource:'escape'},{root}),/範圍無效/);
});

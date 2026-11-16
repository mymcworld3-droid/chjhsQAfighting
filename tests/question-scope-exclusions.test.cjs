const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Scope = require('../quiz-scope-exclusions.cjs');

const unit = {path:'數學/高中一年級/全學年/數學',detail:'向量內積',sub_topics:['二維向量','內積']};
const another = {path:'數學/高中一年級/全學年/數學',detail:'空間幾何',sub_topics:[]};
const player = () => ({
  profile:{educationLevel:'高中一年級'},
  gameSettings:{sourceMode:'focused',focusedUnits:[unit,another]}
});
test('personal excluded rules apply to the exact focused unit only', () => {
  const user=player(),key=Scope.scopeKey(user);
  const text='此範圍不要再出三維向量內積的計算';
  user.questionScopeExclusions={scopeKey:key,revision:'rev-a',rules:[{
    id:'x',unitKey:Scope.unitKey(unit),text
  }]};
  assert.deepEqual(Scope.activeRules(user,unit),[text]);
  assert.deepEqual(Scope.activeRules(user,another),[]);
  const swapped=player();
  swapped.gameSettings.focusedUnits=[unit];
  swapped.questionScopeExclusions=user.questionScopeExclusions;
  assert.deepEqual(Scope.activeRules(swapped,unit),[]);
  user.gameSettings.sourceMode='random';
  assert.deepEqual(Scope.activeRules(user,unit),[]);
});
test('hard guard excludes 3D vector dot products but retains 2D and other topics',()=>{
  const blocks=['不要再出三維向量內積的計算'];
  assert.match(Scope.exclusionIssue({q:'設三維向量 a=(1,2,3)，b=(4,5,6)，求 a·b 的內積。'},blocks),/三維/);
  assert.match(Scope.exclusionIssue({q:'設 a=(1,2,3)、b=(2,3,4)，求其內積'},blocks),/三維/);
  assert.equal(Scope.exclusionIssue({q:'設平面向量 a=(1,2)、b=(3,4)，求 a·b。'},blocks),'');
  assert.equal(Scope.exclusionIssue({q:'三維空間的長方體體積為多少？'},blocks),'');
  assert.equal(Scope.exclusionIssue({q:'向量 a=(1,2,3) 的長度是多少？'},blocks),'');
});
test('authenticated endpoint persists rules, lists and removes them', async()=>{
  const dbData=player();
  const ref={get:async()=>({exists:true,data:()=>dbData})};
  const db={collection:name=>{assert.equal(name,'users');return {doc:id=>{assert.equal(id,'u');return ref;}};},
    runTransaction:async fn=>fn({
      get:async()=>({exists:true,data:()=>dbData}),
      update:(_ref,update)=>Object.assign(dbData,update)
    })};
  let endpoint;
  Scope.registerQuizScopeExclusions({post:(url,fn)=>{assert.equal(url,'/api/quiz/scope-exclusions');endpoint=fn;}},{
    verify:async()=> 'u',resolve:()=>({db})
  });
  async function call(body){
    const result={statusCode:200,body:null,status(n){this.statusCode=n;return this;},json(data){this.body=data;return this;}};
    await endpoint({body},result);return result;
  }
  const add=await call({action:'add',unit,text:'不要再出三維向量內積的計算'});
  assert.equal(add.statusCode,200);
  assert.equal(add.body.rules.length,1);
  assert.deepEqual(Scope.activeRules(dbData,unit),['不要再出三維向量內積的計算']);
  const list=await call({action:'list',unit});
  assert.equal(list.body.rules.length,1);
  const remove=await call({action:'remove',unit,id:list.body.rules[0].id});
  assert.equal(remove.body.rules.length,0);
  const bad=await call({action:'add',unit:{...unit,detail:'沒選的範圍'},text:'不要再出三維向量內積的計算'});
  assert.equal(bad.statusCode,409);
});
test('new screen and server keep exclusions separate from wrong-answer reporting',()=>{
  const root=path.join(__dirname,'..');
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
  const study=fs.readFileSync(path.join(root,'public/main-legacy.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  assert.match(server,/QuizScopeExclusions\.activeRules/);
  assert.match(server,/eligibleBankCandidate/);
  assert.match(server,/scopeExclusions\.length && checked\.data\.excluded !== false/);
  assert.match(study,/exclusionRevision:/);
  assert.match(study,/qa:scope-exclusions-updated/);
  assert.match(html,/id="btn-quiz-scope-exclusion"/);
});

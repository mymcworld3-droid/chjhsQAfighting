const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const source=readFileSync(join(__dirname,'../public/cultivation/true-immortal.js'),'utf8');
function setup() {
  const user={profile:{educationLevel:'國中一年級'}};
  const window={
    getRealmUserUid:()=> 'alice',getCurrentUserData:()=>user,
    getLeaderboardEducationGroup:grade=>grade?.startsWith('國小')?'elementary':grade?.startsWith('國中')?'junior':null,
    dispatchEvent(){}
  };
  vm.runInNewContext(source,{window,Event});
  return {window,user};
}
const realms=[{name:'凡人'},{name:'渡劫'},{name:'半仙'},{name:'真仙'}];
test('a school-cohort seat and 1868 score are both required for True Immortal',()=>{
 const {window:w}=setup();
 for(const listed of [false,true]) {
  w.setTrueImmortalBoard(listed?[{id:'junior__ru-xian',cohort:'junior',uid:'alice'}]:[]);
  for(const score of [0,1268,1867,1868,2588,9999])
    assert.equal(w.isTrueImmortal(score),listed && score>=1868);
 }
});
test('a different school cohort never grants the current player True Immortal',()=>{
 const {window:w,user}=setup();
 w.setTrueImmortalBoard([{id:'elementary__ru-xian',cohort:'elementary',uid:'alice'}]);
 assert.equal(w.isTrueImmortal(2588),false);
 user.profile.educationLevel='國小高年級';
 assert.equal(w.isTrueImmortal(2588),true);
 w.setTrueImmortalBoard([{id:'elementary__ru-xian',cohort:'elementary',uid:'bob'}]);
 assert.equal(w.isTrueImmortal(2588),false);
 assert.equal(w.isTrueImmortal(2588,'bob'),true);
});
test('legacy, unknown and incorrectly attributed seats cannot award True Immortal',()=>{
 const {window:w}=setup();
 w.setTrueImmortalBoard([{id:'ru-xian',uid:'alice'},{id:'junior__unknown',uid:'alice'},
  {id:'junior__ru-xian',cohort:'elementary',uid:'alice'}]);
 assert.equal(w.isTrueImmortal(9999),false);
 w.setTrueImmortalBoard([{id:'junior__ru-xian',cohort:'junior',uid:'alice'}],false);
 assert.equal(w.isTrueImmortal(9999),false);
 assert.equal(w.limitImmortalRank(3,9999,realms),2);
});

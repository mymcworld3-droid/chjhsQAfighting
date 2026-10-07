const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const rules = require('../public/cultivation/curriculum-range-rules.js');
const read = file => readFileSync(require.resolve('../public/' + file), 'utf8');
const selected = [{path:'物理/高中二年級/自訂/物理',detail:'功與動能',sub_topics:[]},
  {path:'物理/高中二年級/自訂/物理',detail:'角動量',sub_topics:[]}];

test('chat titles are optional and count visible Unicode characters up to twenty', () => {
  assert.equal(rules.validateShareTitle('  ').title,'我的修習清單');
  assert.equal(rules.validateShareTitle('  物理段考複習  ').title,'物理段考複習');
  for (const letter of ['字','🌟','e\u0301','👨‍👩‍👧‍👦']) {
    assert.equal(rules.validateShareTitle(letter.repeat(20)).ok,true);
    assert.equal(rules.validateShareTitle(letter.repeat(21)).ok,false);
  }
  for (const value of ['標題\n第二行','標題\t第二行',{},20]) assert.equal(rules.validateShareTitle(value).ok,false);
});

test('typed shares preserve grade and chapters and receivers use the actual validated list', () => {
  const result=rules.createChatShare(selected,'物理段考複習');
  assert.equal(result.ok,true);
  assert.equal(result.message.type,'curriculum-share');
  const received=rules.readChatShare({...result.message,scopeCount:999});
  assert.equal(received.title,'物理段考複習'); assert.deepEqual(received.units,selected);
  assert.equal(rules.createChatShare([], '空清單').ok,false);
  assert.equal(rules.createChatShare(selected,'字'.repeat(21)).ok,false);
  assert.equal(rules.readChatShare({...result.message,scopeCode:'{bad'}).ok,false);
  assert.equal(rules.readChatShare({...result.message,scopeTitle:'字'.repeat(21)}).ok,false);
  assert.equal(rules.readChatShare({...result.message,type:'text'}).ok,false);
});

function repository({uid='sender',freshUid=uid,exists=true,fail=false}={}) {
  const writes=[]; let reads=0;
  const context=vm.createContext({CurriculumRangeRules:rules,
    getMainUser:()=>({uid:reads?freshUid:uid}),
    getProjectServices:async role=>{assert.equal(role,'A');return {db:{}};},
    doc:(_,collection,id)=>({collection,id}),collection:(_,name)=>name,
    getDoc:async ref=>{reads++; assert.equal(ref.id,'sender');return {exists:()=>exists,data:()=>({displayName:'道友',stats:{totalScore:30},equipped:{}})};},
    addDoc:async(collection,data)=>{if(fail)throw Error('連線失敗');writes.push({collection,data});return {id:'share-id'};},
    serverTimestamp:()=>'server-time'});
  if(!uid)context.getMainUser=()=>null;
  vm.runInContext(read('cultivation/profile-avatar.js').replace(/^export /gm,''),context);
  const source=read('cultivation/data/player-repository.js').replace(/^import\s+['"][^'"]+['"];\s*/gm,'')
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/g,'').replace('export const playerRepository','const playerRepository');
  vm.runInContext(source+'\nthis.repo=playerRepository;',context);
  return {repo:context.repo,writes,reads:()=>reads};
}

test('chat publishing uses the signed-in profile and sanitizes the portable list before writing', async () => {
  const game=repository();
  const code=JSON.parse(rules.shareSelection(selected).code);
  code.uid='forged';code.units[0].email='private@example.com';
  await game.repo.shareCurriculum({code:JSON.stringify(code),title:'物理段考複習'});
  assert.equal(game.writes.length,1);
  const {collection,data}=game.writes[0];
  assert.equal(collection,'global_chat'); assert.equal(data.uid,'sender');
  assert.equal(data.displayName,'道友');assert.equal(data.timestamp,'server-time');
  assert.equal(data.scopeTitle,'物理段考複習');assert.equal(data.type,'curriculum-share');
  assert.doesNotMatch(data.scopeCode,/forged|private|email/);
  assert.deepEqual(rules.readSharedSelection(data.scopeCode).units,selected);
});

test('signed-out, missing or changed profiles and invalid titles never write a chat message', async () => {
  const code=rules.shareSelection(selected).code;
  for(const options of [{uid:''},{exists:false},{freshUid:'another'}]) {
    const game=repository(options);
    await assert.rejects(game.repo.shareCurriculum({code,title:'複習'}));
    assert.equal(game.writes.length,0);
  }
  const game=repository();
  await assert.rejects(game.repo.shareCurriculum({code,title:'字'.repeat(21)}),/20 字/);
  await assert.rejects(game.repo.shareCurriculum({code:'{}',title:'複習'}));
  assert.equal(game.reads(),0);assert.equal(game.writes.length,0);
  await assert.rejects(repository({fail:true}).repo.shareCurriculum({code,title:'複習'}),/連線失敗/);
});

function sharingUI() {
  let pending, calls=0;
  const nodes={'ss-share-title':{value:'物理段考複習'}};
  const context=vm.createContext({window:{CurriculumRangeRules:rules},saving:false,sharing:false,lastShared:'',
    units:()=>selected,$:id=>nodes[id],updateSummary(){},feedback:text=>{context.notice=text;},
    playerRepository:{shareCurriculum:async data=>{calls++;assert.equal(data.title,'物理段考複習');await new Promise((resolve,reject)=>{pending={resolve,reject};});}}});
  const source=read('cultivation/scope-fullscreen.js');
  vm.runInContext(source.slice(source.indexOf('  async function shareToChat()'),source.indexOf('  function openShared('))+'\nthis.share=shareToChat;',context);
  return {context,share:context.share,calls:()=>calls,resolve:()=>pending.resolve(),reject:()=>pending.reject(Error('分享失敗'))};
}

test('double clicks and repeating a completed share write once; failed shares can be retried', async () => {
  const success=sharingUI(), first=success.share();
  await success.share();assert.equal(success.calls(),1);
  success.resolve();await first;await success.share();assert.equal(success.calls(),1);
  const failure=sharingUI(), failed=failure.share();
  failure.reject();await failed;assert.equal(failure.context.sharing,false);
  assert.equal(failure.context.notice,'分享失敗');assert.equal(failure.context.lastShared,'');
  const retry=failure.share();assert.equal(failure.calls(),2);failure.resolve();await retry;
});

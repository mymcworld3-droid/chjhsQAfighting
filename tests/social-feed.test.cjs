const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/cultivation/social-feed.js'),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const doc = (id, type, seconds) => ({id, data:()=>({uid:'other',timestamp:{seconds,nanoseconds:0},...(type?{type}:{}),text:id})});
const rows = (n,type,base=1000) => Array.from({length:n},(_,i)=>doc(type+'-'+(base-i),type,base-i));
const tick = () => new Promise(resolve=>setImmediate(resolve));
function harness(initial) {
  let all=initial.slice(), callback, failRead=false, pending=null, unsubscribed=false, liveSize;
  const calls=[],received=[],errors=[];
  const ctx=vm.createContext({console,
    collection:(_db,name)=>({name}),orderBy:(...args)=>({order:args}),limit:n=>({limit:n}),startAfter:doc=>({cursor:doc}),
    query:(base,...constraints)=>({base,constraints}),
    onSnapshot:(query,next)=>{assert.equal(query.base.name,'global_chat');liveSize=query.constraints.find(c=>c.limit)?.limit;callback=next;return()=>{unsubscribed=true;};},
    getDocs:async query=>{
      const cursor=query.constraints.find(c=>c.cursor)?.cursor, maximum=query.constraints.find(c=>c.limit)?.limit;
      calls.push(cursor.id);
      if(pending)await pending;
      if(failRead)throw Error('offline');
      const i=all.findIndex(item=>item.id===cursor.id);
      return {docs:all.slice(i+1,i+1+maximum)};
    }});
  vm.runInContext(source+'\nthis.subscribe=subscribeSocialFeed;this.kind=socialFeedKind;',ctx);
  return {calls,received,errors,kind:ctx.kind,
    subscribe(kind='chat',maximum=25){return ctx.subscribe({},kind,maximum,docs=>received.push(Array.from(docs)),error=>errors.push(error));},
    async emit(items=all){callback({docs:items.slice(0,liveSize)});for(let i=0;i<8;i++)await tick();},
    setAll(items){all=items;}, fail(){failRead=true;},
    hold(){let release;pending=new Promise(resolve=>{release=resolve;});return()=>{pending=null;release();};},
    get stopped(){return unsubscribed;},get liveSize(){return liveSize;}};
}
test('legacy text and cave invitations stay in chat; curriculum cards belong only to scope sharing',()=>{
  const h=harness([]);
  assert.equal(h.kind({text:'legacy'}),'chat');
  assert.equal(h.kind({type:'dongtian-share'}),'chat');
  assert.equal(h.kind({type:'curriculum-share'}),'shares');
});
test('each feed fills its own latest 25 records even behind hundreds of posts from the other feed',async()=>{
  for(const [kind,other,own] of [['chat','curriculum-share',undefined],['shares',undefined,'curriculum-share']]) {
    const recent=rows(180,other,1000),older=rows(30,own,800),h=harness([...recent,...older]);
    h.subscribe(kind);await h.emit();
    const result=h.received.at(-1);
    assert.equal(result.length,25);
    assert.deepEqual(result.map(x=>x.id),older.slice(0,25).map(x=>x.id));
    assert(h.calls.length>=3);assert.equal(h.errors.length,0);
  }
});
test('ordinary new chat does not rescan old scope history, and scope cards survive a moving live window',async()=>{
  const shares=rows(25,'curriculum-share',800),chat=rows(80,undefined,1000),h=harness([...chat,...shares]);
  h.subscribe('shares');await h.emit();const reads=h.calls.length;
  const more=rows(60,undefined,1100);h.setAll([...more,...chat,...shares]);await h.emit();
  assert.equal(h.calls.length,reads);
  assert.deepEqual(h.received.at(-1).map(x=>x.id),shares.map(x=>x.id));
});
test('deleting or reclassifying a visible message removes it from its old feed and refills the window',async()=>{
  const original=rows(70,undefined,1000),h=harness(original);h.subscribe();await h.emit();
  let changed=original.slice(1);h.setAll(changed);await h.emit();
  assert.equal(h.received.at(-1).some(x=>x.id===original[0].id),false);
  changed=[doc(changed[0].id,'curriculum-share',999),...changed.slice(1)];h.setAll(changed);await h.emit();
  assert.equal(h.received.at(-1).some(x=>x.id===changed[0].id),false);
  assert.equal(h.received.at(-1).length,25);
});
test('empty history does not keep rereading, while a newly published scope still appears',async()=>{
  const history=rows(70,undefined),h=harness(history);h.subscribe('shares');await h.emit();const reads=h.calls.length;
  assert.equal(h.received.at(-1).length,0);
  h.setAll([...rows(1,undefined,1100),...history]);await h.emit();assert.equal(h.calls.length,reads);
  const share=doc('new-share','curriculum-share',1200);h.setAll([share,...history]);await h.emit();
  assert.deepEqual(h.received.at(-1).map(x=>x.id),['new-share']);
});
test('a newer snapshot and unsubscribe discard slow old-page results',async()=>{
  const h=harness(rows(80,undefined));const stop=h.subscribe('shares');const release=h.hold();
  const old=h.emit();await tick();
  const latest=rows(30,'curriculum-share',1200);h.setAll(latest);await h.emit();release();await old;
  assert.deepEqual(h.received.at(-1).map(x=>x.id),latest.slice(0,25).map(x=>x.id));
  const count=h.received.length;stop();await h.emit();assert.equal(h.received.length,count);assert(h.stopped);
});
test('pagination failures are reported instead of presenting an incomplete feed as empty',async()=>{
  const h=harness(rows(80,undefined));h.fail();h.subscribe('shares');await h.emit();
  assert.equal(h.received.length,0);assert.match(h.errors[0].message,/offline/);
});
test('badges watch one live row and keep the other channel latest without repeated history reads',async()=>{
  const chat=rows(70,undefined,1000),share=doc('scope','curriculum-share',800),h=harness([...chat,share]);
  h.subscribe('shares',1);await h.emit();assert.equal(h.liveSize,1);assert.equal(h.received.at(-1)[0].id,'scope');const reads=h.calls.length;
  h.setAll([...rows(1,undefined,1100),...chat,share]);await h.emit();assert.equal(h.calls.length,reads);assert.equal(h.received.at(-1)[0].id,'scope');
});

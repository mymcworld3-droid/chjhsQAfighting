'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {scopeCode, fingerprint, compatible, createAIQuestionBank} = require('../ai-question-bank.cjs');

const target = {
  subject:'物理',level:'高中二年級',topic:'圓周運動',difficulty:'medium',
  facetId:'f_123',role:'reinforce',planVersion:'v1',forms:['direct-application']
};
const question = {
  q:'一個質點做等速圓周運動，速率與角速度的關係為何？',
  correct:'v = rω',wrong:['v = ω/r','v = r/ω','v = ω²r'],
  exp:'等速圓周運動的切線速率是半徑乘角速度。',
  subject:'物理',sub_topic:'圓周運動',
  question_form:'direct-application',
  concept_id:'c_circular',template_id:'circ_speed'
};
function approved(t = target) {
  return {status:'approved',reviewCount:1,catalog:{...t},question};
}
test('scope keys are stable and vary with topic',()=>{
  assert.equal(scopeCode(target),scopeCode({...target,topic:' 圓周運動 '}));
  assert.notEqual(scopeCode(target),scopeCode({...target,topic:'平拋運動'}));
});
test('AI bank uses a single approved review and matching concept',()=>{
  assert.equal(compatible(approved(),target),true);
  assert.equal(compatible({...approved(),reviewCount:0},target),false);
  assert.equal(compatible({...approved(),status:'reviewing'},target),false);
  assert.equal(compatible(approved(),{...target,facetId:'f_other'}),false);
  assert.equal(compatible(approved(),{...target,role:'diagnostic'}),false);
  assert.equal(compatible(approved(),{...target,planVersion:'v2'}),false);
  assert.equal(compatible(approved(),{...target,topic:'牛頓運動定律'}),false);
  // Random practice can reuse EXACTLY matching topic/level/difficulty.
  assert.equal(compatible(approved(),{
    subject:target.subject,level:target.level,topic:target.topic,difficulty:target.difficulty
  }),true);
});
test('disabled bank never calls Google Drive or schedules work',async()=>{
  const bank=createAIQuestionBank({env:{AI_QUESTION_BANK_ENABLED:'0'}});
  assert.equal(bank.enabled,false);
  assert.equal((await bank.find(target)).question,null);
  assert.equal(bank.schedule(target,()=>{throw Error('must not run');}),false);
});
test('publishes one reviewed AI question and can reuse it without reviewing',async()=>{
  let uploads=0, lists=0, createdFolders=0;
  const directories = new Map();
  let uploadParent = null;
  const fetcher=async (url,options={})=>{
    if(url.includes('oauth2.googleapis.com/token'))
      return {ok:true,json:async()=>({access_token:'test',expires_in:3600})};
    if(url.includes('upload/drive/v3/files')) {
      uploads++;
      const match = String(options.body).match(/"parents":\["([^"]+)"\]/);
      uploadParent = match?.[1] || null;
      assert.match(options.body, /reviewCount/);
      assert.match(options.body, /aiq_/);
      return {ok:true,json:async()=>({id:'file-1'})};
    }
    if(url.includes('/drive/v3/files?') && options.method === 'POST') {
      createdFolders++;
      const payload=JSON.parse(options.body);
      const id='folder-' + createdFolders;
      directories.set(payload.parents[0] + '\\u0000' + payload.name,{id,name:payload.name,mimeType:payload.mimeType});
      return {ok:true,json:async()=>({id,name:payload.name})};
    }
    if(url.includes('/drive/v3/files?')){
      const q=new URL(url).searchParams.get('q')||'';
      if(q.includes("application/vnd.google-apps.folder")){
        const parent=q.match(/^'([^']+)' in parents/)?.[1];
        const name=q.match(/name = '([^']+)'/)?.[1];
        const folder=directories.get(parent + '\\u0000' + name);
        return {ok:true,json:async()=>({files:folder?[folder]:[]})};
      }
      lists++;
      return {ok:true,json:async()=>({files:[]})};
    }
    throw Error('Unexpected Drive request');
  };
  const bank=createAIQuestionBank({env:{
    AI_QUESTION_BANK_ENABLED:'1',AI_QUESTION_BANK_DRIVE_FOLDER_ID:'folder-test',
    AI_QUESTION_BANK_GOOGLE_CLIENT_ID:'123456-abcdef.apps.googleusercontent.com',
    AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET:'secret-test',
    AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN:'refresh-test'
  },fetcher});
  assert.equal(await bank.publish(target,question,{approved:true,reason:'獨立解題確認'}),true);
  assert.equal(uploads,1);
  assert.equal(createdFolders,4);
  assert.equal(uploadParent,'folder-4');
  assert.deepEqual([...directories.values()].map(x=>x.name),['高中','物理','高二','圓周運動']);
  assert.equal(await bank.publish(target,question,{approved:true,reason:'同一題'}),false);
  assert.equal(uploads,1);
  const read=await bank.find(target);
  assert.equal(read.ready,true);
  assert.equal(read.question.q,question.q);
  assert.equal(read.count,1);
  assert.equal(lists,1);
  assert.ok(fingerprint(question));
});

test('OAuth environment diagnostics reveal only missing or malformed names, not values',()=>{
  const {oauthConfigurationChecks} = require('../ai-question-bank.cjs');
  const env={
    AI_QUESTION_BANK_GOOGLE_CLIENT_ID:'https://console.cloud.google.com/',
    AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET:'private-client-secret ',
    AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN:''
  };
  const d=oauthConfigurationChecks(env);
  assert(d.missing.includes('AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN'));
  assert(d.issues.some(x=>x.includes('AI_QUESTION_BANK_GOOGLE_CLIENT_ID')));
  assert(d.issues.some(x=>x.includes('AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET')));
  assert(!JSON.stringify(d).includes('private-client-secret'));
});
test('OAuth HTTP 401 explains client ID/secret ambiguity but never prints Google error description',async()=>{
  const warnings=[],infos=[];
  const secret='DO_NOT_LEAK_CLIENT_SECRET';
  const refresh='DO_NOT_LEAK_REFRESH_TOKEN';
  const bank=createAIQuestionBank({
    env:{
      AI_QUESTION_BANK_ENABLED:'1',
      AI_QUESTION_BANK_GOOGLE_CLIENT_ID:'123456-abcdef.apps.googleusercontent.com',
      AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET:secret,
      AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN:refresh
    },
    logger:{warn:(...args)=>warnings.push(args.join(' ')),info:(...args)=>infos.push(args.join(' '))},
    fetcher:async url=>{
      assert(url.includes('oauth2.googleapis.com/token'));
      return {ok:false,status:401,json:async()=>({error:'invalid_client',error_description:'secret='+secret})};
    }
  });
  await assert.rejects(bank.publish(target,question,{approved:true,reason:'ok'}),err=>{
    assert.match(err.message,/HTTP 401 \(invalid_client\)/);
    assert.match(err.message,/AI_QUESTION_BANK_GOOGLE_CLIENT_ID/);
    assert.match(err.message,/AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET/);
    assert(!err.message.includes(secret));
    assert(!err.message.includes(refresh));
    return true;
  });
  assert(infos.some(s=>s.includes('GOOGLE_CLIENT_ID=present')));
  assert(infos.every(s=>!s.includes(secret) && !s.includes(refresh)));
  assert(warnings.every(s=>!s.includes(secret) && !s.includes(refresh)));
});
test('OAuth invalid_grant points to refresh token while service-account errors point to service credentials',()=>{
  const {oauthFailureHint} = require('../ai-question-bank.cjs');
  assert.match(oauthFailureHint('invalid_grant',400,'oauth'),/AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN/);
  assert.match(oauthFailureHint('invalid_client',401,'oauth'),/AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET/);
  assert.match(oauthFailureHint('invalid_grant',401,'service-account'),/SERVICE_ACCOUNT_JSON/);
});

test('single Google OAuth bundle overrides all three stale individual environment variables',async()=>{
  const {resolveOAuthCredentials} = require('../ai-question-bank.cjs');
  const credentials={
    client_id:'123456-real.apps.googleusercontent.com',
    client_secret:'new-secret-with-%+-&',
    refresh_token:'1//fresh-secret-refresh'
  };
  const bundle=Buffer.from(JSON.stringify(credentials),'utf8').toString('base64');
  const env={
    AI_QUESTION_BANK_ENABLED:'1',
    AI_QUESTION_BANK_GOOGLE_OAUTH_B64:bundle,
    AI_QUESTION_BANK_GOOGLE_CLIENT_ID:'123456-old.apps.googleusercontent.com',
    AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET:'wrong-old-client-secret',
    AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN:'wrong-old-refresh'
  };
  assert.equal(resolveOAuthCredentials(env).source,'bundle');
  const infos=[],warnings=[];
  const bank=createAIQuestionBank({
    env,logger:{info:s=>infos.push(s),warn:s=>warnings.push(s)},
    fetcher:async(url,opt)=>{
      if (url.includes('oauth2.googleapis.com/token')) {
        const form=new URLSearchParams(opt.body);
        assert.equal(form.get('client_id'),credentials.client_id);
        assert.equal(form.get('client_secret'),credentials.client_secret);
        assert.equal(form.get('refresh_token'),credentials.refresh_token);
        return {ok:true,json:async()=>({access_token:'mock-access-token',expires_in:3600})};
      }
      if (url.includes('www.googleapis.com/drive/v3/files?'))
        return {ok:true,json:async()=>({files:[]})};
      throw Error('Unexpected API request');
    }
  });
  assert.equal(bank.enabled,true);
  const x=await bank.find(target);
  assert.equal(x.ready,true);
  assert(infos.some(s=>s.includes('OAuth source: AI_QUESTION_BANK_GOOGLE_OAUTH_B64')));
  assert(!JSON.stringify(infos).includes(credentials.client_secret));
  assert(!JSON.stringify(warnings).includes(credentials.refresh_token));
});

test('invalid Google OAuth bundle safely disables bank rather than using stale fallback credentials',()=>{
  const {resolveOAuthCredentials}=require('../ai-question-bank.cjs');
  const env={
    AI_QUESTION_BANK_ENABLED:'1',
    AI_QUESTION_BANK_GOOGLE_OAUTH_B64:'not-valid-base64-json',
    AI_QUESTION_BANK_GOOGLE_CLIENT_ID:'123456-old.apps.googleusercontent.com',
    AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET:'old-secret',
    AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN:'old-token',
    FIREBASE_A_SERVICE_ACCOUNT_JSON:'{}'
  };
  assert.equal(resolveOAuthCredentials(env).source,'invalid-bundle');
  const warnings=[];
  const bank=createAIQuestionBank({env,logger:{warn:s=>warnings.push(s),info:()=>{}}});
  assert.equal(bank.enabled,false);
  assert(warnings.some(s=>s.includes('AI_QUESTION_BANK_GOOGLE_OAUTH_B64 must be Base64-encoded JSON')));
  assert(!JSON.stringify(warnings).includes('old-secret'));
});

test('raw JSON OAuth bundle overrides malformed old Base64 and stale individual credentials',async()=>{
  const good={
    client_id:'123456-correct.apps.googleusercontent.com',
    client_secret:'correct-secret:including-+/&',
    refresh_token:'1//correct-refresh'
  };
  const env={
    AI_QUESTION_BANK_ENABLED:'1',
    AI_QUESTION_BANK_GOOGLE_OAUTH_JSON:JSON.stringify(good),
    AI_QUESTION_BANK_GOOGLE_OAUTH_B64:'bad-old-base64',
    AI_QUESTION_BANK_GOOGLE_CLIENT_ID:'wrong',
    AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET:'wrong',
    AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN:'wrong'
  };
  const {resolveOAuthCredentials}=require('../ai-question-bank.cjs');
  assert.equal(resolveOAuthCredentials(env).source,'json');
  const infos=[],warnings=[];
  const bank=createAIQuestionBank({
    env,
    logger:{info:x=>infos.push(x),warn:x=>warnings.push(x)},
    fetcher:async (url,opt)=>{
      if(url.includes('oauth2.googleapis.com/token')){
        const form=new URLSearchParams(opt.body);
        for(const key of ['client_id','client_secret','refresh_token']) assert.equal(form.get(key),good[key]);
        return {ok:true,json:async()=>({access_token:'token',expires_in:3600})};
      }
      if(url.includes('/drive/v3/files?'))return {ok:true,json:async()=>({files:[]})};
      throw Error('Unexpected URL');
    }
  });
  assert.equal(bank.enabled,true);
  assert.equal((await bank.find(target)).ready,true);
  assert(infos.some(s=>s.includes('OAuth source: AI_QUESTION_BANK_GOOGLE_OAUTH_JSON')));
  assert(!JSON.stringify([...infos,...warnings]).includes(good.refresh_token));
});
test('malformed explicit JSON bundle safely disables AI bank and never pretends to activate service account',()=>{
  const env={
    AI_QUESTION_BANK_ENABLED:'1',
    AI_QUESTION_BANK_GOOGLE_OAUTH_JSON:'{"client_id":"partial"}',
    AI_QUESTION_BANK_GOOGLE_OAUTH_B64:'other-bundle',
    FIREBASE_A_SERVICE_ACCOUNT_JSON:'{}'
  };
  const warnings=[],infos=[];
  const bank=createAIQuestionBank({
    env,logger:{warn:x=>warnings.push(x),info:x=>infos.push(x)}
  });
  assert.equal(bank.enabled,false);
  assert(warnings.some(s=>s.includes('AI_QUESTION_BANK_GOOGLE_OAUTH_JSON must be a JSON object')));
  assert(warnings.some(s=>s.includes('disabled: no usable')));
  assert(!infos.some(s=>s.includes('service-account mode configured')));
  assert(!warnings.some(s=>s.includes('missing AI_QUESTION_BANK_GOOGLE_CLIENT_ID')));
});

test('subject, stage, grade and concept map into human-readable folders',()=>{
  const {questionFolderSegments}=require('../ai-question-bank.cjs');
  assert.deepEqual(questionFolderSegments({
    level:'高中二年級',subject:'物理',
    topic:'第一學期 · 選修物理Ⅱ：力學二與熱學－碰撞與動量守恆'
  }), ['高中','物理','高二','碰撞與動量守恆']);
  assert.deepEqual(questionFolderSegments({
    level:'國中三年級',subject:'數學',topic:'一元二次方程式'
  }), ['國中','數學','國三','一元二次方程式']);
});
test('legacy flat files remain usable and cannot be re-uploaded during directory migration',async()=>{
  const id='legacy-file-1',targetQuestion=approved(target);
  let uploads=0,lists=0;
  const bank=createAIQuestionBank({
    env:{
      AI_QUESTION_BANK_ENABLED:'1',AI_QUESTION_BANK_DRIVE_FOLDER_ID:'root-folder',
      AI_QUESTION_BANK_GOOGLE_CLIENT_ID:'123456-abcdef.apps.googleusercontent.com',
      AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET:'test-secret',
      AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN:'test-refresh'
    },
    fetcher:async (url,opts={})=>{
      if(url.includes('oauth2.googleapis.com/token'))
        return {ok:true,json:async()=>({access_token:'token',expires_in:3600})};
      if(url.includes('/drive/v3/files/'+id))
        return {ok:true,json:async()=>targetQuestion};
      if(url.includes('upload/drive/v3/files')){uploads++;throw Error('should not upload');}
      if(url.includes('/drive/v3/files?')){
        lists++;
        const q=new URL(url).searchParams.get('q');
        if(q.includes("application/vnd.google-apps.folder"))return {ok:true,json:async()=>({files:[]})};
        if(q.includes("'root-folder' in parents"))
          return {ok:true,json:async()=>({files:[{id,name:'aiq_'+scopeCode(target)+'_legacy.json',mimeType:'application/json'}]})};
      }
      throw Error('Unexpected request '+url);
    }
  });
  const found=await bank.find(target);
  assert.equal(found.ready,true);
  assert.equal(found.question.q,question.q);
  assert.equal(await bank.publish(target,question,{approved:true}),false);
  assert.equal(uploads,0);
  assert(lists>=2);
});

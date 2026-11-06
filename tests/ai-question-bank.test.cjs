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
  let uploads=0, lists=0;
  const fetcher=async (url,options={})=>{
    if(url.includes('oauth2.googleapis.com/token'))
      return {ok:true,json:async()=>({access_token:'test',expires_in:3600})};
    if(url.includes('upload/drive/v3/files')) {
      uploads++;
      assert.match(options.body, /reviewCount/);
      assert.match(options.body, /aiq_/);
      return {ok:true,json:async()=>({id:'file-1'})};
    }
    if(url.includes('/drive/v3/files?')){
      lists++;
      return {ok:true,json:async()=>({files:[]})};
    }
    throw Error('Unexpected Drive request');
  };
  const bank=createAIQuestionBank({env:{
    AI_QUESTION_BANK_ENABLED:'1',AI_QUESTION_BANK_DRIVE_FOLDER_ID:'folder-test',
    AI_QUESTION_BANK_GOOGLE_CLIENT_ID:'client-test',
    AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET:'secret-test',
    AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN:'refresh-test'
  },fetcher});
  assert.equal(await bank.publish(target,question,{approved:true,reason:'獨立解題確認'}),true);
  assert.equal(uploads,1);
  assert.equal(await bank.publish(target,question,{approved:true,reason:'同一題'}),false);
  assert.equal(uploads,1);
  const read=await bank.find(target);
  assert.equal(read.ready,true);
  assert.equal(read.question.q,question.q);
  assert.equal(read.count,1);
  assert.equal(lists,1);
  assert.ok(fingerprint(question));
});

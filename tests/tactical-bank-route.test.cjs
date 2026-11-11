'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const client=fs.readFileSync(path.join(root,'public/main-legacy.js'),'utf8');
const battle=fs.readFileSync(path.join(root,'public/cultivation/tactical-combat.js'),'utf8');
const bank=fs.readFileSync(path.join(root,'ai-question-bank.cjs'),'utf8');

test('bank warming is authenticated and derives school grade, subject and topic on server',()=>{
  assert.match(server,/app\.post\('\/api\/tactical\/bank-warm',async\(req,res\)=>\{/);
  assert.match(server,/const uid=await verifyMainIdentity\(req\)/);
  assert.match(server,/const scope=trustedKnowledgeScope\(snap\.data\(\)\|\|\{\}\)/);
  assert.match(server,/const choice=pickTrustedRaidKnowledge\(scope,index\)/);
  assert.match(server,/__trustedTacticalBankTarget:target/);
  assert.match(server,/if \(!req\.__trustedTacticalBankTarget \|\| !aiQuestionBank\.enabled\)/);
});

test('approved AI bank questions are used before live tactical generation',()=>{
  assert.match(server,/aiBankAllowed = aiQuestionBank\.enabled && \(tacticalMode \|\| tacticalBankFill\)/);
  assert.match(server,/if \(bankTarget && attempts === 0 && !tacticalBankFill\)/);
  assert.match(server,/if \(tacticalMode\) \{\s*const question=await tacticalCombat\.commitQuestion\(tacticalContext\.db,tacticalContext\.uid,tacticalContext,bankQuestion\)/);
});

test('background work must finish independent review before archiving, never return an answer to the warm caller',()=>{
  assert.match(server,/const verdict=independentReview\|\|await reviewCandidate\(parsed,bankTarget,routed\.model\)/);
  assert.match(server,/const stored=await aiQuestionBank\.publish\(bankTarget,parsed,verdict\)/);
  assert.match(server,/return res\.json\(\{ok:true,\.\.\.result\}\)/);
  assert.match(bank,/reviewCount:1/);
  assert.match(bank,/status:'approved'/);
});

test('refill is triggered on login, settings changes and active stamina battles',()=>{
  assert.match(client,/void warmTacticalBank\(1\)/);
  assert.match(client,/void warmTacticalBank\(1,\{force:true\}\)/);
  assert.match(battle,/void warmTacticalBank\(Math\.max\(1,\(next\.actors\?\.find\(a=>a\.uid===uid\)\?\.answered\|\|0\)\+1\)\)/);
  assert.match(bank,/async function find\(target, excluded = \[\], isSimilar = \(\) => false, \{deadlineMs=2500\} = \{\}\)/);
});

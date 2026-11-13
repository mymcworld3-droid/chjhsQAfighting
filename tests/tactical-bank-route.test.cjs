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
  assert.match(server,/scope=trialTowerScope\.snapshot\(owner\)/);
  assert.match(server,/const choice=trialTowerScope\.pick\(scope,owner,index-1\)/);
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

test('PvE reads the shared solo stock and its background refill is independent of the battlefield',()=>{
  assert.match(client,/checkSoloQuestionStock\(\);/);
  assert.match(client,/const BUFFER_SIZE = 5;/);
  assert.match(client,/if \(!scope \|\| !uid \|\| soloQuestionCache\.pendingCount\(\) >= BUFFER_SIZE\) return;/);
  assert.doesNotMatch(client,/warmTacticalBank/);
  assert.doesNotMatch(battle,/warmTacticalBank/);
  assert.match(battle,/if\(state\.mode==='pve'\)return soloBattleQuestion\(\);/);
  assert.match(battle,/const quiz=await queue\.take\(\{isCurrent,onEmpty\}\)/);
  assert.match(battle,/if\(!opened\|\|state\?\.mode!=='pvp'/);
});

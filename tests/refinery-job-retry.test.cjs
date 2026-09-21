const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const jobs = fs.readFileSync(path.join(root, 'public/cultivation/refinery-ai-jobs.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/cultivation/cultivation-refinery-v2.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'public/main.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

test('refinery job and UI scripts remain valid after error-handling changes', () => {
  for (const file of ['public/cultivation/refinery-ai-jobs.js', 'public/cultivation/cultivation-refinery-v2.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    // Strip import declarations when using Node's syntax check for browser ESM.
    const result = spawnSync(process.execPath, ['--check', '--input-type=module'], {
      input: source, encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('network and invalid-response errors carry generation-stage and endpoint metadata', () => {
  assert.match(jobs, /fetch\('\/api\/generate-artifact'/);
  assert.match(jobs, /refinery-api-network/);
  assert.match(jobs, /refinery-api-invalid-response/);
  assert.match(jobs, /refinery-api-response/);
  assert.match(jobs, /httpStatus: response\.status/);
  assert.match(jobs, /error\.refineryStage = 'generation'/);
  assert.match(ui, /error\?\.refineryStage \|\| phase/);
  assert.match(ui, /error\?\.cause\?\.message/);
});

test('retrying discovery after a successful AI response reuses that response and preserves job until committed', () => {
  assert.match(jobs, /const generatedCandidateCache = new Map\(\)/);
  assert.match(jobs, /generatedCandidateCache\.get\(job\.id\) \|\| await generateCandidate\(job\)/);
  assert.match(jobs, /generatedCandidateCache\.set\(job\.id, generated\)/);
  const claim = jobs.slice(jobs.indexOf('async function claimDiscovery(job)'), jobs.indexOf('async function claimJob()'));
  assert.match(claim, /tx\.update\(userRef, \{ artifactSystem, \[REFINERY_JOB_FIELD\]: null \}\)/);
  assert.ok(claim.indexOf('generatedCandidateCache.delete(job.id)') > claim.indexOf('await runTransaction'));
  assert.match(ui, /煉製進度已保留/);
  assert.match(ui, /目前無法確認是否開始煉製/);
  assert.match(ui, /開爐/);
  assert.doesNotMatch(ui, /人工智慧/);
});

test('new build query forces updated refinery code without altering module order', () => {
  assert.match(main, /XIUXIAN_FEATURE_BUILD = '20260921-refinery-retry1'/);
  assert.match(index, /main\.js\?v=20260921-refinery-retry1/);
  assert.ok(main.indexOf("'./cultivation/refinery-ai-jobs.js'") <
    main.indexOf("'./cultivation/cultivation-refinery-v2.js'"));
});

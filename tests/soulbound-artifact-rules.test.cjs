const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../artifact-generation-api.js');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

const proposed = (slot = '本命法寶') => ({
  name: '試驗靈劍', weaponForm:'劍', equipSlot:slot,
  effects:[{ type:'equip_attack_flat', value:50 }]
});
const boundBase = {
  id:'already-owned', equipSlot:'本命法寶', weaponForm:'劍',
  effects:[{ type:'equip_attack_flat', value:60 }]
};

test('ordinary new forging cannot create a soulbound equipment slot', () => {
  for (const stage of [1, 2, 3]) {
    const artifact = api.sanitizeGeneratedArtifact(proposed(), '元嬰', stage);
    assert.notEqual(artifact.equipSlot, '本命法寶');
    assert.ok(['護身法寶','佩飾法寶','輔助法寶'].includes(artifact.equipSlot));
  }
});

test('first forging cannot falsely inherit an existing soulbound base', () => {
  const artifact = api.sanitizeGeneratedArtifact(proposed(), '元嬰', 1, {}, {}, 3, {
    primaryArtifacts: [boundBase]
  });
  assert.notEqual(artifact.equipSlot, '本命法寶');
});

test('existing soulbound primary remains soulbound after second and third refinements', () => {
  for (const stage of [2, 3]) {
    const artifact = api.sanitizeGeneratedArtifact(proposed('佩飾法寶'), '元嬰', stage, {}, {}, 3, {
      primaryArtifacts:[boundBase]
    });
    assert.equal(artifact.equipSlot, '本命法寶');
  }
});

test('non-soulbound primary cannot assign itself a soulbound slot through AI', () => {
  const artifact = api.sanitizeGeneratedArtifact(proposed(), '元嬰', 2, {}, {}, 3, {
    primaryArtifacts:[{ ...boundBase, equipSlot:'護身法寶' }]
  });
  assert.notEqual(artifact.equipSlot, '本命法寶');
});

test('legacy and known-recipe paths block minting while equipment slot stays operable', () => {
  const legacy = read('public/cultivation/artifact-system.js');
  const jobs = read('public/cultivation/refinery-ai-jobs.js');
  const equip = read('public/cultivation/unified-inventory-grid.js');
  const market = read('public/cultivation/player-marketplace.js');
  assert.match(legacy, /item\.equipSlot === '本命法寶'.*throw new Error/);
  assert.match(jobs, /hasSoulboundBase/);
  assert.match(jobs, /realSoulboundSource/);
  assert.match(equip, /靈石抽取取得 · 尚未開放/);
  assert.match(equip, /data-uib-empty-slot/);
  assert.doesNotMatch(equip, /data-uib-draw/);
  assert.match(market, /function isSoulboundListing\(type, id\)/);
  assert.match(market, /if \(isSoulboundListing\(type, listing.itemId\)\) throw new Error/);
  assert.match(market, /不可上架或販售配方/);
  assert.match(read('docs/design/soulbound-artifact-rules.md'), /暫不實作/);
});

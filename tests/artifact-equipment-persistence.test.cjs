const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const read = path => readFileSync(join(__dirname, '..', path), 'utf8');
const system = read('public/cultivation/artifact-system.js');
const sync = read('public/cultivation/artifact-catalog-sync.js');
const main = read('public/main-legacy.js');
const bag = read('public/cultivation/unified-inventory-grid.js');
const slots = ['本命法寶', '護身法寶', '佩飾法寶', '輔助法寶'];

function normalizer(catalog, ready) {
  const window = { __artifactCatalogReadyForEquipment: ready };
  const getArtifactById = id => catalog[id] || null;
  const canonicalEquipSlot = item => item?.equipSlot || '';
  const ctx = vm.createContext({
    window, getArtifactById, canonicalEquipSlot, ARTIFACT_EQUIP_SLOTS: slots,
    Math, Number, Object, Array
  });
  const source = system.slice(system.indexOf('  function normalizeSystem(raw = {}) {'),
    system.indexOf('  function state()'));
  assert.ok(source.startsWith('  function normalizeSystem'));
  vm.runInContext(source + '\nthis.normalize = normalizeSystem;', ctx);
  return raw => JSON.parse(JSON.stringify(ctx.normalize(raw)));
}

test('new users store artifact equipment in users/{uid}, and existing users load saved equipment', () => {
  assert.match(main, /artifactSystem: \{ inventory: \{\}, equipped: \{\}, buffs: \{\} \}/);
  assert.match(main, /currentUserData = docSnap\.data\(\)/);
  assert.match(system, /const FIELD = 'artifactSystem'/);
  assert.match(system, /const next = normalizeSystem\(snap\.data\(\)\?\.\[FIELD\] \|\| \{\}\)/);
  assert.match(system, /tx\.update\(ref, \{ \[FIELD\]: committed \}\)/);
  assert.match(system, /next\.equipped\[slot\] = itemId/);
  assert.match(system, /delete next\.equipped\[slot\]/);
  assert.match(bag, /userData\(\)\?\.artifactSystem\?\.equipped\?\.\[slot\]/);
});

test('equipped slots survive reload while remote catalog is loading', () => {
  const saved = {
    inventory: { 'remote-sword': 1, 'known-guard': 2 },
    equipped: { '本命法寶': 'remote-sword', '護身法寶': 'known-guard' },
    buffs: {}
  };
  const known = { 'known-guard': { id: 'known-guard', equipSlot: '護身法寶' } };
  const duringLoad = normalizer(known, false);
  assert.deepEqual(duringLoad(saved).equipped, saved.equipped);
  const afterLoad = normalizer({
    ...known, 'remote-sword': { id: 'remote-sword', equipSlot: '本命法寶' }
  }, true);
  assert.deepEqual(afterLoad(saved).equipped, saved.equipped);
  const invalidAfterLoad = normalizer(known, true);
  assert.deepEqual(invalidAfterLoad(saved).equipped, { '護身法寶': 'known-guard' },
    'once authoritative catalog is loaded, an unknown artifact may be rejected');
});

test('equipment still needs ownership and a compatible slot after catalog load', () => {
  const normalized = normalizer({ sword: { id: 'sword', equipSlot: '本命法寶' } }, true);
  assert.deepEqual(normalized({ inventory: { sword: 0 }, equipped: { '本命法寶': 'sword' } }).equipped, {});
  assert.deepEqual(normalized({ inventory: { sword: 1 }, equipped: { '護身法寶': 'sword' } }).equipped, {});
  assert.deepEqual(normalized({ inventory: { sword: 1 }, equipped: { '本命法寶': 'sword' } }).equipped, { '本命法寶': 'sword' });
});

test('catalog synchronization never removes player equipment while remote catalog is unresolved', () => {
  assert.match(sync, /window\.__artifactCatalogReadyForEquipment = false/);
  assert.match(sync, /window\.__artifactCatalogReadyForEquipment = true;\s*replaceArtifactCatalog\(items, needsBackfill \? 'firestore-backfill' : 'firestore'\)/);
  assert.match(sync, /window\.__artifactCatalogReadyForEquipment = true;\s*applyGenerationPrompt\('', 'default-no-remote-config'\)/);
  assert.match(system, /if \(!ownerUid \|\| !window\.__artifactCatalogReadyForEquipment\) return/);
  assert.match(system, /!item && pendingCatalog/);
  assert.match(system, /if \(authUser\(\)\?\.uid === user\.uid\) setLocalState\(committed\)/);
});

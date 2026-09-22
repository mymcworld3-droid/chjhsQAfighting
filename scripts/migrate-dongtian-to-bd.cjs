#!/usr/bin/env node
'use strict';

// Explicit, non-destructive migration of cave content from A to BD.
// Plays, player balances, and reward receipts stay in A. Never delete A here.
const { isDeepStrictEqual } = require('node:util');
const { adminProject, PROJECT_IDS } = require('../firebase-admin-projects.cjs');
const COLLECTIONS = Object.freeze(['dongtianIndex', 'dongtians', 'dongtianReports']);
const BATCH_SIZE = 120;

function parseArgs(argv) {
  const action = argv.includes('--execute') ? 'execute' : argv.includes('--verify-only') ? 'verify' : 'dry-run';
  if (argv.includes('--execute') && argv.includes('--verify-only')) throw new Error('Choose --execute or --verify-only, not both');
  const unknown = argv.filter(arg => !['--execute', '--verify-only', '--dry-run'].includes(arg));
  if (unknown.length) throw new Error('Unknown option: ' + unknown.join(', '));
  return action;
}

async function listDocuments(db, name) {
  // Reading is required even for a dry run; make counts visible before executing.
  return db.collection(name).get();
}

async function migrate({ source, destination, action = 'dry-run', output = console } = {}) {
  if (!source || !destination || source === destination) throw new Error('Require distinct A and BD Firestore instances');
  const report = {};
  for (const name of COLLECTIONS) {
    const sourceSnap = await listDocuments(source, name);
    const targetSnap = await listDocuments(destination, name);
    const original = new Map(sourceSnap.docs.map(doc => [doc.id, doc.data()]));
    const target = new Map(targetSnap.docs.map(doc => [doc.id, doc.data()]));
    const unexpected = [...target.keys()].filter(id => !original.has(id));
    const conflicts = [...original].filter(([id, data]) => target.has(id) && !isDeepStrictEqual(target.get(id), data));
    const missing = [...original.keys()].filter(id => !target.has(id));
    report[name] = { source: original.size, target: target.size, missing: missing.length, conflicts: conflicts.length, extra: unexpected.length };
    output.log(name + ': A=' + original.size + ', BD=' + target.size + ', to copy=' + missing.length +
      ', mismatched=' + conflicts.length + ', unexpected=' + unexpected.length);

    if (conflicts.length || unexpected.length) {
      throw new Error(name + ' differs in BD; refusing to overwrite or delete documents. Inspect the projects before continuing.');
    }
    if (action === 'verify' && missing.length) throw new Error(name + ' migration is incomplete (' + missing.length + ' missing).');
    if (action !== 'execute' || !missing.length) continue;

    for (let start = 0; start < missing.length; start += BATCH_SIZE) {
      const ids = missing.slice(start, start + BATCH_SIZE);
      // Check A again immediately before copying: fail if a new write landed during migration.
      const refs = ids.map(id => source.collection(name).doc(id));
      const current = await source.getAll(...refs);
      for (let i = 0; i < ids.length; i++) {
        if (!current[i].exists || !isDeepStrictEqual(current[i].data(), original.get(ids[i]))) {
          throw new Error(name + ' changed in A during the migration. Stop writers and rerun.');
        }
      }
      const batch = destination.batch();
      for (let i = 0; i < ids.length; i++) batch.create(destination.collection(name).doc(ids[i]), current[i].data());
      await batch.commit();
      output.log(name + ': copied ' + Math.min(start + BATCH_SIZE, missing.length) + '/' + missing.length);
    }
  }
  if (action === 'execute') {
    output.log('Verifying full A/BD cave document equality...');
    return migrate({ source, destination, action: 'verify', output });
  }
  return report;
}

async function main() {
  const action = parseArgs(process.argv.slice(2));
  if (PROJECT_IDS.A === PROJECT_IDS.BD) throw new Error('A and BD must be different projects');
  const a = adminProject('A');
  const bd = adminProject('BD');
  if (a.app.options.projectId !== PROJECT_IDS.A || bd.app.options.projectId !== PROJECT_IDS.BD) throw new Error('Wrong Firebase destination');
  console.log('Source=' + PROJECT_IDS.A + ', destination=' + PROJECT_IDS.BD + ', mode=' + action);
  if (action !== 'execute') console.log('Read-only: pass --execute to copy missing documents after halting cave writes.');
  await migrate({ source: a.db, destination: bd.db, action });
  console.log(action === 'dry-run' ? 'Dry run finished; no data written.' : 'Cave copy / verification completed.');
}

if (require.main === module) main().catch(error => {
  console.error('[Cave migration] ' + error.message);
  process.exitCode = 1;
});

module.exports = { COLLECTIONS, parseArgs, migrate };

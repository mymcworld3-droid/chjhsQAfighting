#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { isDeepStrictEqual } = require('node:util');
const { adminProject } = require('../firebase-admin-projects.cjs');
const { CHAT_COLLECTION, threadId } = require('../alliance-friend-chat-api.cjs');
const { createPool, fromThread, fromMessage } = require('../friend-chat-store.cjs');
const PAGE_SIZE = 200;
function parseArgs(argv) {
  const allowed = ['--execute', '--verify-only', '--dry-run', '--source-frozen'];
  if (argv.some(x => !allowed.includes(x))) throw new Error('Unknown migration option');
  if (argv.filter(x => ['--execute', '--verify-only', '--dry-run'].includes(x)).length > 1)
    throw new Error('Choose exactly one migration mode');
  const action = argv.includes('--execute') ? 'execute' : argv.includes('--verify-only') ? 'verify' : 'dry-run';
  if (action === 'execute' && !argv.includes('--source-frozen'))
    throw new Error('Freeze all chat writers on Render first, then pass --execute --source-frozen');
  return action;
}
async function* pages(query, documentId) {
  let cursor;
  for (;;) {
    let page = query.orderBy(documentId).limit(PAGE_SIZE);
    if (cursor) page = page.startAfter(cursor);
    const snap = await page.get();
    if (!snap.docs.length) break;
    yield snap.docs;
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE_SIZE) break;
  }
}
function canonicalThread(id, data) {
  const members = data.memberUids;
  if (!Array.isArray(members) || members.length !== 2 || threadId(...members) !== id)
    throw new Error('Invalid source thread identity');
  const row = { id, memberUids: [...members].sort(), names: data.names || {}, unread: data.unread || {},
    lastMessageId: data.lastMessageId || '', lastText: data.lastText || '',
    lastSenderUid: data.lastSenderUid || '', updatedAt: data.updatedAt || 0 };
  if (!Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0 || typeof row.lastText !== 'string' || row.lastText.length > 400)
    throw new Error('Invalid source thread metadata');
  return row;
}
function canonicalMessage(doc, members) {
  const row = { id: doc.id, ...doc.data() };
  if (!members.includes(row.senderUid) || typeof row.text !== 'string' || !row.text.length || row.text.length > 400 ||
      !Number.isSafeInteger(row.sentAt) || row.sentAt < 0) throw new Error('Invalid source message');
  return { id: doc.id, senderUid: row.senderUid, text: row.text, sentAt: row.sentAt };
}
async function migrate({ source, pool, documentId, action = 'dry-run', output = console }) {
  if (!['execute', 'verify', 'dry-run'].includes(action)) throw new Error('Invalid migration action');
  const report = { threads: 0, messages: 0, missing: 0, conflicts: 0, extra: 0 };
  for await (const batch of pages(source.collection(CHAT_COLLECTION), documentId)) {
    for (const doc of batch) {
      const row = canonicalThread(doc.id, doc.data());
      report.threads++;
      if (action === 'execute') await pool.query(`INSERT INTO game_private.friend_chat_threads
        (id,member_uids,names,unread,last_message_id,last_text,last_sender_uid,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [row.id, row.memberUids, JSON.stringify(row.names), JSON.stringify(row.unread), row.lastMessageId,
        row.lastText, row.lastSenderUid, row.updatedAt]);
      const target = await pool.query('SELECT * FROM game_private.friend_chat_threads WHERE id=$1', [row.id]);
      if (!target.rows.length) report.missing++;
      else if (!isDeepStrictEqual(row, fromThread(target.rows[0]))) {
        report.conflicts++;
        if (action === 'execute') throw new Error('Existing target thread differs; refusing to overwrite it');
      }
      let sourceCount = 0;
      for await (const messageDocs of pages(doc.ref.collection('messages'), documentId)) {
        const messages = messageDocs.map(x => canonicalMessage(x, row.memberUids));
        sourceCount += messages.length; report.messages += messages.length;
        if (action === 'execute') {
          // One atomic, bounded statement per page. Existing IDs are never overwritten.
          const params = messages.flatMap(x => [row.id, x.id, x.senderUid, x.text, x.sentAt]);
          const values = messages.map((_, i) => '(' + [1, 2, 3, 4, 5].map(n => '$' + (i * 5 + n)).join(',') + ')').join(',');
          await pool.query(`INSERT INTO game_private.friend_chat_messages (thread_id,id,sender_uid,text,sent_at)
            VALUES ${values} ON CONFLICT (thread_id,id) DO NOTHING`, params);
        }
        const existing = await pool.query(`SELECT id,sender_uid,text,sent_at FROM game_private.friend_chat_messages
          WHERE thread_id=$1 AND id=ANY($2::text[])`, [row.id, messages.map(x => x.id)]);
        const indexed = new Map(existing.rows.map(x => [x.id, fromMessage(x)]));
        for (const message of messages) {
          if (!indexed.has(message.id)) report.missing++;
          else if (!isDeepStrictEqual(message, indexed.get(message.id))) report.conflicts++;
        }
        if (action === 'execute' && report.conflicts) throw new Error('Existing target message differs; refusing to overwrite it');
      }
      const count = await pool.query('SELECT count(*) AS count FROM game_private.friend_chat_messages WHERE thread_id=$1', [row.id]);
      report.extra += Math.max(0, Number(count.rows[0].count) - sourceCount);
      // Detect metadata changes during a copy. The operational write freeze is still required.
      const refreshed = await doc.ref.get();
      if (!refreshed.exists || !isDeepStrictEqual(row, canonicalThread(doc.id, refreshed.data())))
        throw new Error('Source chat changed during migration; keep all writers frozen and investigate');
    }
    output.log(JSON.stringify(report)); // Counts only: never print private messages or UIDs.
  }
  const count = await pool.query('SELECT count(*) AS count FROM game_private.friend_chat_threads');
  report.extra += Math.max(0, Number(count.rows[0].count) - report.threads);
  if (action !== 'dry-run' && (report.missing || report.conflicts || report.extra))
    throw new Error('Verification failed: ' + JSON.stringify(report));
  if (action === 'execute') return migrate({ source, pool, documentId, action: 'verify', output });
  return report;
}
async function main() {
  const action = parseArgs(process.argv.slice(2));
  const pool = createPool();
  try {
    const source = adminProject('BD').db;
    const { FieldPath } = require('firebase-admin/firestore');
    console.log('BD -> PostgreSQL friend chat; mode=' + action + '. Source data is never deleted.');
    console.log(JSON.stringify(await migrate({ source, pool, action, documentId: FieldPath.documentId() })));
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(() => {
  console.error('[Friend chat migration] Failed. Check configuration, write freeze and verification counts. No source data was deleted.');
  process.exitCode = 1;
});
module.exports = { migrate, parseArgs, canonicalThread, canonicalMessage, pages };

'use strict';

// Backend only. Never pass the connection URL or database errors to a browser.
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
let singleton;
function poolConfig(env = process.env) {
  if (!env.SUPABASE_DB_URL) throw new Error('Missing server credential SUPABASE_DB_URL');
  let url;
  try { url = new URL(env.SUPABASE_DB_URL); } catch (_) { throw new Error('Invalid SUPABASE_DB_URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid SUPABASE_DB_URL protocol');
  // pg URL SSL options can otherwise replace the explicit verification settings.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl', 'uselibpqcompat']) url.searchParams.delete(key);
  const ssl = { rejectUnauthorized: true };
  if (env.SUPABASE_DB_CA_FILE) ssl.ca = readFileSync(env.SUPABASE_DB_CA_FILE, 'utf8');
  return { connectionString: url.toString(), ssl, max: 4, connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000, query_timeout: 10000, statement_timeout: 10000,
    application_name: 'chjhs-render-chat' };
}
function createPool(env = process.env) {
  const { Pool } = require('pg');
  const pool = new Pool(poolConfig(env));
  pool.on('error', () => console.warn('[Friend chat] PostgreSQL idle connection unavailable'));
  return pool;
}
function fromThread(row) {
  return { id: row.id, memberUids: row.member_uids, names: row.names, unread: row.unread,
    lastMessageId: row.last_message_id, lastText: row.last_text,
    lastSenderUid: row.last_sender_uid, updatedAt: Number(row.updated_at) };
}
function fromMessage(row) {
  return { id: row.id, senderUid: row.sender_uid, text: row.text, sentAt: Number(row.sent_at) };
}
async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
function createPostgresChatStore(pool) {
  return {
    async inbox(uid) {
      const { rows } = await pool.query(`SELECT * FROM game_private.friend_chat_threads
        WHERE member_uids @> ARRAY[$1]::text[] ORDER BY updated_at DESC, id LIMIT 100`, [uid]);
      return rows.map(fromThread);
    },
    async thread(id) {
      const { rows } = await pool.query(`SELECT m.*,t.last_message_id FROM game_private.friend_chat_threads t
        LEFT JOIN LATERAL (SELECT id,sender_uid,text,sent_at FROM game_private.friend_chat_messages
          WHERE thread_id=t.id ORDER BY sent_at DESC,id DESC LIMIT 60) m ON true
        WHERE t.id=$1 ORDER BY m.sent_at DESC,m.id DESC`, [id]);
      return { messages: rows.filter(row => row.id != null).map(fromMessage), lastMessageId: rows[0]?.last_message_id || '' };
    },
    async send({ id, uid, peerUid, text, current, names }) {
      return transaction(pool, async client => {
        // Atomic, shared across Render processes and across different threads.
        const permit = await client.query(`INSERT INTO game_private.friend_chat_senders (uid,last_sent_at)
          VALUES ($1,$2) ON CONFLICT (uid) DO UPDATE SET last_sent_at=EXCLUDED.last_sent_at
          WHERE friend_chat_senders.last_sent_at <= EXCLUDED.last_sent_at-1500 RETURNING uid`, [uid, current]);
        if (!permit.rowCount) throw Object.assign(new Error('請稍候再發送訊息'), { status: 429 });
        await client.query(`INSERT INTO game_private.friend_chat_threads (id,member_uids)
          VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`, [id, [uid, peerUid].sort()]);
        const { rows } = await client.query('SELECT unread,updated_at FROM game_private.friend_chat_threads WHERE id=$1 FOR UPDATE', [id]);
        const unread = { ...rows[0].unread };
        unread[uid] = Math.max(0, Number(unread[uid]) || 0);
        unread[peerUid] = Math.min(9999, (Number(unread[peerUid]) || 0) + 1);
        // Serialize per-thread timestamps too, so concurrent sends have an unambiguous order.
        const sentAt = Math.max(current, Number(rows[0].updated_at) + 1);
        const message = { id: randomUUID(), senderUid: uid, text, sentAt };
        await client.query(`INSERT INTO game_private.friend_chat_messages (thread_id,id,sender_uid,text,sent_at)
          VALUES ($1,$2,$3,$4,$5)`, [id, message.id, uid, text, sentAt]);
        await client.query(`UPDATE game_private.friend_chat_threads SET names=$2,unread=$3,
          last_message_id=$4,last_text=$5,last_sender_uid=$6,updated_at=$7 WHERE id=$1`,
        [id, JSON.stringify(names), JSON.stringify(unread), message.id, text, uid, sentAt]);
        return message;
      });
    },
    async read(id, uid, lastMessageId) {
      const result = await pool.query(`UPDATE game_private.friend_chat_threads
        SET unread=jsonb_set(unread,ARRAY[$2]::text[],'0'::jsonb,true)
        WHERE id=$1 AND member_uids @> ARRAY[$2]::text[] AND last_message_id=$3 RETURNING id`, [id, uid, lastMessageId]);
      return result.rowCount > 0;
    }
  };
}
function getFriendChatStore(env = process.env) {
  const provider = env.FRIEND_CHAT_STORAGE || 'firestore';
  if (provider === 'firestore') return null;
  if (provider !== 'postgres') throw new Error('Invalid FRIEND_CHAT_STORAGE; use firestore or postgres');
  if (!singleton) singleton = createPostgresChatStore(createPool(env));
  return singleton;
}
module.exports = { createPool, poolConfig, createPostgresChatStore, getFriendChatStore, fromThread, fromMessage, transaction };

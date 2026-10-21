'use strict';
const { randomUUID } = require('node:crypto');
const { playerRepository } = require('./server-repositories.cjs');
const { verifyRequest } = require('./invitation-api.cjs');
const DAY = 86400000;
const fail = (message, status = 400) => Object.assign(Error(message), { status });
const validUid = uid => typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && !/[\/\x00-\x1f]/.test(uid);
const friendsOf = data => [...new Set(Array.isArray(data?.friends) ? data.friends : [])];
const pendingOf = (data, now) => (Array.isArray(data?.pending) ? data.pending : []).filter(r => r.createdAtMs > now - 7 * DAY).slice(-50);
const resolvedOf = (data, now) => (Array.isArray(data?.resolved) ? data.resolved : []).filter(r => r.at > now - DAY).slice(-50);

async function perform(db, uid, body, { now = Date.now, makeId = randomUUID } = {}) {
  const clock = now();
  const userRef = db.collection('users').doc(uid);
  const inboxRef = db.collection('friendRequestInboxes').doc(uid);
  if (body.action === 'status') {
    const [user, inbox] = await Promise.all([userRef.get(), inboxRef.get()]);
    if (!user.exists) throw fail('找不到玩家資料', 404);
    return { pending: pendingOf(inbox.data(), clock), friends: friendsOf(user.data()), acceptRequests: !user.data().friendInvitesDisabled };
  }
  if (body.action === 'preferences') {
    if (typeof body.acceptRequests !== 'boolean') throw fail('邀請設定格式錯誤');
    return db.runTransaction(async tx => {
      const user = await tx.get(userRef);
      if (!user.exists) throw fail('找不到玩家資料', 404);
      if (Boolean(user.data().friendInvitesDisabled) === body.acceptRequests) tx.update(userRef, { friendInvitesDisabled: !body.acceptRequests });
      return { acceptRequests: body.acceptRequests };
    });
  }
  if (body.action === 'send') {
    let peerUid = body.peerUid;
    let code;
    if (!peerUid && typeof body.friendCode === 'string') {
      code = body.friendCode.trim().toUpperCase();
      if (!/^[A-Z0-9]{4,20}$/.test(code)) throw fail('請輸入正確的好友代碼');
      const found = await db.collection('users').where('friendCode', '==', code).limit(2).get();
      if (found.docs.length !== 1) throw fail('找不到這個好友代碼', 404);
      peerUid = found.docs[0].id;
    }
    if (!validUid(peerUid)) throw fail('玩家代碼格式錯誤');
    if (peerUid === uid) throw fail('不能邀請自己');
    const peerRef = db.collection('users').doc(peerUid);
    const targetInbox = db.collection('friendRequestInboxes').doc(peerUid);
    const outbox = db.collection('friendRequestOutboxes').doc(uid);
    return db.runTransaction(async tx => {
      const [user, peer, inbox, history] = await Promise.all([tx.get(userRef), tx.get(peerRef), tx.get(targetInbox), tx.get(outbox)]);
      if (!user.exists || !peer.exists || (code && peer.data().friendCode !== code)) throw fail('找不到玩家資料', 404);
      if (friendsOf(user.data()).includes(peerUid) || friendsOf(peer.data()).includes(uid)) return { alreadyFriends: true };
      if (peer.data().friendInvitesDisabled) throw fail('對方目前不接受好友邀請', 409);
      const pending = pendingOf(inbox.data(), clock);
      if (pending.some(r => r.fromUid === uid)) return { alreadyPending: true };
      if (resolvedOf(inbox.data(), clock).some(r => r.fromUid === uid && r.decision === 'decline')) throw fail('邀請已被婉拒，請於 24 小時後再試', 429);
      if (friendsOf(user.data()).length >= 100 || friendsOf(peer.data()).length >= 100) throw fail('好友人數已達上限', 409);
      if (pending.length >= 50) throw fail('對方的好友邀請收件匣已滿', 409);
      const sent = (Array.isArray(history.data()?.sent) ? history.data().sent : []).filter(t => t > clock - 3600000);
      if (sent.length >= 20) throw fail('每小時最多發送 20 次好友邀請', 429);
      const request = { id: makeId(), fromUid: uid, name: String(user.data().displayName || '修士').slice(0, 64), createdAtMs: clock };
      tx.set(targetInbox, { pending: [...pending, request], resolved: resolvedOf(inbox.data(), clock) });
      tx.set(outbox, { sent: [...sent, clock] });
      return { sent: true, notifyUid: peerUid, change: 'received', requestId: request.id };
    });
  }
  if (body.action === 'respond') {
    if (typeof body.requestId !== 'string' || body.requestId.length > 100 || !['accept', 'decline'].includes(body.decision)) throw fail('邀請回覆格式錯誤');
    return db.runTransaction(async tx => {
      const [user, inbox] = await Promise.all([tx.get(userRef), tx.get(inboxRef)]);
      if (!user.exists) throw fail('找不到玩家資料', 404);
      const pending = pendingOf(inbox.data(), clock);
      const resolved = resolvedOf(inbox.data(), clock);
      const request = pending.find(r => r.id === body.requestId);
      if (!request) {
        const previous = resolved.find(r => r.id === body.requestId);
        if (previous) return { friends: friendsOf(user.data()), pending, alreadyResolved: true, decision: previous.decision };
        throw fail('邀請已過期或不存在', 404);
      }
      const peerRef = db.collection('users').doc(request.fromUid);
      const peer = await tx.get(peerRef);
      const peerInboxRef = db.collection('friendRequestInboxes').doc(request.fromUid);
      const peerInbox = body.decision === 'accept' ? await tx.get(peerInboxRef) : null;
      let friends = friendsOf(user.data());
      if (body.decision === 'accept') {
        if (!peer.exists) throw fail('對方帳號已不存在，請拒絕此邀請', 404);
        const peerFriends = friendsOf(peer.data());
        if ((!friends.includes(request.fromUid) && friends.length >= 100) || (!peerFriends.includes(uid) && peerFriends.length >= 100)) throw fail('好友人數已達上限', 409);
        friends = [...new Set([...friends, request.fromUid])];
        tx.update(userRef, { friends });
        tx.update(peerRef, { friends: [...new Set([...peerFriends, uid])] });
        // Crossed invitations are settled by the same explicit acceptance.
        const reverse = pendingOf(peerInbox.data(), clock);
        if (reverse.some(r => r.fromUid === uid)) tx.set(peerInboxRef, {
          pending: reverse.filter(r => r.fromUid !== uid),
          resolved: [...resolvedOf(peerInbox.data(), clock), ...reverse.filter(r => r.fromUid === uid).map(r => ({ id: r.id, fromUid: uid, decision: 'accept', at: clock }))].slice(-50)
        });
      }
      const remaining = pending.filter(r => r.id !== request.id);
      tx.set(inboxRef, { pending: remaining, resolved: [...resolved, { id: request.id, fromUid: request.fromUid, decision: body.decision, at: clock }].slice(-50) });
      return { friends, pending: remaining, decision: body.decision, notifyUid: body.decision === 'accept' ? request.fromUid : undefined, change: 'changed' };
    });
  }
  throw fail('未知的好友操作');
}

function registerFriendRequestsApi(app, { resolveA = () => playerRepository.resolve(), hub, logger = console } = {}) {
  app.post('/api/friends', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { uid, a } = await verifyRequest(req, resolveA);
      const result = await perform(a.db, uid, req.body || {});
      const { notifyUid, change, ...payload } = result;
      if (notifyUid) hub?.push(notifyUid, { id: randomUUID(), type: 'friend-request', change, createdAtMs: Date.now() });
      return res.json({ ok: true, ...payload });
    } catch (error) {
      if (!error.status) logger.error('[Friends]', error.message);
      return res.status(error.status || 503).json({ ok: false, error: error.status ? error.message : '好友服務暫時無法使用，請稍後再試' });
    }
  });
}
module.exports = registerFriendRequestsApi;
module.exports.perform = perform;

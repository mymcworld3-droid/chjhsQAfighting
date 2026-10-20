'use strict';

// Firebase C 變更直接推送；A 的收益結算不阻擋房間更新。
function streamRaidRoom({req, res, ref, uid, initialRoom, settleSpirit, logger = console}) {
  if(req.aborted||res.destroyed||res.writableEnded)return;
  let stopped = false, unsubscribe, keepalive, renew, rewardRetry;
  let rewardRunning = false, rewardRoom = null, latestRoom = initialRoom;
  let revision = Number(initialRoom?.revision) || 0;
  function stop() {
    if (stopped) return;
    stopped = true;
    unsubscribe?.();
    clearInterval(keepalive); clearInterval(rewardRetry); clearTimeout(renew);
    res.end();
  }
  function send(payload) {
    if (stopped || res.destroyed) return;
    if (res.writableLength > 1024*1024) { stop(); return; }
    res.write('data: ' + JSON.stringify(payload) + '\n\n');
  }
  async function rewards(room) {
    rewardRoom = room;
    if (rewardRunning) return;
    rewardRunning = true;
    try {
      while (rewardRoom && !stopped) {
        const current = rewardRoom; rewardRoom = null;
        const spiritReward = await settleSpirit(current);
        if (spiritReward) send({spiritReward});
      }
    } catch (error) { logger.error('[Raid stream reward]', error?.message || error); }
    finally { rewardRunning = false; }
  }
  function deliver(room) {
    if (stopped) return;
    if (!room?.members?.[uid]) { send({error:'你不在這個團本隊伍',status:403}); stop(); return; }
    const next = Number(room.revision) || 0;
    if (next < revision) return;
    revision = next; latestRoom = room;
    send({room:{id:ref.id,...room}});
    void rewards(room);
  }
  res.set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform',
    'X-Accel-Buffering':'no'});
  res.flushHeaders(); res.write(': connected\n\n');
  res.on('close',stop); req.on('aborted',stop);
  deliver(initialRoom);
  if (stopped) return;
  function failed(error) {
    logger.error('[Raid stream]',error?.message || error);
    send({error:'團本即時連線中斷',status:503}); stop();
  }
  try {
    unsubscribe = ref.onSnapshot(snap => {
      if (!snap.exists) { send({error:'團本房間不存在',status:404}); stop(); return; }
      deliver(snap.data());
    },failed);
  } catch (error) { failed(error); return; }
  if (stopped) { unsubscribe?.(); return; }
  keepalive = setInterval(() => {
    if (stopped) return;
    res.write(': keepalive\n\n');
  },15000);
  rewardRetry = setInterval(() => { if (!stopped) void rewards(latestRoom); },1000);
  // 定期重新驗證登入；憑證只放在 Authorization header。
  renew = setTimeout(stop,5*60*1000);
  keepalive.unref?.(); rewardRetry.unref?.(); renew.unref?.();
}
module.exports = {streamRaidRoom};

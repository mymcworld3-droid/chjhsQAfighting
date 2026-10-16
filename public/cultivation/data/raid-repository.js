import { authenticatedMainFetch, getMainUser } from './project-repository.js';
import { readRoomEvents } from './room-event-stream.js';

const DEFAULT_ENDPOINT = '/api/raid/room';

export const raidRepository = Object.freeze({
  domain: 'raid',
  role: 'C',
  transport: 'server-authoritative',

  async ensureAuth() {
    const user = getMainUser();
    if (!user) throw new Error('主專案尚未登入');
    await user.getIdToken();
    return { uid:user.uid };
  },

  async request(action, payload = {}, endpoint = DEFAULT_ENDPOINT) {
    const response = await authenticatedMainFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ action, ...payload })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) {
      const error = new Error(data.error || '團本房間連線失敗');
      error.status = response.status;
      throw error;
    }
    return data;
  },

  subscribeRoom(roomId, next, onError, connected) {
    const uid = getMainUser()?.uid;
    let stopped = false, controller, retry, retryDelay = 1000;
    async function connect() {
      if (stopped) return;
      controller = new AbortController();
      const current = controller;
      let watchdog = setTimeout(() => current.abort(),6000);
      try {
        if (!uid || getMainUser()?.uid !== uid) throw Object.assign(new Error('登入帳號已變更'),{status:401});
        const response = await authenticatedMainFetch(DEFAULT_ENDPOINT,{
          method:'POST',body:JSON.stringify({action:'subscribe',roomId}),signal:current.signal
        });
        await readRoomEvents(response,packet => {
          if (stopped || getMainUser()?.uid !== uid) { current.abort(); return; }
          retryDelay = 1000;
          connected?.(true);
          next(packet);
        },current.signal,() => {
          clearTimeout(watchdog);
          watchdog = setTimeout(() => current.abort(),25000);
        });
      } catch (error) {
        if (stopped) return;
        onError?.(error);
        if ([401,403,404].includes(error?.status)) { stopped = true; current.abort(); return; }
      } finally {
        clearTimeout(watchdog);
        current.abort();
        if (!stopped) {
          connected?.(false);
          retry = setTimeout(connect,retryDelay);
          retryDelay = Math.min(30000,retryDelay * 2);
        }
      }
    }
    void connect();
    return () => { stopped = true; clearTimeout(retry); controller?.abort(); };
  }
});

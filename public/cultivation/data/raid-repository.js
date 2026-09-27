import { authenticatedMainFetch, getMainUser } from './project-repository.js';

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
  }
});

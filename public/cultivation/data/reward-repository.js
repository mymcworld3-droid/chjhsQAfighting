import { authenticatedMainFetch } from './project-repository.js';

export const rewardRepository = Object.freeze({
  domain: 'settlement',
  role: 'A',

  async claimRaid(roomId) {
    const response = await authenticatedMainFetch('/api/raid/reward', {
      method: 'POST',
      body: JSON.stringify({ roomId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.error || '團本獎勵尚未完成入帳');
    }
    return payload;
  }
});

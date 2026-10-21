import { authenticatedMainFetch } from './project-repository.js';

// Bound authentication, response headers and JSON reading as one operation.
// Aborting fetch alone cannot bound a stalled token refresh on mobile browsers.
export async function raidRequestJson(endpoint, payload, timeoutMs = 20000) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('團本連線逾時，請重試；已結算的答案不會重複扣算。'), { code:'raid-timeout', status:408 }));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await authenticatedMainFetch(endpoint, {
        method:'POST', body:JSON.stringify(payload), signal:controller.signal
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        throw Object.assign(new Error(data.error || '團本連線失敗，請稍後重試。'), { status:response.status });
      }
      return data;
    })()]);
  } finally { clearTimeout(timer); }
}

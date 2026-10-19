// Private Render -> Worker gateway. Never give SERVICE_TOKEN to the browser.
export default {
  async fetch(request, env) {
    const headers = { 'Cache-Control': 'no-store' };
    if (!env.SERVICE_TOKEN || env.SERVICE_TOKEN.length < 32) return new Response('Unavailable', {status:503, headers});
    const expected = new TextEncoder().encode('Bearer ' + env.SERVICE_TOKEN);
    const actual = new TextEncoder().encode(request.headers.get('Authorization') || '');
    let mismatch = expected.length ^ actual.length;
    for (let i=0; i<expected.length; i++) mismatch |= expected[i] ^ (actual[i] || 0);
    if (mismatch) return new Response('Unauthorized', {status:401, headers});
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/query') return new Response('Not found', {status:404, headers});
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 4_000_000) return new Response('Too large', {status:413, headers});
      const { statements } = JSON.parse(raw);
      if (!Array.isArray(statements) || !statements.length || statements.length > 500) throw Error('Invalid batch');
      const prepared = statements.map(({sql, params = []}) => {
        if (typeof sql !== 'string' || sql.length > 100_000 || !Array.isArray(params) || params.length > 100) throw Error('Invalid statement');
        return env.DB.prepare(sql).bind(...params);
      });
      // batch() is a single SQL transaction: a failed version guard rolls back ALL writes.
      const result = await env.DB.batch(prepared);
      return Response.json({success:true, result}, {headers});
    } catch (error) {
      const conflict = /d1_version_guard|CHECK constraint failed: valid/i.test(String(error?.message));
      // SQL and bindings may contain private player data. Do not echo them.
      return Response.json({success:false, code:conflict?'aborted':'d1-query-failed'}, {status:conflict?409:503, headers});
    }
  }
};

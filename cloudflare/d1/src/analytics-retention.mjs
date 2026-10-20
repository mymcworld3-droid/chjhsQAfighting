// One bounded atomic cleanup per hour. Aggregated player/daily/visitor metrics
// remain intact; version tombstones prevent stale transactions resurrecting data.
export const EXPIRY = `CASE WHEN json_extract(data,'$.expireAt.__d1type')='timestamp' THEN json_extract(data,'$.expireAt.seconds')*1000+json_extract(data,'$.expireAt.nanoseconds')/1000000.0
 WHEN json_extract(data,'$.expireAt.__d1type')='date' THEN CAST(strftime('%s',json_extract(data,'$.expireAt.value')) AS INTEGER)*1000
 ELSE json_extract(data,'$.expireAt') END`;
export function cleanupStatements(nowMs = Date.now()) {
  const expired = `FROM documents INDEXED BY analytics_event_expiry
    WHERE namespace='A' AND collection_path='playerAnalyticsEvents' AND (${EXPIRY}) <= ?
    ORDER BY ${EXPIRY},id LIMIT 500`;
  return [
    { sql: `INSERT INTO document_versions(namespace,path,version)
        SELECT namespace,path,version+1 ${expired}
        ON CONFLICT(namespace,path) DO UPDATE SET version=excluded.version`, params: [nowMs] },
    { sql: `DELETE FROM documents WHERE namespace='A' AND path IN (SELECT path ${expired})`, params: [nowMs] },
    { sql: `INSERT INTO collection_versions(namespace,path,version)
        SELECT 'A','playerAnalyticsEvents',1 WHERE changes()>0
        ON CONFLICT(namespace,path) DO UPDATE SET version=version+1`, params: [] }
  ];
}
export async function cleanupAnalytics(env, nowMs = Date.now()) {
  return env.DB.batch(cleanupStatements(nowMs).map(({sql,params}) => env.DB.prepare(sql).bind(...params)));
}

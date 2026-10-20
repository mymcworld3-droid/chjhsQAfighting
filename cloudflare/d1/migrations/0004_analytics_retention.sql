-- Match the store's orderBy expression, including imported Timestamp events.
CREATE INDEX IF NOT EXISTS analytics_event_time ON documents(namespace,collection_path,
 CASE WHEN json_extract(data,'$.at.__d1type')='timestamp' THEN json_extract(data,'$.at.seconds')*1000+json_extract(data,'$.at.nanoseconds')/1000000.0 ELSE json_extract(data,'$.at') END DESC,id DESC)
 WHERE collection_path='playerAnalyticsEvents';

-- New events encode JS Date; migrated Firestore events encode Timestamp.
CREATE INDEX IF NOT EXISTS analytics_event_expiry ON documents(namespace,collection_path,
 CASE WHEN json_extract(data,'$.expireAt.__d1type')='timestamp' THEN json_extract(data,'$.expireAt.seconds')*1000+json_extract(data,'$.expireAt.nanoseconds')/1000000.0
 WHEN json_extract(data,'$.expireAt.__d1type')='date' THEN CAST(strftime('%s',json_extract(data,'$.expireAt.value')) AS INTEGER)*1000
 ELSE json_extract(data,'$.expireAt') END,id)
 WHERE collection_path='playerAnalyticsEvents';

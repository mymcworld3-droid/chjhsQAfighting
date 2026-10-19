-- Partial indexes avoid charging every profile write for indexes used by other domains.
CREATE INDEX IF NOT EXISTS player_friend_code ON documents(namespace,collection_path,json_extract(data,'$.friendCode'),id) WHERE collection_path='users';
CREATE INDEX IF NOT EXISTS player_score ON documents(namespace,collection_path,json_extract(data,'$.stats.totalScore'),id) WHERE collection_path='users';
CREATE INDEX IF NOT EXISTS owned_cave ON documents(namespace,collection_path,json_extract(data,'$.ownerUid'),id) WHERE collection_path IN ('dongtians','dongtianIndex','dongtianReports');
CREATE INDEX IF NOT EXISTS active_cave ON documents(namespace,collection_path,json_extract(data,'$.status'),id) WHERE collection_path='dongtianIndex';
CREATE INDEX IF NOT EXISTS reported_cave ON documents(namespace,collection_path,json_extract(data,'$.dongtianId'),id) WHERE collection_path='dongtianReports';
CREATE INDEX IF NOT EXISTS owner_report ON documents(namespace,collection_path,json_extract(data,'$.reporterUid'),id) WHERE collection_path='dongtianReports';
CREATE INDEX IF NOT EXISTS player_history ON documents(namespace,collection_path,json_extract(data,'$.uid'),id) WHERE collection_path IN ('exam_logs','dongtianPlays','dongtianRewardClaims');
CREATE INDEX IF NOT EXISTS room_status ON documents(namespace,collection_path,json_extract(data,'$.status'),id) WHERE collection_path IN ('rooms','raidRooms');
CREATE INDEX IF NOT EXISTS room_code ON documents(namespace,collection_path,json_extract(data,'$.code'),id) WHERE collection_path='raidRooms';
CREATE INDEX IF NOT EXISTS room_host ON documents(namespace,collection_path,json_extract(data,'$.host.uid'),id) WHERE collection_path='rooms';
CREATE INDEX IF NOT EXISTS room_guest ON documents(namespace,collection_path,json_extract(data,'$.guest.uid'),id) WHERE collection_path='rooms';
CREATE INDEX IF NOT EXISTS immortals_cohort ON documents(namespace,collection_path,json_extract(data,'$.cohort'),id) WHERE collection_path='worldImmortals';
CREATE INDEX IF NOT EXISTS listing_status ON documents(namespace,collection_path,json_extract(data,'$.status'),id) WHERE collection_path='marketListings';
CREATE INDEX IF NOT EXISTS listing_seller ON documents(namespace,collection_path,json_extract(data,'$.sellerUid'),id) WHERE collection_path='marketListings';
CREATE INDEX IF NOT EXISTS analytics_day ON documents(namespace,collection_path,json_extract(data,'$.day'),id) WHERE collection_path='playerAnalyticsDaily';
CREATE INDEX IF NOT EXISTS analytics_first_day ON documents(namespace,collection_path,json_extract(data,'$.firstDay'),id) WHERE collection_path IN ('playerAnalyticsVisitors','playerAnalyticsPlayers');
CREATE INDEX IF NOT EXISTS history_uid_time ON documents(namespace,collection_path,json_extract(data,'$.uid'),
 CASE WHEN json_extract(data,'$.timestamp.__d1type')='timestamp' THEN json_extract(data,'$.timestamp.seconds')*1000+json_extract(data,'$.timestamp.nanoseconds')/1000000.0 ELSE json_extract(data,'$.timestamp') END DESC,id DESC) WHERE collection_path='exam_logs';
CREATE INDEX IF NOT EXISTS chat_time ON documents(namespace,collection_path,
 CASE WHEN json_extract(data,'$.timestamp.__d1type')='timestamp' THEN json_extract(data,'$.timestamp.seconds')*1000+json_extract(data,'$.timestamp.nanoseconds')/1000000.0 ELSE json_extract(data,'$.timestamp') END DESC,id DESC) WHERE collection_path='global_chat';

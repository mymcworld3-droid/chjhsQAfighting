-- Preserve Firestore document paths and types while moving authority to SQL.
-- A=players/economy, BD=caves/chat, C=battle/raid. Same IDs in different roles never collide.
CREATE TABLE IF NOT EXISTS documents (
  namespace TEXT NOT NULL CHECK(namespace IN ('A','BD','C')),
  path TEXT NOT NULL,
  collection_path TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(namespace,path)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS documents_collection ON documents(namespace,collection_path,id);
CREATE TABLE IF NOT EXISTS collection_versions (
  namespace TEXT NOT NULL, path TEXT NOT NULL, version INTEGER NOT NULL,
  PRIMARY KEY(namespace,path)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS d1_version_guard (
  id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1)
);
CREATE TABLE IF NOT EXISTS migration_runs (
  id TEXT PRIMARY KEY, source_project TEXT NOT NULL, started_at INTEGER NOT NULL,
  finished_at INTEGER, documents_copied INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL, manifest_sha256 TEXT
);
-- Tombstones retain monotonically increasing document versions after deletes (ABA protection).
CREATE TABLE IF NOT EXISTS document_versions (
  namespace TEXT NOT NULL, path TEXT NOT NULL, version INTEGER NOT NULL,
  PRIMARY KEY(namespace,path)
) WITHOUT ROWID;
CREATE VIEW IF NOT EXISTS collection_inventory AS
 SELECT namespace, collection_path, count(*) AS documents, sum(length(CAST(data AS BLOB))) AS bytes
 FROM documents GROUP BY namespace,collection_path;
CREATE VIEW IF NOT EXISTS players AS
 SELECT id AS uid,json_extract(data,'$.displayName') AS display_name,
 json_extract(data,'$.stats.totalScore') AS cultivation,json_extract(data,'$.stats.gold') AS gold,
 data,version,updated_at FROM documents WHERE namespace='A' AND collection_path='users';
CREATE VIEW IF NOT EXISTS caves AS
 SELECT id,json_extract(data,'$.ownerUid') AS owner_uid,json_extract(data,'$.status') AS status,data
 FROM documents WHERE namespace='BD' AND collection_path='dongtians';
CREATE VIEW IF NOT EXISTS battle_rooms AS
 SELECT namespace,id,json_extract(data,'$.status') AS status,data FROM documents
 WHERE collection_path IN ('rooms','raidRooms');

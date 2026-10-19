-- Durable administrator-triggered migration; never stored in player documents.
CREATE TABLE IF NOT EXISTS d1_admin_migration_jobs (
  id TEXT PRIMARY KEY,
  admin_uid TEXT NOT NULL,
  state TEXT NOT NULL CHECK(json_valid(state)),
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS d1_admin_migration_tasks (
  job_id TEXT NOT NULL,
  namespace TEXT NOT NULL CHECK(namespace IN ('A','BD','C')),
  kind TEXT NOT NULL CHECK(kind IN ('collection','document')),
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),
  priority INTEGER NOT NULL,
  PRIMARY KEY(job_id,namespace,kind,path)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS admin_migration_pending
  ON d1_admin_migration_tasks(job_id,status,priority,namespace,path);
CREATE TABLE IF NOT EXISTS d1_admin_migration_documents (
  job_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT,
  target_version INTEGER NOT NULL,
  source_exists INTEGER NOT NULL CHECK(source_exists IN (0,1)),
  source_update_time TEXT,
  pass INTEGER NOT NULL,
  PRIMARY KEY(job_id,namespace,path)
) WITHOUT ROWID;

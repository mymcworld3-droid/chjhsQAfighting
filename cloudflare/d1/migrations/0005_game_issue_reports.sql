-- Only issue writes maintain this index; other game collections are unaffected.
CREATE INDEX IF NOT EXISTS game_issue_time ON documents(namespace,collection_path,
  CASE WHEN json_extract(data,'$.createdAtMs.__d1type')='timestamp' THEN json_extract(data,'$.createdAtMs.seconds')*1000+json_extract(data,'$.createdAtMs.nanoseconds')/1000000.0 ELSE json_extract(data,'$.createdAtMs') END DESC,id DESC) WHERE collection_path='gameIssueReports';

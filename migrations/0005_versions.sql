-- Every saved state of a project's model. The snapshot itself is in R2 at
-- projects/<id>/versions/<version>.json; restoring writes a new version, so nothing is lost.
CREATE TABLE IF NOT EXISTS project_versions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  source     TEXT NOT NULL DEFAULT 'edit',  -- edit | ai | restore | create | import
  label      TEXT NOT NULL DEFAULT '',
  summary    TEXT NOT NULL DEFAULT '{}',
  size       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, version)
);
CREATE INDEX IF NOT EXISTS project_versions_recent ON project_versions(project_id, created_at DESC);

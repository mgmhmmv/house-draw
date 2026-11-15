-- Design-studio stages: brief → concept → design → drawings → review → handover → done.
-- SQLite can't change a CHECK constraint in place, so the projects table is rebuilt.
-- Dropping it cascades to its child rows, so those are copied aside and put back.

CREATE TABLE _keep_files AS SELECT * FROM project_files;
CREATE TABLE _keep_docs AS SELECT * FROM project_documents;

CREATE TABLE projects_new (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  client      TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'brief'
              CHECK (status IN ('brief', 'concept', 'design', 'drawings', 'review', 'handover', 'done', 'archived')),
  template    TEXT NOT NULL DEFAULT 'blank',
  summary     TEXT NOT NULL DEFAULT '{}',
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  islepos_customer_id TEXT,
  cover_at    INTEGER
);

INSERT INTO projects_new (id, owner_id, name, client, location, status, template, summary, version, created_at, updated_at, islepos_customer_id, cover_at)
SELECT id, owner_id, name, client, location,
       CASE status
         WHEN 'documentation' THEN 'drawings'
         WHEN 'construction'  THEN 'handover'
         WHEN 'complete'      THEN 'done'
         ELSE status
       END,
       template, summary, version, created_at, updated_at, islepos_customer_id, cover_at
FROM projects;

DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;
CREATE INDEX projects_owner_updated ON projects(owner_id, updated_at DESC);

INSERT INTO project_files SELECT * FROM _keep_files;
INSERT INTO project_documents SELECT * FROM _keep_docs;
DROP TABLE _keep_files;
DROP TABLE _keep_docs;

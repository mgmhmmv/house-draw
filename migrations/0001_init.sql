-- ArchStudio core schema: accounts, sessions, projects and project files.
-- Project models (the BIM JSON) live in R2 at projects/<id>/model.json; D1 keeps
-- the metadata the dashboard lists and filters on.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- Only a SHA-256 of the session token is stored, so a leaked table cannot be replayed.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  client      TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'concept'
              CHECK (status IN ('concept', 'design', 'documentation', 'construction', 'complete', 'archived')),
  template    TEXT NOT NULL DEFAULT 'blank',
  -- Small facts for cards: floor area, levels, rooms, bedrooms. Recomputed on every model save.
  summary     TEXT NOT NULL DEFAULT '{}',
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX projects_owner_updated ON projects(owner_id, updated_at DESC);

CREATE TABLE project_files (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'attachment' CHECK (kind IN ('attachment', 'trace', 'export', 'cover')),
  name         TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX project_files_project ON project_files(project_id, created_at DESC);

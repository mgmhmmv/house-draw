-- IslePOS connection (one per user) and the IslePOS documents raised for each project.
-- The merchant's API key is stored encrypted (AES-GCM, key derived from ISLEPOS_KEY_SECRET).

CREATE TABLE integrations (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  env          TEXT NOT NULL DEFAULT 'production' CHECK (env IN ('staging', 'production')),
  key_cipher   TEXT NOT NULL,
  key_iv       TEXT NOT NULL,
  key_hint     TEXT NOT NULL,
  business_id  TEXT,
  connected_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);

ALTER TABLE projects ADD COLUMN islepos_customer_id TEXT;

CREATE TABLE project_documents (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('quote', 'invoice')),
  islepos_id  TEXT NOT NULL,
  number      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft',
  total       REAL NOT NULL DEFAULT 0,
  balance_due REAL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX project_documents_project ON project_documents(project_id, created_at DESC);

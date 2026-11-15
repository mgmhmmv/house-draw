-- Objects users have made (with the AI) for their library. `spec` is JSON: name, size,
-- mounting and the parts it is built from. Projects that use one keep their own copy.
CREATE TABLE IF NOT EXISTS custom_assets (
  id         TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  spec       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, id)
);

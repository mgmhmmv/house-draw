-- Per-user settings (JSON), e.g. the studio details printed in drawing title blocks.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

-- Email-and-password accounts for people invited by the studio owner (not on the Google allowlist).
-- users.can_sign_in = 1 lets an account in; the owner can switch it off. Invites are one-time,
-- expiring links to set a password; only a SHA-256 of the token is stored.
ALTER TABLE users ADD COLUMN can_sign_in INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL COLLATE NOCASE,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

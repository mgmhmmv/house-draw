-- Public 3D view link: an unguessable token per project. /v/<token> opens the building's
-- facade in 3D for anyone with the link (no plans, services, client or other details).
ALTER TABLE projects ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS projects_share_token ON projects(share_token);

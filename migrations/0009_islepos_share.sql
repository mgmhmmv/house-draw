-- "Share to IslePOS": a never-expiring link (/s/<token>) the IslePOS Solar Suite imports a design
-- from. The export it serves is kept in R2 at projects/<id>/islepos-export.json. NULL = off.
ALTER TABLE projects ADD COLUMN islepos_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS projects_islepos_token ON projects(islepos_token);

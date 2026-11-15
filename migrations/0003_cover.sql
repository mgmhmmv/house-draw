-- When the project's cover render was last updated (ms). The image itself is in R2 at
-- projects/<id>/cover.webp; NULL means no render yet.
ALTER TABLE projects ADD COLUMN cover_at INTEGER;

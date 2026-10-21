-- Table OpenNext's D1 tag cache reads and writes (same DDL as `opennextjs-cloudflare populateCache`).
-- Webflow Cloud applies migrations_dir on every deploy.
CREATE TABLE IF NOT EXISTS revalidations (tag TEXT NOT NULL, revalidatedAt INTEGER NOT NULL, stale INTEGER, expire INTEGER default NULL, UNIQUE(tag) ON CONFLICT REPLACE);

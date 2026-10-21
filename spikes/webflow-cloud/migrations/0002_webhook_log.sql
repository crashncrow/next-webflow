-- Spike only: every request to /api/webflow, to capture real payloads and timings (stage 4 E2E).
CREATE TABLE IF NOT EXISTS webhook_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  status INTEGER NOT NULL,
  trigger_type TEXT,
  signed INTEGER NOT NULL,
  response TEXT NOT NULL,
  raw_body TEXT NOT NULL
);

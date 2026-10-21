-- Spike only: how long the library's handler took per webhook (stage 5b: 20 s request limit).
ALTER TABLE webhook_log ADD COLUMN duration_ms INTEGER;

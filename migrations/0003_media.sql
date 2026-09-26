ALTER TABLE messages ADD COLUMN media_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN unavailable_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rounds ADD COLUMN media_json TEXT NOT NULL DEFAULT '{}';
-- Revisit old pages: attachment-only messages were excluded by the original importer.
DELETE FROM state WHERE key IN ('history_complete','history_before');

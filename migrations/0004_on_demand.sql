-- Replace the copied channel archive with on-demand Discord history search.
-- Selected puzzles and player scores remain intact.
DROP TABLE messages;
DELETE FROM state WHERE key IN ('history_complete','history_before','latest_id');
CREATE INDEX rounds_source ON rounds(source_id,practice,day);

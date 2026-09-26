CREATE TABLE author_counts (
  source_channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY(source_channel_id,user_id)
);
ALTER TABLE rounds ADD COLUMN eligible_authors_json TEXT;

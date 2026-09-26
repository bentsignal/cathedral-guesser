CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  eligible INTEGER NOT NULL DEFAULT 1,
  used_at TEXT
);
CREATE INDEX messages_eligible ON messages(eligible, used_at);
CREATE TABLE rounds (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  practice INTEGER NOT NULL DEFAULT 0,
  source_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  discord_id TEXT,
  revealed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX rounds_daily ON rounds(day) WHERE practice = 0;
CREATE TABLE guesses (
  round_id TEXT NOT NULL REFERENCES rounds(id),
  user_id TEXT NOT NULL,
  guessed_id TEXT NOT NULL,
  correct INTEGER NOT NULL,
  interaction_id TEXT NOT NULL UNIQUE,
  published_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (round_id, user_id)
);
CREATE INDEX guesses_unpublished ON guesses(published_id);
CREATE TABLE leases (key TEXT PRIMARY KEY, holder TEXT NOT NULL, expires INTEGER NOT NULL);

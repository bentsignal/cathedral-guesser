ALTER TABLE rounds ADD COLUMN guess_limit INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rounds ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE guesses ADD COLUMN attempts_used INTEGER NOT NULL DEFAULT 1;
CREATE TABLE attempts (
  round_id TEXT NOT NULL REFERENCES rounds(id),
  user_id TEXT NOT NULL,
  guessed_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 3),
  correct INTEGER NOT NULL,
  interaction_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(round_id,user_id,attempt),
  UNIQUE(round_id,user_id,guessed_id)
);
CREATE TRIGGER finish_guess AFTER INSERT ON attempts
WHEN NEW.correct=1 OR NEW.attempt >= (SELECT guess_limit FROM rounds WHERE id=NEW.round_id)
BEGIN
  INSERT OR IGNORE INTO guesses(round_id,user_id,guessed_id,correct,interaction_id,attempts_used)
  VALUES(NEW.round_id,NEW.user_id,NEW.guessed_id,NEW.correct,NEW.interaction_id,NEW.attempt);
END;

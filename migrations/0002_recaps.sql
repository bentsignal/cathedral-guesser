CREATE TABLE recaps (
  round_id TEXT NOT NULL REFERENCES rounds(id),
  page INTEGER NOT NULL,
  content TEXT NOT NULL,
  published_id TEXT,
  PRIMARY KEY (round_id,page)
);
CREATE INDEX recaps_unpublished ON recaps(published_id);

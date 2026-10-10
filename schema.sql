-- YouTube Research Demo — SQLite schema.
-- Applied automatically on server start (see features/youtube/db.ts).
-- Safe to run repeatedly: every statement is CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS transcripts (
  ts         TEXT NOT NULL,
  url        TEXT NOT NULL,
  video_id   TEXT NOT NULL,
  title      TEXT,
  summary    TEXT,
  transcript TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(url)
);

CREATE TABLE IF NOT EXISTS channel_research_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  channel      TEXT NOT NULL,
  date_from    TEXT NOT NULL,
  date_to      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  synthesis_md TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channel_research_videos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      INTEGER NOT NULL REFERENCES channel_research_runs(id),
  video_id    TEXT NOT NULL,
  title       TEXT,
  upload_date TEXT,
  transcript  TEXT,
  summary_md  TEXT
);

CREATE TABLE IF NOT EXISTS channel_research_conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     INTEGER NOT NULL REFERENCES channel_research_runs(id),
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS queue_handoffs (
  video_id      TEXT PRIMARY KEY,
  title         TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  first_seen_at TEXT NOT NULL,
  completed_at  TEXT
);

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';

/**
 * DB access for the save-to-playlist queue poller's own queue_handoffs table.
 * Deliberately independent of db.ts (the main app DB module) — same
 * underlying sqlite file in production, but this module takes dbPath as an
 * explicit argument so tests can point it at a temporary sqlite file instead
 * of the real database. Opens and closes a connection per call; the poller
 * runs at most once every few minutes, so this isn't a hot path.
 *
 * In production dbPath is always db.ts's DB_PATH, whose directory db.ts
 * already creates on import — but this module makes no assumption about
 * import order or where dbPath came from, so it creates the directory
 * itself too, every time, before opening anything. mkdirSync with
 * recursive:true is a cheap no-op once the directory exists.
 */

export type QueueStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface QueueHandoff {
  video_id: string;
  title: string | null;
  status: QueueStatus;
  attempts: number;
  last_error: string | null;
  first_seen_at: string;
  completed_at: string | null;
}

function withDb<T>(dbPath: string, fn: (db: Database.Database) => T): T {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Additive migration — safe to call on every poll run. No existing tables are touched. */
export function ensureQueueTable(dbPath: string): void {
  withDb(dbPath, (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS queue_handoffs (
      video_id      TEXT PRIMARY KEY,
      title         TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      attempts      INTEGER NOT NULL DEFAULT 0,
      last_error    TEXT,
      first_seen_at TEXT NOT NULL,
      completed_at  TEXT
    )`);
  });
}

/** Whether this video already has a stored summary in the existing transcripts table. */
export function isAlreadySummarized(dbPath: string, videoId: string): boolean {
  return withDb(dbPath, (db) => {
    const row = db.prepare('SELECT 1 as n FROM transcripts WHERE video_id=? LIMIT 1').get(videoId);
    return row != null;
  });
}

export function getHandoff(dbPath: string, videoId: string): QueueHandoff | null {
  return withDb(dbPath, (db) => {
    const row = db
      .prepare(
        'SELECT video_id, title, status, attempts, last_error, first_seen_at, completed_at FROM queue_handoffs WHERE video_id=?'
      )
      .get(videoId) as QueueHandoff | undefined;
    return row ?? null;
  });
}

/** Ensures a row exists for a newly-seen playlist item. No-op if one already does. */
export function upsertSeen(dbPath: string, videoId: string, title: string): QueueHandoff {
  const existing = getHandoff(dbPath, videoId);
  if (existing) return existing;
  const firstSeenAt = new Date().toISOString();
  withDb(dbPath, (db) => {
    db.prepare(
      'INSERT INTO queue_handoffs (video_id, title, status, attempts, first_seen_at) VALUES (?,?,?,0,?)'
    ).run(videoId, title, 'pending', firstSeenAt);
  });
  return { video_id: videoId, title, status: 'pending', attempts: 0, last_error: null, first_seen_at: firstSeenAt, completed_at: null };
}

export function markProcessing(dbPath: string, videoId: string): void {
  withDb(dbPath, (db) => {
    db.prepare(`UPDATE queue_handoffs SET status='processing' WHERE video_id=?`).run(videoId);
  });
}

/** Upsert so this also works for videos that were already summarised before ever being seen in the playlist. */
export function markDone(dbPath: string, videoId: string): void {
  const now = new Date().toISOString();
  withDb(dbPath, (db) => {
    db.prepare(
      `INSERT INTO queue_handoffs (video_id, title, status, attempts, first_seen_at, completed_at)
       VALUES (?, NULL, 'done', 0, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET status='done', completed_at=excluded.completed_at`
    ).run(videoId, now, now);
  });
}

/** Increments attempts and flips to 'failed' once maxAttempts is reached; otherwise stays 'pending' for retry. */
export function recordFailure(dbPath: string, videoId: string, errorMessage: string, maxAttempts: number): QueueHandoff {
  const existing = getHandoff(dbPath, videoId);
  const attempts = (existing?.attempts ?? 0) + 1;
  const status: QueueStatus = attempts >= maxAttempts ? 'failed' : 'pending';
  const truncatedError = errorMessage.slice(0, 2000);
  withDb(dbPath, (db) => {
    db.prepare('UPDATE queue_handoffs SET attempts=?, status=?, last_error=? WHERE video_id=?').run(
      attempts, status, truncatedError, videoId
    );
  });
  return {
    video_id: videoId,
    title: existing?.title ?? null,
    status,
    attempts,
    last_error: truncatedError,
    first_seen_at: existing?.first_seen_at ?? '',
    completed_at: existing?.completed_at ?? null,
  };
}

export function countsByStatus(dbPath: string): Record<QueueStatus, number> {
  const rows = withDb(dbPath, (db) =>
    db.prepare('SELECT status, COUNT(*) as n FROM queue_handoffs GROUP BY status').all() as { status: QueueStatus; n: number }[]
  );
  const counts: Record<QueueStatus, number> = { pending: 0, processing: 0, done: 0, failed: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

/** Among the given video IDs (all seen in the playlist on the latest poll), how many are not yet 'done'. */
export function countNotDone(dbPath: string, videoIds: string[]): number {
  if (!videoIds.length) return 0;
  const placeholders = videoIds.map(() => '?').join(',');
  const row = withDb(dbPath, (db) =>
    db.prepare(`SELECT COUNT(*) as n FROM queue_handoffs WHERE video_id IN (${placeholders}) AND status != 'done'`).get(...videoIds) as { n: number }
  );
  return row?.n ?? 0;
}

export function listFailed(dbPath: string, limit = 20): QueueHandoff[] {
  return withDb(dbPath, (db) =>
    db
      .prepare(
        'SELECT video_id, title, status, attempts, last_error, first_seen_at, completed_at FROM queue_handoffs WHERE status=? ORDER BY first_seen_at DESC LIMIT ?'
      )
      .all('failed', limit) as QueueHandoff[]
  );
}

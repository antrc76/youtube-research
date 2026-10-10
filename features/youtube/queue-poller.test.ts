import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureQueueTable, getHandoff } from './queue-db.ts';
import { processQueueItem } from './queue-poller.ts';

/**
 * Exercises processQueueItem against a temporary sqlite file (never the real
 * app database) with fake submit/remove functions standing in for the HTTP
 * calls to the existing pipeline and to the YouTube Data API. Run with:
 *   npm test
 */

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yt-queue-test-'));
  const dbPath = join(dir, 'test.db');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE transcripts (video_id TEXT, url TEXT, title TEXT, summary TEXT, transcript TEXT, ts TEXT)');
  db.close();
  ensureQueueTable(dbPath);
  return dbPath;
}

function markSummarized(dbPath: string, videoId: string): void {
  const db = new Database(dbPath);
  db.prepare('INSERT INTO transcripts (video_id, url, title, summary, transcript, ts) VALUES (?,?,?,?,?,?)').run(
    videoId, `https://youtu.be/${videoId}`, 't', 's', '', '2026-01-01T00:00:00Z'
  );
  db.close();
}

test('a new video gets processed and marked done, then removed from the playlist', async () => {
  const dbPath = makeTempDb();
  const removed: string[] = [];

  await processQueueItem(
    { playlistItemId: 'pi1', videoId: 'abc12345678', title: 'Test video' },
    { dbPath, maxAttempts: 3, submit: async () => {}, remove: async (id) => { removed.push(id); } }
  );

  const handoff = getHandoff(dbPath, 'abc12345678');
  assert.equal(handoff?.status, 'done');
  assert.deepEqual(removed, ['pi1']);

  rmSync(dbPath, { force: true });
});

test('a failure increments attempts and stays pending for retry (below max)', async () => {
  const dbPath = makeTempDb();
  const removed: string[] = [];
  const item = { playlistItemId: 'pi2', videoId: 'def12345678', title: 'Flaky video' };

  await processQueueItem(item, { dbPath, maxAttempts: 3, submit: async () => { throw new Error('boom'); }, remove: async (id) => { removed.push(id); } });
  let handoff = getHandoff(dbPath, 'def12345678');
  assert.equal(handoff?.status, 'pending');
  assert.equal(handoff?.attempts, 1);
  assert.deepEqual(removed, []); // never removed on failure

  await processQueueItem(item, { dbPath, maxAttempts: 3, submit: async () => { throw new Error('boom again'); }, remove: async (id) => { removed.push(id); } });
  handoff = getHandoff(dbPath, 'def12345678');
  assert.equal(handoff?.status, 'pending');
  assert.equal(handoff?.attempts, 2);
  assert.deepEqual(removed, []);

  rmSync(dbPath, { force: true });
});

test('an already-summarised video is skipped and marked done without reprocessing', async () => {
  const dbPath = makeTempDb();
  markSummarized(dbPath, 'ghi12345678');
  let submitCalls = 0;
  const removed: string[] = [];

  await processQueueItem(
    { playlistItemId: 'pi3', videoId: 'ghi12345678', title: 'Already done' },
    { dbPath, maxAttempts: 3, submit: async () => { submitCalls++; }, remove: async (id) => { removed.push(id); } }
  );

  assert.equal(submitCalls, 0);
  const handoff = getHandoff(dbPath, 'ghi12345678');
  assert.equal(handoff?.status, 'done');
  assert.deepEqual(removed, ['pi3']);

  rmSync(dbPath, { force: true });
});

test('hitting max attempts marks the video failed, leaves it in the playlist, and stops retrying', async () => {
  const dbPath = makeTempDb();
  const removed: string[] = [];
  const item = { playlistItemId: 'pi4', videoId: 'jkl12345678', title: 'Always fails' };

  for (let i = 0; i < 3; i++) {
    await processQueueItem(item, {
      dbPath,
      maxAttempts: 3,
      submit: async () => { throw new Error(`fail ${i}`); },
      remove: async (id) => { removed.push(id); },
    });
  }

  const handoff = getHandoff(dbPath, 'jkl12345678');
  assert.equal(handoff?.status, 'failed');
  assert.equal(handoff?.attempts, 3);
  assert.deepEqual(removed, []); // never removed — left for manual review

  let submitCalls = 0;
  await processQueueItem(item, {
    dbPath,
    maxAttempts: 3,
    submit: async () => { submitCalls++; },
    remove: async (id) => { removed.push(id); },
  });
  assert.equal(submitCalls, 0, 'a failed item must not be retried automatically');

  rmSync(dbPath, { force: true });
});

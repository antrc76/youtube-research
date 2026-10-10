import { DB_PATH } from './db';
import {
  ensureQueueTable,
  isAlreadySummarized,
  getHandoff,
  upsertSeen,
  markProcessing,
  markDone,
  recordFailure,
  countNotDone,
} from './queue-db';
import { getValidAccessToken, isYoutubeOAuthConfigured } from './google-auth';

/**
 * In-process poller for the save-to-playlist trigger: watches a YouTube
 * playlist, and for each video not yet summarised, calls the *existing*
 * YouTube Summaries entry point (POST /api/youtube) exactly as the UI does,
 * then removes the video from the playlist.
 *
 * Optional and off by default. Only starts if YOUTUBE_QUEUE_PLAYLIST_ID is
 * set AND both the OAuth env vars and the client-secret file they point to
 * actually exist — otherwise it logs once at startup and does nothing else;
 * every other feature in this app works normally either way.
 *
 * Runs inside this Next.js process via instrumentation.ts — no separate
 * script/container/cron. Only runs while this server process is running.
 */

const LOG_PREFIX = '[youtube/queue-poller]';
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

/** Hard floor regardless of config — playlistItems.list/delete draw from a 10,000/day quota. */
const MIN_POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface PlaylistItem {
  playlistItemId: string;
  videoId: string;
  title: string;
}

export interface LastPollRun {
  /** ISO timestamp of when this run finished listing+processing the playlist. */
  ranAt: string;
  /** Items found in the playlist on this run. */
  found: number;
  /** Of those, how many are still not done (pending/processing/failed). */
  waiting: number;
}

interface QueuePollerGlobalState {
  pollInFlight: boolean;
  lastRun: LastPollRun | null;
  /** ms epoch for when the next scheduled (timer-driven) poll is due. */
  nextDueAt: number | null;
  /** ms epoch of the last manually-triggered ("Check now") run, for rate limiting. */
  lastManualTriggerAt: number | null;
}

/**
 * instrumentation.ts (server start) and the app/api/youtube/queue/* route
 * handlers each import this module, but Next.js doesn't guarantee they get
 * the same module instance across bundles — so shared mutable state lives on
 * globalThis instead of as a plain module-level variable.
 */
function getPollerState(): QueuePollerGlobalState {
  const g = globalThis as typeof globalThis & { __youtubeQueuePollerState__?: QueuePollerGlobalState };
  if (!g.__youtubeQueuePollerState__) {
    g.__youtubeQueuePollerState__ = { pollInFlight: false, lastRun: null, nextDueAt: null, lastManualTriggerAt: null };
  }
  return g.__youtubeQueuePollerState__;
}

export interface QueuePollerStatus {
  lastRun: LastPollRun | null;
  nextDueAt: number | null;
}

/** For GET /api/youtube/queue/status. */
export function getQueuePollerStatus(): QueuePollerStatus {
  const state = getPollerState();
  return { lastRun: state.lastRun, nextDueAt: state.nextDueAt };
}

async function listPlaylistItems(playlistId: string, accessToken: string): Promise<PlaylistItem[]> {
  const items: PlaylistItem[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ part: 'snippet', playlistId, maxResults: '50' });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`${YOUTUBE_API}/playlistItems?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message || `playlistItems.list failed: ${res.status}`);
    }

    for (const it of (data.items ?? []) as Array<{ id?: string; snippet?: Record<string, unknown> }>) {
      const resourceId = it.snippet?.resourceId as { videoId?: string } | undefined;
      const videoId = resourceId?.videoId;
      if (!it.id || !videoId) continue;
      items.push({ playlistItemId: it.id, videoId, title: (it.snippet?.title as string) || videoId });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return items;
}

async function deletePlaylistItem(playlistItemId: string, accessToken: string): Promise<void> {
  const res = await fetch(`${YOUTUBE_API}/playlistItems?id=${encodeURIComponent(playlistItemId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || `playlistItems.delete failed: ${res.status}`);
  }
}

/** Calls the existing "give it a URL, get a stored summary" entry point over loopback HTTP, unmodified. */
async function submitToExistingPipeline(videoId: string): Promise<void> {
  const port = process.env.PORT || '3000';
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(`http://127.0.0.1:${port}/api/youtube`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(3 * 60 * 1000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `POST /api/youtube failed: ${res.status}`);
  }
}

export interface ProcessDeps {
  dbPath: string;
  maxAttempts: number;
  /** Submits a video to the existing summarisation pipeline. Throws on failure. */
  submit: (videoId: string) => Promise<void>;
  /** Removes an item from the playlist. Throws on failure. */
  remove: (playlistItemId: string) => Promise<void>;
}

/**
 * Decides what to do with one playlist item and does it. Exported (and
 * dependency-injected) so it's independently testable against a temporary
 * sqlite db without touching Google, the real database, or the HTTP layer.
 */
export async function processQueueItem(item: PlaylistItem, deps: ProcessDeps): Promise<void> {
  const { dbPath, maxAttempts, submit, remove } = deps;
  const { videoId, title, playlistItemId } = item;

  if (isAlreadySummarized(dbPath, videoId)) {
    markDone(dbPath, videoId);
    try {
      await remove(playlistItemId);
    } catch (err) {
      console.error(`${LOG_PREFIX} ${videoId} already summarised but failed to remove from playlist (will retry next run):`, err instanceof Error ? err.message : err);
    }
    return;
  }

  const handoff = getHandoff(dbPath, videoId);

  if (handoff?.status === 'failed') {
    // Permanently failed — left in the playlist for manual review, not retried automatically.
    return;
  }

  if (handoff?.status === 'done') {
    // Already summarised and marked done on a prior run, but the playlist
    // removal didn't stick (e.g. transient API error) — never call delete
    // on something not yet confirmed processed, but this *was* confirmed.
    try {
      await remove(playlistItemId);
    } catch (err) {
      console.error(`${LOG_PREFIX} ${videoId} marked done but failed to remove from playlist (will retry next run):`, err instanceof Error ? err.message : err);
    }
    return;
  }

  // New, or previously failed-but-under-max-attempts (status stayed 'pending'),
  // or interrupted mid-run by a process restart (stale 'processing') — retry.
  upsertSeen(dbPath, videoId, title);
  markProcessing(dbPath, videoId);

  try {
    await submit(videoId);
    markDone(dbPath, videoId);
    try {
      await remove(playlistItemId);
    } catch (err) {
      console.error(`${LOG_PREFIX} ${videoId} processed but failed to remove from playlist (will retry next run):`, err instanceof Error ? err.message : err);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = recordFailure(dbPath, videoId, message, maxAttempts);
    if (updated.status === 'failed') {
      console.error(`${LOG_PREFIX} ${videoId} failed permanently after ${updated.attempts} attempt(s), left in playlist:`, message);
    } else {
      console.error(`${LOG_PREFIX} ${videoId} attempt ${updated.attempts}/${maxAttempts} failed, will retry next run:`, message);
    }
  }
}

/** One full poll run: list the playlist, process each item. Safe to call repeatedly; never throws. */
export async function runQueuePollOnce(): Promise<void> {
  const state = getPollerState();
  if (state.pollInFlight) {
    console.log(`${LOG_PREFIX} skipping — previous run is still in progress`);
    return;
  }
  state.pollInFlight = true;

  try {
    const playlistId = process.env.YOUTUBE_QUEUE_PLAYLIST_ID;
    if (!playlistId) return; // startYoutubeQueuePoller() already logged this once and shouldn't have scheduled us

    let accessToken: string;
    try {
      accessToken = await getValidAccessToken();
    } catch (err) {
      console.error(`${LOG_PREFIX} YouTube auth unavailable, skipping this run:`, err instanceof Error ? err.message : err);
      return;
    }

    ensureQueueTable(DB_PATH);
    const maxAttempts = parseInt(process.env.YOUTUBE_QUEUE_MAX_ATTEMPTS || '', 10) || 3;

    let items: PlaylistItem[];
    try {
      items = await listPlaylistItems(playlistId, accessToken);
    } catch (err) {
      console.error(`${LOG_PREFIX} failed to list playlist items:`, err instanceof Error ? err.message : err);
      return;
    }

    for (const item of items) {
      try {
        await processQueueItem(item, {
          dbPath: DB_PATH,
          maxAttempts,
          submit: (videoId) => submitToExistingPipeline(videoId),
          remove: (playlistItemId) => deletePlaylistItem(playlistItemId, accessToken),
        });
      } catch (err) {
        // processQueueItem shouldn't throw, but a run must never crash the app.
        console.error(`${LOG_PREFIX} unexpected error processing ${item.videoId}:`, err instanceof Error ? err.message : err);
      }
    }

    state.lastRun = {
      ranAt: new Date().toISOString(),
      found: items.length,
      waiting: countNotDone(DB_PATH, items.map(i => i.videoId)),
    };
  } finally {
    state.pollInFlight = false;
  }
}

const MANUAL_TRIGGER_COOLDOWN_MS = 30 * 1000;

/** Drives the "Check now" button: same runQueuePollOnce, rate-limited to one call per 30s. */
export async function triggerManualPoll(): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const state = getPollerState();
  const now = Date.now();
  if (state.lastManualTriggerAt != null) {
    const elapsed = now - state.lastManualTriggerAt;
    if (elapsed < MANUAL_TRIGGER_COOLDOWN_MS) {
      return { ok: false, retryAfterMs: MANUAL_TRIGGER_COOLDOWN_MS - elapsed };
    }
  }
  state.lastManualTriggerAt = now;
  await runQueuePollOnce();
  return { ok: true };
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Called once from instrumentation.ts on server start. Logs exactly once
 * and returns if the poller isn't fully configured — this is the "optional,
 * off by default" gate: YOUTUBE_QUEUE_PLAYLIST_ID must be set AND the OAuth
 * env vars must point at files that actually exist.
 */
export function startYoutubeQueuePoller(): void {
  if (pollTimer) return; // already started (e.g. dev-mode HMR re-registering)

  const playlistId = process.env.YOUTUBE_QUEUE_PLAYLIST_ID;
  if (!playlistId) {
    console.log(`${LOG_PREFIX} YOUTUBE_QUEUE_PLAYLIST_ID not set — queue poller disabled (everything else in this app works normally)`);
    return;
  }
  if (!isYoutubeOAuthConfigured()) {
    console.log(`${LOG_PREFIX} YOUTUBE_OAUTH_CLIENT_PATH/YOUTUBE_OAUTH_TOKEN_PATH not set, or the client file doesn't exist — queue poller disabled (everything else in this app works normally)`);
    return;
  }

  const configuredMs = parseInt(process.env.YOUTUBE_QUEUE_POLL_INTERVAL_MS || '', 10) || MIN_POLL_INTERVAL_MS;
  const intervalMs = Math.max(MIN_POLL_INTERVAL_MS, configuredMs);

  console.log(`${LOG_PREFIX} starting — polling playlist ${playlistId} every ${intervalMs}ms`);
  const state = getPollerState();
  state.nextDueAt = Date.now() + intervalMs;
  pollTimer = setInterval(() => {
    state.nextDueAt = Date.now() + intervalMs;
    runQueuePollOnce().catch(err => console.error(`${LOG_PREFIX} poll run threw unexpectedly:`, err));
  }, intervalMs);
}

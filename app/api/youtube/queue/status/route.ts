import { NextResponse } from 'next/server';
import { DB_PATH } from '@/features/youtube/db';
import { ensureQueueTable, countsByStatus, listFailed } from '@/features/youtube/queue-db';
import { isYoutubeAuthConfigured } from '@/features/youtube/google-auth';
import { getQueuePollerStatus } from '@/features/youtube/queue-poller';

export const dynamic = 'force-dynamic';

/** GET /api/youtube/queue/status — counts + poller activity + auth state for the status bar. */
export async function GET() {
  try {
    ensureQueueTable(DB_PATH);
    const { lastRun, nextDueAt } = getQueuePollerStatus();
    return NextResponse.json({
      playlistConfigured: !!process.env.YOUTUBE_QUEUE_PLAYLIST_ID,
      authConfigured: isYoutubeAuthConfigured(),
      counts: countsByStatus(DB_PATH),
      failed: listFailed(DB_PATH, 10),
      lastRun,
      nextPollDueAt: nextDueAt != null ? new Date(nextDueAt).toISOString() : null,
    });
  } catch (err) {
    console.error('[youtube/queue/status GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}

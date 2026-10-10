import { NextResponse } from 'next/server';
import { triggerManualPoll } from '@/features/youtube/queue-poller';

export const dynamic = 'force-dynamic';

/**
 * POST /api/youtube/queue/check — "Check now" button target. Runs one poll
 * immediately via the same runQueuePollOnce() the scheduled timer uses, so
 * it still respects the in-flight guard; rate-limited independently of the
 * timer to one manual trigger per 30s (each run costs YouTube quota).
 */
export async function POST() {
  try {
    const result = await triggerManualPoll();
    if (!result.ok) {
      return NextResponse.json({ error: 'rate_limited', retryAfterMs: result.retryAfterMs }, { status: 429 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[youtube/queue/check POST]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'failed to run poll' }, { status: 500 });
  }
}

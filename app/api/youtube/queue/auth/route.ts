import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { buildAuthUrl } from '@/features/youtube/google-auth';

export const dynamic = 'force-dynamic';

/** GET /api/youtube/queue/auth — "Connect YouTube" button target; redirects to Google's consent screen. */
export async function GET() {
  try {
    const state = randomBytes(16).toString('hex');
    const res = NextResponse.redirect(buildAuthUrl(state));
    res.cookies.set('yt_queue_oauth_state', state, {
      httpOnly: true,
      maxAge: 600,
      sameSite: 'lax',
      path: '/api/youtube/queue/auth',
    });
    return res;
  } catch (err) {
    console.error('[youtube/queue/auth GET]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to start YouTube auth' },
      { status: 500 }
    );
  }
}

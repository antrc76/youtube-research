import { NextResponse } from 'next/server';
import { exchangeCodeForTokens, resolveAppOrigin } from '@/features/youtube/google-auth';

export const dynamic = 'force-dynamic';

/** GET /api/youtube/queue/auth/callback — Google redirects here after consent. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const cookieState = req.headers.get('cookie')?.match(/(?:^|;\s*)yt_queue_oauth_state=([^;]+)/)?.[1];
  const origin = resolveAppOrigin(req);

  if (!code || !state || !cookieState || state !== cookieState) {
    console.error('[youtube/queue/auth/callback] missing code or state mismatch');
    return NextResponse.redirect(new URL('/youtube?youtube_auth=error', origin));
  }

  try {
    await exchangeCodeForTokens(code);
    const res = NextResponse.redirect(new URL('/youtube?youtube_auth=success', origin));
    res.cookies.delete('yt_queue_oauth_state');
    return res;
  } catch (err) {
    console.error('[youtube/queue/auth/callback]', err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL('/youtube?youtube_auth=error', origin));
  }
}

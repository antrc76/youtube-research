import { NextResponse } from 'next/server';
import { dbQuery, dbExec } from '@/features/youtube/db';
import { deleteAnalysis, videoIdFor } from '@/features/youtube/analysis-cache';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = parseInt(searchParams.get('limit') ?? '20', 10);
  const limit = Math.max(1, Math.min(Number.isFinite(raw) ? raw : 20, 200));

  try {
    const rows = dbQuery(
      'SELECT ts, url, title, summary, transcript, created_at FROM transcripts ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return NextResponse.json({ transcripts: rows });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}

export async function DELETE(req: Request) {
  let body: { url?: string; ts?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const url = (body.url ?? '').trim();
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  try {
    dbExec('DELETE FROM transcripts WHERE url=?', [url]);
    await deleteAnalysis('youtube', videoIdFor(url));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[transcripts DELETE]', err);
    return NextResponse.json({ error: 'database error' }, { status: 500 });
  }
}

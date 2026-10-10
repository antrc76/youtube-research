import { NextResponse } from 'next/server';
import { dbQuery, dbTransaction } from '@/features/youtube/db';

export const dynamic = 'force-dynamic';

/** GET /api/youtube/channel-research/[id] — full run with synthesis + videos */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const runId = parseInt(id, 10);
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    const runs = dbQuery<{
      id: number; channel: string; date_from: string; date_to: string;
      status: string; synthesis_md: string | null; created_at: string;
    }>(
      'SELECT id, channel, date_from, date_to, status, synthesis_md, created_at FROM channel_research_runs WHERE id=?',
      [runId]
    );
    if (!runs.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const run = runs[0];

    const videos = dbQuery<{
      id: number; video_id: string; title: string | null;
      upload_date: string | null; summary_md: string | null;
    }>(
      'SELECT id, video_id, title, upload_date, summary_md FROM channel_research_videos WHERE run_id=? ORDER BY upload_date ASC',
      [runId]
    );

    return NextResponse.json({ run, videos });
  } catch (err) {
    console.error('[channel-research/[id] GET]', err);
    return NextResponse.json({ error: 'database error' }, { status: 500 });
  }
}

/** DELETE /api/youtube/channel-research/[id] — remove a run and its video summaries */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const runId = parseInt(id, 10);
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    const runs = dbQuery<{ status: string }>(
      'SELECT status FROM channel_research_runs WHERE id=?',
      [runId]
    );
    if (!runs.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (runs[0].status === 'running') {
      return NextResponse.json({ error: 'cannot delete a running run' }, { status: 409 });
    }

    dbTransaction([
      { sql: 'DELETE FROM channel_research_videos WHERE run_id=?', params: [runId] },
      { sql: 'DELETE FROM channel_research_conversations WHERE run_id=?', params: [runId] },
      { sql: 'DELETE FROM channel_research_runs WHERE id=?', params: [runId] },
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[channel-research/[id] DELETE]', err);
    return NextResponse.json({ error: 'database error' }, { status: 500 });
  }
}

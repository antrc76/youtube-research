import { NextResponse } from 'next/server';
import { dbExec, dbQuery } from '@/features/youtube/db';
import { runChannelResearch } from '@/features/youtube/channel-research-pipeline';

export const dynamic = 'force-dynamic';

/** GET /api/youtube/channel-research — list all runs */
export async function GET() {
  try {
    const runs = dbQuery(
      'SELECT id, channel, date_from, date_to, status, created_at, length(synthesis_md) as synthesis_len FROM channel_research_runs ORDER BY created_at DESC LIMIT 20'
    );
    return NextResponse.json({ runs });
  } catch (err) {
    console.error('[channel-research GET]', err);
    return NextResponse.json({ runs: [] });
  }
}

/** POST /api/youtube/channel-research — start a new run */
export async function POST(req: Request) {
  let body: { channel?: string; after?: string; before?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const channel = (body.channel ?? '').trim();
  const after = (body.after ?? '').trim();
  const before = (body.before ?? '').trim();

  if (!channel) return NextResponse.json({ error: 'channel required' }, { status: 400 });
  if (!after || !before) return NextResponse.json({ error: 'after and before required' }, { status: 400 });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(after) || !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    return NextResponse.json({ error: 'dates must be YYYY-MM-DD' }, { status: 400 });
  }
  if (after > before) {
    return NextResponse.json({ error: 'after must be <= before' }, { status: 400 });
  }
  if (!process.env.YOUTUBE_API_KEY) {
    return NextResponse.json({ error: 'YOUTUBE_API_KEY is not configured — required to list a channel\'s uploads' }, { status: 503 });
  }

  const result = dbExec(
    'INSERT INTO channel_research_runs (channel, date_from, date_to, status) VALUES (?,?,?,?)',
    [channel, after, before, 'running']
  );
  const runId = Number(result.lastInsertRowid);

  // Fire-and-forget: runs in this same process for as long as it takes.
  // The UI polls GET /api/youtube/channel-research/[id] for progress.
  void runChannelResearch(runId, channel, after, before);

  return NextResponse.json({ ok: true, runId }, { status: 202 });
}

import { NextResponse } from 'next/server';
import { readAnalyses, writeAnalysis } from '@/features/youtube/analysis-cache';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const analyses = await readAnalyses('youtube');
    return NextResponse.json({ analyses });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  let body: { id?: string; analysis?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const id = (body.id || '').trim();
  const analysis = (body.analysis || '').trim();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (!analysis) return NextResponse.json({ error: 'analysis required' }, { status: 400 });

  try {
    await writeAnalysis('youtube', id, {
      analysis,
      model: body.model,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[analyse-cache] writeAnalysis failed:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

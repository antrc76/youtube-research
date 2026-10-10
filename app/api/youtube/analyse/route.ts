import { NextResponse } from 'next/server';
import { streamAnalysis } from '@/features/youtube/analyse-stream';

export const dynamic = 'force-dynamic';

const MAX_TRANSCRIPT_CHARS = 30000;

export async function POST(req: Request) {
  let body: { url?: string; transcript?: string; summary?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const url = (body.url || '').trim();
  const transcript = (body.transcript || '').trim();
  const summary = (body.summary || '').trim();

  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });
  if (!transcript && !summary) {
    return NextResponse.json({ error: 'transcript or summary required' }, { status: 400 });
  }

  // Prefer transcript; fall back to summary if transcript wasn't captured for
  // some older entries.
  let content = transcript || summary;
  if (content.length > MAX_TRANSCRIPT_CHARS) {
    content = content.slice(0, MAX_TRANSCRIPT_CHARS) + '\n\n[... transcript truncated ...]';
  }

  // Try to give the model a friendlier display name than the raw URL.
  let displayName = url;
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/);
  if (m) displayName = `YouTube video ${m[1]}`;

  return streamAnalysis({
    kind: 'youtube',
    displayName,
    url,
    content,
    contentLabel: transcript ? 'video transcript' : 'video summary',
  });
}

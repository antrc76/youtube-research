import { NextResponse } from 'next/server';
import { dbExec } from '@/features/youtube/db';
import { generateText } from '@/features/youtube/llm-stream';
import { extractVideoId, isValidYouTubeUrl, fetchTranscript, fetchVideoTitle } from '@/features/youtube/transcript';

export const dynamic = 'force-dynamic';

const SUMMARY_PROMPT = (transcript: string) =>
  `Summarise this YouTube transcript in 5-10 sentences, covering the main points:\n\n${transcript}`;

function demoModeHint(message: string): string {
  if (process.env.DEMO_MODE !== 'true') return message;
  return `${message} — in demo mode without OLLAMA_HOST/ANTHROPIC_API_KEY configured, new videos can't be summarised; browse the seeded examples below instead.`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { url } = body;
    if (!url || typeof url !== 'string') return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    const trimmedUrl = url.trim();
    if (!isValidYouTubeUrl(trimmedUrl)) return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
    const videoId = extractVideoId(trimmedUrl);
    if (!videoId) return NextResponse.json({ error: 'Could not extract video ID' }, { status: 400 });

    const transcript = await fetchTranscript(videoId);
    if (!transcript) {
      return NextResponse.json({ error: 'No transcript available for this video' }, { status: 400 });
    }

    let summary: string;
    try {
      const { text } = await generateText({ messages: [{ role: 'user', content: SUMMARY_PROMPT(transcript.slice(0, 12000)) }] });
      summary = text.trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate summary';
      return NextResponse.json({ error: demoModeHint(message) }, { status: 500 });
    }

    const title = (await fetchVideoTitle(trimmedUrl)) ?? '';

    try {
      dbExec('INSERT OR REPLACE INTO transcripts (ts, url, video_id, title, summary, transcript) VALUES (?,?,?,?,?,?)', [
        new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        trimmedUrl,
        videoId,
        title,
        summary,
        transcript,
      ]);
    } catch (err) {
      console.error('Failed to save to db:', err);
    }

    return NextResponse.json({ success: true, summary, url: trimmedUrl }, { status: 201 });
  } catch (err) {
    console.error('YouTube summarize error:', err);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}

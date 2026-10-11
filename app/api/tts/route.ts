import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { prepareSpeechText, ttsCacheKey } from '@/features/youtube/tts-text';

export const dynamic = 'force-dynamic';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const CACHE_DIR = path.join(DATA_DIR, 'tts');

// ElevenLabs' default premade voice ("Adam") — used when ELEVENLABS_VOICE_ID
// is left blank, so the feature works out of the box with just an API key.
// Must be a premade voice, not a library voice: library voices return 402
// "paid_plan_required" over the API on a free ElevenLabs account.
const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB';

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Text-to-speech is not configured (set ELEVENLABS_API_KEY to enable it).' },
      { status: 503 },
    );
  }

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const rawText = (body.text || '').trim();
  if (!rawText) return NextResponse.json({ error: 'text required' }, { status: 400 });

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const { text, truncated } = prepareSpeechText(rawText);
  if (!text) {
    return NextResponse.json({ error: 'Nothing speakable left after stripping markdown.' }, { status: 400 });
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `${ttsCacheKey(text, voiceId)}.mp3`);

  try {
    const cached = await fs.readFile(cachePath);
    return new NextResponse(cached, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'X-TTS-Truncated': String(truncated),
        'X-TTS-Cached': 'true',
      },
    });
  } catch {
    // not cached yet — fall through and call ElevenLabs
  }

  let res: Response;
  try {
    res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return NextResponse.json({ error: 'ElevenLabs request timed out.' }, { status: 504 });
    }
    return NextResponse.json(
      { error: `Failed to reach ElevenLabs: ${err instanceof Error ? err.message : 'network error'}` },
      { status: 502 },
    );
  }

  if (!res.ok) {
    if (res.status === 401) {
      return NextResponse.json({ error: 'ElevenLabs rejected the API key.' }, { status: 401 });
    }
    if (res.status === 429) {
      return NextResponse.json(
        { error: 'ElevenLabs rate limit or free-tier credit quota exhausted.' },
        { status: 429 },
      );
    }
    if (res.status === 402) {
      return NextResponse.json(
        {
          error:
            'ElevenLabs rejected this voice (402 paid_plan_required). Free accounts can only use ' +
            'premade/default voices over the API, not library voices — set ELEVENLABS_VOICE_ID to a ' +
            'premade voice from your account, or unset it to use the built-in default.',
        },
        { status: 402 },
      );
    }
    const detail = await res.text().catch(() => '');
    return NextResponse.json(
      { error: `ElevenLabs returned an error (${res.status}).${detail ? ` ${detail.slice(0, 300)}` : ''}` },
      { status: 502 },
    );
  }

  const audio = Buffer.from(await res.arrayBuffer());
  const tmp = `${cachePath}.tmp`;
  await fs.writeFile(tmp, audio);
  await fs.rename(tmp, cachePath);

  return new NextResponse(audio, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'X-TTS-Truncated': String(truncated),
      'X-TTS-Cached': 'false',
    },
  });
}

import { NextResponse } from 'next/server';
import { dbExec, dbQuery } from '@/features/youtube/db';
import { ChatMessage, LOCAL_TOKEN_BUDGET, estimateTokens, ollamaStream, sonnetStream } from '@/features/youtube/llm-stream';

export const dynamic = 'force-dynamic';

interface RunRow {
  channel: string;
  date_from: string;
  date_to: string;
  status: string;
  synthesis_md: string | null;
}

interface VideoRow {
  title: string | null;
  upload_date: string | null;
  transcript: string | null;
}

function formatUploadDate(raw: string | null): string {
  if (!raw || raw.length !== 8) return raw ?? 'unknown date';
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

// This is the static, per-run part of the conversation — same bytes on every
// turn so Anthropic prompt caching can reuse it (see cacheSystem below). Do
// not fold anything request-specific (the new question, a timestamp, etc.)
// into this string, or every turn invalidates the cache.
function buildSystemPrompt(run: RunRow, videos: VideoRow[]): string {
  const videoBlocks = videos
    .map((v, i) => {
      const title = v.title ?? `Untitled video ${i + 1}`;
      const date = formatUploadDate(v.upload_date);
      const transcript = (v.transcript ?? '').trim() || '[no transcript captured for this video]';
      return `===== VIDEO ${i + 1}: "${title}" (uploaded ${date}) =====\n${transcript}\n===== END VIDEO ${i + 1} =====`;
    })
    .join('\n\n');

  return `You are a critical, skeptical research analyst reviewing YouTube video transcripts from the channel ${run.channel} (uploads between ${run.date_from} and ${run.date_to}).

You will be asked one or more questions about this channel's content, possibly follow-ups building on earlier answers in this same conversation. For every question:
- Cite which video(s) support each claim, by title.
- Do not hedge for the sake of hedging. If the evidence clearly does not support something, say so plainly — "No, the evidence doesn't support that" — and explain why. If it does, say "Yes" and lay out the pattern with specifics.
- If the evidence is mixed or thin, say that plainly too, rather than manufacturing false confidence.
- Quote or closely paraphrase the specific transcript moments you're relying on — don't just assert.
- If none of the transcripts address the question at all, say so directly instead of speculating.

Here is the existing channel-level synthesis, for context only — treat it as a starting point, not ground truth:

<synthesis>
${run.synthesis_md ?? '(no synthesis available)'}
</synthesis>

Here are the full transcripts for every video in this batch, each clearly delimited:

${videoBlocks}

Markdown. No greeting, no sign-off. Lead with your answer.`;
}

/** GET /api/youtube/channel-research/[id]/ask — load conversation history for a run */
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
    const messages = dbQuery<{ role: string; content: string; created_at: string }>(
      'SELECT role, content, created_at FROM channel_research_conversations WHERE run_id=? ORDER BY id ASC',
      [runId]
    );
    return NextResponse.json({ messages });
  } catch (err) {
    console.error('[channel-research/[id]/ask GET]', err);
    return NextResponse.json({ error: 'database error' }, { status: 500 });
  }
}

/** POST /api/youtube/channel-research/[id]/ask — ask (or follow up) in a run's conversation */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const runId = parseInt(id, 10);
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: { question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const question = (body.question ?? '').trim();
  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });

  let run: RunRow;
  let videos: VideoRow[];
  let history: ChatMessage[];
  try {
    const runs = dbQuery<RunRow>(
      'SELECT channel, date_from, date_to, status, synthesis_md FROM channel_research_runs WHERE id=?',
      [runId]
    );
    if (!runs.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
    run = runs[0];

    if (run.status !== 'complete') {
      return NextResponse.json({ error: 'run is not complete yet' }, { status: 409 });
    }

    videos = dbQuery<VideoRow>(
      'SELECT title, upload_date, transcript FROM channel_research_videos WHERE run_id=? ORDER BY upload_date ASC',
      [runId]
    );
    if (!videos.length) {
      return NextResponse.json({ error: 'no videos found for this run' }, { status: 404 });
    }

    history = dbQuery<ChatMessage>(
      'SELECT role, content FROM channel_research_conversations WHERE run_id=? ORDER BY id ASC',
      [runId]
    );
  } catch (err) {
    console.error('[channel-research/[id]/ask POST]', err);
    return NextResponse.json({ error: 'database error' }, { status: 500 });
  }

  const systemPrompt = buildSystemPrompt(run, videos);
  const messages: ChatMessage[] = [...history, { role: 'user', content: question }];
  const promptTokens =
    estimateTokens(systemPrompt) + messages.reduce((n, m) => n + estimateTokens(m.content), 0);

  // At roughly 46k tokens for a 13-video run this fits a single Sonnet call
  // with no chunking. A channel with far more videos in range (50+) — or
  // much longer videos — could push this past what a single call can hold.
  // If that becomes real, switch to a map-reduce: a per-video (or per-chunk)
  // Q&A pass, then a synthesis pass over those partial answers, rather than
  // silently truncating transcripts.
  const useLocal = promptTokens <= LOCAL_TOKEN_BUDGET;
  const result = useLocal
    ? ollamaStream({ system: systemPrompt, messages })
    : sonnetStream({ system: systemPrompt, cacheSystem: true, messages });

  if ('error' in result) {
    // Sonnet path with no API key — return error as-is, no header
    return result.error;
  }

  // Save the question right away so the thread survives even if the model
  // call fails outright.
  dbExec('INSERT INTO channel_research_conversations (run_id, role, content) VALUES (?,?,?)', [
    runId,
    'user',
    question,
  ]);

  // Tee the stream: the client gets it live, while a second reader buffers
  // the full text so we can persist the assistant's reply once it's done.
  const [clientStream, captureStream] = result.stream.tee();
  (async () => {
    const reader = captureStream.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      // ollamaStream/sonnetStream emit failures as "[error: ...]" text
      // inline in the stream rather than throwing — don't save those as a
      // real assistant turn, or a transient failure gets baked into every
      // future prompt for this conversation.
      const looksLikeError = text.trimStart().startsWith('[error:');
      if (text.trim() && !looksLikeError) {
        dbExec('INSERT INTO channel_research_conversations (run_id, role, content) VALUES (?,?,?)', [
          runId,
          'assistant',
          text,
        ]);
      }
    } catch (err) {
      console.error('[channel-research/[id]/ask POST] failed to capture assistant reply', err);
    }
  })();

  return new Response(clientStream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      'x-ask-model': result.model,
      'x-ask-prompt-tokens': String(promptTokens),
    },
  });
}

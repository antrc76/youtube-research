import { dbExec, dbQuery } from './db';
import { generateText } from './llm-stream';
import { resolveChannel, listUploadsInRange } from './youtube-data-api';
import { fetchTranscript } from './transcript';

/**
 * Channel Research pipeline — runs in-process as a detached async job (no
 * child process, no Python, no yt-dlp). The POST route that starts a run
 * calls runChannelResearch() without awaiting it; progress is tracked
 * entirely through the channel_research_runs/videos rows, which the UI
 * polls. This only works for a single long-lived server process — exactly
 * the deployment this demo targets — and a server restart mid-run leaves
 * the row stuck in 'running' (same known limitation the original script had
 * for its own child-process version of this problem).
 */

const MAX_VIDEOS = 40;
const CHUNK_CHAR_LIMIT = 80_000; // ~20k tokens at 4 chars/token
const SLEEP_BETWEEN_VIDEOS_MS = 2_000; // be polite to the transcript endpoint

const VIDEO_SUMMARY_PROMPT = (transcript: string) => `You are analysing a single YouTube video transcript for a channel research report.
Extract the following from the transcript and respond ONLY in plain text structured as shown:

WHAT IS BEING BUILT OR CHANGED:
(1-3 sentences)

ARCHITECTURE / TOOLING DECISIONS:
(bullet points, or "none mentioned")

PROBLEMS HIT AND FIXES:
(bullet points, or "none mentioned")

OPEN QUESTIONS OR NEXT STEPS:
(bullet points, or "none mentioned")

---
TRANSCRIPT:
${transcript}
`;

const CHUNK_MERGE_PROMPT = (summaries: string) => `You have multiple summaries of different chunks of the same video transcript.
Merge them into a single coherent summary with these sections:

WHAT IS BEING BUILT OR CHANGED:
ARCHITECTURE / TOOLING DECISIONS:
PROBLEMS HIT AND FIXES:
OPEN QUESTIONS OR NEXT STEPS:

---
CHUNK SUMMARIES:
${summaries}
`;

const SYNTHESIS_PROMPT = (channel: string, dateFrom: string, dateTo: string, videoSummaries: string) => `You are writing a Channel Research Report based on per-video summaries from a YouTube channel.
The videos are listed in chronological order. Write in clear, structured markdown.

The report must cover:
1. **Overall Project** - What is the creator building at a high level?
2. **Architecture & Stack** - Technologies, tools, and design decisions used.
3. **Chronology of Decisions** - How has the project evolved video by video? Key turning points?
4. **Current State** - Where did the project stand at the end of this period?

Write for a technical viewer deciding whether to watch the full series or follow the channel going forward.

---
CHANNEL: ${channel}
DATE RANGE: ${dateFrom} to ${dateTo}
VIDEO SUMMARIES (oldest first):

${videoSummaries}
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface VideoRow {
  id: number;
  video_id: string;
  title: string | null;
  upload_date: string | null;
  transcript: string | null;
  summary_md: string | null;
}

function getRunVideos(runId: number): VideoRow[] {
  return dbQuery<VideoRow>(
    'SELECT id, video_id, title, upload_date, transcript, summary_md FROM channel_research_videos WHERE run_id=? ORDER BY upload_date ASC',
    [runId]
  );
}

function updateRunStatus(runId: number, status: string, synthesis?: string | null): void {
  dbExec('UPDATE channel_research_runs SET status=?, synthesis_md=? WHERE id=?', [status, synthesis ?? null, runId]);
}

async function summariseVideo(transcript: string): Promise<string> {
  if (transcript.length <= CHUNK_CHAR_LIMIT) {
    const { text } = await generateText({ messages: [{ role: 'user', content: VIDEO_SUMMARY_PROMPT(transcript.slice(0, CHUNK_CHAR_LIMIT)) }] });
    return text;
  }

  const chunks: string[] = [];
  for (let start = 0; start < transcript.length; start += CHUNK_CHAR_LIMIT) {
    chunks.push(transcript.slice(start, start + CHUNK_CHAR_LIMIT));
  }

  const chunkSummaries: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const { text } = await generateText({ messages: [{ role: 'user', content: VIDEO_SUMMARY_PROMPT(chunks[i]) }] });
    chunkSummaries.push(`=== CHUNK ${i + 1} ===\n${text}`);
  }

  const { text: merged } = await generateText({
    messages: [{ role: 'user', content: CHUNK_MERGE_PROMPT(chunkSummaries.join('\n\n')) }],
  });
  return merged;
}

function formatUploadDate(raw: string | null): string {
  if (!raw) return 'unknown date';
  return raw.slice(0, 10);
}

async function synthesise(channel: string, dateFrom: string, dateTo: string, videos: VideoRow[]): Promise<string> {
  const videoSummariesText = videos
    .map((v) => `### [${formatUploadDate(v.upload_date)}] ${v.title}\n${v.summary_md || '(no summary)'}\n`)
    .join('\n');

  const prompt = SYNTHESIS_PROMPT(channel, dateFrom, dateTo, videoSummariesText);
  if (prompt.length <= CHUNK_CHAR_LIMIT) {
    const { text } = await generateText({ messages: [{ role: 'user', content: prompt }] });
    return text;
  }

  // Prompt too large for one call — synthesise each half, then merge.
  const mid = Math.floor(videos.length / 2);
  const partial = async (rows: VideoRow[]) => {
    const text = rows.map((v) => `### [${formatUploadDate(v.upload_date)}] ${v.title}\n${v.summary_md || '(no summary)'}\n`).join('\n');
    const { text: result } = await generateText({ messages: [{ role: 'user', content: SYNTHESIS_PROMPT(channel, dateFrom, dateTo, text) }] });
    return result;
  };
  const [part1, part2] = await Promise.all([partial(videos.slice(0, mid)), partial(videos.slice(mid))]);
  const { text: merged } = await generateText({
    messages: [{ role: 'user', content: `Merge these two partial synthesis reports into one coherent final report:\n\n=== PART 1 ===\n${part1}\n\n=== PART 2 ===\n${part2}` }],
  });
  return merged;
}

/** Entry point — called fire-and-forget by the POST /api/youtube/channel-research route. */
export async function runChannelResearch(runId: number, channel: string, dateFrom: string, dateTo: string): Promise<void> {
  try {
    const after = new Date(dateFrom + 'T00:00:00Z');
    const before = new Date(dateTo + 'T23:59:59Z');

    const channelInfo = await resolveChannel(channel);
    const videos = await listUploadsInRange(channelInfo.uploadsPlaylistId, after, before, MAX_VIDEOS + 1);

    if (videos.length === 0) {
      updateRunStatus(runId, 'error', `No videos found for "${channelInfo.title}" in ${dateFrom} to ${dateTo}`);
      return;
    }
    if (videos.length > MAX_VIDEOS) {
      updateRunStatus(runId, 'error', `${videos.length} videos exceeds the ${MAX_VIDEOS}-video safety limit — narrow the date range`);
      return;
    }

    for (const v of videos) {
      dbExec('INSERT INTO channel_research_videos (run_id, video_id, title, upload_date) VALUES (?,?,?,?)', [
        runId, v.videoId, v.title, v.publishedAt,
      ]);
    }

    let rows = getRunVideos(runId);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const transcript = await fetchTranscript(row.video_id);

      if (!transcript) {
        dbExec('UPDATE channel_research_videos SET transcript=NULL, summary_md=? WHERE id=?', ['(transcript unavailable)', row.id]);
        if (i < rows.length - 1) await sleep(SLEEP_BETWEEN_VIDEOS_MS);
        continue;
      }

      try {
        const summary = await summariseVideo(transcript);
        dbExec('UPDATE channel_research_videos SET transcript=?, summary_md=? WHERE id=?', [transcript, summary, row.id]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dbExec('UPDATE channel_research_videos SET transcript=?, summary_md=? WHERE id=?', [transcript, `(summarisation error: ${message})`, row.id]);
      }

      if (i < rows.length - 1) await sleep(SLEEP_BETWEEN_VIDEOS_MS);
    }

    rows = getRunVideos(runId);
    const synthesis = await synthesise(channelInfo.title, dateFrom, dateTo, rows);
    updateRunStatus(runId, 'complete', synthesis);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateRunStatus(runId, 'error', message);
  }
}

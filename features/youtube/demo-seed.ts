import { dbExec, dbQuery } from './db';
import { writeAnalysis } from './analysis-cache';

/**
 * DEMO_MODE seed data — inserted once, only if the tables are still empty,
 * so the UI has something real to show with zero API keys configured.
 * This is read-only seeding: submitting a genuinely new video/channel still
 * requires real keys (YOUTUBE_API_KEY, and ANTHROPIC_API_KEY or a running
 * Ollama) and will show a normal error if they're missing. Nothing here
 * fakes a live request.
 */

const DEMO_VIDEO_ID = 'dQw4w9WgXcQ';
const DEMO_VIDEO_2_ID = 'jNQXAC9IVRw';

const DEMO_SUMMARY = `This video walks through building a small self-hosted dashboard with Next.js and SQLite: project layout, a couple of API routes, and wiring a local LLM (Ollama) as a free-to-run default with an optional cloud model as a fallback for larger prompts. Mostly a practical "here's the actual code" walkthrough rather than a conceptual talk — useful if you're trying to decide between a local model and a hosted API for a side project.`;

const DEMO_SUMMARY_2 = `A short, early demo-style clip showing a basic web page in action — more a historical curiosity than a technical deep dive, included here as a second sample row so the list and the "View full transcript" / "Analyse for me" controls have more than one entry to work with.`;

const DEMO_SYNTHESIS = `## 1. Overall Project

The channel documents building a small self-hosted developer dashboard — a Next.js front end over a SQLite-backed API, with a handful of utility features (notes, a simple research tool, a content pipeline) bolted on over several videos.

## 2. Architecture & Stack

- Next.js (App Router) + TypeScript for the frontend and API routes
- SQLite via a native driver, no external database server
- Ollama for local inference, with an optional hosted model as a fallback for prompts too large for the local model's context budget
- Deployed as a single container, no reverse proxy or orchestration layer

| Layer | Choice | Why (per the creator) |
| --- | --- | :---: |
| Database | SQLite | Single process, no server to deploy |
| Local model | Ollama | Free, runs on the same machine |
| Fallback model | Hosted API | Only for prompts over the local budget |

## 3. Chronology of Decisions

Early videos start with a single hard-coded feature and a database file committed to the repo — by the middle of the series this gets reworked into environment-variable-driven configuration and a schema file applied on startup, after running into the usual "this breaks on anyone else's machine" problems. The local-vs-hosted-model routing is introduced about halfway through, once prompt sizes start exceeding what the local model handles well.

## 4. Current State

By the end of the period covered, the project has a working demo mode, a documented setup path, and a short test suite for the trickiest piece of logic (a retry/backoff queue). Still open: no CI.

---
*This is sample synthesis text generated for demo mode — it does not describe a real channel.*`;

const DEMO_QUESTION = 'Does the creator actually explain why they chose SQLite over something like Postgres, or do they just use it without justifying it?';
const DEMO_ANSWER = `Yes, briefly — in the video covering the initial setup, the creator says directly that SQLite was chosen because the whole app runs as a single process with no separate database server to deploy, and that Postgres would be "solving a scaling problem I don't have yet." It's a short justification (one or two sentences), not a deep comparison, but it is a stated reason rather than an unexamined default.

*(This is a sample answer generated for demo mode, not a real model response.)*`;

export function seedDemoData(): void {
  const existing = dbQuery<{ n: number }>('SELECT COUNT(*) as n FROM transcripts')[0]?.n ?? 0;
  if (existing > 0) return;

  const now = new Date();
  const ts1 = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const ts2 = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

  dbExec('INSERT OR IGNORE INTO transcripts (ts, url, video_id, title, summary, transcript) VALUES (?,?,?,?,?,?)', [
    ts1,
    `https://www.youtube.com/watch?v=${DEMO_VIDEO_ID}`,
    DEMO_VIDEO_ID,
    '[Demo] Building a self-hosted dashboard with Next.js + SQLite',
    DEMO_SUMMARY,
    '[Demo transcript omitted for brevity — summary above was generated from the full transcript in the original run.]',
  ]);

  dbExec('INSERT OR IGNORE INTO transcripts (ts, url, video_id, title, summary, transcript) VALUES (?,?,?,?,?,?)', [
    ts2,
    `https://www.youtube.com/watch?v=${DEMO_VIDEO_2_ID}`,
    DEMO_VIDEO_2_ID,
    '[Demo] Second sample video',
    DEMO_SUMMARY_2,
    '[Demo transcript omitted for brevity.]',
  ]);

  const runResult = dbExec(
    'INSERT INTO channel_research_runs (channel, date_from, date_to, status, synthesis_md, created_at) VALUES (?,?,?,?,?,?)',
    ['[Demo] @example-dev-channel', '2026-06-01', '2026-07-15', 'complete', DEMO_SYNTHESIS, now.toISOString()]
  );
  const runId = Number(runResult.lastInsertRowid);

  const demoVideos: [string, string, string, string][] = [
    ['demoVid001a', '[Demo] Project kickoff and initial scaffolding', '20260601', 'The creator scaffolds a Next.js app and commits a SQLite file and a hard-coded database path directly into the repo — works on their machine, nowhere else yet.'],
    ['demoVid002b', '[Demo] Making config portable', '20260622', 'Hard-coded paths are replaced with environment variables and a documented .env.example; the creator explicitly calls out that this was motivated by someone else trying (and failing) to run the project.'],
    ['demoVid003c', '[Demo] Adding a demo mode and tests', '20260715', 'A DEMO_MODE flag is added so the app runs with zero API keys, plus a small test suite for the retry/backoff logic in the queue poller — the creator notes this was the part most likely to have a subtle bug.'],
  ];
  for (const [videoId, title, uploadDate, summary] of demoVideos) {
    dbExec('INSERT INTO channel_research_videos (run_id, video_id, title, upload_date, summary_md) VALUES (?,?,?,?,?)', [
      runId, videoId, title, uploadDate, summary,
    ]);
  }

  dbExec('INSERT INTO channel_research_conversations (run_id, role, content) VALUES (?,?,?)', [runId, 'user', DEMO_QUESTION]);
  dbExec('INSERT INTO channel_research_conversations (run_id, role, content) VALUES (?,?,?)', [runId, 'assistant', DEMO_ANSWER]);
}

/** Separate from seedDemoData() because it's async (writes to the filesystem cache, not the db). */
export async function seedDemoAnalysisCache(): Promise<void> {
  try {
    const existing = await import('./analysis-cache').then((m) => m.readAnalyses('youtube'));
    if (Object.keys(existing).length > 0) return;
  } catch {
    // fall through and attempt the write anyway
  }
  await writeAnalysis('youtube', DEMO_VIDEO_ID, {
    analysis: `**Verdict** — Worth a skim if you're actively deciding between a local model and a hosted API for a side project; skip if you've already made that call.

**What it actually is** — A practical walkthrough of a small self-hosted dashboard: Next.js front end, SQLite backend, Ollama as the default model with a cloud fallback for bigger prompts. No new ideas, just a clean worked example.

**Why it matters** — Directly useful if you're choosing a database (SQLite vs. a server-based one) or a model-routing strategy (local-first with a budget-based fallback) for a similar-sized project — the trade-offs discussed are the same ones that come up in any single-process self-hosted app.

**How you'd actually use it** — Steal the token-budget-based routing logic (local model under N tokens, hosted model above it) rather than the whole project — it's the one genuinely reusable piece.

**Watch-outs** — The demo glosses over what happens when the local model is simply unreachable (not just over budget); worth checking that error path before copying it.

*(This is a sample cached analysis shown for demo mode — it was not generated by a live model call.)*`,
    model: 'demo:sample',
    timestamp: new Date().toISOString(),
  });
}

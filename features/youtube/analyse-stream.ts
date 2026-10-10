import fs from 'fs';
import path from 'path';
import { LOCAL_TOKEN_BUDGET, estimateTokens, ollamaStream, sonnetStream } from './llm-stream';

/**
 * Optional "who is this for" context file. Entirely optional — if it's
 * missing, the prompt below just gives a generic assessment instead of a
 * personalised one. See profile.example.md for the expected format.
 */
const PROFILE_PATH = process.env.PROFILE_PATH ?? path.join(process.cwd(), 'profile.md');

function readProfile(): string {
  try {
    return fs.readFileSync(PROFILE_PATH, 'utf-8');
  } catch {
    return '';
  }
}

export interface AnalyseInput {
  kind: 'youtube';
  displayName: string;
  url: string;
  content: string;
  contentLabel: string; // e.g. "video transcript" or "video summary"
}

function buildPrompt(input: AnalyseInput, profile: string): string {
  const profileSection = profile.trim()
    ? `Here is some context on who you're writing for — weight your judgement against these stated interests, not generic novelty:\n\n<profile>\n${profile.trim()}\n</profile>\n\n`
    : '';

  return `You are an analyst giving a straight, no-fluff opinion on a YouTube video. Direct, dry, substantive — skip the hedging and the marketing language.

${profileSection}They're looking at this video: **${input.displayName}**
URL: ${input.url}

Here is the ${input.contentLabel}:

<content>
${input.content}
</content>

Give a personalised breakdown. Sections, in this order:

**Verdict** — one line. Worth the time, or skip? Plain language.

**What it actually is** — 2-3 sentences. The honest version, stripped of marketing.

**Why it matters** — bullet list. If a profile was given above, tie directly to those projects/interests and name them specifically; otherwise give the most substantive, specific take you can for a general technical audience. If it's genuinely not useful to anyone, say so plainly.

**How you'd actually use it** — concrete next step: what to try first, what to skip, what to double check before trusting it.

**Build sketch** — if this is the kind of thing you'd wire into a project, a few bullets on what that wiring actually looks like. Not full code.

**Watch-outs** — anything that would bite someone: dependencies, costs, security, model assumptions, integration friction.

Markdown. No greeting, no sign-off. Lead with the verdict.`;
}

/**
 * Build the analysis prompt, decide local vs remote based on the token
 * budget, and return a streaming Response. The chosen model is surfaced on
 * the `x-analyse-model` response header so the UI can label the panel
 * correctly without re-implementing the routing logic.
 */
export function streamAnalysis(input: AnalyseInput): Response {
  const profile = readProfile();
  const prompt = buildPrompt(input, profile);
  const promptTokens = estimateTokens(prompt);

  const useLocal = promptTokens <= LOCAL_TOKEN_BUDGET;
  const messages = [{ role: 'user' as const, content: prompt }];
  const result = useLocal ? ollamaStream({ messages }) : sonnetStream({ messages });

  if ('error' in result) {
    // Sonnet path with no API key — return error as-is, no header
    return result.error;
  }

  return new Response(result.stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      'x-analyse-model': result.model,
      'x-analyse-prompt-tokens': String(promptTokens),
    },
  });
}

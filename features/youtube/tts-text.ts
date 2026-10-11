import { createHash } from 'node:crypto';

/**
 * Turns a markdown string into plain, speakable text for the ElevenLabs
 * "Listen" feature, and caps it at a sentence boundary so the request stays
 * within the free tier's per-call budget. Pure/dependency-free so it can be
 * unit tested directly — the API route and the UI both just call this.
 */

export const MAX_TTS_CHARS = 2000;

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') && !trimmed.includes('-')) return false;
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

/** Strips markdown syntax (headings, bold/italic, links, tables, code, bullets) into plain text. */
export function stripMarkdown(input: string): string {
  let text = input.replace(/<!--[\s\S]*?-->/g, '');

  // Fenced code blocks — no speakable content, drop entirely.
  text = text.replace(/```[\s\S]*?```/g, ' ');

  const lines = text.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // GFM table: a header line followed by a separator line — drop both
    // plus every subsequent pipe-containing row (the table body).
    if (trimmed.includes('|') && isTableSeparatorLine(lines[i + 1] ?? '')) {
      i++; // consume the separator line too
      while (i + 1 < lines.length && lines[i + 1].includes('|')) i++;
      continue;
    }
    if (isTableSeparatorLine(trimmed)) continue; // orphaned separator row

    // Horizontal rules.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) continue;

    // Headings.
    let stripped = trimmed.replace(/^#{1,6}\s+/, '');

    // Bullets / numbered list markers / checkboxes.
    stripped = stripped.replace(/^(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s*)?/, '');

    kept.push(stripped);
  }
  text = kept.join('\n');

  // Links: [text](url) -> text. Bare URLs are left as-is.
  text = text.replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1');

  // Inline code: `code` -> code.
  text = text.replace(/`([^`\n]+)`/g, '$1');

  // Bold/italic: **text**, __text__, *text*, _text_ -> text.
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  text = text.replace(/__([^_\n]+)__/g, '$1');
  text = text.replace(/\*([^*\n]+)\*/g, '$1');
  text = text.replace(/_([^_\n]+)_/g, '$1');

  // Collapse whitespace: blank lines become sentence breaks, everything
  // else collapses to single spaces so speech flows naturally.
  text = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join('. ')
    .replace(/\.\s*\./g, '.')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return text;
}

export interface TruncationResult {
  text: string;
  truncated: boolean;
}

/** Caps text at maxChars, cutting at the last sentence boundary (or word boundary) rather than mid-word. */
export function truncateAtSentenceBoundary(text: string, maxChars: number = MAX_TTS_CHARS): TruncationResult {
  if (text.length <= maxChars) return { text, truncated: false };

  const slice = text.slice(0, maxChars);
  const sentenceEnds = [...slice.matchAll(/[.!?](?=\s|$)/g)];
  if (sentenceEnds.length > 0) {
    const last = sentenceEnds[sentenceEnds.length - 1];
    const cutAt = (last.index ?? 0) + 1;
    return { text: slice.slice(0, cutAt).trim(), truncated: true };
  }

  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > 0) return { text: slice.slice(0, lastSpace).trim(), truncated: true };

  return { text: slice.trim(), truncated: true };
}

/** Full pipeline: markdown -> plain speakable text, capped at maxChars. */
export function prepareSpeechText(markdown: string, maxChars: number = MAX_TTS_CHARS): TruncationResult {
  const plain = stripMarkdown(markdown);
  return truncateAtSentenceBoundary(plain, maxChars);
}

/** Stable cache key for a given (already-prepared) text + voice id pair. */
export function ttsCacheKey(text: string, voiceId: string): string {
  return createHash('sha256').update(`${voiceId}\u0000${text}`).digest('hex');
}

import { fetchTranscript as fetchTranscriptSegments } from 'youtube-transcript';

/**
 * Transcript fetching — in-process, no Docker, no spawned Python. Uses the
 * youtube-transcript package, which reads the same public (unofficial)
 * caption endpoint the Python youtube-transcript-api library used before
 * this was ported — same legal footing, different language.
 */
export async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    const segments = await fetchTranscriptSegments(videoId);
    const text = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
    return text || null;
  } catch {
    return null;
  }
}

const VIDEO_ID_PATTERNS = [
  /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/,
  /^([a-zA-Z0-9_-]{11})$/,
];

export function extractVideoId(url: string): string | null {
  for (const p of VIDEO_ID_PATTERNS) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export function isValidYouTubeUrl(url: string): boolean {
  return extractVideoId(url) !== null && (url.includes('youtube.com') || url.includes('youtu.be'));
}

export async function fetchVideoTitle(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!res.ok) return undefined;
    const data = await res.json();
    return typeof data?.title === 'string' && data.title.trim() ? data.title.trim() : undefined;
  } catch {
    return undefined;
  }
}

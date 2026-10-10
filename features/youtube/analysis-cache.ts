import { promises as fs } from 'fs';
import path from 'path';

export interface CachedAnalysis {
  analysis: string;
  model?: string;
  timestamp: string;
}

export type AnalysisStore = 'youtube';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');

const STORE_PATHS: Record<AnalysisStore, string> = {
  youtube: path.join(DATA_DIR, 'youtube-analyses.json'),
};

export type AnalysesById = Record<string, CachedAnalysis>;

export async function readAnalyses(store: AnalysisStore): Promise<AnalysesById> {
  try {
    const raw = await fs.readFile(STORE_PATHS[store], 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as AnalysesById;
    }
    return {};
  } catch {
    return {};
  }
}

export async function writeAnalysis(
  store: AnalysisStore,
  id: string,
  entry: CachedAnalysis,
): Promise<void> {
  const target = STORE_PATHS[store];
  await fs.mkdir(path.dirname(target), { recursive: true });
  const current = await readAnalyses(store);
  current[id] = entry;
  const tmp = target + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(current, null, 2), 'utf-8');
  await fs.rename(tmp, target);
}

export async function deleteAnalysis(store: AnalysisStore, id: string): Promise<void> {
  const target = STORE_PATHS[store];
  const current = await readAnalyses(store);
  if (!(id in current)) return;
  delete current[id];
  const tmp = target + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(current, null, 2), 'utf-8');
  await fs.rename(tmp, target);
}

const VIDEO_ID_PATTERNS = [
  /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/,
  /^([a-zA-Z0-9_-]{11})$/,
];

export function videoIdFor(url: string): string {
  for (const p of VIDEO_ID_PATTERNS) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return url;
}

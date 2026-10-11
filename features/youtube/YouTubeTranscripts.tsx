'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Sparkles, Brain, Square, Trash2, RefreshCw } from 'lucide-react';
import MarkdownBlock from '@/components/MarkdownBlock';
import ListenButton from '@/components/ListenButton';

export interface TranscriptEntry {
  ts: string;
  url: string;
  title?: string;
  summary: string;
  transcript?: string;
}

const ACCENT_COLOR = '#ffd700';

const VIDEO_ID_PATTERNS = [
  /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/,
  /^([a-zA-Z0-9_-]{11})$/,
];

function videoIdFor(url: string): string {
  for (const p of VIDEO_ID_PATTERNS) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return url;
}

function shortUrl(url: string): string {
  for (const p of VIDEO_ID_PATTERNS) {
    const m = url.match(p);
    if (m) return `youtu.be/${m[1]}`;
  }
  return url;
}

function relativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, now - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  return `${w}w ago`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' });
}

type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading'; text: string; abort: AbortController; model?: string }
  | { status: 'streaming'; text: string; abort: AbortController; model?: string }
  | { status: 'done'; text: string; model?: string; cachedAt?: string }
  | { status: 'error'; message: string };

function prettifyModel(m: string | undefined): string {
  if (!m) return 'Analyst';
  if (m.startsWith('demo:')) return 'Demo sample';
  if (m.startsWith('ollama:')) {
    const raw = m.slice(7).split(':')[0];
    const pretty = raw.charAt(0).toUpperCase() + raw.slice(1);
    return `${pretty} (local)`;
  }
  if (m.startsWith('anthropic:')) {
    const id = m.slice(10);
    if (id.includes('sonnet')) return 'Sonnet (cloud)';
    if (id.includes('opus')) return 'Opus (cloud)';
    if (id.includes('haiku')) return 'Haiku (cloud)';
    return 'Claude (cloud)';
  }
  return m;
}

interface Props {
  listenEnabled?: boolean;
}

export default function YouTubeTranscripts({ listenEnabled = false }: Props) {
  const [items, setItems] = useState<TranscriptEntry[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [transcriptKey, setTranscriptKey] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [urlInput, setUrlInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisState>>({});
  const analysesRef = useRef(analyses);
  analysesRef.current = analyses;
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const loadTranscripts = useCallback(async () => {
    try {
      const res = await fetch('/api/transcripts?limit=20', { cache: 'no-store' });
      const data = await res.json();
      setItems(Array.isArray(data?.transcripts) ? data.transcripts : []);
      setNow(Date.now());
    } catch {
      setItems([]);
    }
  }, []);

  const loadCachedAnalyses = useCallback(async () => {
    try {
      const res = await fetch('/api/youtube/analyse-cache', { cache: 'no-store' });
      const data = await res.json();
      const cached = data?.analyses as
        | Record<string, { analysis: string; model?: string; timestamp: string }>
        | undefined;
      if (!cached) return;
      setAnalyses(prev => {
        const next = { ...prev };
        for (const [id, v] of Object.entries(cached)) {
          // don't clobber in-flight analyses
          const existing = next[id];
          if (existing && (existing.status === 'loading' || existing.status === 'streaming')) {
            continue;
          }
          next[id] = { status: 'done', text: v.analysis, model: v.model, cachedAt: v.timestamp };
        }
        return next;
      });
    } catch {
      // no cache available — fine, button falls back to Analyse for Me
    }
  }, []);

  useEffect(() => {
    loadTranscripts();
    loadCachedAnalyses();
    const t = setInterval(loadTranscripts, 60_000);
    return () => clearInterval(t);
  }, [loadTranscripts, loadCachedAnalyses]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = urlInput.trim();
    if (!url) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch('/api/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to summarize video');
      }

      setUrlInput('');
      await loadTranscripts();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  const persistAnalysis = useCallback(async (key: string, text: string, model: string | undefined) => {
    try {
      const res = await fetch('/api/youtube/analyse-cache', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: key, analysis: text, model }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setToast({ kind: 'error', text: `Failed to save analysis: ${data.error ?? `HTTP ${res.status}`}` });
        setTimeout(() => setToast(null), 4000);
      }
    } catch (err) {
      setToast({ kind: 'error', text: `Failed to save analysis: ${err instanceof Error ? err.message : 'network error'}` });
      setTimeout(() => setToast(null), 4000);
    }
  }, [setToast]);

  const startAnalysis = useCallback(async (entry: TranscriptEntry) => {
    const key = videoIdFor(entry.url);
    const existing = analysesRef.current[key];
    if (existing && (existing.status === 'loading' || existing.status === 'streaming')) {
      return;
    }
    const abort = new AbortController();
    setAnalyses(prev => ({ ...prev, [key]: { status: 'loading', text: '', abort } }));

    try {
      const res = await fetch('/api/youtube/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: entry.url,
          transcript: entry.transcript || '',
          summary: entry.summary || '',
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        setAnalyses(prev => ({
          ...prev,
          [key]: { status: 'error', message: detail || `HTTP ${res.status}` },
        }));
        return;
      }

      const model = res.headers.get('x-analyse-model') || undefined;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setAnalyses(prev => ({
          ...prev,
          [key]: { status: 'streaming', text, abort, model },
        }));
      }

      const cachedAt = new Date().toISOString();
      setAnalyses(prev => ({ ...prev, [key]: { status: 'done', text, model, cachedAt } }));
      if (text.trim()) persistAnalysis(key, text, model);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        const final = analysesRef.current[key];
        const text = final && 'text' in final ? final.text : '';
        const model = final && 'model' in final ? final.model : undefined;
        const cachedAt = new Date().toISOString();
        setAnalyses(prev => ({ ...prev, [key]: { status: 'done', text, model, cachedAt } }));
        if (text.trim()) persistAnalysis(key, text, model);
        return;
      }
      setAnalyses(prev => ({
        ...prev,
        [key]: { status: 'error', message: err instanceof Error ? err.message : 'unknown error' },
      }));
    }
  }, [persistAnalysis]);

  const stopAnalysis = useCallback((entry: TranscriptEntry) => {
    const a = analysesRef.current[videoIdFor(entry.url)];
    if (a && (a.status === 'loading' || a.status === 'streaming')) {
      a.abort.abort();
    }
  }, []);

  const handleDelete = useCallback(async (entry: TranscriptEntry) => {
    if (!confirm(`Delete this video summary?\n\n${shortUrl(entry.url)}`)) return;
    try {
      await fetch('/api/transcripts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: entry.url, ts: entry.ts }),
      });
      setOpenKey(null);
      setTranscriptKey(null);
      await loadTranscripts();
    } catch {
      // silently ignore — list will refresh on next poll
    }
  }, [loadTranscripts]);

  return (
    <div
      className="rounded overflow-hidden"
      style={{ border: '1px solid var(--border)' }}
    >
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded text-xs font-bold tracking-[0.2em] uppercase shadow-lg"
          style={{
            background: toast.kind === 'success' ? '#00ff8811' : '#ff2d7811',
            border: `1px solid ${toast.kind === 'success' ? '#00ff8888' : '#ff2d7888'}`,
            color: toast.kind === 'success' ? '#00ff88' : '#ff2d78',
            boxShadow: `0 0 20px ${toast.kind === 'success' ? '#00ff8844' : '#ff2d7844'}`,
          }}
        >
          {toast.text}
        </div>
      )}
      {/* URL Input Form */}
      <form
        onSubmit={handleSubmit}
        className="px-4 py-3 flex gap-3 items-center"
        style={{
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Paste YouTube URL to summarize..."
          disabled={submitting}
          className="flex-1 px-3 py-2 text-sm rounded font-mono"
          style={{
            background: 'var(--bg-base)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={submitting || !urlInput.trim()}
          className="px-4 py-2 text-xs font-bold tracking-wider uppercase rounded transition-opacity"
          style={{
            background: submitting ? `${ACCENT_COLOR}55` : ACCENT_COLOR,
            color: '#000',
            opacity: submitting || !urlInput.trim() ? 0.5 : 1,
            cursor: submitting || !urlInput.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Summarizing...' : 'Summarize'}
        </button>
      </form>
      {submitError && (
        <div
          className="px-4 py-2 text-xs"
          style={{ background: '#ff2d7811', color: '#ff2d78', borderBottom: '1px solid var(--border)' }}
        >
          {submitError}
        </div>
      )}

      <div
        className="grid grid-cols-[108px_1fr_52px] sm:grid-cols-[260px_1fr_100px] gap-3 px-4 py-2.5 text-[13px] font-bold tracking-[0.2em] uppercase"
        style={{
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
          color: 'var(--text-dim)',
        }}
      >
        <span>VIDEO</span>
        <span>SUMMARY</span>
        <span className="text-right">TIME</span>
      </div>

      {items === null ? (
        <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-dim)' }}>
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-dim)' }}>
          No YouTube summaries yet. Paste a link above to generate one.
        </div>
      ) : (
        items.map((t, i) => {
          const open = openKey === t.url;
          const cacheKey = videoIdFor(t.url);
          const a = analyses[cacheKey];
          const busy = a?.status === 'loading' || a?.status === 'streaming';
          const cached = a?.status === 'done' && 'cachedAt' in a && a.cachedAt;
          return (
            <div
              key={`${t.ts}-${i}`}
              style={{
                borderBottom: i < items.length - 1 ? '1px solid #ffffff07' : 'none',
                background: i % 2 === 0 ? 'transparent' : '#ffffff03',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  if (open) {
                    setOpenKey(null);
                    setTranscriptKey(null);
                  } else {
                    setOpenKey(t.url);
                  }
                }}
                className="w-full grid grid-cols-[108px_1fr_52px] sm:grid-cols-[260px_1fr_100px] gap-3 px-4 py-2.5 items-center text-xs text-left cursor-pointer transition-colors"
                style={{
                  background: 'transparent',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = '#ffffff05';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                <a
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="font-mono truncate"
                  style={{ color: 'var(--cyan)' }}
                  title={t.title ?? t.url}
                >
                  {t.title ?? shortUrl(t.url)}
                </a>
                <span
                  className="truncate"
                  style={{ color: 'var(--text-muted)' }}
                  title={t.summary}
                >
                  {t.summary}
                </span>
                <span
                  className="font-mono tabular-nums text-right"
                  style={{ color: 'var(--text-dim)' }}
                >
                  {relativeTime(t.ts, now)}
                </span>
              </button>
              {open && (
                <div
                  className="px-4 pb-4 pt-1 text-xs"
                  style={{ background: '#ffffff04' }}
                >
                  <div
                    className="whitespace-pre-wrap leading-relaxed"
                    style={{ color: 'var(--text)' }}
                  >
                    {t.summary}
                  </div>

                  <div className="mt-3 flex gap-2 flex-wrap items-center">
                    <ListenButton text={t.summary} enabled={listenEnabled} />

                    {cached && !busy ? (
                      <>
                        <button
                          type="button"
                          onClick={() => startAnalysis(t)}
                          className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.2em] uppercase px-2.5 py-1.5 rounded cursor-pointer"
                          style={{
                            color: ACCENT_COLOR,
                            border: `1px solid ${ACCENT_COLOR}55`,
                            background: `${ACCENT_COLOR}11`,
                          }}
                        >
                          <RefreshCw size={11} strokeWidth={1.8} />
                          Refresh Analysis
                        </button>
                        <span
                          className="text-[10px] tracking-wider uppercase"
                          style={{ color: 'var(--text-dim)' }}
                        >
                          Analysed {shortDate(a.cachedAt as string)}
                        </span>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => (busy ? stopAnalysis(t) : startAnalysis(t))}
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.2em] uppercase px-2.5 py-1.5 rounded cursor-pointer"
                        style={{
                          color: ACCENT_COLOR,
                          border: `1px solid ${ACCENT_COLOR}55`,
                          background: `${ACCENT_COLOR}11`,
                        }}
                      >
                        {busy ? (
                          <>
                            <Square size={11} strokeWidth={2} />
                            Stop
                          </>
                        ) : (
                          <>
                            <Sparkles size={11} strokeWidth={1.8} />
                            Analyse for Me
                          </>
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDelete(t)}
                      className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.2em] uppercase px-2.5 py-1.5 rounded cursor-pointer"
                      style={{
                        color: '#ff2d78',
                        border: '1px solid #ff2d7855',
                        background: '#ff2d7811',
                      }}
                    >
                      <Trash2 size={11} strokeWidth={1.8} />
                      Delete
                    </button>

                    {t.transcript && t.transcript.trim() !== '' && (
                      transcriptKey === t.url ? (
                        <button
                          type="button"
                          onClick={() => setTranscriptKey(null)}
                          className="text-[11px] font-bold tracking-[0.2em] uppercase px-2 py-1 rounded"
                          style={{
                            color: 'var(--cyan)',
                            border: '1px solid #00f5ff55',
                            background: '#00f5ff11',
                          }}
                        >
                          ▾ Hide transcript
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setTranscriptKey(t.url)}
                          className="text-[11px] font-bold tracking-[0.2em] uppercase px-2 py-1 rounded"
                          style={{
                            color: 'var(--cyan)',
                            border: '1px solid #00f5ff55',
                            background: '#00f5ff11',
                          }}
                        >
                          ▸ View full transcript
                        </button>
                      )
                    )}
                  </div>

                  {a && a.status !== 'idle' && (
                    <div
                      className="mt-3 rounded p-3 text-[12px] leading-relaxed"
                      style={{
                        background: '#0a0e1aaa',
                        border: `1px solid ${ACCENT_COLOR}55`,
                        color: 'var(--text)',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Brain size={12} strokeWidth={2} style={{ color: ACCENT_COLOR }} />
                        <span
                          className="text-[10px] font-bold tracking-[0.2em] uppercase"
                          style={{ color: ACCENT_COLOR }}
                        >
                          {prettifyModel('model' in a ? a.model : undefined)}
                        </span>
                        {a.status === 'loading' && (
                          <span
                            className="text-[10px] tracking-wider uppercase"
                            style={{ color: 'var(--text-dim)' }}
                          >
                            warming up…
                          </span>
                        )}
                        {a.status === 'streaming' && (
                          <span
                            className="text-[10px] tracking-wider uppercase animate-pulse"
                            style={{ color: 'var(--text-dim)' }}
                          >
                            streaming…
                          </span>
                        )}
                      </div>

                      {a.status === 'error' ? (
                        <div style={{ color: 'var(--pink)' }}>Error: {a.message}</div>
                      ) : 'text' in a && a.text ? (
                        <MarkdownBlock content={a.text} />
                      ) : (
                        <div style={{ color: 'var(--text-dim)' }}>
                          Routing this transcript to the best available model…
                        </div>
                      )}
                    </div>
                  )}

                  {transcriptKey === t.url && t.transcript && (
                    <pre
                      className="mt-3 whitespace-pre-wrap leading-relaxed font-mono text-[11px] p-3 rounded overflow-y-auto"
                      style={{
                        color: 'var(--text-muted)',
                        background: '#00000033',
                        border: '1px solid var(--border)',
                        maxHeight: '24rem',
                      }}
                    >
                      {t.transcript}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

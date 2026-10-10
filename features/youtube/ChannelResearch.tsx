'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Play, RefreshCw, Trash2 } from 'lucide-react';
import MarkdownBlock from '@/components/MarkdownBlock';

const ACCENT_COLOR = '#c084fc'; // purple — distinct from the Summaries panel's gold

export interface ResearchRun {
  id: number;
  channel: string;
  date_from: string;
  date_to: string;
  status: string;
  created_at: string;
  synthesis_len?: number;
}

interface VideoSummary {
  id: number;
  video_id: string;
  title: string | null;
  upload_date: string | null;
  summary_md: string | null;
}

interface RunDetail extends ResearchRun {
  synthesis_md: string | null;
  videos: VideoSummary[];
}

function statusColor(status: string): string {
  switch (status) {
    case 'complete': return '#00ff88';
    case 'running':  return '#ffd700';
    case 'error':    return '#ff2d78';
    default:         return 'var(--text-dim)';
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' });
}

function formatUploadDate(raw: string | null): string {
  if (!raw) return '';
  // Accepts both YYYYMMDD and ISO 8601 (the official Data API returns ISO).
  if (raw.length === 8 && /^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw.slice(0, 10);
}

export interface RunRowProps {
  run: ResearchRun;
  onSelect: (id: number) => void;
  onDelete: (run: ResearchRun) => void;
  selected: boolean;
}

export function RunRow({ run, onSelect, onDelete, selected }: RunRowProps) {
  const isRunning = run.status === 'running';
  return (
    // A <div> with role="button", not a real <button> — the delete button
    // below has to live inside this row for layout/click-target reasons, and
    // a <button> can't contain another <button> (invalid HTML, breaks
    // hydration). Keyboard-operable via tabIndex + onKeyDown instead.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(run.id)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(run.id); } }}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-left transition-colors cursor-pointer"
      style={{
        background: selected ? `${ACCENT_COLOR}11` : 'transparent',
        borderLeft: selected ? `2px solid ${ACCENT_COLOR}` : '2px solid transparent',
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = '#ffffff05'; }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      {selected ? (
        <ChevronDown size={12} style={{ color: ACCENT_COLOR, flexShrink: 0 }} />
      ) : (
        <ChevronRight size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
      )}
      <span className="font-mono" style={{ color: ACCENT_COLOR }}>#{run.id}</span>
      <span className="flex-1 truncate font-bold" style={{ color: 'var(--text)' }}>{run.channel}</span>
      <span style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
        {run.date_from} → {run.date_to}
      </span>
      <span
        className="text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded ml-2"
        style={{
          color: statusColor(run.status),
          border: `1px solid ${statusColor(run.status)}55`,
          background: `${statusColor(run.status)}11`,
          whiteSpace: 'nowrap',
        }}
      >
        {run.status}
      </span>
      <span className="font-mono tabular-nums ml-2" style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
        {formatDate(run.created_at)}
      </span>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); if (!isRunning) onDelete(run); }}
        disabled={isRunning}
        title={isRunning ? 'Cannot delete a running run' : 'Delete run'}
        className="p-1 rounded ml-2 flex-shrink-0"
        style={{
          color: isRunning ? 'var(--text-dim)' : '#ff2d78',
          border: `1px solid ${isRunning ? 'var(--border)' : '#ff2d7855'}`,
          background: isRunning ? 'transparent' : '#ff2d7811',
          opacity: isRunning ? 0.4 : 1,
          cursor: isRunning ? 'not-allowed' : 'pointer',
        }}
      >
        <Trash2 size={11} strokeWidth={1.8} />
      </button>
    </div>
  );
}

interface VideoRowProps {
  video: VideoSummary;
  defaultOpen: boolean;
}

function VideoRow({ video, defaultOpen }: VideoRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const uploadDate = formatUploadDate(video.upload_date);

  return (
    <div style={{ borderBottom: '1px solid #ffffff07' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-2 text-xs text-left"
        style={{ background: 'transparent' }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#ffffff05'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
      >
        {open ? (
          <ChevronDown size={11} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        ) : (
          <ChevronRight size={11} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        )}
        <span className="font-mono tabular-nums" style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
          {uploadDate}
        </span>
        <a
          href={`https://www.youtube.com/watch?v=${video.video_id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex-1 truncate font-mono"
          style={{ color: 'var(--cyan)' }}
          title={video.title ?? video.video_id}
        >
          {video.title ?? video.video_id}
        </a>
        {!video.summary_md && (
          <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>no summary</span>
        )}
      </button>
      {open && video.summary_md && (
        <div
          className="px-6 pb-3 pt-1 text-xs"
          style={{ background: '#ffffff03' }}
        >
          <MarkdownBlock content={video.summary_md} />
        </div>
      )}
    </div>
  );
}

export interface RunDetailViewProps {
  runId: number;
  onBack: () => void;
}

type AskStatus = 'idle' | 'loading' | 'streaming' | 'error';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function RunDetailView({ runId, onBack }: RunDetailViewProps) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showVideos, setShowVideos] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [thread, setThread] = useState<ChatMessage[] | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [askStatus, setAskStatus] = useState<AskStatus>('idle');
  const [streamingText, setStreamingText] = useState('');
  const [askError, setAskError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/youtube/channel-research/${runId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDetail({ ...data.run, videos: data.videos });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  const handleAsk = useCallback(async () => {
    const q = question.trim();
    if (!q || askStatus === 'loading' || askStatus === 'streaming') return;

    const abort = new AbortController();
    setAskStatus('loading');
    setAskError(null);
    setStreamingText('');
    setQuestion('');
    setThread(prev => [...(prev ?? []), { role: 'user', content: q }]);

    try {
      const res = await fetch(`/api/youtube/channel-research/${runId}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      setAskStatus('streaming');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setStreamingText(text);
      }

      setThread(prev => [...(prev ?? []), { role: 'assistant', content: text }]);
      setStreamingText('');
      setAskStatus('idle');
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setAskError(e instanceof Error ? e.message : 'Failed to get an answer');
      setAskStatus('error');
    }
  }, [question, runId, askStatus]);

  useEffect(() => {
    if (!askOpen || thread !== null) return;
    (async () => {
      try {
        const res = await fetch(`/api/youtube/channel-research/${runId}/ask`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const rows: ChatMessage[] = Array.isArray(data?.messages)
          ? data.messages.map((m: { role: string; content: string }) => ({
              role: m.role === 'assistant' ? 'assistant' : 'user',
              content: m.content,
            }))
          : [];
        setThread(rows);
      } catch (e) {
        setThreadError(e instanceof Error ? e.message : 'Failed to load conversation');
        setThread([]);
      }
    })();
  }, [askOpen, thread, runId]);

  useEffect(() => {
    // Standard fetch-on-mount: load() sets loading/error/detail state itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // Poll while running
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = () => {
      if (detail?.status === 'running') {
        timer = setInterval(load, 10_000);
      }
    };
    poll();
    return () => { if (timer) clearInterval(timer); };
  }, [load, detail?.status]);

  if (loading && !detail) {
    return (
      <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-dim)' }}>
        Loading run #{runId}…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-4 text-xs" style={{ color: '#ff2d78' }}>
        Error: {error}
        <button onClick={onBack} className="ml-4 underline" style={{ color: 'var(--cyan)' }}>← Back</button>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div>
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center gap-3 flex-wrap"
        style={{ background: `${ACCENT_COLOR}08`, borderBottom: '1px solid var(--border)' }}
      >
        <button
          onClick={onBack}
          className="text-xs font-bold tracking-wider uppercase"
          style={{ color: 'var(--text-dim)' }}
        >
          ← Runs
        </button>
        <span style={{ color: 'var(--border)' }}>|</span>
        <span className="font-mono text-xs" style={{ color: ACCENT_COLOR }}>#{detail.id}</span>
        <span className="font-bold text-sm flex-1 truncate" style={{ color: 'var(--text)' }}>{detail.channel}</span>
        <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{detail.date_from} → {detail.date_to}</span>
        <span
          className="text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded"
          style={{
            color: statusColor(detail.status),
            border: `1px solid ${statusColor(detail.status)}55`,
            background: `${statusColor(detail.status)}11`,
          }}
        >
          {detail.status}
        </span>
        <button
          onClick={load}
          className="p-1 rounded"
          style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
          title="Refresh"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Synthesis */}
      {detail.synthesis_md ? (
        <div
          className="px-4 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div
            className="text-[10px] font-bold tracking-[0.25em] uppercase mb-3"
            style={{ color: ACCENT_COLOR }}
          >
            Synthesis Report
          </div>
          <MarkdownBlock content={detail.synthesis_md} />
        </div>
      ) : detail.status === 'running' ? (
        <div className="px-4 py-6 text-center text-xs animate-pulse" style={{ color: 'var(--text-dim)' }}>
          Pipeline running — synthesis will appear when complete…
        </div>
      ) : detail.status === 'error' ? (
        <div className="px-4 py-4 text-xs" style={{ color: '#ff2d78' }}>
          Run failed{detail.synthesis_md === null ? '' : `: ${detail.synthesis_md}`}
        </div>
      ) : null}

      {/* Video summaries */}
      {detail.videos.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowVideos(v => !v)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold tracking-wider uppercase"
            style={{
              background: 'var(--bg-panel)',
              borderTop: '1px solid var(--border)',
              color: 'var(--text-dim)',
            }}
          >
            {showVideos ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {detail.videos.length} Video Summaries
          </button>
          {showVideos && (
            <div>
              {detail.videos.map(v => (
                <VideoRow key={v.id} video={v} defaultOpen={false} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ask a question */}
      {detail.status === 'complete' && (
        <div>
          <button
            type="button"
            onClick={() => setAskOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold tracking-wider uppercase"
            style={{
              background: 'var(--bg-panel)',
              borderTop: '1px solid var(--border)',
              color: 'var(--text-dim)',
            }}
          >
            {askOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Ask a Question
          </button>
          {askOpen && (
            <div className="px-4 py-3" style={{ borderTop: '1px solid #ffffff07' }}>
              {/* Thread */}
              <div
                className="flex flex-col gap-3 mb-3"
                style={{ maxHeight: '420px', overflowY: 'auto' }}
              >
                {thread === null ? (
                  <div className="text-xs" style={{ color: 'var(--text-dim)' }}>Loading conversation…</div>
                ) : threadError ? (
                  <div className="text-xs" style={{ color: '#ff2d78' }}>{threadError}</div>
                ) : thread.length === 0 && askStatus === 'idle' ? (
                  <div className="text-xs" style={{ color: 'var(--text-dim)' }}>
                    No questions asked yet — ask something below.
                  </div>
                ) : (
                  thread.map((m, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      <div
                        className="px-3 py-2 rounded text-xs"
                        style={{
                          maxWidth: '85%',
                          background: m.role === 'user' ? `${ACCENT_COLOR}18` : 'var(--bg-base)',
                          border: `1px solid ${m.role === 'user' ? `${ACCENT_COLOR}55` : 'var(--border)'}`,
                          color: 'var(--text)',
                        }}
                      >
                        {m.role === 'assistant' ? (
                          <MarkdownBlock content={m.content} />
                        ) : (
                          <span className="whitespace-pre-wrap">{m.content}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
                {askStatus === 'streaming' && streamingText && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <div
                      className="px-3 py-2 rounded text-xs"
                      style={{ maxWidth: '85%', background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text)' }}
                    >
                      <MarkdownBlock content={streamingText} />
                    </div>
                  </div>
                )}
                {askStatus === 'loading' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <div
                      className="px-3 py-2 rounded text-xs animate-pulse"
                      style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}
                    >
                      Reading {detail.videos.length} transcripts…
                    </div>
                  </div>
                )}
              </div>

              {askError && (
                <div className="text-xs mb-2" style={{ color: '#ff2d78' }}>{askError}</div>
              )}

              {/* Composer */}
              <div className="flex gap-2 items-start flex-wrap">
                <textarea
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleAsk();
                    }
                  }}
                  disabled={askStatus === 'loading' || askStatus === 'streaming'}
                  placeholder={thread && thread.length > 0 ? 'Ask a follow-up…' : 'e.g. Does the evidence support the claim made in the synthesis, or contradict it?'}
                  rows={2}
                  className="flex-1 px-3 py-1.5 text-xs rounded font-mono"
                  style={{
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    outline: 'none',
                    minWidth: '260px',
                    resize: 'vertical',
                  }}
                />
                <button
                  type="button"
                  onClick={handleAsk}
                  disabled={!question.trim() || askStatus === 'loading' || askStatus === 'streaming'}
                  className="px-4 py-1.5 text-xs font-bold tracking-wider uppercase rounded flex items-center gap-1.5"
                  style={{
                    background: `${ACCENT_COLOR}22`,
                    border: `1px solid ${ACCENT_COLOR}`,
                    color: ACCENT_COLOR,
                    cursor: (!question.trim() || askStatus === 'loading' || askStatus === 'streaming') ? 'not-allowed' : 'pointer',
                    opacity: (askStatus === 'loading' || askStatus === 'streaming') ? 0.6 : 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {askStatus === 'loading' ? 'Asking…' : askStatus === 'streaming' ? 'Answering…' : 'Ask'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface DateFieldProps {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  disabled: boolean;
}

function DateField({ label, value, onChange, disabled }: DateFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] tracking-widest uppercase" style={{ color: 'var(--text-dim)' }}>{label}</label>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
        className="px-3 py-1.5 text-sm rounded font-mono"
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          outline: 'none',
          width: '150px',
          colorScheme: 'dark',
        }}
      />
    </div>
  );
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthsAgoISO(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return isoDate(d);
}

interface TriggerFormProps {
  onStarted: () => void;
}

function TriggerForm({ onStarted }: TriggerFormProps) {
  const [channel, setChannel] = useState('@example-channel');
  const [after, setAfter] = useState(() => monthsAgoISO(3));
  const [before, setBefore] = useState(() => isoDate(new Date()));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/youtube/channel-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: channel.trim(), after: after.trim(), before: before.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setLaunched(true);
      setTimeout(() => { setLaunched(false); onStarted(); }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="px-4 py-3 flex gap-2 flex-wrap items-end"
      style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}
    >
      <div className="flex flex-col gap-1">
        <label className="text-[10px] tracking-widest uppercase" style={{ color: 'var(--text-dim)' }}>Channel</label>
        <input
          value={channel}
          onChange={e => setChannel(e.target.value)}
          disabled={submitting}
          placeholder="@handle or URL"
          className="px-3 py-1.5 text-sm rounded font-mono"
          style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none', width: '180px' }}
        />
      </div>
      <DateField label="From" value={after} onChange={setAfter} disabled={submitting} />
      <DateField label="To" value={before} onChange={setBefore} disabled={submitting} />
      <button
        type="submit"
        disabled={submitting || launched || !channel.trim()}
        className="px-4 py-1.5 text-xs font-bold tracking-wider uppercase rounded flex items-center gap-1.5"
        style={{
          background: launched ? '#00ff8822' : `${ACCENT_COLOR}22`,
          border: `1px solid ${launched ? '#00ff8888' : ACCENT_COLOR}`,
          color: launched ? '#00ff88' : ACCENT_COLOR,
          cursor: submitting || launched ? 'not-allowed' : 'pointer',
          opacity: submitting ? 0.6 : 1,
        }}
      >
        <Play size={11} strokeWidth={2} />
        {launched ? 'Launched ✓' : submitting ? 'Starting…' : 'Run Research'}
      </button>
      {error && (
        <span className="text-xs" style={{ color: '#ff2d78' }}>{error}</span>
      )}
    </form>
  );
}

export default function ChannelResearch() {
  const [runs, setRuns] = useState<ResearchRun[] | null>(null);
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/youtube/channel-research', { cache: 'no-store' });
      const data = await res.json();
      setRuns(Array.isArray(data?.runs) ? data.runs : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load runs');
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    // Standard fetch-on-mount: loadRuns() sets its own state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRuns();
    const t = setInterval(loadRuns, 15_000);
    return () => clearInterval(t);
  }, [loadRuns]);

  const handleDelete = useCallback(async (run: ResearchRun) => {
    if (!confirm(`Delete channel research run #${run.id} (${run.channel})?`)) return;
    try {
      const res = await fetch(`/api/youtube/channel-research/${run.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setRuns(prev => (prev ? prev.filter(r => r.id !== run.id) : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete run');
    }
  }, []);

  if (selectedRun !== null) {
    return (
      <div className="rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <RunDetailView runId={selectedRun} onBack={() => setSelectedRun(null)} />
      </div>
    );
  }

  return (
    <div className="rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      <TriggerForm onStarted={() => { loadRuns(); }} />

      {/* Column headers */}
      <div
        className="grid px-4 py-2 text-[11px] font-bold tracking-[0.2em] uppercase"
        style={{
          gridTemplateColumns: '36px 160px 1fr 200px 80px 90px 32px',
          gap: '10px',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
          color: 'var(--text-dim)',
        }}
      >
        <span></span>
        <span>Channel</span>
        <span></span>
        <span>Date Range</span>
        <span>Status</span>
        <span>Created</span>
        <span></span>
      </div>

      {runs === null ? (
        <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-dim)' }}>Loading…</div>
      ) : error ? (
        <div className="px-4 py-4 text-xs" style={{ color: '#ff2d78' }}>{error}</div>
      ) : runs.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-dim)' }}>
          No channel research runs yet. Use the form above to start one.
        </div>
      ) : (
        runs.map(run => (
          <RunRow
            key={run.id}
            run={run}
            onSelect={setSelectedRun}
            onDelete={handleDelete}
            selected={false}
          />
        ))
      )}
    </div>
  );
}

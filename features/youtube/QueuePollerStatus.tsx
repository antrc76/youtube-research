'use client';

import { useEffect, useState } from 'react';

/**
 * Status area for the save-to-playlist queue poller: what it's actually
 * doing (items waiting, when it last checked, when it checks next) plus the
 * Done/Failed counts and the "Connect YouTube" button when auth isn't set
 * up yet. Renders nothing at all if the poller isn't configured
 * (YOUTUBE_QUEUE_PLAYLIST_ID unset) — this feature is optional and off by
 * default.
 */

const ACCENT_COLOR = '#ffd700';

interface FailedItem {
  video_id: string;
  title: string | null;
  attempts: number;
  last_error: string | null;
}

interface LastRun {
  ranAt: string;
  found: number;
  waiting: number;
}

interface StatusResponse {
  playlistConfigured: boolean;
  authConfigured: boolean;
  counts: { pending: number; processing: number; done: number; failed: number };
  failed: FailedItem[];
  lastRun: LastRun | null;
  nextPollDueAt: string | null;
}

function useAuthBanner(): { kind: 'success' | 'error'; text: string } | null {
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('youtube_auth');
    // One-time read of a query param set by the OAuth callback redirect, not
    // a response to changing props/state — there's no way to do this outside
    // an effect, since it depends on window.location.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (result === 'success') {
      setBanner({ kind: 'success', text: 'YouTube connected ✓' });
    } else if (result === 'error') {
      setBanner({ kind: 'error', text: 'Failed to connect YouTube — check server logs' });
    } else {
      return;
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    params.delete('youtube_auth');
    const next = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (next ? `?${next}` : ''));
    const t = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(t);
  }, []);

  return banner;
}

/** Coarse "Xs"/"Xm"/"Xh" duration — good enough at a 30s-refresh granularity. */
function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

function formatAgo(iso: string): string {
  return `${formatDuration(Date.now() - new Date(iso).getTime())} ago`;
}

function formatDue(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  return ms <= 0 ? 'any moment' : `in ${formatDuration(ms)}`;
}

export default function QueuePollerStatus() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const banner = useAuthBanner();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/youtube/queue/status', { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled) setStatus(data);
      } catch {
        // status area just stays hidden/stale — not worth surfacing an error for this
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  async function handleCheckNow() {
    setChecking(true);
    setCheckMessage(null);
    try {
      const res = await fetch('/api/youtube/queue/check', { method: 'POST' });
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        const secs = Math.ceil((data.retryAfterMs ?? 30_000) / 1000);
        setCheckMessage(`Already checked recently — try again in ${secs}s`);
      } else if (!res.ok) {
        setCheckMessage('Check failed — see server logs');
      } else {
        const res2 = await fetch('/api/youtube/queue/status', { cache: 'no-store' });
        setStatus(await res2.json());
      }
    } catch {
      setCheckMessage('Check failed — see server logs');
    } finally {
      setChecking(false);
      setTimeout(() => setCheckMessage(null), 5000);
    }
  }

  if (!status || !status.playlistConfigured) return null;

  const { counts, failed, authConfigured, lastRun, nextPollDueAt } = status;

  return (
    <div
      className="px-4 py-2.5 flex flex-wrap items-center gap-4 text-xs"
      style={{
        background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border)',
        color: 'var(--text-muted)',
      }}
    >
      <span
        className="text-[11px] font-bold tracking-[0.2em] uppercase"
        style={{ color: ACCENT_COLOR }}
      >
        Save-to-Playlist Queue
      </span>

      {!authConfigured ? (
        <a
          href="/api/youtube/queue/auth"
          className="text-[11px] font-bold tracking-[0.2em] uppercase px-2.5 py-1 rounded"
          style={{ color: ACCENT_COLOR, border: `1px solid ${ACCENT_COLOR}55`, background: `${ACCENT_COLOR}11` }}
        >
          Connect YouTube
        </a>
      ) : (
        <>
          <span>Waiting: <strong style={{ color: 'var(--text)' }}>{lastRun ? lastRun.waiting : '—'}</strong></span>
          <span>Last checked: <strong style={{ color: 'var(--text)' }}>{lastRun ? formatAgo(lastRun.ranAt) : 'never'}</strong></span>
          <span>Next check: <strong style={{ color: 'var(--text)' }}>{nextPollDueAt ? formatDue(nextPollDueAt) : '—'}</strong></span>
          <span>Done: <strong style={{ color: 'var(--text)' }}>{counts.done}</strong></span>
          {counts.failed > 0 && (
            <span style={{ color: '#ff2d78' }}>
              Failed: <strong>{counts.failed}</strong>
              {failed[0]?.last_error && (
                <span className="ml-1" style={{ color: 'var(--text-dim)' }} title={failed[0].last_error}>
                  ({failed[0].title ?? failed[0].video_id}: {failed[0].last_error.slice(0, 60)})
                </span>
              )}
            </span>
          )}

          <button
            type="button"
            onClick={handleCheckNow}
            disabled={checking}
            className="text-[11px] font-bold tracking-[0.2em] uppercase px-2.5 py-1 rounded"
            style={{
              color: ACCENT_COLOR,
              border: `1px solid ${ACCENT_COLOR}55`,
              background: checking ? `${ACCENT_COLOR}22` : `${ACCENT_COLOR}11`,
              opacity: checking ? 0.7 : 1,
              cursor: checking ? 'default' : 'pointer',
            }}
          >
            {checking ? 'Checking…' : 'Check now'}
          </button>
          {checkMessage && <span style={{ color: 'var(--text-dim)' }}>{checkMessage}</span>}
        </>
      )}

      {banner && (
        <span
          className="text-[11px] font-bold tracking-wider uppercase px-2 py-1 rounded"
          style={{
            color: banner.kind === 'success' ? '#00ff88' : '#ff2d78',
            background: banner.kind === 'success' ? '#00ff8811' : '#ff2d7811',
            border: `1px solid ${banner.kind === 'success' ? '#00ff8888' : '#ff2d7888'}`,
          }}
        >
          {banner.text}
        </span>
      )}
    </div>
  );
}

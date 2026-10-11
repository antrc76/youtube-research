'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Square, Volume2 } from 'lucide-react';

type ListenState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'playing'; truncated: boolean }
  | { status: 'error'; message: string };

interface Props {
  /** Raw markdown/plain text to read aloud — markdown is stripped server-side. */
  text: string;
  /** Whether ElevenLabs is configured (ELEVENLABS_API_KEY set) and not in demo mode. Renders nothing when false. */
  enabled: boolean;
}

export default function ListenButton({ text, enabled }: Props) {
  const [state, setState] = useState<ListenState>({ status: 'idle' });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const stop = useCallback(() => {
    cleanup();
    setState({ status: 'idle' });
  }, [cleanup]);

  const play = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setState({ status: 'error', message: data.error || `HTTP ${res.status}` });
        return;
      }

      const truncated = res.headers.get('x-tts-truncated') === 'true';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      cleanup();

      const audio = new Audio(url);
      audioRef.current = audio;
      urlRef.current = url;
      audio.onended = () => setState({ status: 'idle' });
      audio.onerror = () => setState({ status: 'error', message: 'Playback failed.' });

      await audio.play();
      setState({ status: 'playing', truncated });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'network error' });
    }
  }, [text, cleanup]);

  if (!enabled) return null;

  const busy = state.status === 'loading' || state.status === 'playing';

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (busy) stop(); else play(); }}
        className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.2em] uppercase px-2.5 py-1.5 rounded cursor-pointer"
        style={{ color: 'var(--cyan)', border: '1px solid #00f5ff55', background: '#00f5ff11' }}
      >
        {state.status === 'loading' ? (
          <>
            <Loader2 size={11} strokeWidth={2} className="animate-spin" />
            Loading…
          </>
        ) : state.status === 'playing' ? (
          <>
            <Square size={11} strokeWidth={2} />
            Stop
          </>
        ) : (
          <>
            <Volume2 size={11} strokeWidth={1.8} />
            Listen
          </>
        )}
      </button>
      {state.status === 'playing' && state.truncated && (
        <span className="text-[10px] tracking-wider uppercase" style={{ color: 'var(--text-dim)' }}>
          Reading first ~2000 characters
        </span>
      )}
      {state.status === 'error' && (
        <span className="text-[11px]" style={{ color: 'var(--pink)' }}>
          {state.message}
        </span>
      )}
    </div>
  );
}

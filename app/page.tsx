import YouTubeTranscripts from '@/features/youtube/YouTubeTranscripts';
import ChannelResearch from '@/features/youtube/ChannelResearch';
import QueuePollerStatus from '@/features/youtube/QueuePollerStatus';

export const dynamic = 'force-dynamic';

export default function Home() {
  const demoMode = process.env.DEMO_MODE === 'true';

  return (
    <div className="min-h-full py-8 px-4 sm:px-8 space-y-6 max-w-5xl mx-auto w-full">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>
          YouTube Research
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
          Summarise a video, run a multi-video channel research pass with a follow-up chat, or
          personalise the take with an optional profile.
        </p>
        {demoMode && (
          <p
            className="inline-block text-xs font-bold tracking-wider uppercase px-2.5 py-1 rounded mt-2"
            style={{ color: 'var(--gold)', border: '1px solid #ffd70055', background: '#ffd70011' }}
          >
            Demo mode — showing sample data. Add API keys in .env to analyse your own videos.
          </p>
        )}
      </header>

      <QueuePollerStatus />

      <section className="space-y-3">
        <h2 className="text-sm font-bold tracking-widest uppercase" style={{ color: 'var(--gold)' }}>
          YouTube Summaries
        </h2>
        <YouTubeTranscripts />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold tracking-widest uppercase" style={{ color: '#c084fc' }}>
          Channel Research
        </h2>
        <ChannelResearch />
      </section>
    </div>
  );
}

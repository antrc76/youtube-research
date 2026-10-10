/**
 * Next.js server-start hook. Used to:
 *  - create DATA_DIR if it doesn't exist yet, before anything below (or any
 *    API route, which all go through the same db.ts/queue-db.ts/
 *    analysis-cache.ts modules) tries to open a file inside it
 *  - seed demo data once, if DEMO_MODE=true (see features/youtube/demo-seed.ts)
 *  - start the in-process YouTube save-to-playlist queue poller, if it's
 *    configured (features/youtube/queue-poller.ts) — no separate
 *    script/cron/container, and it's a no-op if the OAuth env vars/files
 *    aren't present.
 * Runs once per server start; a no-op import in the edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { mkdirSync } = await import('fs');
    const path = await import('path');
    const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
    mkdirSync(dataDir, { recursive: true });

    if (process.env.DEMO_MODE === 'true') {
      const { seedDemoData, seedDemoAnalysisCache } = await import('@/features/youtube/demo-seed');
      seedDemoData();
      await seedDemoAnalysisCache();
    }

    const { startYoutubeQueuePoller } = await import('@/features/youtube/queue-poller');
    startYoutubeQueuePoller();
  }
}

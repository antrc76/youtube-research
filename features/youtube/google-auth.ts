import { readFileSync, writeFileSync, existsSync } from 'fs';

/**
 * Minimal Google OAuth (authorization-code flow) for the save-to-playlist
 * queue poller. Deliberately dependency-free — no googleapis/google-auth-library
 * package — token exchange/refresh is done with plain fetch() against
 * Google's OAuth endpoints, the same way the rest of this app calls the
 * YouTube Data API directly.
 *
 * Never logs token contents.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

/** playlistItems.delete requires the full (non-readonly) scope. */
export const YOUTUBE_QUEUE_SCOPE = 'https://www.googleapis.com/auth/youtube';

interface ClientConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

interface StoredTokens {
  refresh_token: string;
  access_token?: string;
  /** ms epoch */
  expiry_date?: number;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/**
 * Reads a Google OAuth client secret JSON (Desktop app or Web app type,
 * downloaded from Google Cloud Console — has an "installed" or "web" key).
 */
export function loadClientConfig(): ClientConfig {
  const clientPath = requireEnv('YOUTUBE_OAUTH_CLIENT_PATH');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(clientPath, 'utf8'));
  } catch (err) {
    throw new Error(`could not read/parse YOUTUBE_OAUTH_CLIENT_PATH (${clientPath}): ${err instanceof Error ? err.message : err}`);
  }
  const section = (raw as Record<string, unknown>)?.installed ?? (raw as Record<string, unknown>)?.web;
  const s = section as Record<string, unknown> | undefined;
  if (!s || typeof s.client_id !== 'string' || typeof s.client_secret !== 'string') {
    throw new Error(`${clientPath} does not look like a Google OAuth client secret file (expected an "installed" or "web" section)`);
  }
  const redirectUri = Array.isArray(s.redirect_uris) ? s.redirect_uris[0] : undefined;
  if (typeof redirectUri !== 'string' || !redirectUri) {
    throw new Error(`${clientPath} has no redirect_uris — add one matching this app's /api/youtube/queue/auth/callback URL in Google Cloud Console`);
  }
  return { client_id: s.client_id, client_secret: s.client_secret, redirect_uri: redirectUri };
}

/**
 * Origin to build redirects from — req.url's host is whatever the Node
 * process is bound to (0.0.0.0 inside a container), not a browser-reachable
 * address. The OAuth client's own redirect_uri is the app's known-good
 * public origin; x-forwarded-* headers (set by a reverse proxy) are the
 * fallback when that config isn't available.
 */
export function resolveAppOrigin(req: Request): string {
  try {
    const { redirect_uri } = loadClientConfig();
    return new URL(redirect_uri).origin;
  } catch {
    // client config unavailable/invalid — fall through to request headers
  }
  const host = req.headers.get('x-forwarded-host');
  if (host) {
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

function tokenPath(): string {
  return requireEnv('YOUTUBE_OAUTH_TOKEN_PATH');
}

function readTokens(): StoredTokens | null {
  const p = tokenPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as StoredTokens;
  } catch {
    return null;
  }
}

function writeTokens(tokens: StoredTokens): void {
  const p = tokenPath();
  writeFileSync(p, JSON.stringify(tokens, null, 2), { encoding: 'utf8', mode: 0o600 });
}

/** Used at startup to decide whether the poller has everything it needs. */
export function isYoutubeOAuthConfigured(): boolean {
  return !!(process.env.YOUTUBE_OAUTH_CLIENT_PATH && process.env.YOUTUBE_OAUTH_TOKEN_PATH && existsSync(process.env.YOUTUBE_OAUTH_CLIENT_PATH));
}

export function isYoutubeAuthConfigured(): boolean {
  try {
    return readTokens()?.refresh_token != null;
  } catch {
    return false;
  }
}

export function buildAuthUrl(state: string): string {
  const { client_id, redirect_uri } = loadClientConfig();
  const params = new URLSearchParams({
    client_id,
    redirect_uri,
    response_type: 'code',
    scope: YOUTUBE_QUEUE_SCOPE,
    access_type: 'offline',
    // Forces Google to always hand back a refresh_token, even on a repeat
    // consent by the same account — without this a second "Connect YouTube"
    // click can silently omit it.
    prompt: 'consent',
    state,
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

export async function exchangeCodeForTokens(code: string): Promise<void> {
  const { client_id, client_secret, redirect_uri } = loadClientConfig();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id,
      client_secret,
      redirect_uri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error_description || data?.error || `token exchange failed: ${res.status}`);
  }
  if (!data.refresh_token) {
    throw new Error('Google did not return a refresh token — revoke this app\'s access at https://myaccount.google.com/permissions and try Connect YouTube again');
  }
  writeTokens({
    refresh_token: data.refresh_token,
    access_token: data.access_token,
    expiry_date: Date.now() + (Number(data.expires_in) || 0) * 1000,
  });
}

const REFRESH_BUFFER_MS = 60_000;

/** Returns a usable access token, refreshing it first if it's missing or close to expiry. */
export async function getValidAccessToken(): Promise<string> {
  const tokens = readTokens();
  if (!tokens?.refresh_token) {
    throw new Error('YouTube not connected — use the "Connect YouTube" button');
  }
  if (tokens.access_token && tokens.expiry_date && tokens.expiry_date - REFRESH_BUFFER_MS > Date.now()) {
    return tokens.access_token;
  }

  const { client_id, client_secret } = loadClientConfig();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: tokens.refresh_token,
      client_id,
      client_secret,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data?.error === 'invalid_grant'
        ? 'YouTube refresh token is no longer valid — reconnect via "Connect YouTube"'
        : (data?.error_description || data?.error || `token refresh failed: ${res.status}`)
    );
  }
  const accessToken: string = data.access_token;
  writeTokens({
    refresh_token: tokens.refresh_token,
    access_token: accessToken,
    expiry_date: Date.now() + (Number(data.expires_in) || 0) * 1000,
  });
  return accessToken;
}

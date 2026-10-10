/**
 * Thin wrapper around the official YouTube Data API v3 — used by the
 * Channel Research pipeline to resolve a channel and list its uploads in a
 * date range. Deliberately the only way this app talks to YouTube for
 * channel/video listing: no scraping, no yt-dlp, no headless browser.
 */

const API_BASE = 'https://www.googleapis.com/youtube/v3';

export interface ChannelInfo {
  channelId: string;
  title: string;
  uploadsPlaylistId: string;
}

export interface VideoStub {
  videoId: string;
  title: string;
  /** ISO 8601 */
  publishedAt: string;
}

function requireApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is not configured');
  return key;
}

interface YouTubeApiError {
  error?: { message?: string };
}

async function getJson<T>(url: string): Promise<T & YouTubeApiError> {
  const res = await fetch(url);
  const data = (await res.json().catch(() => ({}))) as T & YouTubeApiError;
  if (!res.ok) {
    throw new Error(data?.error?.message || `YouTube Data API error: ${res.status}`);
  }
  return data;
}

interface ChannelListResponse {
  items?: Array<{
    id: string;
    snippet?: { title?: string };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
}

interface SearchListResponse {
  items?: Array<{ id?: { channelId?: string } }>;
}

interface PlaylistItemsResponse {
  items?: Array<{ snippet?: { resourceId?: { videoId?: string }; title?: string; publishedAt?: string } }>;
  nextPageToken?: string;
}

function extractHandleOrId(input: string): { kind: 'handle' | 'id' | 'raw'; value: string } {
  const trimmed = input.trim();

  // Full URL forms: /@handle, /channel/UC..., /c/Name, /user/Name
  const urlMatch = trimmed.match(/youtube\.com\/(@[\w.-]+|channel\/(UC[\w-]{22})|c\/[\w.-]+|user\/[\w.-]+)/i);
  if (urlMatch) {
    const seg = urlMatch[1];
    if (seg.startsWith('@')) return { kind: 'handle', value: seg };
    if (seg.startsWith('channel/')) return { kind: 'id', value: seg.slice('channel/'.length) };
    return { kind: 'raw', value: seg.replace(/^(c|user)\//, '') };
  }

  if (trimmed.startsWith('@')) return { kind: 'handle', value: trimmed };
  if (/^UC[\w-]{22}$/.test(trimmed)) return { kind: 'id', value: trimmed };
  return { kind: 'raw', value: trimmed };
}

/** Resolves a channel URL/@handle/bare name to its ID, title, and uploads playlist ID. */
export async function resolveChannel(channelInput: string): Promise<ChannelInfo> {
  const apiKey = requireApiKey();
  const parsed = extractHandleOrId(channelInput);

  let data: ChannelListResponse;
  if (parsed.kind === 'id') {
    data = await getJson<ChannelListResponse>(`${API_BASE}/channels?part=snippet,contentDetails&id=${encodeURIComponent(parsed.value)}&key=${apiKey}`);
  } else if (parsed.kind === 'handle') {
    data = await getJson<ChannelListResponse>(`${API_BASE}/channels?part=snippet,contentDetails&forHandle=${encodeURIComponent(parsed.value)}&key=${apiKey}`);
  } else {
    // Bare name with no @ or known URL shape — fall back to search.list,
    // which costs more quota but handles legacy /c/ and /user/ vanity names
    // the Data API has no direct lookup for.
    const search = await getJson<SearchListResponse>(
      `${API_BASE}/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(parsed.value)}&key=${apiKey}`
    );
    const channelId = search?.items?.[0]?.id?.channelId;
    if (!channelId) throw new Error(`Could not resolve channel "${channelInput}"`);
    data = await getJson<ChannelListResponse>(`${API_BASE}/channels?part=snippet,contentDetails&id=${encodeURIComponent(channelId)}&key=${apiKey}`);
  }

  const item = data?.items?.[0];
  if (!item) throw new Error(`Could not resolve channel "${channelInput}" — check the handle/URL`);

  const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) throw new Error(`Channel "${channelInput}" has no uploads playlist`);

  return {
    channelId: item.id,
    title: item.snippet?.title ?? channelInput,
    uploadsPlaylistId,
  };
}

/**
 * Lists videos from a channel's uploads playlist published within
 * [after, before] (inclusive, UTC dates). The uploads playlist returns
 * items newest-first, so paging stops as soon as an item is older than
 * `after` rather than walking the whole channel history.
 */
export async function listUploadsInRange(
  uploadsPlaylistId: string,
  after: Date,
  before: Date,
  maxVideos: number
): Promise<VideoStub[]> {
  const apiKey = requireApiKey();
  const videos: VideoStub[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      part: 'snippet',
      playlistId: uploadsPlaylistId,
      maxResults: '50',
      key: apiKey,
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await getJson<PlaylistItemsResponse>(`${API_BASE}/playlistItems?${params}`);
    const items = data.items ?? [];

    let sawOlderThanRange = false;
    for (const item of items) {
      const videoId = item.snippet?.resourceId?.videoId;
      const publishedAt = item.snippet?.publishedAt;
      if (!videoId || !publishedAt) continue;
      const published = new Date(publishedAt);

      if (published > before) continue; // newer than the range, keep scanning
      if (published < after) {
        sawOlderThanRange = true;
        continue;
      }
      videos.push({ videoId, title: item.snippet?.title ?? videoId, publishedAt });
      if (videos.length >= maxVideos) break;
    }

    if (sawOlderThanRange || videos.length >= maxVideos) break;
    pageToken = data.nextPageToken;
  } while (pageToken);

  // Oldest first, for a chronological research narrative.
  videos.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  return videos;
}

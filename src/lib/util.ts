import { router } from 'expo-router';
import { useLocalStore } from './store';
import { resolveArchivePlayback, type VodItem } from './archive';
import { resolveMsStream } from './media-server';
import { resolvePlutoStream } from './pluto';

export function favKey(id: string) {
  return `fav:${id}`;
}

/** safe back: falls back to home when there is no screen to go back to */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export function sourceLabel(source: string): string {
  if (source.startsWith('user:')) {
    const key = source.slice(5);
    const pl = useLocalStore.getState().playlists.find(p => String(p.id) === key || p.name === key);
    return pl?.name || key || 'My playlist';
  }
  if (source.startsWith('iptv-cat:')) {
    const cat = source.slice('iptv-cat:'.length);
    return cat.charAt(0).toUpperCase() + cat.slice(1);
  }
  if (source.startsWith('iptv-country:')) {
    return source.slice('iptv-country:'.length).toUpperCase();
  }
  if (source.startsWith('iptv-lang:')) {
    const code = source.slice('iptv-lang:'.length);
    return code.charAt(0).toUpperCase() + code.slice(1);
  }
  if (source === 'mapple-premium') return 'Mapple Premium';
  if (source === 'mapple-sports') return 'Mapple Sports';
  if (source === 'stream-scraper') return 'Movies';
  if (source.startsWith('stream-scraper:')) return `Movies · ${source.slice('stream-scraper:'.length)}`;
  return source;
}

export function initials(name: string): string {
  const clean = name.trim();
  return clean.slice(0, 1).toUpperCase();
}

export type OpenPlayerInput = {
  id: string;
  name: string;
  stream?: string;
  source?: string;
  logo?: string;
  hls?: boolean;
  scraperServer?: string;
  streamsJson?: string;
  subtitlesJson?: string;
  fresh?: boolean;
};

/** Navigate to the player with full channel info */
export function openPlayer(ch: OpenPlayerInput) {
  const params: Record<string, string> = {
    id: ch.id,
    name: ch.name,
    stream: ch.stream || '',
    source: ch.source || '',
    logo: ch.logo || '',
  };
  if (ch.hls !== undefined) params.hls = ch.hls ? '1' : '0';
  if (ch.scraperServer) params.scraperServer = ch.scraperServer;
  if (ch.streamsJson) params.streamsJson = ch.streamsJson;
  if (ch.subtitlesJson) params.subtitlesJson = ch.subtitlesJson;
  if (ch.fresh) params.fresh = '1';
  router.push({ pathname: '/player', params });
}

/** Plays in-app when a free copy exists, otherwise opens its detail page. Returns an error message or null. */
export async function openVodItem(item: VodItem): Promise<string | null> {
  if (item.source === 'tmdb') {
    router.push({
      pathname: '/vod-detail',
      params: { kind: item.tmdbKind ?? 'movie', id: String(item.tmdbId ?? ''), title: item.title },
    });
    return null;
  }
  if (item.source === 'server') {
    if (item.msType === 'Series') {
      router.push({
        pathname: '/ms-series',
        params: { id: item.identifier ?? '', title: item.title },
      });
      return null;
    }
    try {
      const stream = await resolveMsStream(item);
      openPlayer({
        id: item.id,
        name: item.title,
        stream,
        source: 'media-server',
        logo: item.poster ?? '',
      });
      return null;
    } catch (e: unknown) {
      return e instanceof Error ? e.message : 'could not start playback';
    }
  }
  if (item.source === 'pluto') {
    try {
      const stream = await resolvePlutoStream(item);
      openPlayer({
        id: item.id,
        name: item.title,
        stream,
        source: 'pluto',
        logo: item.poster ?? '',
      });
      return null;
    } catch (e: unknown) {
      return e instanceof Error ? e.message : 'could not start playback';
    }
  }
  if (!item.identifier) return 'That title is missing its Archive id.';
  try {
    const resolved = await resolveArchivePlayback(item.identifier);
    if (!resolved?.stream) return `No playable file found for “${item.title}”.`;
    openPlayer({
      id: item.id,
      name: item.title,
      stream: resolved.stream,
      source: `archive:${item.identifier}`,
      logo: item.poster ?? '',
      subtitlesJson: resolved.subtitles.length ? JSON.stringify(resolved.subtitles) : undefined,
    });
    return null;
  } catch (e: unknown) {
    return e instanceof Error ? e.message : 'could not start playback';
  }
}

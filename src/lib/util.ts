import { router } from 'expo-router';
import { useLocalStore } from './store';
import { resolveArchiveStream, type VodItem } from './archive';

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
  return source;
}

export function initials(name: string): string {
  const clean = name.trim();
  return clean.slice(0, 1).toUpperCase();
}

/** Navigate to the player with full channel info */
export function openPlayer(ch: { id: string; name: string; stream?: string; source?: string; logo?: string }) {
  router.push({
    pathname: '/player',
    params: {
      id: ch.id,
      name: ch.name,
      stream: ch.stream || '',
      source: ch.source || '',
      logo: ch.logo || '',
    },
  });
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
  if (!item.identifier) return 'That title is missing its Archive id.';
  try {
    const stream = await resolveArchiveStream(item.identifier);
    if (!stream) return `No playable file found for “${item.title}”.`;
    openPlayer({
      id: item.id,
      name: item.title,
      stream,
      source: `archive:${item.identifier}`,
      logo: item.poster ?? '',
    });
    return null;
  } catch (e: unknown) {
    return e instanceof Error ? e.message : 'could not start playback';
  }
}

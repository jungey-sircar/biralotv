import { router } from 'expo-router';

export function favKey(id: string) {
  return `fav:${id}`;
}

/** safe back: falls back to home when there is no screen to go back to */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export function sourceLabel(source: string): string {
  if (source.startsWith('user:')) return source.slice(5) || 'My playlist';
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

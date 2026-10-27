import { Channel } from './api';

// ---- M3U Parser (runs on-device) ----

export type M3UEntry = {
  name: string;
  logo: string;
  group: string;
  url: string;
  attrs: Record<string, string>;
};

function parseAttrs(s: string): Record<string, string> {
  const m: Record<string, string> = {};
  let i = 0;
  const n = s.length;
  const nameChars = /[a-zA-Z0-9_-]/;
  while (i < n) {
    const start = i;
    while (i < n && nameChars.test(s[i])) i++;
    if (i === start) {
      i++;
      continue;
    }
    const name = s.substring(start, i);
    while (i < n && s[i] === ' ') i++;
    if (i < n && s[i] === '=') {
      i++;
      while (i < n && s[i] === ' ') i++;
      if (i < n) {
        const quote = s[i];
        let val = '';
        if (quote === '"' || quote === "'") {
          i++;
          const vs = i;
          while (i < n && s[i] !== quote) i++;
          val = s.substring(vs, i);
          if (i < n) i++;
        } else {
          const vs = i;
          while (i < n && s[i] !== ' ') i++;
          val = s.substring(vs, i);
        }
        m[name.toLowerCase()] = val;
      }
    } else {
      m[name.toLowerCase()] = '';
    }
  }
  return m;
}

export function parseM3U(text: string): M3UEntry[] {
  const out: M3UEntry[] = [];
  let cur: M3UEntry | null = null;
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      if (cur && cur.url) {
        out.push(cur);
        cur = null;
      }
      const rest = line.slice('#EXTINF:'.length);
      const comma = rest.indexOf(',');
      let title = '';
      let attrPart = rest;
      if (comma >= 0) {
        attrPart = rest.slice(0, comma);
        title = rest.slice(comma + 1).trim();
      }
      const attrs = parseAttrs(attrPart);
      cur = {
        name: title || attrs['tvg-name'] || '',
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || '',
        url: '',
        attrs,
      };
    } else if (line.startsWith('#')) {
      continue;
    } else if (cur) {
      cur.url = line;
      out.push(cur);
      cur = null;
    }
  }
  if (cur && cur.url) out.push(cur);
  return out;
}

// ---- Stable ID generation ----

function simpleHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    hash = ((hash << 5) - hash + c) | 0;
  }
  return Math.abs(hash).toString(36);
}

function stableId(source: string, entry: M3UEntry): string {
  const tvgId = entry.attrs?.['tvg-id'];
  if (tvgId) return `iptv:${tvgId}`;
  const key = entry.url || entry.name;
  return `${source}:${simpleHash(key)}`;
}

function m3uToChannels(entries: M3UEntry[], source: string): Channel[] {
  return entries
    .filter(e => e.name && e.url.includes('://'))
    .map(e => ({
      id: stableId(source, e),
      name: e.name,
      logo: e.logo || undefined,
      stream: e.url,
      source,
      group: e.group || undefined,
      updated: new Date().toISOString(),
    }));
}

// ---- iptv-org data fetching with cache ----

const IPTV_BASE = 'https://iptv-org.github.io/iptv';
const CACHE_TTL = 30 * 60 * 1000; // 30 min

type CacheEntry = { channels: Channel[]; ts: number };
const memCache = new Map<string, CacheEntry>();

async function fetchText(url: string, timeoutMs = 60000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchIPTV(key: string, url: string, source: string): Promise<Channel[]> {
  const cached = memCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.channels;
  const text = await fetchText(url);
  const entries = parseM3U(text);
  const channels = m3uToChannels(entries, source);
  memCache.set(key, { channels, ts: Date.now() });
  return channels;
}

export function fetchCategoryChannels(category: string): Promise<Channel[]> {
  const key = `iptv-cat:${category}`;
  return fetchIPTV(key, `${IPTV_BASE}/categories/${category}.m3u`, key);
}

export function fetchCountryChannels(code: string): Promise<Channel[]> {
  const key = `iptv-country:${code}`;
  return fetchIPTV(key, `${IPTV_BASE}/countries/${code}.m3u`, key);
}

export function fetchLanguageChannels(code: string): Promise<Channel[]> {
  const key = `iptv-lang:${code}`;
  return fetchIPTV(key, `${IPTV_BASE}/languages/${code}.m3u`, key);
}

// ---- User playlist helpers ----

export async function fetchPlaylistUrl(url: string, name: string): Promise<Channel[]> {
  const text = await fetchText(url);
  const entries = parseM3U(text);
  const source = `user:${name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  return m3uToChannels(entries, source);
}

export function parsePlaylistText(text: string, name: string): Channel[] {
  const entries = parseM3U(text);
  const source = `user:${name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  return m3uToChannels(entries, source);
}

// ---- Predefined data ----

export type IptvCategory = {
  id: string;
  name: string;
  icon: string;
};

export const IPTV_CATEGORIES: IptvCategory[] = [
  { id: 'news', name: 'News', icon: '📰' },
  { id: 'sports', name: 'Sports', icon: '⚽' },
  { id: 'entertainment', name: 'Entertainment', icon: '🎬' },
  { id: 'movies', name: 'Movies', icon: '🎥' },
  { id: 'music', name: 'Music', icon: '🎵' },
  { id: 'kids', name: 'Kids', icon: '🧸' },
  { id: 'documentary', name: 'Documentary', icon: '🌍' },
  { id: 'education', name: 'Education', icon: '📚' },
  { id: 'comedy', name: 'Comedy', icon: '😂' },
  { id: 'cooking', name: 'Cooking', icon: '🍳' },
  { id: 'lifestyle', name: 'Lifestyle', icon: '🏡' },
  { id: 'travel', name: 'Travel', icon: '✈️' },
  { id: 'science', name: 'Science', icon: '🔬' },
  { id: 'religious', name: 'Religious', icon: '🙏' },
  { id: 'animation', name: 'Animation', icon: '🎨' },
  { id: 'culture', name: 'Culture', icon: '🎭' },
  { id: 'family', name: 'Family', icon: '👨‍👩‍👧' },
  { id: 'general', name: 'General', icon: '📺' },
  { id: 'outdoor', name: 'Outdoor', icon: '🏔️' },
  { id: 'series', name: 'Series', icon: '📀' },
  { id: 'business', name: 'Business', icon: '💼' },
  { id: 'classic', name: 'Classic', icon: '📼' },
  { id: 'weather', name: 'Weather', icon: '🌤️' },
  { id: 'legislative', name: 'Legislative', icon: '🏛️' },
  { id: 'shop', name: 'Shop', icon: '🛒' },
  { id: 'relax', name: 'Relax', icon: '🧘' },
  { id: 'auto', name: 'Auto', icon: '🚗' },
];

export type IptvCountry = { code: string; name: string; flag: string };

export const POPULAR_COUNTRIES: IptvCountry[] = [
  { code: 'np', name: 'Nepal', flag: '🇳🇵' },
  { code: 'in', name: 'India', flag: '🇮🇳' },
  { code: 'us', name: 'United States', flag: '🇺🇸' },
  { code: 'gb', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'de', name: 'Germany', flag: '🇩🇪' },
  { code: 'fr', name: 'France', flag: '🇫🇷' },
  { code: 'es', name: 'Spain', flag: '🇪🇸' },
  { code: 'it', name: 'Italy', flag: '🇮🇹' },
  { code: 'br', name: 'Brazil', flag: '🇧🇷' },
  { code: 'jp', name: 'Japan', flag: '🇯🇵' },
  { code: 'kr', name: 'South Korea', flag: '🇰🇷' },
  { code: 'tr', name: 'Turkey', flag: '🇹🇷' },
  { code: 'ru', name: 'Russia', flag: '🇷🇺' },
  { code: 'ar', name: 'Argentina', flag: '🇦🇷' },
  { code: 'mx', name: 'Mexico', flag: '🇲🇽' },
  { code: 'ca', name: 'Canada', flag: '🇨🇦' },
  { code: 'au', name: 'Australia', flag: '🇦🇺' },
  { code: 'pk', name: 'Pakistan', flag: '🇵🇰' },
  { code: 'bd', name: 'Bangladesh', flag: '🇧🇩' },
  { code: 'id', name: 'Indonesia', flag: '🇮🇩' },
];

export type IptvLanguage = { code: string; name: string; flag: string };

export const POPULAR_LANGUAGES: IptvLanguage[] = [
  { code: 'eng', name: 'English', flag: '🇬🇧' },
  { code: 'hin', name: 'Hindi', flag: '🇮🇳' },
  { code: 'spa', name: 'Spanish', flag: '🇪🇸' },
  { code: 'fra', name: 'French', flag: '🇫🇷' },
  { code: 'deu', name: 'German', flag: '🇩🇪' },
  { code: 'ara', name: 'Arabic', flag: '🇸🇦' },
  { code: 'por', name: 'Portuguese', flag: '🇧🇷' },
  { code: 'zho', name: 'Chinese', flag: '🇨🇳' },
  { code: 'jpn', name: 'Japanese', flag: '🇯🇵' },
  { code: 'kor', name: 'Korean', flag: '🇰🇷' },
  { code: 'tur', name: 'Turkish', flag: '🇹🇷' },
  { code: 'ben', name: 'Bengali', flag: '🇧🇩' },
  { code: 'ita', name: 'Italian', flag: '🇮🇹' },
  { code: 'nld', name: 'Dutch', flag: '🇳🇱' },
  { code: 'rus', name: 'Russian', flag: '🇷🇺' },
  { code: 'cat', name: 'Catalan', flag: '🏴' },
];

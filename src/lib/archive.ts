import type { Channel } from './api';
import type { SubtitleTrackItem } from './subtitles';

const BASE = 'https://archive.org';
const PLAYABLE = 'mediatype:(movies) AND format:("h.264") AND NOT collection:("no-preview")';

export type VodItem = {
  id: string;
  title: string;
  year?: number;
  poster?: string;
  backdrop?: string;
  overview?: string;
  source: 'archive' | 'tmdb' | 'server' | 'pluto';
  identifier?: string;
  tmdbId?: number;
  tmdbKind?: 'movie' | 'tv';
  msType?: 'Movie' | 'Series' | 'Episode';
  msPart?: string;
  plutoKind?: 'vod' | 'series' | 'live';
  plutoUrl?: string;
  rating?: number;
  license?: string;
};

export type ArchiveScope = {
  key: string;
  label: string;
  query: string;
};

const FF = 'collection:(feature_films)';

export const ARCHIVE_SCOPES: ArchiveScope[] = [
  { key: 'films', label: 'Films', query: FF },
  { key: 'noir', label: 'Noir', query: `${FF} AND subject:("film noir")` },
  { key: 'scifi', label: 'Sci-Fi', query: `${FF} AND (subject:("science fiction") OR title:(sci-fi))` },
  { key: 'horror', label: 'Horror', query: `${FF} AND subject:(horror)` },
  { key: 'comedy', label: 'Comedy', query: `${FF} AND subject:(comedy)` },
  { key: 'western', label: 'Western', query: `${FF} AND subject:(western)` },
  { key: 'crime', label: 'Crime', query: `${FF} AND subject:(crime)` },
  { key: 'adventure', label: 'Adventure', query: `${FF} AND subject:(adventure)` },
  { key: 'fantasy', label: 'Fantasy', query: `${FF} AND subject:(fantasy)` },
  { key: 'animation', label: 'Animation', query: `${FF} AND (subject:(animation) OR title:(cartoon))` },
  { key: 'docs', label: 'Documentary', query: `${FF} AND subject:(documentary)` },
  { key: 'silent', label: 'Silent', query: `${FF} AND (subject:(silent) OR title:(silent))` },
  { key: 'shorts', label: 'Shorts', query: 'collection:(short_films)' },
];

type RawValue = string | string[] | number | number[] | undefined;

function firstText(v: RawValue): string {
  if (Array.isArray(v)) return String(v[0] ?? '').trim();
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function toYear(v: RawValue): number | undefined {
  const raw = firstText(v).match(/\d{4}/);
  if (!raw) return undefined;
  const year = Number(raw[0]);
  return year > 1850 && year < 2100 ? year : undefined;
}

function solrSafe(input: string): string {
  return input.replace(/["'(){}\[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function getJson<T>(url: string, timeoutMs = 20000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`Archive responded ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const archivePoster = (identifier: string): string =>
  `${BASE}/services/img/${encodeURIComponent(identifier)}`;

type SearchDoc = {
  identifier: string;
  title?: RawValue;
  year?: RawValue;
  description?: RawValue;
  licenseurl?: RawValue;
};

export async function searchArchive(opts: {
  scope?: ArchiveScope;
  query?: string;
  page?: number;
  rows?: number;
}): Promise<VodItem[]> {
  const shelf = opts.scope?.query ?? FF;
  const freeText = solrSafe(opts.query ?? '');
  const base = `${PLAYABLE} AND ${freeText ? FF : shelf}`;

  const request = async (q: string, sorted: boolean): Promise<SearchDoc[] | null> => {
    const params = new URLSearchParams({
      q,
      fl: 'identifier,title,year,description,licenseurl,downloads',
      rows: String(opts.rows ?? 24),
      page: String(opts.page ?? 1),
      output: 'json',
    });
    if (sorted) params.set('sort', 'downloads desc');
    const body = await getJson<{ response?: { docs?: SearchDoc[] } }>(
      `${BASE}/advancedsearch.php?${params.toString()}`,
    );
    return body.response?.docs ?? null;
  };

  let docs: SearchDoc[] | null = null;
  if (freeText) {
    docs = await request(`${base} AND (title:(${freeText}))`, false);
    if (!docs || docs.length === 0) docs = await request(`${base} AND (${freeText})`, false);
  } else {
    docs = await request(base, true);
  }

  return (docs ?? [])
    .filter(d => d.identifier)
    .map(d => ({
      id: `archive:${d.identifier}`,
      title: firstText(d.title) || d.identifier.replace(/[-_]/g, ' '),
      year: toYear(d.year),
      poster: archivePoster(d.identifier),
      overview: firstText(d.description).slice(0, 400),
      source: 'archive' as const,
      identifier: d.identifier,
      license: firstText(d.licenseurl),
    }));
}

type MetaFile = { name?: string; format?: string; size?: string };

export type ArchiveResolution = {
  stream: string;
  subtitles: SubtitleTrackItem[];
};

const cache = new Map<string, Promise<ArchiveResolution | null>>();

function pickVideo(files: MetaFile[]): string | undefined {
  const mp4s = files.filter(
    f => typeof f.name === 'string' && /\.mp4$/i.test(f.name) && !f.name.startsWith('.'),
  );
  if (mp4s.length === 0) return undefined;
  const small = mp4s.find(f => /_?512kb\.mp4$/i.test(f.name as string));
  if (small) return small.name;
  const bySize = [...mp4s].sort(
    (a, b) => (Number(a.size) || Number.MAX_SAFE_INTEGER) - (Number(b.size) || Number.MAX_SAFE_INTEGER),
  );
  return bySize[0]?.name;
}

const ARCHIVE_LANG_NAMES: Record<string, string> = {
  en: 'English',
  eng: 'English',
  es: 'Spanish',
  spa: 'Spanish',
  fr: 'French',
  fre: 'French',
  fra: 'French',
  de: 'German',
  deu: 'German',
  ger: 'German',
  it: 'Italian',
  ita: 'Italian',
  pt: 'Portuguese',
  por: 'Portuguese',
  ja: 'Japanese',
  jpn: 'Japanese',
  ko: 'Korean',
  kor: 'Korean',
  ar: 'Arabic',
  ara: 'Arabic',
  hi: 'Hindi',
  hin: 'Hindi',
  ru: 'Russian',
  rus: 'Russian',
};

function guessArchiveSubLang(fileName: string): { language: string; label: string } {
  const stem = fileName.replace(/\.(vtt|srt)$/i, '');
  const m = stem.match(/[._-]([a-z]{2,3})$/i);
  const raw = m?.[1]?.toLowerCase() ?? '';
  if (raw && ARCHIVE_LANG_NAMES[raw]) {
    const code = raw.length === 3 ? raw.slice(0, 2) : raw;
    return { language: code, label: ARCHIVE_LANG_NAMES[raw] };
  }
  return { language: 'en', label: 'Subtitles (Archive)' };
}

function pickSubtitles(dir: string, files: MetaFile[]): SubtitleTrackItem[] {
  const subFiles = files.filter(
    f =>
      typeof f.name === 'string' &&
      /\.(vtt|srt)$/i.test(f.name) &&
      !f.name.startsWith('.') &&
      !/_files\.xml$/i.test(f.name),
  );
  if (subFiles.length === 0) return [];
  // Prefer .vtt over .srt when matching the same base stem.
  const vttStems = new Set(
    subFiles.filter(f => /\.vtt$/i.test(f.name as string)).map(f => (f.name as string).replace(/\.vtt$/i, '')),
  );
  const encodedDir = encodeURIComponent(dir);
  const out: SubtitleTrackItem[] = [];
  for (const f of subFiles) {
    const name = f.name as string;
    const isSrt = /\.srt$/i.test(name);
    if (isSrt && vttStems.has(name.replace(/\.srt$/i, ''))) continue;
    const { language, label } = guessArchiveSubLang(name);
    const labelWithIndex = out.some(t => t.label === label) ? `${label} (${out.length + 1})` : label;
    out.push({
      id: `archive:${name}`,
      language,
      label: labelWithIndex,
      format: isSrt ? 'srt' : 'vtt',
      url: `${BASE}/download/${encodedDir}/${encodeURIComponent(name)}`,
      source: 'archive',
    });
  }
  return out;
}

export function resolveArchivePlayback(identifier: string): Promise<ArchiveResolution | null> {
  const hit = cache.get(identifier);
  if (hit) return hit;
  const pending = (async () => {
    const meta = await getJson<{ dir?: string; files?: MetaFile[] }>(
      `${BASE}/metadata/${encodeURIComponent(identifier)}`,
    );
    const files = meta.files ?? [];
    const file = pickVideo(files);
    if (!file || !meta.dir) return null;
    const dir = meta.dir.replace(/^\/\d+\/items\//, '');
    return {
      stream: `${BASE}/download/${encodeURIComponent(dir)}/${encodeURIComponent(file)}`,
      subtitles: pickSubtitles(dir, files),
    };
  })();
  cache.set(identifier, pending);
  return pending;
}

export function resolveArchiveStream(identifier: string): Promise<string | null> {
  return resolveArchivePlayback(identifier).then(res => res?.stream ?? null);
}

export function vodItemToChannel(item: VodItem, stream: string): Channel {
  return {
    id: item.id,
    name: item.title,
    logo: item.poster,
    stream,
    source: `archive:${item.identifier ?? ''}`,
    updated: new Date().toISOString(),
  };
}

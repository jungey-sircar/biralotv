import type { Channel } from './api';

const BASE = 'https://archive.org';
const PLAYABLE = 'mediatype:(movies) AND format:("h.264") AND NOT collection:("no-preview")';

export type VodItem = {
  id: string;
  title: string;
  year?: number;
  poster?: string;
  overview?: string;
  source: 'archive' | 'tmdb';
  identifier?: string;
  tmdbId?: number;
  tmdbKind?: 'movie' | 'tv';
  rating?: number;
  license?: string;
};

export type ArchiveScope = {
  key: string;
  label: string;
  query: string;
};

export const ARCHIVE_SCOPES: ArchiveScope[] = [
  { key: 'films', label: 'Films', query: 'collection:(feature_films)' },
  { key: 'noir', label: 'Noir', query: 'collection:(feature_films) AND (subject:(noir) OR subject:("film-noir"))' },
  { key: 'scifi', label: 'Sci-Fi', query: 'collection:(feature_films) AND (subject:("science fiction") OR title:(sci-fi))' },
  { key: 'horror', label: 'Horror', query: 'collection:(feature_films) AND subject:(horror)' },
  { key: 'comedy', label: 'Comedy', query: 'collection:(feature_films) AND subject:(comedy)' },
  { key: 'animation', label: 'Animation', query: 'collection:(feature_films) AND (subject:(animation) OR title:(cartoon))' },
  { key: 'docs', label: 'Documentary', query: 'collection:(feature_films) AND subject:(documentary)' },
  { key: 'cc', label: 'Creative Commons', query: 'licenseurl:(*creativecommons*)' },
  { key: 'archives', label: 'Archives', query: 'collection:(prelinger)' },
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
  const base = opts.scope ? `${PLAYABLE} AND ${opts.scope.query}` : PLAYABLE;
  const freeText = solrSafe(opts.query ?? '');

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

const cache = new Map<string, Promise<string | null>>();

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

export function resolveArchiveStream(identifier: string): Promise<string | null> {
  const hit = cache.get(identifier);
  if (hit) return hit;
  const pending = (async () => {
    const meta = await getJson<{ dir?: string; files?: MetaFile[] }>(
      `${BASE}/metadata/${encodeURIComponent(identifier)}`,
    );
    const file = pickVideo(meta.files ?? []);
    if (!file || !meta.dir) return null;
    const dir = meta.dir.replace(/^\/\d+\/items\//, '');
    return `${BASE}/download/${encodeURIComponent(dir)}/${encodeURIComponent(file)}`;
  })();
  cache.set(identifier, pending);
  return pending;
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

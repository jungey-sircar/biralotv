import { useSettings } from '@/theme';
import type { VodItem } from './archive';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const WATCH_REGION = 'US';

export const tmdbConfigured = (): boolean => useSettings.getState().tmdbKey.trim().length > 0;

function authUrl(path: string, params: Record<string, string>): string {
  const key = useSettings.getState().tmdbKey.trim();
  const query = new URLSearchParams(params);
  if (!key.startsWith('eyJ')) query.set('api_key', key);
  return `${TMDB_BASE}${path}?${query.toString()}`;
}

async function tmdbGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = useSettings.getState().tmdbKey.trim();
  if (!key) throw new Error('Add a TMDB API key in Settings to browse the full catalogue.');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(authUrl(path, params), {
      signal: ctl.signal,
      headers: key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : undefined,
    });
    if (!res.ok) throw new Error(`TMDB responded ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const poster = (path?: string, size = 'w500'): string | undefined =>
  path ? `${IMG}/${size}${path}` : undefined;

function toYear(v?: string): number | undefined {
  const m = (v ?? '').match(/\d{4}/);
  return m ? Number(m[0]) : undefined;
}

type TmdbEntry = {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string;
  backdrop_path?: string;
  overview?: string;
  vote_average?: number;
};

type TmdbPage = { results?: TmdbEntry[] };

function toVod(e: TmdbEntry, kind: 'movie' | 'tv'): VodItem {
  return {
    id: `tmdb:${kind}-${e.id}`,
    title: e.title || e.name || `TMDB ${e.id}`,
    year: toYear(e.release_date || e.first_air_date),
    poster: poster(e.poster_path),
    overview: e.overview || '',
    source: 'tmdb',
    tmdbId: e.id,
    tmdbKind: kind,
    rating: e.vote_average ? Math.round(e.vote_average * 10) / 10 : undefined,
  };
}

export async function tmdbSearch(query: string, page = 1): Promise<VodItem[]> {
  const body = await tmdbGet<TmdbPage>('/search/multi', {
    query,
    page: String(page),
    include_adult: 'false',
  });
  return (body.results ?? [])
    .filter(e => (e.title || e.name) && (e.poster_path || e.backdrop_path))
    .map(e => toVod(e, e.title ? 'movie' : 'tv'));
}

export async function tmdbDiscover(opts: {
  kind: 'movie' | 'tv';
  genre?: number;
  sortBy?: string;
  page?: number;
}): Promise<VodItem[]> {
  const params: Record<string, string> = {
    page: String(opts.page ?? 1),
    sort_by: opts.sortBy ?? 'popularity.desc',
    include_adult: 'false',
    with_origin_country: '',
  };
  delete params.with_origin_country;
  if (opts.genre) params.with_genres = String(opts.genre);
  if (opts.kind === 'tv' && opts.genre === 16) params.with_original_language = 'ja';
  const body = await tmdbGet<TmdbPage>(`/discover/${opts.kind}`, params);
  return (body.results ?? []).map(e => toVod(e, opts.kind));
}

export type TmdbDetails = {
  item: VodItem;
  backdrop?: string;
  genres: string[];
  runtime?: number;
  trailerKey?: string;
  providers: { name: string; logo?: string; free: boolean }[];
};

type Videos = { results?: { key: string; site?: string; type?: string; official?: boolean }[] };
type Providers = {
  results?: Record<
    string,
    { flatrate?: { provider_name: string; logo_path?: string }[]; free?: { provider_name: string; logo_path?: string }[] }
  >;
};
type Details = {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  genres?: { name: string }[];
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
};

export async function tmdbDetails(kind: 'movie' | 'tv', id: number): Promise<TmdbDetails> {
  const base = await tmdbGet<Details>(`/${kind}/${id}`, { language: 'en-US' });
  const [videos, providers] = await Promise.all([
    tmdbGet<Videos>(`/${kind}/${id}/videos`, { language: 'en-US' }).catch((): Videos => ({ results: [] })),
    tmdbGet<Providers>(`/${kind}/${id}/watch/providers`).catch((): Providers => ({ results: {} })),
  ]);
  const trailer = (videos.results ?? []).find(
    v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'),
  );
  const region = providers.results?.[WATCH_REGION];
  const seen = new Set<string>();
  const list = [...(region?.free ?? []), ...(region?.flatrate ?? [])]
    .filter(p => !seen.has(p.provider_name) && (seen.add(p.provider_name), true))
    .map(p => ({ name: p.provider_name, logo: poster(p.logo_path, 'w92'), free: false }));
  const item = toVod({ ...base, id }, kind);
  return {
    item,
    backdrop: poster(base.backdrop_path, 'w780'),
    genres: (base.genres ?? []).map(g => g.name),
    runtime: base.runtime ?? base.episode_run_time?.[0],
    trailerKey: trailer?.key,
    providers: list,
  };
}

export const TMDB_GENRES = {
  ANIME: 16,
} as const;

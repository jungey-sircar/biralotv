import { useSettings } from '@/theme';
import type { VodItem } from './archive';
import { discoverScraperBase, peekScraperBaseSync } from './scraper';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const KEYLESS_TMDB_BASE = 'https://db.wecollege.net/3';
const IMG = 'https://image.tmdb.org/t/p';
const WATCH_REGION = 'US';

export const tmdbHasPersonalKey = (): boolean =>
  useSettings.getState().tmdbKey.trim().length > 0;

export const tmdbConfigured = (): boolean => true;

function authUrl(path: string, params: Record<string, string>): string {
  const key = useSettings.getState().tmdbKey.trim();
  const query = new URLSearchParams(params);
  if (key && !key.startsWith('eyJ')) query.set('api_key', key);
  return `${TMDB_BASE}${path}?${query.toString()}`;
}

function scraperCatalogUrl(
  base: string,
  path: string,
  params: Record<string, string>,
): string | null {
  const page = params.page ?? '1';
  if (path === '/movie/now_playing') {
    return `${base}/v1/catalog/movies?list=now_playing&page=${encodeURIComponent(page)}`;
  }
  if (path === '/trending/movie/week') {
    return `${base}/v1/catalog/movies?list=trending&page=${encodeURIComponent(page)}`;
  }
  if (path === '/movie/popular') {
    return `${base}/v1/catalog/movies?list=popular&page=${encodeURIComponent(page)}`;
  }
  if (path === '/movie/top_rated') {
    return `${base}/v1/catalog/movies?list=top_rated&page=${encodeURIComponent(page)}`;
  }
  if (path === '/movie/upcoming') {
    return `${base}/v1/catalog/movies?list=upcoming&page=${encodeURIComponent(page)}`;
  }
  if (path === '/search/movie' && params.query) {
    return `${base}/v1/catalog/movies?q=${encodeURIComponent(params.query)}&page=${encodeURIComponent(page)}`;
  }
  const detailMatch = path.match(/^\/movie\/(\d+)$/);
  if (detailMatch) {
    return `${base}/v1/catalog/movies/${detailMatch[1]}`;
  }
  return null;
}

async function fetchJson<T>(
  url: string,
  headers?: Record<string, string>,
  timeoutMs = 15_000,
): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers });
    if (!res.ok) throw new Error(`TMDB responded ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function tmdbGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = useSettings.getState().tmdbKey.trim();
  if (key) {
    return fetchJson<T>(
      authUrl(path, params),
      key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : undefined,
    );
  }

  const scraperBase = peekScraperBaseSync() ?? (await discoverScraperBase({ probe: false }));
  if (scraperBase) {
    const localUrl = scraperCatalogUrl(scraperBase, path, params);
    if (localUrl) {
      try {
        return await fetchJson<T>(localUrl, undefined, 12_000);
      } catch {}
    }
  }

  const query = new URLSearchParams(params);
  const qs = query.toString();
  try {
    return await fetchJson<T>(`${KEYLESS_TMDB_BASE}${path}${qs ? `?${qs}` : ''}`);
  } catch (err) {
    if (!scraperBase) {
      const probed = await discoverScraperBase({ probe: true });
      const localUrl = probed ? scraperCatalogUrl(probed, path, params) : null;
      if (localUrl) {
        return fetchJson<T>(localUrl, undefined, 12_000);
      }
    }
    throw err;
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
  media_type?: string;
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
    backdrop: poster(e.backdrop_path, 'w780') || poster(e.poster_path, 'w780'),
    overview: e.overview || '',
    source: 'tmdb',
    tmdbId: e.id,
    tmdbKind: kind,
    rating: e.vote_average ? Math.round(e.vote_average * 10) / 10 : undefined,
  };
}

export type TmdbMovieListKind = 'now_playing' | 'trending' | 'popular' | 'top_rated' | 'upcoming';

const MOVIE_LIST_PATHS: Record<TmdbMovieListKind, string> = {
  now_playing: '/movie/now_playing',
  trending: '/trending/movie/week',
  popular: '/movie/popular',
  top_rated: '/movie/top_rated',
  upcoming: '/movie/upcoming',
};

export async function tmdbMovieList(kind: TmdbMovieListKind, page = 1): Promise<VodItem[]> {
  const body = await tmdbGet<TmdbPage>(MOVIE_LIST_PATHS[kind], {
    language: 'en-US',
    page: String(page),
  });
  return (body.results ?? [])
    .filter(e => (e.title || e.name) && e.poster_path)
    .map(e => toVod(e, 'movie'));
}

export async function tmdbLatestMovies(page = 1): Promise<VodItem[]> {
  const nowPlaying = await tmdbMovieList('now_playing', page);
  if (nowPlaying.length > 0 || page > 1) return nowPlaying;
  return tmdbMovieList('trending', page);
}

export async function tmdbTrendingMovies(page = 1): Promise<VodItem[]> {
  return tmdbMovieList('trending', page);
}

export async function tmdbPopularMovies(page = 1): Promise<VodItem[]> {
  return tmdbMovieList('popular', page);
}

export async function tmdbTopRatedMovies(page = 1): Promise<VodItem[]> {
  return tmdbMovieList('top_rated', page);
}

export async function tmdbUpcomingMovies(page = 1): Promise<VodItem[]> {
  return tmdbMovieList('upcoming', page);
}

export async function tmdbGenreMovies(genreId: number, page = 1): Promise<VodItem[]> {
  return tmdbDiscover({ kind: 'movie', genre: genreId, page });
}

export type TmdbTvListKind = 'trending' | 'popular' | 'top_rated' | 'on_the_air' | 'airing_today';

const TV_LIST_PATHS: Record<TmdbTvListKind, string> = {
  trending: '/trending/tv/week',
  popular: '/tv/popular',
  top_rated: '/tv/top_rated',
  on_the_air: '/tv/on_the_air',
  airing_today: '/tv/airing_today',
};

export async function tmdbTvList(kind: TmdbTvListKind, page = 1): Promise<VodItem[]> {
  const body = await tmdbGet<TmdbPage>(TV_LIST_PATHS[kind], {
    language: 'en-US',
    page: String(page),
  });
  return (body.results ?? [])
    .filter(e => (e.title || e.name) && e.poster_path)
    .map(e => toVod(e, 'tv'));
}

export async function tmdbTrendingTV(page = 1): Promise<VodItem[]> {
  return tmdbTvList('trending', page);
}

export async function tmdbPopularTV(page = 1): Promise<VodItem[]> {
  return tmdbTvList('popular', page);
}

export async function tmdbTopRatedTV(page = 1): Promise<VodItem[]> {
  return tmdbTvList('top_rated', page);
}

export async function tmdbOnTheAirTV(page = 1): Promise<VodItem[]> {
  return tmdbTvList('on_the_air', page);
}

export async function tmdbAiringTodayTV(page = 1): Promise<VodItem[]> {
  return tmdbTvList('airing_today', page);
}

export async function tmdbGenreTV(genreId: number, page = 1): Promise<VodItem[]> {
  return tmdbDiscover({ kind: 'tv', genre: genreId, page });
}

export async function tmdbSearchTV(query: string, page = 1): Promise<VodItem[]> {
  const body = await tmdbGet<TmdbPage>('/search/tv', {
    query,
    language: 'en-US',
    page: String(page),
    include_adult: 'false',
  });
  return (body.results ?? [])
    .filter(e => (e.title || e.name) && (e.poster_path || e.backdrop_path))
    .map(e => toVod(e, 'tv'));
}

export async function tmdbSearchMovies(query: string, page = 1): Promise<VodItem[]> {
  const body = await tmdbGet<TmdbPage>('/search/movie', {
    query,
    language: 'en-US',
    page: String(page),
    include_adult: 'false',
  });
  return (body.results ?? [])
    .filter(e => e.title && (e.poster_path || e.backdrop_path))
    .map(e => toVod(e, 'movie'));
}

export async function tmdbSearch(query: string, page = 1): Promise<VodItem[]> {
  const body = await tmdbGet<TmdbPage>('/search/multi', {
    query,
    page: String(page),
    include_adult: 'false',
  });
  return (body.results ?? [])
    .filter(e => e.media_type !== 'person' && (e.title || e.name) && (e.poster_path || e.backdrop_path))
    .map(e => toVod(e, e.media_type === 'tv' || (!e.title && !!e.name) ? 'tv' : 'movie'));
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
  };
  if (opts.genre) params.with_genres = String(opts.genre);
  if (opts.kind === 'tv' && opts.genre === 16) params.with_original_language = 'ja';
  const body = await tmdbGet<TmdbPage>(`/discover/${opts.kind}`, params);
  return (body.results ?? [])
    .filter(e => (e.title || e.name) && e.poster_path)
    .map(e => toVod(e, opts.kind));
}

export type TmdbSeasonSummary = {
  season_number: number;
  episode_count: number;
  name: string;
};

export type TmdbEpisodeSummary = {
  episode_number: number;
  name: string;
};

export type TmdbDetails = {
  item: VodItem;
  backdrop?: string;
  genres: string[];
  runtime?: number;
  trailerKey?: string;
  seasons: TmdbSeasonSummary[];
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
  seasons?: { season_number?: number; episode_count?: number; name?: string }[];
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
  const seasons: TmdbSeasonSummary[] =
    kind === 'tv'
      ? (base.seasons ?? [])
          .filter(s => typeof s.season_number === 'number' && s.season_number > 0)
          .map(s => ({
            season_number: s.season_number as number,
            episode_count: s.episode_count ?? 0,
            name: s.name || `Season ${s.season_number}`,
          }))
          .sort((a, b) => a.season_number - b.season_number)
      : [];
  const item = toVod({ ...base, id }, kind);
  return {
    item,
    backdrop: poster(base.backdrop_path, 'w780'),
    genres: (base.genres ?? []).map(g => g.name),
    runtime: base.runtime ?? base.episode_run_time?.[0],
    trailerKey: trailer?.key,
    seasons,
    providers: list,
  };
}

export async function tmdbSeasonEpisodes(id: number, season: number): Promise<TmdbEpisodeSummary[]> {
  try {
    const res = await tmdbGet<{
      episodes?: { episode_number?: number; name?: string }[];
    }>(`/tv/${id}/season/${season}`, { language: 'en-US' });
    return (res.episodes ?? [])
      .filter(ep => typeof ep.episode_number === 'number' && ep.episode_number >= 0)
      .map(ep => ({
        episode_number: ep.episode_number as number,
        name: ep.name || `Episode ${ep.episode_number}`,
      }))
      .sort((a, b) => a.episode_number - b.episode_number);
  } catch {
    return [];
  }
}

export const TMDB_GENRES = {
  ACTION: 28,
  ADVENTURE: 12,
  ANIMATION: 16,
  ANIME: 16,
  COMEDY: 35,
  CRIME: 80,
  DOCUMENTARY: 99,
  DRAMA: 18,
  FAMILY: 10751,
  FANTASY: 14,
  HORROR: 27,
  SCIFI: 878,
  THRILLER: 53,
} as const;

export const TMDB_TV_GENRES = {
  ACTION_ADVENTURE: 10759,
  ANIMATION: 16,
  COMEDY: 35,
  CRIME: 80,
  DOCUMENTARY: 99,
  DRAMA: 18,
  FAMILY: 10751,
  KIDS: 10762,
  MYSTERY: 9648,
  SCIFI_FANTASY: 10765,
} as const;

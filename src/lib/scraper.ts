import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { Platform, NativeModules } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { apiBase } from './api';
import type { SubtitleTrackItem } from './subtitles';

export type { SubtitleTrackItem };

export type ScraperServerId = 'auto' | 'server1' | 'server2' | 'server3';
export type ConcreteScraperServer = 'server1' | 'server2' | 'server3';

export const SCRAPER_SERVERS: { id: ScraperServerId; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Tries Server 1 → Server 2 → Server 3 automatically' },
  { id: 'server1', label: 'Server 1', hint: 'Multi-mirror HLS resolver (default in stream-scraper)' },
  { id: 'server2', label: 'Server 2', hint: 'Primary catalog first with secondary fallback' },
  { id: 'server3', label: 'Server 3', hint: 'Secondary catalog only' },
];

export interface ScraperStreamVariant {
  quality: string;
  url: string;
}

export interface ScraperResolution {
  type: 'movie' | 'tv';
  tmdb_id: number;
  season?: number;
  episode?: number;
  server: ConcreteScraperServer;
  resolved_by?: string;
  playlist?: string;
  streams: ScraperStreamVariant[];
  thumbnails?: string;
  subtitles?: SubtitleTrackItem[];
}

interface ScraperConfigState {
  url: string;
  server: ScraperServerId;
  setUrl: (value: string) => void;
  setServer: (server: ScraperServerId) => void;
}

export function normalizeScraperUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/healthz$/i, '')
    .replace(/\/+$/, '');
}

export const useScraperConfig = create<ScraperConfigState>()(
  persist(
    set => ({
      url: '',
      server: 'auto',
      setUrl: value => {
        clearDiscoveredScraperCache();
        set({ url: normalizeScraperUrl(value) });
      },
      setServer: server => set({ server }),
    }),
    { name: 'biralotv.scraper.v1', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export class ScraperError extends Error {
  code: 'NO_SCRAPER' | 'NO_STREAMS' | 'HTTP' | 'TIMEOUT';
  status?: number;

  constructor(code: ScraperError['code'], message: string, status?: number) {
    super(message);
    this.name = 'ScraperError';
    this.code = code;
    this.status = status;
  }
}

let runtimeScraperUrlCache: string | null = null;
let embeddedScraperUrlCache: string | null = null;
let probedScraperCache: { url: string | null; at: number } | null = null;
const PROBE_TTL_MS = 20_000;

export function clearDiscoveredScraperCache(): void {
  probedScraperCache = null;
}

export function peekScraperBaseSync(): string | null {
  const configured = normalizeScraperUrl(useScraperConfig.getState().url);
  if (/^https?:\/\//i.test(configured)) return configured;
  if (runtimeScraperUrlCache) return runtimeScraperUrlCache;
  if (embeddedScraperUrlCache) return embeddedScraperUrlCache;
  if (probedScraperCache?.url && Date.now() - probedScraperCache.at < PROBE_TTL_MS) {
    return probedScraperCache.url;
  }
  return null;
}

type ScraperBridgeNative = { getLocalScraperUrl?: () => Promise<string | null> };

export async function getEmbeddedAndroidScraperUrl(): Promise<string | null> {
  if (embeddedScraperUrlCache) return embeddedScraperUrlCache;
  if (Platform.OS !== 'android') return null;
  const bridge = (NativeModules as { ScraperBridge?: ScraperBridgeNative }).ScraperBridge;
  if (!bridge || typeof bridge.getLocalScraperUrl !== 'function') return null;
  try {
    const raw = await bridge.getLocalScraperUrl();
    const candidate = typeof raw === 'string' ? normalizeScraperUrl(raw) : '';
    if (/^https?:\/\//i.test(candidate)) {
      embeddedScraperUrlCache = candidate;
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getBuiltInScraperUrl(): Promise<string | null> {
  return (await getRuntimeDesktopScraperUrl()) ?? (await getEmbeddedAndroidScraperUrl());
}

export async function getRuntimeDesktopScraperUrl(): Promise<string | null> {
  if (runtimeScraperUrlCache !== null) return runtimeScraperUrlCache || null;
  if (Platform.OS !== 'web') {
    runtimeScraperUrlCache = '';
    return null;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 1500);
  try {
    const res = await fetch('/__biralotv_config.json', {
      cache: 'no-store',
      signal: ctl.signal,
    });
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!res.ok || !ct.includes('json')) {
      runtimeScraperUrlCache = '';
      return null;
    }
    const body = (await res.json()) as { scraperUrl?: unknown };
    const candidate =
      typeof body?.scraperUrl === 'string' ? normalizeScraperUrl(body.scraperUrl) : '';
    runtimeScraperUrlCache = /^https?:\/\//i.test(candidate) ? candidate : '';
    return runtimeScraperUrlCache || null;
  } catch {
    runtimeScraperUrlCache = '';
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function checkHealth(base: string, timeoutMs = 1800): Promise<{ version: string } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/healthz`, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: unknown; version?: unknown };
    if (data?.status === 'ok' && typeof data.version === 'string') {
      return { version: data.version };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function candidateScraperUrls(): string[] {
  const list: string[] = [];
  const push = (u: string) => {
    const clean = normalizeScraperUrl(u);
    if (clean && !list.includes(clean)) list.push(clean);
  };

  const backend = apiBase();
  if (/^https?:\/\//i.test(backend)) {
    try {
      const u = new URL(backend);
      if (u.hostname) {
        push(`http://${u.hostname}:8080`);
        push(`http://${u.hostname}:8081`);
        push(`http://${u.hostname}:8300`);
      }
    } catch {}
  }

  if (Platform.OS === 'android') {
    if (!Device.isDevice) {
      push('http://10.0.2.2:8080');
      push('http://10.0.2.2:8081');
    }
    push('http://127.0.0.1:8080');
    push('http://127.0.0.1:8081');
    return list;
  }

  if (Platform.OS === 'web') {
    const host = typeof window !== 'undefined' ? window.location?.hostname : '';
    if (host && host !== '127.0.0.1' && host !== 'localhost') {
      push(`http://${host}:8080`);
      push(`http://${host}:8081`);
    }
  }

  push('http://127.0.0.1:8080');
  push('http://localhost:8080');
  push('http://127.0.0.1:8081');
  push('http://localhost:8081');
  return list;
}

export async function discoverScraperBase(opts: { probe?: boolean } = {}): Promise<string | null> {
  const configured = normalizeScraperUrl(useScraperConfig.getState().url);
  if (/^https?:\/\//i.test(configured)) return configured;

  const runtimeUrl = await getRuntimeDesktopScraperUrl();
  if (runtimeUrl) return runtimeUrl;

  const embeddedUrl = await getEmbeddedAndroidScraperUrl();
  if (embeddedUrl) return embeddedUrl;

  if (opts.probe === false) return null;

  if (probedScraperCache && Date.now() - probedScraperCache.at < PROBE_TTL_MS) {
    return probedScraperCache.url;
  }

  const candidates = candidateScraperUrls();
  const checks = await Promise.all(
    candidates.map(async candidate => ({
      candidate,
      ok: (await checkHealth(candidate, 1400)) !== null,
    })),
  );
  const found = checks.find(c => c.ok)?.candidate ?? null;
  probedScraperCache = { url: found, at: Date.now() };
  return found;
}

export async function testScraper(overrideUrl?: string): Promise<string> {
  let target = overrideUrl ? normalizeScraperUrl(overrideUrl) : '';
  if (target && !/^https?:\/\//i.test(target)) {
    throw new ScraperError('NO_SCRAPER', 'Scraper URL must start with http:// or https://');
  }
  if (!target) {
    const discovered = await discoverScraperBase({ probe: true });
    if (!discovered) {
      throw new ScraperError(
        'NO_SCRAPER',
        'No running stream-scraper found. Start stream-scraper or enter its address.',
      );
    }
    target = discovered;
  }

  const health = await checkHealth(target, 4000);
  if (!health) {
    throw new ScraperError(
      'NO_SCRAPER',
      `Could not reach stream-scraper at ${target}. Make sure it is running and reachable from this device.`,
    );
  }

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    try {
      const res = await fetch(`${target}/v1/servers`, { signal: ctl.signal, cache: 'no-store' });
      if (res.ok) {
        const body = (await res.json()) as { servers?: { id: string }[] };
        const names = (body.servers ?? []).map(s => s.id).filter(Boolean).join(', ');
        if (names) return `Connected · v${health.version} (${names}) at ${target}`;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {}

  return `Connected · v${health.version} at ${target}`;
}

async function fetchScraperJson<T>(url: string, timeoutMs = 28_000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    } catch (e: unknown) {
      clearDiscoveredScraperCache();
      if (e instanceof Error && e.name === 'AbortError') {
        throw new ScraperError('TIMEOUT', 'Stream lookup timed out. Try another server.');
      }
      throw new ScraperError(
        'NO_SCRAPER',
        'Cannot reach stream-scraper. Check that it is running and check Settings.',
      );
    }

    if (!res.ok) {
      let code = '';
      let message = `Scraper responded HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        code = body?.error?.code ?? '';
        if (body?.error?.message) message = body.error.message;
      } catch {}

      if (res.status === 404 || code === 'no_streams') {
        throw new ScraperError('NO_STREAMS', message, res.status);
      }
      if (res.status === 504 || code === 'upstream_timeout') {
        throw new ScraperError('TIMEOUT', message, res.status);
      }
      throw new ScraperError('HTTP', message, res.status);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveEndpoint(
  relPath: string,
  serverPref?: ScraperServerId,
): Promise<ScraperResolution> {
  const base = await discoverScraperBase({ probe: true });
  if (!base) {
    throw new ScraperError(
      'NO_SCRAPER',
      'Movie scraper is not connected. Start stream-scraper or set its URL in Settings.',
    );
  }

  const pref = serverPref ?? useScraperConfig.getState().server;
  const order: ConcreteScraperServer[] =
    pref === 'server1' || pref === 'server2' || pref === 'server3'
      ? [pref]
      : ['server1', 'server2', 'server3'];

  let lastErr: ScraperError | null = null;
  for (const srv of order) {
    try {
      const payload = await fetchScraperJson<ScraperResolution>(
        `${base}${relPath}?server=${srv}`,
        28_000,
      );
      if (payload.playlist || (payload.streams && payload.streams.length > 0)) {
        return payload;
      }
      lastErr = new ScraperError('NO_STREAMS', `No stream returned by ${srv}.`);
    } catch (e: unknown) {
      const err =
        e instanceof ScraperError
          ? e
          : new ScraperError('HTTP', e instanceof Error ? e.message : 'Stream lookup failed.');
      if (err.code === 'NO_SCRAPER') throw err;
      lastErr = err;
    }
  }

  throw (
    lastErr ??
    new ScraperError('NO_STREAMS', 'No playable stream was found on any scraper server.')
  );
}

export async function resolveMovieStream(
  tmdbId: number,
  serverPref?: ScraperServerId,
): Promise<ScraperResolution> {
  return resolveEndpoint(`/v1/movies/${tmdbId}`, serverPref);
}

export async function resolveEpisodeStream(
  tmdbId: number,
  season: number,
  episode: number,
  serverPref?: ScraperServerId,
): Promise<ScraperResolution> {
  return resolveEndpoint(`/v1/shows/${tmdbId}/seasons/${season}/episodes/${episode}`, serverPref);
}

async function fetchSubtitleList(relPath: string): Promise<SubtitleTrackItem[]> {
  const base = await discoverScraperBase({ probe: true });
  if (!base) return [];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 14_000);
  try {
    const res = await fetch(`${base}${relPath}`, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as { subtitles?: unknown };
    if (!Array.isArray(body?.subtitles)) return [];
    return body.subtitles.filter(
      (s): s is SubtitleTrackItem =>
        Boolean(s) &&
        typeof s === 'object' &&
        typeof s.id === 'string' &&
        typeof s.url === 'string' &&
        typeof s.label === 'string' &&
        typeof s.language === 'string',
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function fetchMovieSubtitles(tmdbId: number): Promise<SubtitleTrackItem[]> {
  return fetchSubtitleList(`/v1/subtitles/movies/${tmdbId}`);
}

export function fetchEpisodeSubtitles(
  tmdbId: number,
  season: number,
  episode: number,
): Promise<SubtitleTrackItem[]> {
  return fetchSubtitleList(`/v1/subtitles/shows/${tmdbId}/seasons/${season}/episodes/${episode}`);
}

export function listPlayableOptions(res: ScraperResolution): ScraperStreamVariant[] {
  const seen = new Set<string>();
  const out: ScraperStreamVariant[] = [];

  if (res.playlist) {
    const singleVariantMatchesPlaylist =
      res.streams.length === 1 && res.streams[0]?.url === res.playlist;
    const label = singleVariantMatchesPlaylist
      ? res.streams[0].quality || 'Auto'
      : 'Auto (HLS)';
    out.push({ quality: label, url: res.playlist });
    seen.add(res.playlist);
  }

  for (const s of res.streams ?? []) {
    if (!s?.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ quality: s.quality || 'Stream', url: s.url });
  }

  return out;
}

export function pickPlayableStream(
  res: ScraperResolution,
  preferredQuality?: string,
): ScraperStreamVariant | null {
  const options = listPlayableOptions(res);
  if (options.length === 0) return null;
  if (preferredQuality) {
    const hit = options.find(
      o => o.quality.toLowerCase() === preferredQuality.toLowerCase(),
    );
    if (hit) return hit;
  }
  return options[0];
}

export type ParsedScraperChannelId =
  | { kind: 'movie'; tmdbId: number }
  | { kind: 'tv'; tmdbId: number; season: number; episode: number };

export function parseScraperChannelId(id: string): ParsedScraperChannelId | null {
  if (!id.startsWith('scraper:')) return null;
  const parts = id.split(':');
  if (parts[1] === 'movie' && parts.length === 3) {
    const tmdbId = Number(parts[2]);
    return Number.isInteger(tmdbId) && tmdbId > 0 ? { kind: 'movie', tmdbId } : null;
  }
  if (parts[1] === 'tv' && parts.length === 5) {
    const tmdbId = Number(parts[2]);
    const season = Number(parts[3]);
    const episode = Number(parts[4]);
    if (
      Number.isInteger(tmdbId) &&
      tmdbId > 0 &&
      Number.isInteger(season) &&
      season >= 1 &&
      Number.isInteger(episode) &&
      episode >= 0
    ) {
      return { kind: 'tv', tmdbId, season, episode };
    }
  }
  return null;
}

export function scraperHostSuggestionFromBackend(): string | null {
  const backend = apiBase();
  if (!/^https?:\/\//i.test(backend)) return null;
  try {
    const u = new URL(backend);
    if (!u.hostname) return null;
    return `http://${u.hostname}:8081`;
  } catch {
    return null;
  }
}


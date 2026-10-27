import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Device from 'expo-device';

/**
 * biralotv shared data layer. The LAN backend is optional: when
 * no server address is configured the app reads static iptv-org
 * playlists and local device playlists instead.
 */

function defaultServer(): string {
  if (Platform.OS === 'android' && !Device.isDevice) return 'http://10.0.2.2:8080';
  return '';
}

interface Config {
  server: string;
}

export const useConfig = create<Config>()(
  persist(
    (set) => ({
      server: defaultServer(),
      setServer: (value) => set({ server: value.trim().replace(/\/+$/, '') }),
    }),
    { name: 'biralotv.config.v3', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export const apiBase = () => useConfig.getState().server.trim();

/**
 * Resolves only after the persisted server config has finished
 * hydrating so callers never observe a half-initialised address.
 */

export const useHydrated = () => {
  const [ready, setReady] = useState(useConfig.persist.hasHydrated());
  useEffect(() => {
    const unsub = useConfig.persist.onFinishHydration(() => setReady(true));
    if (useConfig.persist.hasHydrated()) setReady(true);
    return unsub;
  }, []);
  return ready;
};

export const useServerConfigured = () => {
  const hydrated = useHydrated();
  const server = useConfig((s) => s.server);
  return hydrated ? server || null : null;
};

// ----------------------------------------------------------

import {
  fetchPlaylistUrl,
  parsePlaylistText,
  fetchCategoryChannels,
  fetchCountryChannels,
  fetchLanguageChannels,
  IPTV_CATEGORIES,
  POPULAR_COUNTRIES,
  POPULAR_LANGUAGES,
} from './iptv';
import { useLocalStore } from './store';
import { filterAdult, useSettings } from '@/theme';

export interface Channel {
  id: string;
  name: string;
  logo?: string;
  stream?: string;
  source: string;
  group?: string;
  number?: number;
  updated: string;
}

export interface ChannelPage {
  channels: Channel[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface Source {
  id: string;
  name: string;
  kind: string;
  channels?: number;
  tier?: string | number;
}

export interface ScrapeStatus {
  running: boolean;
  source?: string;
  done: number;
  total: number;
  failed: number;
  started?: string;
  last_success?: string;
}

export interface Health {
  ok: boolean;
  channels: number;
  scrape: ScrapeStatus;
}

export interface Playlist {
  id: number;
  name: string;
  url?: string;
  created_at: string;
  channel_count: number;
}

export type PlaylistRow = {
  id: number | string;
  name: string;
  url?: string;
  text?: string;
  created_at?: string;
  createdAt?: number;
  channel_count?: number;
  channelCount?: number;
};

export interface ChannelOpts {
  source?: string;
  group?: string;
  q?: string;
  page?: number;
  perPage?: number;
  favorites?: boolean;
}

export const DEFAULT_PER_PAGE = 60;

export class ApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface FetchJsonOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

const fetchJson = async <T>(url: string, opts: FetchJsonOpts = {}): Promise<T> => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body,
      signal: ctl.signal,
    });
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
};

const userPlaylistChannels = async (key: string): Promise<Channel[]> => {
  const pl = useLocalStore.getState().playlists.find((p) => String(p.id) === key);
  if (!pl) throw new ApiError('Playlist not found');
  const text = pl.text ?? (pl.url ? await fetchPlaylistUrl(pl.url, pl.name) : null);
  return text ? parsePlaylistText(text, pl.name) : [];
};

export const channels = async (opts: ChannelOpts = {}): Promise<ChannelPage> => {
  const source = opts.source ?? '';
  const rawQ = (opts.q ?? '').trim();
  let fetched: Channel[] | null = null;
  try {
    if (source.startsWith('iptv-cat:')) {
      fetched = await fetchCategoryChannels(source.slice(9));
    } else if (source.startsWith('iptv-country:')) {
      fetched = await fetchCountryChannels(source.slice(13));
    } else if (source.startsWith('iptv-lang:')) {
      fetched = await fetchLanguageChannels(source.slice(10));
    } else if (source.startsWith('user:')) {
      fetched = await userPlaylistChannels(source.slice(5));
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.warn('iptv: fetch failed', source, err);
  }

  let list: Channel[];
  if (fetched === null) {
    const base = apiBase().trim();
    if (!base) throw new ApiError('No server configured');
    const parts: string[] = ['page=1', 'per_page=10000'];
    const localId = source.startsWith('iptv-') || source.startsWith('user:');
    if (source && !localId) parts.push(`source=${encodeURIComponent(source)}`);
    if (rawQ) parts.push(`q=${encodeURIComponent(rawQ)}`);
    if (opts.group && opts.group !== 'All') parts.push(`group=${encodeURIComponent(opts.group)}`);
    if (opts.favorites) parts.push('favorites=1');
    const first = await fetchJson<{ channels?: Channel[] }>(
      `${base}/api/v1/channels?${parts.join('&')}`,
      { timeoutMs: 15000 },
    );
    list = Array.isArray(first.channels) ? first.channels : [];
  } else {
    list = fetched;
  }

  if (rawQ) list = list.filter((c) => c.name.toLowerCase().includes(rawQ.toLowerCase()));
  list = filterAdult(list, useSettings.getState().showAdult);

  const perPage = Math.max(1, opts.perPage ?? DEFAULT_PER_PAGE);
  const page = Math.max(1, opts.page ?? 1);
  const start = (page - 1) * perPage;
  return {
    channels: list.slice(start, start + perPage),
    page,
    per_page: perPage,
    total: list.length,
    total_pages: list.length === 0 ? 1 : Math.ceil(list.length / perPage),
  };
};

const localSources = (): Source[] => {
  const cats: Source[] = IPTV_CATEGORIES.map((c) => ({
    id: `iptv-cat:${c.id}`,
    name: c.name,
    kind: 'category',
  }));
  const countries: Source[] = POPULAR_COUNTRIES.map((c) => ({
    id: `iptv-country:${c.code}`,
    name: `${c.flag} ${c.name}`,
    kind: 'country',
  }));
  const langs: Source[] = POPULAR_LANGUAGES.map((l) => ({
    id: `iptv-lang:${l.code}`,
    name: `${l.flag} ${l.name}`,
    kind: 'language',
  }));
  const user: Source[] = useLocalStore.getState().playlists.map((p) => ({
    id: `user:${p.id}`,
    name: p.name,
    kind: 'playlist',
    channels: p.channelCount,
  }));
  return [...cats, ...countries, ...langs, ...user];
};

export const sources = async (): Promise<Source[]> => {
  const local = localSources();
  const base = apiBase().trim();
  if (!base) return local;
  try {
    const remote = await fetchJson<Source[]>(`${base}/api/v1/sources`, { timeoutMs: 5000 });
    if (Array.isArray(remote)) return local.concat(remote);
  } catch (err) {
    console.warn('sources: backend unavailable', err);
  }
  return local;
};

export const channel = async (id: string): Promise<Channel> => {
  const base = apiBase().trim();
  if (!base) throw new ApiError('No server configured');
  return fetchJson<Channel>(`${base}/api/v1/channels/${encodeURIComponent(id)}`);
};

export const health = async (): Promise<Health> => {
  const base = apiBase().trim();
  if (!base) throw new ApiError('No server configured');
  return fetchJson<Health>(`${base}/api/v1/health`);
};

export const scrapeStatus = async (): Promise<ScrapeStatus> => {
  const base = apiBase().trim();
  if (!base) throw new ApiError('No server configured');
  return fetchJson<ScrapeStatus>(`${base}/api/v1/scrape/status`);
};

export const scrapeStart = (source: string, force = true): Promise<unknown> => {
  const base = apiBase().trim();
  if (!base) return Promise.reject(new ApiError('No server configured'));
  return fetchJson<unknown>(`${base}/api/v1/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, force }),
    timeoutMs: 8000,
  });
};

const addFavorite = (c: Channel): void => useLocalStore.getState().addFavorite(c);
const removeFavorite = (id: string): void => useLocalStore.getState().removeFavorite(id);
const isFavorite = (id: string): boolean => useLocalStore.getState().isFavorite(id);
const addRecent = (c: Channel): void => useLocalStore.getState().addRecent(c);

export const api = {
  channel,
  channels,
  sources,
  health,
  scrapeStatus,
  scrapeStart,
  addFavorite,
  removeFavorite,
  isFavorite,
  addRecent,
};

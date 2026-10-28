import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { VodItem } from './archive';

export type MsKind = 'jellyfin' | 'emby' | 'plex';

type MsState = {
  kind: MsKind;
  url: string;
  key: string;
  setKind: (k: MsKind) => void;
  setUrl: (v: string) => void;
  setKey: (v: string) => void;
};

export const useMediaServer = create<MsState>()(
  persist(
    set => ({
      kind: 'jellyfin',
      url: '',
      key: '',
      setKind: kind => set({ kind }),
      setUrl: v => set({ url: v.trim().replace(/\/+$/, '') }),
      setKey: v => set({ key: v.trim() }),
    }),
    { name: 'biralotv.media.v1', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export const MS_KINDS: { id: MsKind; label: string; hint: string }[] = [
  { id: 'jellyfin', label: 'Jellyfin', hint: 'Dashboard → API Keys → Add' },
  { id: 'emby', label: 'Emby', hint: 'Dashboard → Advanced → API Keys' },
  { id: 'plex', label: 'Plex', hint: 'any Plex token from your account' },
];

export const useMsConfigured = () => {
  const url = useMediaServer(s => s.url);
  const key = useMediaServer(s => s.key);
  return url.startsWith('http') && !!key;
};

const DEVICE = 'biralotv';

type Cfg = { kind: MsKind; base: string; key: string };

function cfg(): Cfg {
  const { kind, url, key } = useMediaServer.getState();
  const base = url.trim().replace(/\/+$/, '');
  if (!base || !key) throw new Error('Media server is not configured.');
  if (!/^https?:\/\//i.test(base)) throw new Error('Server address must start with http:// or https://');
  return { kind, base, key };
}

function headers(kind: MsKind, key: string): Record<string, string> {
  if (kind === 'plex') {
    return {
      'X-Plex-Token': key,
      'X-Plex-Client-Identifier': DEVICE,
      'X-Plex-Product': DEVICE,
      'X-Plex-Version': '1.0',
      Accept: 'application/json',
    };
  }
  return {
    'X-Emby-Token': key,
    'X-Emby-Client': DEVICE,
    'X-Emby-Device-Name': DEVICE,
    'X-Emby-Device-Id': DEVICE,
    Accept: 'application/json',
  };
}

function join(base: string, path: string, params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  return `${base}${path}${q ? `?${q}` : ''}`;
}

async function request<T>(url: string, kind: MsKind, key: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctl.signal,
      headers: { ...headers(kind, key), ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`${kind === 'plex' ? 'Plex' : 'Server'} responded ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const get = <T,>(path: string, params: Record<string, string> = {}): Promise<T> => {
  const { kind, base, key } = cfg();
  return request<T>(join(base, path, kind === 'plex' ? { ...params, 'X-Plex-Token': key } : params), kind, key);
};

const post = <T,>(path: string, params: Record<string, string>, body: unknown): Promise<T> => {
  const { kind, base, key } = cfg();
  return request<T>(join(base, path, params), kind, key, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
};

type JfItem = {
  Id: string;
  Name?: string;
  SeriesName?: string;
  Type?: string;
  ProductionYear?: number;
  Overview?: string;
  ParentId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
};

type JfList = { Items?: JfItem[]; TotalRecordCount?: number };

let uidCache: { sig: string; uid: string } = { sig: '', uid: '' };

async function jfUserId(sig: string): Promise<string> {
  if (uidCache.sig === sig && uidCache.uid) return uidCache.uid;
  const users = await get<JfItem[]>('/Users', { Fields: 'PrimaryImageTag' });
  const uid = (Array.isArray(users) ? users[0]?.Id : '') ?? '';
  if (!uid) throw new Error('No users on this server yet. Create one in the dashboard first.');
  uidCache = { sig, uid };
  return uid;
}

const jfImage = (id: string): string => {
  const { base, key } = cfg();
  return join(`${base}/Items/${encodeURIComponent(id)}/Primary`, '', { width: '500', api_key: key });
};

function jfToVod(item: JfItem): VodItem {
  const type = item.Type === 'Episode' ? 'Episode' : item.Type === 'Series' ? 'Series' : 'Movie';
  const ep =
    type === 'Episode' && item.IndexNumber != null
      ? `S${item.ParentIndexNumber ?? 1} · E${item.IndexNumber}`
      : undefined;
  return {
    id: `server:${item.Id}`,
    title: item.Name || 'Untitled',
    year: item.ProductionYear,
    poster: jfImage(item.Id),
    overview: ep || item.Overview || '',
    source: 'server',
    identifier: item.Id,
    msType: type,
  };
}

type PlexChild = {
  ratingKey?: string;
  parentRatingKey?: string;
  title?: string;
  grandparentTitle?: string;
  year?: number;
  summary?: string;
  type?: string;
  thumb?: string;
  leafCount?: number;
  index?: number;
  parentIndex?: number;
  parentTitle?: string;
  Media?: { container?: string; Part?: { key?: string }[] }[];
};

type PlexResp = { MediaContainer?: { Metadata?: PlexChild[]; Directory?: { key?: string; title?: string; type?: string }[] } };

const plexImage = (path?: string): string | undefined => {
  if (!path) return undefined;
  const { base, key } = cfg();
  return join(`${base}${path}`, '', { 'X-Plex-Token': key });
};

function plexPart(item: PlexChild): string | undefined {
  return item.Media?.[0]?.Part?.[0]?.key;
}

function plexToVod(item: PlexChild): VodItem | null {
  const type = item.type === 'episode' ? 'Episode' : item.type === 'show' ? 'Series' : 'Movie';
  const ref = plexPart(item);
  if (type !== 'Series' && (!item.ratingKey || !ref)) return null;
  if (!item.ratingKey || !item.title) return null;
  const ep = type === 'Episode' && item.index ? `S${item.parentIndex ?? 1} · E${item.index}` : undefined;
  return {
    id: `server:${item.ratingKey}`,
    title: item.title,
    year: item.year,
    poster: plexImage(item.thumb),
    overview: ep || item.summary || '',
    source: 'server',
    identifier: item.ratingKey,
    msPart: ref,
    msType: type,
  };
}

export type MsBrowse = { query?: string; page?: number; pageSize?: number; latest?: boolean };

export async function msBrowse(opts: MsBrowse): Promise<VodItem[]> {
  const { kind } = cfg();
  const pageSize = opts.pageSize ?? 21;
  const page = Math.max(1, opts.page ?? 1);
  return kind === 'plex'
    ? plexBrowse(opts, pageSize, page)
    : jfBrowse(opts, pageSize, page);
}

async function jfBrowse(opts: MsBrowse, pageSize: number, page: number): Promise<VodItem[]> {
  const { base, key } = cfg();
  const uid = await jfUserId(`${base}|${key}`);
  const params: Record<string, string> = {
    Recursive: 'true',
    IncludeItemTypes: 'Movie,Series',
    Limit: String(pageSize),
    StartIndex: String((page - 1) * pageSize),
    Fields: 'Overview,ProductionYear,ParentId,IndexNumber,ParentIndexNumber,SeriesName',
    EnableImageTypes: 'Primary',
    EnableTotalRecordCount: 'false',
    userId: uid,
  };
  if (opts.query?.trim()) {
    params.SearchTerm = opts.query.trim();
    params.IncludeItemTypes = 'Movie,Series,Episode';
    params.SortBy = 'SortName';
  } else if (opts.latest) {
    params.SortBy = 'DateCreated';
    params.SortOrder = 'Descending';
  } else {
    params.SortBy = 'SortName';
    params.SortOrder = 'Ascending';
  }
  const res = await get<JfList>(`/Users/${encodeURIComponent(uid)}/Items`, params);
  return (res.Items ?? []).filter(i => i.Id && i.Name).map(jfToVod);
}

async function plexBrowse(opts: MsBrowse, pageSize: number, page: number): Promise<VodItem[]> {
  const start = (page - 1) * pageSize;
  if (opts.query?.trim()) {
    const res = await get<PlexResp>('/search', { query: opts.query.trim(), limit: String(pageSize * 2) });
    return (res.MediaContainer?.Metadata ?? [])
      .map(plexToVod)
      .filter((v): v is VodItem => v !== null)
      .slice(0, pageSize);
  }
  const sections = await get<PlexResp>('/library/sections');
  const dirs = sections.MediaContainer?.Directory ?? [];
  const section = dirs.find(d => d.type === 'movie') ?? dirs.find(d => d.type === 'show') ?? dirs[0];
  if (!section?.key) throw new Error('This Plex server has no library to browse.');
  const res = await get<PlexResp>(`/library/sections/${encodeURIComponent(section.key)}/all`, {
    'X-Plex-Container-Start': String(start),
    'X-Plex-Container-Size': String(pageSize),
    sort: opts.latest ? 'addedAt:desc' : 'titleSort:asc',
  });
  return (res.MediaContainer?.Metadata ?? [])
    .map(plexToVod)
    .filter((v): v is VodItem => v !== null);
}

export async function msEpisodes(seriesId: string): Promise<VodItem[]> {
  const { kind } = cfg();
  const ref = seriesId;
  if (!ref) throw new Error('This series has no server id.');
  if (kind === 'plex') {
    const res = await get<PlexResp>(`/library/metadata/${encodeURIComponent(ref)}/allLeaves`);
    return (res.MediaContainer?.Metadata ?? [])
      .map(c => plexToVod({ ...c, type: 'episode' }))
      .filter((v): v is VodItem => v !== null);
  }
  const { base, key } = cfg();
  const uid = await jfUserId(`${base}|${key}`);
  const res = await get<JfList>(`/Shows/${encodeURIComponent(ref)}/Episodes`, {
    UserId: uid,
    Fields: 'Overview,ProductionYear,IndexNumber,ParentIndexNumber,SeriesName',
    IsMissing: 'false',
  });
  return (res.Items ?? []).filter(i => i.Id).map(jfToVod);
}

type JfSource = {
  Id?: string;
  Container?: string;
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
};

async function jfStream(ref: string): Promise<string> {
  const { base, key } = cfg();
  const uid = await jfUserId(`${base}|${key}`);
  const res = await post<{ MediaSources?: JfSource[] }>(
    `/Items/${encodeURIComponent(ref)}/PlaybackInfo`,
    { userId: uid },
    {
      DeviceId: DEVICE,
      PlayMethod: 'DirectPlay',
      MaxStreamingBitrate: 20000000,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      AllowVideoStreamFallback: true,
      AllowAudioStreamFallback: true,
      AutoOpenVideoStreams: 0,
    },
  );
  const src = res.MediaSources?.[0];
  if (!src) throw new Error('The server returned no playable copy of this title.');
  const msId = src.Id ?? ref;
  const streamParams: Record<string, string> = { MediaSourceId: msId, api_key: key };
  if (src.SupportsDirectPlay || src.SupportsDirectStream) {
    return join(`${base}/Videos/${encodeURIComponent(ref)}/stream`, '', {
      ...streamParams,
      Static: 'true',
    });
  }
  return join(`${base}/Videos/${encodeURIComponent(ref)}/master.m3u8`, '', {
    ...streamParams,
    DeviceId: DEVICE,
    PlayMethod: 'Transcode',
    MaxStreamingBitrate: '12000000',
    AudioBitRate: '256000',
    AudioChannels: '2',
    AllowHls: 'true',
    MasterPlaylist: 'm3u8',
  });
}

export async function resolveMsStream(item: VodItem): Promise<string> {
  const { kind, base, key } = cfg();
  if (kind === 'plex') {
    if (!item.msPart) throw new Error('No playable file for that title on this server.');
    return join(`${base}${item.msPart}`, '', { 'X-Plex-Token': key, download: '1' });
  }
  const ref = item.identifier ?? '';
  if (!ref) throw new Error('No playable file for that title on this server.');
  return jfStream(ref);
}

export async function msTest(): Promise<string> {
  const { kind, base, key } = cfg();
  if (kind === 'plex') {
    const res = await get<PlexResp>('/library/sections');
    const dirs = res.MediaContainer?.Directory ?? [];
    if (!dirs.length) throw new Error('Connected, but no libraries are visible to this token.');
    return `Plex · ${dirs.map(d => d.title).filter(Boolean).slice(0, 3).join(', ')}`;
  }
  const info = await get<{ ServerName?: string; Version?: string }>('/System/Info');
  const uid = await jfUserId(`${base}|${key}`);
  const res = await get<JfList>(`/Users/${encodeURIComponent(uid)}/Items`, {
    Recursive: 'true',
    IncludeItemTypes: 'Movie,Series',
    Limit: '1',
    userId: uid,
  });
  const total = res.TotalRecordCount;
  return `${info.ServerName ?? 'Server'} ${info.Version ?? ''}${total ? ` · ${total} titles` : ''}`.trim();
}

import type { VodItem } from './archive';

const BOOT_URL = 'https://boot.pluto.tv/v4/start';
const VOD_API = 'https://api.pluto.tv';
const FALLBACK_STITCHER = 'https://cfd-v4-service-channel-stitcher-use1-1.prd.pluto.tv';
const APP_VERSION = '14.2.1';

type Raw = Record<string, unknown>;

type Boot = {
  api: string;
  channels: string;
  stitcher: string;
  token: string;
  stitcherParams: string;
  country: string;
  expires: number;
};

const DEVICE_ID = `biralotv${Math.random().toString(16).slice(2, 14)}`;

let bootCache: Boot | null = null;
let vodCache: { at: number; items: VodItem[] } | null = null;
let liveCache: { at: number; items: VodItem[] } | null = null;

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function pickImage(node: unknown): string | undefined {
  if (!node) return undefined;
  if (typeof node === 'string') return node.startsWith('http') ? node : undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = pickImage(child);
      if (found) return found;
    }
    return undefined;
  }
  const o = node as Raw;
  const url = str(o.url || o.href || o.path);
  if (url.startsWith('http')) return url;
  return pickImage(o.images ?? o.thumbnail ?? o.logo);
}

async function json<T>(url: string, headers: Record<string, string>): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`Pluto TV replied ${res.status}`);
      return (await res.json()) as T;
    } catch (e: unknown) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Pluto TV is unreachable.');
}

async function boot(force = false): Promise<Boot> {
  if (!force && bootCache && bootCache.expires > Date.now()) return bootCache;
  const params = new URLSearchParams({
    appName: 'web',
    appVersion: APP_VERSION,
    clientID: DEVICE_ID,
    clientModelNumber: DEVICE_ID,
    deviceType: 'desktop',
    deviceMake: 'biralotv',
    deviceModel: 'biralotv',
    clientLanguage: 'eng',
    searchTerm: '',
    channelStartIndex: '0',
    limit: '1',
  });
  const body = await json<Raw>(`${BOOT_URL}?${params.toString()}`, {
    'User-Agent': 'Mozilla/5.0',
    origin: 'https://pluto.tv',
    referer: 'https://pluto.tv/',
  });
  const servers = (body.servers ?? {}) as Raw;
  const session = (body.session ?? {}) as Raw;
  const token = str(body.sessionToken);
  if (!token) throw new Error('Pluto TV did not return a session token.');
  const refresh = num(body.refreshInSec) ?? 3600;
  bootCache = {
    api: str(servers.api) || VOD_API,
    channels: str(servers.channels) || 'https://service-channels.clusters.pluto.tv',
    stitcher: str(servers.stitcher) || FALLBACK_STITCHER,
    token,
    stitcherParams: str(body.stitcherParams),
    country: str(session.countryCode) || '??',
    expires: Date.now() + Math.max(120, refresh - 600) * 1000,
  };
  return bootCache;
}

const auth = (b: Boot): Record<string, string> => ({
  Authorization: `Bearer ${b.token}`,
  origin: 'https://pluto.tv',
  referer: 'https://pluto.tv/',
  'User-Agent': 'Mozilla/5.0',
});

function stitch(b: Boot, path: string): string {
  const clean = path.split('?')[0];
  const fixed = clean.startsWith('/stitch/') ? `/v2${clean}` : clean;
  const base = `${b.stitcher}${fixed}?jwt=${encodeURIComponent(b.token)}&masterJWTPassthrough=true`;
  return b.stitcherParams ? `${base}&${b.stitcherParams}` : base;
}

function plutoVodItem(raw: Raw, category: string): VodItem | null {
  const id = str(raw._id ?? raw.id);
  const title = str(raw.name ?? raw.title);
  if (!id || !title) return null;
  const type = str(raw.type).toLowerCase();
  return {
    id: `pluto:${id}`,
    title,
    year: num(raw.yearInfo ?? raw.year),
    poster: pickImage(raw.images ?? raw.image ?? raw.thumbnail),
    overview: str(raw.description).slice(0, 400) || category,
    source: 'pluto',
    identifier: id,
    plutoKind: type === 'series' || type === 'show' ? 'series' : 'vod',
    plutoUrl: str(raw.url ?? raw.stitchedUrl),
    rating: num(raw.rating),
  };
}

async function loadVod(b: Boot): Promise<VodItem[]> {
  const body = await json<Raw>(`${b.api}/v3/vod/categories?includeItems=true&deviceType=web&country=US`, auth(b));
  const cats = Array.isArray(body.categories) ? (body.categories as Raw[]) : [];
  const out: VodItem[] = [];
  const seen = new Set<string>();
  for (const cat of cats) {
    const name = str(cat.name ?? cat.title);
    const items = Array.isArray(cat.items) ? (cat.items as Raw[]) : [];
    for (const item of items) {
      const vod = plutoVodItem(item, name);
      if (vod && !seen.has(vod.identifier ?? vod.id)) {
        seen.add(vod.identifier ?? vod.id);
        out.push(vod);
      }
    }
  }
  return out;
}

export async function plutoOnDemand(): Promise<VodItem[]> {
  if (vodCache && vodCache.at > Date.now()) return vodCache.items;
  const b = await boot();
  let items = await loadVod(b);
  if (items.length === 0) items = await loadVod(await boot(true));
  if (items.length === 0) throw new Error(regionError(b.country));
  vodCache = { at: Date.now() + 15 * 60 * 1000, items };
  return items;
}

async function loadLive(b: Boot): Promise<VodItem[]> {
  const body = await json<Raw>(
    `${b.channels}/v2/guide/channels?offset=0&limit=1000&sort=${encodeURIComponent('number:asc')}`,
    auth(b),
  );
  const data = Array.isArray(body.data) ? (body.data as Raw[]) : [];
  const out: VodItem[] = [];
  for (const raw of data) {
    const id = str(raw._id ?? raw.id);
    const title = str(raw.name ?? raw.title);
    if (!id || !title) continue;
    out.push({
      id: `pluto:${id}`,
      title,
      poster: pickImage(raw),
      overview: str(raw.shortDescription ?? raw.description).slice(0, 400) || `Channel ${str(raw.number)}`,
      source: 'pluto',
      identifier: id,
      plutoKind: 'live',
    });
  }
  return out;
}

export async function plutoLive(): Promise<VodItem[]> {
  if (liveCache && liveCache.at > Date.now()) return liveCache.items;
  const b = await boot();
  let items = await loadLive(b);
  if (items.length === 0) items = await loadLive(await boot(true));
  if (items.length === 0) throw new Error(regionError(b.country));
  liveCache = { at: Date.now() + 10 * 60 * 1000, items };
  return items;
}

const regionError = (country: string): string =>
  `Pluto TV has no catalogue for your region (${country.toUpperCase()}). It serves US, UK, CA, EU and LATAM connections.`;

export type PlutoKind = 'vod' | 'live';

export async function plutoBrowse(opts: { kind: PlutoKind; query?: string; page?: number; pageSize?: number }): Promise<VodItem[]> {
  const all = opts.kind === 'live' ? await plutoLive() : await plutoOnDemand();
  const q = (opts.query ?? '').trim().toLowerCase();
  const hits = q ? all.filter(i => i.title.toLowerCase().includes(q)) : all;
  const size = opts.pageSize ?? 21;
  const page = Math.max(1, opts.page ?? 1);
  return hits.slice((page - 1) * size, page * size);
}

export async function resolvePlutoStream(item: VodItem): Promise<string> {
  const b = await boot();
  if (item.plutoKind === 'live') {
    if (!item.identifier) throw new Error('This Pluto channel has no id.');
    return stitch(b, `/stitch/hls/channel/${item.identifier}/master.m3u8`);
  }
  if (item.plutoUrl) return stitch(b, item.plutoUrl);
  if (item.identifier) return stitch(b, `/stitch/hls/episode/${item.identifier}/master.m3u8`);
  throw new Error('This Pluto title has no playable source.');
}

export async function plutoStatus(): Promise<string> {
  const b = await boot(true);
  const vod = await loadVod(b);
  if (vod.length === 0) return regionError(b.country);
  return `Pluto TV · ${b.country.toUpperCase()} · ${vod.length} on-demand titles`;
}

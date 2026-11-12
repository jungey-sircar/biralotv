import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeScreen } from '@/components/SafeScreen';
import { VodCard } from '@/components/vod-card';
import { ARCHIVE_SCOPES, searchArchive, type ArchiveScope, type VodItem } from '@/lib/archive';
import { msBrowse, useMsConfigured } from '@/lib/media-server';
import { plutoBrowse } from '@/lib/pluto';
import { discoverScraperBase } from '@/lib/scraper';
import {
  tmdbDiscover,
  tmdbLatestMovies,
  tmdbMovieList,
  tmdbSearch,
  tmdbSearchMovies,
  type TmdbMovieListKind,
} from '@/lib/tmdb';
import { useTheme } from '@/theme';
import { goBack, openVodItem } from '@/lib/util';

type Tab = {
  key: string;
  label: string;
  scope?: ArchiveScope;
  movieList?: TmdbMovieListKind;
  tmdbKind?: 'movie' | 'tv';
  server?: boolean;
  pluto?: 'vod' | 'live';
};

const SERVER_TAB: Tab = { key: 'server', label: 'My Library', server: true };

const MOVIE_TABS: Tab[] = [
  { key: 'latest-movies', label: 'Latest Movies', movieList: 'now_playing' },
  { key: 'trending-movies', label: 'Trending', movieList: 'trending' },
  { key: 'popular-movies', label: 'Popular', movieList: 'popular' },
  { key: 'top-rated-movies', label: 'Top Rated', movieList: 'top_rated' },
];

const PLUTO_TABS: Tab[] = [
  { key: 'pluto-vod', label: 'Pluto Films', pluto: 'vod' },
  { key: 'pluto-live', label: 'Pluto Live', pluto: 'live' },
];

const ARCHIVE_TABS: Tab[] = ARCHIVE_SCOPES.map(s => ({ key: s.key, label: s.label, scope: s }));

const TMDB_TABS: Tab[] = [
  { key: 'tmdb-anime', label: 'Anime+', tmdbKind: 'tv' },
];

export default function OnDemand() {
  const params = useLocalSearchParams<{ scope?: string; query?: string }>();
  const { colors: c } = useTheme();
  const hasServer = useMsConfigured();

  const tabs = useMemo<Tab[]>(
    () => [...(hasServer ? [SERVER_TAB] : []), ...MOVIE_TABS, ...ARCHIVE_TABS, ...PLUTO_TABS, ...TMDB_TABS],
    [hasServer],
  );

  const paramScope = params.scope === 'tmdb-films' ? 'popular-movies' : params.scope;
  const [selection, setSelection] = useState<{ forParam: string | undefined; key: string }>(() => ({
    forParam: paramScope,
    key: paramScope && tabs.some(t => t.key === paramScope) ? paramScope : 'latest-movies',
  }));
  const candidateScope =
    selection.forParam === paramScope
      ? selection.key
      : paramScope && tabs.some(t => t.key === paramScope)
        ? paramScope
        : 'latest-movies';
  const scopeKey = tabs.some(t => t.key === candidateScope) ? candidateScope : tabs[0].key;
  const setScopeKey = useCallback(
    (key: string) => setSelection({ forParam: paramScope, key }),
    [paramScope],
  );
  const [searchInput, setSearchInput] = useState(params.query ?? '');
  const [q, setQ] = useState(params.query ?? '');
  const [items, setItems] = useState<VodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [scraperReady, setScraperReady] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const page = useRef(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const PAGE_SIZE = 20;

  const tab = useMemo(() => tabs.find(t => t.key === scopeKey) ?? tabs[0], [tabs, scopeKey]);

  useEffect(() => {
    let alive = true;
    discoverScraperBase({ probe: true })
      .then(u => {
        if (alive) setScraperReady(Boolean(u));
      })
      .catch(() => {
        if (alive) setScraperReady(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setQ(searchInput), 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [searchInput]);

  const fetchPage = useCallback(async (target: Tab, query: string): Promise<VodItem[]> => {
    if (target.server) return msBrowse({ query, page: page.current });
    if (target.pluto) return plutoBrowse({ kind: target.pluto, query, page: page.current, pageSize: PAGE_SIZE });
    if (target.movieList) {
      if (query.trim()) return tmdbSearchMovies(query, page.current);
      if (target.movieList === 'now_playing') return tmdbLatestMovies(page.current);
      return tmdbMovieList(target.movieList, page.current);
    }
    if (target.tmdbKind && query.trim()) return tmdbSearch(query, page.current);
    if (target.tmdbKind) {
      return tmdbDiscover({
        kind: target.tmdbKind,
        genre: target.tmdbKind === 'tv' ? 16 : undefined,
        page: page.current,
      });
    }
    return searchArchive({ scope: target.scope, query, page: page.current, rows: PAGE_SIZE });
  }, []);

  const load = useCallback(
    async (replace: boolean) => {
      if (replace) setLoading(true);
      else setLoadingMore(true);
      setError('');
      try {
        if (replace) page.current = 1;
        const batch = await fetchPage(tab, q);
        setItems(prev => (replace ? batch : merge(prev, batch)));
        if (batch.length < Math.min(PAGE_SIZE, 16)) page.current = -1;
        else page.current += 1;
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'could not load titles');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [fetchPage, tab, q],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(true);
  }, [load]);

  async function openItem(item: VodItem) {
    setBusyId(item.id);
    setError('');
    try {
      const message = await openVodItem(item);
      if (message) setError(message);
    } finally {
      setBusyId('');
    }
  }

  function onEndReached() {
    if (loading || loadingMore || page.current === -1) return;
    void load(false);
  }

  const isScraperShelf = Boolean(tab.movieList || tab.tmdbKind);

  return (
    <SafeScreen>
      <View style={styles.headerArea}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => goBack()} hitSlop={12}>
            <Text style={[styles.backText, { color: c.text }]}>‹</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: c.text }]}>On Demand</Text>
        </View>
        <View style={[styles.searchBox, { backgroundColor: c.surface }]}>
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder={
              tab.server
                ? 'Search your library…'
                : isScraperShelf
                  ? 'Search latest movies & shows…'
                  : 'Search free films…'
            }
            placeholderTextColor={c.textMuted}
            style={[styles.searchInput, { color: c.text }]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
        </View>
        <FlatList
          horizontal
          data={tabs}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          keyExtractor={t => t.key}
          renderItem={({ item }) => (
            <Chip
              label={item.label}
              active={item.key === scopeKey}
              color={c}
              onPress={() => setScopeKey(item.key)}
            />
          )}
        />
        <Pressable
          disabled={!isScraperShelf || scraperReady !== false}
          onPress={() => router.push('/settings')}
        >
          <Text style={[styles.note, { color: c.textMuted }]}>
            {tab.server
              ? 'My Library plays straight from your Jellyfin, Emby or Plex server.'
              : isScraperShelf
                ? scraperReady === false
                  ? 'Tap a movie to view details. Connect stream-scraper in Settings to stream in-app.'
                  : 'Tap any movie to stream via stream-scraper, watch trailers, or check availability.'
                : 'Public-domain, Creative Commons, and Pluto TV shelves play straight in-app.'}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      ) : (
        <>
          {error ? (
            <View style={styles.errorBar}>
              <Text style={[styles.errorText, { color: c.danger }]} numberOfLines={2}>
                {error}
              </Text>
              <Pressable onPress={() => void load(true)} hitSlop={8}>
                <Text style={[styles.retry, { color: c.accent }]}>Retry</Text>
              </Pressable>
            </View>
          ) : null}
          {busyId ? (
            <View style={styles.busyBar}>
              <ActivityIndicator size="small" color={c.accent} />
              <Text style={[styles.busyText, { color: c.textSecondary }]}>Preparing stream…</Text>
            </View>
          ) : null}
          {items.length === 0 && !error ? (
            <View style={styles.center}>
              <Text style={[styles.emptyTitle, { color: c.text }]}>Nothing found</Text>
              <Text style={[styles.emptyDesc, { color: c.textMuted }]}>
                Try another shelf or a different title.
              </Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={i => i.id}
              numColumns={3}
              key={`grid-${scopeKey}-${q}`}
              columnWrapperStyle={styles.gridRow}
              contentContainerStyle={styles.grid}
              onEndReached={onEndReached}
              onEndReachedThreshold={0.4}
              windowSize={11}
              ListFooterComponent={
                loadingMore ? <ActivityIndicator style={styles.footer} color={c.accent} /> : null
              }
              renderItem={({ item }) => (
                <View style={styles.gridCell}>
                  <VodCard item={item} onPress={openItem} />
                </View>
              )}
            />
          )}
        </>
      )}
    </SafeScreen>
  );
}

function merge(prev: VodItem[], next: VodItem[]): VodItem[] {
  const seen = new Set(prev.map(x => x.id));
  return [...prev, ...next.filter(x => !seen.has(x.id))];
}

function Chip({
  label,
  active,
  color,
  onPress,
}: {
  label: string;
  active: boolean;
  color: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: active ? color.text : pressed ? color.elevated : 'transparent' },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? color.bg : color.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerArea: {
    paddingTop: 8,
    paddingHorizontal: 20,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backText: {
    fontSize: 22,
    marginTop: -2,
  },
  headerTitle: {
    fontWeight: '800',
    fontSize: 22,
    flex: 1,
    letterSpacing: -0.4,
  },
  searchBox: {
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  searchInput: {
    paddingVertical: 10,
    fontSize: 14,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 2,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  note: {
    fontSize: 11.5,
    lineHeight: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    padding: 24,
  },
  emptyTitle: {
    fontWeight: '700',
    fontSize: 16,
  },
  emptyDesc: {
    textAlign: 'center',
  },
  cta: {
    marginTop: 6,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  ctaText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 12.5,
  },
  retry: {
    fontWeight: '800',
    fontSize: 12.5,
  },
  busyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  busyText: {
    fontSize: 12,
  },
  grid: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 12,
  },
  gridRow: {
    gap: 12,
  },
  gridCell: {
    flex: 1,
    maxWidth: '33.3%',
  },
  footer: {
    padding: 16,
  },
});

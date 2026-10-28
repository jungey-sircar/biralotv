import { api, type Channel, type ChannelPage } from '@/lib/api';
import { useTheme, filterAdult, useSettings } from '@/theme';
import { ChannelGrid } from '@/components/grid';
import { SafeScreen } from '@/components/SafeScreen';
import { useLocalSearchParams, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View, useWindowDimensions, StyleSheet } from 'react-native';
import { sourceLabel, goBack, openPlayer } from '@/lib/util';
import { useLocalStore } from '@/lib/store';

function deriveGroups(list: Channel[]): string[] {
  const set = new Set<string>();
  for (const ch of list) if (ch.group) set.add(ch.group);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export default function Browse() {
  const params = useLocalSearchParams<{ source?: string; group?: string; favorites?: string }>();
  const rawSource = params.source ?? '';
  const initialGroup = params.group ?? '';
  const favoritesOnly = params.favorites === '1';
  const showAdult = useSettings(s => s.showAdult);
  const playlists = useLocalStore(s => s.playlists);
  const { colors: c } = useTheme();

  const fallback = useMemo(() => {
    const first = playlists.find(p => p.text || p.url);
    return first ? `user:${first.id}` : 'iptv-cat:general';
  }, [playlists]);
  const source = rawSource || fallback;

  const [group, setGroup] = useState(initialGroup);
  const [searchInput, setSearchInput] = useState('');
  const [q, setQuery] = useState('');
  const [groups, setGroups] = useState<string[]>([]);
  const [pageData, setPageData] = useState<ChannelPage | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dims = useWindowDimensions();
  const cols = useMemo(() => {
    const horiz = dims.width > dims.height;
    const pad = horiz ? 90 : 36;
    const usable = Math.max(320, dims.width - pad);
    const n = Math.floor(usable / 116);
    return Math.min(8, Math.max(3, n));
  }, [dims.width, dims.height]);

  useEffect(() => {
    searchTimer.current && clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setQuery(searchInput), 400);
    return () => {
      searchTimer.current && clearTimeout(searchTimer.current);
    };
  }, [searchInput]);

  const fetchPage = useCallback(
    async (page: number, replace: boolean) => {
      const data = await api.channels({
        source,
        group,
        q,
        favorites: favoritesOnly,
        page,
        perPage: Math.max(60, cols * 10),
      });
      const filtered = { ...data, channels: filterAdult(data.channels, showAdult) };
      if (replace) {
        setChannels(filtered.channels);
        setGroups(favoritesOnly ? [] : deriveGroups(filtered.channels));
      } else setChannels(prev => merge(prev, filtered.channels));
      setPageData(filtered);
    },
    [source, group, q, favoritesOnly, cols, showAdult],
  );

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      await fetchPage(1, true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function onEndReached() {
    if (!pageData || loadingMore) return;
    if (pageData.page >= pageData.total_pages) return;
    setLoadingMore(true);
    try {
      await fetchPage(pageData.page + 1, false);
    } catch {}
    setLoadingMore(false);
  }

  return (
    <SafeScreen>
      <View style={styles.headerArea}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => goBack()} hitSlop={12}>
            <Text style={[styles.backText, { color: c.text }]}>‹</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
            {favoritesOnly ? 'Favorites' : sourceLabel(source) + (group ? ` · ${group}` : '')}
          </Text>
          {pageData ? (
            <Text style={[styles.channelCount, { color: c.textMuted }]}>{pageData.total}</Text>
          ) : null}
          <Pressable onPress={() => router.push('/channel-search')} hitSlop={10}>
            <Text style={[styles.searchAll, { color: c.accent }]}>⌕</Text>
          </Pressable>
        </View>
        <View style={[styles.searchBox, { backgroundColor: c.surface }]}>
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search channels…"
            placeholderTextColor={c.textMuted}
            style={[styles.searchInput, { color: c.text }]}
            autoCorrect={false}
            autoCapitalize="none"
            keyboardType="default"
            returnKeyType="search"
            autoFocus={false}
          />
        </View>
        {!favoritesOnly && groups.length > 1 ? (
          <FlatList
            horizontal
            data={groups}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            keyExtractor={g => g}
            renderItem={({ item }) => (
              <Chip label={item} active={group === item} color={c} onPress={() => setGroup(item)} />
            )}
            ListHeaderComponent={<Chip label="All" active={!group} color={c} onPress={() => setGroup('')} />}
          />
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      ) : (
        <View style={styles.gridContainer}>
          {error && channels.length === 0 ? (
            <View style={styles.errorCenter}>
              <Text style={[styles.errorText, { color: c.textSecondary }]}>{error}</Text>
              <Pressable
                onPress={load}
                style={({ pressed }) => [styles.retryBtn, { backgroundColor: pressed ? c.elevated : c.accent }]}
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/playlists')} hitSlop={8}>
                <Text style={[styles.linkText, { color: c.textMuted }]}>Add a playlist</Text>
              </Pressable>
            </View>
          ) : channels.length === 0 ? (
            <View style={styles.errorCenter}>
              <Text style={[styles.errorText, { color: c.textSecondary }]}>
                {q ? `No channels match “${q}”.` : 'No channels here yet.'}
              </Text>
            </View>
          ) : (
            <ChannelGrid channels={channels} onPress={openPlayer} cols={cols} onEndReached={onEndReached} />
          )}
          {loadingMore ? (
            <View style={styles.loadingMore}>
              <ActivityIndicator size="small" color={c.accent} />
            </View>
          ) : null}
        </View>
      )}
    </SafeScreen>
  );
}

function merge(prev: Channel[], next: Channel[]): Channel[] {
  const seen = new Set(prev.map(x => x.id));
  return [...prev, ...next.filter(x => !seen.has(x.id))];
}

function Chip({ label, active, color, onPress }: { label: string; active: boolean; color: ReturnType<typeof useTheme>['colors']; onPress: () => void }) {
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
    fontSize: 16,
    flex: 1,
  },
  channelCount: {
    fontSize: 12,
  },
  searchAll: {
    fontSize: 20,
    marginTop: -2,
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
  loadingCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  errorText: {
    textAlign: 'center',
  },
  retryBtn: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryText: {
    color: '#fff',
    fontWeight: '700',
  },
  linkText: {
    fontSize: 12,
    fontWeight: '600',
  },
  loadingMore: {
    padding: 14,
    alignItems: 'center',
  },
  gridContainer: {
    flex: 1,
  },
});

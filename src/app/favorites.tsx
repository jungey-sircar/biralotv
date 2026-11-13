import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeScreen } from '@/components/SafeScreen';
import { VodCard } from '@/components/vod-card';
import { ChannelGrid } from '@/components/grid';
import {
  useLocalStore,
  useLocalStoreHydrated,
  watchlistItemToVod,
  type WatchlistItem,
} from '@/lib/store';
import { useTheme, filterAdult, useSettings } from '@/theme';
import { goBack, openPlayer, openVodItem } from '@/lib/util';

export default function Favorites() {
  const showAdult = useSettings(s => s.showAdult);
  const { colors: c } = useTheme();
  const { width } = useWindowDimensions();
  const hydrated = useLocalStoreHydrated();

  const watchlist = useLocalStore(s => s.watchlist);
  const channelFavorites = useLocalStore(s => s.favorites);
  const filteredChannels = filterAdult(channelFavorites, showAdult);

  const [tab, setTab] = useState<'watchlist' | 'channels'>('watchlist');

  // Compute responsive columns for poster grid: 3 cols on mobile, 4-6 on tablet/desktop
  const numColumns = width >= 1024 ? 6 : width >= 768 ? 4 : 3;

  return (
    <SafeScreen bg={c.bg}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} hitSlop={14} style={styles.backBtn}>
          <Text style={[styles.backText, { color: c.text }]}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>My List</Text>
        <View style={styles.tabToggle}>
          <TouchableOpacity
            onPress={() => setTab('watchlist')}
            style={[
              styles.tabBtn,
              tab === 'watchlist' && { backgroundColor: c.text },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                { color: tab === 'watchlist' ? c.bg : c.textSecondary },
              ]}
            >
              Movies & Shows ({watchlist.length})
            </Text>
          </TouchableOpacity>
          {filteredChannels.length > 0 ? (
            <TouchableOpacity
              onPress={() => setTab('channels')}
              style={[
                styles.tabBtn,
                tab === 'channels' && { backgroundColor: c.text },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: tab === 'channels' ? c.bg : c.textSecondary },
                ]}
              >
                Channels ({filteredChannels.length})
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {!hydrated ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      ) : tab === 'channels' ? (
        <ChannelGrid channels={filteredChannels} cols={4} onPress={openPlayer} />
      ) : watchlist.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyIcon, { color: c.textMuted }]}>🎬</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>Your List is empty</Text>
          <Text style={[styles.emptyDesc, { color: c.textMuted }]}>
            Explore trending movies and TV series, and tap &quot;+ My List&quot; to save them here.
          </Text>
          <TouchableOpacity
            style={[styles.browseBtn, { backgroundColor: c.accent }]}
            onPress={() => router.push({ pathname: '/on-demand', params: { scope: 'trending-movies' } })}
          >
            <Text style={styles.browseBtnText}>Explore Trending</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          key={`cols-${numColumns}`}
          data={watchlist}
          keyExtractor={item => item.id}
          numColumns={numColumns}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.columnWrapper}
          renderItem={({ item }: { item: WatchlistItem }) => {
            const vod = watchlistItemToVod(item);
            return (
              <View style={[styles.gridCell, { width: `${100 / numColumns - 2}%` }]}>
                <VodCard
                  item={vod}
                  onPress={clicked => void openVodItem(clicked)}
                  showWatchlistBtn
                />
              </View>
            );
          }}
        />
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  backBtn: {
    paddingRight: 6,
  },
  backText: {
    fontSize: 28,
    lineHeight: 30,
    marginTop: -2,
    fontWeight: '300',
  },
  title: {
    fontWeight: '900',
    fontSize: 22,
    letterSpacing: -0.4,
  },
  tabToggle: {
    flexDirection: 'row',
    marginLeft: 'auto',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    padding: 3,
    gap: 4,
  },
  tabBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 6,
  },
  emptyTitle: {
    fontWeight: '800',
    fontSize: 20,
    letterSpacing: -0.3,
  },
  emptyDesc: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 320,
  },
  browseBtn: {
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
  },
  browseBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  grid: {
    paddingHorizontal: 16,
    paddingBottom: 48,
    gap: 14,
  },
  columnWrapper: {
    gap: 10,
    justifyContent: 'flex-start',
  },
  gridCell: {
    flexShrink: 0,
  },
});

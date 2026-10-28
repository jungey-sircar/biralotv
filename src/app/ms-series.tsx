import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeScreen } from '@/components/SafeScreen';
import { VodCard } from '@/components/vod-card';
import type { VodItem } from '@/lib/archive';
import { msEpisodes } from '@/lib/media-server';
import { goBack, openVodItem } from '@/lib/util';
import { useTheme } from '@/theme';

export default function SeriesEpisodes() {
  const { id, title } = useLocalSearchParams<{ id?: string; title?: string }>();
  const { colors: c } = useTheme();
  const [items, setItems] = useState<VodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setItems(await msEpisodes(id ?? ''));
      setError('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'could not load episodes');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} hitSlop={12}>
          <Text style={[styles.backText, { color: c.text }]}>‹</Text>
        </Pressable>
        <Text numberOfLines={1} style={[styles.title, { color: c.text }]}>
          {title || 'Series'}
        </Text>
        <Text style={[styles.count, { color: c.textMuted }]}>{items.length || ''}</Text>
      </View>

      {notice ? (
        <Pressable style={[styles.notice, { backgroundColor: c.danger }]} onPress={() => setNotice('')}>
          <Text style={styles.noticeText} numberOfLines={2}>{notice}</Text>
        </Pressable>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: c.text }]}>Can&apos;t load episodes</Text>
          <Text style={[styles.emptyDesc, { color: c.textMuted }]}>{error}</Text>
          <Pressable
            onPress={() => {
              setLoading(true);
              void load();
            }}
            style={({ pressed }) => [styles.retry, { backgroundColor: pressed ? c.elevated : c.accent }]}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: c.text }]}>No episodes found</Text>
          <Text style={[styles.emptyDesc, { color: c.textMuted }]}>
            This server has no playable episodes for that series yet.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          numColumns={3}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.grid}
          windowSize={11}
          renderItem={({ item }) => (
            <View style={styles.gridCell}>
              <VodCard
                item={item}
                onPress={i => {
                  void openVodItem(i).then(message => setNotice(message ?? ''));
                }}
              />
            </View>
          )}
        />
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    paddingTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backText: {
    fontSize: 22,
    marginTop: -2,
  },
  title: {
    fontWeight: '800',
    fontSize: 16,
    flex: 1,
  },
  count: {
    fontSize: 12,
  },
  notice: {
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  noticeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
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
  retry: {
    marginTop: 6,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13.5,
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
});

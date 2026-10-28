import { goBack, openPlayer } from '@/lib/util';
import { useTheme, filterAdult, useSettings } from '@/theme';
import { ChannelGrid } from '@/components/grid';
import { SafeScreen } from '@/components/SafeScreen';
import { useLocalStore, useLocalStoreHydrated } from '@/lib/store';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View, StyleSheet } from 'react-native';

export default function Favorites() {
  const showAdult = useSettings(s => s.showAdult);
  const { colors: c } = useTheme();
  const hydrated = useLocalStoreHydrated();
  const stored = useLocalStore(s => s.favorites);
  const favorites = useMemo(() => filterAdult(stored, showAdult), [stored, showAdult]);

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} hitSlop={12}>
          <Text style={[styles.backText, { color: c.text }]}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>Favorites</Text>
        <Text style={[styles.count, { color: c.textMuted }]}>{favorites.length}</Text>
      </View>

      {!hydrated ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      ) : favorites.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyIcon, { color: c.textMuted }]}>♡</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>No favorites yet</Text>
          <Text style={[styles.emptyDesc, { color: c.textMuted }]}>Tap ♡ in the player to save a channel.</Text>
        </View>
      ) : (
        <ChannelGrid channels={favorites} cols={4} onPress={openPlayer} />
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    padding: 24,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 4,
  },
  emptyTitle: {
    fontWeight: '700',
    fontSize: 16,
  },
  emptyDesc: {
    textAlign: 'center',
  },
});

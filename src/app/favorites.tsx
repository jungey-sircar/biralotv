import { api, Channel } from '@/lib/api';
import { goBack } from '@/lib/util';
import { useTheme, filterAdult, useSettings } from '@/theme';
import { ChannelGrid } from '@/components/grid';
import { SafeScreen } from '@/components/SafeScreen';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View, StyleSheet } from 'react-native';

export default function Favorites() {
  const showAdult = useSettings(s => s.showAdult);
  const { colors: c } = useTheme();
  const [favorites, setFavorites] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      api
        .favorites()
        .then(data => {
          setFavorites(filterAdult(data, showAdult));
          setError('');
        })
        .catch(e => setError(e instanceof Error ? e.message : 'Failed to load favorites'))
        .finally(() => setLoading(false));
    }, [showAdult]),
  );

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} hitSlop={12}>
          <Text style={[styles.backText, { color: c.text }]}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>Favorites</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: c.textSecondary }]}>{error}</Text>
        </View>
      ) : favorites.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyIcon, { color: c.textMuted }]}>♡</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>No favorites yet</Text>
          <Text style={[styles.emptyDesc, { color: c.textMuted }]}>Long-press a channel card to add it.</Text>
        </View>
      ) : (
        <ChannelGrid
          channels={favorites}
          cols={4}
          onPress={ch => router.push({ pathname: '/player', params: { id: ch.id, name: ch.name } })}
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    padding: 24,
  },
  errorText: {
    textAlign: 'center',
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
